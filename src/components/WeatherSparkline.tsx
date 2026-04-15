import { Suspense, lazy } from 'react'
import { useAttrs } from '../dkt-react-sync/hooks/useAttrs'

const LazyWeatherConditionIcon = lazy(() =>
  import('./WeatherConditionIcon').then(m => ({ default: m.WeatherConditionIcon })),
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Render temperature text with °C unit at half font-size. */
function renderTemp(text: string): React.ReactNode {
  const idx = text.lastIndexOf('°C')
  if (idx === -1) return text
  return <>{text.slice(0, idx)}<span className="temp-unit">°C</span>{text.slice(idx + 2)}</>
}

const renderDailyTitleDetail = ({
  dayCount,
  dayRange,
  nightRange,
}: {
  dayCount: number
  dayRange: string | null
  nightRange: string | null
}) => {
  return (
    <>
      <span>{`${dayCount}d`}</span>
      {dayRange ? (
        <>
          <span> · </span>
          <span className="sparkline-title__detail-part sparkline-title__detail-part--day">
            ☀ {dayRange} <span className="temp-unit">°C</span>
          </span>
        </>
      ) : null}
      {nightRange ? (
        <>
          <span> · </span>
          <span className="sparkline-title__detail-part sparkline-title__detail-part--night">
            ☾ {nightRange} <span className="temp-unit">°C</span>
          </span>
        </>
      ) : null}
    </>
  )
}

const renderDailyTemperatureText = (text: string) => {
  const parts = text.split(' / ')

  if (parts.length !== 2) {
    return text
  }

  // Model gives "min / max" i.e. "night / day" — render day first
  return (
    <>
      <span className="sparkline-endpoint__temp-part sparkline-endpoint__temp-part--day">
        {renderTemp(parts[1])}
      </span>
      <span className="sparkline-endpoint__temp-divider"> / </span>
      <span className="sparkline-endpoint__temp-part sparkline-endpoint__temp-part--night">
        {renderTemp(parts[0])}
      </span>
    </>
  )
}

// ---------------------------------------------------------------------------
// sparkline SVG primitives
// ---------------------------------------------------------------------------

const VB_WIDTH = 200
const VB_HEIGHT = 28
const PAD_Y = 4
const USABLE_H = VB_HEIGHT - PAD_Y * 2
const DASH_GAP = 3

function mapY(value: number, min: number, max: number): number {
  if (max === min) return VB_HEIGHT / 2
  return PAD_Y + (1 - (value - min) / (max - min)) * USABLE_H
}

/** Build deduplicated label list: only keep labels that differ from the previous. */
function dedupeLabels(
  summaries: string[],
  columnIndex?: (i: number) => number,
): { col: number; text: string }[] {
  const items: { col: number; text: string }[] = []
  let prev = ''
  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i]
    if (s && s !== prev) {
      items.push({ col: columnIndex ? columnIndex(i) : i, text: s })
    }
    if (s) prev = s
  }
  return items
}

/** Build deduplicated weather-code list: only keep codes that differ from the previous. */
function dedupeWeatherCodes(
  codes: (number | null)[],
  summaries: string[],
  columnIndex?: (i: number) => number,
): { col: number; weatherCode: number; summary: string }[] {
  const items: { col: number; weatherCode: number; summary: string }[] = []
  let prev: number | null = null
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]
    if (code !== null && code !== prev) {
      items.push({ col: columnIndex ? columnIndex(i) : i, weatherCode: code, summary: summaries[i] || '' })
    }
    if (code !== null) prev = code
  }
  return items
}

/** Text sparkline: labels absolutely positioned to match SVG dash positions. */
function SparklineTextTrack({
  items,
  count,
}: {
  items: { col: number; text: string }[]
  count: number
}) {
  if (!items.length) return null

  const dashW = (VB_WIDTH - (count - 1) * DASH_GAP) / count

  return (
    <div className="sparkline-text-track">
      {items.map(({ col, text }) => {
        const leftPct = (col * (dashW + DASH_GAP)) / VB_WIDTH * 100
        return (
          <span
            key={col}
            className="sparkline-text-track__label"
            style={{ left: `${leftPct}%` }}
          >
            {text}
          </span>
        )
      })}
    </div>
  )
}

/** Icon sparkline: small animated weather icons positioned to match SVG dash positions. */
function SparklineIconTrack({
  items,
  count,
}: {
  items: { col: number; weatherCode: number; summary: string }[]
  count: number
}) {
  if (!items.length) return null

  const dashW = (VB_WIDTH - (count - 1) * DASH_GAP) / count
  const stepPct = (dashW + DASH_GAP) / VB_WIDTH * 100
  const gapPct = DASH_GAP / VB_WIDTH * 100

  return (
    <div className="sparkline-icon-track">
      {items.map(({ col, weatherCode, summary }) => {
        const leftPct = (col * (dashW + DASH_GAP)) / VB_WIDTH * 100
        return (
          <div
            key={col}
            className="sparkline-icon-track__icon"
            role="img"
            aria-label={summary}
            style={{ left: `${leftPct}%`, width: `${stepPct}%`, '--sparkline-gap': `${gapPct}%` } as React.CSSProperties}
          >
            <Suspense fallback={null}>
              <LazyWeatherConditionIcon weatherCode={weatherCode} isDay={true} />
            </Suspense>
          </div>
        )
      })}
    </div>
  )
}

/** One horizontal dash per data point, all on a shared y-scale. */
function SparklineDashes({
  temperatures,
  opacities,
  label,
}: {
  temperatures: number[]
  opacities?: number[]
  label: string
}) {
  if (!temperatures.length) return null

  const min = Math.min(...temperatures)
  const max = Math.max(...temperatures)
  const n = temperatures.length
  const dashW = (VB_WIDTH - (n - 1) * DASH_GAP) / n

  return (
    <svg
      className="sparkline-svg"
      viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <desc>{`${Math.round(min)} °C – ${Math.round(max)} °C, ${n} points`}</desc>
      {temperatures.map((temp, i) => {
        const x = i * (dashW + DASH_GAP)
        const y = mapY(temp, min, max)
        const opacity = opacities?.[i]
        return (
          <line
            key={i}
            x1={x}
            x2={x + dashW}
            y1={y}
            y2={y}
            stroke="currentColor"
            strokeWidth={2.5}
            opacity={opacity}
          />
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// public section components
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// sparkline data types (pre-computed in WeatherLocation model)
// ---------------------------------------------------------------------------

type HourlySparklineData = {
  temperatures: number[]
  minC: number
  maxC: number
  count: number
  firstLabel: string
  lastLabel: string
  firstTemp: string
  lastTemp: string
  weatherCodes: (number | null)[]
  weatherSummaries: string[]
}

type DailySparklineData = {
  temperatures: number[]
  opacities: number[]
  count: number
  firstLabel: string
  lastLabel: string
  firstTemp: string
  lastTemp: string
  dayRange: string | null
  nightRange: string | null
  weatherCodes: (number | null)[]
  weatherSummaries: string[]
}

const isHourlySparkline = (v: unknown): v is HourlySparklineData =>
  v != null && typeof v === 'object' && Array.isArray((v as HourlySparklineData).temperatures)

const isDailySparkline = (v: unknown): v is DailySparklineData =>
  v != null && typeof v === 'object' && Array.isArray((v as DailySparklineData).temperatures)

export function HourlySparklineSection() {
  const attrs = useAttrs(['hourlySparkline'])
  const data = isHourlySparkline(attrs.hourlySparkline) ? attrs.hourlySparkline : null

  if (!data || !data.temperatures.length) return null

  const { temperatures, minC, maxC, count, firstLabel, lastLabel, firstTemp, lastTemp, weatherCodes, weatherSummaries } = data

  const iconTrackItems = dedupeWeatherCodes(weatherCodes, weatherSummaries)
  const titleDetail = <>{count}h · {Math.round(minC)}–{Math.round(maxC)} <span className="temp-unit">°C</span></>

  return (
    <div className="sparkline-section">
      <h3 className="sparkline-title">
        <span className="sparkline-title__heading">Hourly</span>
        <span className="sparkline-title__detail">{titleDetail}</span>
      </h3>
      <div className="sparkline-panel">
        <div className="sparkline-endpoints">
          <span className="sparkline-endpoint">
            <span className="sparkline-endpoint__time">{firstLabel}</span>
            <span className="sparkline-endpoint__temp">{renderTemp(firstTemp)}</span>
          </span>
          <span className="sparkline-endpoint sparkline-endpoint--end">
            <span className="sparkline-endpoint__time">{lastLabel}</span>
            <span className="sparkline-endpoint__temp">{renderTemp(lastTemp)}</span>
          </span>
        </div>
        <SparklineDashes temperatures={temperatures} label="Hourly temperature sparkline" />
      </div>
      <SparklineIconTrack items={iconTrackItems} count={count} />
    </div>
  )
}

export function DailySparklineSection() {
  const attrs = useAttrs(['dailySparkline'])
  const data = isDailySparkline(attrs.dailySparkline) ? attrs.dailySparkline : null

  if (!data || !data.temperatures.length) return null

  const { temperatures, opacities, count, firstLabel, lastLabel, firstTemp, lastTemp, dayRange, nightRange, weatherCodes, weatherSummaries } = data

  const iconTrackItems = dedupeWeatherCodes(weatherCodes, weatherSummaries, (i) => i * 2)
  const titleDetail = renderDailyTitleDetail({ dayCount: count, dayRange, nightRange })

  return (
    <div className="sparkline-section">
      <h3 className="sparkline-title">
        <span className="sparkline-title__heading">Daily</span>
        <span className="sparkline-title__detail">{titleDetail}</span>
      </h3>
      <div className="sparkline-panel">
        <div className="sparkline-endpoints">
          <span className="sparkline-endpoint">
            <span className="sparkline-endpoint__time">{firstLabel}</span>
            <span className="sparkline-endpoint__temp sparkline-endpoint__temp--daily">
              {renderDailyTemperatureText(firstTemp)}
            </span>
          </span>
          <span className="sparkline-endpoint sparkline-endpoint--end">
            <span className="sparkline-endpoint__time">{lastLabel}</span>
            <span className="sparkline-endpoint__temp sparkline-endpoint__temp--daily">
              {renderDailyTemperatureText(lastTemp)}
            </span>
          </span>
        </div>
        <SparklineDashes
          temperatures={temperatures}
          opacities={opacities}
          label="Daily temperature sparkline"
        />
      </div>
      <SparklineIconTrack items={iconTrackItems} count={temperatures.length} />
    </div>
  )
}
