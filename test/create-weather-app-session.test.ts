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

    const scheduledTimers: Array<{ active: boolean; callback: () => void }> = []
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((handler: TimerHandler, _timeout?: number, ...args: unknown[]) => {
        const timer = {
          active: true,
          callback: () => {
            if (!timer.active) {
              return
            }

            if (typeof handler === 'function') {
              handler(...args)
            }
          },
        }

        scheduledTimers.push(timer)
        return timer as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout)
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation((handle) => {
      const timer = scheduledTimers.find((entry) => entry === handle)
      if (timer) {
        timer.active = false
      }
    })

    try {
      const { createWeatherAppSession } = await import('../src/page/createWeatherAppSession')
      const session = createWeatherAppSession()

      session.bootstrap({ sessionKey: 'room-1', sessionId: 'session-1' })

      expect(session.p2pStatus).toBe('undecided')
      expect(mockState.sharedWorkerTransport.sent).toHaveLength(0)

      expect(scheduledTimers).toHaveLength(1)
      scheduledTimers[0]?.callback()

      expect(session.p2pStatus).toBe('disabled')
      expect(mockState.sharedWorkerTransport.sent).toHaveLength(1)
      expect(mockState.sharedWorkerTransport.sent[0]).toEqual({
        type: APP_MSG.CONTROL_BOOTSTRAP_SESSION,
        session_key: 'room-1',
      })
      expect(mockState.createWeatherAppP2PManager).toHaveBeenCalledTimes(1)

      session.destroy()
    } finally {
      setTimeoutSpy.mockRestore()
      clearTimeoutSpy.mockRestore()
      vi.useRealTimers()
    }
  })
})