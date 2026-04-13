import type { ApplyWeatherPayload } from '../app/rels/location-models'

type OpenMeteoCurrentRaw = {
  temperature_2m: number
  apparent_temperature: number
  weather_code: number
  is_day: number
  wind_speed_10m: number
}

type OpenMeteoHourlyRaw = {
  time: string[]
  temperature_2m: number[]
  precipitation_probability: number[]
  weather_code: number[]
  wind_speed_10m: number[]
}

type OpenMeteoDailyRaw = {
  time: string[]
  weather_code: number[]
  temperature_2m_max: number[]
  temperature_2m_min: number[]
  precipitation_probability_max: number[]
  wind_speed_10m_max: number[]
  sunrise: string[]
  sunset: string[]
}

type OpenMeteoRawResponse = {
  current: OpenMeteoCurrentRaw
  hourly: OpenMeteoHourlyRaw
  daily: OpenMeteoDailyRaw
}

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast'

const normalizeWeatherResponse = (raw: OpenMeteoRawResponse): ApplyWeatherPayload => {
  return {
    current: {
      temperatureC: raw.current.temperature_2m,
      apparentTemperatureC: raw.current.apparent_temperature,
      weatherCode: raw.current.weather_code,
      isDay: Boolean(raw.current.is_day),
      windSpeed10m: raw.current.wind_speed_10m,
    },
    hourly: raw.hourly.time.map((time, i) => ({
      time,
      temperatureC: raw.hourly.temperature_2m[i],
      precipitationProbability: raw.hourly.precipitation_probability[i],
      weatherCode: raw.hourly.weather_code[i],
      windSpeed10m: raw.hourly.wind_speed_10m[i],
    })),
    daily: raw.daily.time.map((date, i) => ({
      date,
      weatherCode: raw.daily.weather_code[i],
      temperatureMaxC: raw.daily.temperature_2m_max[i],
      temperatureMinC: raw.daily.temperature_2m_min[i],
      precipitationProbabilityMax: raw.daily.precipitation_probability_max[i],
      windSpeedMax: raw.daily.wind_speed_10m_max[i],
      sunrise: raw.daily.sunrise[i],
      sunset: raw.daily.sunset[i],
    })),
    fetchedAt: new Date().toISOString(),
  }
}

export const fetchWeatherFromOpenMeteo = async (
  latitude: number,
  longitude: number,
): Promise<ApplyWeatherPayload> => {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',
    hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m',
    forecast_hours: '12',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset',
    forecast_days: '5',
    timezone: 'auto',
  })

  const response = await fetch(`${OPEN_METEO_BASE}?${params}`)

  if (!response.ok) {
    throw new Error(`Open-Meteo responded with ${response.status}`)
  }

  const raw = await response.json() as OpenMeteoRawResponse
  return normalizeWeatherResponse(raw)
}
