import { model } from 'dkt/model.js'
import { CurrentWeather } from './CurrentWeather'
import { DailyForecastSeries } from './DailyForecastSeries'
import { HourlyForecastSeries } from './HourlyForecastSeries'
import {
  CURRENT_WEATHER_CREATION_SHAPE,
  FORECAST_SERIES_CREATION_SHAPE,
} from '../app/rels/weatherSeed'
import { fetchWeatherFromOpenMeteo } from '../worker/weather-api'
import {
  formatDailyLabel,
  formatHourlyLabel,
  formatTemperature,
  weatherCodeToSummary,
} from '../app/rels/weatherFormat'

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

type WeatherLoadRequest = {
  requestId: number
  latitude: number
  longitude: number
}

type ApplyWeatherFromRequestPayload = {
  requestId: number
  weather: ApplyWeatherPayload
}

type FailWeatherFromRequestPayload = {
  requestId: number
  message: string
}

const isLocationSearchResult = (value: unknown): value is LocationSearchResult => {
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

const isWeatherLoadRequest = (value: unknown): value is WeatherLoadRequest => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<WeatherLoadRequest>

  return (
    typeof candidate.requestId === 'number' &&
    typeof candidate.latitude === 'number' &&
    typeof candidate.longitude === 'number'
  )
}

const isApplyWeatherFromRequestPayload = (
  value: unknown,
): value is ApplyWeatherFromRequestPayload => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ApplyWeatherFromRequestPayload>

  return (
    typeof candidate.requestId === 'number' &&
    Boolean(candidate.weather && typeof candidate.weather === 'object')
  )
}

const isFailWeatherFromRequestPayload = (
  value: unknown,
): value is FailWeatherFromRequestPayload => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<FailWeatherFromRequestPayload>

  return (
    typeof candidate.requestId === 'number' &&
    typeof candidate.message === 'string'
  )
}

const getNextWeatherLoadRequestId = (value: unknown) => {
  return (isWeatherLoadRequest(value) ? value.requestId : 0) + 1
}

const toErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error)
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
    weatherLoadRequest: ['input', null],
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
                status: 'ready',
                temperatureText: formatTemperature(c.temperatureC),
                summary: weatherCodeToSummary(c.weatherCode, c.isDay),
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
                label: formatHourlyLabel(h.time),
                temperatureText: formatTemperature(h.temperatureC),
                summary: weatherCodeToSummary(h.weatherCode, true),
                time: h.time,
                temperatureC: h.temperatureC,
                precipitationProbability: h.precipitationProbability,
                weatherCode: h.weatherCode,
                windSpeed10m: h.windSpeed10m,
              },
            })),
            dailyForecastSeries: payload.daily.map((d) => ({
              attrs: {
                label: formatDailyLabel(d.date),
                temperatureText: `${formatTemperature(d.temperatureMinC)} / ${formatTemperature(d.temperatureMaxC)}`,
                summary: weatherCodeToSummary(d.weatherCode, true),
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
    replaceLocation: {
      to: {
        name: ['name'],
        latitude: ['latitude'],
        longitude: ['longitude'],
        timezone: ['timezone'],
        loadStatus: ['loadStatus'],
        lastError: ['lastError'],
        weatherFetchedAt: ['weatherFetchedAt'],
        weatherLoadRequest: ['weatherLoadRequest'],
        currentWeather: ['<< currentWeather', { method: 'set_one' }],
        hourlyForecastSeries: ['<< hourlyForecastSeries', { method: 'set_many' }],
        dailyForecastSeries: ['<< dailyForecastSeries', { method: 'set_many' }],
      },
      fn: [
        ['weatherLoadRequest'] as const,
        (payload: unknown, weatherLoadRequest: unknown) => {
          if (!isLocationSearchResult(payload)) {
            return {}
          }

          const requestId = getNextWeatherLoadRequestId(weatherLoadRequest)

          return {
            name: payload.name,
            latitude: payload.latitude,
            longitude: payload.longitude,
            timezone: payload.timezone,
            loadStatus: 'loading',
            lastError: null,
            weatherFetchedAt: null,
            weatherLoadRequest: {
              requestId,
              latitude: payload.latitude,
              longitude: payload.longitude,
            },
            currentWeather: null,
            hourlyForecastSeries: [],
            dailyForecastSeries: [],
          }
        },
      ],
    },
    applyWeatherFromRequest: {
      to: {
        weatherLoadRequest: ['weatherLoadRequest'],
        applyWeather: ['<<<<', { action: 'applyWeather', inline_subwalker: true }],
      },
      fn: [
        ['$noop', 'weatherLoadRequest'] as const,
        (payload: unknown, noop: unknown, weatherLoadRequest: unknown) => {
          if (
            !isApplyWeatherFromRequestPayload(payload) ||
            !isWeatherLoadRequest(weatherLoadRequest) ||
            payload.requestId !== weatherLoadRequest.requestId
          ) {
            return noop
          }

          return {
            weatherLoadRequest: null,
            applyWeather: payload.weather,
          }
        },
      ],
    },
    failWeatherFromRequest: {
      to: {
        weatherLoadRequest: ['weatherLoadRequest'],
        failWeather: ['<<<<', { action: 'failWeather', inline_subwalker: true }],
      },
      fn: [
        ['$noop', 'weatherLoadRequest'] as const,
        (payload: unknown, noop: unknown, weatherLoadRequest: unknown) => {
          if (
            !isFailWeatherFromRequestPayload(payload) ||
            !isWeatherLoadRequest(weatherLoadRequest) ||
            payload.requestId !== weatherLoadRequest.requestId
          ) {
            return noop
          }

          return {
            weatherLoadRequest: null,
            failWeather: {
              message: payload.message,
            },
          }
        },
      ],
    },
  },
  effects: {
    out: {
      loadWeatherForReplacement: {
        api: ['self'],
        trigger: ['weatherLoadRequest'],
        require: ['weatherLoadRequest'],
        create_when: {
          api_inits: true,
        },
        is_async: true,
        fn: [
          ['weatherLoadRequest'] as const,
          async (
            self: {
              dispatch: (actionName: string, payload?: unknown) => Promise<void> | void
            },
            _task: unknown,
            weatherLoadRequest: unknown,
          ) => {
            if (!isWeatherLoadRequest(weatherLoadRequest)) {
              return
            }

            try {
              const weather = await fetchWeatherFromOpenMeteo(
                weatherLoadRequest.latitude,
                weatherLoadRequest.longitude,
              )

              await self.dispatch('applyWeatherFromRequest', {
                requestId: weatherLoadRequest.requestId,
                weather,
              })
            } catch (error) {
              await self.dispatch('failWeatherFromRequest', {
                requestId: weatherLoadRequest.requestId,
                message: toErrorMessage(error),
              })
            }
          },
        ],
      },
    },
  },
})
