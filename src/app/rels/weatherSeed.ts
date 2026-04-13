const WEATHER_PRESETS = [
  {
    location: 'Moscow',
    temperatureC: 8,
    summary: 'Dry cold morning with clear sky breaks',
    status: 'steady',
  },
  {
    location: 'Berlin',
    temperatureC: 15,
    summary: 'Low clouds with a soft breeze over the city',
    status: 'steady',
  },
  {
    location: 'Portland',
    temperatureC: 12,
    summary: 'Light rain and bright patches between showers',
    status: 'refreshing',
  },
  {
    location: 'Lisbon',
    temperatureC: 21,
    summary: 'Warm sun and a clean Atlantic horizon',
    status: 'ready',
  },
]

const hashText = (value: string) => {
  let hash = 0

  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }

  return Math.abs(hash)
}

const pickPreset = (location: string) => {
  const needle = location.toLowerCase()
  const found = WEATHER_PRESETS.find(
    (item) => item.location.toLowerCase() === needle,
  )

  if (found) {
    return found
  }

  const hash = hashText(location)
  const temperatureC = 5 + (hash % 21)
  const summaries = [
    'Bright dry air with a mild breeze',
    'Cloud layers moving quickly overhead',
    'Passing rain with brief clear windows',
    'Calm skies and comfortable visibility',
  ]

  return {
    location,
    temperatureC,
    summary: summaries[hash % summaries.length],
    status: hash % 2 === 0 ? 'steady' : 'refreshing',
  }
}

export const buildWeatherState = (location: string, statusOverride?: string) => {
  const report = pickPreset(location)

  return {
    location: report.location,
    status: statusOverride || report.status,
    temperatureText: `${report.temperatureC} \u00b0C`,
    summary: report.summary,
    updatedAt: new Date().toISOString(),
  }
}

export const buildForecastSeries = (location: string, offset: number) => {
  const report = pickPreset(location)
  const hash = hashText(`${location}:${offset}`)
  const temperatureC = report.temperatureC + ((hash % 5) - 2)
  const labels = ['Now', 'Soon', 'Later', 'Tonight', 'Tomorrow', 'Next day']

  return {
    attrs: {
      label: labels[offset % labels.length],
      temperatureText: `${temperatureC} \u00b0C`,
      summary: report.summary,
    },
  }
}

export const buildWeatherLocationRecord = (location: string) => ({
  attrs: {
    name: location,
  },
})

const INITIAL_LOCATIONS = [
  { name: 'Moscow', latitude: 55.7558, longitude: 37.6173, timezone: 'Europe/Moscow' },
  { name: 'Berlin', latitude: 52.52, longitude: 13.405, timezone: 'Europe/Berlin' },
  { name: 'Portland', latitude: 45.5152, longitude: -122.6784, timezone: 'America/Los_Angeles' },
  { name: 'Lisbon', latitude: 38.7223, longitude: -9.1393, timezone: 'Europe/Lisbon' },
]

export const buildSelectedLocationRecord = (weatherLocation: unknown) => ({
  rels: {
    weatherLocation,
  },
})

export const buildInitialWeatherLocations = () =>
  INITIAL_LOCATIONS.map(loc => ({
    attrs: {
      name: loc.name,
      latitude: loc.latitude,
      longitude: loc.longitude,
      timezone: loc.timezone,
    },
  }))

export const buildInitialSelectedLocations = (weatherLocations: unknown[]) => {
  if (!Array.isArray(weatherLocations)) {
    throw new Error('weatherLocation should resolve to list')
  }

  const [mainWeather, berlinWeather, portlandWeather, lisbonWeather] =
    weatherLocations

  return [
    buildSelectedLocationRecord(mainWeather),
    buildSelectedLocationRecord(berlinWeather),
    buildSelectedLocationRecord(portlandWeather),
    buildSelectedLocationRecord(lisbonWeather),
  ]
}

export const WEATHER_LOCATION_BASE_CREATION_SHAPE = {
  attrs: ['name', 'latitude', 'longitude', 'timezone'],
}

export const SELECTED_LOCATION_CREATION_SHAPE = {
  rels: {
    weatherLocation: {},
  },
}

export const CURRENT_WEATHER_CREATION_SHAPE = {
  attrs: [
    'location', 'status', 'temperatureText', 'summary', 'updatedAt',
    'temperatureC', 'apparentTemperatureC', 'weatherCode', 'isDay', 'windSpeed10m',
  ],
}

export const FORECAST_SERIES_CREATION_SHAPE = {
  attrs: [
    'label', 'temperatureText', 'summary',
    'time', 'date', 'temperatureC', 'temperatureMaxC', 'temperatureMinC',
    'precipitationProbability', 'precipitationProbabilityMax',
    'weatherCode', 'windSpeed10m', 'windSpeedMax', 'sunrise', 'sunset',
  ],
}
