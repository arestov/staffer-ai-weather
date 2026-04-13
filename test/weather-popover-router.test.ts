import { afterEach, describe, expect, test, vi } from 'vitest'
import { createWeatherTestHarness, type WeatherTestHarness } from './harness/createWeatherTestHarness'

const { fetchWeatherFromOpenMeteo, fetchLocationSearchResults } = vi.hoisted(() => ({
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
  fetchLocationSearchResults: vi.fn(async (query: string) => {
    const normalized = query.trim().toLowerCase()

    if (!normalized) {
      return []
    }

    if (normalized.includes('tokyo')) {
      return [
        {
          id: 'tokyo-1',
          name: 'Tokyo',
          subtitle: 'Tokyo, Japan',
          latitude: 35.6762,
          longitude: 139.6503,
          timezone: 'Asia/Tokyo',
        },
      ]
    }

    if (normalized.includes('moscow')) {
      return [
        {
          id: 'moscow-1',
          name: 'Moscow',
          subtitle: 'Moscow, Russia',
          latitude: 55.7558,
          longitude: 37.6173,
          timezone: 'Europe/Moscow',
        },
      ]
    }

    return [
      {
        id: `${normalized}-fallback`,
        name: query.trim(),
        subtitle: 'Fallback match',
        latitude: 48.8566,
        longitude: 2.3522,
        timezone: 'Europe/Paris',
      },
    ]
  }),
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

vi.mock('../src/worker/location-search-api', () => ({
  fetchLocationSearchResults,
  createLocationSearchApi: () => ({
    source_name: 'locationSearch',
    errors_fields: [],
    search: fetchLocationSearchResults,
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

const getRouterCurrentModelId = (appState: DebugAppState) => {
  const router = getSerializedModel(
    appState,
    (model) => model.modelName === 'weather_selected_location_popover_router',
  )

  return typeof router?.rels.current_mp_md === 'string' ? router.rels.current_mp_md : null
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
  const additionalLocationIds = Array.isArray(appRoot.rels.additionalLocations)
    ? appRoot.rels.additionalLocations.filter(
        (value): value is string => typeof value === 'string',
      )
    : []

  if (!mainLocationId) {
    throw new Error('main selected location id is missing')
  }

  return {
    mainLocationId,
    additionalLocationIds,
  }
}

const clickElement = (element: Element) => {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
}

const countWeatherLocationModels = (appState: DebugAppState) => {
  return appState?.runtimeModels.filter(
    (model) => model.modelName === 'weather_location',
  ).length ?? 0
}

const getWeatherLocationForSelectedLocation = (
  appState: DebugAppState,
  selectedLocationId: string,
) => {
  const selectedLocation = getSerializedModel(
    appState,
    (model) => model.nodeId === selectedLocationId,
  )
  const weatherLocationId =
    typeof selectedLocation?.rels.weatherLocation === 'string'
      ? selectedLocation.rels.weatherLocation
      : null

  if (!weatherLocationId) {
    return null
  }

  return getSerializedModel(
    appState,
    (model) => model.nodeId === weatherLocationId,
  )
}

const queryPopover = (selectedLocationId: string) =>
  document.body.querySelector(
    `[data-selected-location-popover][data-popover-for="${selectedLocationId}"]`,
  )

const queryPopoverLayer = () =>
  document.body.querySelector('[data-selected-location-popover-layer]')

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

describe('SelectedLocation popover router', () => {
  let harness: WeatherTestHarness | null = null

  afterEach(() => {
    harness?.destroy()
    harness = null
    vi.restoreAllMocks()
  })

  test('smoke: app boots and weather loads', async () => {
    harness = await createWeatherTestHarness()

    await harness.whenReady()
    const appState = await waitForWeatherLoaded(harness)
    await waitForLocationCardsRendered(harness)

    expect(fetchWeatherFromOpenMeteo).toHaveBeenCalledTimes(4)
    expect(
      appState?.runtimeModels
        .filter((model) => model.modelName === 'weather_location')
        .map((model) => model.attrs.loadStatus),
    ).toEqual(['ready', 'ready', 'ready', 'ready'])
    expect(harness.rootElement.textContent).toContain('Moscow')
  })

  test('featured location opens and closes the popover router', async () => {
    harness = await createWeatherTestHarness()
    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    await harness.whenReady()
    const readyState = await waitForWeatherLoaded(harness)
    await waitForLocationCardsRendered(harness)
    const { mainLocationId } = getSelectedLocationIds(readyState)
    const trigger = harness.rootElement.querySelector(
      `[data-selected-location-id="${mainLocationId}"] [data-selected-location-trigger]`,
    )

    expect(trigger).not.toBeNull()

    clickElement(trigger as Element)

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => getRouterCurrentModelId(appState) === mainLocationId,
      'featured location did not become current popover router model',
    )

    await waitFor(
      () => scrollBySpy.mock.calls.length,
      (callCount) => callCount >= 1,
      'featured location did not trigger auto-scroll',
    )

    expect(scrollBySpy.mock.lastCall?.[0]).toMatchObject({ behavior: 'smooth' })

    const popover = await waitFor(
      () => queryPopover(mainLocationId),
      (element) => Boolean(element),
      'featured location popover did not appear in the DOM',
    )

    expect(popover?.textContent).toContain('Edit location')

    const closeButton = popover?.querySelector('[data-popover-close]')
    expect(closeButton).not.toBeNull()

    clickElement(closeButton as Element)

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => getRouterCurrentModelId(appState) == null,
      'featured location popover router did not clear current model on close',
    )

    await waitFor(
      () => queryPopover(mainLocationId),
      (element) => element == null,
      'featured location popover did not disappear from the DOM',
    )
  })

  test('additional location opens and closes the popover router', async () => {
    harness = await createWeatherTestHarness()
    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    await harness.whenReady()
    const readyState = await waitForWeatherLoaded(harness)
    await waitForLocationCardsRendered(harness)
    const { additionalLocationIds } = getSelectedLocationIds(readyState)
    const additionalLocationId = additionalLocationIds[0]

    expect(additionalLocationId).toBeTruthy()

    const trigger = harness.rootElement.querySelector(
      `[data-selected-location-id="${additionalLocationId}"] [data-selected-location-trigger]`,
    )

    expect(trigger).not.toBeNull()

    clickElement(trigger as Element)

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => getRouterCurrentModelId(appState) === additionalLocationId,
      'additional location did not become current popover router model',
    )

    await waitFor(
      () => scrollBySpy.mock.calls.length,
      (callCount) => callCount >= 1,
      'additional location did not trigger auto-scroll',
    )

    expect(scrollBySpy.mock.lastCall?.[0]).toMatchObject({ behavior: 'smooth' })

    const popover = await waitFor(
      () => queryPopover(additionalLocationId),
      (element) => Boolean(element),
      'additional location popover did not appear in the DOM',
    )

    expect(popover?.textContent).toContain('Edit location')

    const closeButton = popover?.querySelector('[data-popover-close]')
    expect(closeButton).not.toBeNull()

    clickElement(closeButton as Element)

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => getRouterCurrentModelId(appState) == null,
      'additional location popover router did not clear current model on close',
    )

    await waitFor(
      () => queryPopover(additionalLocationId),
      (element) => element == null,
      'additional location popover did not disappear from the DOM',
    )
  })

  test('switching selected location reuses one floating layer', async () => {
    harness = await createWeatherTestHarness()
    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    await harness.whenReady()
    const readyState = await waitForWeatherLoaded(harness)
    await waitForLocationCardsRendered(harness)
    const { mainLocationId, additionalLocationIds } = getSelectedLocationIds(readyState)
    const additionalLocationId = additionalLocationIds[0]

    const featuredTrigger = harness.rootElement.querySelector(
      `[data-selected-location-id="${mainLocationId}"] [data-selected-location-trigger]`,
    )
    const additionalTrigger = harness.rootElement.querySelector(
      `[data-selected-location-id="${additionalLocationId}"] [data-selected-location-trigger]`,
    )

    expect(featuredTrigger).not.toBeNull()
    expect(additionalTrigger).not.toBeNull()

    clickElement(featuredTrigger as Element)

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => getRouterCurrentModelId(appState) === mainLocationId,
      'featured location did not become current router model before switch',
    )

    const firstLayer = await waitFor(
      () => queryPopoverLayer(),
      (element) => Boolean(element),
      'floating popover layer did not appear for featured location',
    )

    clickElement(additionalTrigger as Element)

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => getRouterCurrentModelId(appState) === additionalLocationId,
      'additional location did not become current router model after switch',
    )

    await waitFor(
      () => scrollBySpy.mock.calls.length,
      (callCount) => callCount >= 2,
      'switching locations did not trigger a second auto-scroll',
    )

    expect(scrollBySpy.mock.lastCall?.[0]).toMatchObject({ behavior: 'smooth' })

    const secondLayer = await waitFor(
      () => queryPopoverLayer(),
      (element) => Boolean(element),
      'floating popover layer disappeared after switch',
    )

    await waitFor(
      () => ({
        current: queryPopover(additionalLocationId),
        previous: queryPopover(mainLocationId),
      }),
      (state) => Boolean(state.current) && state.previous == null,
      'floating popover content did not switch to the additional location',
    )

    expect(secondLayer).toBe(firstLayer)
    expect(queryPopover(mainLocationId)).toBeNull()
    expect(queryPopover(additionalLocationId)?.textContent).toContain('Edit location')
  })

  test('router search replaces selected location in place', async () => {
    harness = await createWeatherTestHarness()
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    await harness.whenReady()
    const readyState = await waitForWeatherLoaded(harness)
    await waitForLocationCardsRendered(harness)
    const { mainLocationId } = getSelectedLocationIds(readyState)
    const initialWeatherLocationCount = countWeatherLocationModels(readyState)
    const trigger = harness.rootElement.querySelector(
      `[data-selected-location-id="${mainLocationId}"] [data-selected-location-trigger]`,
    )

    expect(trigger).not.toBeNull()

    clickElement(trigger as Element)

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => getRouterCurrentModelId(appState) === mainLocationId,
      'featured location did not become current popover router model before search edit',
    )

    const popover = await waitFor(
      () => queryPopover(mainLocationId),
      (element) => Boolean(element),
      'selected location popover did not appear before search edit',
    )

    await waitFor(
      () => queryPopover(mainLocationId)?.textContent ?? '',
      (text) => text.includes('Moscow'),
      'selected location popover did not hydrate the current location before edit',
    )

    const editButton = popover?.querySelector('[data-location-edit-trigger]')
    expect(editButton).not.toBeNull()

    clickElement(editButton as Element)

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => {
        const router = getPopoverRouter(appState)
        return router.attrs.isEditingLocation === true
      },
      'router did not enter edit mode',
    )

    const routerModel = getPopoverRouter(await getAppState(harness))

    harness.pageRuntime.dispatchAction(
      'submitLocationSearch',
      { query: 'Tokyo' },
      { _nodeId: routerModel.nodeId ?? '' } as never,
    )

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => {
        const router = getPopoverRouter(appState)
        const results = Array.isArray(router.attrs.searchResults)
          ? router.attrs.searchResults
          : []

        return (
          router.attrs.searchStatus === 'ready' &&
          results.some(
            (result) =>
              typeof result === 'object' &&
              result != null &&
              'name' in result &&
              (result as { name?: unknown }).name === 'Tokyo',
          )
        )
      },
      'router did not update search results for Tokyo',
    )

    const weatherLocationCountBeforeSelection = countWeatherLocationModels(
      await getAppState(harness),
    )
    expect(weatherLocationCountBeforeSelection).toBe(initialWeatherLocationCount)

    const tokyoResult = await waitFor(
      () => queryPopover(mainLocationId)?.querySelector('[data-location-search-result="tokyo-1"]'),
      (element) => Boolean(element),
      'Tokyo search result did not appear in the popover',
    )

    clickElement(tokyoResult as Element)

    const replacedState = await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => {
        const router = getPopoverRouter(appState)
        const weatherLocation = getWeatherLocationForSelectedLocation(appState, mainLocationId)

        return Boolean(
          router.attrs.isEditingLocation === false &&
            router.attrs.searchStatus === 'idle' &&
            Array.isArray(router.attrs.searchResults) &&
            router.attrs.searchResults.length === 0 &&
            weatherLocation?.attrs.name === 'Tokyo' &&
            weatherLocation?.attrs.loadStatus === 'ready',
        )
      },
      'selected location was not replaced with Tokyo and reloaded',
    )

    const replacedWeatherLocation = getWeatherLocationForSelectedLocation(
      replacedState,
      mainLocationId,
    )

    expect(replacedWeatherLocation?.attrs.name).toBe('Tokyo')
    expect(replacedWeatherLocation?.attrs.timezone).toBe('Asia/Tokyo')
    expect(replacedWeatherLocation?.attrs.loadStatus).toBe('ready')
    expect(countWeatherLocationModels(replacedState)).toBe(initialWeatherLocationCount)
    expect(fetchWeatherFromOpenMeteo).toHaveBeenCalledWith(35.6762, 139.6503)
    expect(queryPopover(mainLocationId)?.textContent).toContain('Tokyo')

    await waitFor(
      () => queryPopover(mainLocationId)?.querySelector('[data-location-search-panel]'),
      (element) => element == null,
      'search panel did not close after selecting a replacement location',
    )
  })
})