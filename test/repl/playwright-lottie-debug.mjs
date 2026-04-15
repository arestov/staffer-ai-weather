/**
 * Playwright script to debug Lottie weather icon rendering.
 * Launches Vite dev server, opens the test page, checks canvas rendering.
 *
 * Usage: node test/repl/playwright-lottie-debug.mjs
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const weatherRoot = path.join(repoRoot, 'weather')
const devUrl = 'http://127.0.0.1:5173'
const testPageUrl = `${devUrl}/test/repl/lottie-icon-test.html`

const waitForServer = async (url, timeoutMs = 30000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(`Server did not start at ${url} within ${timeoutMs}ms`)
}

const main = async () => {
  // Check if dev server is already running
  let devProc = null
  let needsKill = false
  try {
    await waitForServer(devUrl, 3000)
    console.log('[lottie-debug] Dev server already running')
  } catch {
    console.log('[lottie-debug] Starting vite dev server...')
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    devProc = spawn(npmCmd, ['run', 'dev'], {
      cwd: weatherRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    needsKill = true
    devProc.stdout.on('data', d => process.stdout.write(`[vite] ${d}`))
    devProc.stderr.on('data', d => process.stderr.write(`[vite:err] ${d}`))
    await waitForServer(devUrl)
    console.log('[lottie-debug] Dev server ready')
  }

  const browser = await chromium.launch({ headless: false })
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } })

  // Collect console messages
  const consoleLogs = []
  const failedRequests = []
  page.on('console', msg => {
    const text = `[browser:${msg.type()}] ${msg.text()}`
    consoleLogs.push(text)
    console.log(text)
  })
  page.on('pageerror', err => {
    consoleLogs.push(`[browser:error] ${err.message}`)
    console.error(`[browser:error] ${err.message}`)
  })
  page.on('response', response => {
    if (response.status() >= 400) {
      const line = `[network:${response.status()}] ${response.url()}`
      failedRequests.push(line)
      console.log(line)
    }
  })

  try {
    console.log(`[lottie-debug] Navigating to ${testPageUrl}`)
    await page.goto(testPageUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000) // give lottie time to load + render

    // Test the import chain directly
    const importTest = await page.evaluate(async () => {
      const results = {}

      // Test 1: Can we import lottie-web?
      try {
        const lottieModule = await import('lottie-web/build/player/lottie_canvas_worker')
        results.lottieLoaded = true
        results.lottieKeys = Object.keys(lottieModule)
        results.lottieDefault = typeof (lottieModule.default ?? lottieModule)
        const lottie = lottieModule.default ?? lottieModule
        results.lottieHasLoadAnimation = typeof lottie.loadAnimation === 'function'
      } catch (e) {
        results.lottieLoaded = false
        results.lottieError = e.message
      }

      // Test 2: Can we import a JSON icon?
      try {
        const iconModule = await import('@meteocons/lottie/monochrome/clear-day.json')
        results.iconLoaded = true
        results.iconType = typeof (iconModule.default ?? iconModule)
        const data = iconModule.default ?? iconModule
        results.iconHasV = 'v' in data // Lottie JSON has a "v" (version) field
        results.iconKeys = Object.keys(data).slice(0, 10)
      } catch (e) {
        results.iconLoaded = false
        results.iconError = e.message
      }

      // Test 3: Try manual fetch of the JSON
      try {
        const resp = await fetch('/node_modules/@meteocons/lottie/monochrome/clear-day.json')
        results.fetchStatus = resp.status
        if (resp.ok) {
          const json = await resp.json()
          results.fetchIconKeys = Object.keys(json).slice(0, 10)
        }
      } catch (e) {
        results.fetchError = e.message
      }

      return results
    })

    console.log('\n[lottie-debug] === IMPORT TEST ===')
    console.log(JSON.stringify(importTest, null, 2))

    // Check what's in the DOM
    const diagnostics = await page.evaluate(() => {
      const containers = document.querySelectorAll('.weather-condition-icon')
      const results = []

      for (const container of containers) {
        const canvases = container.querySelectorAll('canvas')
        const label = container.closest('[data-testcard]')?.getAttribute('data-testcard') ?? 'unknown'

        for (const canvas of canvases) {
          // Try to read actual pixel data from a 2D context
          // Note: after transferControlToOffscreen, getContext will fail
          let pixelInfo = null
          let pixelError = null
          try {
            const ctx = canvas.getContext('2d')
            if (ctx) {
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
              const data = imageData.data
              let nonZeroPixels = 0
              let totalAlpha = 0
              let samplePixels = []
              for (let i = 0; i < data.length; i += 4) {
                const a = data[i + 3]
                if (a > 0) {
                  nonZeroPixels++
                  totalAlpha += a
                  if (samplePixels.length < 5) {
                    samplePixels.push({
                      r: data[i], g: data[i+1], b: data[i+2], a,
                      x: (i / 4) % canvas.width, y: Math.floor((i / 4) / canvas.width),
                    })
                  }
                }
              }
              pixelInfo = {
                totalPixels: data.length / 4,
                nonZeroPixels,
                avgAlpha: nonZeroPixels > 0 ? Math.round(totalAlpha / nonZeroPixels) : 0,
                samplePixels,
              }
            } else {
              pixelError = 'getContext returned null (canvas likely transferred to OffscreenCanvas)'
            }
          } catch (e) {
            pixelError = e.message
          }

          results.push({
            label,
            containerTag: container.tagName,
            containerChildren: container.childElementCount,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            containerSize: `${container.offsetWidth}x${container.offsetHeight}`,
            pixelInfo,
            pixelError,
          })
        }

        if (canvases.length === 0) {
          results.push({
            label,
            containerTag: container.tagName,
            containerChildren: container.childElementCount,
            noCanvas: true,
            containerHTML: container.innerHTML.slice(0, 200),
            containerSize: `${container.offsetWidth}x${container.offsetHeight}`,
          })
        }
      }

      return {
        containerCount: containers.length,
        cardCount: document.querySelectorAll('[data-testcard]').length,
        results,
      }
    })

    console.log('\n[lottie-debug] === DIAGNOSTICS ===')
    console.log(JSON.stringify(diagnostics, null, 2))

    // Take screenshot
    const screenshotPath = path.join(weatherRoot, 'test/repl/lottie-debug-screenshot.png')
    await page.screenshot({ path: screenshotPath, fullPage: true })
    console.log(`\n[lottie-debug] Screenshot saved to ${screenshotPath}`)

    // Check for errors  
    const errors = consoleLogs.filter(l => l.includes('error') || l.includes('Error') || l.includes('fail'))
    if (errors.length > 0) {
      console.log('\n[lottie-debug] === CONSOLE ERRORS ===')
      for (const e of errors) console.log(e)
    }
    if (failedRequests.length > 0) {
      console.log('\n[lottie-debug] === FAILED REQUESTS ===')
      for (const r of failedRequests) console.log(r)
    }

    console.log('\n[lottie-debug] Keeping browser open for 10s for manual inspection...')
    await page.waitForTimeout(10000)
  } finally {
    await browser.close()
    if (devProc && needsKill) {
      devProc.kill()
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
