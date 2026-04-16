/**
 * Minimal WebSocket signaling relay for P2P tests.
 * Speaks the same protocol as the Cloudflare Durable Object SignalingRoom:
 *   - Client → Server: join, rejoin, bye, offer/answer/ice-candidate
 *   - Server → Client: room-state, leader-changed, offer/answer/ice-candidate (relay)
 *
 * Server-side leader election: first peer = leader, oldest remaining on failover.
 * No authentication, no persistence — test-only.
 */
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.SIGNAL_PORT || 8790)

const wss = new WebSocketServer({ port: PORT })

/**
 * @typedef {{ ws: import('ws').WebSocket, peerId: string, joinedAt: number }} PeerInfo
 * @typedef {{ peers: Map<string, PeerInfo>, leaderPeerId: string | null, epoch: number }} Room
 */

/** @type {Map<string, Room>} */
const rooms = new Map()

/** @param {Room} room */
const buildRoomState = (room, roomId) => ({
  type: 'room-state',
  roomId,
  epoch: room.epoch,
  leaderPeerId: room.leaderPeerId,
  peers: [...room.peers.keys()],
})

/** @param {Room} room */
const broadcastRoomState = (room, roomId) => {
  const msg = JSON.stringify(buildRoomState(room, roomId))
  for (const peer of room.peers.values()) {
    if (peer.ws.readyState === 1) peer.ws.send(msg)
  }
}

/** @param {Room} room */
const pickNextLeader = (room) => {
  let oldest = null
  for (const peer of room.peers.values()) {
    if (
      !oldest ||
      peer.joinedAt < oldest.joinedAt ||
      (peer.joinedAt === oldest.joinedAt && peer.peerId < oldest.peerId)
    ) {
      oldest = peer
    }
  }
  return oldest?.peerId ?? null
}

wss.on('connection', (ws) => {
  let currentRoomId = null
  let currentPeerId = null

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    // Join room
    if (msg.type === 'join' || msg.type === 'rejoin') {
      currentRoomId = msg.roomId
      currentPeerId = msg.peerId

      if (!rooms.has(currentRoomId)) {
        rooms.set(currentRoomId, { peers: new Map(), leaderPeerId: null, epoch: 0 })
      }

      const room = rooms.get(currentRoomId)
      room.peers.set(currentPeerId, { ws, peerId: currentPeerId, joinedAt: Date.now() })

      // First peer becomes leader
      if (!room.leaderPeerId) {
        room.leaderPeerId = currentPeerId
      }

      broadcastRoomState(room, currentRoomId)
      return
    }

    // Graceful leave
    if (msg.type === 'bye' && currentRoomId) {
      removePeer(currentRoomId, currentPeerId)
      currentRoomId = null
      currentPeerId = null
      return
    }

    // Signal relay (offer / answer / ice-candidate)
    if (
      (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice-candidate') &&
      currentRoomId
    ) {
      const room = rooms.get(currentRoomId)
      if (!room) return

      const target = msg.to
      if (target) {
        const targetPeer = room.peers.get(target)
        if (targetPeer?.ws.readyState === 1) {
          targetPeer.ws.send(JSON.stringify(msg))
        }
      } else {
        // Broadcast to all except sender
        for (const peer of room.peers.values()) {
          if (peer.peerId !== currentPeerId && peer.ws.readyState === 1) {
            peer.ws.send(JSON.stringify(msg))
          }
        }
      }
    }
  })

  ws.on('close', () => {
    if (currentRoomId && currentPeerId) {
      removePeer(currentRoomId, currentPeerId)
    }
  })
})

/**
 * @param {string} roomId
 * @param {string} peerId
 */
function removePeer(roomId, peerId) {
  const room = rooms.get(roomId)
  if (!room) return

  const wasLeader = room.leaderPeerId === peerId
  room.peers.delete(peerId)

  if (room.peers.size === 0) {
    rooms.delete(roomId)
    return
  }

  if (wasLeader) {
    room.leaderPeerId = pickNextLeader(room)
    room.epoch++

    const leaderMsg = JSON.stringify({
      type: 'leader-changed',
      epoch: room.epoch,
      leaderPeerId: room.leaderPeerId,
    })
    for (const peer of room.peers.values()) {
      if (peer.ws.readyState === 1) peer.ws.send(leaderMsg)
    }
  }

  // Broadcast updated room-state so remaining peers can see who left
  broadcastRoomState(room, roomId)
}

console.log(`[signal-relay] listening on ws://127.0.0.1:${PORT}`)
