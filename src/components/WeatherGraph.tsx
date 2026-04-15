import { One } from '../dkt-react-sync/components/One'
import { Many } from '../dkt-react-sync/components/Many'
import { useAttrs } from '../dkt-react-sync/hooks/useAttrs'
import { useManyAttrs } from '../dkt-react-sync/hooks/useManyAttrs'
import { useScope } from '../dkt-react-sync/hooks/useScope'
import { useNamedSessionRouter } from '../dkt-react-sync/hooks/useNamedSessionRouter'
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
  ForecastPanelsFallback,
  LocationCardsFallback,
  LocationFallback,
  WeatherReadoutError,
  WeatherReadoutFallback,
  formatUpdatedAt,
} from './WeatherCards'
import { HourlySparklineSection, DailySparklineSection } from './WeatherSparkline'

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
  const weatherLocationName = typeof weatherLocationAttrs.name === 'string' ? weatherLocationAttrs.name : ''
  const loadStatus = String(weatherLocationAttrs.loadStatus || 'idle')
  const lastError = typeof weatherLocationAttrs.lastError === 'string' ? weatherLocationAttrs.lastError : null
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
                <article className="weather-readout weather-readout--location">
                  <CurrentWeatherCard
                    loadStatus={weatherStatus}
                    loadNote={weatherNote}
                  />
                </article>
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
  const allLocations = useManyAttrs('weatherLocation', ['name', 'weatherFetchedAt'])

  if (allLocations.length === 0) {
    return null
  }

  // Use the first location (main) as baseline
  const mainTime = allLocations[0].weatherFetchedAt as string | null
  const mainFmt = formatUpdatedAt(mainTime)
  if (!mainFmt) {
    return null
  }

  // Check if all locations share the same time
  const allSame = allLocations.every((loc) => loc.weatherFetchedAt === mainTime)

  if (allSame) {
    return (
      <time className="weather-global-timestamp" title={`Updated: ${mainFmt.full}`}>
        ⟳ {mainFmt.short}
      </time>
    )
  }

  // Build per-location breakdown for differing times
  const parts: string[] = []
  const fullParts: string[] = []

  for (const loc of allLocations) {
    const name = typeof loc.name === 'string' && loc.name ? loc.name : '?'
    const t = loc.weatherFetchedAt as string | null
    const fmt = formatUpdatedAt(t)
    if (fmt) {
      parts.push(`${name} ${fmt.short}`)
      fullParts.push(`${name}: ${fmt.full}`)
    }
  }

  // Short text: main time + note about differing ones
  const diffNames: string[] = []
  for (let i = 1; i < allLocations.length; i++) {
    if (allLocations[i].weatherFetchedAt !== mainTime) {
      const name = typeof allLocations[i].name === 'string' && allLocations[i].name ? allLocations[i].name as string : '?'
      const fmt = formatUpdatedAt(allLocations[i].weatherFetchedAt as string | null)
      if (fmt) {
        diffNames.push(`${name} ${fmt.short}`)
      }
    }
  }

  const shortText = `⟳ ${mainFmt.short}` + (diffNames.length > 0 ? ` · ${diffNames.join(', ')}` : '')
  const fullText = fullParts.join('\n')

  return (
    <time className="weather-global-timestamp" title={fullText}>
      {shortText}
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





