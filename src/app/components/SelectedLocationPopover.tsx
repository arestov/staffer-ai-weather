import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { One } from '../../react-sync/components/One'
import { ScopeContext } from '../../react-sync/context/ScopeContext'
import { useActions } from '../../react-sync/hooks/useActions'
import { useAttrs } from '../../react-sync/hooks/useAttrs'
import type { ReactSyncScopeHandle } from '../../react-sync/scope/ScopeHandle'
import { useNamedSessionRouter } from '../../page/react/useNamedSessionRouter'
import type { LocationSearchResult } from '../rels/location-models'
import { SelectedLocationSearchPanel } from './SelectedLocationSearchPanel'
import {
  CurrentWeatherCard,
  ForecastCard,
  ForecastEmpty,
  POPOVER_FORECAST_LIMIT,
  PopoverForecastColumns,
  PopoverWeatherSectionFallback,
  WeatherReadoutFallback,
} from './WeatherCards'

export const SELECTED_LOCATION_POPOVER_ROUTER_NAME = 'router-selectedLocationPopover'
export const SELECTED_LOCATION_POPOVER_ID = 'selected-location-popover-layer'

const SELECTED_LOCATION_POPOVER_GAP = 16
const SELECTED_LOCATION_POPOVER_SCROLL_OFFSET = 24

type FloatingPopoverLayout = {
  top: number
  left: number
  width: number
  arrowLeft: number
}

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

  window.scrollBy({
    top: rect.top - SELECTED_LOCATION_POPOVER_SCROLL_OFFSET,
    behavior: 'smooth',
  })
}

const supportsCssNativePopoverPositioning = () => {
  if (
    typeof window === 'undefined' ||
    typeof HTMLElement === 'undefined' ||
    typeof CSS === 'undefined' ||
    typeof CSS.supports !== 'function'
  ) {
    return false
  }

  if (
    typeof HTMLElement.prototype.showPopover !== 'function' ||
    typeof HTMLElement.prototype.hidePopover !== 'function'
  ) {
    return false
  }

  return (
    CSS.supports('anchor-name: --selected-location-trigger') &&
    CSS.supports('position-anchor: --selected-location-trigger') &&
    CSS.supports('top: anchor(bottom)') &&
    CSS.supports('width: anchor-size(--weather-shell width)')
  )
}

const useFloatingSelectedLocationPopoverLayout = (
  selectedLocationId: string | null,
  enabled: boolean,
) => {
  const [layout, setLayout] = useState<FloatingPopoverLayout | null>(null)

  useLayoutEffect(() => {
    if (
      !enabled ||
      !selectedLocationId ||
      typeof window === 'undefined' ||
      typeof document === 'undefined'
    ) {
      setLayout(null)
      return
    }

    setLayout(null)

    let frameId = 0
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let resizeObserver: ResizeObserver | null = null

    const updateLayout = () => {
      frameId = 0
      timeoutId = null

      const anchorElement = document.querySelector(
        `[data-selected-location-id="${selectedLocationId}"]`,
      ) as HTMLElement | null
      const shellElement = document.querySelector('.app-shell') as HTMLElement | null

      if (!anchorElement || !shellElement) {
        setLayout(null)
        return
      }

      const anchorRect = anchorElement.getBoundingClientRect()
      const shellRect = shellElement.getBoundingClientRect()
      const arrowLeft = anchorRect.left - shellRect.left + anchorRect.width * 0.35

      setLayout({
        top: window.scrollY + anchorRect.bottom + SELECTED_LOCATION_POPOVER_GAP,
        left: window.scrollX + shellRect.left,
        width: shellRect.width,
        arrowLeft: Math.max(24, Math.min(shellRect.width - 24, arrowLeft)),
      })
    }

    const scheduleUpdate = () => {
      if (frameId || timeoutId != null) {
        return
      }

      if (typeof window.requestAnimationFrame === 'function') {
        frameId = window.requestAnimationFrame(updateLayout)
        return
      }

      timeoutId = setTimeout(updateLayout, 0)
    }

    scheduleUpdate()
    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, true)

    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(scheduleUpdate)

      const anchorElement = document.querySelector(
        `[data-selected-location-id="${selectedLocationId}"]`,
      ) as HTMLElement | null
      const shellElement = document.querySelector('.app-shell') as HTMLElement | null

      if (anchorElement) {
        resizeObserver.observe(anchorElement)
      }

      if (shellElement) {
        resizeObserver.observe(shellElement)
      }
    }

    return () => {
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)

      if (frameId && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frameId)
      }

      if (timeoutId != null) {
        clearTimeout(timeoutId)
      }

      resizeObserver?.disconnect()
    }
  }, [enabled, selectedLocationId])

  return layout
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

export function SelectedLocationPopoverLayer() {
  const { currentNodeId, currentScope, routerScope, clearCurrent } = useNamedSessionRouter(
    SELECTED_LOCATION_POPOVER_ROUTER_NAME,
  )
  const popoverRef = useRef<HTMLElement | null>(null)
  const nativePositioning = supportsCssNativePopoverPositioning()
  const layout = useFloatingSelectedLocationPopoverLayout(
    currentNodeId,
    true,
  )

  useEffect(() => {
    const node = popoverRef.current

    if (!nativePositioning || !node) {
      return
    }

    const isOpen = () => {
      try {
        return node.matches(':popover-open')
      } catch {
        return false
      }
    }

    if (currentNodeId && currentScope) {
      if (!isOpen()) {
        node.showPopover()
      }
      return
    }

    if (isOpen()) {
      node.hidePopover()
    }
  }, [currentNodeId, currentScope, nativePositioning])

  if (typeof document === 'undefined') {
    return null
  }

  const floatingStyle = !nativePositioning && currentNodeId && currentScope && layout
    ? {
        top: `${layout.top}px`,
        left: `${layout.left}px`,
        width: `${layout.width}px`,
      }
    : undefined

  const popoverStyle = layout
    ? ({
        ...floatingStyle,
        '--selected-location-popover-arrow-left': `${layout.arrowLeft}px`,
      } as CSSProperties)
    : floatingStyle

  return createPortal(
    <section
      ref={popoverRef}
      id={SELECTED_LOCATION_POPOVER_ID}
      popover={nativePositioning ? 'manual' : undefined}
      hidden={!nativePositioning && (!currentNodeId || !currentScope)}
      className="selected-location-popover selected-location-popover--floating"
      data-selected-location-popover-layer
      data-popover-for={currentNodeId ?? ''}
      style={popoverStyle}
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
    </section>,
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
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const runScroll = () => {
      scrollSelectedLocationIntoView(selectedLocationId)
    }

    if (typeof window.requestAnimationFrame === 'function') {
      firstFrameId = window.requestAnimationFrame(() => {
        secondFrameId = window.requestAnimationFrame(runScroll)
      })
    } else {
      timeoutId = setTimeout(runScroll, 0)
    }

    return () => {
      if (firstFrameId && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(firstFrameId)
      }

      if (secondFrameId && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(secondFrameId)
      }

      if (timeoutId != null) {
        clearTimeout(timeoutId)
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

  const handleSelectLocation = (result: LocationSearchResult) => {
    clearSearchDebounce()
    dispatch('saveLocationSearchResult', result)
    dispatch('selectLocationSearchResult', result)
  }

  const forgetSearchLocation = (resultId: string) => {
    clearSearchDebounce()
    dispatch('removeLocationSearchResult', resultId)
  }

  return (
    <div
      id={popoverId}
      className="selected-location-popover__surface"
      data-selected-location-popover
      data-popover-for={selectedLocationId}
    >
      <div className="selected-location-popover__header">
        <div>
          <div className="mini-section-label">Selected location</div>
          <h2 className="selected-location-popover__title">Edit location</h2>
        </div>

        <button
          className="secondary selected-location-popover__close"
          type="button"
          onClick={onClose}
          aria-label="Close location popover"
          data-popover-close
        >
          Close
        </button>
      </div>

      <ScopeContext.Provider value={selectedLocationScope}>
        <SelectedLocationPopoverWeatherSection
          isEditingLocation={isEditingLocation}
          onStartEdit={(seedQuery) => dispatch('startLocationEditing', { seedQuery })}
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

function SelectedLocationPopoverWeatherSection({
  isEditingLocation,
  onStartEdit,
}: {
  isEditingLocation: boolean
  onStartEdit: (seedQuery: string) => void
}) {
  return (
    <One rel="weatherLocation" fallback={<PopoverWeatherSectionFallback />}>
      <SelectedLocationPopoverWeatherSectionInner
        isEditingLocation={isEditingLocation}
        onStartEdit={onStartEdit}
      />
    </One>
  )
}

function SelectedLocationPopoverWeatherSectionInner({
  isEditingLocation,
  onStartEdit,
}: {
  isEditingLocation: boolean
  onStartEdit: (seedQuery: string) => void
}) {
  const weatherLocationAttrs = useAttrs(['name'])
  const currentName = typeof weatherLocationAttrs.name === 'string'
    ? weatherLocationAttrs.name
    : ''

  return (
    <>
      <div className="selected-location-popover__slot-header">
        <div>
          <div className="mini-section-label">Current slot</div>
          <p className="selected-location-popover__slot-name">{currentName || 'Selected location'}</p>
        </div>
      </div>

      {!isEditingLocation ? (
        <div className="selected-location-popover__body">
          <One
            rel="currentWeather"
            fallback={
              <SelectedLocationPopoverCurrentWeatherFallback
                fallbackName={currentName}
                isEditingLocation={isEditingLocation}
                onStartEdit={onStartEdit}
              />
            }
          >
            <SelectedLocationPopoverCurrentWeatherPanel
              fallbackName={currentName}
              isEditingLocation={isEditingLocation}
              onStartEdit={onStartEdit}
            />
          </One>

          <PopoverForecastColumns />
        </div>
      ) : null}
    </>
  )
}

function SelectedLocationPopoverCurrentWeatherPanel({
  fallbackName,
  isEditingLocation,
  onStartEdit,
}: {
  fallbackName: string
  isEditingLocation: boolean
  onStartEdit: (seedQuery: string) => void
}) {
  const currentWeatherAttrs = useAttrs(['location'])
  const seedQuery = typeof currentWeatherAttrs.location === 'string' && currentWeatherAttrs.location
    ? currentWeatherAttrs.location
    : fallbackName

  return (
    <>
      <div className="selected-location-popover__toolbar">
        <div className="mini-section-label">Current weather</div>

        {!isEditingLocation ? (
          <button
            type="button"
            onClick={() => onStartEdit(seedQuery)}
            data-location-edit-trigger
          >
            Search Another Location
          </button>
        ) : (
          <p className="selected-location-popover__slot-note">
            Pick a replacement below to update this location card.
          </p>
        )}
      </div>

      <article className="weather-readout weather-readout--popover">
        <CurrentWeatherCard />
      </article>
    </>
  )
}

function SelectedLocationPopoverCurrentWeatherFallback({
  fallbackName,
  isEditingLocation,
  onStartEdit,
}: {
  fallbackName: string
  isEditingLocation: boolean
  onStartEdit: (seedQuery: string) => void
}) {
  return (
    <>
      <div className="selected-location-popover__toolbar">
        <div className="mini-section-label">Current weather</div>

        {!isEditingLocation ? (
          <button
            type="button"
            onClick={() => onStartEdit(fallbackName)}
            data-location-edit-trigger
          >
            Search Another Location
          </button>
        ) : (
          <p className="selected-location-popover__slot-note">
            Pick a replacement below to update this location card.
          </p>
        )}
      </div>

      <WeatherReadoutFallback />
    </>
  )
}
