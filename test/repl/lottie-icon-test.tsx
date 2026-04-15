/**
 * Minimal browser-level test for the Lottie weather icon rendering.
 * Runs inside Vite dev server + Playwright so we get real Worker + OffscreenCanvas.
 *
 * Entry: a tiny HTML page that mounts a single React component with the
 * WeatherConditionIcon, using hardcoded weatherCode / isDay values.
 */
import { createRoot } from 'react-dom/client'
import { WeatherConditionIcon } from '../../src/components/WeatherConditionIcon'

function TestHarness() {
  return (
    <div style={{ display: 'flex', gap: 24, padding: 24, background: '#111', flexWrap: 'wrap' }}>
      <TestCard label="Clear day (code 0)" weatherCode={0} isDay={true} />
      <TestCard label="Rain (code 63)" weatherCode={63} isDay={true} />
      <TestCard label="Thunderstorm night (code 95)" weatherCode={95} isDay={false} />
      <TestCard label="Snow (code 73)" weatherCode={73} isDay={true} />
      <TestCard label="No code (null)" weatherCode={null} isDay={null} />
    </div>
  )
}

function TestCard({
  label,
  weatherCode,
  isDay,
}: {
  label: string
  weatherCode: number | null
  isDay: boolean | null
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        color: '#eee',
        fontFamily: 'system-ui',
      }}
      data-testcard={label}
    >
      <WeatherConditionIcon weatherCode={weatherCode} isDay={isDay} size={64} />
      <span style={{ fontSize: 12 }}>{label}</span>
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<TestHarness />)
}
