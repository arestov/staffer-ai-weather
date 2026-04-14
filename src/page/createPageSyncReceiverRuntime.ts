import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import type { DomSyncTransportLike } from 'dkt/dom-sync/transport.js'
import { ReactSyncReceiver } from '../react-sync/receiver/ReactSyncReceiver'
import type { ReactScopeRuntime } from '../dkt-react-sync/runtime/ReactScopeRuntime'
import type { ReactSyncScopeHandle } from '../dkt-react-sync/scope/ScopeHandle'
import {
  ShapeRegistry,
  type ShapeRegistryRuntime,
  type ReactTransportShape,
} from '../react-sync/shape/ShapeRegistry'
import { APP_MSG, RUNTIME_LOG_SCOPE } from '../shared/messageTypes'
import type { ReactSyncTransportMessage } from '../shared/messageTypes'
import { createSyncStore, type SyncStore } from './createSyncStore'

export interface WeatherRootSnapshot {
  booted: boolean
  ready: boolean
  version: number
  rootNodeId: string | null
  sessionId: string | null
  weatherLoadStatus: string
  weatherLoadError: string | null
}

export interface WeatherPageSyncRuntime extends ReactScopeRuntime {
  store: SyncStore<WeatherRootSnapshot>
  bootstrap(): void
  debugDescribeNode(nodeId: string): unknown
  debugDumpGraph(): unknown
  debugMessages(): readonly unknown[]
  dispatchAction(
    actionName: string,
    payload?: unknown,
    scope?: ReactSyncScopeHandle | null,
  ): void
  refreshWeather(): void
  destroy(): void
  getSnapshot(): WeatherRootSnapshot
  getRootAttrs(attrNames: readonly string[]): Record<string, unknown>
  subscribe(listener: () => void): () => void
  subscribeRootAttrs(
    attrNames: readonly string[],
    listener: () => void,
  ): () => void
}

type RootAttrsCacheEntry = {
  rootNodeId: string | null
  values: Record<string, unknown>
}

const createEmptySnapshot = (): WeatherRootSnapshot => ({
  booted: false,
  ready: false,
  version: 0,
  rootNodeId: null,
  sessionId: null,
  weatherLoadStatus: 'ready',
  weatherLoadError: null,
})

const createSnapshotWithVersion = (
  current: WeatherRootSnapshot,
  patch: Partial<WeatherRootSnapshot>,
): WeatherRootSnapshot => ({
  ...current,
  ...patch,
  version: current.version + 1,
})

export const createPageSyncReceiverRuntime = ({
  transport,
}: {
  transport: DomSyncTransportLike<ReactSyncTransportMessage>
}): WeatherPageSyncRuntime => {
  const store = createSyncStore(createEmptySnapshot())
  const rootAttrsCache = new Map<string, RootAttrsCacheEntry>()
  const debugMessageLog: unknown[] = []

  const pushDebugMessage = (direction: 'in' | 'out', message: unknown) => {
    debugMessageLog.push({
      at: new Date().toISOString(),
      direction,
      message,
    })

    if (debugMessageLog.length > 100) {
      debugMessageLog.splice(0, debugMessageLog.length - 100)
    }
  }

  const emit = (message: ReactSyncTransportMessage) => {
    pushDebugMessage('out', message)
    transport.send(message)
  }

  const emitLog = (message: string) => {
    console.log(`[${RUNTIME_LOG_SCOPE.PAGE_RUNTIME}] ${message}`)
  }

  const emitError = (error: unknown) => {
    console.error(
      `[${RUNTIME_LOG_SCOPE.PAGE_RUNTIME}]`,
      error instanceof Error ? error.stack || error.message : error,
    )
  }

  const syncReceiver = new ReactSyncReceiver({
    RPCLegacy(nodeId, args) {
      emit({
        type: APP_MSG.SYNC_RPC,
        node_id: nodeId,
        args,
      })
    },
    updateStructureUsage(data) {
      emit({
        type: APP_MSG.SYNC_UPDATE_STRUCTURE_USAGE,
        data,
      })
    },
    requireShapeForModel(data) {
      emit({
        type: APP_MSG.SYNC_REQUIRE_SHAPE,
        data,
      })
    },
  })
  const shapeRegistry = new ShapeRegistry()

  const shapeRuntime: ShapeRegistryRuntime = {
    publishShapeGraph(graph: Record<string, ReactTransportShape>) {
      syncReceiver.updateStructureUsage({ graph })
    },
    requireNodeShapes(nodeId: string, shapeIds: readonly string[]) {
      syncReceiver.requireShapeForModel([nodeId, ...shapeIds])
    },
    readOne(scope: ReactSyncScopeHandle, relName: string) {
      return syncReceiver.readOneScope(scope, relName)
    },
    subscribeOne(
      scope: ReactSyncScopeHandle,
      relName: string,
      listener: () => void,
    ) {
      return syncReceiver.subscribeNodeRel(scope._nodeId, relName, listener)
    },
    readMany(scope: ReactSyncScopeHandle, relName: string) {
      return syncReceiver.readManyScopes(scope, relName)
    },
    subscribeMany(
      scope: ReactSyncScopeHandle,
      relName: string,
      listener: () => void,
    ) {
      return syncReceiver.subscribeNodeList(scope._nodeId, relName, listener)
    },
  }

  const syncSnapshotWithReceiver = () => {
    const current = store.getSnapshot()
    const rootNodeId = syncReceiver.getRootNodeId()
    const ready = Boolean(current.booted && rootNodeId)

    if (current.rootNodeId === rootNodeId && current.ready === ready) {
      return
    }

    store.setSnapshot(
      createSnapshotWithVersion(current, {
        rootNodeId,
        ready,
      }),
    )
  }

  const getRootAttrs = (attrNames: readonly string[]) => {
    const rootNodeId = syncReceiver.getRootNodeId()
    const cacheKey = attrNames.join('\u001f')
    const nextValues = syncReceiver.readRootAttrs(attrNames)
    const cached = rootAttrsCache.get(cacheKey)

    if (cached && cached.rootNodeId === rootNodeId) {
      let changed = false

      for (let i = 0; i < attrNames.length; i += 1) {
        const name = attrNames[i]
        if (!Object.is(cached.values[name], nextValues[name])) {
          changed = true
          break
        }
      }

      if (!changed) {
        return cached.values
      }
    }

    rootAttrsCache.set(cacheKey, {
      rootNodeId,
      values: nextValues,
    })

    return nextValues
  }

  const bootstrap = () => {
    emit({
      type: APP_MSG.CONTROL_BOOTSTRAP_SESSION,
    })
  }

  const refreshWeather = () => {
    emit({
      type: APP_MSG.CONTROL_REFRESH_WEATHER,
    })
  }

  const dispatchAction = (
    actionName: string,
    payload?: unknown,
    scope?: ReactSyncScopeHandle | null,
  ) => {
    if (!actionName) {
      throw new Error('action name is required')
    }

    emit({
      type: APP_MSG.CONTROL_DISPATCH_APP_ACTION,
      action_name: actionName,
      payload,
      scope_node_id: scope?._nodeId ?? null,
    })
  }

  const handleSyncMessage = (
    message: Extract<ReactSyncTransportMessage, { type: typeof APP_MSG.SYNC_HANDLE }>,
  ) => {
    switch (message.sync_type) {
      case SYNCR_TYPES.SET_DICT:
      case SYNCR_TYPES.SET_MODEL_SCHEMA:
      case SYNCR_TYPES.UPDATE:
      case SYNCR_TYPES.TREE_ROOT: {
        syncReceiver.handleSync(message.sync_type, message.payload)
        syncSnapshotWithReceiver()
        return
      }
    }
  }

  const handleMessage = (message: ReactSyncTransportMessage) => {
    switch (message.type) {
      case APP_MSG.MODEL_BOOTED:
      case APP_MSG.SESSION_BOOTED: {
        const current = store.getSnapshot()
        store.setSnapshot(
          createSnapshotWithVersion(current, {
            booted: true,
            sessionId: message.session_id ?? current.sessionId,
            rootNodeId: message.root_node_id ?? syncReceiver.getRootNodeId(),
            ready: Boolean(message.root_node_id ?? syncReceiver.getRootNodeId()),
          }),
        )
        return
      }
      case APP_MSG.RUNTIME_LOG: {
        emitLog(`${message.scope}: ${message.message}`)
        return
      }
      case APP_MSG.WEATHER_LOAD_STATE: {
        const current = store.getSnapshot()
        store.setSnapshot(
          createSnapshotWithVersion(current, {
            weatherLoadStatus: message.status,
            weatherLoadError: message.error,
          }),
        )
        return
      }
      case APP_MSG.RUNTIME_ERROR: {
        emitError(message.message)
        return
      }
      case APP_MSG.SYNC_HANDLE: {
        handleSyncMessage(message)
        return
      }
    }
  }

  const unlisten = transport.listen((message) => {
    pushDebugMessage('in', message)
    Promise.resolve(handleMessage(message)).catch(emitError)
  })

  return {
    store,
    bootstrap,
    debugDescribeNode: (nodeId) => syncReceiver.debugDescribeNode(nodeId),
    debugDumpGraph: () => syncReceiver.debugDumpGraph(),
    debugMessages: () => debugMessageLog.slice(),
    dispatchAction,
    refreshWeather,
    getSnapshot: () => store.getSnapshot(),
    getRootScope: () => syncReceiver.getRootScope(),
    subscribeRootScope: (listener) => syncReceiver.subscribeRoot(listener),
    readAttrs: (scope, attrNames) => syncReceiver.readScopeAttrs(scope, attrNames),
    subscribeAttrs: (scope, attrNames, listener) =>
      syncReceiver.subscribeNodeAttrs(scope._nodeId, attrNames, listener),
    readOne: (scope, relName) => syncReceiver.readOneScope(scope, relName),
    subscribeOne: (scope, relName, listener) =>
      syncReceiver.subscribeNodeRel(scope._nodeId, relName, listener),
    readMany: (scope, relName) => syncReceiver.readManyScopes(scope, relName),
    subscribeMany: (scope, relName, listener) =>
      syncReceiver.subscribeNodeList(scope._nodeId, relName, listener),
    mountShape: (scope, shape) => shapeRegistry.mount(shapeRuntime, scope, shape),
    dispatch: (
      actionName: string,
      payload?: unknown,
      scope?: ReactSyncScopeHandle | null,
    ) => {
      dispatchAction(actionName, payload, scope)
    },
    getRootAttrs,
    subscribe: store.subscribe,
    subscribeRootAttrs: (attrNames, listener) =>
      syncReceiver.subscribeRootAttrs(attrNames, listener),
    destroy() {
      const sessionId = store.getSnapshot().sessionId
      if (sessionId) {
        emit({
          type: APP_MSG.CONTROL_CLOSE_SESSION,
          session_id: sessionId,
        })
      }
      unlisten?.()
      transport.destroy()
      syncReceiver.destroy()
      shapeRegistry.destroy()
      rootAttrsCache.clear()
    },
  }
}


