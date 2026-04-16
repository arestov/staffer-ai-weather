import type LottieCanvasWorker from 'lottie-web/build/player/lottie_canvas_worker'
import { useEffect, useRef } from 'react'
import { loadMeteoconData } from './meteoconData'

type LottieModule = typeof LottieCanvasWorker
type LottieAnimation = ReturnType<LottieModule['loadAnimation']>

const canUseLottieWorker = () =>
  typeof window !== 'undefined' &&
  typeof URL !== 'undefined' &&
  typeof URL.createObjectURL === 'function' &&
  typeof Worker !== 'undefined'

// Singleton: lazily load the lottie canvas worker module once
let lottieModulePromise: Promise<LottieModule> | null = null

const getLottieModule = (): Promise<LottieModule> | null => {
  if (!canUseLottieWorker()) {
    return null
  }
  if (!lottieModulePromise) {
    lottieModulePromise = import(
      // @ts-expect-error — CJS module resolved by Vite
      'lottie-web/build/player/lottie_canvas_worker.js'
    ).then((mod) => mod.default ?? mod)
  }
  return lottieModulePromise
}

/**
 * Renders a Lottie weather icon via lottie-web's canvas worker build.
 *
 * The lottie_canvas_worker build calls canvas.transferControlToOffscreen()
 * which can only be performed once per canvas element. To handle React
 * re-renders and icon changes, we create a fresh <canvas> imperatively
 * each time and append it into a container div managed by React.
 *
 * The internal web worker is a module-level singleton that persists across
 * mount/unmount cycles.
 *
 * @param iconName - meteocons icon name (e.g. "clear-day"), or null for nothing
 * @param size - CSS pixel size of the icon
 * @returns ref to attach to a container element (div)
 */
const DEFAULT_ICON_SIZE = 48

export function useLottieWeatherIcon(iconName: string | null) {
  const containerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<LottieAnimation | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !iconName) {
      return
    }

    const computed = getComputedStyle(container)
    const cssSize = Number(computed.getPropertyValue('--weather-icon-size'))
    const size = cssSize || container.clientWidth || DEFAULT_ICON_SIZE
    const speed = Number(computed.getPropertyValue('--weather-icon-speed')) || 1

    const lottiePromise = getLottieModule()
    if (!lottiePromise) {
      return
    }

    const iconDataPromise = loadMeteoconData(iconName)
    if (!iconDataPromise) {
      return
    }

    let cancelled = false
    const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1
    const pxW = Math.round(size * dpr)
    const pxH = Math.round(size * dpr)

    // CSS spinner shown while lottie + icon data load
    const spinner = document.createElement('div')
    spinner.className = 'weather-icon-spinner'
    spinner.style.width = `${size}px`
    spinner.style.height = `${size}px`
    container.appendChild(spinner)

    // Create a fresh canvas so transferControlToOffscreen() always works
    const canvas = document.createElement('canvas')
    canvas.width = pxW
    canvas.height = pxH
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    canvas.style.display = 'block'

    Promise.all([lottiePromise, iconDataPromise])
      .then(([lottie, animationData]) => {
        if (cancelled) {
          return
        }

        spinner.remove()
        container.appendChild(canvas)

        const anim = lottie.loadAnimation({
          renderer: 'canvas',
          animationData,
          loop: true,
          autoplay: true,
          rendererSettings: {
            canvas,
            clearCanvas: true,
          },
        })
        // In the canvas_worker build, loadAnimation() sends the `load`
        // message to the worker asynchronously (microtask).  Calling
        // setSpeed() synchronously posts the message *before* `load`,
        // so the worker silently drops it.  Deferring to DOMLoaded
        // guarantees the animation exists in the worker.
        if (speed !== 1) {
          anim.addEventListener('DOMLoaded', () => {
            if (!cancelled) anim.setSpeed(speed)
          })
        }
        animRef.current = anim
      })
      .catch(() => {})

    return () => {
      cancelled = true
      if (animRef.current) {
        animRef.current.destroy()
        animRef.current = null
      }
      spinner.remove()
      canvas.remove()
    }
  }, [iconName])

  return containerRef
}
