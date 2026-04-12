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

export default function App({ session }: { session: WeatherAppSession }) {
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

      <RootScope runtime={session.runtime} fallback={<GraphFallback />}>
        <One rel="pioneer" fallback={<GraphFallback />}>
          <section className="main-stage">
            <One rel="mainLocation" fallback={<LocationFallback featured />}>
              <FeaturedLocationCard />
            </One>
          </section>

          <section className="secondary-stage">
            <div className="location-grid">
              <Many
                rel="additionalLocations"
                item={AdditionalLocationCard}
                empty={<LocationFallback />}
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

const CurrentWeatherCard = shapeOf(function CurrentWeatherCard() {
  const attrs = useAttrs([
    'location',
    'status',
    'temperatureText',
    'summary',
    'updatedAt',
  ])

  const location = String(attrs.location || 'Unknown location')
  const status = String(attrs.status || 'booting')
  const temperatureText = String(attrs.temperatureText || '-- \u00b0C')
  const summary = String(attrs.summary || '')
  const updatedAt = (attrs.updatedAt as string | null) ?? null

  return (
    <>
      <div className="weather-readout__label">{location}</div>
      <div className="weather-readout__value">{temperatureText}</div>
      <p className="weather-readout__summary">{summary}</p>
      <p className="weather-readout__meta">
        <span className={`status-pill status-pill--${status}`}>{status}</span>
        <span>Updated {formatUpdatedAt(updatedAt)}</span>
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

const WeatherLocationInner = ({ featured = false }: { featured?: boolean }) => {
  return (
    <div className={featured ? 'location-card location-card--featured' : 'location-card'}>
      <One rel="weatherLocation" fallback={<LocationFallback featured={featured} />}>
        <div className="location-card__body">
          <One rel="currentWeather" fallback={<LocationFallback featured={featured} />}>
            <article className="weather-readout weather-readout--location">
              <CurrentWeatherCard />
            </article>
          </One>

          {featured ? (
            <>
              <div className="forecast-panels">
                <div>
                  <div className="mini-section-label">Hourly forecast</div>
                  <div className="forecast-list">
                    <Many rel="hourlyForecastSeries" item={ForecastCard} empty={<ForecastEmpty />} />
                  </div>
                </div>
                <div>
                  <div className="mini-section-label">Daily forecast</div>
                  <div className="forecast-list">
                    <Many rel="dailyForecastSeries" item={ForecastCard} empty={<ForecastEmpty />} />
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

const FeaturedLocationCard = () => <WeatherLocationInner featured />
const AdditionalLocationCard = () => <WeatherLocationInner />

function GraphFallback() {
  return <div className="graph-fallback">Booting weather graph...</div>
}

function LocationFallback({ featured = false }: { featured?: boolean }) {
  return (
    <article className={featured ? 'location-card location-card--featured' : 'location-card'}>
      <div className="weather-readout weather-readout--location">
        <div className="weather-readout__label">Loading location</div>
        <div className="weather-readout__value">--</div>
        <p className="weather-readout__summary">Waiting for the model tree</p>
        <p className="weather-readout__meta">Initializing...</p>
      </div>
    </article>
  )
}

function ForecastEmpty() {
  return <article className="forecast-chip forecast-chip--empty">No forecast data</article>
}
