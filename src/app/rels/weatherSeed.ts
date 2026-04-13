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
