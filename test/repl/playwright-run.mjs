import { spawn } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const weatherRoot = path.join(repoRoot, 'weather')
const previewBaseUrl = process.env.WEATHER_PLAYWRIGHT_URL || 'http://127.0.0.1:4173'
const screenshotPath = path.join(weatherRoot, 'test/repl/playwright-popover.png')

const waitForFile = async (filePath, timeoutMs = 120000) => {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await access(filePath)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  throw new Error(`timed out waiting for ${filePath}`)
}

const ensurePreviewServer = async () => {
  const baseUrl = new URL(previewBaseUrl)
  const probeUrl = new URL('/', baseUrl).href

  try {
    const response = await fetch(probeUrl, { method: 'GET' })
    if (response.ok) {
      return
    }
  } catch {
    // fall through and wait for the user-provided server if it is still booting
  }

  await waitForFile(path.join(weatherRoot, 'dist/index.html'))
}

const main = async () => {
  await ensurePreviewServer()
  await mkdir(path.dirname(screenshotPath), { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  try {
    await page.goto(previewBaseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await page.waitForSelector('[data-selected-location-id]')
    await page.waitForSelector('[data-selected-location-trigger]')

    const support = await page.evaluate(() => ({
      popover: typeof HTMLElement.prototype.showPopover === 'function',
      anchorName:
        typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
          ? CSS.supports('anchor-name: --selected-location-trigger')
          : false,
      positionAnchor:
        typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
          ? CSS.supports('position-anchor: --selected-location-trigger')
          : false,
      anchorFn:
        typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
          ? CSS.supports('top: anchor(bottom)')
          : false,
      anchorSize:
        typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
          ? CSS.supports('width: anchor-size(--weather-shell width)')
          : false,
    }))

    const data = await page.evaluate(async () => {
      const trigger = document.querySelector('[data-selected-location-trigger]')
      if (!(trigger instanceof HTMLElement)) {
        throw new Error('selected location trigger not found')
      }

      trigger.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

      const popoverLayer = document.querySelector('[data-selected-location-popover-layer]')
      const popoverSurface = document.querySelector('[data-selected-location-popover]')
      const triggerBox = trigger.getBoundingClientRect().toJSON()
      const layerBox =
        popoverLayer instanceof HTMLElement ? popoverLayer.getBoundingClientRect().toJSON() : null
      const surfaceBox =
        popoverSurface instanceof HTMLElement
          ? popoverSurface.getBoundingClientRect().toJSON()
          : null
      const layerStyle =
        popoverLayer instanceof HTMLElement
          ? {
              position: getComputedStyle(popoverLayer).position,
              top: getComputedStyle(popoverLayer).top,
              left: getComputedStyle(popoverLayer).left,
              width: getComputedStyle(popoverLayer).width,
              display: getComputedStyle(popoverLayer).display,
            }
          : null

      return {
        title: document.title,
        triggerBox,
        layerBox,
        surfaceBox,
        layerStyle,
        popoverText: popoverSurface?.textContent ?? null,
        currentPopoverFor:
          popoverLayer instanceof HTMLElement
            ? popoverLayer.getAttribute('data-popover-for')
            : null,
      }
    })

    await page.screenshot({ path: screenshotPath, fullPage: true })

    console.log('[playwright-repl] support', JSON.stringify(support, null, 2))
    console.log('[playwright-repl] popover', JSON.stringify(data, null, 2))
    console.log('[playwright-repl] screenshot', screenshotPath)
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
