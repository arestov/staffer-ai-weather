/**
 * Comprehensive style audit: collects computed CSS for every element
 * in docs/component-style-audit.md across three UI states:
 *   1. Main page (cards visible)
 *   2. Popover open
 *   3. Search panel open
 */
import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const previewBaseUrl = process.env.WEATHER_PLAYWRIGHT_URL || 'http://127.0.0.1:4173'
const outPath = path.resolve(fileURLToPath(import.meta.url), '..', 'style-audit-results.json')

/** Collect computed style props from an element */
const getStyles = (el, props) => {
  if (!el) return null
  const cs = getComputedStyle(el)
  const result = {}
  for (const p of props) result[p] = cs.getPropertyValue(p)
  return result
}

/** Collect computed style for a pseudo-element */
const getPseudoStyles = (el, pseudo, props) => {
  if (!el) return null
  const cs = getComputedStyle(el, pseudo)
  const result = {}
  for (const p of props) result[p] = cs.getPropertyValue(p)
  return result
}

const main = async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const results = {}

  try {
    // ── PHASE 1: Main page ──────────────────────────────────────
    await page.goto(previewBaseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForSelector('[data-selected-location-id]', { timeout: 30000 })
    // Wait for status pill to show READY
    await page.waitForSelector('.status-pill--ready', { timeout: 30000 }).catch(() => {})

    results.mainPage = await page.evaluate(({ getStylesSrc, getPseudoStylesSrc }) => {
      const getStyles = new Function('el', 'props', getStylesSrc)
      const getPseudoStyles = new Function('el', 'pseudo', 'props', getPseudoStylesSrc)

      const bgProps = ['background', 'background-color', 'background-image', 'border', 'border-color', 'border-width', 'box-shadow']
      const textProps = ['color', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'line-height']

      // 1. body
      const body = getStyles(document.body, [...bgProps, 'background-image'])

      // 1b. body::before
      const bodyBefore = getPseudoStyles(document.body, '::before', [...bgProps, 'content', 'background-image'])

      // 2. App header trigger
      const headerTrigger = document.querySelector('.app-header-trigger')
      const headerTriggerStyles = getStyles(headerTrigger, [...bgProps, ...textProps])

      // 2b. Trigger dot
      const triggerDot = document.querySelector('.app-header-trigger__dot')
      const triggerDotStyles = getStyles(triggerDot, ['background', 'background-color', 'box-shadow', 'width', 'height'])

      // 3. Featured location card
      const featuredCard = document.querySelector('.location-card--featured')
      const featuredCardStyles = getStyles(featuredCard, bgProps)

      // 4. Weather readout on featured card
      const weatherReadout = featuredCard?.querySelector('.weather-readout')
      const weatherReadoutStyles = getStyles(weatherReadout, bgProps)

      // 4b. Weather readout label
      const readoutLabel = featuredCard?.querySelector('.weather-readout__label')
      const readoutLabelStyles = getStyles(readoutLabel, [...textProps])

      // 4c. Weather readout value (temperature)
      const readoutValue = featuredCard?.querySelector('.weather-readout__value')
      const readoutValueStyles = getStyles(readoutValue, [...textProps])

      // 4d. Weather readout summary
      const readoutSummary = featuredCard?.querySelector('.weather-readout__summary')
      const readoutSummaryStyles = getStyles(readoutSummary, [...textProps])

      // 4e. Weather readout meta
      const readoutMeta = featuredCard?.querySelector('.weather-readout__meta')
      const readoutMetaStyles = getStyles(readoutMeta, [...textProps])

      // 5. Status pill --ready
      const statusPill = document.querySelector('.status-pill--ready')
      const statusPillStyles = getStyles(statusPill, ['background', 'background-color', ...textProps])

      // 6. Forecast chips on featured card
      const featuredChip = featuredCard?.querySelector('.forecast-chip')
      const featuredChipStyles = getStyles(featuredChip, bgProps)

      // 6b. Forecast chip children
      const chipLabel = featuredChip?.querySelector('.forecast-chip__label')
      const chipLabelStyles = getStyles(chipLabel, textProps)

      const chipStrong = featuredChip?.querySelector('strong')
      const chipStrongStyles = getStyles(chipStrong, textProps)

      const chipP = featuredChip?.querySelector('p')
      const chipPStyles = getStyles(chipP, textProps)

      // 7. Additional location card (non-featured)
      const additionalCards = document.querySelectorAll('.location-card:not(.location-card--featured)')
      const additionalCard = additionalCards[0]
      const additionalCardStyles = getStyles(additionalCard, bgProps)

      return {
        '1_body': body,
        '1b_bodyBefore': bodyBefore,
        '2_appHeaderTrigger': headerTriggerStyles,
        '2b_triggerDot': triggerDotStyles,
        '3_featuredCard': featuredCardStyles,
        '4_weatherReadout': weatherReadoutStyles,
        '4b_readoutLabel': readoutLabelStyles,
        '4c_readoutValue': readoutValueStyles,
        '4d_readoutSummary': readoutSummaryStyles,
        '4e_readoutMeta': readoutMetaStyles,
        '5_statusPillReady': statusPillStyles,
        '6_forecastChip': featuredChipStyles,
        '6b_chipLabel': chipLabelStyles,
        '6c_chipStrong': chipStrongStyles,
        '6d_chipP': chipPStyles,
        '7_additionalCard': additionalCardStyles,
        '_additionalCardCount': additionalCards.length,
        '_statusPillFound': !!statusPill,
        '_featuredChipFound': !!featuredChip,
      }
    }, {
      getStylesSrc: `
        if (!el) return null;
        const cs = getComputedStyle(el);
        const result = {};
        for (const p of props) result[p] = cs.getPropertyValue(p);
        return result;
      `,
      getPseudoStylesSrc: `
        if (!el) return null;
        const cs = getComputedStyle(el, pseudo);
        const result = {};
        for (const p of props) result[p] = cs.getPropertyValue(p);
        return result;
      `,
    })

    // ── PHASE 2: Open popover ───────────────────────────────────
    const trigger = page.locator('[data-selected-location-trigger]').first()
    await trigger.click()
    // Wait for popover to appear
    await page.waitForSelector('[data-selected-location-popover]', { timeout: 10000 })
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))

    results.popover = await page.evaluate(({ getStylesSrc, getPseudoStylesSrc }) => {
      const getStyles = new Function('el', 'props', getStylesSrc)
      const getPseudoStyles = new Function('el', 'pseudo', 'props', getPseudoStylesSrc)

      const bgProps = ['background', 'background-color', 'background-image', 'border', 'border-color', 'border-width', 'box-shadow']
      const textProps = ['color', 'font-family', 'font-size', 'font-weight']

      // 8. Popover surface
      const popover = document.querySelector('.selected-location-popover--floating')
      const popoverStyles = getStyles(popover, bgProps)

      // 9. Popover arrow (::before of popover surface)
      const arrowBefore = getPseudoStyles(popover, '::before', [...bgProps, 'width', 'height', 'transform'])

      // Alternative: the arrow might be a sibling element
      const arrowEl = document.querySelector('.selected-location-popover-arrow--floating')
      const arrowStyles = getStyles(arrowEl, bgProps)

      // 10. Edit trigger button
      const editTrigger = document.querySelector('.selected-location-popover__edit-trigger')
      const editTriggerStyles = getStyles(editTrigger, [...bgProps, ...textProps])

      // 10b. Close button
      const closeBtn = document.querySelector('.selected-location-popover__close')
      const closeBtnStyles = getStyles(closeBtn, [...bgProps, ...textProps])

      // 11. Popover weather readout
      const popoverReadout = popover?.querySelector('.weather-readout')
      const popoverReadoutStyles = getStyles(popoverReadout, bgProps)

      // 12. Popover forecast chips
      const popoverChip = popover?.querySelector('.forecast-chip')
      const popoverChipStyles = getStyles(popoverChip, bgProps)

      return {
        '8_popoverSurface': popoverStyles,
        '9_popoverArrowBefore': arrowBefore,
        '9b_popoverArrowEl': arrowStyles,
        '10_editTrigger': editTriggerStyles,
        '10b_closeBtn': closeBtnStyles,
        '11_popoverReadout': popoverReadoutStyles,
        '12_popoverChip': popoverChipStyles,
        '_popoverFound': !!popover,
        '_editTriggerFound': !!editTrigger,
        '_closeBtnFound': !!closeBtn,
      }
    }, {
      getStylesSrc: `
        if (!el) return null;
        const cs = getComputedStyle(el);
        const result = {};
        for (const p of props) result[p] = cs.getPropertyValue(p);
        return result;
      `,
      getPseudoStylesSrc: `
        if (!el) return null;
        const cs = getComputedStyle(el, pseudo);
        const result = {};
        for (const p of props) result[p] = cs.getPropertyValue(p);
        return result;
      `,
    })

    // ── PHASE 3: Open search panel ──────────────────────────────
    const editBtn = page.locator('[data-location-edit-trigger]')
    await editBtn.click()
    await page.waitForSelector('.selected-location-search', { timeout: 10000 })
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    // Brief wait for animations
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)))

    results.searchPanel = await page.evaluate(({ getStylesSrc }) => {
      const getStyles = new Function('el', 'props', getStylesSrc)

      const bgProps = ['background', 'background-color', 'background-image', 'border', 'border-color', 'border-width', 'box-shadow']
      const textProps = ['color', 'font-family', 'font-size', 'font-weight']

      // 14. Search panel
      const searchPanel = document.querySelector('.selected-location-search')
      const searchPanelStyles = getStyles(searchPanel, bgProps)

      // 15. Search input
      const searchInput = searchPanel?.querySelector('input')
      const searchInputStyles = getStyles(searchInput, [...bgProps, ...textProps, 'border-radius'])

      // 13. Search submit button
      const searchControls = document.querySelector('.selected-location-search__controls')
      const searchSubmitBtn = searchControls?.querySelector('button:not(.secondary)')
      const searchSubmitStyles = getStyles(searchSubmitBtn, [...bgProps, ...textProps])

      // 17. Sidebar
      const sidebar = document.querySelector('.selected-location-search__sidebar')
      const sidebarStyles = getStyles(sidebar, bgProps)

      // 16. Search results / saved results (may not exist yet — need to type something)
      const savedResult = document.querySelector('.selected-location-search__saved-result')
      const savedResultStyles = getStyles(savedResult, bgProps)

      // 18. Use current location
      const currentLocationBtn = document.querySelector('.selected-location-search__result--current')
      const currentLocationStyles = getStyles(currentLocationBtn, bgProps)

      return {
        '14_searchPanel': searchPanelStyles,
        '15_searchInput': searchInputStyles,
        '13_searchSubmit': searchSubmitStyles,
        '17_sidebar': sidebarStyles,
        '16_savedResult': savedResultStyles,
        '18_currentLocation': currentLocationStyles,
        '_searchPanelFound': !!searchPanel,
        '_searchInputFound': !!searchInput,
        '_searchSubmitFound': !!searchSubmitBtn,
        '_sidebarFound': !!sidebar,
        '_savedResultFound': !!savedResult,
      }
    }, {
      getStylesSrc: `
        if (!el) return null;
        const cs = getComputedStyle(el);
        const result = {};
        for (const p of props) result[p] = cs.getPropertyValue(p);
        return result;
      `,
    })

    // ── PHASE 4: Type a search to get search results ────────────
    const searchInput = page.locator('[data-location-search-input]')
    await searchInput.fill('Tokyo')

    // Wait for results
    await page.waitForSelector('.selected-location-search__result', { timeout: 15000 }).catch(() => {})
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)))

    results.searchResults = await page.evaluate(({ getStylesSrc }) => {
      const getStyles = new Function('el', 'props', getStylesSrc)

      const bgProps = ['background', 'background-color', 'background-image', 'border', 'border-color', 'border-width', 'box-shadow']

      const searchResult = document.querySelector('.selected-location-search__result')
      const searchResultStyles = getStyles(searchResult, bgProps)

      return {
        '16_searchResult': searchResultStyles,
        '_searchResultFound': !!searchResult,
      }
    }, {
      getStylesSrc: `
        if (!el) return null;
        const cs = getComputedStyle(el);
        const result = {};
        for (const p of props) result[p] = cs.getPropertyValue(p);
        return result;
      `,
    })

    // Write all results
    const output = JSON.stringify(results, null, 2)
    await writeFile(outPath, output, 'utf-8')
    console.log(output)
    console.log(`\nResults written to: ${outPath}`)
  } finally {
    await page.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
