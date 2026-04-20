import type { LocationSearchResult } from '../WeatherLocation'
import { isLocationSearchResult } from '../WeatherLocation'

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error'

type SearchRequest = {
  requestId: number
  query: string
}

type SearchResponsePayload = {
  requestId: number
  results: LocationSearchResult[]
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

export const MIN_LOCATION_SEARCH_QUERY_LENGTH = 3

export const normalizeSearchInput = (value: unknown) => {
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

export const normalizeSearchRequestQuery = (value: unknown) => {
  return normalizeSearchInput(value).trim()
}

export const isSearchRequest = (value: unknown): value is SearchRequest => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<SearchRequest>

  return typeof candidate.requestId === 'number' && typeof candidate.query === 'string'
}

export const isSearchResponsePayload = (value: unknown): value is SearchResponsePayload => {
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

export const buildSearchResetState = (
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

export const buildSearchingState = (
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

export const normalizeBrowserCoordinates = (value: unknown) => {
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

export const isCurrentLocationRequest = (value: unknown): value is CurrentLocationRequest => {
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

export const isCurrentLocationResponsePayload = (
  value: unknown,
): value is CurrentLocationResponsePayload => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<CurrentLocationResponsePayload>

  return typeof candidate.requestId === 'number' && isLocationSearchResult(candidate.result)
}

