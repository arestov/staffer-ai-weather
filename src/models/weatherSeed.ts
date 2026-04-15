const INITIAL_LOCATIONS = [
  { name: 'Reykjavik', latitude: 64.1466, longitude: -21.9426, timezone: 'Atlantic/Reykjavik' },
  { name: 'Singapore', latitude: 1.3521, longitude: 103.8198, timezone: 'Asia/Singapore' },
  { name: 'Vancouver', latitude: 49.2827, longitude: -123.1207, timezone: 'America/Vancouver' },
  { name: 'Cape Town', latitude: -33.9249, longitude: 18.4241, timezone: 'Africa/Johannesburg' },
]

export const buildSelectedLocationRecord = (weatherLocation: unknown, isAutoSelected = false) => ({
  attrs: {
    isAutoSelected,
  },
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

  const [mainWeather, singaporeWeather, vancouverWeather, capeTownWeather] =
    weatherLocations

  return [
    buildSelectedLocationRecord(mainWeather, true),
    buildSelectedLocationRecord(singaporeWeather),
    buildSelectedLocationRecord(vancouverWeather),
    buildSelectedLocationRecord(capeTownWeather),
  ]
}

export const WEATHER_LOCATION_BASE_CREATION_SHAPE = {
  attrs: ['name', 'latitude', 'longitude', 'timezone'],
}

export const WEATHER_LOCATION_LOADING_CREATION_SHAPE = {
  attrs: ['name', 'latitude', 'longitude', 'timezone', 'loadStatus', 'weatherLoadRequest'],
}

export const SELECTED_LOCATION_CREATION_SHAPE = {
  attrs: ['isAutoSelected'],
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
