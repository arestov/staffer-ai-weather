// Maps WMO Weather Interpretation Codes to meteocons icon names
// https://open-meteo.com/en/docs#weathervariables
// Icons from @meteocons/lottie/monochrome/

type IconMapping = {
  day: string
  night: string
}

const WMO_TO_METEOCON: Record<number, IconMapping> = {
  // Clear sky
  0: { day: 'clear-day', night: 'clear-night' },

  // Mainly clear
  1: { day: 'mostly-clear-day', night: 'mostly-clear-night' },

  // Partly cloudy
  2: { day: 'partly-cloudy-day', night: 'partly-cloudy-night' },

  // Overcast
  3: { day: 'overcast', night: 'overcast' },

  // Fog
  45: { day: 'fog-day', night: 'fog-night' },

  // Depositing rime fog
  48: { day: 'fog-day', night: 'fog-night' },

  // Light drizzle
  51: { day: 'drizzle', night: 'drizzle' },

  // Moderate drizzle
  53: { day: 'drizzle', night: 'drizzle' },

  // Dense drizzle
  55: { day: 'overcast-drizzle', night: 'overcast-drizzle' },

  // Light freezing drizzle
  56: { day: 'sleet', night: 'sleet' },

  // Heavy freezing drizzle
  57: { day: 'sleet', night: 'sleet' },

  // Slight rain
  61: { day: 'partly-cloudy-day-rain', night: 'partly-cloudy-night-rain' },

  // Moderate rain
  63: { day: 'rain', night: 'rain' },

  // Heavy rain
  65: { day: 'overcast-rain', night: 'overcast-rain' },

  // Light freezing rain
  66: { day: 'sleet', night: 'sleet' },

  // Heavy freezing rain
  67: { day: 'sleet', night: 'sleet' },

  // Slight snowfall
  71: { day: 'partly-cloudy-day-snow', night: 'partly-cloudy-night-snow' },

  // Moderate snowfall
  73: { day: 'snow', night: 'snow' },

  // Heavy snowfall
  75: { day: 'overcast-snow', night: 'overcast-snow' },

  // Snow grains
  77: { day: 'snow', night: 'snow' },

  // Slight rain showers
  80: { day: 'partly-cloudy-day-rain', night: 'partly-cloudy-night-rain' },

  // Moderate rain showers
  81: { day: 'overcast-day-rain', night: 'overcast-night-rain' },

  // Violent rain showers
  82: { day: 'extreme-day-rain', night: 'extreme-night-rain' },

  // Slight snow showers
  85: { day: 'partly-cloudy-day-snow', night: 'partly-cloudy-night-snow' },

  // Heavy snow showers
  86: { day: 'extreme-day-snow', night: 'extreme-night-snow' },

  // Thunderstorm
  95: { day: 'thunderstorms-day', night: 'thunderstorms-night' },

  // Thunderstorm with slight hail
  96: { day: 'thunderstorms-day-hail', night: 'thunderstorms-night-hail' },

  // Thunderstorm with heavy hail
  99: { day: 'thunderstorms-extreme-day-hail', night: 'thunderstorms-extreme-night-hail' },
}

const FALLBACK_ICON: IconMapping = { day: 'not-available', night: 'not-available' }

export const weatherCodeToMeteocon = (
  weatherCode: number | null | undefined,
  isDay: boolean | null | undefined,
): string | null => {
  if (weatherCode == null) {
    return null
  }

  const mapping = WMO_TO_METEOCON[weatherCode] ?? FALLBACK_ICON
  return isDay === false ? mapping.night : mapping.day
}
