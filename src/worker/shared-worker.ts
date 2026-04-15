import { createPortTransport } from '../shared/createPortTransport'
import type { ReactSyncTransportMessage } from '../shared/messageTypes'
import { createWeatherModelRuntime } from './model-runtime'

const readSearchParam = (name: string) => {
  const href = typeof self.location?.href === 'string' ? self.location.href : ''
  if (!href) return null
  const value = new URL(href).searchParams.get(name)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const weatherBackendBaseUrl = readSearchParam('weatherBackendBaseUrl')
const p2pSignalUrl = readSearchParam('p2pSignalUrl')
const pusherKey = readSearchParam('pusherKey')
const pusherCluster = readSearchParam('pusherCluster')

const runtime = createWeatherModelRuntime({
  weatherBackendBaseUrl,
  p2pSignalUrl,
  pusherKey,
  pusherCluster,
})

self.addEventListener('connect', (event: Event) => {
  const connectEvent = event as MessageEvent & { ports: MessagePort[] }
  const port = connectEvent.ports[0]
  if (!port) {
    return
  }

  const transport = createPortTransport<ReactSyncTransportMessage>(port)
  runtime.connect(transport)
})
