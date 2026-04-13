import { RootScope } from './react-sync/scope/RootScope'
import type { WeatherAppSession } from './page/createWeatherAppSession'
import { useSyncRoot } from './page/react/useSyncRoot'
import { AppHeader } from './app/components/AppHeader'
import { DEFAULT_FORECAST_LIMIT, WeatherGraph } from './app/components/WeatherGraph'

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
      <AppHeader
        bootedLabel={bootedLabel}
        rootNodeId={snapshot.rootNodeId}
        sessionId={snapshot.sessionId}
        weatherLoadStatus={snapshot.weatherLoadStatus}
        weatherLoadError={snapshot.weatherLoadError}
        onRefreshWeather={session.refreshWeather}
      />

      <RootScope runtime={session.runtime}>
        <WeatherGraph forecastLimit={forecastLimit} onRefreshWeather={session.refreshWeather} />
      </RootScope>
    </main>
  )
}
