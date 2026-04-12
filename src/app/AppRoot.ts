import { appRoot } from 'dkt/appRoot.js'
import { merge as mergeDcl } from 'dkt/dcl/merge.js'
import { SessionRoot } from './SessionRoot'
import { SelectedLocation, WeatherLocation } from './rels'
import {
  SELECTED_LOCATION_CREATION_SHAPE,
  WEATHER_LOCATION_BASE_CREATION_SHAPE,
  buildInitialSelectedLocations,
  buildInitialWeatherLocations,
  buildWeatherState,
} from './rels/weatherSeed'

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
              creation_shape: WEATHER_LOCATION_BASE_CREATION_SHAPE,
            },
          ],
        },
        fn: () => {
          const records = buildInitialWeatherLocations()
          return {
            weatherLocation: records,
          }
        },
      },
      {
        to: {
          location: [
            '<< location',
            {
              method: 'set_many',
              can_create: true,
              creation_shape: SELECTED_LOCATION_CREATION_SHAPE,
            },
          ],
        },
        fn: [
          ['<< @all:weatherLocation'],
          (_payload: unknown, weatherLocations: any[]) => {
            const records = buildInitialSelectedLocations(weatherLocations)
            return {
              location: records,
            }
          },
        ],
      },
      {
        to: {
          mainLocation: [
            '<< mainLocation',
            {
              method: 'set_one',
              can_create: true,
              creation_shape: SELECTED_LOCATION_CREATION_SHAPE,
            },
          ],
          additionalLocations: [
            '<< additionalLocations',
            {
              method: 'set_many',
              can_create: true,
              creation_shape: SELECTED_LOCATION_CREATION_SHAPE,
            },
          ],
        },
        fn: [
          ['<< @all:location'],
          (_payload: unknown, locations: any[]) => {
            const [mainLocation, ...additionalLocations] = locations
            return {
              mainLocation,
              additionalLocations,
            }
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
