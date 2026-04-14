import type { LocationSearchResult } from '../app/rels/location-models'

type SearchResponse = {
  query: string
  results: LocationSearchResult[]
  cacheStatus: 'skipped' | 'hit' | 'miss'
  expiresAt: number | null
}

type SavedPlaceRecord = LocationSearchResult & {
  createdAt?: string
  updatedAt?: string
}

type SavedPlacesResponse = {
  scope: string
  updatedAt: string | null
  places: SavedPlaceRecord[]
}

const DEFAULT_SAVED_PLACES_SCOPE = 'default'

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

const toLocationSearchResults = (value: unknown): LocationSearchResult[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isLocationSearchResult)
}

const resolveWeatherBackendBaseUrl = () => {
  const globalBaseUrl = (globalThis as { __WEATHER_BACKEND_BASE_URL__?: unknown })
    .__WEATHER_BACKEND_BASE_URL__

  return typeof globalBaseUrl === 'string' ? globalBaseUrl : ''
}

const buildWeatherBackendUrl = (path: string) => {
  const baseUrl = resolveWeatherBackendBaseUrl()

  return baseUrl ? new URL(path, baseUrl).toString() : path
}

const readErrorMessage = async (response: Response) => {
  try {
    const payload = await response.json() as { error?: unknown }
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error
    }
  } catch {
    // Ignore malformed error payloads and fall back to the status text.
  }

  return `Weather backend responded with ${response.status}`
}

const requestWeatherBackendJson = async <T,>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(buildWeatherBackendUrl(path), init)

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return await response.json() as T
}

export const fetchLocationSearchResultsFromBackend = async (
  query: string,
): Promise<LocationSearchResult[]> => {
  const params = new URLSearchParams({ q: query.trim() })
  const payload = await requestWeatherBackendJson<SearchResponse>(
    `/api/locations/search?${params.toString()}`,
  )

  return toLocationSearchResults(payload.results)
}

export const fetchSavedSearchLocations = async (
  scope = DEFAULT_SAVED_PLACES_SCOPE,
): Promise<LocationSearchResult[]> => {
  const params = new URLSearchParams({ scope })
  const payload = await requestWeatherBackendJson<SavedPlacesResponse>(
    `/api/places?${params.toString()}`,
  )

  return toLocationSearchResults(payload.places)
}

export const saveSavedSearchLocation = async (
  place: LocationSearchResult,
  scope = DEFAULT_SAVED_PLACES_SCOPE,
): Promise<LocationSearchResult[]> => {
  const params = new URLSearchParams({ scope })
  const payload = await requestWeatherBackendJson<SavedPlacesResponse>(
    `/api/places?${params.toString()}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(place),
    },
  )

  return toLocationSearchResults(payload.places)
}

export const removeSavedSearchLocation = async (
  placeId: string,
  scope = DEFAULT_SAVED_PLACES_SCOPE,
): Promise<LocationSearchResult[]> => {
  const params = new URLSearchParams({ scope })
  const payload = await requestWeatherBackendJson<SavedPlacesResponse>(
    `/api/places/${encodeURIComponent(placeId)}?${params.toString()}`,
    {
      method: 'DELETE',
    },
  )

  return toLocationSearchResults(payload.places)
}