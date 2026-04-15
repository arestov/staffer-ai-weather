import { memo } from 'react'
import { One } from '../dkt-react-sync/components/One'
import { Many } from '../dkt-react-sync/components/Many'
import { defineShape, shapeOf } from '../dkt-react-sync/shape/defineShape'
import { useAttrs } from '../dkt-react-sync/hooks/useAttrs'
import {
  HourlySparklineSection,
  DailySparklineSection,
} from './WeatherSparkline'
import { WeatherConditionIcon } from './WeatherConditionIcon'

/** Render temperature text with °C unit at half font-size. */
function renderTemp(text: string): React.ReactNode {
  const idx = text.lastIndexOf('°C')
  if (idx === -1) return text
  return <>{text.slice(0, idx)}<span className="temp-unit">°C</span>{text.slice(idx + 2)}</>
}

const LOCATION_PLACEHOLDER_KEYS = ['north', 'center', 'south'] as const
const FORECAST_PLACEHOLDER_KEYS = ['now', 'soon', 'later'] as const

export const DEFAULT_FORECAST_LIMIT = 3
export const DEFAULT_ADDITIONAL_LOCATION_COUNT = 3
export const POPOVER_FORECAST_LIMIT = 2

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const formatUpdatedAt = (value: string | null): { short: string; full: string } | null => {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return { short: value, full: value }
  }

  const d = date.getDate()
  const mon = MONTHS_SHORT[date.getMonth()]
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')

  return {
    short: `${d} ${mon} ${h}:${m}`,
    full: date.toLocaleString(),
  }
}

const CurrentWeatherShape = defineShape({
  attrs: ['location', 'status', 'temperatureText', 'summary', 'weatherCode', 'isDay'],
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
  const attrs = useAttrs(['location', 'status', 'temperatureText', 'summary', 'weatherCode', 'isDay'])

  const rawLocation = typeof attrs.location === 'string' ? attrs.location.trim() : ''
  const location = rawLocation || '[by coordinates]'
  const status = String(loadStatus || attrs.status || 'booting')
  const temperatureText = String(attrs.temperatureText || '-- \u00b0C')
  const summary = String(attrs.summary || '')
  const weatherCode = typeof attrs.weatherCode === 'number' ? attrs.weatherCode : null
  const isDay = typeof attrs.isDay === 'boolean' ? attrs.isDay : null

  const showPill = status !== 'ready'

  return (
    <>
      <div className="weather-readout__label">{location}</div>
      <div className="weather-readout__value-row">
        <div className="weather-readout__value">{renderTemp(temperatureText)}</div>
        <div className="weather-readout__icon-col">
          <WeatherConditionIcon weatherCode={weatherCode} isDay={isDay} />
          {summary ? <p className="weather-readout__icon-summary">{summary}</p> : null}
        </div>
      </div>
      <div className="weather-readout__meta">
        {showPill ? <span className={`status-pill status-pill--${status}`}>{status}</span> : null}
        {loadNote ? <span>{loadNote}</span> : null}
        {loadStatus === 'error' && onRetry ? (
          <button type="button" className="secondary" onClick={onRetry} data-weather-retry>
            Retry weather
          </button>
        ) : null}
      </div>
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
    <div className="weather-readout weather-readout--location weather-readout--error" role="alert">
      <div className="weather-readout__label">Weather unavailable</div>
      <div className="weather-readout__value weather-readout__value--placeholder">-- <span className="temp-unit">°C</span></div>
      <p className="weather-readout__summary">{message}</p>
      <div className="weather-readout__meta">
        <span className="status-pill status-pill--error">error</span>
        {onRetry ? (
          <button type="button" className="secondary" onClick={onRetry} data-weather-retry>
            Retry weather
          </button>
        ) : null}
      </div>
    </div>
  )
}

export const ForecastCard = shapeOf(function ForecastCard() {
  const attrs = useAttrs(['label', 'temperatureText', 'summary'])

  return (
    <li className="forecast-chip">
      <span className="forecast-chip__label">{String(attrs.label || '')}</span>
      <strong>{renderTemp(String(attrs.temperatureText || '-- \u00b0C'))}</strong>
      <p>{String(attrs.summary || '')}</p>
    </li>
  )
}, ForecastShape)

export const WeatherReadoutFallback = memo(function WeatherReadoutFallback() {
  return (
    <div className="weather-readout weather-readout--location weather-readout--placeholder">
      <span className="sr-only">Loading weather information.</span>
      <div className="weather-readout__label" aria-hidden="true">
        <span className="skeleton skeleton-line skeleton-line--label" />
      </div>
      <div className="weather-readout__value weather-readout__value--placeholder" aria-hidden="true">
        <span className="skeleton skeleton-block skeleton-block--value" />
      </div>
      <p className="weather-readout__summary" aria-hidden="true">
        <span className="skeleton skeleton-line skeleton-line--summary" />
      </p>
      <div className="weather-readout__meta" aria-hidden="true">
        <span className="skeleton skeleton-pill" />
        <span className="skeleton skeleton-line skeleton-line--meta" />
      </div>
    </div>
  )
})

export function ForecastEmpty({ count }: { count: number }) {
  const keys = FORECAST_PLACEHOLDER_KEYS.slice(0, Math.max(0, count))

  return (
    <>
      {keys.map((key) => (
        <li
          key={key}
          className="forecast-chip forecast-chip--empty forecast-chip--placeholder"
          aria-hidden="true"
        >
          <span className="skeleton skeleton-line skeleton-line--label" />
          <span className="skeleton skeleton-block skeleton-block--forecast-value" />
          <span className="skeleton skeleton-line skeleton-line--summary" />
        </li>
      ))}
    </>
  )
}

export const ForecastPanelsFallback = memo(function ForecastPanelsFallback({ forecastLimit = DEFAULT_FORECAST_LIMIT }: { forecastLimit?: number }) {
  return (
    <div className="forecast-panels">
      <div>
        <h3 className="mini-section-label">Hourly forecast</h3>
        <ul className="forecast-list" aria-label="Hourly forecast">
          <ForecastEmpty count={forecastLimit} />
        </ul>
      </div>
      <div>
        <h3 className="mini-section-label">Daily forecast</h3>
        <ul className="forecast-list" aria-label="Daily forecast">
          <ForecastEmpty count={forecastLimit} />
        </ul>
      </div>
    </div>
  )
})

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
      <HourlySparklineSection />
      <DailySparklineSection />
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




