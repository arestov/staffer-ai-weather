import { appRoot } from 'dkt/appRoot.js'
import { merge as mergeDcl } from 'dkt/dcl/merge.js'
import { appRootEffects } from './AppRoot/effects'
import { SelectedLocation } from './SelectedLocation'
import { SessionRoot } from './SessionRoot'
import type { LocationSearchResult } from './WeatherLocation'
import { isLocationSearchResult, WeatherLocation } from './WeatherLocation'
import { toErrorMessage } from './weatherFormat'
import {
  buildInitialSelectedLocations,
  buildInitialWeatherLocations,
  SELECTED_LOCATION_CREATION_SHAPE,
  WEATHER_LOCATION_BASE_CREATION_SHAPE,
} from './weatherSeed'

type SavedSearchLocationsSyncStatus = 'idle' | 'loading' | 'syncing' | 'ready' | 'error'

type SavedSearchLocationsSyncResponsePayload = {
  requestId: number
  places: LocationSearchResult[]
}

type SavedSearchLocationsSyncFailurePayload = {
  requestId: number
  message: string
}

const getLocationSearchResults = (value: unknown) => {
  return Array.isArray(value) ? value.filter(isLocationSearchResult) : []
}

const getNextSavedSearchLocationsSyncRequestId = (value: unknown) => {
  return typeof value === 'number' ? value + 1 : 1
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const formatUpdatedAt = (value: string | null): { short: string; full: string } | null => {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return { short: value, full: value }
  }

  return {
    short: `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    full: date.toLocaleString(),
  }
}

const toSeconds = (value: unknown): string => {
  return typeof value === 'string' ? value.replace(/\.\d+Z$/, 'Z') : ''
}

const buildWeatherUpdatedSummary = (
  weatherFetchedAtSource: unknown,
  namesSource: unknown,
): { dateTime: string | null; shortText: string; title: string } | null => {
  const weatherFetchedAtValues = Array.isArray(weatherFetchedAtSource) ? weatherFetchedAtSource : []
  const names = Array.isArray(namesSource) ? namesSource : []

  if (!weatherFetchedAtValues.length) {
    return null
  }

  const mainTime = typeof weatherFetchedAtValues[0] === 'string' ? weatherFetchedAtValues[0] : null
  const mainFmt = formatUpdatedAt(mainTime)

  if (!mainFmt) {
    return null
  }

  const mainSeconds = toSeconds(mainTime)
  const allSame = weatherFetchedAtValues.every((value) => toSeconds(value) === mainSeconds)

  if (allSame) {
    return {
      dateTime: mainTime,
      shortText: `⟳ ${mainFmt.short}`,
      title: `Updated: ${mainFmt.full}`,
    }
  }

  const diffParts: string[] = []
  const fullParts: string[] = []

  for (let index = 0; index < weatherFetchedAtValues.length; index += 1) {
    const time =
      typeof weatherFetchedAtValues[index] === 'string' ? weatherFetchedAtValues[index] : null
    const fmt = formatUpdatedAt(time)

    if (!fmt) {
      continue
    }

    const nameValue = names[index]
    const name = typeof nameValue === 'string' && nameValue ? nameValue : '?'

    fullParts.push(`${name}: ${fmt.full}`)

    if (toSeconds(time) !== mainSeconds) {
      diffParts.push(`${name} ${fmt.short}`)
    }
  }

  return {
    dateTime: mainTime,
    shortText: `⟳ ${mainFmt.short}${diffParts.length > 0 ? ` · ${diffParts.join(', ')}` : ''}`,
    title: fullParts.join('\n'),
  }
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

  return typeof candidate.requestId === 'number' && typeof candidate.message === 'string'
}

const makeRootParentRel = () =>
  ['comp', ['<<<<'], (self: unknown) => self, { linking: '<<<<' }] as const

const app_props = mergeDcl({
  init: (target: { start_page?: unknown }) => {
    target.start_page = target
  },
  model_name: 'weather_app_root',
  effects: appRootEffects,
  rels: {
    $session_root: ['model', SessionRoot],
    common_session_root: ['input', { linking: '<< $session_root' }],
    sessions: ['input', { linking: '<< $session_root', many: true }],
    free_sessions: ['input', { linking: '<< $session_root', many: true }],
    weatherLocation: ['model', WeatherLocation, { many: true }],
    location: ['model', SelectedLocation, { many: true }],
    nav_parent_at_perspectivator_weather_selected_location_popover_router: makeRootParentRel(),
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
    weatherUpdatedSummary: [
      'comp',
      ['< @all:weatherFetchedAt < weatherLocation', '< @all:name < weatherLocation'],
      buildWeatherUpdatedSummary,
    ],
    weatherLoadStatus: [
      'comp',
      ['< @all:loadStatus < weatherLocation'],
      (statuses: unknown[]) => {
        const values = Array.isArray(statuses) ? statuses : []
        if (values.some((s) => s === 'loading')) return 'loading'
        if (values.some((s) => s === 'error')) return 'error'
        if (values.every((s) => s === 'ready')) return 'ready'
        return 'ready'
      },
    ],
    weatherLoadError: [
      'comp',
      ['< @all:loadStatus < weatherLocation', '< @all:lastError < weatherLocation'],
      (statuses: unknown[], errors: unknown[]) => {
        const statusValues = Array.isArray(statuses) ? statuses : []
        const errorValues = Array.isArray(errors) ? errors : []
        for (let i = 0; i < statusValues.length; i++) {
          if (statusValues[i] === 'error' && typeof errorValues[i] === 'string') {
            return errorValues[i]
          }
        }
        return null
      },
    ],
    savedSearchLocations: ['input', []],
    savedSearchLocationsSyncStatus: ['input', 'idle'],
    savedSearchLocationsSyncError: ['input', null],
    savedSearchLocationsSyncRequest: ['input', null],
    activeSavedSearchLocationsSyncRequestId: ['input', 0],
    savedSearchLocationsSyncResult: ['input', null],
    autoGeoStatus: ['input', 'idle'],
    autoGeoError: ['input', null],
    autoDetectedLocation: ['input', null],
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
          _fxWeather: ['< $fx_loadWeather < weatherLocation', { intent: 'request' }],
        },
        fn: [
          ['$now'] as const,
          (_payload: unknown, now: number) => ({
            _fxWeather: { at: now },
          }),
        ],
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
          _fxSync: ['$fx_syncSavedSearchLocationsData', { intent: 'reload' }],
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
              _fxSync: {},
            }
          },
        ],
      },
      {
        to: {
          autoGeoStatus: ['autoGeoStatus'],
          autoGeoError: ['autoGeoError'],
          _fxGeo: ['$fx_detectGeoLocation', { intent: 'request' }],
        },
        fn: () => ({
          autoGeoStatus: 'pending',
          autoGeoError: null,
          _fxGeo: {},
        }),
      },
    ],
    saveLocationSearchResult: {
      to: {
        savedSearchLocations: ['savedSearchLocations'],
        savedSearchLocationsSyncStatus: ['savedSearchLocationsSyncStatus'],
        savedSearchLocationsSyncError: ['savedSearchLocationsSyncError'],
        savedSearchLocationsSyncRequest: ['savedSearchLocationsSyncRequest'],
        activeSavedSearchLocationsSyncRequestId: ['activeSavedSearchLocationsSyncRequestId'],
        _fxSync: ['$fx_syncSavedSearchLocationsData', { intent: 'reload' }],
      },
      fn: [
        ['$noop', 'savedSearchLocations', 'activeSavedSearchLocationsSyncRequestId'] as const,
        (
          payload: unknown,
          noop: unknown,
          savedSearchLocations: unknown,
          activeSavedSearchLocationsSyncRequestId: unknown,
        ) => {
          if (!isLocationSearchResult(payload)) {
            return noop
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
            _fxSync: {},
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
        _fxSync: ['$fx_syncSavedSearchLocationsData', { intent: 'reload' }],
      },
      fn: [
        ['$noop', 'savedSearchLocations', 'activeSavedSearchLocationsSyncRequestId'] as const,
        (
          payload: unknown,
          noop: unknown,
          savedSearchLocations: unknown,
          activeSavedSearchLocationsSyncRequestId: unknown,
        ) => {
          const id =
            typeof payload === 'string'
              ? payload
              : isLocationSearchResult(payload)
                ? payload.id
                : ''

          if (!id) {
            return noop
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
            _fxSync: {},
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
        (payload: unknown, noop: unknown, activeSavedSearchLocationsSyncRequestId: number) => {
          if (
            !isSavedSearchLocationsSyncResponsePayload(payload) ||
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
        (payload: unknown, noop: unknown, activeSavedSearchLocationsSyncRequestId: number) => {
          if (
            !isSavedSearchLocationsSyncFailurePayload(payload) ||
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
    applyAutoDetectedLocation: [
      {
        to: {
          autoGeoStatus: ['autoGeoStatus'],
          autoGeoError: ['autoGeoError'],
          applyAutoLocation: [
            '<< mainLocation',
            { action: 'applyAutoLocation', inline_subwalker: true },
          ],
        },
        fn: (payload: unknown) => {
          if (!isLocationSearchResult(payload)) {
            return {}
          }

          return {
            autoGeoStatus: 'done',
            autoGeoError: null,
            applyAutoLocation: payload,
          }
        },
      },
    ],
    failAutoGeoDetection: {
      to: {
        autoGeoStatus: ['autoGeoStatus'],
        autoGeoError: ['autoGeoError'],
      },
      fn: (payload: unknown) => ({
        autoGeoStatus: 'error',
        autoGeoError: typeof payload === 'string' ? payload : toErrorMessage(payload),
      }),
    },
    retryWeatherLoad: {
      to: {
        _retryAllLocations: [
          '<< weatherLocation',
          {
            action: 'retryWeatherLoad',
          },
        ],
      },
      fn: [
        ['$now'] as const,
        (_payload: unknown, now: number) => ({
          _retryAllLocations: { at: now },
        }),
      ],
    },
  },
})

export const AppRoot = appRoot(app_props, app_props.init)
