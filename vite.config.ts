import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const dktRoot = fileURLToPath(new URL('../tmp/dkt', import.meta.url))
const dktRootDirect = fileURLToPath(new URL('../dkt/js', import.meta.url))
const dktProvodaRootDirect = fileURLToPath(
  new URL('../dkt/js/libs/provoda/provoda', import.meta.url),
)

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['lottie-web/build/player/lottie_canvas_worker.js'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.WEATHER_BACKEND_PROXY_TARGET ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      dkt: dktProvodaRootDirect,
      'dkt-all': dktRootDirect,
    },
  },
})
