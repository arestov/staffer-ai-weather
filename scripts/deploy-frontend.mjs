import { spawn } from 'node:child_process'
import process from 'node:process'

const isWindows = process.platform === 'win32'
const backendUrl =
  process.env.WEATHER_BACKEND_URL?.trim() || 'https://weather-backend.gleb-arestov.workers.dev'
const signalUrl = process.env.P2P_SIGNAL_URL?.trim() || backendUrl.replace(/^http/, 'ws')
const pagesProjectName = process.env.PAGES_PROJECT_NAME?.trim() || 'weather-app-root'
const pagesBranch = process.env.PAGES_BRANCH?.trim() || 'main'

const run = (command, args, env = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...env,
      },
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`))
    })
  })

const runOnPlatform = async (command, args, env = {}) => {
  if (isWindows) {
    await run('cmd.exe', ['/c', command, ...args], env)
    return
  }

  await run(command, args, env)
}

await runOnPlatform('npm', ['run', 'build'], {
  VITE_WEATHER_BACKEND_URL: backendUrl,
  VITE_P2P_SIGNAL_URL: signalUrl,
})

await runOnPlatform('npm', [
  'exec',
  '--yes',
  'wrangler',
  '--',
  'pages',
  'deploy',
  'dist',
  '--project-name',
  pagesProjectName,
  '--branch',
  pagesBranch,
])
