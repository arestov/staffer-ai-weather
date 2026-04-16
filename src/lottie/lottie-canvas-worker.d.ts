declare module 'lottie-web/build/player/lottie_canvas_worker' {
  interface LottieCanvasWorkerAnimation {
    destroy(): void
    play(): void
    pause(): void
    stop(): void
    addEventListener(name: 'DOMLoaded', callback: () => void): void
    setSpeed(speed: number): void
    goToAndStop(value: number, isFrame?: boolean): void
    goToAndPlay(value: number, isFrame?: boolean): void
  }

  interface LottieCanvasWorkerParams {
    container?: HTMLElement
    renderer: 'canvas'
    animationData: unknown
    loop?: boolean
    autoplay?: boolean
    rendererSettings?: {
      canvas?: HTMLCanvasElement | OffscreenCanvas
      clearCanvas?: boolean
      context?: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
      dpr?: number
    }
  }

  interface LottieCanvasWorker {
    loadAnimation(params: LottieCanvasWorkerParams): LottieCanvasWorkerAnimation
  }

  const lottie: LottieCanvasWorker
  export default lottie
}

declare module 'lottie-web/build/player/esm/lottie_canvas.min.js' {
  import type LottieCanvasWorker from 'lottie-web/build/player/lottie_canvas_worker'
  const lottie: typeof LottieCanvasWorker
  export default lottie
}
