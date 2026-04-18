/**
 * Unit tests for BridgeSignaling factories.
 *
 * Tests createDoSignalingFactory with a mocked WebSocket to verify:
 *   - Connection and join message
 *   - room-state handling (member tracking, leader assignment, connected callback)
 *   - leader-changed handling
 *   - Signal relay (offer/answer/ice-candidate)
 *   - sendSignal dispatches correct DO protocol messages
 *   - sendBye / destroy
 *   - Error / close → onError
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SignalMessage } from '../src/p2p/types'

// ── Mock WebSocket ──────────────────────────────────────────────

type WSHandler = (...args: unknown[]) => void

class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3

  readyState = MockWebSocket.OPEN
  sent: string[] = []

  onopen: WSHandler | null = null
  onmessage: WSHandler | null = null
  onerror: WSHandler | null = null
  onclose: WSHandler | null = null

  constructor(public url: string) {
    // Capture for test access
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
  }

  // ─ Test helpers ─
  static instances: MockWebSocket[] = []
  static reset() {
    MockWebSocket.instances = []
  }

  /** Simulate the open event */
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.({} as Event)
  }

  /** Simulate receiving a message */
  simulateMessage(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }

  /** Simulate error */
  simulateError() {
    this.onerror?.({} as Event)
  }

  /** Simulate close */
  simulateClose() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({} as CloseEvent)
  }
}

// ── Setup ───────────────────────────────────────────────────────

let originalWebSocket: typeof globalThis.WebSocket

beforeEach(() => {
  MockWebSocket.reset()
  originalWebSocket = globalThis.WebSocket
  // @ts-expect-error -- mock
  globalThis.WebSocket = MockWebSocket
})

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
})

// ── Tests ───────────────────────────────────────────────────────

describe('createDoSignalingFactory', () => {
  const importFactory = async () => {
    const { createDoSignalingFactory } = await import('../src/p2p/BridgeSignaling')
    return createDoSignalingFactory
  }

  const createEvents = () => ({
    onMemberJoined: vi.fn(),
    onMemberLeft: vi.fn(),
    onSignal: vi.fn(),
    onLeaderAssigned: vi.fn(),
    onConnected: vi.fn(),
    onError: vi.fn(),
  })

  test('opens WebSocket and sends join on connect', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    factory({
      roomId: 'test-room',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    expect(ws).toBeDefined()
    expect(ws.url).toBe('ws://127.0.0.1:8790/api/signal/test-room')

    // Simulate WS open → should send join
    ws.simulateOpen()

    expect(ws.sent).toHaveLength(1)
    const joinMsg = JSON.parse(ws.sent[0])
    expect(joinMsg).toEqual({ type: 'join', roomId: 'test-room', peerId: 'peer-a' })
  })

  test('handles room-state: members, leader, connected', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    factory({
      roomId: 'room-1',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()

    // Server responds with room-state
    ws.simulateMessage({
      type: 'room-state',
      roomId: 'room-1',
      epoch: 1,
      leaderPeerId: 'peer-a',
      peers: ['peer-a', 'peer-b'],
    })

    // peer-b should be added (peer-a is self, excluded)
    expect(events.onMemberJoined).toHaveBeenCalledTimes(1)
    expect(events.onMemberJoined).toHaveBeenCalledWith('peer-b', 0)

    expect(events.onLeaderAssigned).toHaveBeenCalledWith('peer-a', 1)
    expect(events.onConnected).toHaveBeenCalledTimes(1)
  })

  test('handles room-state diff: detects joins and leaves', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    factory({
      roomId: 'room-1',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()

    // Initial room-state: peer-a + peer-b
    ws.simulateMessage({
      type: 'room-state',
      roomId: 'room-1',
      epoch: 1,
      leaderPeerId: 'peer-a',
      peers: ['peer-a', 'peer-b'],
    })

    expect(events.onMemberJoined).toHaveBeenCalledTimes(1)
    events.onMemberJoined.mockClear()

    // Updated room-state: peer-b left, peer-c joined
    ws.simulateMessage({
      type: 'room-state',
      roomId: 'room-1',
      epoch: 1,
      leaderPeerId: 'peer-a',
      peers: ['peer-a', 'peer-c'],
    })

    expect(events.onMemberLeft).toHaveBeenCalledWith('peer-b')
    expect(events.onMemberJoined).toHaveBeenCalledWith('peer-c', 0)
  })

  test('handles leader-changed', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    factory({
      roomId: 'room-1',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()

    ws.simulateMessage({
      type: 'leader-changed',
      epoch: 2,
      leaderPeerId: 'peer-b',
    })

    expect(events.onLeaderAssigned).toHaveBeenCalledWith('peer-b', 2)
  })

  test('relays incoming offer/answer/ice-candidate as SignalMessage', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    factory({
      roomId: 'room-1',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()

    // Simulate relayed offer from peer-b
    ws.simulateMessage({
      type: 'offer',
      from: 'peer-b',
      to: 'peer-a',
      sdp: { type: 'offer', sdp: 'v=0...' },
      ts: 1234567890,
    })

    expect(events.onSignal).toHaveBeenCalledTimes(1)
    const signal = events.onSignal.mock.calls[0][0] as SignalMessage
    expect(signal.kind).toBe('offer')
    expect(signal.fromPeerId).toBe('peer-b')
    expect(signal.toPeerId).toBe('peer-a')
    expect((signal as { sdp: unknown }).sdp).toEqual({ type: 'offer', sdp: 'v=0...' })
  })

  test('ignores signals from self', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    factory({
      roomId: 'room-1',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()

    ws.simulateMessage({
      type: 'offer',
      from: 'peer-a',
      to: 'peer-b',
      sdp: { type: 'offer', sdp: 'v=0...' },
    })

    expect(events.onSignal).not.toHaveBeenCalled()
  })

  test('ignores signals targeted at other peers', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    factory({
      roomId: 'room-1',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()

    ws.simulateMessage({
      type: 'answer',
      from: 'peer-b',
      to: 'peer-c',
      sdp: { type: 'answer', sdp: 'v=0...' },
    })

    expect(events.onSignal).not.toHaveBeenCalled()
  })

  test('sendSignal dispatches offer in DO protocol format', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    const signaling = factory({
      roomId: 'room-1',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()
    ws.sent.length = 0 // clear join message

    signaling.sendSignal({
      kind: 'offer',
      roomId: 'room-1',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      sdp: { type: 'offer', sdp: 'v=0...' } as RTCSessionDescriptionInit,
      ts: 999,
    } as SignalMessage)

    expect(ws.sent).toHaveLength(1)
    const sent = JSON.parse(ws.sent[0])
    expect(sent.type).toBe('offer')
    expect(sent.from).toBe('peer-a')
    expect(sent.to).toBe('peer-b')
    expect(sent.sdp).toEqual({ type: 'offer', sdp: 'v=0...' })
  })

  test('sendSignal dispatches ice-candidate in DO protocol format', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    const signaling = factory({
      roomId: 'room-1',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()
    ws.sent.length = 0

    signaling.sendSignal({
      kind: 'ice-candidate',
      roomId: 'room-1',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      candidate: { candidate: 'candidate:...' } as RTCIceCandidateInit,
      ts: 1000,
    } as SignalMessage)

    expect(ws.sent).toHaveLength(1)
    const sent = JSON.parse(ws.sent[0])
    expect(sent.type).toBe('ice-candidate')
    expect(sent.candidate).toEqual({ candidate: 'candidate:...' })
  })

  test('sendBye sends bye message', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    const signaling = factory({
      roomId: 'room-bye',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()
    ws.sent.length = 0

    signaling.sendBye!()

    expect(ws.sent).toHaveLength(1)
    const sent = JSON.parse(ws.sent[0])
    expect(sent).toEqual({ type: 'bye', roomId: 'room-bye', peerId: 'peer-a' })
  })

  test('destroy closes WebSocket', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    const signaling = factory({
      roomId: 'room-1',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()

    signaling.destroy()

    expect(ws.readyState).toBe(MockWebSocket.CLOSED)
  })

  test('WebSocket error after connected triggers onError', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    factory({
      roomId: 'room-1',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()
    ws.simulateMessage({
      type: 'room-state',
      roomId: 'room-1',
      epoch: 1,
      leaderPeerId: 'peer-a',
      peers: ['peer-a'],
    })

    ws.simulateError()

    expect(events.onError).toHaveBeenCalledTimes(1)
    expect(events.onError.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  test('WebSocket close after connected triggers onError', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    factory({
      roomId: 'room-1',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()
    ws.simulateMessage({
      type: 'room-state',
      roomId: 'room-1',
      epoch: 1,
      leaderPeerId: 'peer-a',
      peers: ['peer-a'],
    })

    ws.simulateClose()

    expect(events.onError).toHaveBeenCalledTimes(1)
  })

  test('WebSocket error before connected retries and eventually fires onError', async () => {
    vi.useFakeTimers()
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    factory({
      roomId: 'room-1',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    // Fail initial + 4 retries = 5 WebSocket instances (error without open)
    for (let i = 0; i < 5; i++) {
      const ws = MockWebSocket.instances[i]
      expect(ws).toBeDefined()
      ws.simulateError()

      if (i < 4) {
        // Advance past retry delay
        await vi.advanceTimersByTimeAsync(300 * 2 ** i + 10)
      }
    }

    expect(events.onError).toHaveBeenCalledTimes(1)
    expect(events.onError.mock.calls[0][0]).toBeInstanceOf(Error)

    vi.useRealTimers()
  })

  test('WebSocket open then close before room-state retries (proxy tunnel scenario)', async () => {
    vi.useFakeTimers()
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    factory({
      roomId: 'room-1',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    // First attempt: WS opens (101) but proxy tunnel breaks → onclose only
    const ws1 = MockWebSocket.instances[0]
    ws1.simulateOpen()
    ws1.simulateClose()

    // Should not have reported error — should schedule retry
    expect(events.onError).not.toHaveBeenCalled()

    // Advance to retry
    await vi.advanceTimersByTimeAsync(310)

    // Second attempt: succeeds
    const ws2 = MockWebSocket.instances[1]
    expect(ws2).toBeDefined()
    ws2.simulateOpen()
    ws2.simulateMessage({
      type: 'room-state',
      roomId: 'room-1',
      epoch: 1,
      leaderPeerId: 'peer-a',
      peers: ['peer-a'],
    })

    expect(events.onConnected).toHaveBeenCalledTimes(1)
    expect(events.onError).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  test('URL construction: appends /api/signal/<roomId> when not present', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    factory({
      roomId: 'my-room',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    expect(ws.url).toBe('ws://127.0.0.1:8790/api/signal/my-room')
  })

  test('URL construction: uses signalUrl as-is when /api/signal/ present', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('wss://backend.example.com/api/signal/pre-room')
    const events = createEvents()

    factory({
      roomId: 'pre-room',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    expect(ws.url).toBe('wss://backend.example.com/api/signal/pre-room')
  })

  test('events not fired after destroy', async () => {
    const createDoSignalingFactory = await importFactory()
    const factory = createDoSignalingFactory('ws://127.0.0.1:8790')
    const events = createEvents()

    const signaling = factory({
      roomId: 'room-1',
      peerId: 'peer-a',
      joinedAt: Date.now(),
      events,
    })

    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()
    signaling.destroy()

    // These should be silently ignored after destroy
    ws.simulateMessage({
      type: 'room-state',
      roomId: 'room-1',
      epoch: 1,
      leaderPeerId: 'peer-a',
      peers: ['peer-a'],
    })

    expect(events.onConnected).not.toHaveBeenCalled()
    expect(events.onLeaderAssigned).not.toHaveBeenCalled()
  })
})
