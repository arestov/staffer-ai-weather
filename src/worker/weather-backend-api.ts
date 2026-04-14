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

export interface WeatherBackendApi {
  source_name: 'weatherBackend'
  errors_fields: string[]
  lookupLocationSearchCache(query: string): Promise<SearchResponse>
  storeLocationSearchCache(query: string, results: LocationSearchResult[]): Promise<void>
  fetchSavedSearchLocations(scope?: string): Promise<LocationSearchResult[]>
  saveSavedSearchLocation(
    place: LocationSearchResult,
    scope?: string,
  ): Promise<LocationSearchResult[]>
  removeSavedSearchLocation(placeId: string, scope?: string): Promise<LocationSearchResult[]>
}

const DEFAULT_SAVED_PLACES_SCOPE = 'default'

const runtimeEnv =
  typeof process !== 'undefined' && process?.env ? process.env : undefined

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

export const resolveWeatherBackendBaseUrl = (override?: string | null) => {
  if (typeof override === 'string' && override.trim()) {
    return override.trim()
  }

  const globalBaseUrl = (globalThis as { __WEATHER_BACKEND_BASE_URL__?: unknown })
    .__WEATHER_BACKEND_BASE_URL__

  if (typeof globalBaseUrl === 'string' && globalBaseUrl.trim()) {
    return globalBaseUrl.trim()
  }

  const envBaseUrl = runtimeEnv?.WEATHER_BACKEND_BASE_URL
  return typeof envBaseUrl === 'string' && envBaseUrl.trim() ? envBaseUrl.trim() : null
}

const buildWeatherBackendUrl = (baseUrl: string, path: string) => {
  if (baseUrl === '/') {
    return path
  }

  if (/^https?:\/\//i.test(baseUrl)) {
    return new URL(path, baseUrl).toString()
  }

  return `${baseUrl.replace(/\/+$/, '')}${path}`
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
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(buildWeatherBackendUrl(baseUrl, path), init)

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  return await response.json() as T
}

export const createWeatherBackendApi = (baseUrl: string): WeatherBackendApi => ({
  source_name: 'weatherBackend',
  errors_fields: [],
  async lookupLocationSearchCache(query) {
    const params = new URLSearchParams({ q: query.trim() })
    return await requestWeatherBackendJson<SearchResponse>(
      baseUrl,
      `/api/locations/search?${params.toString()}`,
    )
  },
  async storeLocationSearchCache(query, results) {
    const params = new URLSearchParams({ q: query.trim() })
    const response = await fetch(buildWeatherBackendUrl(baseUrl, `/api/locations/search?${params.toString()}`), {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ results }),
    })

    if (!response.ok) {
      throw new Error(await readErrorMessage(response))
    }
  },
  async fetchSavedSearchLocations(scope = DEFAULT_SAVED_PLACES_SCOPE) {
    const params = new URLSearchParams({ scope })
    const payload = await requestWeatherBackendJson<SavedPlacesResponse>(
      baseUrl,
      `/api/places?${params.toString()}`,
    )

    return toLocationSearchResults(payload.places)
  },
  async saveSavedSearchLocation(place, scope = DEFAULT_SAVED_PLACES_SCOPE) {
    const params = new URLSearchParams({ scope })
    const payload = await requestWeatherBackendJson<SavedPlacesResponse>(
      baseUrl,
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
  },
  async removeSavedSearchLocation(placeId, scope = DEFAULT_SAVED_PLACES_SCOPE) {
    const params = new URLSearchParams({ scope })
    const payload = await requestWeatherBackendJson<SavedPlacesResponse>(
      baseUrl,
      `/api/places/${encodeURIComponent(placeId)}?${params.toString()}`,
      {
        method: 'DELETE',
      },
    )

    return toLocationSearchResults(payload.places)
  },
})