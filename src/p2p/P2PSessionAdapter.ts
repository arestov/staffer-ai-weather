/**
 * Per-sessionKey P2P adapter that lives inside model-runtime's AppEntry lifecycle.
 *
 * Created when model-runtime's `ensureAppEntry(sessionKey)` runs with p2p enabled.
 * Uses sessionKey as roomId for the P2P room.
 *
 * Two modes:
 * - SERVER: model-runtime runs locally. Remote peers get virtual transports
 *   connected to model-runtime via the same `connect()` method as page transports.
 * - CLIENT: model-runtime does NOT run locally. Page transports are relayed
 *   through the P2P bridge's DataChannel to the remote server worker.
 */
import type { DomSyncTransportLike } from 'dkt/dom-sync/transport.js'
import { APP_MSG, type ReactSyncTransportMessage } from '../shared/messageTypes'
import {
  createWorkerP2PBridge,
  type WorkerP2PBridge,
  type WorkerP2PBridgeConfig,
} from './WorkerP2PBridge'
import type { BridgeSignalingFactory } from './BridgeSignaling'

type RuntimeConnector = {
  connect(transport: DomSyncTransportLike<ReactSyncTransportMessage>): {
    destroy(): Promise<void> | void
  }
}

export interface P2PSessionAdapterConfig {
  /** Session key = room ID for P2P signaling */
  sessionKey: string
  /** Signaling factory (WS or Pusher) */
  createSignaling: BridgeSignalingFactory
}

export interface P2PSessionAdapter {
  /** Current P2P role */
  readonly role: 'server' | 'client' | 'undecided'
  readonly peerId: string

  /**
   * Handle a new page transport connecting.
   *
   * - In server mode: we need a runtime to connect to. Call setRuntime() first.
   * - In client mode: messages relay through DataChannel to remote server.
   * - In undecided mode: connection is queued until role resolved.
   */
  connectPage(transport: DomSyncTransportLike<ReactSyncTransportMessage>): {
    destroy(): void
  }

  /**
   * Provide the local model-runtime connector.
   * Called by model-runtime when this worker becomes (or already is) the server.
   */
  setRuntime(runtime: RuntimeConnector): void

  /**
   * Whether this adapter wants the caller to start a local model-runtime.
   * True when role === 'server'.
   */
  readonly wantsLocalRuntime: boolean

  /**
   * Send a message to the remote server (client mode only).
   * Used to inject the initial bootstrap message after switching to relay mode.
   */
  sendToServer(msg: ReactSyncTransportMessage): void

  /**
   * Returns a promise that resolves when the role is decided.
   */
  whenRoleDecided(): Promise<'server' | 'client'>

  destroy(): void
}

/**
 * Virtual transport: bridges a remote DataChannel peer to the local model-runtime.
 * - send() → serializes to DataChannel
 * - _receive() ← called when DataChannel message arrives
 */
const createVirtualPeerTransport = (
  bridge: WorkerP2PBridge,
  remotePeerId: string,
): DomSyncTransportLike<ReactSyncTransportMessage> & {
  _receive(msg: ReactSyncTransportMessage): void
} => {
  const listeners = new Set<(msg: ReactSyncTransportMessage) => void>()
  let destroyed = false

  return {
    send(message: ReactSyncTransportMessage) {
      if (destroyed) return
      bridge.sendToRemotePeer(remotePeerId, message)
    },
    listen(listener: (msg: ReactSyncTransportMessage) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    destroy() {
      destroyed = true
      listeners.clear()
    },
    _receive(msg: ReactSyncTransportMessage) {
      if (destroyed) return
      for (const fn of listeners) { fn(msg) }
    },
  }
}

export const createP2PSessionAdapter = (
  config: P2PSessionAdapterConfig,
): P2PSessionAdapter => {
  let localRuntime: RuntimeConnector | null = null
  let destroyed = false

  // Pending page connections (stored while role is undecided or runtime not yet set)
  const pageEntries = new Map<
    DomSyncTransportLike<ReactSyncTransportMessage>,
    {
      runtimeConnection: { destroy(): Promise<void> | void } | null
      unlisten: (() => void) | null
    }
  >()

  // Remote peer virtual transports and their runtime connections (server mode)
  const remotePeerTransports = new Map<
    string,
    ReturnType<typeof createVirtualPeerTransport>
  >()
  const remotePeerConnections = new Map<string, { destroy(): Promise<void> | void }>()

  // Role decision promise
  let resolveRoleDecided: ((role: 'server' | 'client') => void) | null = null
  const roleDecidedPromise = new Promise<'server' | 'client'>((resolve) => {
    resolveRoleDecided = resolve
  })

  // ── Wiring helpers ────────────────────────────────────────────

  /** Server mode: connect a page transport directly to local model-runtime */
  const connectPageToRuntime = (transport: DomSyncTransportLike<ReactSyncTransportMessage>) => {
    if (!localRuntime) return
    const conn = localRuntime.connect(transport)
    const entry = pageEntries.get(transport)
    if (entry) {
      entry.runtimeConnection = conn
    }
  }

  /** Client mode: forward page messages through DataChannel to server */
  const startPageRelay = (transport: DomSyncTransportLike<ReactSyncTransportMessage>) => {
    const unlisten = transport.listen((msg) => {
      bridge?.sendToServer(msg)
    })
    const entry = pageEntries.get(transport)
    if (entry) {
      entry.unlisten = unlisten
    }
  }

  /** Deliver a message from the remote server to all local page transports */
  const deliverToAllPages = (msg: ReactSyncTransportMessage) => {
    for (const [transport] of pageEntries) {
      transport.send(msg)
    }
  }

  /** Wire all pending pages based on current role */
  const wireAllPages = () => {
    const currentRole = bridge?.role
    for (const [transport, entry] of pageEntries) {
      if (currentRole === 'server' && !entry.runtimeConnection && localRuntime) {
        // Tear down relay if transitioning from client → server
        if (entry.unlisten) { entry.unlisten(); entry.unlisten = null }
        connectPageToRuntime(transport)
      } else if (currentRole === 'client' && !entry.unlisten && !entry.runtimeConnection) {
        startPageRelay(transport)
      }
    }
  }

  // ── P2P bridge ────────────────────────────────────────────────

  let bridge: WorkerP2PBridge | null = null

  const bridgeConfig: WorkerP2PBridgeConfig = {
    roomId: config.sessionKey,
    createSignaling: config.createSignaling,
    events: {
      onBecomeServer() {
        resolveRoleDecided?.('server')
        resolveRoleDecided = null
        // If runtime is already set, wire pages now; otherwise wait for setRuntime()
        wireAllPages()
      },

      onBecomeClient() {
        resolveRoleDecided?.('client')
        resolveRoleDecided = null
        wireAllPages()
      },

      onRemotePeerConnected(remotePeerId: string) {
        if (!localRuntime) {
          return { receive() {}, destroy() {} }
        }

        const vTransport = createVirtualPeerTransport(bridge!, remotePeerId)
        remotePeerTransports.set(remotePeerId, vTransport)

        const conn = localRuntime.connect(vTransport)
        remotePeerConnections.set(remotePeerId, conn)

        return {
          receive(msg: ReactSyncTransportMessage) {
            vTransport._receive(msg)
          },
          destroy() {
            vTransport.destroy()
          },
        }
      },

      onRemotePeerDisconnected(remotePeerId: string) {
        const conn = remotePeerConnections.get(remotePeerId)
        if (conn) { conn.destroy(); remotePeerConnections.delete(remotePeerId) }

        const vt = remotePeerTransports.get(remotePeerId)
        if (vt) { vt.destroy(); remotePeerTransports.delete(remotePeerId) }
      },

      onRemoteMessage(msg: ReactSyncTransportMessage) {
        // Client mode: server sent data → deliver to all page transports
        deliverToAllPages(msg)
      },

      onFailover() {
        // Was client, now server after remote server disappeared.
        // Notify all page transports so they reset their sync graph and re-bootstrap.
        for (const [transport] of pageEntries) {
          transport.send({
            type: APP_MSG.P2P_SESSION_LOST,
            reason: 'failover',
          })
        }
      },

      onError(error: unknown) {
        console.error('[p2p-session-adapter]', error)
      },
    },
  }

  bridge = createWorkerP2PBridge(bridgeConfig)

  // ── Public API ────────────────────────────────────────────────

  return {
    get role() {
      return bridge?.role ?? 'undecided'
    },

    get peerId() {
      return bridge?.peerId ?? ''
    },

    get wantsLocalRuntime() {
      return bridge?.role === 'server'
    },

    setRuntime(runtime: RuntimeConnector) {
      localRuntime = runtime
      // If already server and pages waiting, wire them now
      if (bridge?.role === 'server') {
        wireAllPages()
      }
    },

    connectPage(transport: DomSyncTransportLike<ReactSyncTransportMessage>) {
      if (destroyed) throw new Error('P2P session adapter is destroyed')

      pageEntries.set(transport, { runtimeConnection: null, unlisten: null })

      const currentRole = bridge?.role
      if (currentRole === 'server' && localRuntime) {
        connectPageToRuntime(transport)
      } else if (currentRole === 'client') {
        startPageRelay(transport)
      }
      // If 'undecided': queued, will be wired when role resolves

      return {
        destroy() {
          const entry = pageEntries.get(transport)
          if (entry) {
            entry.runtimeConnection?.destroy()
            entry.unlisten?.()
            pageEntries.delete(transport)
          }
        },
      }
    },

    whenRoleDecided() {
      const currentRole = bridge?.role
      if (currentRole === 'server' || currentRole === 'client') {
        return Promise.resolve(currentRole)
      }
      return roleDecidedPromise
    },

    sendToServer(msg: ReactSyncTransportMessage) {
      bridge?.sendToServer(msg)
    },

    destroy() {
      if (destroyed) return
      destroyed = true

      for (const [, entry] of pageEntries) {
        entry.runtimeConnection?.destroy()
        entry.unlisten?.()
      }
      pageEntries.clear()

      for (const [, conn] of remotePeerConnections) conn.destroy()
      remotePeerConnections.clear()

      for (const [, vt] of remotePeerTransports) vt.destroy()
      remotePeerTransports.clear()

      bridge?.destroy()
      bridge = null
    },
  }
}
