import { appRoot } from 'dkt/appRoot.js'
import { merge as mergeDcl } from 'dkt/dcl/merge.js'
import { SessionRoot } from './SessionRoot'
import { SelectedLocation, WeatherLocation } from './rels'

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

const normalizeLocation = (value: unknown, fallback: string) => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  if (value && typeof value === 'object') {
    const candidate = (value as { location?: unknown }).location
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return fallback
}

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

const buildWeatherState = (location: string, statusOverride?: string) => {
  const report = pickPreset(location)

  return {
    location: report.location,
    status: statusOverride || report.status,
    temperatureText: `${report.temperatureC} \u00b0C`,
    summary: report.summary,
    updatedAt: new Date().toISOString(),
  }
}

const buildForecastSeries = (location: string, offset: number) => {
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

const buildWeatherLocationRecord = (
  location: string,
  options: { statusOverride?: string; forecastOffset?: number } = {},
) => {
  const report = pickPreset(location)
  const forecastOffset = options.forecastOffset ?? 0

  return {
    attrs: {
      name: report.location,
    },
    rels: {
      currentWeather: {
        attrs: buildWeatherState(location, options.statusOverride),
      },
      hourlyForecastSeries: [
        buildForecastSeries(location, forecastOffset),
        buildForecastSeries(location, forecastOffset + 1),
      ],
      dailyForecastSeries: [buildForecastSeries(location, forecastOffset + 2)],
    },
  }
}

const buildSelectedLocationRecord = (weatherLocation: any) => ({
  rels: {
    weatherLocation,
  },
})

const WEATHER_LOCATION_CREATION_SHAPE = {
  attrs: ['name'],
  rels: {
    currentWeather: {
      attrs: ['location', 'status', 'temperatureText', 'summary', 'updatedAt'],
    },
    hourlyForecastSeries: {
      attrs: ['label', 'temperatureText', 'summary'],
    },
    dailyForecastSeries: {
      attrs: ['label', 'temperatureText', 'summary'],
    },
  },
}

const SELECTED_LOCATION_CREATION_SHAPE = {
  rels: {
    weatherLocation: WEATHER_LOCATION_CREATION_SHAPE,
  },
}

const buildInitialWeatherLocations = () => [
  buildWeatherLocationRecord('Moscow', {
    statusOverride: 'ready',
    forecastOffset: 0,
  }),
  buildWeatherLocationRecord('Berlin', {
    statusOverride: 'steady',
    forecastOffset: 2,
  }),
  buildWeatherLocationRecord('Portland', {
    statusOverride: 'refreshing',
    forecastOffset: 4,
  }),
  buildWeatherLocationRecord('Lisbon', {
    statusOverride: 'ready',
    forecastOffset: 6,
  }),
]

const buildInitialSelectedLocations =  (
  root: any,
  weatherLocations: any[],
) => {
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

const app_props = mergeDcl({
  init: (target: { start_page?: unknown }) => {
    target.start_page = target
  },
  model_name: 'weather_app_root',
  rels: {
    $session_root: ['model', SessionRoot],
    common_session_root: ['input', { linking: '<< $session_root' }],
    sessions: ['input', { linking: '<< $session_root', many: true }],
    free_sessions: ['input', { linking: '<< $session_root', many: true }],
    weatherLocation: ['model', WeatherLocation, { many: true }],
    location: ['model', SelectedLocation, { many: true }],
    mainLocation: ['input', { linking: '<< location' }],
    additionalLocations: ['input', { linking: '<< location', many: true }],
    locations: [
      'input',
      {
        linking: ['<< mainLocation', '<< additionalLocations'],
        many: true,
      },
    ],
  },
  attrs: {
    location: ['input', 'Moscow'],
    status: ['input', 'booting'],
    temperatureText: ['input', '-- \u00b0C'],
    summary: ['input', 'Waiting for the first weather update'],
    updatedAt: ['input', null],
  },
  actions: {
    handleInit: [
      {
        to: {
          weatherLocation: [
            '<< weatherLocation',
            {
              method: 'set_many',
              can_create: true,
              creation_shape: WEATHER_LOCATION_CREATION_SHAPE,
            },
          ],
        },
        fn: () => buildInitialWeatherLocations(),
      },
      {
        to: {
          location: [
            '<< location',
            {
              method: 'set_many',
              can_create: true,
              map_values_list_to_target: true,
              creation_shape: SELECTED_LOCATION_CREATION_SHAPE,
            },
          ],
        },
        fn: [
          ['<< @all:weatherLocation'],
          (_payload: unknown, weatherLocations: any[]) => {
            return buildInitialSelectedLocations(null, weatherLocations)
          },
        ],
      },
    ],
    setLocation: {
      to: {
        location: ['location'],
        status: ['status'],
        temperatureText: ['temperatureText'],
        summary: ['summary'],
        updatedAt: ['updatedAt'],
      },
      fn: [
        ['location'],
        (payload: unknown, currentLocation: string) => {
          const nextLocation = normalizeLocation(payload, currentLocation)
          return buildWeatherState(nextLocation, 'ready')
        },
      ],
    },
    refreshWeather: {
      to: {
        location: ['location'],
        status: ['status'],
        temperatureText: ['temperatureText'],
        summary: ['summary'],
        updatedAt: ['updatedAt'],
      },
      fn: [
        ['location'],
        (_payload: unknown, currentLocation: string) =>
          buildWeatherState(currentLocation, 'refreshing'),
      ],
    },
  },
})

export const AppRoot = appRoot(app_props, app_props.init)
