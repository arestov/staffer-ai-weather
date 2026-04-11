import { createPageSyncReceiverRuntime } from './createPageSyncReceiverRuntime'
import { createSharedWorkerTransport } from '../shared/createSharedWorkerTransport'

export interface WeatherAppSession {
  sessionId: string | null
  worker: SharedWorker
  runtime: ReturnType<typeof createPageSyncReceiverRuntime>
  store: ReturnType<typeof createPageSyncReceiverRuntime>['store']
  bootstrap(): void
  dispatchAction(actionName: string, payload?: unknown): void
  destroy(): void
}

export const createWeatherAppSession = (): WeatherAppSession => {
  if (typeof SharedWorker !== 'function') {
    throw new Error('SharedWorker is required in this browser')
  }

  const worker = new SharedWorker(
    new URL('../worker/shared-worker.ts', import.meta.url),
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
    worker,
    runtime,
    store: runtime.store,
    bootstrap: runtime.bootstrap,
    dispatchAction: runtime.dispatchAction,
    destroy() {
      runtime.destroy()
    },
  }
}
