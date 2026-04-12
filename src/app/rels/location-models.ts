import { model } from 'dkt/model.js'
import {
  buildForecastSeries,
  buildWeatherState,
  CURRENT_WEATHER_CREATION_SHAPE,
  FORECAST_SERIES_CREATION_SHAPE,
} from './weatherSeed'

export const CurrentWeather = model({
  model_name: 'weather_current_weather',
  attrs: {
    location: ['input', ''],
    status: ['input', 'booting'],
    temperatureText: ['input', '-- \u00b0C'],
    summary: ['input', 'Waiting for weather data'],
    updatedAt: ['input', null],
  },
})

export const HourlyForecastSeries = model({
  model_name: 'weather_hourly_forecast_series',
  attrs: {
    label: ['input', ''],
    temperatureText: ['input', '-- \u00b0C'],
    summary: ['input', ''],
  },
})

export const DailyForecastSeries = model({
  model_name: 'weather_daily_forecast_series',
  attrs: {
    label: ['input', ''],
    temperatureText: ['input', '-- \u00b0C'],
    summary: ['input', ''],
  },
})

export const WeatherLocation = model({
  model_name: 'weather_location',
  attrs: {
    name: ['input', ''],
  },
  rels: {
    currentWeather: ['model', CurrentWeather],
    hourlyForecastSeries: ['model', HourlyForecastSeries, { many: true }],
    dailyForecastSeries: ['model', DailyForecastSeries, { many: true }],
  },
  actions: {
    handleInit: {
      to: {
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
        ['name'],
        (_payload, locationName: string) => {
          const name = typeof locationName === 'string' ? locationName : ''

          return {
            currentWeather: {
              attrs: buildWeatherState(name, 'ready'),
            },
            hourlyForecastSeries: [
              buildForecastSeries(name, 0),
              buildForecastSeries(name, 1),
            ],
            dailyForecastSeries: [buildForecastSeries(name, 2)],
          }
        },
      ],
    },
  },
})

export const SelectedLocation = model({
  model_name: 'weather_selected_location',
  rels: {
    weatherLocation: ['input', { linking: '<< weatherLocation << #' }],
  },
})


