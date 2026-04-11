import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import { BlankAppRootView } from '../app/createBlankAppRootView'
import { ReactSyncReceiver } from '../react-sync/receiver/ReactSyncReceiver'
import { APP_MSG, RUNTIME_LOG_SCOPE } from '../shared/messageTypes'
import { createSyncStore, type SyncStore } from './createSyncStore'

export interface WeatherRootSnapshot {
  booted: boolean
  ready: boolean
  version: number
  rootNodeId: string | null
}

export interface WeatherPageSyncRuntime {
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
  let prototypeUsagePromise:
    | Promise<{ graph: Record<string, unknown>; used_structures: unknown }>
    | null = null
  let prototypeUsageSent = false

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

  const sendPrototypeUsage = async () => {
    if (prototypeUsageSent || !prototypeUsagePromise || !syncReceiver.getRootNodeId()) {
      return
    }

    const usage = await prototypeUsagePromise
    emit({
      type: APP_MSG.SYNC_UPDATE_STRUCTURE_USAGE,
      data: usage,
    })
    prototypeUsageSent = true
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

  const handleSyncMessage = async (message: any) => {
    switch (message?.sync_type) {
      case SYNCR_TYPES.SET_DICT:
      case SYNCR_TYPES.SET_MODEL_SCHEMA:
      case SYNCR_TYPES.UPDATE:
      case SYNCR_TYPES.TREE_ROOT: {
        syncReceiver.handleSync(message.sync_type, message.payload)
        syncSnapshotWithReceiver()
        await sendPrototypeUsage()
        return
      }
    }
  }

  const handleMessage = async (message: any) => {
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
        await handleSyncMessage(message)
        return
      }
    }
  }

  const unlisten = transport.listen((message) => {
    Promise.resolve(handleMessage(message)).catch(emitError)
  })

  prototypeUsagePromise = BlankAppRootView.prototype._getPrototypeStructure()

  return {
    store,
    bootstrap,
    dispatchAction,
    getSnapshot: () => store.getSnapshot(),
    getRootAttrs,
    subscribe: store.subscribe,
    subscribeRootAttrs: (attrNames, listener) =>
      syncReceiver.subscribeRootAttrs(attrNames, listener),
    destroy() {
      unlisten?.()
      transport.destroy()
      syncReceiver.destroy()
      rootAttrsCache.clear()
      prototypeUsagePromise = null
      prototypeUsageSent = false
    },
  }
}
