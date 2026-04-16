import { model } from 'dkt/model.js'
import { CurrentWeather } from './CurrentWeather'
import { DailyForecastSeries } from './DailyForecastSeries'
import { HourlyForecastSeries } from './HourlyForecastSeries'
import {
  CURRENT_WEATHER_CREATION_SHAPE,
  FORECAST_SERIES_CREATION_SHAPE,
} from './weatherSeed'
import {
  formatDailyLabel,
  formatHourlyLabel,
  formatTemperature,
  weatherCodeToSummary,
} from './weatherFormat'

export type ApplyWeatherPayload = {
  current: {
    temperatureC: number
    apparentTemperatureC: number
    weatherCode: number
    isDay: boolean
    windSpeed10m: number
  }
  hourly: Array<{
    time: string
    temperatureC: number
    precipitationProbability: number
    weatherCode: number
    windSpeed10m: number
  }>
  daily: Array<{
    date: string
    weatherCode: number
    temperatureMaxC: number
    temperatureMinC: number
    precipitationProbabilityMax: number
    windSpeedMax: number
    sunrise: string
    sunset: string
  }>
  fetchedAt: string
}

export type LocationSearchResult = {
  id: string
  name: string
  subtitle: string
  latitude: number
  longitude: number
  timezone: string | null
}

type WeatherDataResult =
  | { ok: true; data: ApplyWeatherPayload }
  | { ok: false; message: string }

export const isLocationSearchResult = (value: unknown): value is LocationSearchResult => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<LocationSearchResult>

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.subtitle === 'string' &&
    typeof candidate.latitude === 'number' &&
    typeof candidate.longitude === 'number'
  )
}


const asFiniteNumber = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const formatTemperatureOrFallback = (value: unknown) => {
  const temperature = asFiniteNumber(value)

  return temperature === null ? '-- \u00b0C' : formatTemperature(temperature)
}

const formatTemperaturePairOrFallback = (minValue: unknown, maxValue: unknown) => {
  const minTemperature = asFiniteNumber(minValue)
  const maxTemperature = asFiniteNumber(maxValue)

  if (minTemperature === null && maxTemperature === null) {
    return '-- \u00b0C'
  }

  return `${minTemperature === null ? '-- \u00b0C' : formatTemperature(minTemperature)} / ${maxTemperature === null ? '-- \u00b0C' : formatTemperature(maxTemperature)}`
}

const formatRange = (temperatures: number[]) => {
  return temperatures.length
    ? `${Math.round(Math.min(...temperatures))}\u2013${Math.round(Math.max(...temperatures))}`
    : null
}

const buildHourlySparkline = (
  temperaturesSource: unknown,
  timesSource: unknown,
  weatherCodesSource: unknown,
) => {
  const temperaturesInput = Array.isArray(temperaturesSource) ? temperaturesSource : []
  const times = Array.isArray(timesSource) ? timesSource : []
  const weatherCodes = Array.isArray(weatherCodesSource) ? weatherCodesSource : []

  if (!temperaturesInput.length) {
    return null
  }

  const temperatures = temperaturesInput
    .map((temperature) => asFiniteNumber(temperature))
    .filter((temperature): temperature is number => temperature !== null)

  if (!temperatures.length) {
    return null
  }

  const firstTime = times[0]
  const lastTime = times[times.length - 1]
  const firstTemperature = temperaturesInput[0]
  const lastTemperature = temperaturesInput[temperaturesInput.length - 1]

  return {
    temperatures,
    minC: Math.min(...temperatures),
    maxC: Math.max(...temperatures),
    count: temperatures.length,
    firstLabel: typeof firstTime === 'string' ? formatHourlyLabel(firstTime) : '',
    lastLabel: typeof lastTime === 'string' ? formatHourlyLabel(lastTime) : '',
    firstTemp: formatTemperatureOrFallback(firstTemperature),
    lastTemp: formatTemperatureOrFallback(lastTemperature),
    weatherCodes: weatherCodes.map((weatherCode) => {
      return typeof weatherCode === 'number' ? weatherCode : null
    }),
    weatherSummaries: weatherCodes.map((weatherCode) => {
      return weatherCodeToSummary(typeof weatherCode === 'number' ? weatherCode : null, true)
    }),
  }
}

const buildDailySparkline = (
  maxTemperaturesSource: unknown,
  minTemperaturesSource: unknown,
  datesSource: unknown,
  weatherCodesSource: unknown,
) => {
  const maxTemperaturesInput = Array.isArray(maxTemperaturesSource) ? maxTemperaturesSource : []
  const minTemperaturesInput = Array.isArray(minTemperaturesSource) ? minTemperaturesSource : []
  const dates = Array.isArray(datesSource) ? datesSource : []
  const weatherCodes = Array.isArray(weatherCodesSource) ? weatherCodesSource : []

  if (!dates.length) {
    return null
  }

  const temperatures: number[] = []
  const opacities: number[] = []
  const dayTemperatures: number[] = []
  const nightTemperatures: number[] = []

  for (let index = 0; index < dates.length; index += 1) {
    const maxTemperature = asFiniteNumber(maxTemperaturesInput[index])
    const minTemperature = asFiniteNumber(minTemperaturesInput[index])

    if (maxTemperature !== null) {
      temperatures.push(maxTemperature)
      opacities.push(1)
      dayTemperatures.push(maxTemperature)
    }

    if (minTemperature !== null) {
      temperatures.push(minTemperature)
      opacities.push(0.35)
      nightTemperatures.push(minTemperature)
    }
  }

  if (!temperatures.length) {
    return null
  }

  const firstDate = dates[0]
  const lastDate = dates[dates.length - 1]
  const firstMinTemperature = minTemperaturesInput[0]
  const firstMaxTemperature = maxTemperaturesInput[0]
  const lastMinTemperature = minTemperaturesInput[minTemperaturesInput.length - 1]
  const lastMaxTemperature = maxTemperaturesInput[maxTemperaturesInput.length - 1]

  return {
    temperatures,
    opacities,
    count: dates.length,
    firstLabel: typeof firstDate === 'string' ? formatDailyLabel(firstDate) : '',
    lastLabel: typeof lastDate === 'string' ? formatDailyLabel(lastDate) : '',
    firstTemp: formatTemperaturePairOrFallback(firstMinTemperature, firstMaxTemperature),
    lastTemp: formatTemperaturePairOrFallback(lastMinTemperature, lastMaxTemperature),
    dayRange: formatRange(dayTemperatures),
    nightRange: formatRange(nightTemperatures),
    weatherCodes: weatherCodes.map((weatherCode) => {
      return typeof weatherCode === 'number' ? weatherCode : null
    }),
    weatherSummaries: weatherCodes.map((weatherCode) => {
      return weatherCodeToSummary(typeof weatherCode === 'number' ? weatherCode : null, true)
    }),
  }
}

export const WeatherLocation = model({
  model_name: 'weather_location',
  attrs: {
    name: ['input', ''],
    latitude: ['input', null],
    longitude: ['input', null],
    timezone: ['input', null],
    loadStatus: ['input', 'idle'],
    lastError: ['input', null],
    weatherFetchedAt: ['input', null],
    weatherData: ['input', null],
    hourlySparkline: [
      'comp',
      [
        '< @all:temperatureC < hourlyForecastSeries',
        '< @all:time < hourlyForecastSeries',
        '< @all:weatherCode < hourlyForecastSeries',
      ],
      buildHourlySparkline,
    ],
    dailySparkline: [
      'comp',
      [
        '< @all:temperatureMaxC < dailyForecastSeries',
        '< @all:temperatureMinC < dailyForecastSeries',
        '< @all:date < dailyForecastSeries',
        '< @all:weatherCode < dailyForecastSeries',
      ],
      buildDailySparkline,
    ],
  },
  rels: {
    currentWeather: ['model', CurrentWeather],
    hourlyForecastSeries: ['model', HourlyForecastSeries, { many: true }],
    dailyForecastSeries: ['model', DailyForecastSeries, { many: true }],
  },
  actions: {
    startLoading: {
      to: {
        loadStatus: ['loadStatus'],
        lastError: ['lastError'],
      },
      fn: () => ({
        loadStatus: 'loading',
        lastError: null,
      }),
    },
    applyWeather: {
      to: {
        loadStatus: ['loadStatus'],
        lastError: ['lastError'],
        weatherFetchedAt: ['weatherFetchedAt'],
        currentWeather: [
          '<< currentWeather',
          {
            method: 'set_one',
            can_create: true,
            creation_shape: CURRENT_WEATHER_CREATION_SHAPE,
          },
        ],
        hourlyForecastSeries: [
          '<< hourlyForecastSeries',
          {
            method: 'set_many',
            can_create: true,
            creation_shape: FORECAST_SERIES_CREATION_SHAPE,
          },
        ],
        dailyForecastSeries: [
          '<< dailyForecastSeries',
          {
            method: 'set_many',
            can_create: true,
            creation_shape: FORECAST_SERIES_CREATION_SHAPE,
          },
        ],
      },
      fn: [
        ['name'] as const,
        (payload: ApplyWeatherPayload, locationName: unknown) => {
          const name = typeof locationName === 'string' ? locationName : ''
          const c = payload.current

          return {
            loadStatus: 'ready',
            lastError: null,
            weatherFetchedAt: payload.fetchedAt,
            currentWeather: {
              attrs: {
                location: name,
                updatedAt: payload.fetchedAt,
                temperatureC: c.temperatureC,
                apparentTemperatureC: c.apparentTemperatureC,
                weatherCode: c.weatherCode,
                isDay: c.isDay,
                windSpeed10m: c.windSpeed10m,
              },
            },
            hourlyForecastSeries: payload.hourly.map((h) => ({
              attrs: {
                time: h.time,
                temperatureC: h.temperatureC,
                precipitationProbability: h.precipitationProbability,
                weatherCode: h.weatherCode,
                windSpeed10m: h.windSpeed10m,
              },
            })),
            dailyForecastSeries: payload.daily.map((d) => ({
              attrs: {
                date: d.date,
                temperatureMaxC: d.temperatureMaxC,
                temperatureMinC: d.temperatureMinC,
                precipitationProbabilityMax: d.precipitationProbabilityMax,
                weatherCode: d.weatherCode,
                windSpeedMax: d.windSpeedMax,
                sunrise: d.sunrise,
                sunset: d.sunset,
              },
            })),
          }
        },
      ],
    },
    failWeather: {
      to: {
        loadStatus: ['loadStatus'],
        lastError: ['lastError'],
      },
      fn: (payload: { message: string }) => ({
        loadStatus: 'error',
        lastError: payload.message,
      }),
    },
  },
  effects: {
    api: {
      weatherApi: [
        ['_node_id'] as const,
        ['#weatherLoader'] as const,
        (weatherLoader: unknown) => weatherLoader,
      ],
    },
    in: {
      loadWeather: {
        type: 'state_request',
        states: ['weatherData'],
        api: 'weatherApi',
        parse: (result: unknown) => ({ weatherData: result }),
        fn: [
          ['latitude', 'longitude'] as const,
          async (
            api: { loadByCoordinates: (input: { latitude: number; longitude: number }) => Promise<unknown> },
            _opts: unknown,
            lat: unknown,
            lon: unknown,
          ) => {
            try {
              const data = await api.loadByCoordinates({
                latitude: lat as number,
                longitude: lon as number,
              })
              return { ok: true as const, data }
            } catch (error) {
              return { ok: false as const, message: error instanceof Error ? error.message : String(error) }
            }
          },
        ],
      },
    },
    out: {
      triggerWeatherLoad: {
        api: ['self', 'weatherApi'],
        trigger: ['latitude'],
        require: ['latitude', 'longitude'],
        create_when: {
          api_inits: true,
        },
        fn: (
          self: { requestState: (name: string) => unknown },
        ) => {
          self.requestState('weatherData')
        },
      },
      applyFetchedWeatherData: {
        api: ['self'],
        trigger: ['weatherData'],
        require: ['weatherData'],
        create_when: {
          api_inits: true,
        },
        is_async: true,
        fn: [
          ['weatherData'] as const,
          async (
            self: {
              dispatch: (actionName: string, payload?: unknown) => Promise<void> | void
            },
            _task: unknown,
            weatherData: unknown,
          ) => {
            if (!weatherData || typeof weatherData !== 'object') {
              return
            }

            const wd = weatherData as WeatherDataResult
            if (wd.ok) {
              await self.dispatch('applyWeather', wd.data)
            } else {
              await self.dispatch('failWeather', { message: wd.message })
            }
          },
        ],
      },
    },
  },
})


