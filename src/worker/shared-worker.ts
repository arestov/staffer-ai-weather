import { createPortTransport } from '../shared/createPortTransport'
import type { ReactSyncTransportMessage } from '../shared/messageTypes'
import { createWeatherModelRuntime } from './model-runtime'

const weatherBackendBaseUrl = (() => {
  const href = typeof self.location?.href === 'string' ? self.location.href : ''
  if (!href) {
    return null
  }

  const value = new URL(href).searchParams.get('weatherBackendBaseUrl')
  return typeof value === 'string' && value.trim() ? value.trim() : null
})()

const runtime = createWeatherModelRuntime({ weatherBackendBaseUrl })

self.addEventListener('connect', (event: Event) => {
  const connectEvent = event as MessageEvent & { ports: MessagePort[] }
  const port = connectEvent.ports[0]
  if (!port) {
    return
  }

  const transport = createPortTransport<ReactSyncTransportMessage>(port)
  runtime.connect(transport)
})
