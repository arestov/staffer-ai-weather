import { describe, expect, test } from 'vitest'
import { createPageSyncReceiverRuntime } from '../src/page/createPageSyncReceiverRuntime'
import {
  buildSessionKeyHash,
  normalizeSessionKey,
  resolveSessionKeyUrlState,
} from '../src/page/sessionKeyUrlState'
import { APP_MSG } from '../src/shared/messageTypes'

describe('session key url state', () => {
  test('generates a session key when hash is empty', () => {
    const resolved = resolveSessionKeyUrlState({
      hash: '',
      lastSessionKey: null,
      generateSessionKey: () => 'generated-key',
    })

    expect(resolved.sessionKey).toBe('generated-key')
    expect(resolved.canonicalHash).toBe('#/generated-key')
    expect(resolved.reason).toBe('generated')
    expect(resolved.shouldReplace).toBe(true)
  })

  test('reuses the last stored session key when hash is empty', () => {
    const resolved = resolveSessionKeyUrlState({
      hash: '#/',
      lastSessionKey: 'remembered-key',
      generateSessionKey: () => 'generated-key',
    })

    expect(resolved.sessionKey).toBe('remembered-key')
    expect(resolved.canonicalHash).toBe('#/remembered-key')
    expect(resolved.reason).toBe('storage')
    expect(resolved.shouldReplace).toBe(true)
  })

  test('creates a fresh session key for #/new', () => {
    const resolved = resolveSessionKeyUrlState({
      hash: '#/new',
      lastSessionKey: 'remembered-key',
      generateSessionKey: () => 'fresh-key',
    })

    expect(resolved.sessionKey).toBe('fresh-key')
    expect(resolved.canonicalHash).toBe('#/fresh-key')
    expect(resolved.reason).toBe('new')
    expect(resolved.shouldReplace).toBe(true)
  })

  test('keeps a canonical existing hash session key', () => {
    const resolved = resolveSessionKeyUrlState({
      hash: buildSessionKeyHash('linked-key'),
      lastSessionKey: 'remembered-key',
      generateSessionKey: () => 'generated-key',
    })

    expect(resolved.sessionKey).toBe('linked-key')
    expect(resolved.canonicalHash).toBe('#/linked-key')
    expect(resolved.reason).toBe('hash')
    expect(resolved.shouldReplace).toBe(false)
  })

  test('normalizes only valid public session keys', () => {
    expect(normalizeSessionKey('alpha-1')).toBe('alpha-1')
    expect(normalizeSessionKey('  /alpha_1/  ')).toBe('alpha_1')
    expect(normalizeSessionKey('new')).toBe(null)
    expect(normalizeSessionKey('bad key')).toBe(null)
  })
})

describe('page runtime bootstrap transport', () => {
  test('sends session_key in bootstrap control message', () => {
    const sent: unknown[] = []
    const runtime = createPageSyncReceiverRuntime({
      transport: {
        send(message) {
          sent.push(message)
        },
        listen() {
          return () => {}
        },
        destroy() {},
      },
    })

    runtime.bootstrap({
      sessionId: 'worker-session-1',
      sessionKey: 'public-key-1',
      route: { hash: '#/public-key-1' },
    })

    expect(sent).toEqual([
      {
        type: APP_MSG.CONTROL_BOOTSTRAP_SESSION,
        session_id: 'worker-session-1',
        session_key: 'public-key-1',
        route: { hash: '#/public-key-1' },
      },
    ])

    runtime.destroy()
  })
})
