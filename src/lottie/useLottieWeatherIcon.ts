import type LottieCanvasWorker from 'lottie-web/build/player/lottie_canvas_worker'
import { useEffect, useRef } from 'react'
import { loadMeteoconData } from './meteoconData'

type LottieModule = typeof LottieCanvasWorker
type LottieAnimation = ReturnType<LottieModule['loadAnimation']>

const canUseLottie = () =>
  typeof window !== 'undefined' && typeof document !== 'undefined'

// Singleton: lazily load the lottie canvas module once
let lottieModulePromise: Promise<LottieModule> | null = null

const getLottieModule = (): Promise<LottieModule> | null => {
  if (!canUseLottie()) {
    return null
  }
  if (!lottieModulePromise) {
    lottieModulePromise = import(
      'lottie-web/build/player/esm/lottie_canvas.min.js'
    ).then((mod) => mod.default ?? mod)
  }
  return lottieModulePromise
}

/**
 * Renders a Lottie weather icon via lottie-web's canvas build.
 *
 * Lottie creates its own canvas inside the wrapper div.
 * Each mount creates a fresh wrapper so the internal canvas state
 * is always clean across React re-renders and icon changes.
 *
 * @param iconName - meteocons icon name (e.g. "clear-day"), or null for nothing
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

    // CSS spinner shown while lottie + icon data load
    const spinner = document.createElement('div')
    spinner.className = 'weather-icon-spinner'
    spinner.style.width = `${size}px`
    spinner.style.height = `${size}px`
    container.appendChild(spinner)

    // Wrapper div that lottie will render its own canvas into
    const wrapper = document.createElement('div')
    wrapper.style.width = `${size}px`
    wrapper.style.height = `${size}px`
    wrapper.style.display = 'block'

    Promise.all([lottiePromise, iconDataPromise])
      .then(([lottie, animationData]) => {
        if (cancelled) {
          return
        }

        spinner.remove()
        container.appendChild(wrapper)

        const anim = lottie.loadAnimation({
          container: wrapper,
          renderer: 'canvas',
          animationData,
          loop: true,
          autoplay: true,
          rendererSettings: {
            clearCanvas: true,
            dpr,
          },
        })
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
      wrapper.remove()
    }
  }, [iconName])

  return containerRef
}
