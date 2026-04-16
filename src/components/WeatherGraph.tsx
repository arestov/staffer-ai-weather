import { Suspense, lazy, useCallback } from 'react'
import { Many } from '../dkt-react-sync/components/Many'
import { One } from '../dkt-react-sync/components/One'
import { useActions } from '../dkt-react-sync/hooks/useActions'
import { useAttrs } from '../dkt-react-sync/hooks/useAttrs'
import { useNamedSessionRouter } from '../dkt-react-sync/hooks/useNamedSessionRouter'
import { useScope } from '../dkt-react-sync/hooks/useScope'
import { readNullableStringAttr, readStringAttr } from '../shared/attrReaders'
import {
  SELECTED_LOCATION_POPOVER_ID,
  SELECTED_LOCATION_POPOVER_ROUTER_NAME,
  scrollSelectedLocationIntoView,
} from './SelectedLocationPopover'
import {
  CurrentWeatherCard,
  DEFAULT_ADDITIONAL_LOCATION_COUNT,
  DEFAULT_FORECAST_LIMIT,
  ForecastPanelsFallback,
  LocationCardsFallback,
  LocationFallback,
  WeatherReadoutError,
  WeatherReadoutFallback,
} from './WeatherCards'
import { DailySparklineSection, HourlySparklineSection } from './WeatherSparkline'

const LazySelectedLocationPopoverLayer = lazy(() =>
  import('./SelectedLocationPopover').then((m) => ({ default: m.SelectedLocationPopoverLayer })),
)

export { DEFAULT_FORECAST_LIMIT }

export function WeatherGraph({
  forecastLimit = DEFAULT_FORECAST_LIMIT,
}: {
  forecastLimit?: number
}) {
  return (
    <>
      <One rel="pioneer" fallback={<GraphFallback />}>
        <WeatherUpdateTimestamp />

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

      <Suspense fallback={null}>
        <LazySelectedLocationPopoverLayer />
      </Suspense>
    </>
  )
}

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
  const locationAttrs = useAttrs(['name'])
  const locationName = readStringAttr(locationAttrs.name)
  const selectedLocationId = scope?._nodeId ?? ''
  const isPopoverOpen = Boolean(selectedLocationId && popoverNodeId === selectedLocationId)
  const locationCardLabel = locationName
    ? `Open details for ${locationName}`
    : 'Open selected location details'

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
        aria-controls={SELECTED_LOCATION_POPOVER_ID}
        aria-expanded={isPopoverOpen}
        aria-haspopup="dialog"
        aria-label={locationCardLabel}
        data-popover-anchor={isPopoverOpen ? 'active' : undefined}
        data-selected-location-trigger
      >
        <div className={featured ? 'location-card location-card--featured' : 'location-card'}>
          <One rel="weatherLocation" fallback={weatherLocationBodyFallback}>
            <WeatherLocationCardBody featured={featured} forecastLimit={forecastLimit} />
          </One>
        </div>
      </button>

      <One rel="weatherLocation">
        <WeatherLocationErrorNotice />
      </One>
    </div>
  )
}

const FeaturedLocationCard = ({
  forecastLimit,
}: {
  forecastLimit?: number
}) => <WeatherLocationInner featured forecastLimit={forecastLimit} />

const AdditionalLocationCard = () => <WeatherLocationInner />

const WeatherLocationCardBody = ({
  featured = false,
  forecastLimit,
}: {
  featured?: boolean
  forecastLimit?: number
}) => {
  const dispatch = useActions()
  const weatherLocationAttrs = useAttrs(['loadStatus', 'lastError'])
  const loadStatus = readStringAttr(weatherLocationAttrs.loadStatus, 'idle')
  const lastError = readNullableStringAttr(weatherLocationAttrs.lastError)
  const weatherStatus = loadStatus === 'idle' ? undefined : loadStatus
  const weatherNote =
    loadStatus === 'loading'
      ? 'Loading weather data'
      : loadStatus === 'error' && lastError
        ? `Last update failed: ${lastError}`
        : null
  const handleRetryWeather = useCallback(() => {
    dispatch('retryWeatherLoad')
  }, [dispatch])

  return (
    <div className="location-card__body">
      <One rel="currentWeather" fallback={<WeatherReadoutFallback />}>
        <div className="weather-readout weather-readout--location">
          <CurrentWeatherCard
            loadStatus={weatherStatus}
            loadNote={weatherNote}
            onRetry={handleRetryWeather}
          />
        </div>
      </One>

      {featured ? (
        <div className="forecast-panels">
          <HourlySparklineSection />
          <DailySparklineSection />
        </div>
      ) : null}
    </div>
  )
}

function WeatherLocationErrorNotice() {
  const dispatch = useActions()
  const weatherLocationAttrs = useAttrs(['loadStatus', 'lastError'])
  const loadStatus = readStringAttr(weatherLocationAttrs.loadStatus, 'idle')
  const lastError = readNullableStringAttr(weatherLocationAttrs.lastError)
  const weatherLoadError = loadStatus === 'error' && lastError ? lastError : null
  const handleRetryWeather = useCallback(() => {
    dispatch('retryWeatherLoad')
  }, [dispatch])

  if (!weatherLoadError) {
    return null
  }

  return (
    <div className="location-card__error">
      <WeatherReadoutError
        message={`Weather load failed: ${weatherLoadError}`}
        onRetry={handleRetryWeather}
      />
    </div>
  )
}

function WeatherUpdateTimestamp() {
  const attrs = useAttrs(['weatherUpdatedSummary'])
  const summary = attrs.weatherUpdatedSummary as
    | {
        dateTime: string | null
        shortText: string
        title: string
      }
    | null

  if (!summary) {
    return null
  }

  return (
    <time
      className="weather-global-timestamp"
      dateTime={typeof summary.dateTime === 'string' ? summary.dateTime : undefined}
      title={summary.title}
    >
      {summary.shortText}
    </time>
  )
}

function GraphFallback() {
  return (
    <div className="graph-fallback" aria-busy="true" aria-live="polite">
      <p className="sr-only" role="status">
        Loading weather dashboard.
      </p>

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

