type AppHeaderProps = {
  bootedLabel: string
  rootNodeId: string | null
  sessionId: string | null
}

export function AppHeader({ bootedLabel, rootNodeId, sessionId }: AppHeaderProps) {
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
      </header>
    </div>
  )
}
