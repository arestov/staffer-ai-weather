type AppHeaderProps = {
  bootedLabel: string
  rootNodeId: string | null
  sessionId: string | null
  weatherLoadStatus: string
  weatherLoadError: string | null
  onRefreshWeather: () => void
}

export function AppHeader({
  bootedLabel,
  rootNodeId,
  sessionId,
  weatherLoadStatus,
  weatherLoadError,
  onRefreshWeather,
}: AppHeaderProps) {
  return (
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
            <strong>{rootNodeId || 'pending'}</strong>
          </article>
          <article className="metric-card">
            <span>Session</span>
            <strong>{sessionId || 'pending'}</strong>
          </article>
        </div>

        {weatherLoadStatus === 'error' && weatherLoadError ? (
          <div className="app-header-error" data-weather-load-error-banner>
            <p>Weather load failed: {weatherLoadError}</p>
            <button type="button" className="secondary" onClick={onRefreshWeather} data-weather-retry>
              Retry weather
            </button>
          </div>
        ) : null}
      </header>
    </div>
  )
}
