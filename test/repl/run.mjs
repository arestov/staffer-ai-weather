import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import { rolldown } from 'rolldown'

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const weatherRoot = path.join(repoRoot, 'weather')
const entryFile = path.join(weatherRoot, 'test/repl/bootstrap.tsx')
const outDir = path.join(weatherRoot, 'test/repl/.repl-dist')
const outFile = path.join(outDir, 'bootstrap.mjs')

const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const shouldReport = process.env.WEATHER_REPL_REPORT === '1'
const dumpGraph = process.env.WEATHER_REPL_DUMP_GRAPH === '1'
const dumpMessages = process.env.WEATHER_REPL_DUMP_MESSAGES === '1'

const externalPackages = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
])

const isExternal = (id) =>
  externalPackages.has(id) ||
  id.startsWith('node:') ||
  id === 'fs' ||
  id === 'path' ||
  id === 'url' ||
  id === 'util'

const resolveDktAlias = (source) => {
  if (source === 'dkt') {
    return path.join(repoRoot, 'dkt/js/libs/provoda/provoda')
  }

  if (source.startsWith('dkt/')) {
    return path.join(repoRoot, 'dkt/js/libs/provoda/provoda', source.slice(4))
  }

  if (source === 'dkt-all') {
    return path.join(repoRoot, 'dkt/js')
  }

  if (source.startsWith('dkt-all/')) {
    return path.join(repoRoot, 'dkt/js', source.slice(8))
  }

  return null
}

const aliasPlugin = {
  name: 'weather-repl-alias',
  resolveId(source) {
    const resolved = resolveDktAlias(source)
    if (!resolved) {
      return null
    }

    return resolved
  },
}

const installDomGlobals = (window) => {
  const defineGlobal = (name, value) => {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    })
  }

  defineGlobal('window', window)
  defineGlobal('self', window)
  defineGlobal('document', window.document)
  defineGlobal('navigator', window.navigator)
  defineGlobal('location', window.location)
  defineGlobal('history', window.history)
  defineGlobal('HTMLElement', window.HTMLElement)
  defineGlobal('Element', window.Element)
  defineGlobal('Node', window.Node)
  defineGlobal('Text', window.Text)
  defineGlobal('Comment', window.Comment)
  defineGlobal('MutationObserver', window.MutationObserver)
  defineGlobal('DOMRect', window.DOMRect)
  defineGlobal('Event', window.Event)
  defineGlobal('CustomEvent', window.CustomEvent)
  defineGlobal('KeyboardEvent', window.KeyboardEvent)
  defineGlobal('MouseEvent', window.MouseEvent)
  defineGlobal('FocusEvent', window.FocusEvent)
  defineGlobal('getComputedStyle', window.getComputedStyle.bind(window))
  defineGlobal('requestAnimationFrame', window.requestAnimationFrame.bind(window))
  defineGlobal('cancelAnimationFrame', window.cancelAnimationFrame.bind(window))
}

const createBundle = async () => {
  await mkdir(outDir, { recursive: true })

  const bundle = await rolldown({
    input: entryFile,
    cwd: repoRoot,
    external: isExternal,
    plugins: [aliasPlugin],
  })

  try {
    await bundle.write({
      file: outFile,
      format: 'esm',
      sourcemap: 'inline',
    })
  } finally {
    await bundle.close()
  }

  return outFile
}

const summarizeGraph = (graph) => {
  if (!graph || typeof graph !== 'object') {
    return graph
  }

  const summary = {}

  if (Array.isArray(graph.nodes)) {
    summary.nodes = graph.nodes.map((node) => ({
      nodeId: node.nodeId,
      modelName: node.modelName,
      relNames: node.rels ? Object.keys(node.rels) : [],
      attrsVersion: node.attrsVersion,
      relsVersion: node.relsVersion,
    }))
  }

  if (graph.models && typeof graph.models === 'object') {
    summary.models = Object.fromEntries(
      Object.entries(graph.models).map(([modelName, model]) => [
        modelName,
        {
          attrsCount: Array.isArray(model.attrs) ? model.attrs.length : undefined,
          relNames: Array.isArray(model.rels) ? model.rels.map((rel) => rel.name) : undefined,
        },
      ]),
    )
  }

  return summary
}

const summarizeAppState = (models) => {
  if (!models || typeof models !== 'object') {
    return models
  }

  const preferredAttrs = new Set([
    'location',
    'status',
    'temperatureText',
    'summary',
    'updatedAt',
    'name',
    'label',
    'loadStatus',
    'lastError',
    'weatherFetchedAt',
    'latitude',
    'longitude',
    'temperatureC',
    'weatherCode',
  ])

  const summarizeList = (list) => {
    if (!Array.isArray(list)) {
      return list
    }

    return list.map((model) => ({
      nodeId: model.nodeId,
      modelName: model.modelName,
      attrs: model.attrs
        ? Object.fromEntries(
            Object.entries(model.attrs).filter(([name]) => preferredAttrs.has(name)),
          )
        : {},
      rels: model.rels,
    }))
  }

  return {
    lined: summarizeList(models.lined),
    runtimeModels: summarizeList(models.runtimeModels),
  }
}

const logJsonSection = (label, value) => {
  console.log(`[weather-repl] ${label}`, JSON.stringify(value, null, 2))
}

const logTextSection = (label, value) => {
  console.log(`[weather-repl] ${label}`, value)
}

const main = async () => {
  const bundleFile = await createBundle()

  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    {
      pretendToBeVisual: true,
      url: 'http://localhost/',
    },
  )

  installDomGlobals(dom.window)

  const { createWeatherReplHarness } = await import(pathToFileURL(bundleFile).href)
  const rootElement = dom.window.document.getElementById('root')

  if (!rootElement) {
    throw new Error('missing #root element in jsdom')
  }

  const harness = await createWeatherReplHarness({
    window: dom.window,
    rootElement,
  })

  const postReadyWaitMs = Number(process.env.WEATHER_REPL_POST_READY_WAIT_MS || 2000)

  try {
    await harness.whenReady()
    await wait(postReadyWaitMs)

    if (shouldReport) {
      const snapshot = harness.pageRuntime.getSnapshot()
      const appState = await harness.appRuntime.debugDumpAppState()
      const graph = harness.pageRuntime.debugDumpGraph()
      const messages = harness.pageRuntime.debugMessages()
      const bodyHtml = rootElement.innerHTML

      logJsonSection('snapshot', snapshot)
      logJsonSection('app state', summarizeAppState(appState))
      logTextSection('body', bodyHtml)
      logJsonSection('messages', messages.slice(-10))
      logJsonSection('graph summary', summarizeGraph(graph))

      if (dumpMessages) {
        logJsonSection('messages:full', messages)
      }

      if (dumpGraph) {
        logJsonSection('graph:full', graph)
      }
    }
  } finally {
    harness.destroy()
  }
}

main().catch((error) => {
  console.error('[weather-repl] failed')
  console.error(error)
  process.exitCode = 1
})
