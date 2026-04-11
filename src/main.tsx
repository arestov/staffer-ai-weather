import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { createWeatherAppSession } from './page/createWeatherAppSession'
import './styles.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('missing #root element')
}

const session = createWeatherAppSession()
void session.bootstrap()

if (import.meta.env.DEV && typeof window !== 'undefined') {
  Object.assign(window as Window & { __weatherSync?: unknown }, {
    __weatherSync: {
      session,
      dumpGraph: () => session.runtime.debugDumpGraph(),
      describeNode: (nodeId: string) => session.runtime.debugDescribeNode(nodeId),
      messages: () => session.runtime.debugMessages(),
      snapshot: () => session.runtime.getSnapshot(),
    },
  })
}

createRoot(rootElement).render(
  <StrictMode>
    <App session={session} />
  </StrictMode>,
)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    session.destroy()
  })
}
