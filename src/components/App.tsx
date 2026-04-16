import { RootScope } from '../dkt-react-sync/scope/RootScope'
import type { WeatherAppSession } from '../page/createWeatherAppSession'
import { useSyncRoot } from '../dkt-react-sync/hooks/useSyncRoot'
import { AppHeader } from './AppHeader'
import { DEFAULT_FORECAST_LIMIT, WeatherGraph } from './WeatherGraph'
import { useSyncExternalStore } from 'react'

export default function App({
  session,
  forecastLimit = DEFAULT_FORECAST_LIMIT,
}: {
  session: WeatherAppSession
  forecastLimit?: number
}) {
  const snapshot = useSyncRoot(session.runtime)
  const subscribeP2PStatus = session.subscribeP2PStatus ?? (() => () => {})
  const p2pStatus = useSyncExternalStore(
    subscribeP2PStatus,
    () => session.p2pStatus ?? 'disabled',
    () => session.p2pStatus ?? 'disabled',
  )
  const bootedLabel = snapshot.booted ? 'Booted' : 'Not booted'
  const p2pStatusLabel =
    p2pStatus === 'disabled'
      ? 'Disabled'
      : p2pStatus === 'undecided'
        ? 'Negotiating'
        : p2pStatus === 'server'
          ? 'Server'
          : 'Client'

  return (
    <main className="app-shell">
      <h1 className="sr-only">Weather dashboard</h1>

      <AppHeader
        bootedLabel={bootedLabel}
        rootNodeId={snapshot.rootNodeId}
        sessionId={snapshot.sessionId}
        sessionKey={snapshot.sessionKey}
        p2pStatusLabel={p2pStatusLabel}
      />

      <div id="main-content">
        <RootScope runtime={session.runtime}>
          <WeatherGraph forecastLimit={forecastLimit} onRefreshWeather={session.refreshWeather} />
        </RootScope>
      </div>
    </main>
  )
}


