import { createPortTransport } from '../shared/createPortTransport'
import type { ReactSyncTransportMessage } from '../shared/messageTypes'
import { createWeatherModelRuntime } from './model-runtime'

const runtime = createWeatherModelRuntime()

self.addEventListener('connect', (event: Event) => {
  const connectEvent = event as MessageEvent & { ports: MessagePort[] }
  const port = connectEvent.ports[0]
  if (!port) {
    return
  }

  const transport = createPortTransport<ReactSyncTransportMessage>(port)
  runtime.connect(transport)
})
