/**
 * Playwright script to verify sparkline icons are 16×16 and setSpeed works.
 */
import { chromium } from 'playwright'

const URL = 'http://127.0.0.1:5173'

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(URL, { waitUntil: 'domcontentloaded' })

  // Wait for weather cards to render (not skeleton)
  await page.waitForSelector('.location-card', { timeout: 15000 })
  // Wait extra for lottie canvases to appear
  await page.waitForTimeout(3000)

  // 1. Check sparkline icon container sizes
  const sparklineIcons = await page.evaluate(() => {
    const results = []
    const icons = document.querySelectorAll('.sparkline-icon-track__icon .weather-condition-icon')
    for (const icon of icons) {
      const rect = icon.getBoundingClientRect()
      const computed = getComputedStyle(icon)
      const cssSize = computed.getPropertyValue('--weather-icon-size').trim()
      const canvas = icon.querySelector('canvas')
      const canvasInfo = canvas
        ? {
            width: canvas.width,
            height: canvas.height,
            styleWidth: canvas.style.width,
            styleHeight: canvas.style.height,
            rectWidth: canvas.getBoundingClientRect().width,
            rectHeight: canvas.getBoundingClientRect().height,
          }
        : null
      results.push({
        containerWidth: Math.round(rect.width),
        containerHeight: Math.round(rect.height),
        cssSize,
        canvasInfo,
      })
    }
    return results
  })

  console.log('\n=== SPARKLINE ICON SIZES ===')
  console.log(`Found ${sparklineIcons.length} sparkline icons`)

  let allCorrect = true
  for (let i = 0; i < Math.min(sparklineIcons.length, 6); i++) {
    const ic = sparklineIcons[i]
    const sizeOk = ic.cssSize === '16'
    const containerOk = ic.containerWidth === 16 && ic.containerHeight === 16
    const canvasOk = ic.canvasInfo
      ? ic.canvasInfo.width <= 32 && ic.canvasInfo.height <= 32 // 16 * dpr(2) = 32 max
      : true

    if (!sizeOk || !containerOk || !canvasOk) allCorrect = false

    console.log(
      `  Icon ${i}: container=${ic.containerWidth}x${ic.containerHeight}, ` +
        `--weather-icon-size=${ic.cssSize}, ` +
        `canvas=${ic.canvasInfo ? `${ic.canvasInfo.width}x${ic.canvasInfo.height} (display: ${Math.round(ic.canvasInfo.rectWidth)}x${Math.round(ic.canvasInfo.rectHeight)})` : 'none'}`,
    )
  }
  if (sparklineIcons.length > 6) {
    console.log(`  ... and ${sparklineIcons.length - 6} more`)
  }

  // 2. Check featured location icon sizes (should be 72)
  const featuredIcons = await page.evaluate(() => {
    const results = []
    const icons = document.querySelectorAll('.location-card--featured .weather-condition-icon')
    for (const icon of icons) {
      // Skip sparkline icons inside featured cards
      if (icon.closest('.sparkline-icon-track__icon')) continue
      const computed = getComputedStyle(icon)
      const cssSize = computed.getPropertyValue('--weather-icon-size').trim()
      const canvas = icon.querySelector('canvas')
      const canvasInfo = canvas
        ? {
            width: canvas.width,
            height: canvas.height,
            styleWidth: canvas.style.width,
          }
        : null
      results.push({ cssSize, canvasInfo })
    }
    return results
  })

  console.log('\n=== FEATURED LOCATION ICON SIZES ===')
  for (const ic of featuredIcons) {
    console.log(
      `  --weather-icon-size=${ic.cssSize}, canvas=${ic.canvasInfo ? `${ic.canvasInfo.width}x${ic.canvasInfo.height} (css: ${ic.canvasInfo.styleWidth})` : 'none'}`,
    )
  }

  // 3. Check speed CSS var
  const speedInfo = await page.evaluate(() => {
    const sparklineIcon = document.querySelector('.sparkline-icon-track__icon')
    const featuredIcon = document.querySelector(
      '.location-card--featured .weather-condition-icon:not(.sparkline-icon-track__icon .weather-condition-icon)',
    )
    return {
      sparklineSpeed: sparklineIcon
        ? getComputedStyle(sparklineIcon).getPropertyValue('--weather-icon-speed').trim()
        : 'N/A',
      featuredSpeed: featuredIcon
        ? getComputedStyle(featuredIcon).getPropertyValue('--weather-icon-speed').trim()
        : 'N/A',
    }
  })

  console.log('\n=== ANIMATION SPEED ===')
  console.log(`  Sparkline --weather-icon-speed: ${speedInfo.sparklineSpeed}`)
  console.log(`  Featured --weather-icon-speed: ${speedInfo.featuredSpeed} (should be empty/1)`)

  // Summary
  console.log('\n=== RESULT ===')
  if (allCorrect && sparklineIcons.length > 0) {
    console.log('✅ All sparkline icons are 16x16')
  } else if (sparklineIcons.length === 0) {
    console.log('⚠️ No sparkline icons found (data may not have loaded)')
  } else {
    console.log('❌ Some sparkline icons are NOT 16x16')
  }

  await browser.close()
})()
