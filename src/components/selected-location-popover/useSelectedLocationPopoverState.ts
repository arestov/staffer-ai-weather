import { useAttrs } from '../../dkt-react-sync/hooks/useAttrs'
import type { LocationSearchResult } from '../../models/WeatherLocation'
import { readBooleanAttr, readNullableStringAttr, readStringAttr } from '../../shared/attrReaders'

const toLocationSearchResults = (value: unknown): LocationSearchResult[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is LocationSearchResult => {
    if (!item || typeof item !== 'object') {
      return false
    }

    const candidate = item as Partial<LocationSearchResult>

    return (
      typeof candidate.id === 'string' &&
      typeof candidate.name === 'string' &&
      typeof candidate.subtitle === 'string' &&
      typeof candidate.latitude === 'number' &&
      typeof candidate.longitude === 'number'
    )
  })
}

export type SelectedLocationPopoverState = {
  isEditingLocation: boolean
  searchQuery: string
  searchStatus: string
  searchError: string | null
  searchResults: LocationSearchResult[]
  savedSearchLocations: LocationSearchResult[]
  currentLocationStatus: string
  currentLocationError: string | null
}

export const useSelectedLocationPopoverState = (): SelectedLocationPopoverState => {
  const routerAttrs = useAttrs([
    'isEditingLocation',
    'searchQuery',
    'searchStatus',
    'searchError',
    'searchResults',
    'savedSearchLocations',
    'currentLocationStatus',
    'currentLocationError',
  ])

  return {
    isEditingLocation: readBooleanAttr(routerAttrs.isEditingLocation),
    searchQuery: readStringAttr(routerAttrs.searchQuery),
    searchStatus: readStringAttr(routerAttrs.searchStatus, 'idle'),
    searchError: readNullableStringAttr(routerAttrs.searchError),
    searchResults: toLocationSearchResults(routerAttrs.searchResults),
    savedSearchLocations: toLocationSearchResults(routerAttrs.savedSearchLocations),
    currentLocationStatus: readStringAttr(routerAttrs.currentLocationStatus, 'idle'),
    currentLocationError: readNullableStringAttr(routerAttrs.currentLocationError),
  }
}
