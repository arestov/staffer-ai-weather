import { One } from './react-sync/components/One'
import { Many } from './react-sync/components/Many'
import { RootScope } from './react-sync/scope/RootScope'
import { defineShape, shapeOf } from './react-sync/shape/defineShape'
import { useAttrs } from './react-sync/hooks/useAttrs'
import type { WeatherAppSession } from './page/createWeatherAppSession'
import { useSyncRoot } from './page/react/useSyncRoot'

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

const DEFAULT_FORECAST_LIMIT = 3
const DEFAULT_ADDITIONAL_LOCATION_COUNT = 3
const LOCATION_PLACEHOLDER_KEYS = ['north', 'center', 'south'] as const
const FORECAST_PLACEHOLDER_KEYS = ['now', 'soon', 'later'] as const

export default function App({
  session,
  forecastLimit = DEFAULT_FORECAST_LIMIT,
}: {
  session: WeatherAppSession
  forecastLimit?: number
}) {
  const snapshot = useSyncRoot(session.runtime)
  const bootedLabel = snapshot.booted ? 'Booted' : 'Not booted'

  return (
    <main className="app-shell">
      <div className="app-header-shell">
        <button
          className="app-header-trigger"
          type="button"
          aria-label="Show app header"
          title="Show app header"
        />
        <header className="app-header">
          <div className="metric-strip">
            <article className="metric-card">
              <span>Boot state</span>
              <strong>{bootedLabel}</strong>
            </article>
            <article className="metric-card">
              <span>Root node</span>
              <strong>{snapshot.rootNodeId || 'pending'}</strong>
            </article>
            <article className="metric-card">
              <span>Session</span>
              <strong>{snapshot.sessionId || 'pending'}</strong>
            </article>
          </div>
        </header>
      </div>

      <RootScope runtime={session.runtime}>
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
      </RootScope>
    </main>
  )
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
  const weatherLocationAttrs = useAttrs(['loadStatus', 'lastError', 'weatherFetchedAt'])
  const loadStatus = String(weatherLocationAttrs.loadStatus || 'idle')
  const lastError = typeof weatherLocationAttrs.lastError === 'string' ? weatherLocationAttrs.lastError : null
  const weatherStatus = loadStatus === 'idle' ? undefined : loadStatus
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

  return (
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
  )
}

const FeaturedLocationCard = ({ forecastLimit }: { forecastLimit?: number }) => (
  <WeatherLocationInner featured forecastLimit={forecastLimit} />
)
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
