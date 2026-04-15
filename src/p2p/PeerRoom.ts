import {
  createPusherSignaling,
  type PresenceMember,
  type PusherSignaling,
} from './PusherSignaling'
import { createWebRTCPeer, type WebRTCPeer } from './WebRTCPeer'
import {
  DEFAULT_PEER_ROOM_CONFIG,
  type PeerIdentity,
  type PeerRole,
  type PeerRoomConfig,
  type PeerRoomEvent,
  type PeerRoomEventListener,
  type SignalMessage,
} from './types'

export interface PeerRoom {
  readonly peerId: string
  readonly role: PeerRole
  readonly serverPeerId: string | null
  send(remotePeerId: string, data: unknown): void
  broadcast(data: unknown): void
  destroy(): void
}

export const createPeerRoom = (
  pusher: unknown,
  config: PeerRoomConfig,
  listener: PeerRoomEventListener,
): PeerRoom => {
  const peerId = crypto.randomUUID()
  const joinedAt = Date.now()

  let role: PeerRole = 'undecided'
  let serverPeerId: string | null = null
  let destroyed = false
  let electionTimer: ReturnType<typeof setTimeout> | null = null

  const identity: PeerIdentity = { peerId, role: 'undecided', joinedAt }

  const rtcConfig = config.rtcConfig ?? DEFAULT_PEER_ROOM_CONFIG.rtcConfig
  const electionDebounceMs =
    config.electionDebounceMs ?? DEFAULT_PEER_ROOM_CONFIG.electionDebounceMs

  // Remote peers → WebRTC connections
  const peers = new Map<string, WebRTCPeer>()
  // Known members from presence
  const knownMembers = new Map<string, PresenceMember>()

  const emit = (event: PeerRoomEvent) => {
    if (destroyed) return
    try {
      listener(event)
    } catch {
      // listener errors should not break the room
    }
  }

  // ── WebRTC peer management ──────────────────────────────────────────

  const createPeerConnection = (remotePeerId: string, initiator: boolean): WebRTCPeer => {
    const existing = peers.get(remotePeerId)
    if (existing) {
      existing.destroy()
      peers.delete(remotePeerId)
    }

    const peer = createWebRTCPeer(remotePeerId, rtcConfig, initiator, {
      onOpen() {
        emit({ type: 'data-channel-open', remotePeerId })
      },
      onClose() {
        emit({ type: 'data-channel-close', remotePeerId })

        // If the server's data channel closed, trigger failover
        if (role === 'client' && remotePeerId === serverPeerId) {
          handleServerGone()
        }
      },
      onMessage(data) {
        emit({ type: 'data-channel-message', remotePeerId, data })
      },
      onIceCandidate(candidate) {
        signaling?.sendSignal({
          kind: 'ice-candidate',
          roomId: config.roomId,
          fromPeerId: peerId,
          toPeerId: remotePeerId,
          candidate,
          ts: Date.now(),
        })
      },
      onError(error) {
        emit({ type: 'error', error })
      },
    })

    peers.set(remotePeerId, peer)
    return peer
  }

  // ── Election logic ─────────────────────────────────────────────────

  const electServer = () => {
    // Find existing server in members
    for (const [, member] of knownMembers) {
      if (member.info.role === 'server') {
        return member.info.peerId
      }
    }

    // No server → elect by earliest joinedAt, then lowest peerId
    let bestId: string = peerId
    let bestJoinedAt = joinedAt

    for (const [, member] of knownMembers) {
      const m = member.info
      if (
        m.joinedAt < bestJoinedAt ||
        (m.joinedAt === bestJoinedAt && m.peerId < bestId)
      ) {
        bestId = m.peerId
        bestJoinedAt = m.joinedAt
      }
    }

    return bestId
  }

  const scheduleElection = () => {
    if (electionTimer) clearTimeout(electionTimer)

    electionTimer = setTimeout(() => {
      electionTimer = null
      if (destroyed) return

      const elected = electServer()

      if (elected === peerId) {
        becomeServer()
      } else {
        becomeClient(elected)
      }
    }, electionDebounceMs)
  }

  const becomeServer = () => {
    const wasClient = role === 'client'
    role = 'server'
    serverPeerId = peerId
    identity.role = 'server'

    signaling?.sendSignal({
      kind: 'role-announce',
      roomId: config.roomId,
      fromPeerId: peerId,
      role: 'server',
      joinedAt,
      ts: Date.now(),
    })

    emit({ type: 'role-decided', role: 'server' })
    if (wasClient) {
      emit({ type: 'became-server' })
    }
  }

  const becomeClient = (targetServerPeerId: string) => {
    role = 'client'
    serverPeerId = targetServerPeerId
    identity.role = 'client'

    emit({ type: 'role-decided', role: 'client' })

    // Initiate WebRTC connection to server
    initiateConnectionToServer(targetServerPeerId)
  }

  const initiateConnectionToServer = async (targetPeerId: string) => {
    try {
      const peer = createPeerConnection(targetPeerId, true)
      const offer = await peer.createOffer()

      signaling?.sendSignal({
        kind: 'offer',
        roomId: config.roomId,
        fromPeerId: peerId,
        toPeerId: targetPeerId,
        sdp: offer,
        ts: Date.now(),
      })
    } catch (error) {
      emit({ type: 'error', error })
    }
  }

  const handleServerGone = () => {
    serverPeerId = null
    emit({ type: 'server-gone' })

    // Clean up dead peer connections
    for (const [pid, peer] of peers) {
      if (!knownMembers.has(pid)) {
        peer.destroy()
        peers.delete(pid)
      }
    }

    // Re-elect
    scheduleElection()
  }

  // ── Signaling handlers ─────────────────────────────────────────────

  const handleSignal = async (msg: SignalMessage) => {
    switch (msg.kind) {
      case 'role-announce': {
        const member = knownMembers.get(msg.fromPeerId)
        if (member) {
          member.info.role = msg.role
        }

        if (msg.role === 'server' && role === 'undecided') {
          becomeClient(msg.fromPeerId)
        }
        break
      }

      case 'offer': {
        if (role !== 'server') break

        try {
          const peer = createPeerConnection(msg.fromPeerId, false)
          const answer = await peer.handleOffer(msg.sdp)

          signaling?.sendSignal({
            kind: 'answer',
            roomId: config.roomId,
            fromPeerId: peerId,
            toPeerId: msg.fromPeerId,
            sdp: answer,
            ts: Date.now(),
          })
        } catch (error) {
          emit({ type: 'error', error })
        }
        break
      }

      case 'answer': {
        const peer = peers.get(msg.fromPeerId)
        if (!peer) break

        try {
          await peer.handleAnswer(msg.sdp)
        } catch (error) {
          emit({ type: 'error', error })
        }
        break
      }

      case 'ice-candidate': {
        const peer = peers.get(msg.fromPeerId)
        if (!peer) break

        try {
          await peer.addIceCandidate(msg.candidate)
        } catch (error) {
          emit({ type: 'error', error })
        }
        break
      }

      case 'server-leaving': {
        if (msg.fromPeerId === serverPeerId) {
          knownMembers.delete(msg.fromPeerId)
          const peer = peers.get(msg.fromPeerId)
          if (peer) {
            peer.destroy()
            peers.delete(msg.fromPeerId)
          }
          handleServerGone()
        }
        break
      }
    }
  }

  // ── Initialize Pusher signaling ────────────────────────────────────

  let signaling: PusherSignaling | null = null

  signaling = createPusherSignaling(
    pusher as Parameters<typeof createPusherSignaling>[0],
    config.roomId,
    identity,
    {
      onSubscribed(members) {
        for (const [id, member] of members) {
          if (id !== peerId) {
            knownMembers.set(id, member)
          }
        }
        scheduleElection()
      },

      onMemberAdded(member) {
        knownMembers.set(member.id, member)

        // If we're the server, wait for offer from their side
        // If we're undecided, let election handle it
        if (role === 'undecided') {
          scheduleElection()
        }
      },

      onMemberRemoved(member) {
        knownMembers.delete(member.id)
        const peer = peers.get(member.info.peerId)
        if (peer) {
          peer.destroy()
          peers.delete(member.info.peerId)
        }

        if (member.info.peerId === serverPeerId) {
          handleServerGone()
        }
      },

      onSignal(msg) {
        handleSignal(msg)
      },

      onError(error) {
        emit({ type: 'error', error })
      },
    },
  )

  // ── Public interface ───────────────────────────────────────────────

  return {
    get peerId() {
      return peerId
    },

    get role() {
      return role
    },

    get serverPeerId() {
      return serverPeerId
    },

    send(remotePeerId: string, data: unknown) {
      const peer = peers.get(remotePeerId)
      if (peer?.channelReady) {
        peer.send(data)
      }
    },

    broadcast(data: unknown) {
      for (const [, peer] of peers) {
        if (peer.channelReady) {
          peer.send(data)
        }
      }
    },

    destroy() {
      if (destroyed) return
      destroyed = true

      if (electionTimer) {
        clearTimeout(electionTimer)
        electionTimer = null
      }

      // Announce departure if server
      if (role === 'server' && signaling) {
        signaling.sendSignal({
          kind: 'server-leaving',
          roomId: config.roomId,
          fromPeerId: peerId,
          ts: Date.now(),
        })
      }

      for (const [, peer] of peers) {
        peer.destroy()
      }
      peers.clear()

      signaling?.destroy()
      signaling = null
    },
  }
}
