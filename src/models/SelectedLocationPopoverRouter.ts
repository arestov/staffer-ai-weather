import { input as inputAttrs } from 'dkt/dcl/attrs/input.js'
import { model } from 'dkt/model.js'
import { Router as RouterCore } from 'dkt-all/models/Router.js'
import { popoverRouterEffects } from './SelectedLocationPopoverRouter/effects'
import {
  buildSearchingState,
  buildSearchResetState,
  isCurrentLocationFailurePayload,
  isCurrentLocationResponsePayload,
  isSearchFailurePayload,
  isSearchResponsePayload,
  MIN_LOCATION_SEARCH_QUERY_LENGTH,
  normalizeBrowserCoordinates,
  normalizeSearchInput,
  normalizeSearchRequestQuery,
} from './SelectedLocationPopoverRouter/helpers'
import { isLocationSearchResult } from './WeatherLocation'

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
      (savedSearchLocations: unknown) =>
        Array.isArray(savedSearchLocations) ? savedSearchLocations : [],
    ],
    searchResponseData: ['input', null],
    currentLocationResponseData: ['input', null],
    searchRequest: ['input', null],
    activeSearchRequestId: ['input', 0],
  },
  effects: popoverRouterEffects,
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
          const query =
            normalizeSearchRequestQuery(payload) || normalizeSearchRequestQuery(searchQuery)

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
          if (!isSearchResponsePayload(payload) || payload.requestId !== activeSearchRequestId) {
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
          if (!isSearchFailurePayload(payload) || payload.requestId !== activeSearchRequestId) {
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
        replaceWeatherLocation: [
          '<< current_mp_md',
          { action: 'replaceWeatherLocation', inline_subwalker: true },
        ],
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
        replaceWeatherLocation: [
          '<< current_mp_md',
          { action: 'replaceWeatherLocation', inline_subwalker: true },
        ],
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
        saveLocationSearchResult: [
          '<<<< #',
          { action: 'saveLocationSearchResult', inline_subwalker: true },
        ],
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
        removeLocationSearchResult: [
          '<<<< #',
          { action: 'removeLocationSearchResult', inline_subwalker: true },
        ],
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
