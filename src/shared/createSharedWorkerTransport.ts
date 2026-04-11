import { createPortTransport } from './createPortTransport'

export const createSharedWorkerTransport = (worker: SharedWorker) => {
  if (!worker?.port) {
    throw new Error('shared worker port is required')
  }

  return createPortTransport(worker.port)
}
