/**
 * BridgeSignaling — portable abstraction for the signaling layer that
 * WorkerP2PBridge uses for peer discovery and WebRTC signal exchange.
 *
 * Two implementations ship by default:
 *   • WS  — WebSocket relay server (test / dev)
 *   • Pusher — public Pusher channel (production, no backend auth)
 */
import type { SignalMessage } from './types'
import {
  createPusherSignaling,
  type PusherSignalingConfig,
} from './PusherSignaling'

// ── Interface ───────────────────────────────────────────────────

export interface BridgeSignalingEvents {
  onMemberJoined(peerId: string, joinedAt: number): void
  onMemberLeft(peerId: string): void
  onSignal(msg: SignalMessage): void
  /** Fires once when signaling is ready (WS opened, Pusher subscribed). */
  onConnected(): void
  onError(error: unknown): void
}

export interface BridgeSignaling {
  sendSignal(msg: SignalMessage): void
  /** Graceful leave announcement (optional). */
  sendBye?(): void
  destroy(): void
}

export type BridgeSignalingFactory = (params: {
  roomId: string
  peerId: string
  joinedAt: number
  events: BridgeSignalingEvents
}) => BridgeSignaling

// ── WS implementation ───────────────────────────────────────────

export const createWsSignalingFactory = (
  signalUrl: string,
): BridgeSignalingFactory => {
  return ({ roomId, peerId, joinedAt, events }) => {
    let destroyed = false
    let ws: WebSocket | null = new WebSocket(signalUrl)

    const sendSignal = (data: SignalMessage) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ action: 'signal', data }))
    }

    ws.onopen = () => {
      if (destroyed) return
      ws!.send(
        JSON.stringify({
          action: 'join',
          roomId,
          peerId,
          joinedAt,
        }),
      )
      events.onConnected()
    }

    ws.onmessage = (ev) => {
      if (destroyed) return
      let msg: { action: string; [key: string]: unknown }
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }

      switch (msg.action) {
        case 'members': {
          const members = msg.members as Array<{
            peerId: string
            joinedAt: number
          }>
          for (const m of members) {
            events.onMemberJoined(m.peerId, m.joinedAt)
          }
          break
        }

        case 'member-joined': {
          events.onMemberJoined(
            msg.peerId as string,
            msg.joinedAt as number,
          )
          break
        }

        case 'member-left': {
          events.onMemberLeft(msg.peerId as string)
          break
        }

        case 'signal': {
          const signal = msg.data as SignalMessage
          if (signal.fromPeerId === peerId) return
          if (signal.toPeerId && signal.toPeerId !== peerId) return
          events.onSignal(signal)
          break
        }
      }
    }

    ws.onerror = () => {
      if (destroyed) return
      events.onError(new Error('WebSocket signaling error'))
    }

    return {
      sendSignal,
      destroy() {
        if (destroyed) return
        destroyed = true
        ws?.close()
        ws = null
      },
    }
  }
}

// ── Pusher implementation ───────────────────────────────────────

export const createPusherSignalingFactory = (
  pusherKey: string,
  pusherCluster: string,
): BridgeSignalingFactory => {
  // Lazy-load Pusher instance (one per factory, shared across rooms if needed)
  let pusherInstance: PusherSignalingConfig['pusher'] | null = null

  const ensurePusher = async (): Promise<PusherSignalingConfig['pusher']> => {
    if (pusherInstance) return pusherInstance
    const { default: Pusher } = await import('pusher-js')
    pusherInstance = new Pusher(pusherKey, {
      cluster: pusherCluster,
      // No authEndpoint needed — public channels only
    }) as unknown as PusherSignalingConfig['pusher']
    return pusherInstance
  }

  return ({ roomId, peerId, joinedAt, events }) => {
    let destroyed = false
    let inner: ReturnType<typeof createPusherSignaling> | null = null

    // Start connection async
    void ensurePusher()
      .then((pusher) => {
        if (destroyed) return
        inner = createPusherSignaling(
          { pusher, roomId, peerId, joinedAt },
          {
            onMemberJoined: events.onMemberJoined,
            onMemberLeft: events.onMemberLeft,
            onSignal: events.onSignal,
            onConnected: events.onConnected,
            onError: events.onError,
          },
        )
      })
      .catch((err) => {
        if (destroyed) return
        events.onError(err)
      })

    return {
      sendSignal(msg: SignalMessage) {
        inner?.sendSignal(msg)
      },
      sendBye() {
        inner?.sendBye()
      },
      destroy() {
        if (destroyed) return
        destroyed = true
        inner?.destroy()
        inner = null
      },
    }
  }
}
