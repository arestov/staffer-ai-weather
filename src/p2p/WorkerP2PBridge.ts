/**
 * WorkerP2PBridge — integrates PeerRoom into SharedWorker.
 *
 * Modes:
 *   server: model-runtime runs locally, remote peers get virtual transports
 *   client: model-runtime does NOT run, page messages are relayed to server via DataChannel
 */
import type { ReactSyncTransportMessage } from '../shared/messageTypes'

export type P2PBridgeRole = 'server' | 'client' | 'undecided'

export interface WorkerP2PBridgeEvents {
  /** Called when this worker should start the local model-runtime (became server). */
  onBecomeServer(): void

  /** Called when a remote peer's DataChannel opens (server mode).
   *  Returns a transport-like object that PeerRoom feeds messages into. */
  onRemotePeerConnected(remotePeerId: string): {
    receive(message: ReactSyncTransportMessage): void
    destroy(): void
  }

  /** Called when a remote peer's DataChannel closes (server mode). */
  onRemotePeerDisconnected(remotePeerId: string): void

  /** Called when the remote server sends a message to the page (client mode).
   *  Bridge pushes this into the page transport. */
  onRemoteMessage(message: ReactSyncTransportMessage): void

  /** Called when the server disappears and this client must become server. */
  onFailover(): void

  onError(error: unknown): void
}

export interface WorkerP2PBridge {
  readonly role: P2PBridgeRole
  readonly peerId: string

  /** Send a message from the page to the remote server (client mode). */
  sendToServer(message: ReactSyncTransportMessage): void

  /** Send a message to a specific remote peer (server mode). */
  sendToRemotePeer(remotePeerId: string, message: ReactSyncTransportMessage): void

  /** Broadcast to all remote peers (server mode). */
  broadcastToRemotePeers(message: ReactSyncTransportMessage): void

  destroy(): void
}

export interface WorkerP2PBridgeConfig {
  roomId: string
  signalUrl: string
  events: WorkerP2PBridgeEvents
}

/**
 * Creates a WorkerP2PBridge using WebSocket signaling.
 * This is the real implementation for use in SharedWorker.
 */
export const createWorkerP2PBridge = (
  config: WorkerP2PBridgeConfig,
): WorkerP2PBridge => {
  let role: P2PBridgeRole = 'undecided'
  let serverPeerId: string | null = null
  let destroyed = false
  const peerId = crypto.randomUUID()
  const joinedAt = Date.now()

  const peerConnections = new Map<string, RTCPeerConnection>()
  const dataChannels = new Map<string, RTCDataChannel>()
  const knownMembers = new Map<string, { peerId: string; joinedAt: number; role: string }>()
  const remoteTransports = new Map<string, { receive(msg: ReactSyncTransportMessage): void; destroy(): void }>()

  let electionTimer: ReturnType<typeof setTimeout> | null = null
  // biome-ignore lint: WebSocket used at module level in worker context
  let ws: WebSocket | null = null

  const rtcConfig: RTCConfiguration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  }

  // ── WebRTC helpers ────────────────────────────────────────────

  const setupDataChannel = (remotePeerId: string, dc: RTCDataChannel) => {
    dc.onopen = () => {
      if (destroyed) return
      dataChannels.set(remotePeerId, dc)

      if (role === 'server') {
        const transport = config.events.onRemotePeerConnected(remotePeerId)
        remoteTransports.set(remotePeerId, transport)
      }
    }

    dc.onclose = () => {
      if (destroyed) return
      dataChannels.delete(remotePeerId)

      if (role === 'server') {
        const transport = remoteTransports.get(remotePeerId)
        if (transport) {
          transport.destroy()
          remoteTransports.delete(remotePeerId)
        }
        config.events.onRemotePeerDisconnected(remotePeerId)
      }

      if (role === 'client' && remotePeerId === serverPeerId) {
        handleServerGone()
      }
    }

    dc.onerror = () => {
      // Connection errors are handled by close
    }

    dc.onmessage = (ev) => {
      if (destroyed) return
      try {
        const parsed = JSON.parse(ev.data) as ReactSyncTransportMessage

        if (role === 'server') {
          // Remote client sent a message → route to local model-runtime
          const transport = remoteTransports.get(remotePeerId)
          if (transport) {
            transport.receive(parsed)
          }
        } else if (role === 'client') {
          // Remote server sent a message → route to page
          config.events.onRemoteMessage(parsed)
        }
      } catch (error) {
        config.events.onError(error)
      }
    }
  }

  const createPC = (remotePeerId: string, initiator: boolean) => {
    const old = peerConnections.get(remotePeerId)
    if (old) { old.close(); peerConnections.delete(remotePeerId) }

    const pc = new RTCPeerConnection(rtcConfig)
    peerConnections.set(remotePeerId, pc)

    if (initiator) {
      const dc = pc.createDataChannel('sync', { ordered: true })
      setupDataChannel(remotePeerId, dc)
    } else {
      pc.ondatachannel = (ev) => setupDataChannel(remotePeerId, ev.channel)
    }

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return
      sendSignal({
        kind: 'ice-candidate',
        roomId: config.roomId,
        fromPeerId: peerId,
        toPeerId: remotePeerId,
        candidate: ev.candidate.toJSON(),
        ts: Date.now(),
      })
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        dataChannels.delete(remotePeerId)
      }
    }

    return pc
  }

  // ── Election ──────────────────────────────────────────────────

  const scheduleElection = () => {
    if (electionTimer) clearTimeout(electionTimer)
    electionTimer = setTimeout(() => {
      electionTimer = null
      if (destroyed) return

      for (const [, m] of knownMembers) {
        if (m.role === 'server') {
          if (role !== 'client' || serverPeerId !== m.peerId) {
            becomeClient(m.peerId)
          }
          return
        }
      }

      let bestId: string = peerId
      let bestJoined = joinedAt

      for (const [, m] of knownMembers) {
        if (m.joinedAt < bestJoined || (m.joinedAt === bestJoined && m.peerId < bestId)) {
          bestId = m.peerId
          bestJoined = m.joinedAt
        }
      }

      if (bestId === peerId) {
        becomeServer()
      } else {
        becomeClient(bestId)
      }
    }, 500)
  }

  const becomeServer = () => {
    const wasClient = role === 'client'
    role = 'server'
    serverPeerId = peerId

    sendSignal({
      kind: 'role-announce',
      roomId: config.roomId,
      fromPeerId: peerId,
      role: 'server',
      joinedAt,
      ts: Date.now(),
    })

    config.events.onBecomeServer()
    if (wasClient) {
      config.events.onFailover()
    }
  }

  const becomeClient = async (targetId: string) => {
    role = 'client'
    serverPeerId = targetId

    const pc = createPC(targetId, true)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    sendSignal({
      kind: 'offer',
      roomId: config.roomId,
      fromPeerId: peerId,
      toPeerId: targetId,
      sdp: pc.localDescription!.toJSON(),
      ts: Date.now(),
    })
  }

  const handleServerGone = () => {
    serverPeerId = null
    role = 'undecided'
    scheduleElection()
  }

  // ── Signaling ─────────────────────────────────────────────────

  const sendSignal = (data: unknown) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ action: 'signal', data }))
  }

  const handleWsSignal = async (msg: {
    kind: string
    fromPeerId: string
    toPeerId?: string
    [key: string]: unknown
  }) => {
    if (msg.fromPeerId === peerId) return
    if (msg.toPeerId && msg.toPeerId !== peerId) return

    switch (msg.kind) {
      case 'role-announce': {
        const m = knownMembers.get(msg.fromPeerId)
        if (m) m.role = msg.role as string
        if (msg.role === 'server' && (role === 'undecided' || (role === 'client' && serverPeerId !== msg.fromPeerId))) {
          await becomeClient(msg.fromPeerId)
        }
        break
      }

      case 'offer': {
        if (role !== 'server') break
        const pc = createPC(msg.fromPeerId, false)
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        sendSignal({
          kind: 'answer',
          roomId: config.roomId,
          fromPeerId: peerId,
          toPeerId: msg.fromPeerId,
          sdp: pc.localDescription!.toJSON(),
          ts: Date.now(),
        })
        break
      }

      case 'answer': {
        const pc = peerConnections.get(msg.fromPeerId)
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit))
        break
      }

      case 'ice-candidate': {
        const pc = peerConnections.get(msg.fromPeerId)
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(msg.candidate as RTCIceCandidateInit))
        break
      }

      case 'server-leaving': {
        if (msg.fromPeerId === serverPeerId) {
          knownMembers.delete(msg.fromPeerId)
          const pc = peerConnections.get(msg.fromPeerId)
          if (pc) { pc.close(); peerConnections.delete(msg.fromPeerId) }
          dataChannels.delete(msg.fromPeerId)
          handleServerGone()
        }
        break
      }
    }
  }

  // ── Init WS ───────────────────────────────────────────────────

  ws = new WebSocket(config.signalUrl)

  ws.onopen = () => {
    ws!.send(JSON.stringify({
      action: 'join',
      roomId: config.roomId,
      peerId,
      joinedAt,
    }))
  }

  ws.onmessage = (ev) => {
    let msg: { action: string; [key: string]: unknown }
    try { msg = JSON.parse(ev.data as string) } catch { return }

    switch (msg.action) {
      case 'members': {
        const members = msg.members as Array<{ peerId: string; joinedAt: number }>
        for (const m of members) {
          knownMembers.set(m.peerId, { ...m, role: 'undecided' })
        }
        scheduleElection()
        break
      }

      case 'member-joined': {
        const peerId = msg.peerId as string
        knownMembers.set(peerId, { peerId, joinedAt: msg.joinedAt as number, role: 'undecided' })
        if (role === 'undecided') scheduleElection()
        break
      }

      case 'member-left': {
        const leftPeerId = msg.peerId as string
        knownMembers.delete(leftPeerId)
        const pc = peerConnections.get(leftPeerId)
        if (pc) { pc.close(); peerConnections.delete(leftPeerId) }
        dataChannels.delete(leftPeerId)

        if (leftPeerId === serverPeerId) {
          handleServerGone()
        }

        // Clean up remote transport
        const transport = remoteTransports.get(leftPeerId)
        if (transport) {
          transport.destroy()
          remoteTransports.delete(leftPeerId)
        }
        break
      }

      case 'signal': {
        handleWsSignal(msg.data as { kind: string; fromPeerId: string; toPeerId?: string; [key: string]: unknown })
        break
      }
    }
  }

  ws.onerror = () => {
    config.events.onError(new Error('WebSocket signaling error'))
  }

  // ── Public interface ──────────────────────────────────────────

  return {
    get role() { return role },
    get peerId() { return peerId },

    sendToServer(message: ReactSyncTransportMessage) {
      if (role !== 'client' || !serverPeerId) return
      const dc = dataChannels.get(serverPeerId)
      if (dc?.readyState === 'open') {
        dc.send(JSON.stringify(message))
      }
    },

    sendToRemotePeer(remotePeerId: string, message: ReactSyncTransportMessage) {
      const dc = dataChannels.get(remotePeerId)
      if (dc?.readyState === 'open') {
        dc.send(JSON.stringify(message))
      }
    },

    broadcastToRemotePeers(message: ReactSyncTransportMessage) {
      for (const [, dc] of dataChannels) {
        if (dc.readyState === 'open') {
          dc.send(JSON.stringify(message))
        }
      }
    },

    destroy() {
      if (destroyed) return
      destroyed = true

      if (electionTimer) { clearTimeout(electionTimer); electionTimer = null }

      if (role === 'server') {
        sendSignal({
          kind: 'server-leaving',
          roomId: config.roomId,
          fromPeerId: peerId,
          ts: Date.now(),
        })
      }

      for (const [, transport] of remoteTransports) transport.destroy()
      remoteTransports.clear()

      for (const [, pc] of peerConnections) pc.close()
      peerConnections.clear()
      dataChannels.clear()

      ws?.close()
      ws = null
    },
  }
}
