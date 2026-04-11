import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import { ReactSyncReceiver } from '../react-sync/receiver/ReactSyncReceiver'
import type { ReactScopeRuntime } from '../react-sync/runtime/ReactScopeRuntime'
import type { ReactSyncScopeHandle } from '../react-sync/scope/ScopeHandle'
import {
  ShapeRegistry,
  type ShapeRegistryRuntime,
  type ReactTransportShape,
} from '../react-sync/shape/ShapeRegistry'
import { APP_MSG, RUNTIME_LOG_SCOPE } from '../shared/messageTypes'
import { createSyncStore, type SyncStore } from './createSyncStore'

export interface WeatherRootSnapshot {
  booted: boolean
  ready: boolean
  version: number
  rootNodeId: string | null
}

export interface WeatherPageSyncRuntime extends ReactScopeRuntime {
  store: SyncStore<WeatherRootSnapshot>
  bootstrap(): void
  dispatchAction(actionName: string, payload?: unknown): void
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
  transport: {
    send(message: unknown, transfer_list?: Transferable[]): void
    listen(listener: (message: any) => void): () => void
    destroy(): void
  }
}): WeatherPageSyncRuntime => {
  const store = createSyncStore(createEmptySnapshot())
  const rootAttrsCache = new Map<string, RootAttrsCacheEntry>()

  const emit = (message: unknown) => {
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
      type: APP_MSG.CONTROL_BOOTSTRAP_MODEL,
    })
  }

  const dispatchAction = (actionName: string, payload?: unknown) => {
    if (!actionName) {
      throw new Error('action name is required')
    }

    emit({
      type: APP_MSG.CONTROL_DISPATCH_APP_ACTION,
      action_name: actionName,
      payload,
    })
  }

  const handleSyncMessage = (message: any) => {
    switch (message?.sync_type) {
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

  const handleMessage = (message: any) => {
    switch (message?.type) {
      case APP_MSG.MODEL_BOOTED: {
        const current = store.getSnapshot()
        store.setSnapshot(
          createSnapshotWithVersion(current, {
            booted: true,
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
    }
  }

  const unlisten = transport.listen((message) => {
    Promise.resolve(handleMessage(message)).catch(emitError)
  })

  return {
    store,
    bootstrap,
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
    dispatch: (
      actionName: string,
      payload?: unknown,
      _scope?: ReactSyncScopeHandle | null,
    ) => {
      dispatchAction(actionName, payload)
    },
    getRootAttrs,
    subscribe: store.subscribe,
    subscribeRootAttrs: (attrNames, listener) =>
      syncReceiver.subscribeRootAttrs(attrNames, listener),
    destroy() {
      unlisten?.()
      transport.destroy()
      syncReceiver.destroy()
      shapeRegistry.destroy()
      rootAttrsCache.clear()
    },
  }
}
