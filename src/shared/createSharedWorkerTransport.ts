import { createPortTransport } from './createPortTransport'
import type { ReactSyncTransportMessage } from './messageTypes'

export const createSharedWorkerTransport = (worker: SharedWorker) => {
  if (!worker?.port) {
    throw new Error('shared worker port is required')
  }

  return createPortTransport<ReactSyncTransportMessage>(worker.port)
}
