import { model } from 'dkt/model.js'

export const CurrentWeather = model({
  model_name: 'weather_current_weather',
  attrs: {
    location: ['input', ''],
    status: ['input', 'booting'],
    temperatureText: ['input', '-- \u00b0C'],
    summary: ['input', 'Waiting for weather data'],
    updatedAt: ['input', null],
    temperatureC: ['input', null],
    apparentTemperatureC: ['input', null],
    weatherCode: ['input', null],
    isDay: ['input', null],
    windSpeed10m: ['input', null],
  },
})