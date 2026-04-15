/**
 * BridgeSignaling — portable abstraction for the signaling layer that
 * WorkerP2PBridge uses for peer discovery and WebRTC signal exchange.
 *
 * One implementation:
 *   • DO — Cloudflare Durable Object WebSocket signaling (prod + dev)
 *
 * The DO protocol provides server-side leader election:
 *   - Client sends `join` with peerId
 *   - Server responds with `room-state` (epoch, leaderPeerId, peers[])
 *   - Server sends `leader-changed` on failover
 *   - Signaling messages relayed: offer / answer / ice-candidate
 */
import type { SignalMessage } from './types'

// ── Interface ───────────────────────────────────────────────────

export interface BridgeSignalingEvents {
  onMemberJoined(peerId: string, joinedAt: number): void
  onMemberLeft(peerId: string): void
  onSignal(msg: SignalMessage): void
  /** Fires when server assigns the leader (from room-state or leader-changed). */
  onLeaderAssigned(leaderPeerId: string, epoch: number): void
  /** Fires once when signaling is ready (WS opened, joined room). */
  onConnected(): void
  onError(error: unknown): void
}

export interface BridgeSignaling {
  sendSignal(msg: SignalMessage): void
  /** Graceful leave announcement. */
  sendBye?(): void
  destroy(): void
}

export type BridgeSignalingFactory = (params: {
  roomId: string
  peerId: string
  joinedAt: number
  events: BridgeSignalingEvents
}) => BridgeSignaling

// ── DO WebSocket signaling ──────────────────────────────────────

export const createDoSignalingFactory = (
  signalUrl: string,
): BridgeSignalingFactory => {
  return ({ roomId, peerId, events }) => {
    let destroyed = false
    const knownPeers = new Set<string>()

    // Build WS URL: signalUrl is the base, we append the roomId path
    // e.g. "wss://backend.example.com/api/signal/<roomId>" or "ws://127.0.0.1:8790"
    // If signalUrl already contains a path for the room, use it directly.
    // Otherwise append /api/signal/<roomId>
    let wsUrl: string
    if (signalUrl.includes('/api/signal/')) {
      wsUrl = signalUrl
    } else {
      const base = signalUrl.replace(/\/$/, '')
      wsUrl = `${base}/api/signal/${encodeURIComponent(roomId)}`
    }

    let ws: WebSocket | null = new WebSocket(wsUrl)

    ws.onopen = () => {
      if (destroyed) return
      ws!.send(JSON.stringify({ type: 'join', roomId, peerId }))
    }

    ws.onmessage = (ev) => {
      if (destroyed) return
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }

      switch (msg.type as string) {
        case 'room-state': {
          const peers = msg.peers as string[]
          const leaderPeerId = msg.leaderPeerId as string
          const epoch = msg.epoch as number

          // Diff membership
          const newPeerSet = new Set(peers.filter((p) => p !== peerId))
          // Find peers that left
          for (const existing of knownPeers) {
            if (!newPeerSet.has(existing)) {
              knownPeers.delete(existing)
              events.onMemberLeft(existing)
            }
          }
          // Find peers that joined
          for (const p of newPeerSet) {
            if (!knownPeers.has(p)) {
              knownPeers.add(p)
              events.onMemberJoined(p, 0)
            }
          }

          events.onLeaderAssigned(leaderPeerId, epoch)
          events.onConnected()
          break
        }

        case 'leader-changed': {
          const leaderPeerId = msg.leaderPeerId as string
          const epoch = msg.epoch as number

          // Any peer that was the old leader may have left
          // (DO already removed them — we'll get updated room-state too)
          events.onLeaderAssigned(leaderPeerId, epoch)
          break
        }

        case 'offer':
        case 'answer':
        case 'ice-candidate': {
          // Relayed signaling message — convert to our SignalMessage format
          const from = msg.from as string
          if (from === peerId) return
          const to = msg.to as string | undefined
          if (to && to !== peerId) return

          events.onSignal({
            kind: msg.type as SignalMessage['kind'],
            roomId,
            fromPeerId: from,
            toPeerId: to,
            ts: (msg.ts as number) ?? Date.now(),
            ...(msg.sdp ? { sdp: msg.sdp as RTCSessionDescriptionInit } : {}),
            ...(msg.candidate ? { candidate: msg.candidate as RTCIceCandidateInit } : {}),
          } as SignalMessage)
          break
        }
      }
    }

    ws.onerror = () => {
      if (destroyed) return
      events.onError(new Error('WebSocket signaling error'))
    }

    ws.onclose = () => {
      if (destroyed) return
      events.onError(new Error('WebSocket signaling closed'))
    }

    const sendToServer = (data: Record<string, unknown>) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify(data))
    }

    return {
      sendSignal(msg: SignalMessage) {
        // Translate our signal format to DO protocol
        sendToServer({
          type: msg.kind,
          epoch: 0, // epoch is managed by the server
          from: peerId,
          to: msg.toPeerId,
          ...(msg.kind === 'offer' || msg.kind === 'answer'
            ? { sdp: (msg as { sdp: unknown }).sdp }
            : {}),
          ...(msg.kind === 'ice-candidate'
            ? { candidate: (msg as { candidate: unknown }).candidate }
            : {}),
          ts: msg.ts,
        })
      },

      sendBye() {
        sendToServer({ type: 'bye', roomId, peerId })
      },

      destroy() {
        if (destroyed) return
        destroyed = true
        ws?.close()
        ws = null
      },
    }
  }
}

/**
 * Legacy WS relay factory — for dev/test signal relay server.
 * Uses the old action-based protocol (join/members/member-joined/member-left/signal).
 */
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
