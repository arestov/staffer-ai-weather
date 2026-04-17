import type { WeatherBackendApi } from '../../worker/weather-backend-api'
import type { LocationSearchResult } from '../WeatherLocation'
import { isLocationSearchResult } from '../WeatherLocation'
import { toErrorMessage } from '../weatherFormat'

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

const getLocationSearchResults = (value: unknown) => {
  return Array.isArray(value) ? value.filter(isLocationSearchResult) : []
}

export const appRootEffects = {
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
    weatherBackend: [
      ['_node_id'] as const,
      ['weatherBackendSource'] as const,
      (weatherBackendSource: unknown) => weatherBackendSource,
    ],
    geoLocation: [
      ['_node_id'] as const,
      ['geoLocationSource'] as const,
      (geoLocationSource: unknown) => geoLocationSource,
    ],
  },
  in: {
    detectGeoLocation: {
      type: 'state_request',
      name: 'detectGeoLocation',
      states: ['autoDetectedLocation'],
      api: 'geoLocationSource',
      parse: (result: unknown) => ({ autoDetectedLocation: result }),
      action: 'onAutoGeoDetected',
      fn: [
        [] as const,
        async (api: { detectLocation: () => Promise<unknown> }) => {
          return await api.detectLocation()
        },
      ],
    },
    syncSavedSearchLocationsData: {
      type: 'state_request',
      name: 'syncSavedSearchLocationsData',
      states: ['savedSearchLocationsSyncResult'],
      api: 'weatherBackendSource',
      parse: (result: unknown) => ({ savedSearchLocationsSyncResult: result }),
      fn: [
        ['savedSearchLocationsSyncRequest', 'savedSearchLocations'] as const,
        async (
          api: WeatherBackendApi | null,
          _opts: unknown,
          savedSearchLocationsSyncRequest: unknown,
          savedSearchLocations: unknown,
        ) => {
          if (!isSavedSearchLocationsSyncRequest(savedSearchLocationsSyncRequest)) {
            return { ok: false as const, message: 'Invalid sync request' }
          }

          try {
            const places = api
              ? savedSearchLocationsSyncRequest.kind === 'load'
                ? await api.fetchSavedSearchLocations()
                : savedSearchLocationsSyncRequest.kind === 'save'
                  ? await api.saveSavedSearchLocation(savedSearchLocationsSyncRequest.place)
                  : await api.removeSavedSearchLocation(savedSearchLocationsSyncRequest.placeId)
              : getLocationSearchResults(savedSearchLocations)

            return {
              ok: true as const,
              requestId: savedSearchLocationsSyncRequest.requestId,
              places,
            }
          } catch (error) {
            return {
              ok: false as const,
              requestId: savedSearchLocationsSyncRequest.requestId,
              message: toErrorMessage(error),
            }
          }
        },
      ],
    },
  },
  out: {
    applySavedSearchLocationsSyncData: {
      api: ['self'],
      trigger: ['savedSearchLocationsSyncResult'],
      require: ['savedSearchLocationsSyncResult'],
      create_when: {
        api_inits: true,
      },
      is_async: true,
      fn: [
        ['savedSearchLocationsSyncResult'] as const,
        async (
          self: { dispatch: (actionName: string, payload?: unknown) => Promise<void> | void },
          _task: unknown,
          savedSearchLocationsSyncResult: unknown,
        ) => {
          const result = savedSearchLocationsSyncResult as {
            ok: boolean
            requestId?: number
            places?: unknown[]
            message?: string
          }
          if (result.ok) {
            await self.dispatch('applySavedSearchLocationsSyncResult', {
              requestId: result.requestId,
              places: result.places,
            })
          } else if (result.requestId != null) {
            await self.dispatch('failSavedSearchLocationsSyncRequest', {
              requestId: result.requestId,
              message: result.message,
            })
          }
        },
      ],
    },
  },
} as const
