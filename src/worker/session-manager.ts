type SessionEntry = {
  sessionId: string
  sessionRoot: any
  streamIds: Set<string>
  lastSeenAt: number
  status: 'active' | 'closing'
}

type ConnectionEntry = {
  streamId: string
  transport: {
    send(message: unknown, transfer_list?: Transferable[]): void
    destroy(): void
  }
  connectedAt: number
}

const createSessionId = () =>
  `weather-session-${Math.random().toString(36).slice(2)}`

export const createSessionManager = ({
  cleanupDelayMs = 30_000,
}: {
  cleanupDelayMs?: number
} = {}) => {
  const sessionsById = new Map<string, SessionEntry>()
  const sessionIdByStreamId = new Map<string, string>()
  const connectionsByStreamId = new Map<string, ConnectionEntry>()
  const cleanupTimersBySessionId = new Map<string, ReturnType<typeof setTimeout>>()

  const cancelCleanup = (sessionId: string) => {
    const timer = cleanupTimersBySessionId.get(sessionId)
    if (!timer) {
      return
    }

    clearTimeout(timer)
    cleanupTimersBySessionId.delete(sessionId)
  }

  const scheduleCleanup = (
    sessionId: string,
    onDestroy: (entry: SessionEntry) => void,
  ) => {
    cancelCleanup(sessionId)

    cleanupTimersBySessionId.set(
      sessionId,
      setTimeout(() => {
        cleanupTimersBySessionId.delete(sessionId)
        const entry = sessionsById.get(sessionId)
        if (!entry || entry.streamIds.size > 0) {
          return
        }

        sessionsById.delete(sessionId)
        onDestroy(entry)
      }, cleanupDelayMs),
    )
  }

  return {
    registerConnection(connection: ConnectionEntry) {
      connectionsByStreamId.set(connection.streamId, connection)
    },
    ensureSession(
      sessionRootFactory: (sessionId: string) => Promise<any>,
      requestedSessionId?: string | null,
    ) {
      return (async () => {
        const sessionId =
          requestedSessionId && sessionsById.has(requestedSessionId)
            ? requestedSessionId
            : createSessionId()

        const existing = sessionsById.get(sessionId)
        if (existing) {
          existing.status = 'active'
          existing.lastSeenAt = Date.now()
          cancelCleanup(sessionId)
          return existing
        }

        const sessionRoot = await sessionRootFactory(sessionId)
        const entry: SessionEntry = {
          sessionId,
          sessionRoot,
          streamIds: new Set(),
          lastSeenAt: Date.now(),
          status: 'active',
        }

        sessionsById.set(sessionId, entry)

        return entry
      })()
    },
    attachStream(sessionId: string, streamId: string) {
      const session = sessionsById.get(sessionId)
      if (!session) {
        throw new Error(`session "${sessionId}" is missing`)
      }

      cancelCleanup(sessionId)
      session.status = 'active'
      session.lastSeenAt = Date.now()
      session.streamIds.add(streamId)
      sessionIdByStreamId.set(streamId, sessionId)

      return session
    },
    detachStream(
      streamId: string,
      onDestroy: (entry: SessionEntry) => void,
    ) {
      const sessionId = sessionIdByStreamId.get(streamId)
      sessionIdByStreamId.delete(streamId)
      connectionsByStreamId.delete(streamId)

      if (!sessionId) {
        return null
      }

      const session = sessionsById.get(sessionId)
      if (!session) {
        return null
      }

      session.streamIds.delete(streamId)
      session.lastSeenAt = Date.now()

      if (!session.streamIds.size) {
        session.status = 'closing'
        scheduleCleanup(sessionId, onDestroy)
      }

      return session
    },
    getSessionByStreamId(streamId: string) {
      const sessionId = sessionIdByStreamId.get(streamId)
      return sessionId ? sessionsById.get(sessionId) ?? null : null
    },
    destroySession(sessionId: string) {
      cancelCleanup(sessionId)
      const session = sessionsById.get(sessionId)
      if (!session) {
        return null
      }

      sessionsById.delete(sessionId)

      for (const streamId of session.streamIds) {
        sessionIdByStreamId.delete(streamId)
        connectionsByStreamId.delete(streamId)
      }

      return session
    },
  }
}
