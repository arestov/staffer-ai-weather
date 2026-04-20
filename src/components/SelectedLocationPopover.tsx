import { type FormEvent, memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { One } from '../dkt-react-sync/components/One'
import { ScopeContext } from '../dkt-react-sync/context/ScopeContext'
import { useActions } from '../dkt-react-sync/hooks/useActions'
import { useAttrs } from '../dkt-react-sync/hooks/useAttrs'
import { useNamedSessionRouter } from '../dkt-react-sync/hooks/useNamedSessionRouter'
import type { ReactSyncScopeHandle } from '../dkt-react-sync/scope/ScopeHandle'
import type { LocationSearchResult } from '../models/WeatherLocation'
import { readBooleanAttr, readNullableStringAttr, readStringAttr } from '../shared/attrReaders'
import { SelectedLocationSearchPanel } from './SelectedLocationSearchPanel'
import {
  SELECTED_LOCATION_POPOVER_ARROW_ID,
  SELECTED_LOCATION_POPOVER_ID,
  SELECTED_LOCATION_POPOVER_ROUTER_NAME,
  scrollSelectedLocationIntoView,
} from './selected-location-popover/constants'
import {
  CurrentWeatherCard,
  PopoverForecastColumns,
  PopoverWeatherSectionFallback,
  WeatherReadoutError,
  WeatherReadoutFallback,
} from './WeatherCards'

export {
  SELECTED_LOCATION_POPOVER_ID,
  SELECTED_LOCATION_POPOVER_ROUTER_NAME,
  scrollSelectedLocationIntoView,
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

type BrowserCoordinates = {
  latitude: number
  longitude: number
}

const isBrowserCoordinates = (value: unknown): value is BrowserCoordinates => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<BrowserCoordinates>

  return typeof candidate.latitude === 'number' && typeof candidate.longitude === 'number'
}

const isGeoPermissionDeniedError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false
  }

  const candidate = error as { code?: unknown }

  return candidate.code === 1
}

const readBrowserCoordinates = async (): Promise<BrowserCoordinates> => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('Browser geolocation is not available')
  }

  return new Promise<BrowserCoordinates>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
      },
      (error) => {
        reject(error)
      },
      {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 0,
      },
    )
  })
}

export function SelectedLocationPopoverLayer() {
  const { currentNodeId, currentScope, routerScope, clearCurrent } = useNamedSessionRouter(
    SELECTED_LOCATION_POPOVER_ROUTER_NAME,
  )
  const popoverRef = useRef<HTMLElement | null>(null)
  const arrowPopoverRef = useRef<HTMLElement | null>(null)
  const lastOpenNodeIdRef = useRef<string | null>(null)

  // Combined effect: show/hide popover + focus management
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

    const showWithSource = (node: HTMLElement, triggerButton: HTMLButtonElement | null) => {
      if (typeof node.showPopover !== 'function') {
        return
      }

      if (isOpen(node)) {
        return
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
      showWithSource(arrowNode, triggerButton)

      lastOpenNodeIdRef.current = currentNodeId

      if (typeof window !== 'undefined') {
        const frameId = window.requestAnimationFrame(() => {
          popoverNode.querySelector<HTMLElement>('[data-popover-focus]')?.focus()
        })
        return () => {
          window.cancelAnimationFrame(frameId)
        }
      }

      return
    }

    if (isOpen(popoverNode) && typeof popoverNode.hidePopover === 'function') {
      popoverNode.hidePopover()
    }

    if (isOpen(arrowNode) && typeof arrowNode.hidePopover === 'function') {
      arrowNode.hidePopover()
    }

    const lastOpenNodeId = lastOpenNodeIdRef.current

    if (!lastOpenNodeId) {
      return
    }

    if (typeof window !== 'undefined') {
      const frameId = window.requestAnimationFrame(() => {
        const returnFocusButton = document.querySelector(
          `[data-selected-location-id="${lastOpenNodeId}"] .selected-location-card-button`,
        ) as HTMLButtonElement | null

        returnFocusButton?.focus()
        lastOpenNodeIdRef.current = null
      })

      return () => {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [currentNodeId, currentScope])

  const handlePopoverKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        clearCurrent()
        return
      }

      if (event.key === 'Tab') {
        const popover = popoverRef.current
        if (!popover) return

        const focusable = popover.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        if (!focusable.length) return

        const first = focusable[0]
        const last = focusable[focusable.length - 1]

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    },
    [clearCurrent],
  )

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
        aria-label="Location details"
        data-selected-location-popover-layer
        data-popover-for={currentNodeId ?? ''}
        onKeyDown={handlePopoverKeyDown}
      >
        {currentScope && routerScope ? (
          <ScopeContext.Provider value={routerScope}>
            <SelectedLocationPopover
              popoverId={SELECTED_LOCATION_POPOVER_ID}
              selectedLocationId={currentNodeId ?? ''}
              selectedLocationScope={currentScope}
              onClose={clearCurrent}
            />
          </ScopeContext.Provider>
        ) : null}
      </section>

      {/* The arrow is a separate popover element because CSS anchor positioning
          does not work for elements nested inside another anchor-positioned
          popover — a known browser implementation bug (as of 2025). Nesting the
          arrow inside the main popover causes it to lose its anchor reference.

          The arrow is keyed by currentNodeId to force a full DOM remount when
          switching locations. Firefox caches the resolved position-anchor target
          and does not recalculate it — not even after hide()/show() or a rAF
          yield. Destroying and recreating the element is the only reliable way
          to make Firefox pick up the new anchor. */}
      <section
        key={currentNodeId ?? undefined}
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
  onClose,
}: {
  popoverId: string
  selectedLocationId: string
  selectedLocationScope: ReactSyncScopeHandle
  onClose: () => void
}) {
  const dispatch = useActions()
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  const isEditingLocation = readBooleanAttr(routerAttrs.isEditingLocation)
  const searchQuery = readStringAttr(routerAttrs.searchQuery)
  const searchStatus = readStringAttr(routerAttrs.searchStatus, 'idle')
  const searchError = readNullableStringAttr(routerAttrs.searchError)
  const searchResults = toLocationSearchResults(routerAttrs.searchResults)
  const savedSearchLocations = toLocationSearchResults(routerAttrs.savedSearchLocations)
  const currentLocationStatus = readStringAttr(routerAttrs.currentLocationStatus, 'idle')
  const currentLocationError = readNullableStringAttr(routerAttrs.currentLocationError)

  const clearSearchDebounce = () => {
    if (searchDebounceRef.current != null) {
      clearTimeout(searchDebounceRef.current)
      searchDebounceRef.current = null
    }
  }

  const handleQueryChange = useCallback(
    (query: string) => {
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
    },
    [dispatch],
  )

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

  const handleSubmitSearch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      clearSearchDebounce()
      dispatch('submitLocationSearch', {
        query: searchQuery,
      })
    },
    [dispatch, searchQuery],
  )

  const handleRetrySearch = useCallback(() => {
    clearSearchDebounce()
    dispatch('submitLocationSearch', {
      query: searchQuery,
    })
  }, [dispatch, searchQuery])

  const handleSelectLocation = useCallback(
    (result: LocationSearchResult) => {
      clearSearchDebounce()
      dispatch('saveLocationSearchResult', result)
      dispatch('selectLocationSearchResult', result)
      onClose()
    },
    [dispatch, onClose],
  )

  const forgetSearchLocation = useCallback(
    (resultId: string) => {
      clearSearchDebounce()
      dispatch('removeLocationSearchResult', resultId)
    },
    [dispatch],
  )

  const handleUseCurrentLocation = useCallback(async () => {
    clearSearchDebounce()

    try {
      const coordinates = await readBrowserCoordinates()

      if (!isBrowserCoordinates(coordinates)) {
        dispatch('requestCurrentLocationFallback')
        return
      }

      dispatch('requestCurrentLocationFromBrowser', coordinates)
    } catch (error) {
      if (isGeoPermissionDeniedError(error)) {
        dispatch('requestCurrentLocationFallback')
        return
      }

      dispatch('requestCurrentLocationFallback')
    }
  }, [dispatch])

  const handleStartEdit = useCallback(
    (seedQuery: string) => dispatch('startLocationEditing', { seedQuery }),
    [dispatch],
  )

  const handleCancelEditing = useCallback(() => {
    clearSearchDebounce()
    dispatch('cancelLocationEditing')
  }, [dispatch])

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
          onStartEdit={handleStartEdit}
          onClose={onClose}
        />

        <SelectedLocationPopoverWeatherSection isEditingLocation={isEditingLocation} />

        {!isEditingLocation ? (
          <SelectedLocationPopoverSearchTrigger onStartEdit={handleStartEdit} />
        ) : null}
      </ScopeContext.Provider>

      <SelectedLocationSearchPanel
        isEditingLocation={isEditingLocation}
        searchQuery={searchQuery}
        searchStatus={searchStatus}
        searchError={searchError}
        currentLocationStatus={currentLocationStatus}
        currentLocationError={currentLocationError}
        searchResults={searchResults}
        savedResults={savedSearchLocations}
        onSubmitSearch={handleSubmitSearch}
        onRetrySearch={handleRetrySearch}
        onQueryChange={handleQueryChange}
        onUseCurrentLocation={handleUseCurrentLocation}
        onCancel={handleCancelEditing}
        onSelectResult={handleSelectLocation}
        onSelectSavedResult={handleSelectLocation}
        onRemoveSavedResult={forgetSearchLocation}
      />
    </div>
  )
}

function SelectedLocationPopoverSearchTrigger({
  onStartEdit,
}: {
  onStartEdit: (seedQuery: string) => void
}) {
  const attrs = useAttrs(['location', 'name'])
  const seedQuery = readStringAttr(attrs.location) || readStringAttr(attrs.name)

  return (
    <div className="selected-location-popover__footer">
      <button
        className="secondary selected-location-popover__edit-trigger"
        type="button"
        onClick={() => onStartEdit(seedQuery)}
        data-location-edit-trigger
        data-popover-focus
      >
        Search Another Location
      </button>
    </div>
  )
}

const SelectedLocationPopoverHeader = memo(function SelectedLocationPopoverHeader({
  isEditingLocation,
  onStartEdit,
  onClose,
}: {
  isEditingLocation: boolean
  onStartEdit: (seedQuery: string) => void
  onClose: () => void
}) {
  const headerAttrs = useAttrs(['location', 'name'])
  const seedQuery = readStringAttr(headerAttrs.location) || readStringAttr(headerAttrs.name)

  return (
    <div className="selected-location-popover__header">
      <div className="selected-location-popover__header-content">
        {isEditingLocation ? (
          <p className="selected-location-popover__header-note">
            Pick a replacement below to update this location card.
          </p>
        ) : null}
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
})

function SelectedLocationPopoverWeatherSection({
  isEditingLocation,
}: {
  isEditingLocation: boolean
}) {
  return (
    <One rel="weatherLocation" fallback={<PopoverWeatherSectionFallback />}>
      <SelectedLocationPopoverWeatherSectionInner isEditingLocation={isEditingLocation} />
    </One>
  )
}

function SelectedLocationPopoverWeatherSectionInner({
  isEditingLocation,
}: {
  isEditingLocation: boolean
}) {
  const dispatch = useActions()
  const weatherLocationAttrs = useAttrs(['loadStatus', 'lastError'])
  const loadStatus = readStringAttr(weatherLocationAttrs.loadStatus, 'idle')
  const lastError = readNullableStringAttr(weatherLocationAttrs.lastError)
  const weatherLoadError = loadStatus === 'error' && lastError ? lastError : null
  const handleRetryWeather = useCallback(() => {
    dispatch('retryWeatherLoad')
  }, [dispatch])

  return (
    <>
      {!isEditingLocation ? (
        <div className="selected-location-popover__body">
          <One
            rel="currentWeather"
            fallback={
              <SelectedLocationPopoverCurrentWeatherFallback
                weatherLoadError={weatherLoadError}
                onRetryWeather={handleRetryWeather}
              />
            }
          >
            <SelectedLocationPopoverCurrentWeatherPanel onRetryWeather={handleRetryWeather} />
          </One>

          <PopoverForecastColumns />
        </div>
      ) : null}
    </>
  )
}

function SelectedLocationPopoverCurrentWeatherPanel({
  onRetryWeather,
}: {
  onRetryWeather: () => void
}) {
  return (
    <article className="weather-readout weather-readout--popover">
      <CurrentWeatherCard onRetry={onRetryWeather} />
    </article>
  )
}

function SelectedLocationPopoverCurrentWeatherFallback({
  weatherLoadError,
  onRetryWeather,
}: {
  weatherLoadError: string | null
  onRetryWeather: () => void
}) {
  return (
    <>
      {weatherLoadError ? (
        <WeatherReadoutError
          message={`Weather load failed: ${weatherLoadError}`}
          onRetry={onRetryWeather}
          variant="popover"
        />
      ) : (
        <WeatherReadoutFallback variant="popover" />
      )}
    </>
  )
}
