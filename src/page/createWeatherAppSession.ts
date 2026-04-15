import { createPageSyncReceiverRuntime } from './createPageSyncReceiverRuntime'
import { createSharedWorkerTransport } from '../shared/createSharedWorkerTransport'

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

  if (p2pSignalUrl) {
    workerUrl.searchParams.set('p2pSignalUrl', p2pSignalUrl)
  }

  const worker = new SharedWorker(
    workerUrl,
    {
      type: 'module',
      name: 'weather-shared-worker',
    },
  )
  const transport = createSharedWorkerTransport(worker)
  const runtime = createPageSyncReceiverRuntime({ transport })

  return {
    get sessionId() {
      return runtime.getSnapshot().sessionId
    },
    get sessionKey() {
      return runtime.getSnapshot().sessionKey
    },
    worker,
    runtime,
    store: runtime.store,
    bootstrap: runtime.bootstrap,
    dispatchAction: runtime.dispatchAction,
    refreshWeather: runtime.refreshWeather,
    destroy() {
      runtime.destroy()
    },
  }
}
