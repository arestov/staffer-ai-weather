/**
 * Playwright diagnostic: measure sparkline icon sizing vs step width.
 * Usage: node test/repl/playwright-icon-sizing-debug.mjs
 */
import { chromium } from 'playwright'

const baseUrl = process.env.WEATHER_PLAYWRIGHT_URL || 'http://127.0.0.1:5173'

const waitFor = async (fn, predicate, message, timeoutMs = 45000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await fn()
    if (predicate(value)) return value
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(message)
}

const measureIcons = async (page, label) => {
  return page.evaluate((lbl) => {
    const results = { label: lbl, sections: [] }

    for (const section of document.querySelectorAll('.sparkline-section')) {
      const title = section.querySelector('.sparkline-title__heading')?.textContent?.trim() ?? '?'
      const svg = section.querySelector('.sparkline-svg')
      const iconTrack = section.querySelector('.sparkline-icon-track')
      if (!svg || !iconTrack) continue

      const svgRect = svg.getBoundingClientRect()
      const trackRect = iconTrack.getBoundingClientRect()

      const icons = Array.from(iconTrack.querySelectorAll('.sparkline-icon-track__icon'))
      const iconDetails = icons.map((icon) => {
        const rect = icon.getBoundingClientRect()
        const computed = getComputedStyle(icon)
        const canvas = icon.querySelector('canvas')
        const canvasRect = canvas?.getBoundingClientRect()
        const container = icon.querySelector('.weather-condition-icon')
        const containerRect = container?.getBoundingClientRect()
        return {
          left: rect.left - trackRect.left,
          width: rect.width,
          height: rect.height,
          cssWidth: computed.width,
          cssHeight: computed.height,
          iconSize: computed.getPropertyValue('--weather-icon-size').trim(),
          iconSpeed: computed.getPropertyValue('--weather-icon-speed').trim(),
          canvasWidth: canvasRect?.width ?? null,
          canvasHeight: canvasRect?.height ?? null,
          canvasStyleWidth: canvas?.style.width ?? null,
          canvasStyleHeight: canvas?.style.height ?? null,
          containerWidth: containerRect?.width ?? null,
          containerHeight: containerRect?.height ?? null,
        }
      })

      // Count dashes in the SVG to get step count
      const dashes = section.querySelectorAll('.sparkline-svg line').length

      results.sections.push({
        title,
        svgWidth: svgRect.width,
        trackWidth: trackRect.width,
        trackHeight: trackRect.height,
        dashCount: dashes,
        expectedStepWidth: dashes > 0 ? svgRect.width / dashes : null,
        iconCount: icons.length,
        icons: iconDetails,
      })
    }

    return results
  }, label)
}

const main = async () => {
  const browser = await chromium.launch({ headless: true })

  try {
    // Test at different viewport widths
    for (const width of [1440, 800, 480]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })

      console.log(`\n${'='.repeat(60)}`)
      console.log(`VIEWPORT: ${width}x900`)
      console.log('='.repeat(60))

      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle').catch(() => undefined)
      // Extra time for shared worker + backend data
      await new Promise((r) => setTimeout(r, 5000))

      // Debug: what's on the page?
      const debugInfo = await page.evaluate(() => ({
        title: document.title,
        url: location.href,
        bodyClasses: document.body.className,
        bodyChildCount: document.body.children.length,
        rootHtml: document.getElementById('root')?.innerHTML?.slice(0, 500) ?? '(no #root)',
        allSelectors: [
          ['[data-selected-location-id]', document.querySelectorAll('[data-selected-location-id]').length],
          ['.weather-readout--location', document.querySelectorAll('.weather-readout--location').length],
          ['.sparkline-section', document.querySelectorAll('.sparkline-section').length],
          ['.location-card', document.querySelectorAll('.location-card').length],
          ['.location-card--featured', document.querySelectorAll('.location-card--featured').length],
          ['.forecast-panels', document.querySelectorAll('.forecast-panels').length],
          ['.sparkline-icon-track', document.querySelectorAll('.sparkline-icon-track').length],
          ['.sparkline-icon-track__icon', document.querySelectorAll('.sparkline-icon-track__icon').length],
        ],
        featuredCardHtml: document.querySelector('.location-card--featured')?.innerHTML?.slice(0, 1000) ?? '(no featured)',
        forecastPanelsHtml: document.querySelector('.forecast-panels')?.innerHTML?.slice(0, 1000) ?? '(no forecast-panels)',
      }))
      console.log(`\n[DEBUG ${width}]`, JSON.stringify(debugInfo, null, 2))

      // Wait for sparkline sections to appear (weather data loaded)
      await waitFor(
        () => page.locator('.sparkline-section').count(),
        (n) => n >= 1,
        `sparkline sections did not appear (viewport ${width})`,
      )

      // Wait for weather data
      await waitFor(
        () => page.locator('.weather-readout--location').first().textContent(),
        (text) => text && /\d+\s*°C/.test(text),
        'weather data did not load',
      )

      // Wait for icons to render
      await new Promise((r) => setTimeout(r, 4000))

      // Measure main/featured card
      const mainResult = await measureIcons(page, `main-${width}`)
      console.log('\n--- MAIN/FEATURED ---')
      console.log(JSON.stringify(mainResult, null, 2))

      // Open popover
      const trigger = page.locator('[data-selected-location-trigger]').first()
      if (await trigger.count()) {
        await trigger.click()
        await new Promise((r) => setTimeout(r, 2000))

        const popoverResult = await measureIcons(page, `popover-${width}`)
        console.log('\n--- POPOVER ---')
        console.log(JSON.stringify(popoverResult, null, 2))
      }

      // Test resize
      await page.setViewportSize({ width: width === 1440 ? 600 : 1200, height: 900 })
      await new Promise((r) => setTimeout(r, 2000))

      const resizedResult = await measureIcons(page, `resized-${width}`)
      console.log('\n--- AFTER RESIZE ---')
      console.log(JSON.stringify(resizedResult, null, 2))

      await page.close()
    }

    // Check animation speed
    const speedPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await speedPage.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await speedPage.waitForLoadState('networkidle').catch(() => undefined)

    await waitFor(
      () => speedPage.locator('.sparkline-section').count(),
      (n) => n >= 1,
      'sparkline sections did not appear for speed test',
    )

    await waitFor(
      () => speedPage.locator('.weather-readout--location').first().textContent(),
      (text) => text && /\d+\s*°C/.test(text),
      'weather data did not load for speed test',
    )
    await new Promise((r) => setTimeout(r, 4000))

    const speedResult = await speedPage.evaluate(() => {
      const results = { sparklineIcons: [], mainIcons: [] }

      // Check sparkline icon speed via CSS var
      for (const icon of document.querySelectorAll('.sparkline-icon-track__icon')) {
        const speed = getComputedStyle(icon).getPropertyValue('--weather-icon-speed').trim()
        results.sparklineIcons.push({ speed })
      }

      // Check main weather icon speed
      for (const icon of document.querySelectorAll('.weather-condition-icon')) {
        const speed = getComputedStyle(icon).getPropertyValue('--weather-icon-speed').trim()
        const parent = icon.closest('.sparkline-icon-track__icon')
        results.mainIcons.push({ speed, inSparkline: !!parent })
      }

      return results
    })
    console.log('\n===== ANIMATION SPEED CHECK =====')
    console.log(JSON.stringify(speedResult, null, 2))

    await speedPage.close()
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.log('[FATAL]', e.message)
  process.exitCode = 1
})
