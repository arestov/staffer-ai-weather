import { spawn } from 'node:child_process'
import process from 'node:process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const backendUrl = process.env.WEATHER_BACKEND_URL?.trim() || 'http://127.0.0.1:8787'

const backend = spawn(npmCommand, ['--prefix', 'weather-backend', 'run', 'dev'], {
  stdio: 'inherit',
  env: process.env,
})

const frontend = spawn(npmCommand, ['run', 'dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_WEATHER_BACKEND_URL: backendUrl,
  },
})

let shuttingDown = false

const shutdown = (signal) => {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  backend.kill(signal)
  frontend.kill(signal)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

const exitWhenDone = (code) => {
  if (shuttingDown) {
    return
  }

  shutdown('SIGTERM')
  process.exit(code ?? 0)
}

backend.on('exit', exitWhenDone)
frontend.on('exit', exitWhenDone)