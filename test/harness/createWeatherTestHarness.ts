import {
  createWeatherReplHarness,
  type WeatherReplHarness,
} from '../repl/bootstrap'

export type WeatherTestHarness = WeatherReplHarness

export const createWeatherTestHarness = async (options?: {
  sessionKey?: string
}): Promise<WeatherTestHarness> => {
  document.body.innerHTML = ''

  const rootElement = document.createElement('div')
  rootElement.id = 'test-root'
  document.body.append(rootElement)

  const harness = await createWeatherReplHarness({
    window,
    rootElement,
    sessionKey: options?.sessionKey,
  })

  return {
    ...harness,
    destroy() {
      harness.destroy()
      rootElement.remove()
      document.body.innerHTML = ''
    },
  }
}
