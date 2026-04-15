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
 * Renders a Lottie weather icon to a canvas via lottie-web's canvas worker.
 * The internal worker is a module-level singleton — it persists across
 * React mount/unmount cycles (satisfying the "no early worker death" requirement).
 *
 * @param iconName - meteocons icon name (e.g. "clear-day"), or null to show nothing
 * @returns ref to attach to a <canvas> element
 */
export function useLottieWeatherIcon(iconName: string | null) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<LottieAnimation | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !iconName) {
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
        // Silently fail if lottie worker is unavailable (e.g. SSR, test environment)
      })

    return () => {
      cancelled = true
      if (animRef.current) {
        animRef.current.destroy()
        animRef.current = null
      }
    }
  }, [iconName])

  return canvasRef
}
