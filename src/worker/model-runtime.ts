import type { DomSyncTransportLike, DomSyncTransportViewLike } from 'dkt/dom-sync/transport.js'
import { prepare as prepareAppRuntime } from 'dkt/runtime/app/prepare.js'
import { _getCurrentRel, _listRels } from 'dkt-all/libs/provoda/_internal/_listRels.js'
import { hookSessionRoot } from 'dkt-all/libs/provoda/provoda/BrowseMap.js'
import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import { getModelById } from 'dkt-all/libs/provoda/utils/getModelById.js'
import { AppRoot } from '../models/AppRoot'
import type { ReactSyncTransportMessage } from '../shared/messageTypes'
import { APP_MSG, RUNTIME_LOG_SCOPE } from '../shared/messageTypes'
import { createGeoLocationApi } from './geo-location-api'
import { createLocationSearchApi } from './location-search-api'
import { createSessionManager } from './session-manager'
import { createWeatherLoaderApi } from './weather-api'
import {
  createScopedWeatherBackendApi,
  createWeatherBackendApi,
  resolveWeatherBackendBaseUrl,
  type WeatherBackendApi,
} from './weather-backend-api'

type RuntimeModelLike = {
  _node_id?: string | null
  model_name?: string | null
  states?: Record<string, unknown>
  __getPublicAttrs: () => readonly string[]
  getLinedStructure: (options: unknown, config: unknown) => Promise<readonly RuntimeModelLike[]>
  input: (callback: () => void | Promise<void>) => unknown
  dispatch: (actionName: string, payload?: unknown) => Promise<void> | void
  refreshState: (stateName: string) => Promise<unknown> | unknown
  requestState: (stateName: string) => Promise<unknown> | unknown
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
      locationSearchSource: ReturnType<typeof createLocationSearchApi>
      weatherLoaderSource: ReturnType<typeof createWeatherLoaderApi>
      weatherBackendSource?: WeatherBackendApi
      geoLocationSource?: ReturnType<typeof createGeoLocationApi>
      time?: {
        setTimeout: typeof globalThis.setTimeout
        clearTimeout: typeof globalThis.clearTimeout
        Date: typeof globalThis.Date
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

type WorkerConnection = {
  transport: DomSyncTransportLike<ReactSyncTransportMessage>
  stream: ReturnType<typeof createWorkerStream>
  destroyed: boolean
  sessionId: string | null
  sessionKey: string | null
  _unlisten: (() => void) | null
}

type AppEntry = {
  sessionKey: string
  app: WeatherAppRuntime
  sessionManager: ReturnType<typeof createSessionManager>
  streamIds: Set<string>
  status: 'active' | 'closing'
}

const SESSION_IMPORTANT_REL_PATHS = Object.freeze([Object.freeze(['pioneer'])])

const APP_CLEANUP_DELAY_MS = 30 * 1000
const SESSION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

const runtimeEnv = typeof process !== 'undefined' && process?.env ? process.env : undefined

const shouldEmitRuntimeLogs = runtimeEnv?.WEATHER_REPL_RUNTIME_LOGS === '1'

const createWorkerStream = (transport: DomSyncTransportViewLike<ReactSyncTransportMessage>) => ({
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

const normalizeSessionKey = (value: unknown) => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return trimmed && SESSION_KEY_PATTERN.test(trimmed) ? trimmed : null
}

const createGeneratedSessionKey = () => {
  const randomUuid = globalThis.crypto?.randomUUID?.()

  if (typeof randomUuid === 'string' && randomUuid) {
    return randomUuid
  }

  return `weather-${Math.random().toString(36).slice(2)}`
}

export const createWeatherModelRuntime = (options?: { weatherBackendBaseUrl?: string | null }) => {
  const weatherBackendBaseUrl = resolveWeatherBackendBaseUrl(options?.weatherBackendBaseUrl)
  const sharedWeatherBackend = weatherBackendBaseUrl
    ? createWeatherBackendApi(weatherBackendBaseUrl)
    : null
  const appEntriesBySessionKey = new Map<string, AppEntry>()
  const appBootBySessionKey = new Map<string, Promise<AppEntry>>()
  const appCleanupTimersBySessionKey = new Map<string, ReturnType<typeof setTimeout>>()
  const connections = new Set<WorkerConnection>()
  const connectionsByStreamId = new Map<string, WorkerConnection>()

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
      message: error instanceof Error ? error.stack || error.message : String(error),
    })
  }

  const emitToStreamId = (streamId: string, message: ReactSyncTransportMessage) => {
    const connection = connectionsByStreamId.get(streamId)
    if (!connection) {
      return
    }

    emitForConnection(connection, message)
  }

  const cancelAppCleanup = (sessionKey: string) => {
    const timer = appCleanupTimersBySessionKey.get(sessionKey)
    if (!timer) {
      return
    }

    clearTimeout(timer)
    appCleanupTimersBySessionKey.delete(sessionKey)
  }

  const scheduleAppCleanup = (sessionKey: string) => {
    cancelAppCleanup(sessionKey)

    appCleanupTimersBySessionKey.set(
      sessionKey,
      setTimeout(() => {
        appCleanupTimersBySessionKey.delete(sessionKey)
        const appEntry = appEntriesBySessionKey.get(sessionKey)

        if (!appEntry || appEntry.streamIds.size > 0) {
          return
        }

        appEntriesBySessionKey.delete(sessionKey)
      }, APP_CLEANUP_DELAY_MS),
    )
  }

  const markAppActive = (appEntry: AppEntry) => {
    appEntry.status = 'active'
    cancelAppCleanup(appEntry.sessionKey)
  }

  const attachStreamToApp = (appEntry: AppEntry, streamId: string) => {
    markAppActive(appEntry)
    appEntry.streamIds.add(streamId)
  }

  const detachStreamFromApp = (appEntry: AppEntry, streamId: string) => {
    appEntry.streamIds.delete(streamId)

    if (appEntry.streamIds.size > 0) {
      return
    }

    appEntry.status = 'closing'
    scheduleAppCleanup(appEntry.sessionKey)
  }

  const ensureAppEntry = async (sessionKey: string): Promise<AppEntry> => {
    const existing = appEntriesBySessionKey.get(sessionKey)
    if (existing) {
      markAppActive(existing)
      return existing
    }

    const booting = appBootBySessionKey.get(sessionKey)
    if (booting) {
      return await booting
    }

    const nextBoot = (async () => {
      const runtime = prepareAppRuntime({
        sync_sender: true,
        warnUnexpectedAttrs: true,
        onError(error: unknown) {
          const activeEntry = appEntriesBySessionKey.get(sessionKey)
          if (!activeEntry) {
            return
          }

          for (const streamId of activeEntry.streamIds) {
            const connection = connectionsByStreamId.get(streamId)
            if (connection) {
              emitError(connection, error)
            }
          }
        },
      }) as unknown as WeatherRuntimeLike
      const scopedWeatherBackend = sharedWeatherBackend
        ? createScopedWeatherBackendApi(sharedWeatherBackend, sessionKey)
        : null
      const inited = await runtime.start({
        App: AppRoot,
        interfaces: {
          requests_manager: {
            addRequest() {},
            considerOwnerAsImportant() {},
            stopRequests() {},
          },
          locationSearchSource: createLocationSearchApi({
            weatherBackend: sharedWeatherBackend,
          }),
          weatherLoaderSource: createWeatherLoaderApi(),
          ...(scopedWeatherBackend ? { weatherBackendSource: scopedWeatherBackend } : {}),
          geoLocationSource: createGeoLocationApi(),
          time: {
            setTimeout: globalThis.setTimeout.bind(globalThis),
            clearTimeout: globalThis.clearTimeout.bind(globalThis),
            Date: globalThis.Date,
          },
        },
      })

      const appEntry: AppEntry = {
        sessionKey,
        app: {
          runtime,
          inited,
        },
        sessionManager: createSessionManager(),
        streamIds: new Set(),
        status: 'active',
      }

      appEntriesBySessionKey.set(sessionKey, appEntry)
      cancelAppCleanup(sessionKey)

      return appEntry
    })()

    appBootBySessionKey.set(sessionKey, nextBoot)

    try {
      return await nextBoot
    } finally {
      appBootBySessionKey.delete(sessionKey)
    }
  }

  const getConnectionAppEntry = (connection: WorkerConnection) => {
    if (!connection.sessionKey) {
      return null
    }

    return appEntriesBySessionKey.get(connection.sessionKey) ?? null
  }

  const releaseConnectionBinding = (connection: WorkerConnection) => {
    const appEntry = getConnectionAppEntry(connection)

    if (!appEntry) {
      connection.sessionId = null
      connection.sessionKey = null
      return
    }

    appEntry.app.runtime.sync_sender.removeSyncStream(connection.stream)
    appEntry.sessionManager.detachStream(connection.stream.id, (session) => {
      appendLog(connection, `session released -> ${session.sessionId}`)
    })
    detachStreamFromApp(appEntry, connection.stream.id)

    connection.sessionId = null
    connection.sessionKey = null
  }

  const handleDispatchAction = async (
    connection: WorkerConnection,
    action_name: string,
    payload: unknown,
    scope_node_id?: string | null,
  ) => {
    const appEntry = getConnectionAppEntry(connection)
    if (!appEntry) {
      throw new Error('worker connection is not attached to a session key')
    }

    const appModel = appEntry.app.inited.app_model
    const session = connection.sessionId
      ? appEntry.sessionManager.getSessionByStreamId(connection.stream.id)
      : null

    let dispatchTarget = session?.sessionRoot ?? appModel

    if (typeof scope_node_id === 'string' && scope_node_id) {
      dispatchTarget =
        (session &&
          getModelById(
            session.sessionRoot as unknown as Parameters<typeof getModelById>[0],
            scope_node_id,
          )) ||
        getModelById(appModel as unknown as Parameters<typeof getModelById>[0], scope_node_id) ||
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
    appEntry: AppEntry,
    sessionId: string,
    sessionKey: string,
    route?: unknown,
  ) => {
    return new Promise((resolve, reject) => {
      appEntry.app.inited.app_model.input(async () => {
        try {
          const sessionRoot = await hookSessionRoot(
            appEntry.app.inited.app_model as unknown as Parameters<typeof hookSessionRoot>[0],
            appEntry.app.inited.app_model.start_page as unknown as Parameters<
              typeof hookSessionRoot
            >[1],
            {
              sessionKey,
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
    connection: WorkerConnection,
    {
      session_id,
      session_key,
      route,
    }: {
      session_id?: string
      session_key?: string
      route?: unknown
    } = {},
  ) => {
    const nextSessionKey =
      normalizeSessionKey(session_key) ??
      normalizeSessionKey(connection.sessionKey) ??
      createGeneratedSessionKey()

    const appEntry = await ensureAppEntry(nextSessionKey)

    if (connection.sessionKey || connection.sessionId) {
      releaseConnectionBinding(connection)
    }

    const session = await appEntry.sessionManager.ensureSession(
      (nextSessionId) => getSessionRoot(appEntry, nextSessionId, appEntry.sessionKey, route),
      session_id ?? null,
    )

    connection.sessionKey = appEntry.sessionKey
    connection.sessionId = session.sessionId
    appEntry.sessionManager.attachStream(session.sessionId, connection.stream.id)
    attachStreamToApp(appEntry, connection.stream.id)

    await appEntry.app.runtime.sync_sender.addSyncStream(
      session.sessionRoot,
      connection.stream,
      SESSION_IMPORTANT_REL_PATHS,
    )

    emitForConnection(connection, {
      type: APP_MSG.SESSION_BOOTED,
      session_id: session.sessionId,
      session_key: appEntry.sessionKey,
      root_node_id: session.sessionRoot._node_id,
    })

    appendLog(connection, `session booted -> ${session.sessionId} @ ${appEntry.sessionKey}`)
  }

  const handleMessage = async (
    connection: WorkerConnection,
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
          session_key: message.session_key,
          route: message.route,
        })
        return
      }
      case APP_MSG.CONTROL_CLOSE_SESSION: {
        if (connection.sessionKey || connection.sessionId) {
          const appEntry = getConnectionAppEntry(connection)
          const closingSessionId = connection.sessionId

          if (appEntry && closingSessionId) {
            appEntry.sessionManager.destroySession(closingSessionId)
          }

          releaseConnectionBinding(connection)
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
      case APP_MSG.SYNC_UPDATE_STRUCTURE_USAGE: {
        const appEntry = getConnectionAppEntry(connection)
        if (!appEntry) {
          throw new Error('worker connection is not attached to a session key')
        }

        appEntry.app.runtime.sync_sender.updateStructureUsage(connection.stream.id, message.data)
        return
      }
      case APP_MSG.SYNC_REQUIRE_SHAPE: {
        const appEntry = getConnectionAppEntry(connection)
        if (!appEntry) {
          throw new Error('worker connection is not attached to a session key')
        }

        appEntry.app.runtime.sync_sender.requireShapeForModel(connection.stream.id, message.data)
        return
      }
    }
  }

  const connect = (transport: DomSyncTransportLike<ReactSyncTransportMessage>) => {
    const connection: WorkerConnection = {
      transport,
      stream: createWorkerStream(transport),
      destroyed: false,
      sessionId: null,
      sessionKey: null,
      _unlisten: null,
    }
    connections.add(connection)
    connectionsByStreamId.set(connection.stream.id, connection)

    const unlisten = transport.listen((message) => {
      Promise.resolve(handleMessage(connection, message)).catch((error) =>
        emitError(connection, error),
      )
    })
    connection._unlisten = unlisten

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
        connection._unlisten?.()
        connection._unlisten = null
        releaseConnectionBinding(connection)
        connections.delete(connection)
        connectionsByStreamId.delete(connection.stream.id)
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

  const debugDumpAppState = async (sessionKey?: string | null) => {
    const appEntry = sessionKey
      ? (appEntriesBySessionKey.get(sessionKey) ?? null)
      : (appEntriesBySessionKey.values().next().value ?? null)

    if (!appEntry?.app?.inited?.app_model) {
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
        relNames.map((relName) => [relName, serializeModelRef(_getCurrentRel(model, relName))]),
      )

      return {
        nodeId: model._node_id ?? null,
        modelName: model.model_name ?? null,
        attrs,
        rels,
      }
    }

    const appModel = appEntry.app.inited.app_model
    const lined = await appModel.getLinedStructure({}, {})
    const runtimeModels = Object.values(
      (appEntry.app.runtime.models ?? {}) as Record<string, RuntimeModelLike>,
    )

    return {
      lined: lined.map(serializeModel),
      runtimeModels: runtimeModels.map(serializeModel),
    }
  }

  return {
    connect,
    bootstrapApp: async (sessionKey?: string | null) => {
      const resolvedSessionKey = normalizeSessionKey(sessionKey) ?? createGeneratedSessionKey()
      return (await ensureAppEntry(resolvedSessionKey)).app
    },
    debugDumpAppState,
    debugListSessionKeys: () => Array.from(appEntriesBySessionKey.keys()).sort(),
  }
}
