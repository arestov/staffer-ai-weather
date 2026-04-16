/**
 * Unit tests for WorkerP2PBridge — client flow.
 *
 * Uses mocked WebSocket + RTCPeerConnection to verify:
 *   - onBecomeClient fires when bridge becomes client
 *   - sendToServer queues messages while DataChannel is not open
 *   - queued messages are flushed when DataChannel opens
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

  /** Simulate receiving a message from the server */
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
}

let pcInstances: MockRTCPeerConnection[] = []

class MockRTCPeerConnection {
  connectionState = 'new'
  localDescription: { toJSON: () => Record<string, unknown> } | null = null
  createdChannels: MockDataChannel[] = []

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

// ── Test helpers ────────────────────────────────────────────────

const flushMicrotasks = () =>
  new Promise<void>((r) => {
    queueMicrotask(r)
  })
const flushAsync = async (n = 5) => {
  for (let i = 0; i < n; i++) await flushMicrotasks()
}

// ── Tests ──────────────────────────────────────────────────────

describe('WorkerP2PBridge client flow', () => {
  beforeEach(() => {
    wsInstances = []
    pcInstances = []
  })

  afterEach(() => {
    wsInstances = []
    pcInstances = []
  })

  const createBridge = async () => {
    // Import fresh to avoid stale module state
    const { createWorkerP2PBridge } = await import('../src/p2p/WorkerP2PBridge')
    const { createDoSignalingFactory } = await import('../src/p2p/BridgeSignaling')

    const events = {
      onBecomeServer: vi.fn(),
      onBecomeClient: vi.fn(),
      onRemotePeerConnected: vi.fn(() => ({
        receive: vi.fn(),
        destroy: vi.fn(),
      })),
      onRemotePeerDisconnected: vi.fn(),
      onRemoteMessage: vi.fn(),
      onFailover: vi.fn(),
      onError: vi.fn(),
    }

    const bridge = createWorkerP2PBridge({
      roomId: 'test-room',
      createSignaling: createDoSignalingFactory('ws://127.0.0.1:8790'),
      events,
    })

    return { bridge, events }
  }

  test('onBecomeClient fires when DO assigns a remote leader', async () => {
    const { bridge, events } = await createBridge()

    await flushAsync()

    // WS should have connected and sent join
    expect(wsInstances).toHaveLength(1)
    const ws = wsInstances[0]
    expect(ws.sent).toHaveLength(1)
    const joinMsg = JSON.parse(ws.sent[0])
    expect(joinMsg.type).toBe('join')

    const myPeerId = joinMsg.peerId

    // Simulate DO response: another peer is the leader
    ws.receiveMessage({
      type: 'room-state',
      peers: [myPeerId, 'remote-server-peer'],
      leaderPeerId: 'remote-server-peer',
      epoch: 1,
    })

    await flushAsync()

    // Bridge should become client
    expect(bridge.role).toBe('client')
    expect(events.onBecomeClient).toHaveBeenCalledTimes(1)
    expect(events.onBecomeServer).not.toHaveBeenCalled()

    bridge.destroy()
  })

  test('sendToServer queues messages when DataChannel is not yet open', async () => {
    const { bridge, events } = await createBridge()
    await flushAsync()

    const ws = wsInstances[0]
    const myPeerId = JSON.parse(ws.sent[0]).peerId

    // Become client
    ws.receiveMessage({
      type: 'room-state',
      peers: [myPeerId, 'server-peer'],
      leaderPeerId: 'server-peer',
      epoch: 1,
    })

    await flushAsync()
    expect(bridge.role).toBe('client')

    // PC was created, DC was created but NOT yet open
    expect(pcInstances).toHaveLength(1)
    const dc = pcInstances[0].createdChannels[0]
    expect(dc).toBeDefined()
    expect(dc.readyState).toBe('connecting')

    // Send a message → should be queued (not sent via DC)
    bridge.sendToServer({
      type: APP_MSG.CONTROL_BOOTSTRAP_SESSION,
      session_key: 'test-room',
    } as ReactSyncTransportMessage)

    expect(dc.sent).toHaveLength(0)

    // Open the DC → queued message should be flushed
    dc.simulateOpen()

    expect(dc.sent).toHaveLength(1)
    const flushed = JSON.parse(dc.sent[0])
    expect(flushed.type).toBe(APP_MSG.CONTROL_BOOTSTRAP_SESSION)
    expect(flushed.session_key).toBe('test-room')

    bridge.destroy()
  })

  test('sendToServer sends immediately when DataChannel is already open', async () => {
    const { bridge } = await createBridge()
    await flushAsync()

    const ws = wsInstances[0]
    const myPeerId = JSON.parse(ws.sent[0]).peerId

    // Become client
    ws.receiveMessage({
      type: 'room-state',
      peers: [myPeerId, 'server-peer'],
      leaderPeerId: 'server-peer',
      epoch: 1,
    })

    await flushAsync()

    // Open DC
    const dc = pcInstances[0].createdChannels[0]
    dc.simulateOpen()

    // Now send → should go directly
    bridge.sendToServer({
      type: APP_MSG.CONTROL_DISPATCH_APP_ACTION,
      action_name: 'test',
    } as ReactSyncTransportMessage)

    expect(dc.sent).toHaveLength(1)
    const sent = JSON.parse(dc.sent[0])
    expect(sent.type).toBe(APP_MSG.CONTROL_DISPATCH_APP_ACTION)

    bridge.destroy()
  })

  test('multiple queued messages are flushed in order on DC open', async () => {
    const { bridge } = await createBridge()
    await flushAsync()

    const ws = wsInstances[0]
    const myPeerId = JSON.parse(ws.sent[0]).peerId

    ws.receiveMessage({
      type: 'room-state',
      peers: [myPeerId, 'server-peer'],
      leaderPeerId: 'server-peer',
      epoch: 1,
    })

    await flushAsync()

    // Queue multiple messages
    bridge.sendToServer({
      type: APP_MSG.CONTROL_BOOTSTRAP_SESSION,
      session_key: 'room-1',
    } as ReactSyncTransportMessage)

    bridge.sendToServer({
      type: APP_MSG.CONTROL_DISPATCH_APP_ACTION,
      action_name: 'action1',
    } as ReactSyncTransportMessage)

    bridge.sendToServer({
      type: APP_MSG.SYNC_UPDATE_STRUCTURE_USAGE,
      data: { shapes: [] },
    } as ReactSyncTransportMessage)

    const dc = pcInstances[0].createdChannels[0]
    expect(dc.sent).toHaveLength(0)

    // Open DC → all 3 should flush in order
    dc.simulateOpen()

    expect(dc.sent).toHaveLength(3)
    expect(JSON.parse(dc.sent[0]).type).toBe(APP_MSG.CONTROL_BOOTSTRAP_SESSION)
    expect(JSON.parse(dc.sent[1]).type).toBe(APP_MSG.CONTROL_DISPATCH_APP_ACTION)
    expect(JSON.parse(dc.sent[2]).type).toBe(APP_MSG.SYNC_UPDATE_STRUCTURE_USAGE)

    bridge.destroy()
  })

  test('client receives messages from server through DataChannel', async () => {
    const { bridge, events } = await createBridge()
    await flushAsync()

    const ws = wsInstances[0]
    const myPeerId = JSON.parse(ws.sent[0]).peerId

    ws.receiveMessage({
      type: 'room-state',
      peers: [myPeerId, 'server-peer'],
      leaderPeerId: 'server-peer',
      epoch: 1,
    })

    await flushAsync()

    // Open DC
    const dc = pcInstances[0].createdChannels[0]
    dc.simulateOpen()

    // Server sends a message through DC
    dc.simulateMessage({
      type: APP_MSG.SESSION_BOOTED,
      session_id: 's1',
      session_key: 'test-room',
      root_node_id: 'root-1',
    })

    expect(events.onRemoteMessage).toHaveBeenCalledTimes(1)
    const received = events.onRemoteMessage.mock.calls[0][0]
    expect(received.type).toBe(APP_MSG.SESSION_BOOTED)

    bridge.destroy()
  })

  test('onBecomeServer fires when this peer is elected leader', async () => {
    const { bridge, events } = await createBridge()
    await flushAsync()

    const ws = wsInstances[0]
    const myPeerId = JSON.parse(ws.sent[0]).peerId

    // This peer is the leader
    ws.receiveMessage({
      type: 'room-state',
      peers: [myPeerId],
      leaderPeerId: myPeerId,
      epoch: 1,
    })

    await flushAsync()

    expect(bridge.role).toBe('server')
    expect(events.onBecomeServer).toHaveBeenCalledTimes(1)
    expect(events.onBecomeClient).not.toHaveBeenCalled()

    bridge.destroy()
  })
})
