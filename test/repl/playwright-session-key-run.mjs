import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const baseUrl = process.env.WEATHER_PLAYWRIGHT_URL || 'http://127.0.0.1:5173'

const waitFor = async (read, predicate, message, timeoutMs = 15000) => {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const value = await read()
    if (predicate(value)) {
      return value
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  throw new Error(message)
}

const readPageState = async (page) => {
  return await page.evaluate(() => {
    const debug = window.__weatherSync

    return {
      hash: window.location.hash,
      lastSessionKey: window.localStorage.getItem('weather:last-session-key'),
      snapshot: debug?.snapshot?.() ?? null,
    }
  })
}

const waitForSessionKey = async (page, expectedSessionKey) => {
  return await waitFor(
    () => readPageState(page),
    (state) => state.snapshot?.sessionKey === expectedSessionKey && state.snapshot?.ready,
    `page did not resolve session key ${expectedSessionKey}`,
  )
}

const main = async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const pageA = await context.newPage()
  const pageB = await context.newPage()

  try {
    await pageA.goto(`${baseUrl}/#/`, { waitUntil: 'domcontentloaded' })

    const stateA = await waitFor(
      () => readPageState(pageA),
      (state) => Boolean(state.snapshot?.sessionKey && state.snapshot?.ready),
      'page A did not bootstrap a generated session key',
    )

    const alphaKey = stateA.snapshot.sessionKey
    const alphaSessionId = stateA.snapshot.sessionId
    const alphaRootNodeId = stateA.snapshot.rootNodeId
    assert.equal(stateA.hash, `#/${alphaKey}`)
    assert.equal(stateA.lastSessionKey, alphaKey)

    await pageB.goto(`${baseUrl}/#/new`, { waitUntil: 'domcontentloaded' })

    const stateB = await waitFor(
      () => readPageState(pageB),
      (state) => Boolean(state.snapshot?.sessionKey && state.snapshot?.ready),
      'page B did not bootstrap a new session key',
    )

    const betaKey = stateB.snapshot.sessionKey
    assert.notEqual(betaKey, alphaKey)
    assert.equal(stateB.hash, `#/${betaKey}`)
    assert.equal(stateB.lastSessionKey, betaKey)

    const pageAStillAlpha = await readPageState(pageA)
    assert.equal(pageAStillAlpha.hash, `#/${alphaKey}`)
    assert.equal(pageAStillAlpha.snapshot?.sessionKey, alphaKey)
    assert.equal(pageAStillAlpha.snapshot?.sessionId, alphaSessionId)
    assert.equal(pageAStillAlpha.snapshot?.rootNodeId, alphaRootNodeId)

    await pageA.evaluate((nextSessionKey) => {
      window.location.hash = `#/${nextSessionKey}`
    }, betaKey)

    const pageASwitchedState = await waitForSessionKey(pageA, betaKey)
    assert.equal(pageASwitchedState.hash, `#/${betaKey}`)
    assert.notEqual(pageASwitchedState.snapshot?.sessionId, alphaSessionId)
    assert.notEqual(pageASwitchedState.snapshot?.rootNodeId, alphaRootNodeId)

    console.log(
      JSON.stringify(
        {
          alphaKey,
          betaKey,
          finalPageA: pageASwitchedState,
          finalPageB: await readPageState(pageB),
        },
        null,
        2,
      ),
    )
  } finally {
    try {
      await browser.close()
    } catch (error) {
      console.warn('[playwright-repl] failed to close browser', error)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})