import { RootScope } from '../dkt-react-sync/scope/RootScope'
import type { WeatherAppSession } from '../page/createWeatherAppSession'
import { useSyncRoot } from '../dkt-react-sync/hooks/useSyncRoot'
import { AppHeader } from './AppHeader'
import { DEFAULT_FORECAST_LIMIT, WeatherGraph } from './WeatherGraph'

export default function App({
  session,
  forecastLimit = DEFAULT_FORECAST_LIMIT,
}: {
  session: WeatherAppSession
  forecastLimit?: number
}) {
  const snapshot = useSyncRoot(session.runtime)
  const bootedLabel = snapshot.booted ? 'Booted' : 'Not booted'

  return (
    <main className="app-shell">
      <h1 className="sr-only">Weather dashboard</h1>
      <a href="#main-content" className="skip-link">Skip to weather content</a>

      <AppHeader
        bootedLabel={bootedLabel}
        rootNodeId={snapshot.rootNodeId}
        sessionId={snapshot.sessionId}
        sessionKey={snapshot.sessionKey}
        weatherLoadStatus={snapshot.weatherLoadStatus}
        weatherLoadError={snapshot.weatherLoadError}
        onRefreshWeather={session.refreshWeather}
      />

      <div id="main-content">
        <RootScope runtime={session.runtime}>
          <WeatherGraph forecastLimit={forecastLimit} onRefreshWeather={session.refreshWeather} />
        </RootScope>
      </div>
    </main>
  )
}


