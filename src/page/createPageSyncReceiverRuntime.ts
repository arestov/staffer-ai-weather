import type { DomSyncTransportLike } from 'dkt/dom-sync/transport.js'
import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import { ReactSyncReceiver } from '../dkt-react-sync/receiver/ReactSyncReceiver'
import { createSyncStore } from '../dkt-react-sync/runtime/createSyncStore'
import type { PageRootSnapshot, PageSyncRuntime } from '../dkt-react-sync/runtime/PageSyncRuntime'
import type { ReactScopeRuntime } from '../dkt-react-sync/runtime/ReactScopeRuntime'
import type { ReactSyncScopeHandle } from '../dkt-react-sync/scope/ScopeHandle'
import {
  type ReactTransportShape,
  ShapeRegistry,
  type ShapeRegistryRuntime,
} from '../dkt-react-sync/shape/ShapeRegistry'
import type { ReactSyncTransportMessage } from '../shared/messageTypes'
import { APP_MSG, RUNTIME_LOG_SCOPE } from '../shared/messageTypes'

type RootAttrsCacheEntry = {
  rootNodeId: string | null
  values: Record<string, unknown>
}

const createEmptySnapshot = (): PageRootSnapshot => ({
  booted: false,
  ready: false,
  version: 0,
  rootNodeId: null,
  sessionId: null,
  sessionKey: null,
})

const createSnapshotWithVersion = (
  current: PageRootSnapshot,
  patch: Partial<PageRootSnapshot>,
): PageRootSnapshot => ({
  ...current,
  ...patch,
  version: current.version + 1,
})

const shouldResetForBootstrap = (
  current: PageRootSnapshot,
  options?: {
    sessionId?: string | null
    sessionKey?: string | null
    route?: unknown
  },
) => {
  if (!current.booted) {
    return false
  }

  if (options?.sessionKey && options.sessionKey !== current.sessionKey) {
    return true
  }

  if (options?.sessionId && options.sessionId !== current.sessionId) {
    return true
  }

  return false
}

export const createPageSyncReceiverRuntime = ({
  transport,
}: {
  transport: DomSyncTransportLike<ReactSyncTransportMessage>
}): PageSyncRuntime => {
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
    subscribeOne(scope: ReactSyncScopeHandle, relName: string, listener: () => void) {
      return syncReceiver.subscribeNodeRel(scope._nodeId, relName, listener)
    },
    readMany(scope: ReactSyncScopeHandle, relName: string) {
      return syncReceiver.readManyScopes(scope, relName)
    },
    subscribeMany(scope: ReactSyncScopeHandle, relName: string, listener: () => void) {
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

  const bootstrap = (options?: {
    sessionId?: string | null
    sessionKey?: string | null
    route?: unknown
  }) => {
    const current = store.getSnapshot()

    if (shouldResetForBootstrap(current, options)) {
      syncReceiver.resetGraph()
      shapeRegistry.destroy()
      rootAttrsCache.clear()
      store.setSnapshot(
        createSnapshotWithVersion(current, {
          booted: false,
          ready: false,
          rootNodeId: null,
          sessionId: null,
          sessionKey: options?.sessionKey ?? null,
        }),
      )
    }

    emit({
      type: APP_MSG.CONTROL_BOOTSTRAP_SESSION,
      ...(options?.sessionId ? { session_id: options.sessionId } : {}),
      ...(options?.sessionKey ? { session_key: options.sessionKey } : {}),
      ...(options && 'route' in options ? { route: options.route } : {}),
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

  const scopeDispatchCache = new WeakMap<
    ReactSyncScopeHandle,
    (actionName: string, payload?: unknown) => void
  >()

  const getDispatch = (
    scope: ReactSyncScopeHandle | null,
  ): ((actionName: string, payload?: unknown) => void) => {
    if (!scope) {
      return (actionName, payload) => dispatchAction(actionName, payload, null)
    }

    let cached = scopeDispatchCache.get(scope)
    if (!cached) {
      cached = (actionName: string, payload?: unknown) => dispatchAction(actionName, payload, scope)
      scopeDispatchCache.set(scope, cached)
    }

    return cached
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
            sessionKey:
              'session_key' in message
                ? (message.session_key ?? current.sessionKey)
                : current.sessionKey,
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
      case APP_MSG.RUNTIME_ERROR: {
        emitError(message.message)
        return
      }
      case APP_MSG.SYNC_HANDLE: {
        handleSyncMessage(message)
        return
      }
      case APP_MSG.P2P_SESSION_LOST: {
        emitLog(`P2P session lost (${message.reason}), re-bootstrapping`)
        const current = store.getSnapshot()
        syncReceiver.resetGraph()
        shapeRegistry.destroy()
        rootAttrsCache.clear()
        const sessionKey = current.sessionKey
        store.setSnapshot(
          createSnapshotWithVersion(current, {
            booted: false,
            ready: false,
            rootNodeId: null,
            sessionId: null,
          }),
        )
        // Re-bootstrap to get a fresh session from the (now-local) server
        emit({
          type: APP_MSG.CONTROL_BOOTSTRAP_SESSION,
          ...(sessionKey ? { session_key: sessionKey } : {}),
        })
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
    dispatch: (actionName: string, payload?: unknown, scope?: ReactSyncScopeHandle | null) => {
      dispatchAction(actionName, payload, scope)
    },
    getDispatch,
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
