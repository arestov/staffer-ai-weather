import { createPageSyncReceiverRuntime } from './createPageSyncReceiverRuntime'
import { createSharedWorkerTransport } from '../shared/createSharedWorkerTransport'
import { APP_MSG, type ReactSyncTransportMessage } from '../shared/messageTypes'
import { createPageP2PManager, type PageP2PManager } from '../p2p/PageP2PManager'

export interface WeatherAppSession {
  sessionId: string | null
  sessionKey: string | null
  worker: SharedWorker
  runtime: ReturnType<typeof createPageSyncReceiverRuntime>
  store: ReturnType<typeof createPageSyncReceiverRuntime>['store']
  bootstrap(options?: {
    sessionId?: string | null
    sessionKey?: string | null
    route?: unknown
  }): void
  dispatchAction(actionName: string, payload?: unknown): void
  refreshWeather(): void
  destroy(): void
}

// ── Bridged transport (switchable target with buffering) ────────

type TransportTarget = {
  send(message: ReactSyncTransportMessage, transfer_list?: Transferable[]): void
  listen(listener: (message: ReactSyncTransportMessage) => void): () => void
  destroy(): void
}

const createBridgedTransport = () => {
  const listeners = new Set<(msg: ReactSyncTransportMessage) => void>()
  const buffer: ReactSyncTransportMessage[] = []
  let target: TransportTarget | null = null
  let targetUnlisten: (() => void) | null = null

  return {
    send(message: ReactSyncTransportMessage, _transfer_list?: Transferable[]) {
      if (target) {
        target.send(message)
      } else {
        buffer.push(message)
      }
    },
    listen(listener: (msg: ReactSyncTransportMessage) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    connectTo(t: TransportTarget) {
      targetUnlisten?.()
      target = t
      targetUnlisten = t.listen((msg) => {
        for (const fn of listeners) fn(msg)
      })
      const pending = buffer.splice(0)
      for (const msg of pending) {
        t.send(msg)
      }
    },
    disconnect() {
      targetUnlisten?.()
      targetUnlisten = null
      target = null
    },
    /** Inject a message as if received from the remote side */
    receive(msg: ReactSyncTransportMessage) {
      for (const fn of listeners) fn(msg)
    },
    destroy() {
      targetUnlisten?.()
      targetUnlisten = null
      target = null
      listeners.clear()
      buffer.length = 0
    },
  }
}

// ── Session factory ─────────────────────────────────────────────

export const createWeatherAppSession = (): WeatherAppSession => {
  if (typeof SharedWorker !== 'function') {
    throw new Error('SharedWorker is required in this browser')
  }

  const workerUrl = new URL('../worker/shared-worker.ts', import.meta.url)
  const weatherBackendBaseUrl = typeof import.meta.env.VITE_WEATHER_BACKEND_URL === 'string' &&
    import.meta.env.VITE_WEATHER_BACKEND_URL.trim()
    ? import.meta.env.VITE_WEATHER_BACKEND_URL.trim()
    : null

  if (weatherBackendBaseUrl) {
    workerUrl.searchParams.set('weatherBackendBaseUrl', weatherBackendBaseUrl)
  }

  const p2pSignalUrl = typeof import.meta.env.VITE_P2P_SIGNAL_URL === 'string' &&
    import.meta.env.VITE_P2P_SIGNAL_URL.trim()
    ? import.meta.env.VITE_P2P_SIGNAL_URL.trim()
    : null

  const worker = new SharedWorker(
    workerUrl,
    {
      type: 'module',
      name: 'weather-shared-worker',
    },
  )
  const workerTransport = createSharedWorkerTransport(worker)

  // ── No P2P: simple direct connection (current behavior) ──
  if (!p2pSignalUrl) {
    const runtime = createPageSyncReceiverRuntime({ transport: workerTransport })
    return {
      get sessionId() { return runtime.getSnapshot().sessionId },
      get sessionKey() { return runtime.getSnapshot().sessionKey },
      worker,
      runtime,
      store: runtime.store,
      bootstrap: runtime.bootstrap,
      dispatchAction: runtime.dispatchAction,
      refreshWeather: runtime.refreshWeather,
      destroy() { runtime.destroy() },
    }
  }

  // ── P2P enabled: use bridged transport ────────────────────
  const bridgedTransport = createBridgedTransport()
  const runtime = createPageSyncReceiverRuntime({ transport: bridgedTransport })

  let p2pManager: PageP2PManager | null = null
  let activeP2PSessionKey: string | null = null

  const startP2PForSession = (sessionKey: string) => {
    if (activeP2PSessionKey === sessionKey && p2pManager) return

    bridgedTransport.disconnect()
    p2pManager?.destroy()
    activeP2PSessionKey = sessionKey

    p2pManager = createPageP2PManager(
      {
        sessionKey,
        signalUrl: p2pSignalUrl,
        workerUrl: workerUrl.href,
      },
      {
        onBecomeServer() {
          bridgedTransport.connectTo(workerTransport)
        },
        onBecomeClient(transport) {
          bridgedTransport.connectTo(transport)
        },
        onSessionLost(reason) {
          p2pManager?.destroy()
          p2pManager = null
          activeP2PSessionKey = null
          bridgedTransport.connectTo(workerTransport)
          bridgedTransport.receive({
            type: APP_MSG.P2P_SESSION_LOST,
            reason: reason === 'failover' ? 'failover' : 'server-gone',
          })
        },
        onError(err) {
          console.error('[P2P]', err)
        },
      },
    )
  }

  const wrappedBootstrap = (options?: {
    sessionId?: string | null
    sessionKey?: string | null
    route?: unknown
  }) => {
    const nextSessionKey = options?.sessionKey ?? runtime.getSnapshot().sessionKey ?? null

    if (nextSessionKey) {
      startP2PForSession(nextSessionKey)
    } else {
      p2pManager?.destroy()
      p2pManager = null
      activeP2PSessionKey = null
      bridgedTransport.connectTo(workerTransport)
    }

    runtime.bootstrap(options)
  }

  return {
    get sessionId() { return runtime.getSnapshot().sessionId },
    get sessionKey() { return runtime.getSnapshot().sessionKey },
    worker,
    runtime,
    store: runtime.store,
    bootstrap: wrappedBootstrap,
    dispatchAction: runtime.dispatchAction,
    refreshWeather: runtime.refreshWeather,
    destroy() {
      p2pManager?.destroy()
      p2pManager = null
      activeP2PSessionKey = null
      runtime.destroy()
    },
  }
}
