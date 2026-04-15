import { useEffect, useRef, useState } from 'react'

type AppHeaderProps = {
  bootedLabel: string
  rootNodeId: string | null
  sessionId: string | null
  sessionKey: string | null
  weatherLoadStatus: string
  weatherLoadError: string | null
  onRefreshWeather: () => void
}

export function AppHeader({
  bootedLabel,
  rootNodeId,
  sessionId,
  sessionKey,
  weatherLoadStatus,
  weatherLoadError,
  onRefreshWeather,
}: AppHeaderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      setIsOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div ref={shellRef} className="app-header-shell" data-open={isOpen ? 'true' : 'false'}>
      <button
        ref={triggerRef}
        className="app-header-trigger"
        type="button"
        aria-controls="app-header-panel"
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Hide system status' : 'Show system status'}
        onClick={() => setIsOpen((open) => !open)}
        title={isOpen ? 'Hide system status' : 'Show system status'}
      >
        <span className="app-header-trigger__dot" aria-hidden="true" />
        <span className="app-header-trigger__text">Status</span>
      </button>

      <header id="app-header-panel" className="app-header" hidden={!isOpen}>
        <h2 className="sr-only">System status</h2>
        <div className="metric-strip">
          <div className="metric-card">
            <span>Boot state</span>
            <strong>{bootedLabel}</strong>
          </div>
          <div className="metric-card">
            <span>Root node</span>
            <strong>{rootNodeId || 'pending'}</strong>
          </div>
          <div className="metric-card">
            <span>Session key</span>
            <strong>{sessionKey || 'pending'}</strong>
          </div>
          <div className="metric-card">
            <span>Session</span>
            <strong>{sessionId || 'pending'}</strong>
          </div>
        </div>

        {weatherLoadStatus === 'error' && weatherLoadError ? (
          <div className="app-header-error" data-weather-load-error-banner role="alert">
            <p>Weather load failed: {weatherLoadError}</p>
            <button
              type="button"
              className="secondary"
              onClick={onRefreshWeather}
              data-weather-retry
            >
              Retry weather
            </button>
          </div>
        ) : null}
      </header>
    </div>
  )
}
