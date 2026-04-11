import { model } from 'dkt/model.js'

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
})

export const SelectedLocation = model({
  model_name: 'weather_selected_location',
  rels: {
    weatherLocation: ['input', { linking: '<< weatherLocation << #' }],
  },
})


