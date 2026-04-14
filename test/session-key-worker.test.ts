import { describe, expect, test, vi } from 'vitest'
import { createPageSyncReceiverRuntime } from '../src/page/createPageSyncReceiverRuntime'
import { createWeatherModelRuntime } from '../src/worker/model-runtime'
import type { ReactSyncTransportMessage } from '../src/shared/messageTypes'

const { fetchWeatherFromOpenMeteo } = vi.hoisted(() => ({
  fetchWeatherFromOpenMeteo: vi.fn(
    async (latitude: number, longitude: number) => ({
      current: {
        temperatureC: Math.round(latitude),
        apparentTemperatureC: Math.round(latitude) - 1,
        weatherCode: 1,
        isDay: true,
        windSpeed10m: Math.abs(Math.round(longitude)),
      },
      hourly: [
        {
          time: '2026-04-14T00:00:00Z',
          temperatureC: Math.round(latitude),
          precipitationProbability: 10,
          weatherCode: 1,
          windSpeed10m: 4,
        },
      ],
      daily: [
        {
          date: '2026-04-14',
          weatherCode: 1,
          temperatureMaxC: Math.round(latitude) + 4,
          temperatureMinC: Math.round(latitude) - 2,
          precipitationProbabilityMax: 20,
          windSpeedMax: 6,
          sunrise: '2026-04-14T05:30:00Z',
          sunset: '2026-04-14T18:45:00Z',
        },
      ],
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

type TransportListener<Message> = (message: Message) => void

type AsyncTransport<Message> = {
  send(message: Message, transfer_list?: Transferable[]): void
  listen(listener: TransportListener<Message>): () => void
  destroy(): void
}

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

const appRootScope = {
  kind: 'scope' as const,
  _nodeId: 'ROOT',
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

const getAppRoot = (appState: DebugAppState) => {
  const appRoot = appState?.runtimeModels.find(
    (model) => model.modelName === 'weather_app_root' && model.nodeId === 'ROOT',
  ) ?? appState?.lined.find(
    (model) => model.modelName === 'weather_app_root' && model.nodeId === 'ROOT',
  ) ?? null

  if (!appRoot) {
    throw new Error('weather_app_root not found in debug app state')
  }

  return appRoot
}

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
    bridge,
    connection,
    pageRuntime,
    async destroy() {
      pageRuntime.destroy()
      await connection.destroy()
      bridge.destroy()
    },
  }
}

describe('worker app pool by session key', () => {
  test('isolates app state per session key and supports live rebinding', async () => {
    const appRuntime = createWeatherModelRuntime()
    const alphaClient = await createWorkerClient(appRuntime, 'alpha-user')
    const betaClient = await createWorkerClient(appRuntime, 'beta-user')

    try {
      alphaClient.pageRuntime.dispatchAction('setWeatherLoadState', {
        status: 'error',
        error: 'alpha-only',
      }, appRootScope)

      await waitFor(
        async () => getAppRoot((await appRuntime.debugDumpAppState('alpha-user')) as DebugAppState).attrs.weatherLoadError,
        (value) => value === 'alpha-only',
        'alpha app did not receive the alpha-specific state update',
      )

      expect(
        getAppRoot((await appRuntime.debugDumpAppState('beta-user')) as DebugAppState).attrs.weatherLoadError,
      ).toBe(null)

      betaClient.pageRuntime.dispatchAction('setWeatherLoadState', {
        status: 'error',
        error: 'beta-only',
      }, appRootScope)

      await waitFor(
        async () => getAppRoot((await appRuntime.debugDumpAppState('beta-user')) as DebugAppState).attrs.weatherLoadError,
        (value) => value === 'beta-only',
        'beta app did not receive the beta-specific state update',
      )

      expect(
        getAppRoot((await appRuntime.debugDumpAppState('alpha-user')) as DebugAppState).attrs.weatherLoadError,
      ).toBe('alpha-only')

      alphaClient.pageRuntime.bootstrap({ sessionKey: 'beta-user' })

      await waitFor(
        () => alphaClient.pageRuntime.getSnapshot(),
        (snapshot) => snapshot.booted && snapshot.ready && snapshot.sessionKey === 'beta-user',
        'alpha client did not switch to beta session key',
      )

      alphaClient.pageRuntime.dispatchAction('setWeatherLoadState', {
        status: 'error',
        error: 'beta-after-switch',
      }, appRootScope)

      await waitFor(
        async () => getAppRoot((await appRuntime.debugDumpAppState('beta-user')) as DebugAppState).attrs.weatherLoadError,
        (value) => value === 'beta-after-switch',
        'switched client did not dispatch into the beta app entry',
      )

      expect(
        getAppRoot((await appRuntime.debugDumpAppState('alpha-user')) as DebugAppState).attrs.weatherLoadError,
      ).toBe('alpha-only')
      expect(appRuntime.debugListSessionKeys()).toEqual(['alpha-user', 'beta-user'])
    } finally {
      await alphaClient.destroy()
      await betaClient.destroy()
    }
  })

  test('rebind to a fresh session key clears stale page graph data', async () => {
    const appRuntime = createWeatherModelRuntime()
    const alphaClient = await createWorkerClient(appRuntime, 'alpha-user')

    try {
      const initialGraph = alphaClient.pageRuntime.debugDumpGraph()

      expect(initialGraph.rootNodeId).not.toBe(null)
      expect(initialGraph.nodes.length).toBeGreaterThan(0)

      alphaClient.pageRuntime.bootstrap({ sessionKey: 'fresh-user' })

      const resetGraph = alphaClient.pageRuntime.debugDumpGraph()

      expect(resetGraph.rootNodeId).toBe(null)
      expect(resetGraph.nodes).toHaveLength(0)
      expect(alphaClient.pageRuntime.getSnapshot()).toMatchObject({
        booted: false,
        ready: false,
        rootNodeId: null,
        sessionId: null,
        sessionKey: 'fresh-user',
      })

      await waitFor(
        () => alphaClient.pageRuntime.getSnapshot(),
        (snapshot) => snapshot.booted && snapshot.ready && snapshot.sessionKey === 'fresh-user',
        'client did not switch to the fresh session key',
      )
    } finally {
      await alphaClient.destroy()
    }
  })
})