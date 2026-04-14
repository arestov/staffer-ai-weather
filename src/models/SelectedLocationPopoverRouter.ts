import { input as inputAttrs } from 'dkt/dcl/attrs/input.js'
import { model } from 'dkt/model.js'
import { Router as RouterCore } from 'dkt-all/models/Router.js'
import type { LocationSearchResult } from './WeatherLocation'
import type { LocationSearchApi } from '../worker/location-search-api'

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
  }> = {},
) => ({
  isEditingLocation: overrides.isEditingLocation ?? false,
  searchQuery: overrides.searchQuery ?? '',
  searchStatus: overrides.searchStatus ?? 'idle',
  searchError: null,
  searchResults: [],
  searchRequest: null,
  activeSearchRequestId: requestId,
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
})

const toErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error)
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
    savedSearchLocations: [
      'comp',
      ['< @one:savedSearchLocations < $root'],
      (savedSearchLocations: unknown) => (Array.isArray(savedSearchLocations) ? savedSearchLocations : []),
    ],
    searchRequest: ['input', null],
    activeSearchRequestId: ['input', 0],
  },
  effects: {
    out: {
      runLocationSearch: {
        api: ['self'],
        trigger: ['searchRequest'],
        require: ['searchRequest'],
        create_when: {
          api_inits: true,
        },
        is_async: true,
        fn: [
          ['searchRequest'] as const,
          async (
            self: {
              dispatch: (actionName: string, payload?: unknown) => Promise<void> | void
            },
            _task: unknown,
            searchRequest: unknown,
          ) => {
            if (!isSearchRequest(searchRequest)) {
              return
            }

            try {
              const app = (self as {
                app?: {
                  getInterface: (interfaceName: string) => unknown
                }
              }).app
              const locationSearch = app?.getInterface('locationSearch') as LocationSearchApi | null

              if (!locationSearch) {
                throw new Error('Location search interface is not available')
              }

              const results = await locationSearch.search(searchRequest.query)

              await self.dispatch('applyLocationSearchResponse', {
                requestId: searchRequest.requestId,
                results,
              })
            } catch (error) {
              await self.dispatch('failLocationSearchResponse', {
                requestId: searchRequest.requestId,
                message: toErrorMessage(error),
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
        searchRequest: ['searchRequest'],
        activeSearchRequestId: ['activeSearchRequestId'],
      },
      fn: [
        ['$noop', 'activeSearchRequestId'] as const,
        (
          payload: { next_value?: unknown; prev_value?: unknown },
          noop: unknown,
          activeSearchRequestId: unknown,
        ) => {
          if (payload.next_value === payload.prev_value) {
            return noop
          }

          const currentRequestId = typeof activeSearchRequestId === 'number'
            ? activeSearchRequestId
            : 0

          return buildSearchResetState(currentRequestId + 1)
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
        searchRequest: ['searchRequest'],
        activeSearchRequestId: ['activeSearchRequestId'],
      },
      fn: [
        ['activeSearchRequestId'] as const,
        (payload: unknown, activeSearchRequestId: unknown) => {
          const currentRequestId = typeof activeSearchRequestId === 'number'
            ? activeSearchRequestId
            : 0
          return buildSearchResetState(currentRequestId + 1, {
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
        searchRequest: ['searchRequest'],
        activeSearchRequestId: ['activeSearchRequestId'],
      },
      fn: [
        ['activeSearchRequestId'] as const,
        (payload: unknown, activeSearchRequestId: unknown) => {
          const currentRequestId = typeof activeSearchRequestId === 'number'
            ? activeSearchRequestId
            : 0

          return {
            searchQuery: normalizeSearchInput(payload).trim(),
            searchStatus: 'idle',
            searchError: null,
            searchRequest: null,
            activeSearchRequestId: currentRequestId + 1,
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
        searchRequest: ['searchRequest'],
        activeSearchRequestId: ['activeSearchRequestId'],
      },
      fn: [
        ['searchQuery', 'searchResults', 'activeSearchRequestId'] as const,
        (
          payload: unknown,
          searchQuery: unknown,
          searchResults: unknown,
          activeSearchRequestId: unknown,
        ) => {
          const currentRequestId = typeof activeSearchRequestId === 'number'
            ? activeSearchRequestId
            : 0
          const query = normalizeSearchRequestQuery(payload) || normalizeSearchRequestQuery(searchQuery)

          if (query.length < MIN_LOCATION_SEARCH_QUERY_LENGTH) {
            return {}
          }

          return buildSearchingState(
            query,
            currentRequestId + 1,
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
        searchRequest: ['searchRequest'],
        activeSearchRequestId: ['activeSearchRequestId'],
      },
      fn: [
        ['activeSearchRequestId'] as const,
        (_payload: unknown, activeSearchRequestId: unknown) => {
          const currentRequestId = typeof activeSearchRequestId === 'number'
            ? activeSearchRequestId
            : 0

          return buildSearchResetState(currentRequestId + 1)
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
        (payload: unknown, noop: unknown, activeSearchRequestId: unknown) => {
          if (
            !isSearchResponsePayload(payload) ||
            typeof activeSearchRequestId !== 'number' ||
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
        (payload: unknown, noop: unknown, activeSearchRequestId: unknown) => {
          if (
            !isSearchFailurePayload(payload) ||
            typeof activeSearchRequestId !== 'number' ||
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
    selectLocationSearchResult: {
      to: {
        isEditingLocation: ['isEditingLocation'],
        searchQuery: ['searchQuery'],
        searchStatus: ['searchStatus'],
        searchError: ['searchError'],
        searchResults: ['searchResults'],
        searchRequest: ['searchRequest'],
        activeSearchRequestId: ['activeSearchRequestId'],
        replaceWeatherLocation: ['<< current_mp_md', { action: 'replaceWeatherLocation', inline_subwalker: true }],
      },
      fn: [
        ['$noop', 'activeSearchRequestId'] as const,
        (payload: unknown, noop: unknown, activeSearchRequestId: unknown) => {
          if (!isLocationSearchResult(payload)) {
            return noop
          }

          const currentRequestId = typeof activeSearchRequestId === 'number'
            ? activeSearchRequestId
            : 0

          return {
            ...buildSearchResetState(currentRequestId + 1),
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

