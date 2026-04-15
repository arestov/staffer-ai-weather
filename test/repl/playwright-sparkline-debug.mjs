import { chromium } from 'playwright'

const baseUrl = process.env.WEATHER_PLAYWRIGHT_URL || 'http://127.0.0.1:4173'

const waitFor = async (fn, predicate, message, timeoutMs = 25000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await fn()
    if (predicate(value)) return value
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(message)
}

const main = async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  try {
    await page.goto(`${baseUrl}/#/`, { waitUntil: 'domcontentloaded' })

    // Wait for cards to load
    await waitFor(
      () => page.locator('[data-selected-location-id]').count(),
      (n) => n >= 4,
      'cards did not appear',
    )

    // Wait for weather data
    await waitFor(
      () => page.locator('.weather-readout--location').first().textContent(),
      (text) => text && /\d+\s*°C/.test(text),
      'weather data did not load',
    )

    // Give a moment for reactive updates
    await new Promise((r) => setTimeout(r, 2000))

    // Check main-stage structure
    const mainStageHtml = await page.locator('.main-stage').first().evaluate((el) => {
      const result = {
        forecastPanels: el.querySelector('.forecast-panels') !== null,
        sparklineSections: el.querySelectorAll('.sparkline-section').length,
        sparklineSvgs: el.querySelectorAll('.sparkline-svg').length,
        sparklineTitles: [],
        sparklineEndpoints: [],
        forecastChips: el.querySelectorAll('.forecast-chip').length,
        forecastLists: el.querySelectorAll('.forecast-list').length,
        miniLabels: Array.from(el.querySelectorAll('.mini-section-label')).map((e) => e.textContent),
        innerHtmlSnapshot: el.querySelector('.forecast-panels')?.innerHTML?.slice(0, 500) ?? '(no .forecast-panels)',
      }

      for (const s of el.querySelectorAll('.sparkline-section')) {
        const title = s.querySelector('.sparkline-title')?.textContent?.trim() ?? ''
        result.sparklineTitles.push(title)
      }

      for (const e of el.querySelectorAll('.sparkline-endpoint')) {
        result.sparklineEndpoints.push(e.textContent?.trim() ?? '')
      }

      return result
    })

    console.log('\n===== MAIN STAGE DIAGNOSTIC =====')
    console.log(JSON.stringify(mainStageHtml, null, 2))

    // Check the scope/relay chain
    const scopeDebug = await page.evaluate(() => {
      const debug = window.__weatherSync
      if (!debug) return { error: 'no __weatherSync' }
      const snapshot = debug.snapshot?.()
      return {
        ready: snapshot?.ready,
        sessionKey: snapshot?.sessionKey,
      }
    })
    console.log('\n===== SYNC DEBUG =====')
    console.log(JSON.stringify(scopeDebug, null, 2))

    // Also check the location-card__body DOM tree
    const bodyDebug = await page.locator('.location-card--featured .location-card__body').first().evaluate((el) => {
      return {
        childrenTags: Array.from(el.children).map((c) => `${c.tagName}.${c.className}`),
        html: el.innerHTML.slice(0, 1000),
      }
    })
    console.log('\n===== FEATURED CARD BODY =====')
    console.log(JSON.stringify(bodyDebug, null, 2))

    // Now test popover
    console.log('\n===== POPOVER TEST =====')
    await page.locator('[data-selected-location-id] [data-selected-location-trigger]').first().click()
    await new Promise((r) => setTimeout(r, 1000))

    const popoverHtml = await page.evaluate(() => {
      const popover = document.querySelector('.selected-location-popover__forecasts')
        || document.querySelector('.selected-location-popover__body')
      if (!popover) return { error: 'no popover found' }
      return {
        forecastLists: popover.querySelectorAll('.forecast-list').length,
        forecastChips: popover.querySelectorAll('.forecast-chip').length,
        sparklineSections: popover.querySelectorAll('.sparkline-section').length,
        html: popover.innerHTML.slice(0, 500),
      }
    })
    console.log(JSON.stringify(popoverHtml, null, 2))

  } finally {
    try {
      await browser.close()
    } catch (error) {
      console.warn('[playwright-repl] failed to close browser', error)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
