/**
 * Unit tests for P2PSessionAdapter.
 *
 * Mocks WorkerP2PBridge to control role transitions.
 * Verifies:
 *   - whenRoleDecided resolves for both server AND client
 *   - Client mode: page relay, message queueing, bootstrap forwarding
 *   - Server mode: virtual transports for remote peers
 *   - Role transition wiring (undecided → client/server)
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ReactSyncTransportMessage } from '../src/shared/messageTypes'
import { APP_MSG } from '../src/shared/messageTypes'
import type { DomSyncTransportLike } from 'dkt/dom-sync/transport.js'
import type { WorkerP2PBridgeConfig, WorkerP2PBridgeEvents } from '../src/p2p/WorkerP2PBridge'

// ── Mock WorkerP2PBridge ───────────────────────────────────────────

type BridgeRole = 'server' | 'client' | 'undecided'

type MockBridgeInstance = {
  role: BridgeRole
  events: WorkerP2PBridgeEvents
  serverMessages: ReactSyncTransportMessage[]
  peerMessages: Map<string, ReactSyncTransportMessage[]>
  broadcastMessages: ReactSyncTransportMessage[]
  peerId: string
  destroyed: boolean
  /** Pending messages queued while DC not ready (simulates real bridge behavior) */
  pendingToServer: ReactSyncTransportMessage[]
  /** Simulate DC open: flush pending messages */
  simulateDCOpen(): void
  /** Whether DC is "open" (for sendToServer) */
  dcOpen: boolean
}

let mockBridgeInstance: MockBridgeInstance | null = null

const { createWorkerP2PBridge } = vi.hoisted(() => {
  return {
    createWorkerP2PBridge: vi.fn((config: WorkerP2PBridgeConfig) => {
      let role: BridgeRole = 'undecided'
      const peerId = `mock-peer-${Math.random().toString(36).slice(2, 8)}`
      const serverMessages: ReactSyncTransportMessage[] = []
      const peerMessages = new Map<string, ReactSyncTransportMessage[]>()
      const broadcastMessages: ReactSyncTransportMessage[] = []
      const pendingToServer: ReactSyncTransportMessage[] = []
      let dcOpen = false
      let destroyed = false

      const instance: MockBridgeInstance = {
        get role() { return role },
        set role(r) { role = r },
        events: config.events,
        serverMessages,
        peerMessages,
        broadcastMessages,
        peerId,
        get destroyed() { return destroyed },
        set destroyed(v) { destroyed = v },
        pendingToServer,
        get dcOpen() { return dcOpen },
        simulateDCOpen() {
          dcOpen = true
          for (const msg of pendingToServer) {
            serverMessages.push(msg)
          }
          pendingToServer.length = 0
        },
      }

      mockBridgeInstance = instance

      return {
        get role() { return role },
        peerId,
        sendToServer(msg: ReactSyncTransportMessage) {
          if (role !== 'client') return
          if (dcOpen) {
            serverMessages.push(msg)
          } else {
            pendingToServer.push(msg)
          }
        },
        sendToRemotePeer(remotePeerId: string, msg: ReactSyncTransportMessage) {
          if (!peerMessages.has(remotePeerId)) peerMessages.set(remotePeerId, [])
          peerMessages.get(remotePeerId)!.push(msg)
        },
        broadcastToRemotePeers(msg: ReactSyncTransportMessage) {
          broadcastMessages.push(msg)
        },
        destroy() {
          destroyed = true
        },
      }
    }),
  }
})

vi.mock('../src/p2p/WorkerP2PBridge', () => ({
  createWorkerP2PBridge,
}))

// ── Helpers ────────────────────────────────────────────────────────

type TransportListener = (msg: ReactSyncTransportMessage) => void

const createMockTransport = (): DomSyncTransportLike<ReactSyncTransportMessage> & {
  _sent: ReactSyncTransportMessage[]
  _listeners: Set<TransportListener>
  _receive(msg: ReactSyncTransportMessage): void
} => {
  const listeners = new Set<TransportListener>()
  const sent: ReactSyncTransportMessage[] = []

  return {
    _sent: sent,
    _listeners: listeners,
    _receive(msg: ReactSyncTransportMessage) {
      for (const fn of listeners) fn(msg)
    },
    send(msg: ReactSyncTransportMessage) {
      sent.push(msg)
    },
    listen(listener: TransportListener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    destroy() {
      listeners.clear()
    },
  }
}

const createMockRuntime = () => {
  const connections: Array<{
    transport: DomSyncTransportLike<ReactSyncTransportMessage>
    unlisten: () => void
    destroyed: boolean
  }> = []

  return {
    connections,
    connect(transport: DomSyncTransportLike<ReactSyncTransportMessage>) {
      const entry = {
        transport,
        unlisten: transport.listen(() => {}),
        destroyed: false,
      }
      connections.push(entry)
      return {
        destroy() {
          entry.destroyed = true
          entry.unlisten()
        },
      }
    },
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('P2PSessionAdapter', () => {
  afterEach(() => {
    mockBridgeInstance = null
    createWorkerP2PBridge.mockClear()
  })

  const createAdapter = async () => {
    const { createP2PSessionAdapter } = await import('../src/p2p/P2PSessionAdapter')
    return createP2PSessionAdapter({
      sessionKey: 'test-room',
      createSignaling: vi.fn() as never,
    })
  }

  test('whenRoleDecided resolves with "server" when bridge becomes server', async () => {
    const adapter = await createAdapter()
    const bridge = mockBridgeInstance!

    // Role is undecided initially
    expect(adapter.role).toBe('undecided')

    const rolePromise = adapter.whenRoleDecided()
    bridge.role = 'server'
    bridge.events.onBecomeServer()

    const role = await rolePromise
    expect(role).toBe('server')
    expect(adapter.role).toBe('server')

    adapter.destroy()
  })

  test('whenRoleDecided resolves with "client" when bridge becomes client', async () => {
    const adapter = await createAdapter()
    const bridge = mockBridgeInstance!

    expect(adapter.role).toBe('undecided')

    const rolePromise = adapter.whenRoleDecided()
    bridge.role = 'client'
    bridge.events.onBecomeClient()

    const role = await rolePromise
    expect(role).toBe('client')
    expect(adapter.role).toBe('client')

    adapter.destroy()
  })

  test('whenRoleDecided returns immediately if role already decided', async () => {
    const adapter = await createAdapter()
    const bridge = mockBridgeInstance!

    bridge.role = 'server'
    bridge.events.onBecomeServer()

    const role = await adapter.whenRoleDecided()
    expect(role).toBe('server')

    adapter.destroy()
  })

  test('client mode: connectPage sets up relay to server', async () => {
    const adapter = await createAdapter()
    const bridge = mockBridgeInstance!

    // Become client
    bridge.role = 'client'
    bridge.simulateDCOpen()
    bridge.events.onBecomeClient()

    const transport = createMockTransport()
    adapter.connectPage(transport)

    // Page sends a message → should be relayed to server
    transport._receive({
      type: APP_MSG.CONTROL_DISPATCH_APP_ACTION,
      action_name: 'testAction',
      payload: { x: 1 },
    } as ReactSyncTransportMessage)

    // Message should arrive at the bridge's serverMessages
    expect(bridge.serverMessages).toHaveLength(1)
    expect((bridge.serverMessages[0] as Record<string, unknown>).action_name).toBe('testAction')

    adapter.destroy()
  })

  test('client mode: onRemoteMessage delivers to all page transports', async () => {
    const adapter = await createAdapter()
    const bridge = mockBridgeInstance!

    bridge.role = 'client'
    bridge.events.onBecomeClient()

    const transport1 = createMockTransport()
    const transport2 = createMockTransport()
    adapter.connectPage(transport1)
    adapter.connectPage(transport2)

    // Server sends a message → should be delivered to all pages
    const msg: ReactSyncTransportMessage = {
      type: APP_MSG.SESSION_BOOTED,
      session_id: 'remote-s1',
      session_key: 'test-room',
      root_node_id: 'root-1',
    } as ReactSyncTransportMessage

    bridge.events.onRemoteMessage(msg)

    expect(transport1._sent).toHaveLength(1)
    expect(transport1._sent[0].type).toBe(APP_MSG.SESSION_BOOTED)
    expect(transport2._sent).toHaveLength(1)
    expect(transport2._sent[0].type).toBe(APP_MSG.SESSION_BOOTED)

    adapter.destroy()
  })

  test('server mode: connectPage wires to local runtime', async () => {
    const adapter = await createAdapter()
    const bridge = mockBridgeInstance!
    const runtime = createMockRuntime()

    adapter.setRuntime(runtime)

    bridge.role = 'server'
    bridge.events.onBecomeServer()

    const transport = createMockTransport()
    adapter.connectPage(transport)

    // Runtime should have received a connection
    expect(runtime.connections).toHaveLength(1)
    expect(runtime.connections[0].transport).toBe(transport)

    adapter.destroy()
  })

  test('server mode: remote peer gets virtual transport connected to runtime', async () => {
    const adapter = await createAdapter()
    const bridge = mockBridgeInstance!
    const runtime = createMockRuntime()

    adapter.setRuntime(runtime)

    bridge.role = 'server'
    bridge.events.onBecomeServer()

    // Simulate remote peer connecting
    const peerCallbacks = bridge.events.onRemotePeerConnected('remote-peer-1')

    // Runtime should have a new connection (virtual transport)
    expect(runtime.connections).toHaveLength(1)

    // Send a message through the virtual transport
    peerCallbacks.receive({
      type: APP_MSG.CONTROL_BOOTSTRAP_SESSION,
      session_key: 'test-room',
    } as ReactSyncTransportMessage)

    // The message was received by the listener (runtime connection)
    // We can't check model-runtime internals here, but at least verify the connection exists
    expect(runtime.connections[0].destroyed).toBe(false)

    // Disconnect remote peer
    bridge.events.onRemotePeerDisconnected('remote-peer-1')
    // Connection should be destroyed
    expect(runtime.connections[0].destroyed).toBe(true)

    adapter.destroy()
  })

  test('undecided → client: pages connected while undecided get wired after role decided', async () => {
    const adapter = await createAdapter()
    const bridge = mockBridgeInstance!

    // Connect a page while role is undecided
    const transport = createMockTransport()
    adapter.connectPage(transport)

    // At this point, no relay is set up (role is undecided)
    transport._receive({
      type: APP_MSG.CONTROL_BOOTSTRAP_SESSION,
      session_key: 'test-room',
    } as ReactSyncTransportMessage)

    // No messages should have been relayed yet
    expect(bridge.serverMessages).toHaveLength(0)
    expect(bridge.pendingToServer).toHaveLength(0)

    // Now become client → wireAllPages should set up relay
    bridge.role = 'client'
    bridge.events.onBecomeClient()

    // Now send another message → should be relayed
    transport._receive({
      type: APP_MSG.CONTROL_DISPATCH_APP_ACTION,
      action_name: 'afterWire',
      payload: {},
    } as ReactSyncTransportMessage)

    // This message should reach the bridge (queued or sent)
    const total = bridge.serverMessages.length + bridge.pendingToServer.length
    expect(total).toBeGreaterThan(0)

    adapter.destroy()
  })

  test('undecided → server: pages connected while undecided get wired after setRuntime', async () => {
    const adapter = await createAdapter()
    const bridge = mockBridgeInstance!
    const runtime = createMockRuntime()

    // Connect a page while role is undecided
    const transport = createMockTransport()
    adapter.connectPage(transport)

    expect(runtime.connections).toHaveLength(0)

    // Become server
    bridge.role = 'server'
    bridge.events.onBecomeServer()

    // Still no connection because runtime not set yet
    expect(runtime.connections).toHaveLength(0)

    // Now set runtime → wireAllPages should connect the page
    adapter.setRuntime(runtime)
    expect(runtime.connections).toHaveLength(1)
    expect(runtime.connections[0].transport).toBe(transport)

    adapter.destroy()
  })

  test('sendToServer queues messages and flushes on DC open', async () => {
    const adapter = await createAdapter()
    const bridge = mockBridgeInstance!

    bridge.role = 'client'
    bridge.events.onBecomeClient()

    // DC is not open yet
    adapter.sendToServer({
      type: APP_MSG.CONTROL_BOOTSTRAP_SESSION,
      session_key: 'test-room',
    } as ReactSyncTransportMessage)

    // Message should be in pending queue
    expect(bridge.serverMessages).toHaveLength(0)
    expect(bridge.pendingToServer).toHaveLength(1)

    // Simulate DC open → flush
    bridge.simulateDCOpen()

    expect(bridge.serverMessages).toHaveLength(1)
    expect(bridge.pendingToServer).toHaveLength(0)
    expect((bridge.serverMessages[0] as Record<string, unknown>).session_key).toBe('test-room')

    adapter.destroy()
  })

  test('failover sends P2P_SESSION_LOST to all pages', async () => {
    const adapter = await createAdapter()
    const bridge = mockBridgeInstance!

    bridge.role = 'client'
    bridge.events.onBecomeClient()

    const transport = createMockTransport()
    adapter.connectPage(transport)

    bridge.events.onFailover()

    const lostMsg = transport._sent.find(m => m.type === APP_MSG.P2P_SESSION_LOST) as
      { type: string; reason: string } | undefined
    expect(lostMsg).toBeDefined()
    expect(lostMsg!.reason).toBe('failover')

    adapter.destroy()
  })

  test('destroy cleans up all resources', async () => {
    const adapter = await createAdapter()
    const bridge = mockBridgeInstance!
    const runtime = createMockRuntime()

    adapter.setRuntime(runtime)

    bridge.role = 'server'
    bridge.events.onBecomeServer()

    const transport = createMockTransport()
    adapter.connectPage(transport)

    expect(runtime.connections).toHaveLength(1)

    adapter.destroy()

    expect(bridge.destroyed).toBe(true)
    expect(runtime.connections[0].destroyed).toBe(true)
  })
})
