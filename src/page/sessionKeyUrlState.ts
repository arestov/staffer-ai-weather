const SESSION_KEY_HASH_PREFIX = '#/'
const SESSION_KEY_NEW_MARKER = 'new'

export const LAST_SESSION_KEY_STORAGE_KEY = 'weather:last-session-key'

const SESSION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

const defaultGenerateSessionKey = () => {
  const randomUuid = globalThis.crypto?.randomUUID?.()

  if (typeof randomUuid === 'string' && randomUuid) {
    return randomUuid
  }

  return `weather-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

const normalizeHashPath = (hash: string) => {
  if (!hash) {
    return ''
  }

  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  return raw.replace(/^\/+/, '').replace(/\/+$/, '').trim()
}

export const normalizeSessionKey = (value: string | null | undefined) => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  if (!trimmed || trimmed === SESSION_KEY_NEW_MARKER) {
    return null
  }

  return SESSION_KEY_PATTERN.test(trimmed) ? trimmed : null
}

export const buildSessionKeyHash = (sessionKey: string) => {
  return `${SESSION_KEY_HASH_PREFIX}${sessionKey}`
}

export const resolveSessionKeyUrlState = ({
  hash,
  lastSessionKey,
  generateSessionKey = defaultGenerateSessionKey,
}: {
  hash: string
  lastSessionKey?: string | null
  generateSessionKey?: () => string
}) => {
  const path = normalizeHashPath(hash)
  const normalizedLastSessionKey = normalizeSessionKey(lastSessionKey)

  const sessionKey = path && path !== SESSION_KEY_NEW_MARKER ? normalizeSessionKey(path) : null

  if (path === SESSION_KEY_NEW_MARKER) {
    const nextSessionKey = normalizeSessionKey(generateSessionKey())

    if (!nextSessionKey) {
      throw new Error('generated session key is invalid')
    }

    return {
      sessionKey: nextSessionKey,
      canonicalHash: buildSessionKeyHash(nextSessionKey),
      reason: 'new' as const,
      shouldReplace: true,
    }
  }

  if (sessionKey) {
    return {
      sessionKey,
      canonicalHash: buildSessionKeyHash(sessionKey),
      reason: 'hash' as const,
      shouldReplace: hash !== buildSessionKeyHash(sessionKey),
    }
  }

  const fallbackSessionKey = normalizedLastSessionKey ?? normalizeSessionKey(generateSessionKey())

  if (!fallbackSessionKey) {
    throw new Error('failed to resolve fallback session key')
  }

  return {
    sessionKey: fallbackSessionKey,
    canonicalHash: buildSessionKeyHash(fallbackSessionKey),
    reason: normalizedLastSessionKey ? ('storage' as const) : ('generated' as const),
    shouldReplace: true,
  }
}

export const bindSessionKeyUrlState = ({
  onSessionKeyChange,
  targetWindow = window,
  storageKey = LAST_SESSION_KEY_STORAGE_KEY,
  generateSessionKey = defaultGenerateSessionKey,
}: {
  onSessionKeyChange: (sessionKey: string) => void
  targetWindow?: Window
  storageKey?: string
  generateSessionKey?: () => string
}) => {
  let currentSessionKey: string | null = null

  const readStoredSessionKey = () => {
    try {
      return targetWindow.localStorage.getItem(storageKey)
    } catch {
      return null
    }
  }

  const writeStoredSessionKey = (sessionKey: string) => {
    try {
      targetWindow.localStorage.setItem(storageKey, sessionKey)
    } catch {
      // Ignore storage write failures and keep the URL as source of truth.
    }
  }

  const syncSessionKey = () => {
    const resolved = resolveSessionKeyUrlState({
      hash: targetWindow.location.hash,
      lastSessionKey: readStoredSessionKey(),
      generateSessionKey,
    })

    if (resolved.shouldReplace) {
      targetWindow.history.replaceState(null, '', resolved.canonicalHash)
    }

    writeStoredSessionKey(resolved.sessionKey)

    if (resolved.sessionKey !== currentSessionKey) {
      currentSessionKey = resolved.sessionKey
      onSessionKeyChange(resolved.sessionKey)
    }

    return resolved.sessionKey
  }

  const handleHashChange = () => {
    syncSessionKey()
  }

  const sessionKey = syncSessionKey()
  targetWindow.addEventListener('hashchange', handleHashChange)

  return {
    sessionKey,
    destroy() {
      targetWindow.removeEventListener('hashchange', handleHashChange)
    },
  }
}
