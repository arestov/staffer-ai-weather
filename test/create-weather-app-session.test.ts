import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ReactSyncTransportMessage } from '../src/shared/messageTypes'
import { APP_MSG } from '../src/shared/messageTypes'

const mockState = vi.hoisted(() => ({
  sharedWorkerTransport: {
    sent: [] as ReactSyncTransportMessage[],
    listeners: new Set<(message: ReactSyncTransportMessage) => void>(),
    send(message: ReactSyncTransportMessage) {
      this.sent.push(message)
      for (const listener of this.listeners) {
        listener(message)
      }
    },
    listen(listener: (message: ReactSyncTransportMessage) => void) {
      this.listeners.add(listener)
      return () => {
        this.listeners.delete(listener)
      }
    },
    destroy() {
      this.listeners.clear()
    },
  },
  createWeatherAppP2PManager: vi.fn(),
  createPageSyncReceiverRuntime({ transport }: { transport: { send(message: ReactSyncTransportMessage): void } }) {
    const snapshot = {
      booted: false,
      ready: false,
      version: 0,
      rootNodeId: null as string | null,
      sessionId: null as string | null,
      sessionKey: null as string | null,
    }

    return {
      store: {
        subscribe: vi.fn(),
        getSnapshot: () => snapshot,
      },
      bootstrap(options?: { sessionId?: string | null; sessionKey?: string | null }) {
        snapshot.sessionId = options?.sessionId ?? snapshot.sessionId
        snapshot.sessionKey = options?.sessionKey ?? snapshot.sessionKey
        transport.send({
          type: APP_MSG.CONTROL_BOOTSTRAP_SESSION,
          session_key: snapshot.sessionKey,
        } as ReactSyncTransportMessage)
      },
      dispatchAction: vi.fn(),
      getSnapshot: () => snapshot,
      destroy: vi.fn(),
    }
  },
}))

vi.mock('../src/p2p/PageP2PManager', () => ({
  createPageP2PManager: mockState.createWeatherAppP2PManager,
}))

vi.mock('../src/page/createPageSyncReceiverRuntime', () => ({
  createPageSyncReceiverRuntime: mockState.createPageSyncReceiverRuntime,
}))

vi.mock('../src/shared/createSharedWorkerTransport', () => ({
  createSharedWorkerTransport: () => mockState.sharedWorkerTransport,
}))

class MockSharedWorker {
  port = {}
  constructor(public url: string | URL, public options?: unknown) {}
}

vi.stubGlobal('SharedWorker', MockSharedWorker)

mockState.createWeatherAppP2PManager.mockImplementation(() => ({
  destroy: vi.fn(),
}))

describe('createWeatherAppSession', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    mockState.sharedWorkerTransport.sent.length = 0
    mockState.sharedWorkerTransport.listeners.clear()
  })

  test('falls back to worker-only when P2P startup never becomes healthy', async () => {
    vi.stubEnv('VITE_P2P_SIGNAL_URL', 'ws://example.invalid/signal')

    // Capture the events callbacks passed to createPageP2PManager
    let capturedEvents: Record<string, (...args: unknown[]) => void> = {}
    mockState.createWeatherAppP2PManager.mockImplementation(
      (_config: unknown, events: Record<string, (...args: unknown[]) => void>) => {
        capturedEvents = events
        return { destroy: vi.fn() }
      },
    )

    const { createWeatherAppSession } = await import('../src/page/createWeatherAppSession')
    const session = createWeatherAppSession()

    session.bootstrap({ sessionKey: 'room-1', sessionId: 'session-1' })

    expect(session.p2pStatus).toBe('undecided')
    // Only the warm-up message should have been sent (not the bootstrap)
    expect(mockState.sharedWorkerTransport.sent).toHaveLength(1)
    expect(mockState.sharedWorkerTransport.sent[0]).toEqual({
      type: APP_MSG.CONTROL_WARM_APP,
      session_key: 'room-1',
    })

    // Simulate P2P signaling failure (e.g. retries exhausted)
    capturedEvents.onError(new Error('WebSocket signaling error'))

    expect(session.p2pStatus).toBe('disabled')
    // Bridge flushed the buffered bootstrap message to workerTransport
    expect(mockState.sharedWorkerTransport.sent).toHaveLength(2)
    expect(mockState.sharedWorkerTransport.sent[1]).toEqual({
      type: APP_MSG.CONTROL_BOOTSTRAP_SESSION,
      session_key: 'room-1',
    })
    expect(mockState.createWeatherAppP2PManager).toHaveBeenCalledTimes(1)

    session.destroy()
  })
})