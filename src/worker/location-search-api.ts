import type { LocationSearchResult } from '../models/WeatherLocation'
import type { WeatherBackendApi } from './weather-backend-api'

export interface LocationSearchApi {
  source_name: 'locationSearch'
  errors_fields: string[]
  search(query: string): Promise<LocationSearchResult[]>
}

type OpenMeteoSearchResultRaw = {
  id?: number
  name: string
  country?: string
  admin1?: string
  latitude: number
  longitude: number
  timezone?: string
}

type OpenMeteoSearchResponse = {
  results?: OpenMeteoSearchResultRaw[]
}

const OPEN_METEO_GEOCODING_BASE = 'https://geocoding-api.open-meteo.com/v1/search'
const MIN_LOCATION_SEARCH_QUERY_LENGTH = 3

const formatLocationSubtitle = (raw: OpenMeteoSearchResultRaw) => {
  return [raw.admin1, raw.country].filter(Boolean).join(', ')
}

const normalizeLocationSearchResult = (raw: OpenMeteoSearchResultRaw): LocationSearchResult => {
  return {
    id: raw.id != null ? String(raw.id) : `${raw.name}:${raw.latitude}:${raw.longitude}`,
    name: raw.name,
    subtitle: formatLocationSubtitle(raw),
    latitude: raw.latitude,
    longitude: raw.longitude,
    timezone: raw.timezone ?? null,
  }
}

const fetchLocationSearchResultsFromOpenMeteo = async (
  query: string,
): Promise<LocationSearchResult[]> => {
  const params = new URLSearchParams({
    name: query,
    count: '8',
    language: 'en',
    format: 'json',
  })

  const response = await fetch(`${OPEN_METEO_GEOCODING_BASE}?${params}`)

  if (!response.ok) {
    throw new Error(`Open-Meteo geocoding responded with ${response.status}`)
  }

  const raw = (await response.json()) as OpenMeteoSearchResponse
  const results = Array.isArray(raw.results) ? raw.results : []

  return results.map(normalizeLocationSearchResult)
}

export const fetchLocationSearchResults = async (
  query: string,
  options?: {
    weatherBackend?: WeatherBackendApi | null
  },
): Promise<LocationSearchResult[]> => {
  const normalizedQuery = query.trim()

  if (normalizedQuery.length < MIN_LOCATION_SEARCH_QUERY_LENGTH) {
    return []
  }

  const weatherBackend = options?.weatherBackend ?? null

  if (weatherBackend) {
    try {
      const cached = await weatherBackend.lookupLocationSearchCache(normalizedQuery)
      if (cached.cacheStatus === 'hit') {
        return cached.results
      }
    } catch {
      // Ignore cache backend failures and continue with the direct upstream request.
    }
  }

  const results = await fetchLocationSearchResultsFromOpenMeteo(normalizedQuery)

  if (weatherBackend) {
    void weatherBackend.storeLocationSearchCache(normalizedQuery, results).catch(() => {})
  }

  return results
}

export const createLocationSearchApi = (options?: {
  weatherBackend?: WeatherBackendApi | null
}): LocationSearchApi => ({
  source_name: 'locationSearch',
  errors_fields: [],
  search(query) {
    return fetchLocationSearchResults(query, options)
  },
})
