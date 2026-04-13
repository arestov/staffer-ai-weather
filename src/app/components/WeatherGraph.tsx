import { One } from '../../react-sync/components/One'
import { Many } from '../../react-sync/components/Many'
import { useAttrs } from '../../react-sync/hooks/useAttrs'
import { useScope } from '../../react-sync/hooks/useScope'
import { useNamedSessionRouter } from '../../page/react/useNamedSessionRouter'
import {
  SELECTED_LOCATION_POPOVER_ID,
  SELECTED_LOCATION_POPOVER_ROUTER_NAME,
  SelectedLocationPopoverLayer,
  scrollSelectedLocationIntoView,
} from './SelectedLocationPopover'
import {
  CurrentWeatherCard,
  DEFAULT_ADDITIONAL_LOCATION_COUNT,
  DEFAULT_FORECAST_LIMIT,
  ForecastCard,
  ForecastEmpty,
  ForecastPanelsFallback,
  LocationCardsFallback,
  LocationFallback,
  WeatherReadoutError,
  WeatherReadoutFallback,
} from './WeatherCards'

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

      <SelectedLocationPopoverLayer onRefreshWeather={onRefreshWeather} />
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
  const loadStatus = String(weatherLocationAttrs.loadStatus || 'idle')
  const lastError = typeof weatherLocationAttrs.lastError === 'string' ? weatherLocationAttrs.lastError : null
  const weatherStatus = loadStatus === 'idle' ? undefined : loadStatus
  const selectedLocationId = scope?._nodeId ?? ''
  const isPopoverOpen = Boolean(selectedLocationId && popoverNodeId === selectedLocationId)
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
        aria-expanded={isPopoverOpen}
        aria-controls={isPopoverOpen ? SELECTED_LOCATION_POPOVER_ID : undefined}
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
                <article className="weather-readout weather-readout--location">
                  <CurrentWeatherCard
                    loadStatus={weatherStatus}
                    loadNote={weatherNote}
                  />
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
