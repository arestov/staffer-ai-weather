import { useManyAttrs } from '../dkt-react-sync/hooks/useManyAttrs'
import { WeatherConditionIcon } from './WeatherConditionIcon'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Render temperature text with °C unit at half font-size. */
function renderTemp(text: string): React.ReactNode {
  const idx = text.lastIndexOf('°C')
  if (idx === -1) return text
  return <>{text.slice(0, idx)}<span className="temp-unit">°C</span>{text.slice(idx + 2)}</>
}

const formatTimeLabel = (iso: unknown): string => {
  const s = str(iso)
  if (!s) return '--:--'
  const t = s.includes('T') ? s.split('T')[1] : s
  return t ? t.slice(0, 5) : '--:--'
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
            <WeatherConditionIcon weatherCode={weatherCode} isDay={true} />
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

const HOURLY_ATTRS = [
  'time',
  'temperatureC',
  'label',
  'temperatureText',
  'summary',
  'precipitationProbability',
  'windSpeed10m',
  'weatherCode',
] as const

const DAILY_ATTRS = [
  'date',
  'temperatureMaxC',
  'temperatureMinC',
  'label',
  'temperatureText',
  'summary',
  'sunrise',
  'sunset',
  'weatherCode',
] as const

export function HourlySparklineSection() {
  const data = useManyAttrs('hourlyForecastSeries', HOURLY_ATTRS)

  if (!data.length) return null

  const first = data[0]
  const last = data[data.length - 1]
  const temperatures = data
    .map((d) => num(d.temperatureC))
    .filter((t): t is number => t !== null)

  if (!temperatures.length) return null

  const firstTime = str(first.label) || formatTimeLabel(first.time)
  const lastTime = str(last.label) || formatTimeLabel(last.time)
  const firstTemp = str(first.temperatureText) || '-- °C'
  const lastTemp = str(last.temperatureText) || '-- °C'

  const minT = Math.min(...temperatures)
  const maxT = Math.max(...temperatures)
  const iconTrackItems = dedupeWeatherCodes(
    data.map((d) => typeof d.weatherCode === 'number' ? d.weatherCode : null),
    data.map((d) => str(d.summary)),
  )
  const titleDetail = <>{data.length}h · {Math.round(minT)}–{Math.round(maxT)} <span className="temp-unit">°C</span></>

  return (
    <div className="sparkline-section">
      <h3 className="sparkline-title">
        <span className="sparkline-title__heading">Hourly</span>
        <span className="sparkline-title__detail">{titleDetail}</span>
      </h3>
      <div className="sparkline-panel">
        <div className="sparkline-endpoints">
          <span className="sparkline-endpoint">
            <span className="sparkline-endpoint__time">{firstTime}</span>
            <span className="sparkline-endpoint__temp">{renderTemp(firstTemp)}</span>
          </span>
          <span className="sparkline-endpoint sparkline-endpoint--end">
            <span className="sparkline-endpoint__time">{lastTime}</span>
            <span className="sparkline-endpoint__temp">{renderTemp(lastTemp)}</span>
          </span>
        </div>
        <SparklineDashes temperatures={temperatures} label="Hourly temperature sparkline" />
      </div>
      <SparklineIconTrack items={iconTrackItems} count={temperatures.length} />
    </div>
  )
}

export function DailySparklineSection() {
  const data = useManyAttrs('dailyForecastSeries', DAILY_ATTRS)

  if (!data.length) return null

  // Interleave day/night temperatures into a single sequence:
  // [day1_max, day1_min, day2_max, day2_min, ...]
  // Night dashes are rendered at lower opacity.
  const interleaved: { temp: number; opacity?: number }[] = []
  for (const d of data) {
    const maxC = num(d.temperatureMaxC)
    const minC = num(d.temperatureMinC)
    if (maxC !== null) interleaved.push({ temp: maxC })
    if (minC !== null) interleaved.push({ temp: minC, opacity: 0.35 })
  }

  if (!interleaved.length) return null

  const first = data[0]
  const last = data[data.length - 1]
  const firstLabel = str(first.label) || '---'
  const lastLabel = str(last.label) || '---'
  const firstTemp = str(first.temperatureText) || '-- °C'
  const lastTemp = str(last.temperatureText) || '-- °C'

  const allTemps = interleaved.map((p) => p.temp)
  const dayTemps = data.map((d) => num(d.temperatureMaxC)).filter((t): t is number => t !== null)
  const nightTemps = data.map((d) => num(d.temperatureMinC)).filter((t): t is number => t !== null)
  const iconTrackItems = dedupeWeatherCodes(
    data.map((d) => typeof d.weatherCode === 'number' ? d.weatherCode : null),
    data.map((d) => str(d.summary)),
    (i) => i * 2,
  )
  const dayRange = dayTemps.length
    ? `${Math.round(Math.min(...dayTemps))}–${Math.round(Math.max(...dayTemps))}`
    : null
  const nightRange = nightTemps.length
    ? `${Math.round(Math.min(...nightTemps))}–${Math.round(Math.max(...nightTemps))}`
    : null

  return (
    <div className="sparkline-section">
      <h3 className="sparkline-title">
        <span className="sparkline-title__heading">Daily</span>
        <span className="sparkline-title__detail">{renderDailyTitleDetail({ dayCount: data.length, dayRange, nightRange })}</span>
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
          temperatures={allTemps}
          opacities={interleaved.map((p) => p.opacity ?? 1)}
          label="Daily temperature sparkline"
        />
      </div>
      <SparklineIconTrack items={iconTrackItems} count={interleaved.length} />
    </div>
  )
}
