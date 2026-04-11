import { useEffect, useState } from 'react'
import { RootScope } from './react-sync/scope/RootScope'
import { defineShape, shapeOf } from './react-sync/shape/defineShape'
import { useActions } from './react-sync/hooks/useActions'
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
  const rootNodeId = snapshot.rootNodeId || 'pending'
  const bootedLabel = snapshot.booted ? 'Booted' : 'Not booted'

  return (
    <main className="app-shell">
      <section className="app-panel app-panel--hero">
        <div className="eyebrow">Weather / DKT / SharedWorker</div>
        <h1>Weather state rendered from a page-side sync graph</h1>
        <p className="lede">
          The UI reads the shared model graph from a lightweight page-side
          receiver. The worker owns the weather state, the page only paints the
          synced root data.
        </p>

        <div className="metric-grid">
          <article className="metric-card">
            <span>Boot state</span>
            <strong>{bootedLabel}</strong>
          </article>
          <article className="metric-card">
            <span>Root node</span>
            <strong>{rootNodeId}</strong>
          </article>
          <RootScope runtime={session.runtime} fallback={<StatusFallback />}>
            <StatusMetric />
          </RootScope>
        </div>
      </section>

      <section className="app-panel app-panel--content">
        <RootScope runtime={session.runtime} fallback={<ContentFallback />}>
          <WeatherContent />
        </RootScope>
      </section>
    </main>
  )
}

const WeatherContentShape = defineShape({
  attrs: ['location', 'status', 'temperatureText', 'summary', 'updatedAt'],
})

const StatusMetric = shapeOf(function StatusMetric() {
  const attrs = useAttrs(['status'])
  const statusLabel = String(attrs.status || 'booting')

  return (
    <article className="metric-card">
      <span>Status</span>
      <strong className={`status-pill status-pill--${statusLabel}`}>
        {statusLabel}
      </strong>
    </article>
  )
}, defineShape({ attrs: ['status'] }))

const WeatherContent = shapeOf(function WeatherContent() {
  const attrs = useAttrs([
    'location',
    'temperatureText',
    'summary',
    'updatedAt',
  ])
  const { dispatch } = useActions()
  const [location, setLocation] = useState('Moscow')

  useEffect(() => {
    if (typeof attrs.location === 'string' && attrs.location) {
      setLocation(attrs.location)
    }
  }, [attrs.location])

  const submitLocation = () => {
    const nextLocation = location.trim()
    if (!nextLocation) {
      return
    }

    dispatch('setLocation', nextLocation)
  }

  const refreshWeather = () => {
    dispatch('refreshWeather')
  }

  const temperatureText = String(attrs.temperatureText || '-- \u00b0C')
  const summary = String(attrs.summary || '')
  const updatedAt = (attrs.updatedAt as string | null) ?? null

  return (
    <>
      <div className="weather-readout">
        <div className="weather-readout__label">Temperature</div>
        <div className="weather-readout__value">{temperatureText}</div>
        <p className="weather-readout__summary">{summary}</p>
        <p className="weather-readout__meta">
          Updated {formatUpdatedAt(updatedAt)}
        </p>
      </div>

      <form
        className="control-bar"
        onSubmit={(event) => {
          event.preventDefault()
          submitLocation()
        }}
      >
        <label className="control-bar__field">
          <span>Set location</span>
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Type a city name"
            spellCheck={false}
          />
        </label>

        <div className="control-bar__actions">
          <button type="submit">Set location</button>
          <button type="button" className="secondary" onClick={refreshWeather}>
            Refresh weather
          </button>
        </div>
      </form>
    </>
  )
}, WeatherContentShape)

function StatusFallback() {
  return (
    <article className="metric-card">
      <span>Status</span>
      <strong className="status-pill status-pill--booting">booting</strong>
    </article>
  )
}

function ContentFallback() {
  return (
    <div className="weather-readout">
      <div className="weather-readout__label">Temperature</div>
      <div className="weather-readout__value">-- °C</div>
      <p className="weather-readout__summary">Booting weather runtime</p>
      <p className="weather-readout__meta">Updated not updated yet</p>
    </div>
  )
}
