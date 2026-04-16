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
    renderer: 'canvas'
    animationData: unknown
    loop?: boolean
    autoplay?: boolean
    rendererSettings?: {
      canvas?: HTMLCanvasElement | OffscreenCanvas
      clearCanvas?: boolean
      context?: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    }
  }

  interface LottieCanvasWorker {
    loadAnimation(params: LottieCanvasWorkerParams): LottieCanvasWorkerAnimation
  }

  const lottie: LottieCanvasWorker
  export default lottie
}
