import { model } from 'dkt/model.js'
import { formatTemperature, weatherCodeToSummary } from './weatherFormat'

export const CurrentWeather = model({
  model_name: 'weather_current_weather',
  attrs: {
    location: ['input', ''],
    updatedAt: ['input', null],
    temperatureC: ['input', null],
    apparentTemperatureC: ['input', null],
    weatherCode: ['input', null],
    isDay: ['input', null],
    windSpeed10m: ['input', null],
    status: [
      'comp',
      ['temperatureC'],
      (temperatureC: unknown) => (temperatureC !== null ? 'ready' : 'booting'),
    ],
    temperatureText: ['comp', ['temperatureC'], formatTemperature],
    summary: ['comp', ['weatherCode', 'isDay'], weatherCodeToSummary],
  },
})