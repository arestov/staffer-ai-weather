import { useEffect, useLayoutEffect, useRef, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { One } from '../dkt-react-sync/components/One'
import { ScopeContext } from '../dkt-react-sync/context/ScopeContext'
import { useActions } from '../dkt-react-sync/hooks/useActions'
import { useAttrs } from '../dkt-react-sync/hooks/useAttrs'
import type { ReactSyncScopeHandle } from '../dkt-react-sync/scope/ScopeHandle'
import { useNamedSessionRouter } from '../page/react/useNamedSessionRouter'
import type { LocationSearchResult } from '../models/WeatherLocation'
import { SelectedLocationSearchPanel } from './SelectedLocationSearchPanel'
import {
  CurrentWeatherCard,
  ForecastCard,
  ForecastEmpty,
  POPOVER_FORECAST_LIMIT,
  PopoverForecastColumns,
  PopoverWeatherSectionFallback,
  WeatherReadoutError,
  WeatherReadoutFallback,
} from './WeatherCards'

export const SELECTED_LOCATION_POPOVER_ROUTER_NAME = 'router-selectedLocationPopover'
export const SELECTED_LOCATION_POPOVER_ID = 'selected-location-popover-layer'
export const SELECTED_LOCATION_POPOVER_ARROW_ID = 'selected-location-popover-arrow'

const SELECTED_LOCATION_POPOVER_SCROLL_OFFSET = 24

export const scrollSelectedLocationIntoView = (selectedLocationId: string) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  const anchorElement = document.querySelector(
    `[data-selected-location-id="${selectedLocationId}"]`,
  ) as HTMLElement | null

  if (!anchorElement) {
    return
  }

  const rect = anchorElement.getBoundingClientRect()

  try {
    window.scrollBy({
      top: rect.top - SELECTED_LOCATION_POPOVER_SCROLL_OFFSET,
      behavior: 'smooth',
    })
  } catch {
    // jsdom does not implement scrollBy; ignore to keep tests deterministic.
  }
}

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

export function SelectedLocationPopoverLayer({
  onRefreshWeather,
}: {
  onRefreshWeather: () => void
}) {
  const { currentNodeId, currentScope, routerScope, clearCurrent } = useNamedSessionRouter(
    SELECTED_LOCATION_POPOVER_ROUTER_NAME,
  )
  const popoverRef = useRef<HTMLElement | null>(null)
  const arrowPopoverRef = useRef<HTMLElement | null>(null)
  const lastOpenNodeIdRef = useRef<string | null>(null)

  useEffect(() => {
    const popoverNode = popoverRef.current
    const arrowNode = arrowPopoverRef.current

    if (!popoverNode || !arrowNode) {
      return
    }

    const isOpen = (node: HTMLElement) => {
      try {
        return node.matches(':popover-open')
      } catch {
        return false
      }
    }

    const showWithSource = (
      node: HTMLElement,
      triggerButton: HTMLButtonElement | null,
      shouldRefresh = false,
    ) => {
      if (typeof node.showPopover !== 'function') {
        return
      }

      if (isOpen(node) && !shouldRefresh) {
        return
      }

      if (isOpen(node) && shouldRefresh && typeof node.hidePopover === 'function') {
        node.hidePopover()
      }

      try {
        const showPopover = node.showPopover as (options?: { source?: HTMLElement }) => void
        showPopover({ source: triggerButton ?? undefined })
      } catch {
        node.showPopover()
      }
    }

    if (currentNodeId && currentScope) {
      const triggerButton = document.querySelector(
        `[data-selected-location-id="${currentNodeId}"] .selected-location-card-button`,
      ) as HTMLButtonElement | null

      showWithSource(popoverNode, triggerButton)
      showWithSource(arrowNode, triggerButton, true)
      return
    }

    if (isOpen(popoverNode) && typeof popoverNode.hidePopover === 'function') {
      popoverNode.hidePopover()
    }

    if (isOpen(arrowNode) && typeof arrowNode.hidePopover === 'function') {
      arrowNode.hidePopover()
    }
  }, [currentNodeId, currentScope])

  useEffect(() => {
    if (!currentNodeId || !currentScope || typeof document === 'undefined') {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      clearCurrent()
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [clearCurrent, currentNodeId, currentScope])

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return
    }

    if (currentNodeId && currentScope) {
      lastOpenNodeIdRef.current = currentNodeId

      const frameId = window.requestAnimationFrame(() => {
        const focusTarget = popoverRef.current?.querySelector<HTMLElement>('[data-popover-focus]')
        focusTarget?.focus()
      })

      return () => {
        window.cancelAnimationFrame(frameId)
      }
    }

    const lastOpenNodeId = lastOpenNodeIdRef.current

    if (!lastOpenNodeId) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      const triggerButton = document.querySelector(
        `[data-selected-location-id="${lastOpenNodeId}"] .selected-location-card-button`,
      ) as HTMLButtonElement | null

      triggerButton?.focus()
      lastOpenNodeIdRef.current = null
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [currentNodeId, currentScope])

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <>
      <section
        ref={popoverRef}
        id={SELECTED_LOCATION_POPOVER_ID}
        popover="manual"
        hidden={!currentNodeId || !currentScope}
        className="selected-location-popover selected-location-popover--floating"
        data-selected-location-popover-layer
        data-popover-for={currentNodeId ?? ''}
      >
        {currentScope && routerScope ? (
          <ScopeContext.Provider value={routerScope}>
            <SelectedLocationPopover
              popoverId={SELECTED_LOCATION_POPOVER_ID}
              selectedLocationId={currentNodeId ?? ''}
              selectedLocationScope={currentScope}
              onRefreshWeather={onRefreshWeather}
              onClose={clearCurrent}
            />
          </ScopeContext.Provider>
        ) : null}
      </section>

      <section
        ref={arrowPopoverRef}
        id={SELECTED_LOCATION_POPOVER_ARROW_ID}
        popover="manual"
        hidden={!currentNodeId || !currentScope}
        className="selected-location-popover-arrow selected-location-popover-arrow--floating"
        aria-hidden="true"
        data-selected-location-popover-arrow
        data-popover-for={currentNodeId ?? ''}
      />
    </>,
    document.body,
  )
}

function SelectedLocationPopover({
  popoverId,
  selectedLocationId,
  selectedLocationScope,
  onRefreshWeather,
  onClose,
}: {
  popoverId: string
  selectedLocationId: string
  selectedLocationScope: ReactSyncScopeHandle
  onRefreshWeather: () => void
  onClose: () => void
}) {
  const { dispatch } = useActions()
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const routerAttrs = useAttrs([
    'isEditingLocation',
    'searchQuery',
    'searchStatus',
    'searchError',
    'searchResults',
    'savedSearchLocations',
  ])
  const isEditingLocation = Boolean(routerAttrs.isEditingLocation)
  const searchQuery = typeof routerAttrs.searchQuery === 'string' ? routerAttrs.searchQuery : ''
  const searchStatus = typeof routerAttrs.searchStatus === 'string' ? routerAttrs.searchStatus : 'idle'
  const searchError = typeof routerAttrs.searchError === 'string' ? routerAttrs.searchError : null
  const searchResults = toLocationSearchResults(routerAttrs.searchResults)
  const savedSearchLocations = toLocationSearchResults(routerAttrs.savedSearchLocations)

  const clearSearchDebounce = () => {
    if (searchDebounceRef.current != null) {
      clearTimeout(searchDebounceRef.current)
      searchDebounceRef.current = null
    }
  }

  const handleQueryChange = (query: string) => {
    clearSearchDebounce()
    dispatch('updateLocationSearchQuery', query)

    const normalizedQuery = query.trim()

    if (normalizedQuery.length < 3) {
      return
    }

    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null
      dispatch('submitLocationSearch', {
        query: normalizedQuery,
      })
    }, 300)
  }

  useLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    let firstFrameId = 0
    let secondFrameId = 0

    const runScroll = () => {
      scrollSelectedLocationIntoView(selectedLocationId)
    }

    firstFrameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(runScroll)
    })

    return () => {
      if (firstFrameId) {
        window.cancelAnimationFrame(firstFrameId)
      }

      if (secondFrameId) {
        window.cancelAnimationFrame(secondFrameId)
      }
    }
  }, [selectedLocationId])

  const handleSubmitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    clearSearchDebounce()
    dispatch('submitLocationSearch', {
      query: searchQuery,
    })
  }

  const handleRetrySearch = () => {
    clearSearchDebounce()
    dispatch('submitLocationSearch', {
      query: searchQuery,
    })
  }

  const handleSelectLocation = (result: LocationSearchResult) => {
    clearSearchDebounce()
    dispatch('saveLocationSearchResult', result)
    dispatch('selectLocationSearchResult', result)
    onClose()
  }

  const forgetSearchLocation = (resultId: string) => {
    clearSearchDebounce()
    dispatch('removeLocationSearchResult', resultId)
  }

  return (
    <div
      className="selected-location-popover__surface"
      role="dialog"
      aria-modal="false"
      aria-label="Location details"
      tabIndex={-1}
      data-selected-location-popover
      data-popover-for={selectedLocationId}
    >
      <ScopeContext.Provider value={selectedLocationScope}>
        <SelectedLocationPopoverHeader
          isEditingLocation={isEditingLocation}
          onStartEdit={(seedQuery) => dispatch('startLocationEditing', { seedQuery })}
          onClose={onClose}
        />

        <SelectedLocationPopoverWeatherSection
          isEditingLocation={isEditingLocation}
          onRefreshWeather={onRefreshWeather}
        />
      </ScopeContext.Provider>

      <SelectedLocationSearchPanel
        isEditingLocation={isEditingLocation}
        searchQuery={searchQuery}
        searchStatus={searchStatus}
        searchError={searchError}
        searchResults={searchResults}
        savedResults={savedSearchLocations}
        onSubmitSearch={handleSubmitSearch}
        onRetrySearch={handleRetrySearch}
        onQueryChange={handleQueryChange}
        onCancel={() => {
          clearSearchDebounce()
          dispatch('cancelLocationEditing')
        }}
        onSelectResult={handleSelectLocation}
        onSelectSavedResult={handleSelectLocation}
        onRemoveSavedResult={forgetSearchLocation}
      />
    </div>
  )
}

function SelectedLocationPopoverHeader({
  isEditingLocation,
  onStartEdit,
  onClose,
}: {
  isEditingLocation: boolean
  onStartEdit: (seedQuery: string) => void
  onClose: () => void
}) {
  const headerAttrs = useAttrs(['location', 'name'])
  const seedQuery =
    typeof headerAttrs.location === 'string' && headerAttrs.location
      ? headerAttrs.location
      : typeof headerAttrs.name === 'string'
        ? headerAttrs.name
        : ''

  return (
    <div className="selected-location-popover__header">
      <div className="selected-location-popover__header-content">
        {!isEditingLocation ? (
          <button
            className="secondary selected-location-popover__edit-trigger"
            type="button"
            onClick={() => onStartEdit(seedQuery)}
            data-location-edit-trigger
            data-popover-focus
          >
            Search Another Location
          </button>
        ) : (
          <p className="selected-location-popover__header-note">
            Pick a replacement below to update this location card.
          </p>
        )}
      </div>

      <button
        className="secondary selected-location-popover__close"
        type="button"
        onClick={onClose}
        aria-label="Close popover"
        data-popover-close
        {...(isEditingLocation ? { 'data-popover-focus': '' } : {})}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  )
}

function SelectedLocationPopoverWeatherSection({
  isEditingLocation,
  onRefreshWeather,
}: {
  isEditingLocation: boolean
  onRefreshWeather: () => void
}) {
  return (
    <One rel="weatherLocation" fallback={<PopoverWeatherSectionFallback />}>
      <SelectedLocationPopoverWeatherSectionInner
        isEditingLocation={isEditingLocation}
        onRefreshWeather={onRefreshWeather}
      />
    </One>
  )
}

function SelectedLocationPopoverWeatherSectionInner({
  isEditingLocation,
  onRefreshWeather,
}: {
  isEditingLocation: boolean
  onRefreshWeather: () => void
}) {
  const weatherLocationAttrs = useAttrs(['loadStatus', 'lastError'])
  const loadStatus = typeof weatherLocationAttrs.loadStatus === 'string' ? weatherLocationAttrs.loadStatus : 'idle'
  const lastError = typeof weatherLocationAttrs.lastError === 'string' ? weatherLocationAttrs.lastError : null
  const weatherLoadError = loadStatus === 'error' && lastError ? lastError : null

  return (
    <>
      {!isEditingLocation ? (
        <div className="selected-location-popover__body">
          <One
            rel="currentWeather"
            fallback={
              <SelectedLocationPopoverCurrentWeatherFallback
                weatherLoadError={weatherLoadError}
                onRefreshWeather={onRefreshWeather}
              />
            }
          >
            <SelectedLocationPopoverCurrentWeatherPanel
              onRefreshWeather={onRefreshWeather}
            />
          </One>

          <PopoverForecastColumns />
        </div>
      ) : null}
    </>
  )
}

function SelectedLocationPopoverCurrentWeatherPanel({
  onRefreshWeather,
}: {
  onRefreshWeather: () => void
}) {
  return (
    <article className="weather-readout weather-readout--popover">
      <CurrentWeatherCard onRetry={onRefreshWeather} />
    </article>
  )
}

function SelectedLocationPopoverCurrentWeatherFallback({
  weatherLoadError,
  onRefreshWeather,
}: {
  weatherLoadError: string | null
  onRefreshWeather: () => void
}) {
  return (
    <>
      {weatherLoadError ? (
        <WeatherReadoutError message={`Weather load failed: ${weatherLoadError}`} onRetry={onRefreshWeather} />
      ) : (
        <WeatherReadoutFallback />
      )}
    </>
  )
}






