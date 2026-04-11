import { SyncReceiver } from 'dkt/SyncReceiver.js'
import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import { BlankAppRootView } from '../app/createBlankAppRootView'
import { APP_MSG, RUNTIME_LOG_SCOPE } from '../shared/messageTypes'
import { createSyncStore, type SyncStore } from './createSyncStore'

export interface WeatherRootSnapshot {
  booted: boolean
  ready: boolean
  version: number
  rootNodeId: string | null
  location: string
  status: string
  temperatureText: string
  summary: string
  updatedAt: string | null
  rootMpx: any | null
}

export interface WeatherPageSyncRuntime {
  store: SyncStore<WeatherRootSnapshot>
  bootstrap(): void
  dispatchAction(actionName: string, payload?: unknown): void
  destroy(): void
  getSnapshot(): WeatherRootSnapshot
  subscribe(listener: () => void): () => void
}

const createDeferred = <T,>() => {
  let resolve: ((value: T) => void) | null = null
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return {
    promise,
    resolve,
  }
}

const createEmptySnapshot = (): WeatherRootSnapshot => ({
  booted: false,
  ready: false,
  version: 0,
  rootNodeId: null,
  location: '',
  status: 'booting',
  temperatureText: '-- \u00b0C',
  summary: 'Booting weather runtime',
  updatedAt: null,
  rootMpx: null,
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
  const root_ready = createDeferred<void>()
  let sync_r: SyncReceiver | null = null
  let prototype_usage_promise:
    | Promise<{ graph: Record<string, unknown>; used_structures: unknown }>
    | null = null
  let prototype_usage_sent = false

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

  const buildStream = () => ({
    RPCLegacy(node_id: string | number, args: unknown[]) {
      emit({
        type: APP_MSG.SYNC_RPC,
        node_id,
        args,
      })
    },
    updateStructureUsage(data: unknown) {
      emit({
        type: APP_MSG.SYNC_UPDATE_STRUCTURE_USAGE,
        data,
      })
    },
    requireShapeForModel(data: unknown) {
      emit({
        type: APP_MSG.SYNC_REQUIRE_SHAPE,
        data,
      })
    },
  })

  const sync_stream = buildStream()

  const getRootMpx = () => store.getSnapshot().rootMpx

  const refreshSnapshot = () => {
    const current = store.getSnapshot()
    const rootMpx = current.rootNodeId
      ? sync_r?.md_proxs_index[current.rootNodeId] || null
      : null

    const nextSnapshot: WeatherRootSnapshot = {
      ...current,
      version: current.version + 1,
      rootMpx,
      location: rootMpx?.getAttr?.('location') ?? '',
      status: rootMpx?.getAttr?.('status') ?? 'booting',
      temperatureText: rootMpx?.getAttr?.('temperatureText') ?? '-- \u00b0C',
      summary: rootMpx?.getAttr?.('summary') ?? '',
      updatedAt: rootMpx?.getAttr?.('updatedAt') ?? null,
      ready: Boolean(rootMpx && current.booted),
    }

    store.setSnapshot(nextSnapshot)
  }

  const tryResolveReady = () => {
    const snapshot = store.getSnapshot()
    if (snapshot.booted && snapshot.rootMpx) {
      root_ready.resolve?.(void 0)
      root_ready.resolve = null
    }
  }

  const sendPrototypeUsage = async () => {
    if (prototype_usage_sent || !prototype_usage_promise || !getRootMpx()) {
      return
    }

    const usage = await prototype_usage_promise
    emit({
      type: APP_MSG.SYNC_UPDATE_STRUCTURE_USAGE,
      data: usage,
    })
    prototype_usage_sent = true
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
        sync_r?.handleByType(message.sync_type, message.payload)

        if (message.sync_type === SYNCR_TYPES.TREE_ROOT) {
          const root_node_id = message.payload?.node_id ?? null
          const root_mpx = root_node_id
            ? sync_r?.md_proxs_index[root_node_id] || null
            : null
          const current = store.getSnapshot()
          store.setSnapshot({
            ...current,
            version: current.version + 1,
            rootNodeId: root_node_id,
            rootMpx: root_mpx,
            booted: current.booted,
            ready: Boolean(root_mpx && current.booted),
          })
        } else {
          refreshSnapshot()
        }

        await sendPrototypeUsage()
        tryResolveReady()
        return
      }
    }
  }

  const handleMessage = async (message: any) => {
    switch (message?.type) {
      case APP_MSG.MODEL_BOOTED: {
        const current = store.getSnapshot()
        store.setSnapshot({
          ...current,
          version: current.version + 1,
          booted: true,
          rootNodeId: message.root_node_id ?? current.rootNodeId,
          ready: Boolean(current.rootMpx),
        })
        tryResolveReady()
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

  sync_r = new SyncReceiver(sync_stream)
  prototype_usage_promise = BlankAppRootView.prototype._getPrototypeStructure()

  return {
    store,
    bootstrap,
    dispatchAction,
    getSnapshot: () => store.getSnapshot(),
    subscribe: store.subscribe,
    destroy() {
      unlisten?.()
      transport.destroy()
      sync_r = null
      prototype_usage_promise = null
      prototype_usage_sent = false
    },
  }
}
