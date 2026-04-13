import type { LocationSearchResult } from '../app/rels/location-models'

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

export interface LocationSearchApi {
  source_name: 'locationSearch'
  errors_fields: string[]
  search(query: string): Promise<LocationSearchResult[]>
}

const OPEN_METEO_GEOCODING_BASE = 'https://geocoding-api.open-meteo.com/v1/search'
const MIN_LOCATION_SEARCH_QUERY_LENGTH = 3

const formatLocationSubtitle = (raw: OpenMeteoSearchResultRaw) => {
  return [raw.admin1, raw.country].filter(Boolean).join(', ')
}

const normalizeLocationSearchResult = (
  raw: OpenMeteoSearchResultRaw,
): LocationSearchResult => {
  return {
    id: raw.id != null
      ? String(raw.id)
      : `${raw.name}:${raw.latitude}:${raw.longitude}`,
    name: raw.name,
    subtitle: formatLocationSubtitle(raw),
    latitude: raw.latitude,
    longitude: raw.longitude,
    timezone: raw.timezone ?? null,
  }
}

export const fetchLocationSearchResults = async (
  query: string,
): Promise<LocationSearchResult[]> => {
  const normalizedQuery = query.trim()

  if (normalizedQuery.length < MIN_LOCATION_SEARCH_QUERY_LENGTH) {
    return []
  }

  const params = new URLSearchParams({
    name: normalizedQuery,
    count: '8',
    language: 'en',
    format: 'json',
  })

  const response = await fetch(`${OPEN_METEO_GEOCODING_BASE}?${params}`)

  if (!response.ok) {
    throw new Error(`Open-Meteo geocoding responded with ${response.status}`)
  }

  const raw = await response.json() as OpenMeteoSearchResponse
  const results = Array.isArray(raw.results) ? raw.results : []

  return results.map(normalizeLocationSearchResult)
}

export const createLocationSearchApi = (): LocationSearchApi => ({
  source_name: 'locationSearch',
  errors_fields: [],
  search: fetchLocationSearchResults,
})