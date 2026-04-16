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
    hourly: Array.from({ length: 12 }, (_, i) => ({
      time: `2026-04-15T${String(i).padStart(2, '0')}:00`,
      temperatureC: 10 + i * 2,
      precipitationProbability: i * 5,
      weatherCode: i < 6 ? 1 : 2,
      windSpeed10m: 3 + i,
    })),
    daily: Array.from({ length: 5 }, (_, i) => ({
      date: `2026-04-${15 + i}`,
      weatherCode: i < 3 ? 1 : 3,
      temperatureMaxC: 20 + i * 3,
      temperatureMinC: 5 + i,
      precipitationProbabilityMax: 10 + i * 5,
      windSpeedMax: 8 + i,
      sunrise: `2026-04-${15 + i}T05:30:00`,
      sunset: `2026-04-${15 + i}T19:00:00`,
    })),
    fetchedAt: '2026-04-15T06:00:00.000Z',
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
      throw new Error('disabled')
    }),
    detectLocationByCoordinates: vi.fn(
      async ({ latitude, longitude }: { latitude: number; longitude: number }) => ({
        id: `coords-${latitude}-${longitude}`,
        name: '',
        subtitle: '',
        latitude,
        longitude,
        timezone: null,
      }),
    ),
  }),
}))

const waitFor = async <T>(
  read: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  message: string,
) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(message)
}

const waitForWeatherLoaded = async (harness: WeatherTestHarness) => {
  await waitFor(
    async () =>
      (await harness.appRuntime.debugDumpAppState()) as {
        runtimeModels: Array<{ modelName: string; attrs: Record<string, unknown> }>
      } | null,
    (state) => {
      const locs = state?.runtimeModels.filter((m) => m.modelName === 'weather_location')
      return Boolean(locs?.length && locs.every((m) => m.attrs.loadStatus === 'ready'))
    },
    'weather did not load',
  )
}

const waitForSparklines = async (harness: WeatherTestHarness) => {
  return waitFor(
    () => harness.rootElement.querySelectorAll('.sparkline-section').length,
    (count) => count >= 2,
    'sparkline sections did not render',
  )
}

describe('Weather sparkline sections', () => {
  let harness: WeatherTestHarness | null = null

  afterEach(() => {
    harness?.destroy()
    harness = null
  })

  test('hourly and daily sparklines render after weather loads', async () => {
    harness = await createWeatherTestHarness()
    await harness.whenReady()
    await waitForWeatherLoaded(harness)
    await waitForSparklines(harness)

    const sections = harness.rootElement.querySelectorAll('.sparkline-section')
    expect(sections.length).toBe(2)

    // Hourly section
    const hourlySection = sections[0]
    const hourlyHeading = hourlySection.querySelector('.sparkline-title__heading')
    expect(hourlyHeading?.textContent).toBe('Hourly')

    const hourlyDetail = hourlySection.querySelector('.sparkline-title__detail')
    expect(hourlyDetail?.textContent).toContain('12h')
    expect(hourlyDetail?.textContent).toContain('°C')

    const hourlySvg = hourlySection.querySelector('.sparkline-svg')
    expect(hourlySvg).not.toBeNull()
    expect(hourlySvg?.getAttribute('role')).toBe('img')
    expect(hourlySvg?.getAttribute('aria-label')).toBe('Hourly temperature sparkline')

    const hourlyLines = hourlySvg?.querySelectorAll('line')
    expect(hourlyLines?.length).toBe(12)

    // Daily section
    const dailySection = sections[1]
    const dailyHeading = dailySection.querySelector('.sparkline-title__heading')
    expect(dailyHeading?.textContent).toBe('Daily')

    const dailyDetail = dailySection.querySelector('.sparkline-title__detail')
    expect(dailyDetail?.textContent).toContain('5d')
    expect(dailyDetail?.textContent).toContain('☀')
    expect(dailyDetail?.textContent).toContain('☾')
    expect(dailyDetail?.textContent).toContain('°C')
    expect(dailyDetail?.querySelector('.sparkline-title__detail-part--night')).not.toBeNull()

    const dailySvg = dailySection.querySelector('.sparkline-svg')
    expect(dailySvg).not.toBeNull()
    expect(dailySvg?.getAttribute('aria-label')).toBe('Daily temperature sparkline')

    // Daily has interleaved day/night dashes: 5 days × 2 = 10 lines (flat, no groups)
    const dailyLines = dailySvg?.querySelectorAll('line')
    expect(dailyLines?.length).toBe(10)
  })

  test('sparkline endpoints show first and last labels and temperatures', async () => {
    harness = await createWeatherTestHarness()
    await harness.whenReady()
    await waitForWeatherLoaded(harness)
    await waitForSparklines(harness)

    const sections = harness.rootElement.querySelectorAll('.sparkline-section')

    // Hourly endpoints
    const hourlyEndpoints = sections[0].querySelectorAll('.sparkline-endpoint')
    expect(hourlyEndpoints.length).toBe(2)

    const hourlyFirstTime = hourlyEndpoints[0].querySelector('.sparkline-endpoint__time')
    const hourlyFirstTemp = hourlyEndpoints[0].querySelector('.sparkline-endpoint__temp')
    expect(hourlyFirstTime?.textContent).toBe('00:00')
    expect(hourlyFirstTemp?.textContent).toContain('°C')

    const hourlyLastTime = hourlyEndpoints[1].querySelector('.sparkline-endpoint__time')
    const hourlyLastTemp = hourlyEndpoints[1].querySelector('.sparkline-endpoint__temp')
    expect(hourlyLastTime?.textContent).toBe('11:00')
    expect(hourlyLastTemp?.textContent).toContain('°C')

    // Daily endpoints
    const dailyEndpoints = sections[1].querySelectorAll('.sparkline-endpoint')
    expect(dailyEndpoints.length).toBe(2)

    const dailyFirstLabel = dailyEndpoints[0].querySelector('.sparkline-endpoint__time')
    const dailyFirstTemp = dailyEndpoints[0].querySelector('.sparkline-endpoint__temp')
    expect(dailyFirstLabel?.textContent).toBe('Wed')
    expect(dailyFirstTemp?.textContent).toContain('°C')
    expect(dailyFirstTemp?.querySelector('.sparkline-endpoint__temp-part--night')).not.toBeNull()

    const dailyLastLabel = dailyEndpoints[1].querySelector('.sparkline-endpoint__time')
    const dailyLastTemp = dailyEndpoints[1].querySelector('.sparkline-endpoint__temp')
    expect(dailyLastLabel?.textContent).toBe('Sun')
    expect(dailyLastTemp?.textContent).toContain('°C')
    expect(dailyLastTemp?.querySelector('.sparkline-endpoint__temp-part--night')).not.toBeNull()
  })

  test('sparkline SVG lines have correct y-positions reflecting temperature range', async () => {
    harness = await createWeatherTestHarness()
    await harness.whenReady()
    await waitForWeatherLoaded(harness)
    await waitForSparklines(harness)

    const hourlySvg = harness.rootElement.querySelector('.sparkline-section .sparkline-svg')
    const lines = Array.from(hourlySvg?.querySelectorAll('line') ?? [])

    // temperatures are 10, 12, 14, ..., 32 (ascending)
    // So first line should have highest y (bottom) and last line lowest y (top)
    const yValues = lines.map((l) => Number.parseFloat(l.getAttribute('y1') ?? '0'))
    expect(yValues.length).toBe(12)

    // First dash (10°C → coldest → highest y) should be > last dash (32°C → hottest → lowest y)
    expect(yValues[0]).toBeGreaterThan(yValues[yValues.length - 1])

    // Should be monotonically decreasing (ascending temps → descending y)
    for (let i = 1; i < yValues.length; i++) {
      expect(yValues[i]).toBeLessThan(yValues[i - 1])
    }
  })

  test('daily sparkline has interleaved day (opaque) and night (dim) dashes', async () => {
    harness = await createWeatherTestHarness()
    await harness.whenReady()
    await waitForWeatherLoaded(harness)
    await waitForSparklines(harness)

    const dailySvg = harness.rootElement.querySelectorAll('.sparkline-svg')[1]
    const lines = Array.from(dailySvg?.querySelectorAll('line') ?? [])
    expect(lines.length).toBe(10)

    // Interleaved: day(opaque), night(0.35), day, night, ...
    for (let i = 0; i < lines.length; i++) {
      const opacity = lines[i].getAttribute('opacity')
      if (i % 2 === 0) {
        // Day dash — opacity = 1 (explicit)
        expect(opacity).toBe('1')
      } else {
        // Night dash — opacity = 0.35
        expect(opacity).toBe('0.35')
      }
    }
  })

  test('popover shows sparkline sections', async () => {
    harness = await createWeatherTestHarness()
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)

    await harness.whenReady()
    await waitForWeatherLoaded(harness)

    await waitFor(
      () => harness!.rootElement.querySelectorAll('[data-selected-location-id]').length,
      (count) => count >= 4,
      'location cards did not render',
    )

    // Click the first location card to open the popover
    const trigger = harness.rootElement.querySelector('[data-selected-location-trigger]')
    expect(trigger).not.toBeNull()
    trigger!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

    // Wait for popover to appear in document.body (it's a portal)
    const popover = await waitFor(
      () => document.body.querySelector('[data-selected-location-popover]'),
      (el) => el !== null,
      'popover did not appear',
    )

    // Popover should now show sparkline sections instead of chip cards
    await waitFor(
      () => popover?.querySelectorAll('.sparkline-section').length ?? 0,
      (count) => count >= 2,
      'popover sparkline sections did not render',
    )

    const sparklines = popover!.querySelectorAll('.sparkline-section')
    expect(sparklines.length).toBe(2)
  })
})
