import { chromium } from 'playwright'

const previewBaseUrl = process.env.WEATHER_PLAYWRIGHT_URL || 'http://127.0.0.1:4173'

const pick = (items, names) =>
  Object.fromEntries(names.map((name) => [name, items.find((item) => item.name === name)?.value ?? null]))

const main = async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  try {
    await page.goto(previewBaseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-selected-location-trigger]')
    await page.click('[data-selected-location-trigger]')
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')

    const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
    const targets = [
      ['.app-shell', ['display', 'position', 'anchor-name', 'top', 'left', 'width', 'height']],
      [
        '[data-selected-location-popover-layer]',
        ['display', 'position', 'position-anchor', 'top', 'left', 'width', 'height', 'z-index', 'inset-top', 'inset-left'],
      ],
      [
        '[data-selected-location-popover]',
        ['display', 'position', 'top', 'left', 'width', 'height', 'transform'],
      ],
      [
        '[data-selected-location-trigger][data-popover-anchor="active"]',
        ['display', 'position', 'anchor-name', 'top', 'left', 'width', 'height'],
      ],
    ]

    for (const [selector, names] of targets) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })

      if (!nodeId) {
        console.log(JSON.stringify({ selector, found: false }, null, 2))
        continue
      }

      const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', { nodeId })
      const { matchedCSSRules } = await cdp.send('CSS.getMatchedStylesForNode', { nodeId })

      console.log(
        JSON.stringify(
          {
            selector,
            found: true,
            computed: pick(computedStyle, names),
            matchedRules: matchedCSSRules.slice(0, 8).map(({ rule }) => ({
              selector: rule.selectorList?.selectors?.map((entry) => entry.text).join(', ') ?? '',
              origin: rule.origin,
              style: rule.style.cssText,
            })),
          },
          null,
          2,
        ),
      )
    }

    const arrowMetrics = await page.$eval(
      '[data-selected-location-popover]',
      (element) => {
        const style = getComputedStyle(element, '::before')

        return {
          top: style.top,
          left: style.left,
          position: style.position,
          transform: style.transform,
          width: style.width,
          height: style.height,
        }
      },
    )

    console.log(JSON.stringify({ selector: '::before', computed: arrowMetrics }, null, 2))
  } finally {
    await page.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})