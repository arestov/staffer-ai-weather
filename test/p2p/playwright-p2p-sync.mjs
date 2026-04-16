/**
 * E2E test: P2P sync protocol — 2 and 3 browser scenarios.
 *
 * Spins up a minimal WS signaling relay + static file server,
 * then launches headless Chromium instances that connect via WebRTC.
 *
 * Scenarios:
 *   1. Two peers connect → one becomes server, other client
 *   2. Server sends data → client receives
 *   3. Client sends data → server receives
 *   4. Third peer joins → connects to existing server
 *   5. Server broadcasts → all clients receive
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { WebSocketServer } from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Signal relay ────────────────────────────────────────────────────

const startSignalRelay = (port) => {
  const wss = new WebSocketServer({ port })
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

      if (msg.action === 'join') {
        currentRoom = msg.roomId
        currentPeerId = msg.peerId
        if (!rooms.has(currentRoom)) rooms.set(currentRoom, new Set())
        const room = rooms.get(currentRoom)
        room.add(ws)
        ws.__peerId = currentPeerId
        ws.__joinedAt = msg.joinedAt || Date.now()

        const members = []
        for (const peer of room) {
          if (peer !== ws && peer.readyState === 1 && peer.__peerId) {
            members.push({ peerId: peer.__peerId, joinedAt: peer.__joinedAt })
          }
        }

        ws.send(JSON.stringify({ action: 'members', members }))
        for (const peer of room) {
          if (peer !== ws && peer.readyState === 1) {
            peer.send(
              JSON.stringify({
                action: 'member-joined',
                peerId: currentPeerId,
                joinedAt: ws.__joinedAt,
              }),
            )
          }
        }
        return
      }

      if (msg.action === 'signal' && currentRoom) {
        const room = rooms.get(currentRoom)
        if (!room) return
        if (msg.data?.toPeerId) {
          for (const peer of room) {
            if (peer.__peerId === msg.data.toPeerId && peer.readyState === 1) {
              peer.send(JSON.stringify({ action: 'signal', data: msg.data }))
            }
          }
        } else {
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
          for (const peer of room) {
            if (peer.readyState === 1) {
              peer.send(JSON.stringify({ action: 'member-left', peerId: currentPeerId }))
            }
          }
          if (room.size === 0) rooms.delete(currentRoom)
        }
      }
    })
  })

  return {
    wss,
    close() {
      wss.close()
    },
  }
}

// ── Static file server ──────────────────────────────────────────────

const startStaticServer = (port) => {
  const server = createServer(async (req, res) => {
    const filePath = path.join(__dirname, 'p2p-test-page-ws.html')
    try {
      const content = await readFile(filePath, 'utf-8')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(content)
    } catch {
      res.writeHead(404)
      res.end('Not found')
    }
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        close() {
          server.close()
        },
      })
    })
  })
}

// ── Helpers ──────────────────────────────────────────────────────────

const waitFor = async (read, predicate, message, timeoutMs = 20000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise((r) => setTimeout(r, 100))
  }
  const last = await read()
  throw new Error(`${message} (last value: ${JSON.stringify(last)})`)
}

const getP2P = (page) =>
  page.evaluate(() => ({
    peerId: window.__p2p.peerId,
    role: window.__p2p.role,
    serverPeerId: window.__p2p.serverPeerId,
    peerCount: window.__p2p.peerCount,
    connectedPeers: window.__p2p.connectedPeers,
    receivedMessages: window.__p2p.receivedMessages,
    status: window.__p2p.status,
  }))

// ── Main test ───────────────────────────────────────────────────────

const SIGNAL_PORT = 8790
const STATIC_PORT = 8791
const roomId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const main = async () => {
  const relay = startSignalRelay(SIGNAL_PORT)
  const staticSrv = await startStaticServer(STATIC_PORT)
  const browser = await chromium.launch({ headless: true })

  const makeUrl = (extra = '') =>
    `http://127.0.0.1:${STATIC_PORT}/?room=${roomId}&signal=ws://127.0.0.1:${SIGNAL_PORT}${extra}`

  try {
    // ── Test 1: Two peers — role election + WebRTC ──────────────
    console.log('\n=== Test 1: Two peers connect ===')

    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    await page1.goto(makeUrl(), { waitUntil: 'domcontentloaded' })
    // Small delay so page1 is clearly first
    await new Promise((r) => setTimeout(r, 800))
    await page2.goto(makeUrl(), { waitUntil: 'domcontentloaded' })

    // Wait for both to have a role
    const state1 = await waitFor(
      () => getP2P(page1),
      (s) => s.role !== 'undecided',
      'page1 did not decide role',
    )

    const state2 = await waitFor(
      () => getP2P(page2),
      (s) => s.role !== 'undecided',
      'page2 did not decide role',
    )

    console.log(`  page1: role=${state1.role}, page2: role=${state2.role}`)

    // Exactly one server, one client
    const roles = [state1.role, state2.role].sort()
    assert.deepEqual(roles, ['client', 'server'], 'should have one server and one client')

    // Wait for WebRTC data channel to open
    await waitFor(
      () => getP2P(state1.role === 'server' ? page1 : page2),
      (s) => s.peerCount >= 1,
      'server did not connect to client via WebRTC',
    )

    await waitFor(
      () => getP2P(state1.role === 'client' ? page1 : page2),
      (s) => s.peerCount >= 1,
      'client did not connect to server via WebRTC',
    )

    console.log('  ✓ WebRTC data channel open between both peers')

    // ── Test 2: Server → Client data transfer ───────────────────
    console.log('\n=== Test 2: Server sends data to client ===')

    const serverPage = state1.role === 'server' ? page1 : page2
    const clientPage = state1.role === 'client' ? page1 : page2

    await serverPage.evaluate(() => {
      window.__p2p.sendToAll({ type: 'weather-update', temp: 22, city: 'Murmansk' })
    })

    const clientState = await waitFor(
      () => getP2P(clientPage),
      (s) => s.receivedMessages.length >= 1,
      'client did not receive server message',
    )

    assert.equal(clientState.receivedMessages[0].type, 'weather-update')
    assert.equal(clientState.receivedMessages[0].temp, 22)
    assert.equal(clientState.receivedMessages[0].city, 'Murmansk')
    console.log('  ✓ Client received weather-update from server')

    // ── Test 3: Client → Server data transfer ───────────────────
    console.log('\n=== Test 3: Client sends data to server ===')

    await clientPage.evaluate(() => {
      window.__p2p.sendToAll({ type: 'request-state', requestId: 1 })
    })

    const serverState = await waitFor(
      () => getP2P(serverPage),
      (s) => s.receivedMessages.length >= 1,
      'server did not receive client message',
    )

    assert.equal(serverState.receivedMessages[0].type, 'request-state')
    assert.equal(serverState.receivedMessages[0].requestId, 1)
    console.log('  ✓ Server received request-state from client')

    // ── Test 4: Third peer joins ────────────────────────────────
    console.log('\n=== Test 4: Third peer joins existing room ===')

    const ctx3 = await browser.newContext()
    const page3 = await ctx3.newPage()
    await page3.goto(makeUrl(), { waitUntil: 'domcontentloaded' })

    const state3 = await waitFor(
      () => getP2P(page3),
      (s) => s.role === 'client' && s.peerCount >= 1,
      'page3 did not become client with connection',
    )

    assert.equal(state3.role, 'client')

    // Server should now have 2 connected peers
    const serverAfter3 = await waitFor(
      () => getP2P(serverPage),
      (s) => s.peerCount >= 2,
      'server did not see 2 connected peers',
    )

    assert.equal(serverAfter3.peerCount, 2)
    console.log('  ✓ Third peer connected as client, server has 2 peers')

    // ── Test 5: Server broadcasts to all clients ────────────────
    console.log('\n=== Test 5: Server broadcasts to all ===')

    // Clear old messages
    await clientPage.evaluate(() => window.__p2p.clearMessages())
    await page3.evaluate(() => window.__p2p.clearMessages())

    await serverPage.evaluate(() => {
      window.__p2p.sendToAll({ type: 'broadcast', value: 42 })
    })

    const client1Msgs = await waitFor(
      () => getP2P(clientPage),
      (s) => s.receivedMessages.length >= 1,
      'client1 did not receive broadcast',
    )

    const client2Msgs = await waitFor(
      () => getP2P(page3),
      (s) => s.receivedMessages.length >= 1,
      'page3 did not receive broadcast',
    )

    assert.equal(client1Msgs.receivedMessages[0].type, 'broadcast')
    assert.equal(client1Msgs.receivedMessages[0].value, 42)
    assert.equal(client2Msgs.receivedMessages[0].type, 'broadcast')
    assert.equal(client2Msgs.receivedMessages[0].value, 42)
    console.log('  ✓ Both clients received broadcast from server')

    // Clean up contexts
    await ctx1.close()
    await ctx2.close()
    await ctx3.close()

    console.log('\n=== All sync tests passed ===\n')
  } finally {
    await browser.close()
    relay.close()
    staticSrv.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
