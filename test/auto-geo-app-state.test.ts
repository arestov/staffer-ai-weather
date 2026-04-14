import { afterEach, describe, expect, test, vi } from 'vitest'
import { createPageSyncReceiverRuntime } from '../src/page/createPageSyncReceiverRuntime'
import type { ReactSyncTransportMessage } from '../src/shared/messageTypes'
import { createWeatherModelRuntime } from '../src/worker/model-runtime'
import type { LocationSearchResult } from '../src/models/WeatherLocation'

const { detectLocationMock, fetchWeatherFromOpenMeteo } = vi.hoisted(() => ({
  detectLocationMock: vi.fn(async (): Promise<LocationSearchResult> => ({
    id: 'nyc-auto',
    name: 'New York',
    subtitle: 'New York, United States',
    latitude: 40.7128,
    longitude: -74.006,
    timezone: 'America/New_York',
  })),
  fetchWeatherFromOpenMeteo: vi.fn(
    async (latitude: number, longitude: number) => ({
      current: {
        temperatureC: Math.round(latitude),
        apparentTemperatureC: Math.round(latitude) - 1,
        weatherCode: 1,
        isDay: true,
        windSpeed10m: Math.abs(Math.round(longitude)),
      },
      hourly: [],
      daily: [],
      fetchedAt: '2026-04-14T12:00:00.000Z',
    }),
  ),
}))

vi.mock('../src/worker/weather-api', () => ({
  fetchWeatherFromOpenMeteo,
  createWeatherLoaderApi: () => ({
    source_name: 'weatherLoader',
    errors_fields: [],
    loadByCoordinates: ({ latitude, longitude }: { latitude: number; longitude: number }) =>
      fetchWeatherFromOpenMeteo(latitude, longitude),
  }),
}))

vi.mock('../src/worker/geo-location-api', () => ({
  createGeoLocationApi: () => ({
    source_name: 'geoLocation',
    errors_fields: [],
    detectLocation: detectLocationMock,
    detectLocationByCoordinates: detectLocationMock,
  }),
}))

type SerializedModel = {
  nodeId: string | null
  modelName: string | null
  attrs: Record<string, unknown>
  rels: Record<string, unknown>
}

type DebugAppState = {
  lined: SerializedModel[]
  runtimeModels: SerializedModel[]
} | null

type TransportListener<Message> = (message: Message) => void

type AsyncTransport<Message> = {
  send(message: Message, transfer_list?: Transferable[]): void
  listen(listener: TransportListener<Message>): () => void
  destroy(): void
}

const createAsyncTransportBridge = <Message,>() => {
  type State = {
    closing: boolean
    listeners: Set<TransportListener<Message>>
  }

  const createState = (): State => ({
    closing: false,
    listeners: new Set(),
  })

  let inflightToPage = 0
  let inflightToApp = 0

  const finalizeState = (state: State, inflightCount: number) => {
    if (state.closing && inflightCount === 0) {
      state.listeners.clear()
    }
  }

  const createEndpoint = (
    state: State,
    remoteState: State,
    inflightCount: () => number,
    remoteInflightCount: () => number,
    incrementInflight: () => void,
    decrementInflight: () => void,
  ): AsyncTransport<Message> => ({
    send(message: Message) {
      if (state.closing) {
        return
      }

      incrementInflight()
      setTimeout(() => {
        try {
          for (const listener of remoteState.listeners) {
            listener(message)
          }
        } finally {
          decrementInflight()
          finalizeState(state, inflightCount())
          finalizeState(remoteState, remoteInflightCount())
        }
      }, 0)
    },
    listen(listener: TransportListener<Message>) {
      state.listeners.add(listener)
      return () => {
        state.listeners.delete(listener)
        finalizeState(state, inflightCount())
      }
    },
    destroy() {
      state.closing = true
      finalizeState(state, inflightCount())
    },
  })

  const pageState = createState()
  const appState = createState()

  return {
    page: createEndpoint(
      pageState,
      appState,
      () => inflightToPage,
      () => inflightToApp,
      () => {
        inflightToApp += 1
      },
      () => {
        inflightToApp -= 1
      },
    ),
    app: createEndpoint(
      appState,
      pageState,
      () => inflightToApp,
      () => inflightToPage,
      () => {
        inflightToPage += 1
      },
      () => {
        inflightToPage -= 1
      },
    ),
    destroy() {
      pageState.closing = true
      appState.closing = true
      finalizeState(pageState, inflightToPage)
      finalizeState(appState, inflightToApp)
    },
  }
}

const waitFor = async <T,>(
  read: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  message: string,
) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = await read()

    if (predicate(value)) {
      return value
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(message)
}

const findModel = (
  appState: DebugAppState,
  matcher: (model: SerializedModel) => boolean,
) => appState?.runtimeModels.find(matcher) ?? appState?.lined.find(matcher) ?? null

const createWorkerClient = async (
  appRuntime: ReturnType<typeof createWeatherModelRuntime>,
  sessionKey: string,
) => {
  const bridge = createAsyncTransportBridge<ReactSyncTransportMessage>()
  const pageRuntime = createPageSyncReceiverRuntime({ transport: bridge.page })
  const connection = appRuntime.connect(bridge.app)

  pageRuntime.bootstrap({ sessionKey })

  await waitFor(
    () => pageRuntime.getSnapshot(),
    (snapshot) => snapshot.booted && snapshot.ready && snapshot.sessionKey === sessionKey,
    `worker client did not bootstrap for ${sessionKey}`,
  )

  return {
    async destroy() {
      pageRuntime.destroy()
      await connection.destroy()
      bridge.destroy()
    },
  }
}

describe('auto geo app state integration', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  test('updates main selected location from geo api without render', async () => {
    const sessionKey = 'auto-geo'
    const appRuntime = createWeatherModelRuntime()
    const client = await createWorkerClient(appRuntime, sessionKey)

    try {
      const appState = await waitFor(
        async () => (await appRuntime.debugDumpAppState(sessionKey)) as DebugAppState,
        (state) => {
          const appRoot = findModel(
            state,
            (model) => model.modelName === 'weather_app_root' && model.nodeId === 'ROOT',
          )

          return appRoot?.attrs.autoGeoStatus === 'done'
        },
        'auto geo status did not become done',
      )

      const appRoot = findModel(
        appState,
        (model) => model.modelName === 'weather_app_root' && model.nodeId === 'ROOT',
      )

      expect(appRoot).not.toBeNull()
      expect(appRoot?.attrs.autoGeoError).toBeNull()
      expect(detectLocationMock).toHaveBeenCalledTimes(1)

      const mainSelectedLocationId =
        typeof appRoot?.rels.mainLocation === 'string' ? appRoot.rels.mainLocation : null
      expect(mainSelectedLocationId).not.toBeNull()

      const selectedLocation = findModel(
        appState,
        (model) => model.modelName === 'weather_selected_location' && model.nodeId === mainSelectedLocationId,
      )

      expect(selectedLocation).not.toBeNull()
      expect(selectedLocation?.attrs.isAutoSelected).toBe(true)

      const weatherLocationId =
        typeof selectedLocation?.rels.weatherLocation === 'string'
          ? selectedLocation.rels.weatherLocation
          : null
      expect(weatherLocationId).not.toBeNull()

      const weatherLocation = findModel(
        appState,
        (model) => model.modelName === 'weather_location' && model.nodeId === weatherLocationId,
      )

      expect(weatherLocation).not.toBeNull()
      expect(weatherLocation?.attrs.name).toBe('New York')
      expect(weatherLocation?.attrs.latitude).toBe(40.7128)
      expect(weatherLocation?.attrs.longitude).toBe(-74.006)
      expect(weatherLocation?.attrs.timezone).toBe('America/New_York')
    } finally {
      await client.destroy()
    }
  })
})
