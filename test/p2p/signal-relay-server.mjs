/**
 * Minimal WebSocket signaling relay for P2P tests.
 * Routes messages between peers in the same room.
 * No authentication, no persistence — test-only.
 */
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.SIGNAL_PORT || 8790)

const wss = new WebSocketServer({ port: PORT })

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const rooms = new Map()

wss.on('connection', (ws) => {
  let currentRoom = null
  let currentPeerId = null

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    // Join room
    if (msg.action === 'join') {
      currentRoom = msg.roomId
      currentPeerId = msg.peerId

      if (!rooms.has(currentRoom)) {
        rooms.set(currentRoom, new Set())
      }

      const room = rooms.get(currentRoom)
      room.add(ws)

      // Notify existing members
      const members = []
      for (const peer of room) {
        if (peer !== ws && peer.readyState === 1 && peer.__peerId) {
          members.push({ peerId: peer.__peerId, joinedAt: peer.__joinedAt })
        }
      }

      ws.__peerId = currentPeerId
      ws.__joinedAt = msg.joinedAt || Date.now()

      // Send member list to joiner
      ws.send(JSON.stringify({
        action: 'members',
        members,
      }))

      // Announce join to others
      for (const peer of room) {
        if (peer !== ws && peer.readyState === 1) {
          peer.send(JSON.stringify({
            action: 'member-joined',
            peerId: currentPeerId,
            joinedAt: ws.__joinedAt,
          }))
        }
      }
      return
    }

    // Signal relay
    if (msg.action === 'signal' && currentRoom) {
      const room = rooms.get(currentRoom)
      if (!room) return

      const payload = JSON.stringify(msg.data)

      // If targeted, send to specific peer
      if (msg.data?.toPeerId) {
        for (const peer of room) {
          if (peer.__peerId === msg.data.toPeerId && peer.readyState === 1) {
            peer.send(JSON.stringify({ action: 'signal', data: msg.data }))
          }
        }
      } else {
        // Broadcast to all except sender
        for (const peer of room) {
          if (peer !== ws && peer.readyState === 1) {
            peer.send(JSON.stringify({ action: 'signal', data: msg.data }))
          }
        }
      }
    }
  })

  ws.on('close', () => {
    if (currentRoom) {
      const room = rooms.get(currentRoom)
      if (room) {
        room.delete(ws)

        // Notify others about departure
        for (const peer of room) {
          if (peer.readyState === 1) {
            peer.send(JSON.stringify({
              action: 'member-left',
              peerId: currentPeerId,
            }))
          }
        }

        if (room.size === 0) {
          rooms.delete(currentRoom)
        }
      }
    }
  })
})

console.log(`[signal-relay] listening on ws://127.0.0.1:${PORT}`)
