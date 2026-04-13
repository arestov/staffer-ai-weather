import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { One } from '../../react-sync/components/One'
import { Many } from '../../react-sync/components/Many'
import { ScopeContext } from '../../react-sync/context/ScopeContext'
import { defineShape, shapeOf } from '../../react-sync/shape/defineShape'
import { useActions } from '../../react-sync/hooks/useActions'
import { useAttrs } from '../../react-sync/hooks/useAttrs'
import { useScope } from '../../react-sync/hooks/useScope'
import type { ReactSyncScopeHandle } from '../../react-sync/scope/ScopeHandle'
import { useNamedSessionRouter } from '../../page/react/useNamedSessionRouter'
import type { LocationSearchResult } from '../rels/location-models'

const formatUpdatedAt = (value: string | null) => {
  if (!value) {
    return 'not updated yet'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

export const DEFAULT_FORECAST_LIMIT = 3
const DEFAULT_ADDITIONAL_LOCATION_COUNT = 3
const POPOVER_FORECAST_LIMIT = 2
const LOCATION_PLACEHOLDER_KEYS = ['north', 'center', 'south'] as const
const FORECAST_PLACEHOLDER_KEYS = ['now', 'soon', 'later'] as const
const SELECTED_LOCATION_POPOVER_ROUTER_NAME = 'router-selectedLocationPopover'
const SELECTED_LOCATION_POPOVER_ID = 'selected-location-popover-layer'
const SELECTED_LOCATION_POPOVER_GAP = 16
const SELECTED_LOCATION_POPOVER_SCROLL_OFFSET = 24

type FloatingPopoverLayout = {
  top: number
  left: number
  width: number
  arrowLeft: number
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

const scrollSelectedLocationIntoView = (selectedLocationId: string) => {
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

export function WeatherGraph({
  forecastLimit = DEFAULT_FORECAST_LIMIT,
}: {
  forecastLimit?: number
}) {
  return (
    <>
      <One rel="pioneer" fallback={<GraphFallback />}>
        <section className="main-stage">
          <One rel="mainLocation" fallback={<LocationFallback featured forecastLimit={forecastLimit} />}>
            <FeaturedLocationCard forecastLimit={forecastLimit} />
          </One>
        </section>

        <section className="secondary-stage">
          <div className="location-grid">
            <Many
              rel="additionalLocations"
              item={AdditionalLocationCard}
              empty={<LocationCardsFallback count={DEFAULT_ADDITIONAL_LOCATION_COUNT} />}
            />
          </div>
        </section>
      </One>

      <SelectedLocationPopoverLayer />
    </>
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

const CurrentWeatherShape = defineShape({
  attrs: ['location', 'status', 'temperatureText', 'summary', 'updatedAt'],
})

const ForecastShape = defineShape({
  attrs: ['label', 'temperatureText', 'summary'],
})

const CurrentWeatherCard = shapeOf(function CurrentWeatherCard({
  loadStatus,
  loadNote,
}: {
  loadStatus?: string
  loadNote?: string | null
}) {
  const attrs = useAttrs(['location', 'status', 'temperatureText', 'summary', 'updatedAt'])

  const location = String(attrs.location || 'Unknown location')
  const status = String(loadStatus || attrs.status || 'booting')
  const temperatureText = String(attrs.temperatureText || '-- \u00b0C')
  const summary = String(attrs.summary || '')
  const updatedAt = (attrs.updatedAt as string | null) ?? null
  const statusNote = loadNote ?? (updatedAt ? `Updated ${formatUpdatedAt(updatedAt)}` : null)

  return (
    <>
      <div className="weather-readout__label">{location}</div>
      <div className="weather-readout__value">{temperatureText}</div>
      <p className="weather-readout__summary">{summary}</p>
      <p className="weather-readout__meta">
        <span className={`status-pill status-pill--${status}`}>{status}</span>
        {statusNote ? <span>{statusNote}</span> : null}
      </p>
    </>
  )
}, CurrentWeatherShape)

const ForecastCard = shapeOf(function ForecastCard() {
  const attrs = useAttrs(['label', 'temperatureText', 'summary'])

  return (
    <article className="forecast-chip">
      <span className="forecast-chip__label">{String(attrs.label || '')}</span>
      <strong>{String(attrs.temperatureText || '-- \u00b0C')}</strong>
      <p>{String(attrs.summary || '')}</p>
    </article>
  )
}, ForecastShape)

const WeatherLocationInner = ({
  featured = false,
  forecastLimit,
}: {
  featured?: boolean
  forecastLimit?: number
}) => {
  const scope = useScope()
  const { currentNodeId: popoverNodeId, openResource } =
    useNamedSessionRouter(SELECTED_LOCATION_POPOVER_ROUTER_NAME)
  const weatherLocationAttrs = useAttrs([
    'name',
    'loadStatus',
    'lastError',
    'weatherFetchedAt',
  ])
  const loadStatus = String(weatherLocationAttrs.loadStatus || 'idle')
  const lastError = typeof weatherLocationAttrs.lastError === 'string' ? weatherLocationAttrs.lastError : null
  const weatherStatus = loadStatus === 'idle' ? undefined : loadStatus
  const selectedLocationId = scope?._nodeId ?? ''
  const isPopoverOpen = Boolean(selectedLocationId && popoverNodeId === selectedLocationId)
  const weatherNote =
    loadStatus === 'loading'
      ? 'Loading weather data'
      : loadStatus === 'error' && lastError
        ? `Last update failed: ${lastError}`
        : null

  const weatherLocationBodyFallback = (
    <div className="location-card__body">
      <WeatherReadoutFallback />
      {featured ? <ForecastPanelsFallback forecastLimit={forecastLimit} /> : null}
    </div>
  )

  const openPopover = () => {
    if (!selectedLocationId) {
      return
    }

    openResource(selectedLocationId)
    scrollSelectedLocationIntoView(selectedLocationId)
  }

  return (
    <div
      className={featured ? 'selected-location-shell selected-location-shell--featured' : 'selected-location-shell'}
      data-selected-location-id={selectedLocationId}
    >
      <button
        className="selected-location-card-button"
        type="button"
        onClick={openPopover}
        aria-expanded={isPopoverOpen}
        aria-controls={isPopoverOpen ? SELECTED_LOCATION_POPOVER_ID : undefined}
        data-popover-anchor={isPopoverOpen ? 'active' : undefined}
        data-selected-location-trigger
      >
        <div className={featured ? 'location-card location-card--featured' : 'location-card'}>
          <One rel="weatherLocation" fallback={weatherLocationBodyFallback}>
            <div className="location-card__body">
              <One rel="currentWeather" fallback={<WeatherReadoutFallback />}>
                <article className="weather-readout weather-readout--location">
                  <CurrentWeatherCard loadStatus={weatherStatus} loadNote={weatherNote} />
                </article>
              </One>

              {featured ? (
                <>
                  <div className="forecast-panels">
                    <div>
                      <div className="mini-section-label">Hourly forecast</div>
                      <div className="forecast-list">
                        <Many
                          rel="hourlyForecastSeries"
                          item={ForecastCard}
                          empty={<ForecastEmpty count={forecastLimit ?? DEFAULT_FORECAST_LIMIT} />}
                          limit={forecastLimit}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="mini-section-label">Daily forecast</div>
                      <div className="forecast-list">
                        <Many
                          rel="dailyForecastSeries"
                          item={ForecastCard}
                          empty={<ForecastEmpty count={forecastLimit ?? DEFAULT_FORECAST_LIMIT} />}
                          limit={forecastLimit}
                        />
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </One>
        </div>
      </button>
    </div>
  )
}

const FeaturedLocationCard = ({ forecastLimit }: { forecastLimit?: number }) => (
  <WeatherLocationInner featured forecastLimit={forecastLimit} />
)
const AdditionalLocationCard = () => <WeatherLocationInner />

function SelectedLocationPopoverLayer() {
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
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const routerAttrs = useAttrs([
    'isEditingLocation',
    'searchQuery',
    'searchStatus',
    'searchError',
    'searchResults',
  ])
  const isEditingLocation = Boolean(routerAttrs.isEditingLocation)
  const searchQuery = typeof routerAttrs.searchQuery === 'string' ? routerAttrs.searchQuery : ''
  const searchStatus = typeof routerAttrs.searchStatus === 'string' ? routerAttrs.searchStatus : 'idle'
  const searchError = typeof routerAttrs.searchError === 'string' ? routerAttrs.searchError : null
  const searchResults = toLocationSearchResults(routerAttrs.searchResults)

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
    dispatch('submitLocationSearch', {
      query: searchInputRef.current?.value ?? searchQuery,
    })
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

      {isEditingLocation ? (
        <section className="selected-location-search" data-location-search-panel>
          <div className="selected-location-search__header">
            <div>
              <div className="mini-section-label">Find replacement</div>
              <p className="selected-location-search__hint">
                Search results live on the popover router and apply to this selected slot in place.
              </p>
            </div>
          </div>

          <form className="selected-location-search__form" onSubmit={handleSubmitSearch} data-location-search-form>
            <label className="selected-location-search__field">
              <span className="selected-location-search__label">City or region</span>
              <input
                key={`${selectedLocationId}:${searchQuery}:${isEditingLocation ? 'editing' : 'idle'}`}
                ref={searchInputRef}
                type="text"
                defaultValue={searchQuery}
                placeholder="Search for a location"
                data-location-search-input
              />
            </label>

            <div className="selected-location-search__controls">
              <button type="submit" data-location-search-submit>
                Search
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => dispatch('cancelLocationEditing')}
                data-location-search-cancel
              >
                Cancel
              </button>
            </div>
          </form>

          {searchStatus === 'loading' ? (
            <p className="selected-location-search__status" aria-live="polite" data-location-search-status>
              Searching for matches...
            </p>
          ) : null}

          {searchStatus === 'error' && searchError ? (
            <p className="selected-location-search__status selected-location-search__status--error" data-location-search-status>
              {searchError}
            </p>
          ) : null}

          {searchStatus === 'ready' && !searchResults.length ? (
            <p className="selected-location-search__status" data-location-search-empty>
              No matches found. Try a broader city or region name.
            </p>
          ) : null}

          {searchResults.length ? (
            <div className="selected-location-search__results" data-location-search-results>
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  className="selected-location-search__result"
                  type="button"
                  onClick={() => dispatch('selectLocationSearchResult', result)}
                  data-location-search-result={result.id}
                >
                  <strong>{result.name}</strong>
                  <span>{result.subtitle || `${result.latitude.toFixed(2)}, ${result.longitude.toFixed(2)}`}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
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
    <One
      rel="weatherLocation"
      fallback={
        <div className="selected-location-popover__body">
          <WeatherReadoutFallback />
          <ForecastPanelsFallback forecastLimit={POPOVER_FORECAST_LIMIT} />
        </div>
      }
    >
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

          <div className="selected-location-popover__forecasts">
            <div>
              <div className="mini-section-label">Hourly forecast</div>
              <div className="forecast-list forecast-list--popover">
                <Many
                  rel="hourlyForecastSeries"
                  item={ForecastCard}
                  empty={<ForecastEmpty count={POPOVER_FORECAST_LIMIT} />}
                  limit={POPOVER_FORECAST_LIMIT}
                />
              </div>
            </div>

            <div>
              <div className="mini-section-label">Daily forecast</div>
              <div className="forecast-list forecast-list--popover">
                <Many
                  rel="dailyForecastSeries"
                  item={ForecastCard}
                  empty={<ForecastEmpty count={POPOVER_FORECAST_LIMIT} />}
                  limit={POPOVER_FORECAST_LIMIT}
                />
              </div>
            </div>
          </div>
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

function GraphFallback() {
  return (
    <div className="graph-fallback" aria-busy="true" aria-live="polite">
      <section className="main-stage">
        <LocationFallback featured forecastLimit={DEFAULT_FORECAST_LIMIT} />
      </section>

      <section className="secondary-stage">
        <div className="location-grid">
          <LocationCardsFallback count={DEFAULT_ADDITIONAL_LOCATION_COUNT} />
        </div>
      </section>
    </div>
  )
}

function WeatherReadoutFallback() {
  return (
    <div className="weather-readout weather-readout--location weather-readout--placeholder">
      <div className="weather-readout__label" aria-hidden="true">
        <span className="skeleton skeleton-line skeleton-line--label" />
      </div>
      <div className="weather-readout__value weather-readout__value--placeholder" aria-hidden="true">
        <span className="skeleton skeleton-block skeleton-block--value" />
      </div>
      <p className="weather-readout__summary" aria-hidden="true">
        <span className="skeleton skeleton-line skeleton-line--summary" />
      </p>
      <p className="weather-readout__meta" aria-hidden="true">
        <span className="skeleton skeleton-pill" />
        <span className="skeleton skeleton-line skeleton-line--meta" />
      </p>
    </div>
  )
}

function ForecastPanelsFallback({ forecastLimit = DEFAULT_FORECAST_LIMIT }: { forecastLimit?: number }) {
  return (
    <div className="forecast-panels">
      <div>
        <div className="mini-section-label">Hourly forecast</div>
        <div className="forecast-list">
          <ForecastEmpty count={forecastLimit} />
        </div>
      </div>
      <div>
        <div className="mini-section-label">Daily forecast</div>
        <div className="forecast-list">
          <ForecastEmpty count={forecastLimit} />
        </div>
      </div>
    </div>
  )
}

function LocationFallback({
  featured = false,
  forecastLimit = DEFAULT_FORECAST_LIMIT,
}: {
  featured?: boolean
  forecastLimit?: number
}) {
  return (
    <article
      className={
        featured
          ? 'location-card location-card--featured location-card--placeholder'
          : 'location-card location-card--placeholder'
      }
      aria-busy="true"
      aria-label="Loading weather card"
    >
      <div className="location-card__body">
        <WeatherReadoutFallback />
        {featured ? <ForecastPanelsFallback forecastLimit={forecastLimit} /> : null}
      </div>
    </article>
  )
}

function LocationCardsFallback({ count }: { count: number }) {
  const keys = LOCATION_PLACEHOLDER_KEYS.slice(0, Math.max(0, count))

  return (
    <>
      {keys.map((key) => (
        <LocationFallback key={key} />
      ))}
    </>
  )
}

function ForecastEmpty({ count }: { count: number }) {
  const keys = FORECAST_PLACEHOLDER_KEYS.slice(0, Math.max(0, count))

  return (
    <>
      {keys.map((key) => (
        <article
          key={key}
          className="forecast-chip forecast-chip--empty forecast-chip--placeholder"
          aria-hidden="true"
        >
          <span className="skeleton skeleton-line skeleton-line--label" />
          <span className="skeleton skeleton-block skeleton-block--forecast-value" />
          <span className="skeleton skeleton-line skeleton-line--summary" />
        </article>
      ))}
    </>
  )
}
