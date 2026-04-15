import { Suspense, lazy } from 'react'
import { One } from '../dkt-react-sync/components/One'
import { Many } from '../dkt-react-sync/components/Many'
import { useAttrs } from '../dkt-react-sync/hooks/useAttrs'
import { useScope } from '../dkt-react-sync/hooks/useScope'
import { useNamedSessionRouter } from '../dkt-react-sync/hooks/useNamedSessionRouter'
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
import { HourlySparklineSection, DailySparklineSection } from './WeatherSparkline'

const LazySelectedLocationPopoverLayer = lazy(() =>
  import('./SelectedLocationPopover').then(m => ({ default: m.SelectedLocationPopoverLayer })),
)

export { DEFAULT_FORECAST_LIMIT }

export function WeatherGraph({
  forecastLimit = DEFAULT_FORECAST_LIMIT,
  onRefreshWeather,
}: {
  forecastLimit?: number
  onRefreshWeather: () => void
}) {
  return (
    <>
      <One rel="pioneer" fallback={<GraphFallback />}>
        <WeatherUpdateTimestamp />
        <section className="main-stage">
          <One rel="mainLocation" fallback={<LocationFallback featured forecastLimit={forecastLimit} />}>
            <FeaturedLocationCard forecastLimit={forecastLimit} onRefreshWeather={onRefreshWeather} />
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
        <LazySelectedLocationPopoverLayer onRefreshWeather={onRefreshWeather} />
      </Suspense>
    </>
  )
}

const WeatherLocationInner = ({
  featured = false,
  forecastLimit,
  onRefreshWeather,
}: {
  featured?: boolean
  forecastLimit?: number
  onRefreshWeather?: () => void
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
  const weatherLocationName = readStringAttr(weatherLocationAttrs.name)
  const loadStatus = readStringAttr(weatherLocationAttrs.loadStatus, 'idle')
  const lastError = readNullableStringAttr(weatherLocationAttrs.lastError)
  const weatherStatus = loadStatus === 'idle' ? undefined : loadStatus
  const selectedLocationId = scope?._nodeId ?? ''
  const isPopoverOpen = Boolean(selectedLocationId && popoverNodeId === selectedLocationId)
  const locationCardLabel = weatherLocationName
    ? `Open details for ${weatherLocationName}`
    : 'Open selected location details'
  const weatherLoadError = loadStatus === 'error' && lastError ? lastError : null
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
        aria-controls={SELECTED_LOCATION_POPOVER_ID}
        aria-expanded={isPopoverOpen}
        aria-haspopup="dialog"
        aria-label={locationCardLabel}
        data-popover-anchor={isPopoverOpen ? 'active' : undefined}
        data-selected-location-trigger
      >
        <div className={featured ? 'location-card location-card--featured' : 'location-card'}>
          <One rel="weatherLocation" fallback={weatherLocationBodyFallback}>
            <div className="location-card__body">
              <One
                rel="currentWeather"
                fallback={<WeatherReadoutFallback />}
              >
                <div className="weather-readout weather-readout--location">
                  <CurrentWeatherCard
                    loadStatus={weatherStatus}
                    loadNote={weatherNote}
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
          </One>
        </div>
      </button>

      {weatherLoadError ? (
        <div className="location-card__error">
          <WeatherReadoutError
            message={`Weather load failed: ${weatherLoadError}`}
            onRetry={onRefreshWeather}
          />
        </div>
      ) : null}
    </div>
  )
}

const FeaturedLocationCard = ({
  forecastLimit,
  onRefreshWeather,
}: {
  forecastLimit?: number
  onRefreshWeather: () => void
}) => <WeatherLocationInner featured forecastLimit={forecastLimit} onRefreshWeather={onRefreshWeather} />

const AdditionalLocationCard = () => <WeatherLocationInner />

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





