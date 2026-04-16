import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createWeatherTestHarness,
  type WeatherTestHarness,
} from './harness/createWeatherTestHarness'

const { fetchWeatherFromOpenMeteo } = vi.hoisted(() => ({
  fetchWeatherFromOpenMeteo: vi.fn(async (latitude: number, longitude: number) => ({
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
  })),
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
  fetchLocationSearchResults: vi.fn(async () => []),
  createLocationSearchApi: () => ({
    source_name: 'locationSearch',
    errors_fields: [],
    search: vi.fn(async () => []),
  }),
}))

vi.mock('../src/worker/geo-location-api', () => ({
  createGeoLocationApi: () => ({
    source_name: 'geoLocation',
    errors_fields: [],
    detectLocation: vi.fn(async () => {
      throw new Error('auto geo disabled in tests')
    }),
    detectLocationByCoordinates: vi.fn(
      async ({ latitude, longitude }: { latitude: number; longitude: number }) => ({
        id: `coords-${latitude.toFixed(4)}-${longitude.toFixed(4)}`,
        name: '',
        subtitle: '',
        latitude,
        longitude,
        timezone: null,
      }),
    ),
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

const waitFor = async <T>(
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

const getAllWeatherLocations = (appState: DebugAppState) => {
  return (
    appState?.runtimeModels.filter((model) => model.modelName === 'weather_location') ?? []
  )
}

const waitForAllWeatherLoaded = async (harness: WeatherTestHarness) => {
  return waitFor(
    async () => getAppState(harness),
    (appState) => {
      const weatherLocations = getAllWeatherLocations(appState)

      return Boolean(
        weatherLocations.length >= 4 &&
          weatherLocations.every(
            (model) => model.attrs.loadStatus === 'ready' && model.attrs.lastError == null,
          ),
      )
    },
    'weather data did not finish loading for all locations',
  )
}

const waitForAllWeatherFetchedAt = async (
  harness: WeatherTestHarness,
  expectedFetchedAt: string,
) => {
  return waitFor(
    async () => getAppState(harness),
    (appState) => {
      const weatherLocations = getAllWeatherLocations(appState)

      return Boolean(
        weatherLocations.length >= 4 &&
          weatherLocations.every(
            (model) =>
              model.attrs.loadStatus === 'ready' &&
              model.attrs.weatherFetchedAt === expectedFetchedAt,
          ),
      )
    },
    `not all locations updated to fetchedAt=${expectedFetchedAt}`,
  )
}

describe('global weather refresh', () => {
  let harness: WeatherTestHarness | null = null

  afterEach(() => {
    harness?.destroy()
    harness = null
    vi.restoreAllMocks()
  })

  test('retryWeatherLoad refreshes all locations, not just main', async () => {
    harness = await createWeatherTestHarness()

    await harness.whenReady()
    await waitForAllWeatherLoaded(harness)

    const stateBeforeRefresh = await getAppState(harness)
    const locationsBeforeRefresh = getAllWeatherLocations(stateBeforeRefresh)

    // Sanity: all 4 locations loaded with initial fetchedAt
    expect(locationsBeforeRefresh).toHaveLength(4)
    for (const loc of locationsBeforeRefresh) {
      expect(loc.attrs.loadStatus).toBe('ready')
      expect(loc.attrs.weatherFetchedAt).toBe('2026-04-13T12:00:00.000Z')
    }

    const callCountBeforeRefresh = fetchWeatherFromOpenMeteo.mock.calls.length

    // Switch mock to return a new fetchedAt
    const REFRESHED_FETCHED_AT = '2026-04-13T13:00:00.000Z'
    fetchWeatherFromOpenMeteo.mockImplementation(async (latitude: number, longitude: number) => ({
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
      fetchedAt: REFRESHED_FETCHED_AT,
    }))

    // Dispatch global refresh
    harness.session.dispatchAppAction('retryWeatherLoad')

    // Wait for ALL locations to update
    await waitForAllWeatherFetchedAt(harness, REFRESHED_FETCHED_AT)

    const stateAfterRefresh = await getAppState(harness)
    const locationsAfterRefresh = getAllWeatherLocations(stateAfterRefresh)

    // All 4 locations must have refreshed
    expect(locationsAfterRefresh).toHaveLength(4)

    for (const loc of locationsAfterRefresh) {
      expect(loc.attrs.loadStatus, `${loc.attrs.name} loadStatus`).toBe('ready')
      expect(loc.attrs.weatherFetchedAt, `${loc.attrs.name} weatherFetchedAt`).toBe(
        REFRESHED_FETCHED_AT,
      )
    }

    // Weather API must have been called for each location again
    const refreshCalls = fetchWeatherFromOpenMeteo.mock.calls.length - callCountBeforeRefresh
    expect(refreshCalls).toBe(4)
  })
})
