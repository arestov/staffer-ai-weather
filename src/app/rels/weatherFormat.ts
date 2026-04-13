// WMO Weather Interpretation Codes (WW)
// https://open-meteo.com/en/docs#weathervariables
const WMO_CODE_DESCRIPTIONS: Record<number, { day: string; night: string }> = {
  0: { day: 'Clear sky', night: 'Clear sky' },
  1: { day: 'Mainly clear', night: 'Mainly clear' },
  2: { day: 'Partly cloudy', night: 'Partly cloudy' },
  3: { day: 'Overcast', night: 'Overcast' },
  45: { day: 'Foggy', night: 'Foggy' },
  48: { day: 'Depositing rime fog', night: 'Depositing rime fog' },
  51: { day: 'Light drizzle', night: 'Light drizzle' },
  53: { day: 'Moderate drizzle', night: 'Moderate drizzle' },
  55: { day: 'Dense drizzle', night: 'Dense drizzle' },
  56: { day: 'Light freezing drizzle', night: 'Light freezing drizzle' },
  57: { day: 'Heavy freezing drizzle', night: 'Heavy freezing drizzle' },
  61: { day: 'Slight rain', night: 'Slight rain' },
  63: { day: 'Moderate rain', night: 'Moderate rain' },
  65: { day: 'Heavy rain', night: 'Heavy rain' },
  66: { day: 'Light freezing rain', night: 'Light freezing rain' },
  67: { day: 'Heavy freezing rain', night: 'Heavy freezing rain' },
  71: { day: 'Slight snowfall', night: 'Slight snowfall' },
  73: { day: 'Moderate snowfall', night: 'Moderate snowfall' },
  75: { day: 'Heavy snowfall', night: 'Heavy snowfall' },
  77: { day: 'Snow grains', night: 'Snow grains' },
  80: { day: 'Slight rain showers', night: 'Slight rain showers' },
  81: { day: 'Moderate rain showers', night: 'Moderate rain showers' },
  82: { day: 'Violent rain showers', night: 'Violent rain showers' },
  85: { day: 'Slight snow showers', night: 'Slight snow showers' },
  86: { day: 'Heavy snow showers', night: 'Heavy snow showers' },
  95: { day: 'Thunderstorm', night: 'Thunderstorm' },
  96: { day: 'Thunderstorm with slight hail', night: 'Thunderstorm with slight hail' },
  99: { day: 'Thunderstorm with heavy hail', night: 'Thunderstorm with heavy hail' },
}

export const weatherCodeToSummary = (
  code: number | null | undefined,
  isDay: boolean | null | undefined,
): string => {
  if (code == null) {
    return 'Unknown conditions'
  }

  const entry = WMO_CODE_DESCRIPTIONS[code]
  if (!entry) {
    return 'Unknown conditions'
  }

  return isDay === false ? entry.night : entry.day
}

export const formatTemperature = (celsius: number | null | undefined): string => {
  if (celsius == null) {
    return '-- °C'
  }

  return `${Math.round(celsius)} °C`
}

export const formatHourlyLabel = (isoTime: string | null | undefined): string => {
  if (!isoTime) {
    return '--:--'
  }

  // ISO string like "2024-04-13T14:00"
  const timePart = isoTime.includes('T') ? isoTime.split('T')[1] : isoTime
  if (!timePart) {
    return '--:--'
  }

  return timePart.slice(0, 5)
}

export const formatDailyLabel = (dateString: string | null | undefined): string => {
  if (!dateString) {
    return '---'
  }

  const date = new Date(`${dateString}T12:00:00Z`)
  if (isNaN(date.getTime())) {
    return '---'
  }

  return date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
}
