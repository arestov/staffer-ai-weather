/**
 * E2E test: P2P failover scenarios.
 *
 * Scenarios:
 *   1. Server leaves gracefully → client becomes server
 *   2. Server disconnects abruptly → client detects and becomes server
 *   3. New peer joins after failover → connects to new server
 *   4. Third peer present during failover → reconnects to new server
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { WebSocketServer } from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Signal relay (same as sync test) ────────────────────────────────

const startSignalRelay = (port) => {
  const wss = new WebSocketServer({ port })
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

const waitFor = async (read, predicate, message, timeoutMs = 25000) => {
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

const SIGNAL_PORT = 8792
const STATIC_PORT = 8793

const main = async () => {
  const relay = startSignalRelay(SIGNAL_PORT)
  const staticSrv = await startStaticServer(STATIC_PORT)
  const browser = await chromium.launch({ headless: true })

  const roomCounter = { n: 0 }
  const makeRoom = () => `failover-${Date.now()}-${++roomCounter.n}`

  const makeUrl = (roomId, extra = '') =>
    `http://127.0.0.1:${STATIC_PORT}/?room=${roomId}&signal=ws://127.0.0.1:${SIGNAL_PORT}${extra}`

  try {
    // ── Test 1: Graceful server leave → client becomes server ───
    console.log('\n=== Test 1: Graceful server leave ===')
    {
      const room = makeRoom()
      const ctx1 = await browser.newContext()
      const ctx2 = await browser.newContext()
      const page1 = await ctx1.newPage()
      const page2 = await ctx2.newPage()

      await page1.goto(makeUrl(room), { waitUntil: 'domcontentloaded' })
      await new Promise((r) => setTimeout(r, 800))
      await page2.goto(makeUrl(room), { waitUntil: 'domcontentloaded' })

      // Wait for connection
      await waitFor(
        () => getP2P(page1),
        (s) => s.role !== 'undecided',
        'page1 role',
      )
      await waitFor(
        () => getP2P(page2),
        (s) => s.role !== 'undecided',
        'page2 role',
      )

      const s1 = await getP2P(page1)
      const s2 = await getP2P(page2)

      const serverPage = s1.role === 'server' ? page1 : page2
      const clientPage = s1.role === 'client' ? page1 : page2
      const serverCtx = s1.role === 'server' ? ctx1 : ctx2
      const clientCtx = s1.role === 'client' ? ctx1 : ctx2

      // Wait for data channel
      await waitFor(
        () => getP2P(clientPage),
        (s) => s.peerCount >= 1,
        'client connected',
      )

      // Server leaves gracefully
      await serverPage.evaluate(() => window.__p2p.destroy())
      await serverCtx.close()

      // Client should become server
      const afterFailover = await waitFor(
        () => getP2P(clientPage),
        (s) => s.role === 'server',
        'client did not become server after graceful leave',
      )

      assert.equal(afterFailover.role, 'server')
      console.log('  ✓ Client became server after graceful leave')

      await clientCtx.close()
    }

    // ── Test 2: Abrupt server disconnect → client detects ───────
    console.log('\n=== Test 2: Abrupt server disconnect ===')
    {
      const room = makeRoom()
      const ctx1 = await browser.newContext()
      const ctx2 = await browser.newContext()
      const page1 = await ctx1.newPage()
      const page2 = await ctx2.newPage()

      await page1.goto(makeUrl(room), { waitUntil: 'domcontentloaded' })
      await new Promise((r) => setTimeout(r, 800))
      await page2.goto(makeUrl(room), { waitUntil: 'domcontentloaded' })

      await waitFor(
        () => getP2P(page1),
        (s) => s.role !== 'undecided',
        'page1 role',
      )
      await waitFor(
        () => getP2P(page2),
        (s) => s.role !== 'undecided',
        'page2 role',
      )

      const s1 = await getP2P(page1)
      const serverPage = s1.role === 'server' ? page1 : page2
      const clientPage = s1.role === 'client' ? page1 : page2
      const serverCtx = s1.role === 'server' ? ctx1 : ctx2
      const clientCtx = s1.role === 'client' ? ctx1 : ctx2

      await waitFor(
        () => getP2P(clientPage),
        (s) => s.peerCount >= 1,
        'client connected',
      )

      // Abruptly close server context (simulates tab crash / network loss)
      await serverCtx.close()

      // Client should eventually become server
      const afterCrash = await waitFor(
        () => getP2P(clientPage),
        (s) => s.role === 'server',
        'client did not become server after abrupt disconnect',
        30000,
      )

      assert.equal(afterCrash.role, 'server')
      console.log('  ✓ Client became server after abrupt disconnect')

      await clientCtx.close()
    }

    // ── Test 3: New peer joins after failover ───────────────────
    console.log('\n=== Test 3: New peer joins after failover ===')
    {
      const room = makeRoom()
      const ctx1 = await browser.newContext()
      const ctx2 = await browser.newContext()
      const page1 = await ctx1.newPage()
      const page2 = await ctx2.newPage()

      await page1.goto(makeUrl(room), { waitUntil: 'domcontentloaded' })
      await new Promise((r) => setTimeout(r, 800))
      await page2.goto(makeUrl(room), { waitUntil: 'domcontentloaded' })

      await waitFor(
        () => getP2P(page1),
        (s) => s.role !== 'undecided',
        'page1 role',
      )
      await waitFor(
        () => getP2P(page2),
        (s) => s.role !== 'undecided',
        'page2 role',
      )

      const s1 = await getP2P(page1)
      const serverCtx = s1.role === 'server' ? ctx1 : ctx2
      const clientPage = s1.role === 'client' ? page1 : page2
      const clientCtx = s1.role === 'client' ? ctx1 : ctx2

      await waitFor(
        () => getP2P(clientPage),
        (s) => s.peerCount >= 1,
        'client connected',
      )

      // Kill server
      await serverCtx.close()

      // Wait for failover
      await waitFor(
        () => getP2P(clientPage),
        (s) => s.role === 'server',
        'client did not become server',
        30000,
      )

      // New peer joins
      const ctx3 = await browser.newContext()
      const page3 = await ctx3.newPage()
      await page3.goto(makeUrl(room), { waitUntil: 'domcontentloaded' })

      const state3 = await waitFor(
        () => getP2P(page3),
        (s) => s.role === 'client' && s.peerCount >= 1,
        'page3 did not connect to new server',
      )

      assert.equal(state3.role, 'client')

      // New server should have the new peer
      const newServerState = await waitFor(
        () => getP2P(clientPage),
        (s) => s.peerCount >= 1,
        'new server did not see new peer',
      )

      assert.ok(newServerState.peerCount >= 1)
      console.log('  ✓ New peer connected to post-failover server')

      // Verify data flow works
      await clientPage.evaluate(() => {
        window.__p2p.sendToAll({ type: 'post-failover-test', value: 999 })
      })

      const msg3 = await waitFor(
        () => getP2P(page3),
        (s) => s.receivedMessages.some((m) => m.type === 'post-failover-test'),
        'page3 did not receive post-failover message',
      )

      assert.ok(
        msg3.receivedMessages.some((m) => m.type === 'post-failover-test' && m.value === 999),
      )
      console.log('  ✓ Data flows correctly after failover')

      await clientCtx.close()
      await ctx3.close()
    }

    // ── Test 4: Three peers — server leaves, one client becomes server ─
    console.log('\n=== Test 4: Three peers — failover with multiple clients ===')
    {
      const room = makeRoom()
      const ctx1 = await browser.newContext()
      const ctx2 = await browser.newContext()
      const ctx3 = await browser.newContext()
      const page1 = await ctx1.newPage()
      const page2 = await ctx2.newPage()
      const page3 = await ctx3.newPage()

      await page1.goto(makeUrl(room), { waitUntil: 'domcontentloaded' })
      await new Promise((r) => setTimeout(r, 800))
      await page2.goto(makeUrl(room), { waitUntil: 'domcontentloaded' })
      await new Promise((r) => setTimeout(r, 800))
      await page3.goto(makeUrl(room), { waitUntil: 'domcontentloaded' })

      // Wait for all roles decided
      await waitFor(
        () => getP2P(page1),
        (s) => s.role !== 'undecided',
        'page1 role',
      )
      await waitFor(
        () => getP2P(page2),
        (s) => s.role !== 'undecided',
        'page2 role',
      )
      await waitFor(
        () => getP2P(page3),
        (s) => s.role !== 'undecided',
        'page3 role',
      )

      const states = await Promise.all([getP2P(page1), getP2P(page2), getP2P(page3)])
      const pages = [page1, page2, page3]
      const ctxs = [ctx1, ctx2, ctx3]

      const serverIdx = states.findIndex((s) => s.role === 'server')
      assert.ok(serverIdx !== -1, 'no server found among 3 peers')

      const serverPage = pages[serverIdx]
      const serverCtx = ctxs[serverIdx]
      const clientPages = pages.filter((_, i) => i !== serverIdx)
      const clientCtxs = ctxs.filter((_, i) => i !== serverIdx)

      // Wait for server to have 2 connections
      await waitFor(
        () => getP2P(serverPage),
        (s) => s.peerCount >= 2,
        'server did not have 2 peers',
      )

      // Kill server
      await serverCtx.close()

      // Wait for one of the remaining clients to become server
      const results = await Promise.all(
        clientPages.map((p) =>
          waitFor(
            () => getP2P(p),
            (s) => s.role !== 'undecided',
            'role after failover',
            30000,
          ),
        ),
      )

      const newRoles = results.map((r) => r.role).sort()
      assert.deepEqual(
        newRoles,
        ['client', 'server'],
        'after failover should have 1 server + 1 client',
      )

      const newServerPage = results[0].role === 'server' ? clientPages[0] : clientPages[1]
      const newClientPage = results[0].role === 'client' ? clientPages[0] : clientPages[1]

      // Wait for WebRTC reconnection
      await waitFor(
        () => getP2P(newServerPage),
        (s) => s.peerCount >= 1,
        'new server did not reconnect with remaining client',
      )

      await waitFor(
        () => getP2P(newClientPage),
        (s) => s.peerCount >= 1,
        'remaining client did not reconnect to new server',
      )

      // Verify data flow
      await newClientPage.evaluate(() => window.__p2p.clearMessages())

      await newServerPage.evaluate(() => {
        window.__p2p.sendToAll({ type: 'post-multi-failover', ok: true })
      })

      await waitFor(
        () => getP2P(newClientPage),
        (s) => s.receivedMessages.some((m) => m.type === 'post-multi-failover'),
        'client did not receive message from new server',
      )

      console.log('  ✓ Failover with 3 peers works correctly')

      for (const ctx of clientCtxs) await ctx.close()
    }

    console.log('\n=== All failover tests passed ===\n')
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
