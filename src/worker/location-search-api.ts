import type { LocationSearchResult } from '../app/rels/location-models'
import { fetchLocationSearchResultsFromBackend } from './weather-backend-api'

export interface LocationSearchApi {
  source_name: 'locationSearch'
  errors_fields: string[]
  search(query: string): Promise<LocationSearchResult[]>
}

const MIN_LOCATION_SEARCH_QUERY_LENGTH = 3

export const fetchLocationSearchResults = async (
  query: string,
): Promise<LocationSearchResult[]> => {
  const normalizedQuery = query.trim()

  if (normalizedQuery.length < MIN_LOCATION_SEARCH_QUERY_LENGTH) {
    return []
  }

  return await fetchLocationSearchResultsFromBackend(normalizedQuery)
}

export const createLocationSearchApi = (): LocationSearchApi => ({
  source_name: 'locationSearch',
  errors_fields: [],
  search: fetchLocationSearchResults,
})