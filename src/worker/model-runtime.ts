import { prepare as prepareAppRuntime } from 'dkt/runtime/app/prepare.js'
import type {
  DomSyncTransportLike,
  DomSyncTransportViewLike,
} from 'dkt/dom-sync/transport.js'
import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import { hookSessionRoot } from 'dkt-all/libs/provoda/provoda/BrowseMap.js'
import { getModelById } from 'dkt-all/libs/provoda/utils/getModelById.js'
import { _getCurrentRel, _listRels } from 'dkt-all/libs/provoda/_internal/_listRels.js'
import { APP_MSG, RUNTIME_LOG_SCOPE } from '../shared/messageTypes'
import type { ReactSyncTransportMessage } from '../shared/messageTypes'
import { AppRoot } from '../app/AppRoot'
import { createSessionManager } from './session-manager'

type RuntimeModelLike = {
  _node_id?: string | null
  model_name?: string | null
  states?: Record<string, unknown>
  __getPublicAttrs: () => readonly string[]
  getLinedStructure: (
    options: unknown,
    config: unknown,
  ) => Promise<readonly RuntimeModelLike[]>
  input: (callback: () => void | Promise<void>) => unknown
  dispatch: (actionName: string, payload?: unknown) => Promise<void> | void
  start_page?: unknown
}

type SyncSenderLike = {
  addSyncStream(
    sessionRoot: RuntimeModelLike,
    stream: ReturnType<typeof createWorkerStream>,
    importantRelPaths: readonly (readonly string[])[],
  ): Promise<void> | void
  removeSyncStream(stream: ReturnType<typeof createWorkerStream>): void
  updateStructureUsage(streamId: string, data: unknown): void
  requireShapeForModel(streamId: string, data: unknown): void
}

type WeatherRuntimeLike = {
  start: (options: {
    App: typeof AppRoot
    interfaces: {
      requests_manager: {
        addRequest(): void
        considerOwnerAsImportant(): void
        stopRequests(): void
      }
    }
  }) => Promise<{
    app_model: RuntimeModelLike
  }>
  sync_sender: SyncSenderLike
  models?: Record<string, RuntimeModelLike>
}

type WeatherAppRuntime = {
  runtime: WeatherRuntimeLike
  inited: {
    app_model: RuntimeModelLike
  }
}

const SESSION_IMPORTANT_REL_PATHS = Object.freeze([
  Object.freeze(['pioneer']),
])

const runtimeEnv =
  typeof process !== 'undefined' && process?.env ? process.env : undefined

const shouldEmitRuntimeLogs = runtimeEnv?.WEATHER_REPL_RUNTIME_LOGS === '1'

const createWorkerStream = (
  transport: DomSyncTransportViewLike<ReactSyncTransportMessage>,
) => ({
  id: `weather-stream-${Math.random().toString(36).slice(2)}`,
  send(list: unknown[]) {
    transport.send({
      type: APP_MSG.SYNC_HANDLE,
      sync_type: SYNCR_TYPES.UPDATE,
      payload: list.slice(),
    })
  },
  sendDict(dict: unknown[]) {
    transport.send({
      type: APP_MSG.SYNC_HANDLE,
      sync_type: SYNCR_TYPES.SET_DICT,
      payload: dict.slice(),
    })
  },
  sendWithType(sync_type: number, payload: unknown) {
    transport.send({
      type: APP_MSG.SYNC_HANDLE,
      sync_type,
      payload,
    })
  },
})

export const createWeatherModelRuntime = () => {
  let current_app: WeatherAppRuntime | null = null
  let booting = false
  const sessionManager = createSessionManager()
  const connections = new Set<{
    transport: DomSyncTransportLike<ReactSyncTransportMessage>
    stream: ReturnType<typeof createWorkerStream>
    destroyed: boolean
    sessionId: string | null
  }>()

  const emitForConnection = (
    connection: { transport: DomSyncTransportViewLike<ReactSyncTransportMessage> },
    message: ReactSyncTransportMessage,
  ) => {
    connection.transport.send(message)
  }

  const appendLog = (
    connection: { transport: DomSyncTransportViewLike<ReactSyncTransportMessage> },
    message: string,
  ) => {
    if (!shouldEmitRuntimeLogs) {
      return
    }

    emitForConnection(connection, {
      type: APP_MSG.RUNTIME_LOG,
      scope: RUNTIME_LOG_SCOPE.SHARED_WORKER,
      message,
    })
  }

  const emitError = (
    connection: { transport: DomSyncTransportViewLike<ReactSyncTransportMessage> },
    error: unknown,
  ) => {
    emitForConnection(connection, {
      type: APP_MSG.RUNTIME_ERROR,
      message:
        error instanceof Error ? error.stack || error.message : String(error),
    })
  }

  const bootstrapApp = async (): Promise<WeatherAppRuntime> => {
    if (current_app) {
      return current_app
    }

    if (booting) {
      while (!current_app) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return current_app
    }

    booting = true
    const runtime = prepareAppRuntime({
      sync_sender: true,
      warnUnexpectedAttrs: true,
      onError(error: unknown) {
        for (const connection of connections) {
          emitError(connection, error)
        }
      },
    }) as unknown as WeatherRuntimeLike
    const inited = await runtime.start({
      App: AppRoot,
      interfaces: {
        requests_manager: {
          addRequest() {},
          considerOwnerAsImportant() {},
          stopRequests() {},
        },
      },
    })

    current_app = {
      runtime,
      inited,
    }
    booting = false

    if (!current_app) {
      throw new Error('weather app runtime failed to bootstrap')
    }

    return current_app
  }

  const handleDispatchAction = async (
    connection: {
      transport: DomSyncTransportViewLike<ReactSyncTransportMessage>
      stream: ReturnType<typeof createWorkerStream>
      sessionId: string | null
    },
    action_name: string,
    payload: unknown,
    scope_node_id?: string | null,
  ) => {
    const app = await bootstrapApp()
    const appModel = app.inited.app_model
    const session = connection.sessionId
      ? sessionManager.getSessionByStreamId(connection.stream.id)
      : null

    let dispatchTarget = session?.sessionRoot ?? appModel

    if (typeof scope_node_id === 'string' && scope_node_id) {
      dispatchTarget =
        (session &&
          getModelById(
            session.sessionRoot as unknown as Parameters<typeof getModelById>[0],
            scope_node_id,
          )) ||
        getModelById(
          appModel as unknown as Parameters<typeof getModelById>[0],
          scope_node_id,
        ) ||
        dispatchTarget
    }

    try {
      await dispatchTarget.dispatch(action_name, payload)
      appendLog(
        connection,
        `dispatched action -> ${action_name} @ ${dispatchTarget.model_name || dispatchTarget._node_id}`,
      )
      return
    } catch (error) {
      if (dispatchTarget !== appModel) {
        await appModel.dispatch(action_name, payload)
        appendLog(connection, `fallback app action -> ${action_name}`)
        return
      }

      throw error
    }
  }

  const getSessionRoot = async (
    app: WeatherAppRuntime,
    sessionId: string,
    route?: unknown,
  ) => {
    return new Promise((resolve, reject) => {
      app.inited.app_model.input(async () => {
        try {
          const sessionRoot = await hookSessionRoot(
            app.inited.app_model as unknown as Parameters<typeof hookSessionRoot>[0],
            app.inited.app_model.start_page as unknown as Parameters<typeof hookSessionRoot>[1],
            {
              sessionKey: sessionId,
              route: route ?? null,
            } as Parameters<typeof hookSessionRoot>[2],
          )

          resolve(sessionRoot)
        } catch (error) {
          reject(error)
        }
      })
    })
  }

  const bootstrapSession = async (
    connection: {
      transport: DomSyncTransportViewLike<ReactSyncTransportMessage>
      stream: ReturnType<typeof createWorkerStream>
      sessionId: string | null
    },
    {
      session_id,
      route,
    }: {
      session_id?: string
      route?: unknown
    } = {},
  ) => {
    const app = await bootstrapApp()
    const session = await sessionManager.ensureSession(
      (nextSessionId) => getSessionRoot(app, nextSessionId, route),
      session_id,
    )

    if (connection.sessionId && connection.sessionId !== session.sessionId) {
      sessionManager.detachStream(connection.stream.id, () => {})
      app.runtime.sync_sender.removeSyncStream(connection.stream)
    }

    connection.sessionId = session.sessionId
    sessionManager.attachStream(session.sessionId, connection.stream.id)

    await app.runtime.sync_sender.addSyncStream(
      session.sessionRoot,
      connection.stream,
      SESSION_IMPORTANT_REL_PATHS,
    )

    emitForConnection(connection, {
      type: APP_MSG.SESSION_BOOTED,
      session_id: session.sessionId,
      root_node_id: session.sessionRoot._node_id,
    })

    appendLog(connection, `session booted -> ${session.sessionId}`)
  }

  const handleMessage = async (
    connection: {
      transport: DomSyncTransportViewLike<ReactSyncTransportMessage>
      stream: ReturnType<typeof createWorkerStream>
      sessionId: string | null
    },
    message: ReactSyncTransportMessage,
  ) => {
    switch (message.type) {
      case APP_MSG.CONTROL_BOOTSTRAP_MODEL: {
        await bootstrapSession(connection, {})
        return
      }
      case APP_MSG.CONTROL_BOOTSTRAP_SESSION: {
        await bootstrapSession(connection, {
          session_id: message.session_id,
          route: message.route,
        })
        return
      }
      case APP_MSG.CONTROL_CLOSE_SESSION: {
        if (connection.sessionId) {
          const app = await bootstrapApp()
          app.runtime.sync_sender.removeSyncStream(connection.stream)
          sessionManager.destroySession(connection.sessionId)
          connection.sessionId = null
        }
        return
      }
      case APP_MSG.CONTROL_DISPATCH_APP_ACTION: {
        await handleDispatchAction(
          connection,
          message.action_name,
          message.payload,
          message.scope_node_id,
        )
        return
      }
      case APP_MSG.CONTROL_SET_LOCATION: {
        await handleDispatchAction(
          connection,
          'setLocation',
          message.payload,
          message.scope_node_id,
        )
        return
      }
      case APP_MSG.CONTROL_REFRESH_WEATHER: {
        await handleDispatchAction(
          connection,
          'refreshWeather',
          message.payload,
          message.scope_node_id,
        )
        return
      }
      case APP_MSG.SYNC_UPDATE_STRUCTURE_USAGE: {
        const app = await bootstrapApp()
        app.runtime.sync_sender.updateStructureUsage(
          connection.stream.id,
          message.data,
        )
        return
      }
      case APP_MSG.SYNC_REQUIRE_SHAPE: {
        const app = await bootstrapApp()
        app.runtime.sync_sender.requireShapeForModel(
          connection.stream.id,
          message.data,
        )
        return
      }
    }
  }

  const connect = (transport: DomSyncTransportLike<ReactSyncTransportMessage>) => {
    const connection = {
      transport,
      stream: createWorkerStream(transport),
      destroyed: false,
      sessionId: null,
    }
    connections.add(connection)
    sessionManager.registerConnection({
      streamId: connection.stream.id,
      transport,
      connectedAt: Date.now(),
    })

    const unlisten = transport.listen((message) => {
      Promise.resolve(handleMessage(connection, message)).catch((error) =>
        emitError(connection, error),
      )
    })

    if (shouldEmitRuntimeLogs) {
      transport.send({
        type: APP_MSG.RUNTIME_LOG,
        scope: RUNTIME_LOG_SCOPE.SHARED_WORKER,
        message: 'runtime listener attached',
      })
    }

    return {
      async destroy() {
        if (connection.destroyed) {
          return
        }

        connection.destroyed = true
        unlisten?.()
        const app = current_app
        if (app?.runtime?.sync_sender) {
          app.runtime.sync_sender.removeSyncStream(connection.stream)
        }
        sessionManager.detachStream(connection.stream.id, (session) => {
          appendLog(connection, `session released -> ${session.sessionId}`)
        })
        connections.delete(connection)
        transport.destroy()
      },
    }
  }

  const serializeModelRef = (value: unknown): unknown => {
    if (value == null) {
      return null
    }

    if (Array.isArray(value)) {
      return value.map(serializeModelRef)
    }

    if (typeof value === 'object' && '_node_id' in value) {
      return (value as { _node_id?: unknown })._node_id ?? null
    }

    return value
  }

  const debugDumpAppState = async () => {
    if (!current_app?.inited?.app_model) {
      return null
    }

    const serializeModel = (model: RuntimeModelLike) => {
      const rawPublicAttrs = model.__getPublicAttrs?.()
      const publicAttrs = Array.isArray(rawPublicAttrs) ? rawPublicAttrs : []
      const attrs = Object.fromEntries(
        publicAttrs.map((attrName: string) => [
          attrName,
          serializeModelRef(model.states?.[attrName]),
        ]),
      )
      const relNames = Array.from(_listRels(model)).sort()
      const rels = Object.fromEntries(
        relNames.map((relName) => [
          relName,
          serializeModelRef(_getCurrentRel(model, relName)),
        ]),
      )

      return {
        nodeId: model._node_id ?? null,
        modelName: model.model_name ?? null,
        attrs,
        rels,
      }
    }

    const appModel = current_app.inited.app_model
    const lined = await appModel.getLinedStructure({}, {})
    const runtimeModels = Object.values(
      (current_app.runtime.models ?? {}) as Record<string, RuntimeModelLike>,
    )

    return {
      lined: lined.map(serializeModel),
      runtimeModels: runtimeModels.map(serializeModel),
    }
  }

  return {
    connect,
    bootstrapApp,
    debugDumpAppState,
  }
}
