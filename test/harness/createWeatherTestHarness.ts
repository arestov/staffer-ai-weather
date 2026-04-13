import {
  createWeatherReplHarness,
  type WeatherReplHarness,
} from '../repl/bootstrap'

export type WeatherTestHarness = WeatherReplHarness

export const createWeatherTestHarness = async (): Promise<WeatherTestHarness> => {
  document.body.innerHTML = ''

  const rootElement = document.createElement('div')
  rootElement.id = 'test-root'
  document.body.append(rootElement)

  const harness = await createWeatherReplHarness({
    window,
    rootElement,
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
