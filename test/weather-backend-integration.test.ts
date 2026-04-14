import { afterEach, describe, expect, test, vi } from 'vitest'
import { createWeatherTestHarness, type WeatherTestHarness } from './harness/createWeatherTestHarness'
import {
  createWeatherBackendTestHarness,
  type WeatherBackendTestHarness,
} from './harness/createWeatherBackendTestHarness'

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
      hourly: Array.from({ length: 3 }, (_, index) => ({
        time: `2026-04-13T0${index}:00:00Z`,
        temperatureC: Math.round(latitude) + index,
        precipitationProbability: index * 10,
        weatherCode: 1,
        windSpeed10m: 4 + index,
      })),
      daily: Array.from({ length: 3 }, (_, index) => ({
        date: `2026-04-1${index + 3}`,
        weatherCode: 1,
        temperatureMaxC: Math.round(latitude) + 4 + index,
        temperatureMinC: Math.round(latitude) - 2 + index,
        precipitationProbabilityMax: 20 + index,
        windSpeedMax: 6 + index,
        sunrise: '2026-04-13T05:30:00Z',
        sunset: '2026-04-13T18:45:00Z',
      })),
      fetchedAt: '2026-04-13T12:00:00.000Z',
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

const berlinResult = {
  id: '2950159',
  name: 'Berlin',
  subtitle: 'Berlin, Germany',
  latitude: 52.52,
  longitude: 13.405,
  timezone: 'Europe/Berlin',
}

const tokyoResult = {
  id: 'tokyo-1',
  name: 'Tokyo',
  subtitle: 'Tokyo, Japan',
  latitude: 35.6762,
  longitude: 139.6503,
  timezone: 'Asia/Tokyo',
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

const getAppState = async (harness: WeatherTestHarness) => {
  return (await harness.appRuntime.debugDumpAppState()) as DebugAppState
}

const getSerializedModel = (
  appState: DebugAppState,
  matcher: (model: SerializedModel) => boolean,
) => {
  return appState?.runtimeModels.find(matcher) ?? appState?.lined.find(matcher) ?? null
}

const getAppRoot = (appState: DebugAppState) => {
  const appRoot = getSerializedModel(
    appState,
    (model) => model.modelName === 'weather_app_root' && model.nodeId === 'ROOT',
  )

  if (!appRoot) {
    throw new Error('weather_app_root not found in debug app state')
  }

  return appRoot
}

const getPopoverRouter = (appState: DebugAppState) => {
  const router = getSerializedModel(
    appState,
    (model) => model.modelName === 'weather_selected_location_popover_router',
  )

  if (!router) {
    throw new Error('weather_selected_location_popover_router not found in debug app state')
  }

  return router
}

const getSelectedLocationIds = (appState: DebugAppState) => {
  const appRoot = getAppRoot(appState)
  const mainLocationId =
    typeof appRoot.rels.mainLocation === 'string' ? appRoot.rels.mainLocation : null

  if (!mainLocationId) {
    throw new Error('main selected location id is missing')
  }

  return { mainLocationId }
}

const getSavedSearchLocations = (appState: DebugAppState) => {
  const appRoot = getAppRoot(appState)

  return Array.isArray(appRoot.attrs.savedSearchLocations)
    ? appRoot.attrs.savedSearchLocations.filter(
        (value): value is { id: string } => Boolean(value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'),
      )
    : []
}

const clickElement = (element: Element) => {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
}

const waitForWeatherLoaded = async (harness: WeatherTestHarness) => {
  return waitFor(
    async () => getAppState(harness),
    (appState) => {
      const weatherLocations = appState?.runtimeModels.filter(
        (model) => model.modelName === 'weather_location',
      )

      return Boolean(
        weatherLocations?.length &&
          weatherLocations.every(
            (model) => model.attrs.loadStatus === 'ready' && model.attrs.lastError == null,
          ),
      )
    },
    'weather data did not finish loading',
  )
}

const waitForLocationCardsRendered = async (harness: WeatherTestHarness) => {
  return waitFor(
    () => ({
      cardCount: harness.rootElement.querySelectorAll('[data-selected-location-id]').length,
      text: harness.rootElement.textContent ?? '',
    }),
    (domState) =>
      domState.cardCount >= 4 &&
      domState.text.includes('Moscow') &&
      domState.text.includes('Berlin'),
    'selected location cards did not finish rendering',
  )
}

const openMainLocationEditPanel = async (harness: WeatherTestHarness) => {
  await harness.whenReady()
  const readyState = await waitForWeatherLoaded(harness)
  await waitForLocationCardsRendered(harness)

  const { mainLocationId } = getSelectedLocationIds(readyState)
  const trigger = harness.rootElement.querySelector(
    `[data-selected-location-id="${mainLocationId}"] [data-selected-location-trigger]`,
  )

  if (!trigger) {
    throw new Error('selected location trigger not found')
  }

  clickElement(trigger)

  const editTrigger = await waitFor(
    () => document.body.querySelector('[data-location-edit-trigger]'),
    (element) => Boolean(element),
    'location edit trigger did not appear',
  )

  clickElement(editTrigger as Element)

  const router = await waitFor(
    async () => getPopoverRouter(await getAppState(harness)),
    (popoverRouter) => popoverRouter.attrs.isEditingLocation === true,
    'router did not enter edit mode',
  )

  return router
}

describe('Weather backend integration', () => {
  let harness: WeatherTestHarness | null = null
  let backendHarness: WeatherBackendTestHarness | null = null

  afterEach(() => {
    harness?.destroy()
    harness = null
    backendHarness = null
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  test('repeated search goes through backend miss then cache hit', async () => {
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    backendHarness = createWeatherBackendTestHarness({
      searchFixtures: {
        berlin: { results: [berlinResult] },
      },
    })
    vi.stubGlobal('fetch', backendHarness.fetch)
    vi.stubGlobal('__WEATHER_BACKEND_BASE_URL__', backendHarness.baseUrl)

    harness = await createWeatherTestHarness()
    const router = await openMainLocationEditPanel(harness)

    harness.pageRuntime.dispatchAction(
      'submitLocationSearch',
      { query: 'Berlin' },
      { _nodeId: router.nodeId ?? '' } as never,
    )

    await waitFor(
      async () => getPopoverRouter(await getAppState(harness as WeatherTestHarness)),
      (popoverRouter) => {
        const results = Array.isArray(popoverRouter.attrs.searchResults)
          ? popoverRouter.attrs.searchResults
          : []

        return popoverRouter.attrs.searchStatus === 'ready' && results.length === 1
      },
      'first backend search did not return results',
    )

    harness.pageRuntime.dispatchAction(
      'submitLocationSearch',
      { query: '  berlin  ' },
      { _nodeId: router.nodeId ?? '' } as never,
    )

    await waitFor(
      () => ({
        upstreamRequests: backendHarness?.upstreamSearchFetch.mock.calls.length ?? 0,
        cacheRequests: (backendHarness?.fetch.mock.calls ?? []).filter(([input]) => {
          const value = input instanceof Request ? input.url : String(input)
          return value.includes('/api/locations/search')
        }).length,
      }),
      (state) => state.cacheRequests >= 3 && state.upstreamRequests === 1,
      'repeated search did not use the backend cache',
    )

    expect(backendHarness.upstreamSearchFetch).toHaveBeenCalledTimes(1)
  })

  test('no-match backend response keeps the search panel in ready empty state', async () => {
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    backendHarness = createWeatherBackendTestHarness({
      searchFixtures: {
        nomatch: { results: [] },
      },
    })
    vi.stubGlobal('fetch', backendHarness.fetch)
    vi.stubGlobal('__WEATHER_BACKEND_BASE_URL__', backendHarness.baseUrl)

    harness = await createWeatherTestHarness()
    const router = await openMainLocationEditPanel(harness)

    harness.pageRuntime.dispatchAction(
      'submitLocationSearch',
      { query: 'nomatch' },
      { _nodeId: router.nodeId ?? '' } as never,
    )

    const resolvedRouter = await waitFor(
      async () => getPopoverRouter(await getAppState(harness as WeatherTestHarness)),
      (popoverRouter) => popoverRouter.attrs.searchStatus === 'ready',
      'no-match search did not resolve',
    )

    expect(resolvedRouter.attrs.searchResults).toEqual([])
  })

  test('cache lookup errors fall back to direct upstream search', async () => {
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    backendHarness = createWeatherBackendTestHarness({
      cacheLookupFailures: {
        failtown: 503,
      },
      searchFixtures: {
        failtown: { results: [berlinResult] },
      },
    })
    vi.stubGlobal('fetch', backendHarness.fetch)
    vi.stubGlobal('__WEATHER_BACKEND_BASE_URL__', backendHarness.baseUrl)

    harness = await createWeatherTestHarness()
    const router = await openMainLocationEditPanel(harness)

    harness.pageRuntime.dispatchAction(
      'submitLocationSearch',
      { query: 'failtown' },
      { _nodeId: router.nodeId ?? '' } as never,
    )

    const resolvedRouter = await waitFor(
      async () => getPopoverRouter(await getAppState(harness as WeatherTestHarness)),
      (popoverRouter) => {
        const results = Array.isArray(popoverRouter.attrs.searchResults)
          ? popoverRouter.attrs.searchResults
          : []

        return popoverRouter.attrs.searchStatus === 'ready' && results.length === 1
      },
      'cache lookup failure did not fall back to the direct upstream search',
    )

    expect(resolvedRouter.attrs.searchError).toBe(null)
    expect(backendHarness.upstreamSearchFetch).toHaveBeenCalledTimes(1)
  })

  test('search works without a configured weather backend url', async () => {
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    backendHarness = createWeatherBackendTestHarness({
      searchFixtures: {
        berlin: { results: [berlinResult] },
      },
    })
    vi.stubGlobal('fetch', backendHarness.fetch)

    harness = await createWeatherTestHarness()
    const router = await openMainLocationEditPanel(harness)

    harness.pageRuntime.dispatchAction(
      'submitLocationSearch',
      { query: 'Berlin' },
      { _nodeId: router.nodeId ?? '' } as never,
    )

    await waitFor(
      async () => getPopoverRouter(await getAppState(harness as WeatherTestHarness)),
      (popoverRouter) => {
        const results = Array.isArray(popoverRouter.attrs.searchResults)
          ? popoverRouter.attrs.searchResults
          : []

        return popoverRouter.attrs.searchStatus === 'ready' && results.length === 1
      },
      'search without configured weather backend url did not resolve',
    )

    const cacheRequests = backendHarness.fetch.mock.calls.filter(([input]) => {
      const value = input instanceof Request ? input.url : String(input)
      return value.includes('/api/locations/search')
    })

    expect(cacheRequests).toHaveLength(0)
    expect(backendHarness.upstreamSearchFetch).toHaveBeenCalledTimes(1)
  })

  test('saved picks load from the backend during bootstrap', async () => {
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    backendHarness = createWeatherBackendTestHarness()
    await backendHarness.seedSavedPlaces([tokyoResult])
    vi.stubGlobal('fetch', backendHarness.fetch)
    vi.stubGlobal('__WEATHER_BACKEND_BASE_URL__', backendHarness.baseUrl)

    harness = await createWeatherTestHarness()
    await harness.whenReady()
    await waitForWeatherLoaded(harness)

    await waitFor(
      async () => getSavedSearchLocations(await getAppState(harness as WeatherTestHarness)),
      (savedSearchLocations) => savedSearchLocations.some((item) => item.id === tokyoResult.id),
      'saved picks were not loaded from the backend',
    )
  })

  test('saving and removing a picked location persists across reloads', async () => {
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    backendHarness = createWeatherBackendTestHarness({
      searchFixtures: {
        tokyo: { results: [tokyoResult] },
      },
    })
    vi.stubGlobal('fetch', backendHarness.fetch)
    vi.stubGlobal('__WEATHER_BACKEND_BASE_URL__', backendHarness.baseUrl)

    harness = await createWeatherTestHarness()
    const router = await openMainLocationEditPanel(harness)

    harness.pageRuntime.dispatchAction(
      'submitLocationSearch',
      { query: 'Tokyo' },
      { _nodeId: router.nodeId ?? '' } as never,
    )

    await waitFor(
      async () => getPopoverRouter(await getAppState(harness as WeatherTestHarness)),
      (popoverRouter) => {
        const results = Array.isArray(popoverRouter.attrs.searchResults)
          ? popoverRouter.attrs.searchResults
          : []

        return popoverRouter.attrs.searchStatus === 'ready' && results.length === 1
      },
      'Tokyo search response did not resolve',
    )

    harness.pageRuntime.dispatchAction(
      'saveLocationSearchResult',
      tokyoResult,
      { _nodeId: router.nodeId ?? '' } as never,
    )

    await waitFor(
      async () => getSavedSearchLocations(await getAppState(harness as WeatherTestHarness)),
      (savedSearchLocations) => savedSearchLocations.some((item) => item.id === tokyoResult.id),
      'picked location was not saved into app state',
    )

    harness.destroy()
    harness = await createWeatherTestHarness()
    await harness.whenReady()
    await waitForWeatherLoaded(harness)

    await waitFor(
      async () => getSavedSearchLocations(await getAppState(harness as WeatherTestHarness)),
      (savedSearchLocations) => savedSearchLocations.some((item) => item.id === tokyoResult.id),
      'picked location was not reloaded from backend persistence',
    )

    await openMainLocationEditPanel(harness)

    await waitFor(
      () => document.body.querySelector(`[data-location-search-saved-result="${tokyoResult.id}"]`),
      (element) => Boolean(element),
      'saved location did not appear again in the search panel after reload',
    )

    const removeButton = await waitFor(
      () => document.body.querySelector(`[data-location-search-saved-remove="${tokyoResult.id}"]`),
      (element) => Boolean(element),
      'remove button for saved pick did not appear',
    )

    clickElement(removeButton as Element)

    await waitFor(
      async () => getSavedSearchLocations(await getAppState(harness as WeatherTestHarness)),
      (savedSearchLocations) => savedSearchLocations.length === 0,
      'saved pick was not removed from app state',
    )

    harness.destroy()
    harness = await createWeatherTestHarness()
    await harness.whenReady()
    await waitForWeatherLoaded(harness)

    await waitFor(
      async () => getSavedSearchLocations(await getAppState(harness as WeatherTestHarness)),
      (savedSearchLocations) => savedSearchLocations.length === 0,
      'saved pick removal was not persisted to the backend',
    )
  })
})