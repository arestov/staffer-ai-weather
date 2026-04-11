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
