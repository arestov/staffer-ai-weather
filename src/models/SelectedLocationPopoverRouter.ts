import { input as inputAttrs } from 'dkt/dcl/attrs/input.js'
import { model } from 'dkt/model.js'
import { Router as RouterCore } from 'dkt-all/models/Router.js'
import { isLocationSearchResult } from './WeatherLocation'
import type { LocationSearchResult } from './WeatherLocation'
import { toErrorMessage } from './weatherFormat'

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error'

type SearchRequest = {
  requestId: number
  query: string
}

type SearchResponsePayload = {
  requestId: number
  results: LocationSearchResult[]
}

type SearchFailurePayload = {
  requestId: number
  message: string
}

type CurrentLocationStatus = 'idle' | 'loading' | 'error'

type CurrentLocationRequest =
  | {
    requestId: number
    kind: 'browserCoordinates'
    latitude: number
    longitude: number
  }
  | {
    requestId: number
    kind: 'fallback'
  }

type CurrentLocationResponsePayload = {
  requestId: number
  result: LocationSearchResult
}

type CurrentLocationFailurePayload = {
  requestId: number
  message: string
}

const MIN_LOCATION_SEARCH_QUERY_LENGTH = 3

const normalizeSearchInput = (value: unknown) => {
  if (typeof value === 'string') {
    return value
  }

  if (value && typeof value === 'object') {
    const candidate = value as { query?: unknown; seedQuery?: unknown }

    if (typeof candidate.query === 'string') {
      return candidate.query
    }

    if (typeof candidate.seedQuery === 'string') {
      return candidate.seedQuery
    }
  }

  return ''
}

const normalizeSearchRequestQuery = (value: unknown) => {
  return normalizeSearchInput(value).trim()
}

const isSearchRequest = (value: unknown): value is SearchRequest => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<SearchRequest>

  return (
    typeof candidate.requestId === 'number' &&
    typeof candidate.query === 'string'
  )
}

const isSearchResponsePayload = (value: unknown): value is SearchResponsePayload => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<SearchResponsePayload>

  return (
    typeof candidate.requestId === 'number' &&
    Array.isArray(candidate.results) &&
    candidate.results.every(isLocationSearchResult)
  )
}

const isSearchFailurePayload = (value: unknown): value is SearchFailurePayload => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<SearchFailurePayload>

  return (
    typeof candidate.requestId === 'number' &&
    typeof candidate.message === 'string'
  )
}

const buildSearchResetState = (
  requestId: number,
  overrides: Partial<{
    isEditingLocation: boolean
    searchQuery: string
    searchStatus: SearchStatus
    currentLocationStatus: CurrentLocationStatus
  }> = {},
) => ({
  isEditingLocation: overrides.isEditingLocation ?? false,
  searchQuery: overrides.searchQuery ?? '',
  searchStatus: overrides.searchStatus ?? 'idle',
  searchError: null,
  searchResults: [],
  searchRequest: null,
  activeSearchRequestId: requestId,
  currentLocationStatus: overrides.currentLocationStatus ?? 'idle',
  currentLocationError: null,
  currentLocationRequest: null,
})

const buildSearchingState = (
  query: string,
  requestId: number,
  searchResults: LocationSearchResult[] = [],
) => ({
  isEditingLocation: true,
  searchQuery: query,
  searchStatus: 'loading' as const,
  searchError: null,
  searchResults,
  searchRequest: {
    requestId,
    query,
  },
  activeSearchRequestId: requestId,
  currentLocationStatus: 'idle' as const,
  currentLocationError: null,
  currentLocationRequest: null,
})

const normalizeBrowserCoordinates = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as {
    latitude?: unknown
    longitude?: unknown
  }

  if (typeof candidate.latitude !== 'number' || typeof candidate.longitude !== 'number') {
    return null
  }

  return {
    latitude: candidate.latitude,
    longitude: candidate.longitude,
  }
}

const isCurrentLocationRequest = (value: unknown): value is CurrentLocationRequest => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<CurrentLocationRequest>

  if (typeof candidate.requestId !== 'number') {
    return false
  }

  if (candidate.kind === 'fallback') {
    return true
  }

  return (
    candidate.kind === 'browserCoordinates' &&
    typeof candidate.latitude === 'number' &&
    typeof candidate.longitude === 'number'
  )
}

const isCurrentLocationResponsePayload = (value: unknown): value is CurrentLocationResponsePayload => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<CurrentLocationResponsePayload>

  return typeof candidate.requestId === 'number' && isLocationSearchResult(candidate.result)
}

const isCurrentLocationFailurePayload = (value: unknown): value is CurrentLocationFailurePayload => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<CurrentLocationFailurePayload>

  return typeof candidate.requestId === 'number' && typeof candidate.message === 'string'
}

export const SelectedLocationPopoverRouter = model({
  extends: RouterCore,
  model_name: 'weather_selected_location_popover_router',
  is_simple_router: true,
  attrs: {
    ...inputAttrs({
      url_part: null,
      full_page_need: null,
      works_without_main_resident: true,
    }),
    isEditingLocation: ['input', false],
    searchQuery: ['input', ''],
    searchStatus: ['input', 'idle'],
    searchError: ['input', null],
    searchResults: ['input', []],
    currentLocationStatus: ['input', 'idle'],
    currentLocationError: ['input', null],
    currentLocationRequest: ['input', null],
    activeCurrentLocationRequestId: ['input', 0],
    savedSearchLocations: [
      'comp',
      ['< @one:savedSearchLocations < $root'],
      (savedSearchLocations: unknown) => (Array.isArray(savedSearchLocations) ? savedSearchLocations : []),
    ],
    searchResponseData: ['input', null],
    currentLocationResponseData: ['input', null],
    searchRequest: ['input', null],
    activeSearchRequestId: ['input', 0],
  },
  effects: {
    api: {
      locationSearchApi: [
        ['_node_id'] as const,
        ['#locationSearch'] as const,
        (locationSearch: unknown) => locationSearch,
      ],
      geoLocationApi: [
        ['_node_id'] as const,
        ['#geoLocation'] as const,
        (geoLocation: unknown) => geoLocation,
      ],
    },
    in: {
      executeLocationSearch: {
        type: 'state_request',
        name: 'executeLocationSearch',
        states: ['searchResponseData'],
        api: 'locationSearchApi',
        parse: (result: unknown) => ({ searchResponseData: result }),
        fn: [
          ['searchRequest'] as const,
          async (
            api: { search: (query: string) => Promise<unknown> },
            _opts: unknown,
            searchRequest: unknown,
          ) => {
            if (!isSearchRequest(searchRequest)) {
              return { ok: false as const, message: 'Invalid search request' }
            }

            try {
              const results = await api.search(searchRequest.query)
              return {
                ok: true as const,
                requestId: searchRequest.requestId,
                results,
              }
            } catch (error) {
              return {
                ok: false as const,
                requestId: searchRequest.requestId,
                message: toErrorMessage(error),
              }
            }
          },
        ],
      },
      executeCurrentLocationLookup: {
        type: 'state_request',
        name: 'executeCurrentLocationLookup',
        states: ['currentLocationResponseData'],
        api: 'geoLocationApi',
        parse: (result: unknown) => ({ currentLocationResponseData: result }),
        fn: [
          ['currentLocationRequest'] as const,
          async (
            api: {
              detectLocation: () => Promise<unknown>
              detectLocationByCoordinates: (coords: { latitude: number; longitude: number }) => Promise<unknown>
            },
            _opts: unknown,
            currentLocationRequest: unknown,
          ) => {
            if (!isCurrentLocationRequest(currentLocationRequest)) {
              return { ok: false as const, message: 'Invalid current location request' }
            }

            try {
              const result = currentLocationRequest.kind === 'browserCoordinates'
                ? await api.detectLocationByCoordinates({
                  latitude: currentLocationRequest.latitude,
                  longitude: currentLocationRequest.longitude,
                })
                : await api.detectLocation()
              return {
                ok: true as const,
                requestId: currentLocationRequest.requestId,
                result,
              }
            } catch (error) {
              return {
                ok: false as const,
                requestId: currentLocationRequest.requestId,
                message: toErrorMessage(error),
              }
            }
          },
        ],
      },
    },
    out: {
      triggerLocationSearch: {
        api: ['self', 'locationSearchApi'],
        trigger: ['searchRequest'],
        require: ['searchRequest'],
        create_when: {
          api_inits: true,
        },
        fn: (
          self: {
            resetRequestedState: (name: string) => unknown
            input: (callback: () => void) => unknown
            requestState: (name: string) => unknown
          },
        ) => {
          self.resetRequestedState('searchResponseData')
          self.input(() => {
            self.requestState('searchResponseData')
          })
        },
      },
      applySearchResponseData: {
        api: ['self'],
        trigger: ['searchResponseData'],
        require: ['searchResponseData'],
        create_when: {
          api_inits: true,
        },
        is_async: true,
        fn: [
          ['searchResponseData'] as const,
          async (
            self: { dispatch: (actionName: string, payload?: unknown) => Promise<void> | void },
            _task: unknown,
            searchResponseData: unknown,
          ) => {
            const result = searchResponseData as {
              ok: boolean
              requestId?: number
              results?: unknown[]
              message?: string
            }
            if (result.ok) {
              await self.dispatch('applyLocationSearchResponse', {
                requestId: result.requestId,
                results: result.results,
              })
            } else if (result.requestId != null) {
              await self.dispatch('failLocationSearchResponse', {
                requestId: result.requestId,
                message: result.message,
              })
            }
          },
        ],
      },
      triggerCurrentLocationLookup: {
        api: ['self', 'geoLocationApi'],
        trigger: ['currentLocationRequest'],
        require: ['currentLocationRequest'],
        create_when: {
          api_inits: true,
        },
        fn: (
          self: {
            resetRequestedState: (name: string) => unknown
            input: (callback: () => void) => unknown
            requestState: (name: string) => unknown
          },
        ) => {
          self.resetRequestedState('currentLocationResponseData')
          self.input(() => {
            self.requestState('currentLocationResponseData')
          })
        },
      },
      applyCurrentLocationResult: {
        api: ['self'],
        trigger: ['currentLocationResponseData'],
        require: ['currentLocationResponseData'],
        create_when: {
          api_inits: true,
        },
        is_async: true,
        fn: [
          ['currentLocationResponseData'] as const,
          async (
            self: { dispatch: (actionName: string, payload?: unknown) => Promise<void> | void },
            _task: unknown,
            currentLocationResponseData: unknown,
          ) => {
            const result = currentLocationResponseData as {
              ok: boolean
              requestId?: number
              result?: unknown
              message?: string
            }
            if (result.ok) {
              await self.dispatch('applyCurrentLocationLookupResponse', {
                requestId: result.requestId,
                result: result.result,
              })
            } else if (result.requestId != null) {
              await self.dispatch('failCurrentLocationLookupResponse', {
                requestId: result.requestId,
                message: result.message,
              })
            }
          },
        ],
      },
    },
  },
  actions: {
    'handleRel:current_mp_md': {
      to: {
        isEditingLocation: ['isEditingLocation'],
        searchQuery: ['searchQuery'],
        searchStatus: ['searchStatus'],
        searchError: ['searchError'],
        searchResults: ['searchResults'],
        currentLocationStatus: ['currentLocationStatus'],
        currentLocationError: ['currentLocationError'],
        currentLocationRequest: ['currentLocationRequest'],
        searchRequest: ['searchRequest'],
        activeSearchRequestId: ['activeSearchRequestId'],
      },
      fn: [
        ['$noop', 'activeSearchRequestId'] as const,
        (
          payload: { next_value?: unknown; prev_value?: unknown },
          noop: unknown,
          activeSearchRequestId: number,
        ) => {
          if (payload.next_value === payload.prev_value) {
            return noop
          }

          return buildSearchResetState(activeSearchRequestId + 1)
        },
      ],
    },
    startLocationEditing: {
      to: {
        isEditingLocation: ['isEditingLocation'],
        searchQuery: ['searchQuery'],
        searchStatus: ['searchStatus'],
        searchError: ['searchError'],
        searchResults: ['searchResults'],
        currentLocationStatus: ['currentLocationStatus'],
        currentLocationError: ['currentLocationError'],
        currentLocationRequest: ['currentLocationRequest'],
        searchRequest: ['searchRequest'],
        activeSearchRequestId: ['activeSearchRequestId'],
      },
      fn: [
        ['activeSearchRequestId'] as const,
        (payload: unknown, activeSearchRequestId: number) => {
          return buildSearchResetState(activeSearchRequestId + 1, {
            isEditingLocation: true,
            searchQuery: normalizeSearchInput(payload),
          })
        },
      ],
    },
    updateLocationSearchQuery: {
      to: {
        searchQuery: ['searchQuery'],
        searchStatus: ['searchStatus'],
        searchError: ['searchError'],
        currentLocationStatus: ['currentLocationStatus'],
        currentLocationError: ['currentLocationError'],
        currentLocationRequest: ['currentLocationRequest'],
        searchRequest: ['searchRequest'],
        activeSearchRequestId: ['activeSearchRequestId'],
      },
      fn: [
        ['activeSearchRequestId'] as const,
        (payload: unknown, activeSearchRequestId: number) => {
          return {
            searchQuery: normalizeSearchInput(payload).trim(),
            searchStatus: 'idle',
            searchError: null,
            searchRequest: null,
            activeSearchRequestId: activeSearchRequestId + 1,
          }
        },
      ],
    },
    submitLocationSearch: {
      to: {
        isEditingLocation: ['isEditingLocation'],
        searchQuery: ['searchQuery'],
        searchStatus: ['searchStatus'],
        searchError: ['searchError'],
        searchResults: ['searchResults'],
        currentLocationStatus: ['currentLocationStatus'],
        currentLocationError: ['currentLocationError'],
        currentLocationRequest: ['currentLocationRequest'],
        searchRequest: ['searchRequest'],
        activeSearchRequestId: ['activeSearchRequestId'],
      },
      fn: [
        ['searchQuery', 'searchResults', 'activeSearchRequestId'] as const,
        (
          payload: unknown,
          searchQuery: unknown,
          searchResults: unknown,
          activeSearchRequestId: number,
        ) => {
          const query = normalizeSearchRequestQuery(payload) || normalizeSearchRequestQuery(searchQuery)

          if (query.length < MIN_LOCATION_SEARCH_QUERY_LENGTH) {
            return {}
          }

          return buildSearchingState(
            query,
            activeSearchRequestId + 1,
            Array.isArray(searchResults) ? searchResults.filter((item) => Boolean(item)) : [],
          )
        },
      ],
    },
    cancelLocationEditing: {
      to: {
        isEditingLocation: ['isEditingLocation'],
        searchQuery: ['searchQuery'],
        searchStatus: ['searchStatus'],
        searchError: ['searchError'],
        searchResults: ['searchResults'],
        currentLocationStatus: ['currentLocationStatus'],
        currentLocationError: ['currentLocationError'],
        currentLocationRequest: ['currentLocationRequest'],
        searchRequest: ['searchRequest'],
        activeSearchRequestId: ['activeSearchRequestId'],
      },
      fn: [
        ['activeSearchRequestId'] as const,
        (_payload: unknown, activeSearchRequestId: number) => {
          return buildSearchResetState(activeSearchRequestId + 1)
        },
      ],
    },
    applyLocationSearchResponse: {
      to: {
        searchStatus: ['searchStatus'],
        searchError: ['searchError'],
        searchResults: ['searchResults'],
      },
      fn: [
        ['$noop', 'activeSearchRequestId'] as const,
        (payload: unknown, noop: unknown, activeSearchRequestId: number) => {
          if (
            !isSearchResponsePayload(payload) ||
            payload.requestId !== activeSearchRequestId
          ) {
            return noop
          }

          return {
            searchStatus: 'ready',
            searchError: null,
            searchResults: payload.results,
          }
        },
      ],
    },
    failLocationSearchResponse: {
      to: {
        searchStatus: ['searchStatus'],
        searchError: ['searchError'],
        searchResults: ['searchResults'],
      },
      fn: [
        ['$noop', 'activeSearchRequestId'] as const,
        (payload: unknown, noop: unknown, activeSearchRequestId: number) => {
          if (
            !isSearchFailurePayload(payload) ||
            payload.requestId !== activeSearchRequestId
          ) {
            return noop
          }

          return {
            searchStatus: 'error',
            searchError: payload.message,
            searchResults: [],
          }
        },
      ],
    },
    requestCurrentLocationFromBrowser: {
      to: {
        currentLocationStatus: ['currentLocationStatus'],
        currentLocationError: ['currentLocationError'],
        currentLocationRequest: ['currentLocationRequest'],
        activeCurrentLocationRequestId: ['activeCurrentLocationRequestId'],
      },
      fn: [
        ['$noop', 'activeCurrentLocationRequestId'] as const,
        (payload: unknown, noop: unknown, activeCurrentLocationRequestId: number) => {
          const coordinates = normalizeBrowserCoordinates(payload)

          if (!coordinates) {
            return noop
          }

          const requestId = activeCurrentLocationRequestId + 1

          return {
            currentLocationStatus: 'loading',
            currentLocationError: null,
            currentLocationRequest: {
              requestId,
              kind: 'browserCoordinates',
              latitude: coordinates.latitude,
              longitude: coordinates.longitude,
            },
            activeCurrentLocationRequestId: requestId,
          }
        },
      ],
    },
    requestCurrentLocationFallback: {
      to: {
        currentLocationStatus: ['currentLocationStatus'],
        currentLocationError: ['currentLocationError'],
        currentLocationRequest: ['currentLocationRequest'],
        activeCurrentLocationRequestId: ['activeCurrentLocationRequestId'],
      },
      fn: [
        ['activeCurrentLocationRequestId'] as const,
        (_payload: unknown, activeCurrentLocationRequestId: number) => {
          const requestId = activeCurrentLocationRequestId + 1

          return {
            currentLocationStatus: 'loading',
            currentLocationError: null,
            currentLocationRequest: {
              requestId,
              kind: 'fallback',
            },
            activeCurrentLocationRequestId: requestId,
          }
        },
      ],
    },
    applyCurrentLocationLookupResponse: {
      to: {
        isEditingLocation: ['isEditingLocation'],
        searchQuery: ['searchQuery'],
        searchStatus: ['searchStatus'],
        searchError: ['searchError'],
        searchResults: ['searchResults'],
        searchRequest: ['searchRequest'],
        activeSearchRequestId: ['activeSearchRequestId'],
        currentLocationStatus: ['currentLocationStatus'],
        currentLocationError: ['currentLocationError'],
        currentLocationRequest: ['currentLocationRequest'],
        replaceWeatherLocation: ['<< current_mp_md', { action: 'replaceWeatherLocation', inline_subwalker: true }],
      },
      fn: [
        ['$noop', 'activeCurrentLocationRequestId', 'activeSearchRequestId'] as const,
        (
          payload: unknown,
          noop: unknown,
          activeCurrentLocationRequestId: number,
          activeSearchRequestId: number,
        ) => {
          if (
            !isCurrentLocationResponsePayload(payload) ||
            payload.requestId !== activeCurrentLocationRequestId
          ) {
            return noop
          }

          return {
            ...buildSearchResetState(activeSearchRequestId + 1),
            replaceWeatherLocation: payload.result,
          }
        },
      ],
    },
    failCurrentLocationLookupResponse: {
      to: {
        currentLocationStatus: ['currentLocationStatus'],
        currentLocationError: ['currentLocationError'],
        currentLocationRequest: ['currentLocationRequest'],
      },
      fn: [
        ['$noop', 'activeCurrentLocationRequestId'] as const,
        (payload: unknown, noop: unknown, activeCurrentLocationRequestId: number) => {
          if (
            !isCurrentLocationFailurePayload(payload) ||
            payload.requestId !== activeCurrentLocationRequestId
          ) {
            return noop
          }

          return {
            currentLocationStatus: 'error',
            currentLocationError: payload.message,
            currentLocationRequest: null,
          }
        },
      ],
    },
    selectLocationSearchResult: {
      to: {
        isEditingLocation: ['isEditingLocation'],
        searchQuery: ['searchQuery'],
        searchStatus: ['searchStatus'],
        searchError: ['searchError'],
        searchResults: ['searchResults'],
        searchRequest: ['searchRequest'],
        activeSearchRequestId: ['activeSearchRequestId'],
        currentLocationStatus: ['currentLocationStatus'],
        currentLocationError: ['currentLocationError'],
        currentLocationRequest: ['currentLocationRequest'],
        replaceWeatherLocation: ['<< current_mp_md', { action: 'replaceWeatherLocation', inline_subwalker: true }],
      },
      fn: [
        ['$noop', 'activeSearchRequestId'] as const,
        (payload: unknown, noop: unknown, activeSearchRequestId: number) => {
          if (!isLocationSearchResult(payload)) {
            return noop
          }

          return {
            ...buildSearchResetState(activeSearchRequestId + 1),
            replaceWeatherLocation: payload,
          }
        },
      ],
    },
    saveLocationSearchResult: {
      to: {
        saveLocationSearchResult: ['<<<< #', { action: 'saveLocationSearchResult', inline_subwalker: true }],
      },
      fn: [
        ['$noop'] as const,
        (payload: unknown, noop: unknown) => {
          if (!isLocationSearchResult(payload)) {
            return noop
          }

          return {
            saveLocationSearchResult: payload,
          }
        },
      ],
    },
    removeLocationSearchResult: {
      to: {
        removeLocationSearchResult: ['<<<< #', { action: 'removeLocationSearchResult', inline_subwalker: true }],
      },
      fn: [
        ['$noop'] as const,
        (payload: unknown, noop: unknown) => {
          if (!isLocationSearchResult(payload) && typeof payload !== 'string') {
            return noop
          }

          return {
            removeLocationSearchResult: typeof payload === 'string' ? payload : payload.id,
          }
        },
      ],
    },
  },
})

