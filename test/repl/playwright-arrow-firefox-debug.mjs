/**
 * Debug script: test whether the popover arrow repositions correctly in Firefox
 * when switching between different location cards while the popover is open.
 */
import { firefox } from 'playwright'

const baseUrl = process.env.WEATHER_PLAYWRIGHT_URL || 'http://127.0.0.1:5173'

const main = async () => {
  const browser = await firefox.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await page.waitForSelector('[data-selected-location-id]', { timeout: 15000 })

    // Gather all location trigger buttons
    const triggers = await page.$$('[data-selected-location-trigger]')
    console.log(`[firefox-arrow] found ${triggers.length} location triggers`)

    if (triggers.length < 2) {
      console.log('[firefox-arrow] need at least 2 triggers to test switching')
      return
    }

    const getArrowState = () =>
      page.evaluate(() => {
        const arrow = document.getElementById('selected-location-popover-arrow')
        const popover = document.getElementById('selected-location-popover-layer')
        if (!arrow) return { error: 'arrow element not found' }

        const arrowRect = arrow.getBoundingClientRect()
        const arrowStyle = getComputedStyle(arrow)
        const isPopoverOpen =
          popover &&
          (() => {
            try {
              return popover.matches(':popover-open')
            } catch {
              return false
            }
          })()
        const isArrowOpen = (() => {
          try {
            return arrow.matches(':popover-open')
          } catch {
            return false
          }
        })()

        // Find the active anchor
        const activeAnchor = document.querySelector('[data-popover-anchor="active"]')
        const anchorRect = activeAnchor ? activeAnchor.getBoundingClientRect() : null
        const anchorId =
          activeAnchor
            ?.closest('[data-selected-location-id]')
            ?.getAttribute('data-selected-location-id') ?? null

        return {
          isPopoverOpen,
          isArrowOpen,
          arrowRect: {
            top: Math.round(arrowRect.top),
            left: Math.round(arrowRect.left),
            width: Math.round(arrowRect.width),
            height: Math.round(arrowRect.height),
          },
          arrowDisplay: arrowStyle.display,
          arrowPosition: arrowStyle.position,
          arrowTop: arrowStyle.top,
          arrowLeft: arrowStyle.left,
          anchorId,
          anchorRect: anchorRect
            ? {
                top: Math.round(anchorRect.top),
                left: Math.round(anchorRect.left),
                width: Math.round(anchorRect.width),
              }
            : null,
          popoverFor: arrow.getAttribute('data-popover-for'),
        }
      })

    // Click first trigger (force: true because popover may cover other triggers)
    console.log('\n--- Click trigger 0 ---')
    await triggers[0].click({ force: true })
    await page.waitForTimeout(600)
    const state0 = await getArrowState()
    console.log(JSON.stringify(state0, null, 2))

    // Now click via JS dispatch (force:true may not trigger React through popover)
    for (let i = 1; i < Math.min(triggers.length, 5); i++) {
      console.log(`\n--- JS click trigger ${i} (popover already open) ---`)

      const triggerRect = await triggers[i].evaluate((el) => {
        const rect = el.getBoundingClientRect()
        return {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
        }
      })
      console.log(`  trigger rect: ${JSON.stringify(triggerRect)}`)

      // Dispatch click directly on the button element
      await triggers[i].evaluate((el) => el.click())

      for (const [label, wait] of [
        ['50ms', 50],
        ['200ms', 150],
        ['500ms', 300],
        ['1000ms', 500],
      ]) {
        await page.waitForTimeout(wait)
        const state = await getArrowState()
        console.log(
          `  after ${label}: arrowOpen=${state.isArrowOpen} arrowLeft=${state.arrowRect?.left} anchorLeft=${state.anchorRect?.left} anchorId=${state.anchorId} popoverFor=${state.popoverFor}`,
        )
      }
    }

    // Test: close and reopen (should always work)
    console.log('\n--- Close and reopen trigger 0 ---')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    await triggers[0].click({ force: true })
    await page.waitForTimeout(600)
    const stateReopen = await getArrowState()
    console.log('After reopen:', JSON.stringify(stateReopen, null, 2))
  } finally {
    await browser.close().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
