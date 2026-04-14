import { model } from 'dkt/model.js'

export const HourlyForecastSeries = model({
  model_name: 'weather_hourly_forecast_series',
  attrs: {
    label: ['input', ''],
    temperatureText: ['input', '-- \u00b0C'],
    summary: ['input', ''],
    time: ['input', null],
    temperatureC: ['input', null],
    precipitationProbability: ['input', null],
    weatherCode: ['input', null],
    windSpeed10m: ['input', null],
  },
})
