import { model } from 'dkt/model.js'
import { formatTemperature, formatHourlyLabel, weatherCodeToSummary } from './weatherFormat'

export const HourlyForecastSeries = model({
  model_name: 'weather_hourly_forecast_series',
  attrs: {
    time: ['input', null],
    temperatureC: ['input', null],
    precipitationProbability: ['input', null],
    weatherCode: ['input', null],
    windSpeed10m: ['input', null],
    label: ['comp', ['time'], formatHourlyLabel],
    temperatureText: ['comp', ['temperatureC'], formatTemperature],
    summary: [
      'comp',
      ['weatherCode'],
      (weatherCode: unknown) => weatherCodeToSummary(weatherCode as number | null | undefined, true),
    ],
  },
})
