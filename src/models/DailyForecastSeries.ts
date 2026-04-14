import { model } from 'dkt/model.js'

export const DailyForecastSeries = model({
  model_name: 'weather_daily_forecast_series',
  attrs: {
    label: ['input', ''],
    temperatureText: ['input', '-- \u00b0C'],
    summary: ['input', ''],
    date: ['input', null],
    temperatureMaxC: ['input', null],
    temperatureMinC: ['input', null],
    precipitationProbabilityMax: ['input', null],
    weatherCode: ['input', null],
    windSpeedMax: ['input', null],
    sunrise: ['input', null],
    sunset: ['input', null],
  },
})
