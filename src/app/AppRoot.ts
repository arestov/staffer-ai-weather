import { appRoot } from 'dkt/appRoot.js'
import { merge as mergeDcl } from 'dkt/dcl/merge.js'
import { SessionRoot } from './SessionRoot'
import { SelectedLocation, WeatherLocation } from './rels'
import type { LocationSearchResult } from './rels/location-models'
import {
  fetchSavedSearchLocations,
  removeSavedSearchLocation,
  saveSavedSearchLocation,
} from '../worker/weather-backend-api'
import {
  SELECTED_LOCATION_CREATION_SHAPE,
  WEATHER_LOCATION_BASE_CREATION_SHAPE,
  buildInitialSelectedLocations,
  buildInitialWeatherLocations,
} from './rels/weatherSeed'

type SavedSearchLocationsSyncStatus = 'idle' | 'loading' | 'syncing' | 'ready' | 'error'

type SavedSearchLocationsSyncRequest =
  | {
    requestId: number
    kind: 'load'
  }
  | {
    requestId: number
    kind: 'save'
    place: LocationSearchResult
  }
  | {
    requestId: number
    kind: 'remove'
    placeId: string
  }

type SavedSearchLocationsSyncResponsePayload = {
  requestId: number
  places: LocationSearchResult[]
}

type SavedSearchLocationsSyncFailurePayload = {
  requestId: number
  message: string
}

const isLocationSearchResult = (value: unknown): value is LocationSearchResult => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<LocationSearchResult>

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.subtitle === 'string' &&
    typeof candidate.latitude === 'number' &&
    typeof candidate.longitude === 'number'
  )
}

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

const toErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error)
}

const getLocationSearchResults = (value: unknown) => {
  return Array.isArray(value) ? value.filter(isLocationSearchResult) : []
}

const getNextSavedSearchLocationsSyncRequestId = (value: unknown) => {
  return typeof value === 'number' ? value + 1 : 1
}

const isSavedSearchLocationsSyncRequest = (
  value: unknown,
): value is SavedSearchLocationsSyncRequest => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<SavedSearchLocationsSyncRequest>

  if (typeof candidate.requestId !== 'number') {
    return false
  }

  if (candidate.kind === 'load') {
    return true
  }

  if (candidate.kind === 'save') {
    return isLocationSearchResult(candidate.place)
  }

  return candidate.kind === 'remove' && typeof candidate.placeId === 'string'
}

const isSavedSearchLocationsSyncResponsePayload = (
  value: unknown,
): value is SavedSearchLocationsSyncResponsePayload => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<SavedSearchLocationsSyncResponsePayload>

  return (
    typeof candidate.requestId === 'number' &&
    Array.isArray(candidate.places) &&
    candidate.places.every(isLocationSearchResult)
  )
}

const isSavedSearchLocationsSyncFailurePayload = (
  value: unknown,
): value is SavedSearchLocationsSyncFailurePayload => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<SavedSearchLocationsSyncFailurePayload>

  return (
    typeof candidate.requestId === 'number' &&
    typeof candidate.message === 'string'
  )
}

const makeRootParentRel = () => [
  'comp',
  ['<<<<'],
  (self: unknown) => self,
  { linking: '<<<<' },
] as const

const app_props = mergeDcl({
  init: (target: { start_page?: unknown }) => {
    target.start_page = target
  },
  model_name: 'weather_app_root',
  effects: {
    api: {
      locationSearch: [
        ['_node_id'] as const,
        ['locationSearchSource'] as const,
        (locationSearchSource: unknown) => locationSearchSource,
      ],
      weatherLoader: [
        ['_node_id'] as const,
        ['weatherLoaderSource'] as const,
        (weatherLoaderSource: unknown) => weatherLoaderSource,
      ],
    },
    out: {
      syncSavedSearchLocations: {
        api: ['self'],
        trigger: ['savedSearchLocationsSyncRequest'],
        require: ['savedSearchLocationsSyncRequest'],
        create_when: {
          api_inits: true,
        },
        is_async: true,
        fn: [
          ['savedSearchLocationsSyncRequest'] as const,
          async (
            self: {
              dispatch: (actionName: string, payload?: unknown) => Promise<void> | void
            },
            _task: unknown,
            savedSearchLocationsSyncRequest: unknown,
          ) => {
            if (!isSavedSearchLocationsSyncRequest(savedSearchLocationsSyncRequest)) {
              return
            }

            try {
              const places = savedSearchLocationsSyncRequest.kind === 'load'
                ? await fetchSavedSearchLocations()
                : savedSearchLocationsSyncRequest.kind === 'save'
                  ? await saveSavedSearchLocation(savedSearchLocationsSyncRequest.place)
                  : await removeSavedSearchLocation(savedSearchLocationsSyncRequest.placeId)

              await self.dispatch('applySavedSearchLocationsSyncResult', {
                requestId: savedSearchLocationsSyncRequest.requestId,
                places,
              })
            } catch (error) {
              await self.dispatch('failSavedSearchLocationsSyncRequest', {
                requestId: savedSearchLocationsSyncRequest.requestId,
                message: toErrorMessage(error),
              })
            }
          },
        ],
      },
    },
  },
  rels: {
    $session_root: ['model', SessionRoot],
    common_session_root: ['input', { linking: '<< $session_root' }],
    sessions: ['input', { linking: '<< $session_root', many: true }],
    free_sessions: ['input', { linking: '<< $session_root', many: true }],
    weatherLocation: ['model', WeatherLocation, { many: true }],
    location: ['model', SelectedLocation, { many: true }],
    nav_parent_at_perspectivator_weather_selected_location_popover_router:
      makeRootParentRel(),
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
    location: ['input', 'pending'],
    status: ['input', 'booting'],
    temperatureText: ['input', '-- \u00b0C'],
    summary: ['input', 'Waiting for backend weather data'],
    updatedAt: ['input', null],
    weatherLoadStatus: ['input', 'ready'],
    weatherLoadError: ['input', null],
    savedSearchLocations: ['input', []],
    savedSearchLocationsSyncStatus: ['input', 'idle'],
    savedSearchLocationsSyncError: ['input', null],
    savedSearchLocationsSyncRequest: ['input', null],
    activeSavedSearchLocationsSyncRequestId: ['input', 0],
  },
  actions: {
    setWeatherLoadState: {
      to: {
        weatherLoadStatus: ['weatherLoadStatus'],
        weatherLoadError: ['weatherLoadError'],
      },
      fn: (payload: { status: string; error: string | null }) => ({
        weatherLoadStatus: payload.status,
        weatherLoadError: payload.error,
      }),
    },
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
          ['<< @all:weatherLocation'] as const,
          (_payload: unknown, weatherLocations: unknown[]) => {
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
          ['<< @all:location'] as const,
          (_payload: unknown, locations: unknown[]) => {
            const [mainLocation, ...additionalLocations] = locations
            return {
              mainLocation,
              additionalLocations,
            }
          },
        ],
      },
      {
        to: {
          savedSearchLocationsSyncStatus: ['savedSearchLocationsSyncStatus'],
          savedSearchLocationsSyncError: ['savedSearchLocationsSyncError'],
          savedSearchLocationsSyncRequest: ['savedSearchLocationsSyncRequest'],
          activeSavedSearchLocationsSyncRequestId: ['activeSavedSearchLocationsSyncRequestId'],
        },
        fn: [
          ['activeSavedSearchLocationsSyncRequestId'] as const,
          (_payload: unknown, activeSavedSearchLocationsSyncRequestId: unknown) => {
            const requestId = getNextSavedSearchLocationsSyncRequestId(
              activeSavedSearchLocationsSyncRequestId,
            )

            return {
              savedSearchLocationsSyncStatus: 'loading',
              savedSearchLocationsSyncError: null,
              savedSearchLocationsSyncRequest: {
                requestId,
                kind: 'load',
              },
              activeSavedSearchLocationsSyncRequestId: requestId,
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

          return {
            location: nextLocation,
            status: 'loading',
            temperatureText: '-- \u00b0C',
            summary: 'Waiting for backend weather data',
            updatedAt: null,
          }
        },
      ],
    },
    saveLocationSearchResult: {
      to: {
        savedSearchLocations: ['savedSearchLocations'],
        savedSearchLocationsSyncStatus: ['savedSearchLocationsSyncStatus'],
        savedSearchLocationsSyncError: ['savedSearchLocationsSyncError'],
        savedSearchLocationsSyncRequest: ['savedSearchLocationsSyncRequest'],
        activeSavedSearchLocationsSyncRequestId: ['activeSavedSearchLocationsSyncRequestId'],
      },
      fn: [
        ['savedSearchLocations', 'activeSavedSearchLocationsSyncRequestId'] as const,
        (
          payload: unknown,
          savedSearchLocations: unknown,
          activeSavedSearchLocationsSyncRequestId: unknown,
        ) => {
          if (!isLocationSearchResult(payload)) {
            return {}
          }

          const currentSavedLocations = getLocationSearchResults(savedSearchLocations)
          const requestId = getNextSavedSearchLocationsSyncRequestId(
            activeSavedSearchLocationsSyncRequestId,
          )

          return {
            savedSearchLocations: [
              payload,
              ...currentSavedLocations.filter((item) => item.id !== payload.id),
            ],
            savedSearchLocationsSyncStatus: 'syncing',
            savedSearchLocationsSyncError: null,
            savedSearchLocationsSyncRequest: {
              requestId,
              kind: 'save',
              place: payload,
            },
            activeSavedSearchLocationsSyncRequestId: requestId,
          }
        },
      ],
    },
    removeLocationSearchResult: {
      to: {
        savedSearchLocations: ['savedSearchLocations'],
        savedSearchLocationsSyncStatus: ['savedSearchLocationsSyncStatus'],
        savedSearchLocationsSyncError: ['savedSearchLocationsSyncError'],
        savedSearchLocationsSyncRequest: ['savedSearchLocationsSyncRequest'],
        activeSavedSearchLocationsSyncRequestId: ['activeSavedSearchLocationsSyncRequestId'],
      },
      fn: [
        ['savedSearchLocations', 'activeSavedSearchLocationsSyncRequestId'] as const,
        (
          payload: unknown,
          savedSearchLocations: unknown,
          activeSavedSearchLocationsSyncRequestId: unknown,
        ) => {
          const id = typeof payload === 'string'
            ? payload
            : isLocationSearchResult(payload)
              ? payload.id
              : ''

          if (!id) {
            return {}
          }

          const currentSavedLocations = getLocationSearchResults(savedSearchLocations)
          const requestId = getNextSavedSearchLocationsSyncRequestId(
            activeSavedSearchLocationsSyncRequestId,
          )

          return {
            savedSearchLocations: currentSavedLocations.filter((item) => item.id !== id),
            savedSearchLocationsSyncStatus: 'syncing',
            savedSearchLocationsSyncError: null,
            savedSearchLocationsSyncRequest: {
              requestId,
              kind: 'remove',
              placeId: id,
            },
            activeSavedSearchLocationsSyncRequestId: requestId,
          }
        },
      ],
    },
    applySavedSearchLocationsSyncResult: {
      to: {
        savedSearchLocations: ['savedSearchLocations'],
        savedSearchLocationsSyncStatus: ['savedSearchLocationsSyncStatus'],
        savedSearchLocationsSyncError: ['savedSearchLocationsSyncError'],
        savedSearchLocationsSyncRequest: ['savedSearchLocationsSyncRequest'],
      },
      fn: [
        ['$noop', 'activeSavedSearchLocationsSyncRequestId'] as const,
        (
          payload: unknown,
          noop: unknown,
          activeSavedSearchLocationsSyncRequestId: unknown,
        ) => {
          if (
            !isSavedSearchLocationsSyncResponsePayload(payload) ||
            typeof activeSavedSearchLocationsSyncRequestId !== 'number' ||
            payload.requestId !== activeSavedSearchLocationsSyncRequestId
          ) {
            return noop
          }

          return {
            savedSearchLocations: payload.places,
            savedSearchLocationsSyncStatus: 'ready',
            savedSearchLocationsSyncError: null,
            savedSearchLocationsSyncRequest: null,
          }
        },
      ],
    },
    failSavedSearchLocationsSyncRequest: {
      to: {
        savedSearchLocationsSyncStatus: ['savedSearchLocationsSyncStatus'],
        savedSearchLocationsSyncError: ['savedSearchLocationsSyncError'],
        savedSearchLocationsSyncRequest: ['savedSearchLocationsSyncRequest'],
      },
      fn: [
        ['$noop', 'activeSavedSearchLocationsSyncRequestId'] as const,
        (
          payload: unknown,
          noop: unknown,
          activeSavedSearchLocationsSyncRequestId: unknown,
        ) => {
          if (
            !isSavedSearchLocationsSyncFailurePayload(payload) ||
            typeof activeSavedSearchLocationsSyncRequestId !== 'number' ||
            payload.requestId !== activeSavedSearchLocationsSyncRequestId
          ) {
            return noop
          }

          return {
            savedSearchLocationsSyncStatus: 'error',
            savedSearchLocationsSyncError: payload.message,
            savedSearchLocationsSyncRequest: null,
          }
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
        (_payload: unknown, currentLocation: string) => {
          return {
            location: currentLocation,
            status: 'loading',
            temperatureText: '-- \u00b0C',
            summary: 'Waiting for backend weather data',
            updatedAt: null,
          }
        },
      ],
    },
  },
})

export const AppRoot = appRoot(app_props, app_props.init)
