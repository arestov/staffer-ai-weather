import { spawn, spawnSync } from 'node:child_process'
import process from 'node:process'

const isWindows = process.platform === 'win32'
const backendUrl = process.env.WEATHER_BACKEND_URL?.trim() || 'http://127.0.0.1:8787'

const spawnOptions = (extraEnv = {}) => ({
  stdio: 'inherit',
  detached: true,
  windowsHide: true,
  env: {
    ...process.env,
    ...extraEnv,
  },
})

const spawnNpm = (args, extraEnv = {}) => {
  if (isWindows) {
    return spawn('cmd.exe', ['/c', 'npm', ...args], spawnOptions(extraEnv))
  }

  return spawn('npm', args, spawnOptions(extraEnv))
}

const killProcessTree = (childProcess, signal = 'SIGTERM') => {
  if (!childProcess?.pid) {
    return
  }

  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(childProcess.pid), '/T', '/F'], {
      stdio: 'ignore',
    })
    return
  }

  try {
    process.kill(-childProcess.pid, signal)
  } catch {
    try {
      childProcess.kill(signal)
    } catch {
      // Ignore cleanup errors when the child already exited.
    }
  }
}

const backend = spawnNpm(['--prefix', 'weather-backend', 'run', 'dev'])

const frontend = spawnNpm(['run', 'dev'], {
  VITE_WEATHER_BACKEND_URL: backendUrl,
  VITE_P2P_SIGNAL_URL: backendUrl.replace(/^http/, 'ws'),
})

let shuttingDown = false

const shutdown = (signal) => {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  killProcessTree(backend, signal)
  killProcessTree(frontend, signal)
}

process.on('SIGINT', () => {
  shutdown('SIGINT')
  process.exit(0)
})
process.on('SIGTERM', () => {
  shutdown('SIGTERM')
  process.exit(0)
})
process.on('SIGHUP', () => {
  shutdown('SIGHUP')
  process.exit(0)
})
process.on('exit', () => shutdown('SIGTERM'))

const exitWhenDone = (code) => {
  if (shuttingDown) {
    return
  }

  shutdown('SIGTERM')
  process.exit(code ?? 0)
}

backend.on('exit', exitWhenDone)
frontend.on('exit', exitWhenDone)
