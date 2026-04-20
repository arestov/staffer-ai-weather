/**
 * Tests PageP2PManager — the page-context P2P coordinator.
 *
 * Mocks WebSocket + RTCPeerConnection to verify:
 *   - Server role: onBecomeServer fires when this peer is elected leader
 *   - Client role: onBecomeClient fires with a DataChannel-backed transport
 *   - Server proxying: remote client DC messages forwarded to dedicated worker port
 *   - Cleanup: destroy() tears down all connections
 *   - Session lost: DC close triggers onSessionLost
 *   - Signaling error fallback: falls back to server mode
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ReactSyncTransportMessage } from '../src/shared/messageTypes'
import { APP_MSG } from '../src/shared/messageTypes'

// ── Mock WebSocket ──────────────────────────────────────────────

type WSHandler = (...args: unknown[]) => void

let wsInstances: MockWebSocket[] = []

class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  readyState = MockWebSocket.OPEN
  sent: string[] = []
  onopen: WSHandler | null = null
  onmessage: WSHandler | null = null
  onerror: WSHandler | null = null
  onclose: WSHandler | null = null

  constructor(_url: string) {
    wsInstances.push(this)
    queueMicrotask(() => this.onopen?.({}))
  }

  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = MockWebSocket.CLOSED
  }

  receiveMessage(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

// ── Mock RTCPeerConnection + DataChannel ────────────────────────

type DCHandler = (...args: unknown[]) => void

class MockDataChannel {
  label: string
  readyState = 'connecting'
  onopen: DCHandler | null = null
  onclose: DCHandler | null = null
  onmessage: DCHandler | null = null
  onerror: DCHandler | null = null
  sent: string[] = []

  constructor(label: string) {
    this.label = label
  }

  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 'closed'
  }

  simulateOpen() {
    this.readyState = 'open'
    this.onopen?.({})
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateClose() {
    this.readyState = 'closed'
    this.onclose?.({})
  }
}

let pcInstances: MockRTCPeerConnection[] = []

class MockRTCPeerConnection {
  connectionState = 'new'
  localDescription: { toJSON: () => Record<string, unknown> } | null = null
  createdChannels: MockDataChannel[] = []
  receivedChannels: MockDataChannel[] = []

  onicecandidate: DCHandler | null = null
  ondatachannel: DCHandler | null = null
  onconnectionstatechange: DCHandler | null = null

  constructor(_config?: unknown) {
    pcInstances.push(this)
  }

  createDataChannel(label: string, _opts?: unknown) {
    const dc = new MockDataChannel(label)
    this.createdChannels.push(dc)
    return dc
  }

  simulateDataChannel(label: string) {
    const dc = new MockDataChannel(label)
    this.receivedChannels.push(dc)
    this.ondatachannel?.({ channel: dc })
    return dc
  }

  async createOffer() {
    return { type: 'offer', sdp: 'mock-sdp-offer' }
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'mock-sdp-answer' }
  }

  async setLocalDescription(desc: unknown) {
    this.localDescription = {
      toJSON: () => desc as Record<string, unknown>,
    }
  }

  async setRemoteDescription(_desc: unknown) {}
  async addIceCandidate(_candidate: unknown) {}
  close() {
    this.connectionState = 'closed'
  }

  simulateConnectionState(state: string) {
    this.connectionState = state
    this.onconnectionstatechange?.({})
  }
}

// ── Mock SharedWorker (for proxy ports) ─────────────────────────

class MockMessagePort {
  onmessage: ((ev: { data: unknown }) => void) | null = null
  sent: unknown[] = []
  started = false

  postMessage(data: unknown) {
    this.sent.push(data)
  }
  start() {
    this.started = true
  }
  close() {}
  addEventListener(type: string, handler: (ev: { data: unknown }) => void) {
    if (type === 'message') this.onmessage = handler
  }
  removeEventListener() {}
}

let sharedWorkerInstances: MockSharedWorker[] = []

class MockSharedWorker {
  port: MockMessagePort
  constructor(_url: string | URL, _opts?: unknown) {
    this.port = new MockMessagePort()
    sharedWorkerInstances.push(this)
  }
}

// ── Setup global mocks ──────────────────────────────────────────

vi.stubGlobal('WebSocket', MockWebSocket)
vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection)
vi.stubGlobal(
  'RTCSessionDescription',
  class {
    constructor(public desc: unknown) {}
  },
)
vi.stubGlobal(
  'RTCIceCandidate',
  class {
    constructor(public candidate: unknown) {}
  },
)
vi.stubGlobal('SharedWorker', MockSharedWorker)

// ── Test helpers ────────────────────────────────────────────────

const flushMicrotasks = () =>
  new Promise<void>((r) => {
    queueMicrotask(r)
  })
const flushAsync = async (n = 5) => {
  for (let i = 0; i < n; i++) await flushMicrotasks()
}

// ── Tests ──────────────────────────────────────────────────────

describe('PageP2PManager', () => {
  beforeEach(() => {
    wsInstances = []
    pcInstances = []
    sharedWorkerInstances = []
  })

  afterEach(() => {
    wsInstances = []
    pcInstances = []
    sharedWorkerInstances = []
  })

  const createManager = async () => {
    const { createPageP2PManager } = await import('../src/p2p/PageP2PManager')

    const events = {
      onBecomeServer: vi.fn(),
      onBecomeClient: vi.fn(),
      onSessionLost: vi.fn(),
      onError: vi.fn(),
    }

    const manager = createPageP2PManager(
      {
        sessionKey: 'test-room',
        signalUrl: 'ws://127.0.0.1:8790',
        workerUrl: 'http://localhost:5173/worker/shared-worker.ts',
      },
      events,
    )

    return { manager, events }
  }

  test('onBecomeServer fires when this peer is elected leader', async () => {
    const { manager, events } = await createManager()
    await flushAsync()

    const ws = wsInstances[0]
    expect(ws).toBeDefined()
    expect(ws.sent).toHaveLength(1)
    const joinMsg = JSON.parse(ws.sent[0])
    expect(joinMsg.type).toBe('join')

    const myPeerId = joinMsg.peerId

    // DO assigns this peer as leader
    ws.receiveMessage({
      type: 'room-state',
      peers: [myPeerId],
      leaderPeerId: myPeerId,
      epoch: 1,
    })

    await flushAsync()

    expect(manager.role).toBe('server')
    expect(events.onBecomeServer).toHaveBeenCalledTimes(1)
    expect(events.onBecomeClient).not.toHaveBeenCalled()

    manager.destroy()
  })

  test('onBecomeClient fires when another peer is leader, with DC transport', async () => {
    const { manager, events } = await createManager()
    await flushAsync()

    const ws = wsInstances[0]
    const myPeerId = JSON.parse(ws.sent[0]).peerId

    // Another peer is the leader
    ws.receiveMessage({
      type: 'room-state',
      peers: [myPeerId, 'remote-server'],
      leaderPeerId: 'remote-server',
      epoch: 1,
    })

    await flushAsync()

    expect(manager.role).toBe('client')
    // PC was created, DC was created
    expect(pcInstances).toHaveLength(1)
    const dc = pcInstances[0].createdChannels[0]
    expect(dc).toBeDefined()

    // Simulate DC open → onBecomeClient fires with transport
    dc.simulateOpen()

    expect(events.onBecomeClient).toHaveBeenCalledTimes(1)
    const transport = events.onBecomeClient.mock.calls[0][0]
    expect(transport).toBeDefined()
    expect(typeof transport.send).toBe('function')
    expect(typeof transport.listen).toBe('function')
    expect(typeof transport.destroy).toBe('function')

    manager.destroy()
  })

  test('client DC transport relays messages bidirectionally', async () => {
    const { manager, events } = await createManager()
    await flushAsync()

    const ws = wsInstances[0]
    const myPeerId = JSON.parse(ws.sent[0]).peerId

    ws.receiveMessage({
      type: 'room-state',
      peers: [myPeerId, 'remote-server'],
      leaderPeerId: 'remote-server',
      epoch: 1,
    })

    await flushAsync()

    const dc = pcInstances[0].createdChannels[0]
    dc.simulateOpen()

    const transport = events.onBecomeClient.mock.calls[0][0]

    // Send through transport → goes to DC
    transport.send({ type: APP_MSG.CONTROL_BOOTSTRAP_SESSION, session_key: 'test-room' })
    expect(dc.sent).toHaveLength(1)
    expect(JSON.parse(dc.sent[0]).type).toBe(APP_MSG.CONTROL_BOOTSTRAP_SESSION)

    // Receive from DC → goes to transport listeners
    const received: ReactSyncTransportMessage[] = []
    transport.listen((msg: ReactSyncTransportMessage) => {
      received.push(msg)
    })

    dc.simulateMessage({
      type: APP_MSG.SESSION_BOOTED,
      session_id: 's1',
      session_key: 'test-room',
      root_node_id: 'root-1',
    })

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe(APP_MSG.SESSION_BOOTED)

    manager.destroy()
  })

  test('client watchdog times out after disconnected state', async () => {
    vi.useFakeTimers()

    try {
      const { manager, events } = await createManager()
      await flushAsync()

      const ws = wsInstances[0]
      const myPeerId = JSON.parse(ws.sent[0]).peerId

      ws.receiveMessage({
        type: 'room-state',
        peers: [myPeerId, 'remote-server'],
        leaderPeerId: 'remote-server',
        epoch: 1,
      })

      await flushAsync()

      expect(pcInstances).toHaveLength(1)
      const pc = pcInstances[0]

      pc.simulateConnectionState('connected')
      pc.simulateConnectionState('disconnected')

      await vi.advanceTimersByTimeAsync(9_999)
      expect(events.onError).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(events.onError).toHaveBeenCalledTimes(1)
      expect((events.onError.mock.calls[0][0] as Error).message).toBe('WebRTC connection timed out')

      manager.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  test('server mode: incoming offer creates proxy for remote client', async () => {
    const { manager, events } = await createManager()
    await flushAsync()

    const ws = wsInstances[0]
    const myPeerId = JSON.parse(ws.sent[0]).peerId

    // Become server
    ws.receiveMessage({
      type: 'room-state',
      peers: [myPeerId],
      leaderPeerId: myPeerId,
      epoch: 1,
    })

    await flushAsync()
    expect(events.onBecomeServer).toHaveBeenCalledTimes(1)

    // Remote client sends an offer
    ws.receiveMessage({
      type: 'offer',
      from: 'remote-client-1',
      to: myPeerId,
      sdp: { type: 'offer', sdp: 'remote-offer-sdp' },
      ts: Date.now(),
    })

    await flushAsync()

    // Server should have created an RTCPeerConnection for this client
    expect(pcInstances).toHaveLength(1)
    const pc = pcInstances[0]

    // Simulate the client's DataChannel arriving at the server
    const remoteDC = pc.simulateDataChannel('sync')
    remoteDC.simulateOpen()

    // A proxy SharedWorker should have been created for this client
    // (filter out the first SharedWorker which may be the main one — in our test we only mock)
    expect(sharedWorkerInstances.length).toBeGreaterThanOrEqual(1)

    // Server should have sent an answer back via signaling
    const answerMsg = ws.sent.find((s) => {
      try {
        return JSON.parse(s).type === 'answer'
      } catch {
        return false
      }
    })
    expect(answerMsg).toBeDefined()

    manager.destroy()
  })

  test('server mode: proxy bridges DC ↔ worker port', async () => {
    const { manager, events } = await createManager()
    await flushAsync()

    const ws = wsInstances[0]
    const myPeerId = JSON.parse(ws.sent[0]).peerId

    ws.receiveMessage({
      type: 'room-state',
      peers: [myPeerId],
      leaderPeerId: myPeerId,
      epoch: 1,
    })

    await flushAsync()

    // Remote client connects
    ws.receiveMessage({
      type: 'offer',
      from: 'remote-client-1',
      to: myPeerId,
      sdp: { type: 'offer', sdp: 'offer-sdp' },
      ts: Date.now(),
    })

    await flushAsync()

    const pc = pcInstances[0]
    const remoteDC = pc.simulateDataChannel('sync')
    remoteDC.simulateOpen()

    // Get the proxy worker's port
    const proxyWorker = sharedWorkerInstances[sharedWorkerInstances.length - 1]
    const proxyPort = proxyWorker.port

    // Client sends message through DC → should be forwarded to proxy worker port
    remoteDC.simulateMessage({
      type: APP_MSG.CONTROL_BOOTSTRAP_SESSION,
      session_key: 'test-room',
    })

    expect(proxyPort.sent).toHaveLength(1)
    expect((proxyPort.sent[0] as ReactSyncTransportMessage).type).toBe(
      APP_MSG.CONTROL_BOOTSTRAP_SESSION,
    )

    // Worker sends message through proxy port → should be forwarded to DC
    proxyPort.onmessage?.({
      data: {
        type: APP_MSG.SESSION_BOOTED,
        session_id: 's1',
        session_key: 'test-room',
        root_node_id: 'root-1',
      },
    })

    expect(remoteDC.sent).toHaveLength(1)
    const dcMsg = JSON.parse(remoteDC.sent[0])
    expect(dcMsg.type).toBe(APP_MSG.SESSION_BOOTED)

    manager.destroy()
  })

  test('client: onSessionLost fires when DC closes', async () => {
    const { manager, events } = await createManager()
    await flushAsync()

    const ws = wsInstances[0]
    const myPeerId = JSON.parse(ws.sent[0]).peerId

    ws.receiveMessage({
      type: 'room-state',
      peers: [myPeerId, 'remote-server'],
      leaderPeerId: 'remote-server',
      epoch: 1,
    })

    await flushAsync()

    const dc = pcInstances[0].createdChannels[0]
    dc.simulateOpen()

    expect(events.onBecomeClient).toHaveBeenCalledTimes(1)

    // DC closes — server went away
    dc.simulateClose()

    expect(events.onSessionLost).toHaveBeenCalledTimes(1)
    expect(events.onSessionLost).toHaveBeenCalledWith('server-gone')

    manager.destroy()
  })

  test('signaling error before role decided falls back to server', async () => {
    vi.useFakeTimers()
    try {
      const { manager, events } = await createManager()
      await flushAsync()

      // Close each WebSocket that gets created during retries
      // (BridgeSignaling retries up to MAX_CONNECT_RETRIES=4 times before calling onError)
      for (let i = 0; i < 5; i++) {
        const ws = wsInstances[wsInstances.length - 1]
        if (!ws) break
        ws.onclose?.({})
        await flushAsync()
        await vi.advanceTimersByTimeAsync(10_000)
        await flushAsync()
      }

      // Should fall back to server after all retries exhausted
      expect(manager.role).toBe('server')
      expect(events.onBecomeServer).toHaveBeenCalledTimes(1)

      manager.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  test('server mode ignores signaling close after leader assignment', async () => {
    const { manager, events } = await createManager()
    await flushAsync()

    const ws = wsInstances[0]
    const myPeerId = JSON.parse(ws.sent[0]).peerId

    ws.receiveMessage({
      type: 'room-state',
      peers: [myPeerId],
      leaderPeerId: myPeerId,
      epoch: 1,
    })

    await flushAsync()

    ws.onclose?.({})
    await flushAsync()

    expect(events.onBecomeServer).toHaveBeenCalledTimes(1)
    expect(events.onError).not.toHaveBeenCalled()
    expect(events.onSessionLost).not.toHaveBeenCalled()
    expect(manager.role).toBe('server')

    manager.destroy()
  })

  test('client mode ignores signaling close after data channel opens', async () => {
    const { manager, events } = await createManager()
    await flushAsync()

    const ws = wsInstances[0]
    const myPeerId = JSON.parse(ws.sent[0]).peerId

    ws.receiveMessage({
      type: 'room-state',
      peers: [myPeerId, 'remote-server'],
      leaderPeerId: 'remote-server',
      epoch: 1,
    })

    await flushAsync()

    const dc = pcInstances[0].createdChannels[0]
    dc.simulateOpen()

    ws.onclose?.({})
    await flushAsync()

    expect(events.onBecomeClient).toHaveBeenCalledTimes(1)
    expect(events.onError).not.toHaveBeenCalled()
    expect(events.onSessionLost).not.toHaveBeenCalled()
    expect(manager.role).toBe('client')

    manager.destroy()
  })

  test('destroy cleans up signaling, connections, and proxies', async () => {
    const { manager } = await createManager()
    await flushAsync()

    const ws = wsInstances[0]
    const myPeerId = JSON.parse(ws.sent[0]).peerId

    ws.receiveMessage({
      type: 'room-state',
      peers: [myPeerId],
      leaderPeerId: myPeerId,
      epoch: 1,
    })

    await flushAsync()

    // Add a remote client
    ws.receiveMessage({
      type: 'offer',
      from: 'remote-client-1',
      to: myPeerId,
      sdp: { type: 'offer', sdp: 'offer-sdp' },
      ts: Date.now(),
    })

    await flushAsync()

    const pc = pcInstances[0]

    manager.destroy()

    // PC should be closed
    expect(pc.connectionState).toBe('closed')
    // WS should have sent bye and closed
    const byeMsg = ws.sent.find((s) => {
      try {
        return JSON.parse(s).type === 'bye'
      } catch {
        return false
      }
    })
    expect(byeMsg).toBeDefined()
  })
})
