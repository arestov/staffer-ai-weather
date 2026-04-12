import { createRoot, type Root } from 'react-dom/client'
import App from '../../src/App'
import { AppRoot } from '../../src/app/AppRoot'
import { createPageSyncReceiverRuntime } from '../../src/page/createPageSyncReceiverRuntime'
import type { ReactSyncTransportMessage } from '../../src/shared/messageTypes'
import { createWeatherModelRuntime } from '../../src/worker/model-runtime'

type TransportListener<Message> = (message: Message) => void

type AsyncTransport<Message> = {
  send(message: Message, transfer_list?: Transferable[]): void
  listen(listener: TransportListener<Message>): () => void
  destroy(): void
}

const createAsyncTransportBridge = <Message,>() => {
  type State = {
    closing: boolean
    listeners: Set<TransportListener<Message>>
  }

  const createState = (): State => ({
    closing: false,
    listeners: new Set(),
  })

  let inflightToPage = 0
  let inflightToApp = 0

  const finalizeState = (state: State, inflightCount: number) => {
    if (state.closing && inflightCount === 0) {
      state.listeners.clear()
    }
  }

  const createEndpoint = (
    label: string,
    state: State,
    remoteState: State,
    inflightCount: () => number,
    remoteInflightCount: () => number,
    incrementInflight: () => void,
    decrementInflight: () => void,
  ): AsyncTransport<Message> => {
    return {
      send(message: Message) {
        if (state.closing) {
          return
        }

        incrementInflight()
        setImmediate(() => {
          try {
            for (const listener of remoteState.listeners) {
              try {
                listener(message)
              } catch (error) {
                console.error(
                  `[weather-repl:${label}] transport listener failed`,
                  error,
                )
                throw error
              }
            }
          } finally {
            decrementInflight()
            finalizeState(state, inflightCount())
            finalizeState(remoteState, remoteInflightCount())
          }
        })
      },
      listen(listener: TransportListener<Message>) {
        state.listeners.add(listener)
        return () => {
          state.listeners.delete(listener)
          finalizeState(state, inflightCount())
        }
      },
      destroy() {
        state.closing = true
        finalizeState(state, inflightCount())
      },
    }
  }

  const pageState = createState()
  const appState = createState()

  const bridge = {
    page: createEndpoint(
      'page',
      pageState,
      appState,
      () => inflightToPage,
      () => inflightToApp,
      () => {
        inflightToApp += 1
      },
      () => {
        inflightToApp -= 1
      },
    ),
    app: createEndpoint(
      'app',
      appState,
      pageState,
      () => inflightToApp,
      () => inflightToPage,
      () => {
        inflightToPage += 1
      },
      () => {
        inflightToPage -= 1
      },
    ),
    destroy() {
      pageState.closing = true
      appState.closing = true
      finalizeState(pageState, inflightToPage)
      finalizeState(appState, inflightToApp)
    },
  }

  return bridge
}

const waitForImmediate = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve)
  })

const waitForReady = async (
  runtime: ReturnType<typeof createPageSyncReceiverRuntime>,
) => {
  for (let i = 0; i < 200; i += 1) {
    const snapshot = runtime.getSnapshot()

    if (snapshot.booted && snapshot.ready) {
      await waitForImmediate()
      await waitForImmediate()
      return
    }

    await waitForImmediate()
  }

  throw new Error('weather repl did not render resolved content in time')
}

export interface WeatherReplHarness {
  appRoot: typeof AppRoot
  appRuntime: ReturnType<typeof createWeatherModelRuntime>
  bridge: ReturnType<typeof createAsyncTransportBridge>
  destroy(): void
  document: Document
  pageRuntime: ReturnType<typeof createPageSyncReceiverRuntime>
  root: Root
  rootElement: Element
  session: {
    bootstrap(): void
    destroy(): void
    dispatchAction(actionName: string, payload?: unknown): void
    runtime: ReturnType<typeof createPageSyncReceiverRuntime>
    sessionId: string | null
    store: ReturnType<typeof createPageSyncReceiverRuntime>['store']
  }
  window: Window
  whenReady(): Promise<void>
}

export const createWeatherReplHarness = async ({
  window,
  rootElement,
}: {
  window: Window
  rootElement: Element
}): Promise<WeatherReplHarness> => {
  const bridge = createAsyncTransportBridge<ReactSyncTransportMessage>()
  const appRuntime = createWeatherModelRuntime()
  const pageRuntime = createPageSyncReceiverRuntime({
    transport: bridge.page,
  })
  const appConnection = appRuntime.connect(bridge.app)

  const destroy = () => {
    root.unmount()
    pageRuntime.destroy()
    appConnection.destroy()
    bridge.destroy()
  }

  const session = {
    get sessionId() {
      return pageRuntime.getSnapshot().sessionId
    },
    bootstrap: pageRuntime.bootstrap,
    destroy,
    dispatchAction: pageRuntime.dispatchAction,
    runtime: pageRuntime,
    store: pageRuntime.store,
  }

  const root = createRoot(rootElement)
  root.render(<App session={session as never} />)
  session.bootstrap()

  const harness: WeatherReplHarness = {
    appRoot: AppRoot,
    appRuntime,
    bridge,
    destroy,
    document: window.document,
    pageRuntime,
    root,
    rootElement,
    session,
    window,
    async whenReady() {
      await waitForReady(pageRuntime)
    },
  }

  Object.assign(window as Window & { __weatherRepl?: unknown }, {
    __weatherRepl: {
      appRoot: AppRoot,
      appRuntime,
      bridge,
      destroy: () => harness.destroy(),
      dumpGraph: () => pageRuntime.debugDumpGraph(),
      messages: () => pageRuntime.debugMessages(),
      pageRuntime,
      rootElement,
      session,
      snapshot: () => pageRuntime.getSnapshot(),
      window,
    },
  })

  return harness
}
