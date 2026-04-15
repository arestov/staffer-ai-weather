import { useEffect, useRef } from 'react'
import type LottieCanvasWorker from 'lottie-web/build/player/lottie_canvas_worker'
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
    ).then(
      (mod) => mod.default ?? mod,
    )
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
export function useLottieWeatherIcon(iconName: string | null, size: number) {
  const containerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<LottieAnimation | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !iconName) {
      return
    }

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

    // Create a fresh canvas so transferControlToOffscreen() always works
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    canvas.style.display = 'block'
    container.appendChild(canvas)

    Promise.all([lottiePromise, iconDataPromise])
      .then(([lottie, animationData]) => {
        if (cancelled) {
          return
        }

        animRef.current = lottie.loadAnimation({
          renderer: 'canvas',
          animationData,
          loop: true,
          autoplay: true,
          rendererSettings: {
            canvas,
            clearCanvas: true,
          },
        })
      })
      .catch(() => {
        // Silently fail if lottie worker is unavailable
      })

    return () => {
      cancelled = true
      if (animRef.current) {
        animRef.current.destroy()
        animRef.current = null
      }
      canvas.remove()
    }
  }, [iconName, size])

  return containerRef
}
