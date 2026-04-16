import { model } from 'dkt/model.js'
import { formatTemperature, formatDailyLabel, weatherCodeToSummary } from './weatherFormat'

export const DailyForecastSeries = model({
  model_name: 'weather_daily_forecast_series',
  attrs: {
    date: ['input', null],
    temperatureMaxC: ['input', null],
    temperatureMinC: ['input', null],
    precipitationProbabilityMax: ['input', null],
    weatherCode: ['input', null],
    windSpeedMax: ['input', null],
    sunrise: ['input', null],
    sunset: ['input', null],
    label: ['comp', ['date'], formatDailyLabel],
    temperatureText: [
      'comp',
      ['temperatureMinC', 'temperatureMaxC'],
      (min: unknown, max: unknown) =>
        `${formatTemperature(min as number | null | undefined)} / ${formatTemperature(max as number | null | undefined)}`,
    ],
    summary: [
      'comp',
      ['weatherCode'],
      (weatherCode: unknown) => weatherCodeToSummary(weatherCode as number | null | undefined, true),
    ],
  },
})
