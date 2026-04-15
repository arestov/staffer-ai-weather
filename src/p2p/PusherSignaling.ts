/**
 * Pusher signaling using a **public** channel (no backend auth required).
 *
 * Membership is self-managed: peers announce themselves with `hello` messages
 * and are considered gone when a `bye` or `server-leaving` message arrives,
 * or when no hello is seen within heartbeatTimeoutMs.
 *
 * Channel: `weather-signal-<roomId>` (public, no `presence-` or `private-` prefix).
 *
 * Events on channel:
 *   - `hello`   : { peerId, joinedAt }  — sent on join + periodic heartbeat
 *   - `bye`     : { peerId }            — sent on graceful leave
 *   - `signal`  : SignalMessage          — WebRTC signaling payloads
 */
import type { SignalMessage } from './types'

export interface PusherSignalingEvents {
  onMemberJoined(peerId: string, joinedAt: number): void
  onMemberLeft(peerId: string): void
  onSignal(message: SignalMessage): void
  onConnected(): void
  onError(error: unknown): void
}

type PusherLike = {
  subscribe(channelName: string): PusherChannelLike
  unsubscribe(channelName: string): void
  connection: {
    bind(event: string, callback: (...args: unknown[]) => void): void
    unbind(event: string, callback?: (...args: unknown[]) => void): void
  }
}

type PusherChannelLike = {
  bind(event: string, callback: (...args: unknown[]) => void): void
  unbind_all(): void
  trigger(event: string, data: unknown): boolean
}

export interface PusherSignalingConfig {
  pusher: PusherLike
  roomId: string
  peerId: string
  joinedAt: number
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
}

export interface PusherSignaling {
  sendSignal(message: SignalMessage): void
  sendBye(): void
  destroy(): void
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 15_000

export const createPusherSignaling = (
  config: PusherSignalingConfig,
  events: PusherSignalingEvents,
): PusherSignaling => {
  const {
    pusher,
    roomId,
    peerId,
    joinedAt,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
  } = config
  const channelName = `weather-signal-${roomId}`
  const channel = pusher.subscribe(channelName)
  let destroyed = false

  // ── Self-managed membership ──────────────────────────────────

  const lastSeen = new Map<string, number>() // peerId → Date.now() of last hello

  const sendHello = () => {
    if (destroyed) return
    channel.trigger('client-hello', { peerId, joinedAt })
  }

  // Periodic heartbeat
  const heartbeatTimer = setInterval(sendHello, heartbeatIntervalMs)

  // Sweep peers that missed heartbeat
  const sweepTimer = setInterval(() => {
    if (destroyed) return
    const now = Date.now()
    for (const [remotePeerId, ts] of lastSeen) {
      if (now - ts > heartbeatTimeoutMs) {
        lastSeen.delete(remotePeerId)
        events.onMemberLeft(remotePeerId)
      }
    }
  }, heartbeatTimeoutMs / 2)

  // ── Channel events ───────────────────────────────────────────

  channel.bind('pusher:subscription_succeeded', (() => {
    if (destroyed) return
    sendHello()
    events.onConnected()
  }) as (...args: unknown[]) => void)

  channel.bind('pusher:subscription_error', ((error: unknown) => {
    if (destroyed) return
    events.onError(error)
  }) as (...args: unknown[]) => void)

  channel.bind('client-hello', ((data: unknown) => {
    if (destroyed) return
    const msg = data as { peerId: string; joinedAt: number }
    if (msg.peerId === peerId) return // own echo (Pusher doesn't deliver own triggers on public, but guard)
    const isNew = !lastSeen.has(msg.peerId)
    lastSeen.set(msg.peerId, Date.now())
    if (isNew) {
      events.onMemberJoined(msg.peerId, msg.joinedAt)
      // Reply so the newcomer knows about us
      sendHello()
    }
  }) as (...args: unknown[]) => void)

  channel.bind('client-bye', ((data: unknown) => {
    if (destroyed) return
    const msg = data as { peerId: string }
    if (msg.peerId === peerId) return
    if (lastSeen.has(msg.peerId)) {
      lastSeen.delete(msg.peerId)
      events.onMemberLeft(msg.peerId)
    }
  }) as (...args: unknown[]) => void)

  channel.bind('client-signal', ((data: unknown) => {
    if (destroyed) return
    const msg = data as SignalMessage
    if (msg.fromPeerId === peerId) return
    if (msg.toPeerId && msg.toPeerId !== peerId) return
    events.onSignal(msg)
  }) as (...args: unknown[]) => void)

  return {
    sendSignal(message: SignalMessage) {
      if (destroyed) return
      channel.trigger('client-signal', message)
    },

    sendBye() {
      if (destroyed) return
      channel.trigger('client-bye', { peerId })
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      clearInterval(heartbeatTimer)
      clearInterval(sweepTimer)
      channel.unbind_all()
      pusher.unsubscribe(channelName)
    },
  }
}
