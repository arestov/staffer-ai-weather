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

const getSavedSearchLocations = (appState: DebugAppState) => {
  const appRoot = getAppRoot(appState)

  return Array.isArray(appRoot.attrs.savedSearchLocations)
    ? appRoot.attrs.savedSearchLocations.filter(
        (value): value is {
          id: string
          name: string
          subtitle: string
          latitude: number
          longitude: number
          timezone: string | null
        } => Boolean(value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'),
      )
    : []
}

const clickElement = (element: Element) => {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
}

const setInputValue = (element: HTMLInputElement, value: string) => {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set

  valueSetter?.call(element, value)
  element.dispatchEvent(new window.Event('input', { bubbles: true }))
  element.dispatchEvent(new window.Event('change', { bubbles: true }))
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

const waitForMainWeatherLoadError = async (
  harness: WeatherTestHarness,
  mainLocationId: string,
  errorMessage: string,
) => {
  return waitFor(
    async () => getAppState(harness),
    (appState) => {
      const weatherLocation = getWeatherLocationForSelectedLocation(appState, mainLocationId)

      return (
        weatherLocation?.attrs.loadStatus === 'error' &&
        weatherLocation?.attrs.lastError === errorMessage
      )
    },
    'main weather location did not surface the startup error',
  )
}

const createWeatherPayload = (temperatureC: number, fetchedAt: string) => ({
  current: {
    temperatureC,
    apparentTemperatureC: temperatureC - 1,
    weatherCode: 1,
    isDay: true,
    windSpeed10m: 4,
  },
  hourly: [
    {
      time: '2026-04-13T00:00:00Z',
      temperatureC,
      precipitationProbability: 0,
      weatherCode: 1,
      windSpeed10m: 4,
    },
  ],
  daily: [
    {
      date: '2026-04-13',
      weatherCode: 1,
      temperatureMaxC: temperatureC + 4,
      temperatureMinC: temperatureC - 2,
      precipitationProbabilityMax: 20,
      windSpeedMax: 6,
      sunrise: '2026-04-13T05:30:00Z',
      sunset: '2026-04-13T18:45:00Z',
    },
  ],
  fetchedAt,
})

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void

  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
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

    expect(popover?.querySelector('[data-location-edit-trigger]')).not.toBeNull()

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

    expect(popover?.querySelector('[data-location-edit-trigger]')).not.toBeNull()

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

  test('selected search results are saved and removable in the sidebar', async () => {
    harness = await createWeatherTestHarness()

    await harness.whenReady()
    const readyState = await waitForWeatherLoaded(harness)
    await waitForLocationCardsRendered(harness)
    const { mainLocationId } = getSelectedLocationIds(readyState)

    const trigger = harness.rootElement.querySelector(
      `[data-selected-location-id="${mainLocationId}"] [data-selected-location-trigger]`,
    )

    expect(trigger).not.toBeNull()

    clickElement(trigger as Element)

    const editTrigger = await waitFor(
      () => document.body.querySelector('[data-location-edit-trigger]'),
      (element) => Boolean(element),
      'location edit trigger did not appear',
    )

    clickElement(editTrigger as Element)

    const searchInput = await waitFor(
      () => document.body.querySelector('[data-location-search-input]') as HTMLInputElement | null,
      (element) => Boolean(element),
      'search input did not appear',
    )

    setInputValue(searchInput as HTMLInputElement, 'Tokyo')

    const searchResult = await waitFor(
      () => document.body.querySelector('[data-location-search-result="tokyo-1"]'),
      (element) => Boolean(element),
      'Tokyo search result did not appear',
    )

    clickElement(searchResult as Element)

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => getSavedSearchLocations(appState).some((item) => item.id === 'tokyo-1'),
      'selected search result was not saved into the app root list',
    )

    const reopenEditTrigger = await waitFor(
      () => document.body.querySelector('[data-location-edit-trigger]'),
      (element) => Boolean(element),
      'edit trigger did not return after saving a result',
    )

    clickElement(reopenEditTrigger as Element)

    const savedResult = await waitFor(
      () => document.body.querySelector('[data-location-search-saved-result="tokyo-1"]'),
      (element) => Boolean(element),
      'saved search result did not appear in the sidebar',
    )

    expect(savedResult?.textContent).toContain('Tokyo')

    const removeButton = document.body.querySelector('[data-location-search-saved-remove="tokyo-1"]')
    expect(removeButton).not.toBeNull()

    clickElement(removeButton as Element)

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => getSavedSearchLocations(appState).length === 0,
      'saved search result was not removed from the app root list',
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
    expect(queryPopover(additionalLocationId)?.querySelector('[data-location-edit-trigger]')).not.toBeNull()
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

  test('location search debounces typing and keeps prior results until the new response arrives', async () => {
    harness = await createWeatherTestHarness()
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

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
      'featured location did not become current popover router model before debounced search',
    )

    const popover = await waitFor(
      () => queryPopover(mainLocationId),
      (element) => Boolean(element),
      'selected location popover did not appear before debounced search',
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
      'router did not enter edit mode for debounced search',
    )

    const input = await waitFor(
      () => queryPopover(mainLocationId)?.querySelector('[data-location-search-input]'),
      (element) => element instanceof HTMLInputElement,
      'search input did not appear for debounced search',
    )

    setInputValue(input as HTMLInputElement, 'Tokyo')

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => {
        const router = getPopoverRouter(appState)
        const results = Array.isArray(router.attrs.searchResults)
          ? router.attrs.searchResults
          : []

        return (
          results.some(
            (result) =>
              typeof result === 'object' &&
              result != null &&
              'name' in result &&
              (result as { name?: unknown }).name === 'Tokyo',
          )
        )
      },
      'initial debounced search did not return Tokyo',
    )

    fetchLocationSearchResults.mockImplementationOnce(async (query: string) => {
      await new Promise((resolve) => setTimeout(resolve, 100))

      return [
        {
          id: `${query.trim().toLowerCase()}-delayed`,
          name: query.trim(),
          subtitle: 'Delayed match',
          latitude: 45.5152,
          longitude: -122.6784,
          timezone: 'America/Los_Angeles',
        },
      ]
    })

    setInputValue(input as HTMLInputElement, 'Portland')

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => {
        const router = getPopoverRouter(appState)
        const results = Array.isArray(router.attrs.searchResults)
          ? router.attrs.searchResults
          : []

        return (
          router.attrs.searchStatus === 'loading' &&
          results.some(
            (result) =>
              typeof result === 'object' &&
              result != null &&
              'name' in result &&
              (result as { name?: unknown }).name === 'Tokyo',
          )
        )
      },
      'previous results were cleared before the delayed Portland response arrived',
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
              (result as { name?: unknown }).name === 'Portland',
          )
        )
      },
      'debounced search did not update to Portland',
    )
  })

  test('startup weather error shows a retry button and recovers on refresh', async () => {
    harness = await createWeatherTestHarness()
    const startupError = new Error('weather offline')

    fetchWeatherFromOpenMeteo.mockImplementationOnce(async () => {
      throw startupError
    })

    await harness.whenReady()
    const readyState = await getAppState(harness)
    const { mainLocationId } = getSelectedLocationIds(readyState)

    await waitForMainWeatherLoadError(harness, mainLocationId, startupError.message)

    const retryButton = await waitFor(
      () => document.body.querySelector('[data-weather-retry]'),
      (element) => Boolean(element),
      'weather retry button did not appear for the startup error',
    )

    clickElement(retryButton as Element)

    const recoveredState = await waitForWeatherLoaded(harness)
    const recoveredWeather = getWeatherLocationForSelectedLocation(recoveredState, mainLocationId)

    expect(recoveredWeather?.attrs.loadStatus).toBe('ready')
    expect(recoveredWeather?.attrs.lastError).toBeNull()
  })

  test('search error shows a retry button and retries the current query', async () => {
    harness = await createWeatherTestHarness()
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    await harness.whenReady()
    const readyState = await waitForWeatherLoaded(harness)
    await waitForLocationCardsRendered(harness)
    const { mainLocationId } = getSelectedLocationIds(readyState)

    const trigger = harness.rootElement.querySelector(
      `[data-selected-location-id="${mainLocationId}"] [data-selected-location-trigger]`,
    )

    expect(trigger).not.toBeNull()

    clickElement(trigger as Element)

    const editTrigger = await waitFor(
      () => document.body.querySelector('[data-location-edit-trigger]'),
      (element) => Boolean(element),
      'location edit trigger did not appear for the search retry test',
    )

    clickElement(editTrigger as Element)

    fetchLocationSearchResults.mockRejectedValueOnce(new Error('geocoding offline'))

    const searchInput = await waitFor(
      () => document.body.querySelector('[data-location-search-input]') as HTMLInputElement | null,
      (element) => element instanceof HTMLInputElement,
      'search input did not appear for the search retry test',
    )

    setInputValue(searchInput as HTMLInputElement, 'Tokyo')

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => {
        const router = getPopoverRouter(appState)

        return router.attrs.searchStatus === 'error' && router.attrs.searchError === 'geocoding offline'
      },
      'search error did not surface in the router state',
    )

    const retryButton = await waitFor(
      () => document.body.querySelector('[data-location-search-retry]'),
      (element) => Boolean(element),
      'search retry button did not appear',
    )

    clickElement(retryButton as Element)

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
      'search retry did not recover Tokyo results',
    )

    await waitFor(
      () => document.body.querySelector('[data-location-search-result="tokyo-1"]'),
      (element) => Boolean(element),
      'search retry did not render Tokyo in the DOM',
    )
  })

  test('stale weather response from an earlier replacement does not overwrite the latest one', async () => {
    harness = await createWeatherTestHarness()

    await harness.whenReady()
    const readyState = await waitForWeatherLoaded(harness)
    await waitForLocationCardsRendered(harness)
    const { mainLocationId } = getSelectedLocationIds(readyState)
    const firstWeatherResponse = createDeferred<ReturnType<typeof createWeatherPayload>>()
    fetchWeatherFromOpenMeteo.mockImplementationOnce(() => firstWeatherResponse.promise)
    const trigger = harness.rootElement.querySelector(
      `[data-selected-location-id="${mainLocationId}"] [data-selected-location-trigger]`,
    )

    expect(trigger).not.toBeNull()

    clickElement(trigger as Element)

    const editTrigger = await waitFor(
      () => document.body.querySelector('[data-location-edit-trigger]'),
      (element) => Boolean(element),
      'location edit trigger did not appear for the stale weather test',
    )

    clickElement(editTrigger as Element)

    const routerModel = getPopoverRouter(await getAppState(harness))

    harness.pageRuntime.dispatchAction(
      'submitLocationSearch',
      { query: 'Tokyo' },
      { _nodeId: routerModel.nodeId ?? '' } as never,
    )

    const tokyoResult = await waitFor(
      () => document.body.querySelector('[data-location-search-result="tokyo-1"]'),
      (element) => Boolean(element),
      'Tokyo search result did not appear for the stale weather test',
    )

    clickElement(tokyoResult as Element)

    const firstRequestState = await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => {
        const weatherLocation = getWeatherLocationForSelectedLocation(appState, mainLocationId)

        return (
          weatherLocation?.attrs.name === 'Tokyo' &&
          weatherLocation?.attrs.loadStatus === 'loading'
        )
      },
      'first weather request did not start',
    )

    expect(firstRequestState).toBeTruthy()

    const secondEditTrigger = await waitFor(
      () => document.body.querySelector('[data-location-edit-trigger]'),
      (element) => Boolean(element),
      'location edit trigger did not return after the first replacement',
    )

    clickElement(secondEditTrigger as Element)

    fetchWeatherFromOpenMeteo.mockImplementationOnce(async () =>
      createWeatherPayload(49, '2026-04-13T12:00:00.000Z'),
    )

    harness.pageRuntime.dispatchAction(
      'submitLocationSearch',
      { query: 'Portland' },
      { _nodeId: routerModel.nodeId ?? '' } as never,
    )

    const portlandResult = await waitFor(
      () => document.body.querySelector('[data-location-search-result="portland-fallback"]'),
      (element) => Boolean(element),
      'Portland search result did not appear for the stale weather test',
    )

    clickElement(portlandResult as Element)

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => {
        const weatherLocation = getWeatherLocationForSelectedLocation(appState, mainLocationId)

        return (
          weatherLocation?.attrs.name === 'Portland' &&
          weatherLocation?.attrs.loadStatus === 'ready' &&
          weatherLocation?.attrs.weatherFetchedAt === '2026-04-13T12:00:00.000Z'
        )
      },
      'Portland replacement did not become the latest weather state',
    )

    firstWeatherResponse.resolve(createWeatherPayload(10, '2026-04-13T12:10:00.000Z'))

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => {
        const weatherLocation = getWeatherLocationForSelectedLocation(appState, mainLocationId)

        return (
          weatherLocation?.attrs.name === 'Portland' &&
          weatherLocation?.attrs.loadStatus === 'ready' &&
          weatherLocation?.attrs.weatherFetchedAt === '2026-04-13T12:00:00.000Z'
        )
      },
      'stale weather response overwrote the latest replacement',
    )
  })

  test('stale search response is ignored after the query changes and editing is canceled', async () => {
    harness = await createWeatherTestHarness()
    fetchLocationSearchResults.mockImplementation(() => new Promise(() => undefined))

    await harness.whenReady()
    await waitForWeatherLoaded(harness)
    await waitForLocationCardsRendered(harness)

    const routerModel = getPopoverRouter(await getAppState(harness))

    harness.pageRuntime.dispatchAction(
      'startLocationEditing',
      { seedQuery: 'Tokyo' },
      { _nodeId: routerModel.nodeId ?? '' } as never,
    )

    harness.pageRuntime.dispatchAction(
      'submitLocationSearch',
      { query: 'Tokyo' },
      { _nodeId: routerModel.nodeId ?? '' } as never,
    )

    const firstSearchState = await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => {
        const router = getPopoverRouter(appState)

        return router.attrs.searchStatus === 'loading' && router.attrs.searchQuery === 'Tokyo'
      },
      'first search request did not start',
    )

    const firstRequestId = getPopoverRouter(firstSearchState).attrs.activeSearchRequestId

    harness.pageRuntime.dispatchAction(
      'updateLocationSearchQuery',
      'Portland',
      { _nodeId: routerModel.nodeId ?? '' } as never,
    )
    harness.pageRuntime.dispatchAction(
      'submitLocationSearch',
      { query: 'Portland' },
      { _nodeId: routerModel.nodeId ?? '' } as never,
    )

    const secondSearchState = await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => {
        const router = getPopoverRouter(appState)

        return router.attrs.searchStatus === 'loading' && router.attrs.searchQuery === 'Portland'
      },
      'second search request did not start',
    )

    const secondRequestId = getPopoverRouter(secondSearchState).attrs.activeSearchRequestId

    harness.pageRuntime.dispatchAction(
      'applyLocationSearchResponse',
      {
        requestId: secondRequestId,
        results: [
          {
            id: 'portland-1',
            name: 'Portland',
            subtitle: 'Portland, Oregon',
            latitude: 45.5152,
            longitude: -122.6784,
            timezone: 'America/Los_Angeles',
          },
        ],
      },
      { _nodeId: routerModel.nodeId ?? '' } as never,
    )

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => {
        const router = getPopoverRouter(appState)
        const results = Array.isArray(router.attrs.searchResults) ? router.attrs.searchResults : []

        return (
          router.attrs.searchStatus === 'ready' &&
          results.some(
            (result) =>
              typeof result === 'object' &&
              result != null &&
              'name' in result &&
              (result as { name?: unknown }).name === 'Portland',
          )
        )
      },
      'replacement search did not resolve Portland before cancel',
    )

    harness.pageRuntime.dispatchAction(
      'cancelLocationEditing',
      undefined,
      { _nodeId: routerModel.nodeId ?? '' } as never,
    )

    harness.pageRuntime.dispatchAction(
      'applyLocationSearchResponse',
      {
        requestId: firstRequestId,
        results: [
          {
            id: 'tokyo-stale',
            name: 'Tokyo',
            subtitle: 'Tokyo, Japan',
            latitude: 35.6762,
            longitude: 139.6503,
            timezone: 'Asia/Tokyo',
          },
        ],
      },
      { _nodeId: routerModel.nodeId ?? '' } as never,
    )

    await waitFor(
      async () => getAppState(harness as WeatherTestHarness),
      (appState) => {
        const router = getPopoverRouter(appState)

        return (
          router.attrs.isEditingLocation === false &&
          router.attrs.searchStatus === 'idle' &&
          Array.isArray(router.attrs.searchResults) &&
          router.attrs.searchResults.length === 0
        )
      },
      'stale search response updated the popover after canceling edit',
    )

    expect(document.body.querySelector('[data-location-search-panel]')).toBeNull()
  })
})