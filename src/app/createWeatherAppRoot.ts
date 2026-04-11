import { appRoot } from 'dkt/appRoot.js'
import { merge as mergeDcl } from 'dkt/dcl/merge.js'
import { createWeatherSessionRoot } from './createWeatherSessionRoot'

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

const app_props = mergeDcl({
  init: (target: { start_page?: unknown }) => {
    target.start_page = target
  },
  model_name: 'weather_app_root',
  rels: {
    $session_root: ['model', createWeatherSessionRoot()],
    common_session_root: ['input', { linking: '<< $session_root' }],
    sessions: ['input', { linking: '<< $session_root', many: true }],
    free_sessions: ['input', { linking: '<< $session_root', many: true }],
  },
  attrs: {
    location: ['input', 'Moscow'],
    status: ['input', 'booting'],
    temperatureText: ['input', '-- \u00b0C'],
    summary: ['input', 'Waiting for the first weather update'],
    updatedAt: ['input', null],
  },
  actions: {
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

const createWeatherStartPage = () => appRoot(app_props, app_props.init)

export const createWeatherAppRoot = () => {
  const AppRoot = createWeatherStartPage()
  return { AppRoot }
}
