import { One } from '../../react-sync/components/One'
import { Many } from '../../react-sync/components/Many'
import { defineShape, shapeOf } from '../../react-sync/shape/defineShape'
import { useAttrs } from '../../react-sync/hooks/useAttrs'

const LOCATION_PLACEHOLDER_KEYS = ['north', 'center', 'south'] as const
const FORECAST_PLACEHOLDER_KEYS = ['now', 'soon', 'later'] as const

export const DEFAULT_FORECAST_LIMIT = 3
export const DEFAULT_ADDITIONAL_LOCATION_COUNT = 3
export const POPOVER_FORECAST_LIMIT = 2

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

const CurrentWeatherShape = defineShape({
  attrs: ['location', 'status', 'temperatureText', 'summary', 'updatedAt'],
})

const ForecastShape = defineShape({
  attrs: ['label', 'temperatureText', 'summary'],
})

export const CurrentWeatherCard = shapeOf(function CurrentWeatherCard({
  loadStatus,
  loadNote,
  onRetry,
}: {
  loadStatus?: string
  loadNote?: string | null
  onRetry?: () => void
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
        {loadStatus === 'error' && onRetry ? (
          <button type="button" className="secondary" onClick={onRetry} data-weather-retry>
            Retry weather
          </button>
        ) : null}
      </p>
    </>
  )
}, CurrentWeatherShape)

export function WeatherReadoutError({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="weather-readout weather-readout--location weather-readout--error" aria-live="polite">
      <div className="weather-readout__label">Weather unavailable</div>
      <div className="weather-readout__value weather-readout__value--placeholder">-- °C</div>
      <p className="weather-readout__summary">{message}</p>
      <p className="weather-readout__meta">
        <span className="status-pill status-pill--error">error</span>
        {onRetry ? (
          <button type="button" className="secondary" onClick={onRetry} data-weather-retry>
            Retry weather
          </button>
        ) : null}
      </p>
    </div>
  )
}

export const ForecastCard = shapeOf(function ForecastCard() {
  const attrs = useAttrs(['label', 'temperatureText', 'summary'])

  return (
    <article className="forecast-chip">
      <span className="forecast-chip__label">{String(attrs.label || '')}</span>
      <strong>{String(attrs.temperatureText || '-- \u00b0C')}</strong>
      <p>{String(attrs.summary || '')}</p>
    </article>
  )
}, ForecastShape)

export function WeatherReadoutFallback() {
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

export function ForecastEmpty({ count }: { count: number }) {
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

export function ForecastPanelsFallback({ forecastLimit = DEFAULT_FORECAST_LIMIT }: { forecastLimit?: number }) {
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

export function LocationFallback({
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

export function LocationCardsFallback({ count }: { count: number }) {
  const keys = LOCATION_PLACEHOLDER_KEYS.slice(0, Math.max(0, count))

  return (
    <>
      {keys.map((key) => (
        <LocationFallback key={key} />
      ))}
    </>
  )
}

export function PopoverForecastColumns() {
  return (
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
  )
}

export function PopoverWeatherSectionFallback() {
  return (
    <div className="selected-location-popover__body">
      <WeatherReadoutFallback />
      <ForecastPanelsFallback forecastLimit={POPOVER_FORECAST_LIMIT} />
    </div>
  )
}
