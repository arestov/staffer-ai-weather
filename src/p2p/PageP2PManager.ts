/**
 * PageP2PManager — runs P2P logic in the page context where RTCPeerConnection
 * is available (unlike SharedWorker).
 *
 * Server page:
 *   - Uses its own SharedWorker port for sync (normal flow)
 *   - Creates a proxy for each remote client:
 *       WebRTC DataChannel ↔ dedicated SharedWorker port
 *
 * Client page:
 *   - Gets sync data through WebRTC DataChannel from server page
 *   - Does NOT use its own SharedWorker for sync
 *
 * Signaling goes through the Cloudflare Durable Object WebSocket.
 * Leader election is server-side (DO assigns leader).
 */

import { createSharedWorkerTransport } from '../shared/createSharedWorkerTransport'
import type { ReactSyncTransportMessage } from '../shared/messageTypes'
import type { BridgeSignaling } from './BridgeSignaling'
import { createDoSignalingFactory } from './BridgeSignaling'
import type { SignalMessage } from './types'

// ── Transport-like interface (matches DomSyncTransportLike) ─────

export interface P2PTransportLike {
  send(message: ReactSyncTransportMessage): void
  listen(listener: (message: ReactSyncTransportMessage) => void): () => void
  destroy(): void
}

// ── Config & public API ─────────────────────────────────────────

export interface PageP2PManagerConfig {
  sessionKey: string
  signalUrl: string
  /** Worker URL to create proxy ports (server mode). Must match the shared worker URL exactly. */
  workerUrl: string
}

export interface PageP2PManagerEvents {
  /** This page is the server — use own SharedWorker transport for sync. */
  onBecomeServer(): void
  /** This page is a client — use the provided transport (backed by DataChannel). */
  onBecomeClient(transport: P2PTransportLike): void
  /** P2P session lost (server gone, failover). Page should re-bootstrap. */
  onSessionLost(reason: string): void
  onError(error: unknown): void
}

export interface PageP2PManager {
  readonly role: 'server' | 'client' | 'undecided'
  readonly peerId: string
  destroy(): void
}

// ── Implementation ──────────────────────────────────────────────

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

export const createPageP2PManager = (
  config: PageP2PManagerConfig,
  events: PageP2PManagerEvents,
): PageP2PManager => {
  const peerId = crypto.randomUUID()
  let role: 'server' | 'client' | 'undecided' = 'undecided'
  let destroyed = false

  // ── Server mode: proxy connections ────────────────────────────

  type ProxyEntry = {
    pc: RTCPeerConnection
    dc: RTCDataChannel | null
    proxyWorker: SharedWorker
    proxyTransport: P2PTransportLike
    proxyUnlisten: (() => void) | null
  }

  const proxyConnections = new Map<string, ProxyEntry>()
  const peerConnections = new Map<string, RTCPeerConnection>()

  // ── Client mode ──────────────────────────────────────────────

  let serverPeerId: string | null = null

  // ── Signaling ────────────────────────────────────────────────

  const signalingFactory = createDoSignalingFactory(config.signalUrl)

  let signaling: BridgeSignaling | null = null

  const sendSignalMsg = (msg: SignalMessage) => {
    signaling?.sendSignal(msg)
  }

  // ── WebRTC helpers ───────────────────────────────────────────

  /** Server: set up a proxy for an incoming client DataChannel */
  const setupServerProxy = (remotePeerId: string, dc: RTCDataChannel, pc: RTCPeerConnection) => {
    // Create a dedicated SharedWorker port for this remote client
    const proxyWorker = new SharedWorker(config.workerUrl, {
      type: 'module',
      name: 'weather-shared-worker',
    })
    const proxyTransport = createSharedWorkerTransport(proxyWorker)

    // Bridge: DC → worker port
    dc.onmessage = (ev) => {
      if (destroyed) return
      try {
        const msg = JSON.parse(ev.data) as ReactSyncTransportMessage
        proxyTransport.send(msg)
      } catch {
        /* ignore parse errors */
      }
    }

    // Bridge: worker port → DC
    const proxyUnlisten = proxyTransport.listen((msg) => {
      if (dc.readyState === 'open') {
        dc.send(JSON.stringify(msg))
      }
    })

    dc.onclose = () => {
      cleanupProxy(remotePeerId)
    }

    dc.onerror = () => {
      // onclose will handle cleanup
    }

    proxyConnections.set(remotePeerId, {
      pc,
      dc,
      proxyWorker,
      proxyTransport,
      proxyUnlisten,
    })
  }

  const cleanupProxy = (remotePeerId: string) => {
    const entry = proxyConnections.get(remotePeerId)
    if (!entry) return
    entry.proxyUnlisten?.()
    entry.proxyTransport.destroy()
    entry.dc?.close()
    entry.pc.close()
    proxyConnections.delete(remotePeerId)
  }

  /** Client: create a transport-like wrapper around a DataChannel */
  const createDCTransport = (dc: RTCDataChannel): P2PTransportLike => {
    const listeners = new Set<(msg: ReactSyncTransportMessage) => void>()
    let dcDestroyed = false

    dc.onmessage = (ev) => {
      if (dcDestroyed) return
      try {
        const msg = JSON.parse(ev.data) as ReactSyncTransportMessage
        for (const fn of listeners) fn(msg)
      } catch {
        /* ignore parse errors */
      }
    }

    dc.onclose = () => {
      if (dcDestroyed || destroyed) return
      events.onSessionLost('server-gone')
    }

    dc.onerror = () => {
      // onclose handles it
    }

    return {
      send(message: ReactSyncTransportMessage) {
        if (dcDestroyed || dc.readyState !== 'open') return
        dc.send(JSON.stringify(message))
      },
      listen(listener: (msg: ReactSyncTransportMessage) => void) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      destroy() {
        dcDestroyed = true
        listeners.clear()
        dc.close()
      },
    }
  }

  // ── Role transitions ─────────────────────────────────────────

  const becomeServer = () => {
    if (role === 'server' || destroyed) return
    role = 'server'
    events.onBecomeServer()
  }

  const becomeClient = (targetPeerId: string) => {
    if (destroyed) return
    role = 'client'
    serverPeerId = targetPeerId

    // Create WebRTC connection to server
    const pc = new RTCPeerConnection(RTC_CONFIG)
    peerConnections.set(targetPeerId, pc)

    const dc = pc.createDataChannel('sync', { ordered: true })

    dc.onopen = () => {
      if (destroyed) return
      const transport = createDCTransport(dc)
      events.onBecomeClient(transport)
    }

    dc.onclose = () => {
      if (destroyed) return
      events.onSessionLost('server-gone')
    }

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || destroyed) return
      sendSignalMsg({
        kind: 'ice-candidate',
        roomId: config.sessionKey,
        fromPeerId: peerId,
        toPeerId: targetPeerId,
        candidate: ev.candidate.toJSON(),
        ts: Date.now(),
      })
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (!destroyed && role === 'client' && serverPeerId === targetPeerId) {
          events.onSessionLost('server-gone')
        }
      }
    }

    // Create offer and send via signaling
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer).then(() => offer))
      .then(() => {
        sendSignalMsg({
          kind: 'offer',
          roomId: config.sessionKey,
          fromPeerId: peerId,
          toPeerId: targetPeerId,
          sdp: pc.localDescription!.toJSON(),
          ts: Date.now(),
        })
      })
      .catch((err) => events.onError(err))
  }

  // ── Signal handling ──────────────────────────────────────────

  const handleSignal = (msg: SignalMessage) => {
    if (msg.fromPeerId === peerId) return
    if (msg.toPeerId && msg.toPeerId !== peerId) return

    switch (msg.kind) {
      case 'offer': {
        // Only server accepts offers
        if (role !== 'server') break

        const remotePeerId = msg.fromPeerId
        const pc = new RTCPeerConnection(RTC_CONFIG)
        peerConnections.set(remotePeerId, pc)

        pc.ondatachannel = (ev) => {
          setupServerProxy(remotePeerId, ev.channel, pc)
        }

        pc.onicecandidate = (ev) => {
          if (!ev.candidate || destroyed) return
          sendSignalMsg({
            kind: 'ice-candidate',
            roomId: config.sessionKey,
            fromPeerId: peerId,
            toPeerId: remotePeerId,
            candidate: ev.candidate.toJSON(),
            ts: Date.now(),
          })
        }

        pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
          .then(() => pc.createAnswer())
          .then((answer) => pc.setLocalDescription(answer))
          .then(() => {
            sendSignalMsg({
              kind: 'answer',
              roomId: config.sessionKey,
              fromPeerId: peerId,
              toPeerId: remotePeerId,
              sdp: pc.localDescription!.toJSON(),
              ts: Date.now(),
            })
          })
          .catch((err) => events.onError(err))
        break
      }

      case 'answer': {
        const pc = peerConnections.get(msg.fromPeerId)
        if (pc) {
          pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)).catch((err) =>
            events.onError(err),
          )
        }
        break
      }

      case 'ice-candidate': {
        const pc = peerConnections.get(msg.fromPeerId)
        if (pc) {
          pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch((err) => events.onError(err))
        }
        break
      }
    }
  }

  // ── Init signaling ───────────────────────────────────────────

  signaling = signalingFactory({
    roomId: config.sessionKey,
    peerId,
    joinedAt: Date.now(),
    events: {
      onMemberJoined(_remotePeerId, _joinedAt) {
        // Server re-announces presence so new members know who to connect to
        if (role === 'server') {
          // New member will get leader info from room-state
        }
      },

      onMemberLeft(remotePeerId) {
        if (destroyed) return
        // Clean up any proxy for this peer (server mode)
        cleanupProxy(remotePeerId)
        // Clean up peer connection
        const pc = peerConnections.get(remotePeerId)
        if (pc) {
          pc.close()
          peerConnections.delete(remotePeerId)
        }
      },

      onLeaderAssigned(leaderPeerId, _epoch) {
        if (destroyed) return
        if (leaderPeerId === peerId) {
          becomeServer()
        } else {
          if (role !== 'client' || serverPeerId !== leaderPeerId) {
            becomeClient(leaderPeerId)
          }
        }
      },

      onSignal(msg) {
        if (destroyed) return
        handleSignal(msg)
      },

      onConnected() {
        // Signaling is ready — leader assignment happens via onLeaderAssigned
      },

      onError(error) {
        if (destroyed) return
        // If signaling never connected and role undecided → fallback to local server
        if (role === 'undecided') {
          becomeServer()
          return
        }
        events.onError(error)
      },
    },
  })

  // ── Public API ───────────────────────────────────────────────

  return {
    get role() {
      return role
    },
    get peerId() {
      return peerId
    },

    destroy() {
      if (destroyed) return
      destroyed = true

      // Clean up all proxy connections
      for (const [remotePeerId] of proxyConnections) {
        cleanupProxy(remotePeerId)
      }

      // Clean up all peer connections
      for (const [, pc] of peerConnections) {
        pc.close()
      }
      peerConnections.clear()

      // Clean up signaling
      signaling?.sendBye?.()
      signaling?.destroy()
      signaling = null
    },
  }
}
