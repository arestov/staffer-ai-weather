import { afterEach, describe, expect, test, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act, createElement } from 'react'
import { ReactScopeRuntimeContext } from '../src/dkt-react-sync/context/ReactScopeRuntimeContext'
import { ScopeContext } from '../src/dkt-react-sync/context/ScopeContext'
import { useManyAttrs } from '../src/dkt-react-sync/hooks/useManyAttrs'
import type { ReactScopeRuntime } from '../src/dkt-react-sync/runtime/ReactScopeRuntime'
import type { ReactSyncScopeHandle } from '../src/dkt-react-sync/scope/ScopeHandle'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const rootScope: ReactSyncScopeHandle = { kind: 'scope', _nodeId: 'root' }
const itemA: ReactSyncScopeHandle = { kind: 'scope', _nodeId: 'item-a' }
const itemB: ReactSyncScopeHandle = { kind: 'scope', _nodeId: 'item-b' }

type Listener = () => void

function createMockRuntime() {
  const manyListeners = new Set<Listener>()
  const attrListenersByNode = new Map<string, Set<Listener>>()
  let items: readonly ReactSyncScopeHandle[] = []
  const attrStore = new Map<string, Record<string, unknown>>()

  const runtime: ReactScopeRuntime = {
    getRootScope: () => rootScope,
    subscribeRootScope: () => () => {},

    readAttrs: (_scope, _attrNames) => {
      return { ...(attrStore.get(_scope._nodeId) ?? {}) }
    },
    subscribeAttrs: (scope, _attrNames, listener) => {
      let set = attrListenersByNode.get(scope._nodeId)
      if (!set) {
        set = new Set()
        attrListenersByNode.set(scope._nodeId, set)
      }
      set.add(listener)
      return () => {
        set!.delete(listener)
      }
    },

    readOne: () => null,
    subscribeOne: () => () => {},

    readMany: () => items,
    subscribeMany: (_scope, _rel, listener) => {
      manyListeners.add(listener)
      return () => {
        manyListeners.delete(listener)
      }
    },

    mountShape: () => () => {},
    dispatch: () => {},
  }

  return {
    runtime,
    /** Replace the item list and notify list subscribers. */
    setItems(newItems: readonly ReactSyncScopeHandle[]) {
      items = newItems
      for (const listener of manyListeners) listener()
    },
    /** Update attrs for a node and notify its attr subscribers. */
    setAttrs(nodeId: string, attrs: Record<string, unknown>) {
      attrStore.set(nodeId, { ...(attrStore.get(nodeId) ?? {}), ...attrs })
      const set = attrListenersByNode.get(nodeId)
      if (set) for (const listener of set) listener()
    },
  }
}

/** Captures the return value of useManyAttrs for assertions. */
let captured: readonly Record<string, unknown>[] = []

function TestComponent({ rel, fields }: { rel: string; fields: readonly string[] }) {
  const data = useManyAttrs(rel, fields)
  captured = data
  return createElement('div', { 'data-testid': 'count' }, data.length)
}

// ---------------------------------------------------------------------------
// test suite
// ---------------------------------------------------------------------------

describe('useManyAttrs hook', () => {
  let container: HTMLDivElement
  let root: Root

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    captured = []
  })

  function renderHook(
    runtime: ReactScopeRuntime,
    rel = 'items',
    fields: readonly string[] = ['name', 'value'],
  ) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => {
      root.render(
        createElement(
          ReactScopeRuntimeContext.Provider,
          { value: runtime },
          createElement(
            ScopeContext.Provider,
            { value: rootScope },
            createElement(TestComponent, { rel, fields }),
          ),
        ),
      )
    })
  }

  test('returns empty array when no items in the relation', () => {
    const { runtime } = createMockRuntime()
    renderHook(runtime)
    expect(captured).toEqual([])
  })

  test('returns attrs for items already present', () => {
    const mock = createMockRuntime()
    mock.setItems([itemA, itemB])
    mock.setAttrs('item-a', { name: 'Alpha', value: 1 })
    mock.setAttrs('item-b', { name: 'Beta', value: 2 })

    renderHook(mock.runtime)
    expect(captured).toEqual([
      { name: 'Alpha', value: 1 },
      { name: 'Beta', value: 2 },
    ])
  })

  test('re-renders when the item list changes', () => {
    const mock = createMockRuntime()
    renderHook(mock.runtime)
    expect(captured).toEqual([])

    // Add items
    mock.setAttrs('item-a', { name: 'Alpha', value: 10 })
    act(() => mock.setItems([itemA]))

    expect(captured).toEqual([{ name: 'Alpha', value: 10 }])
  })

  test('re-renders when an item attr changes (subscribeAttrs)', () => {
    const mock = createMockRuntime()
    mock.setItems([itemA])
    mock.setAttrs('item-a', { name: 'Alpha', value: 1 })

    renderHook(mock.runtime)
    expect(captured).toEqual([{ name: 'Alpha', value: 1 }])

    // Update attrs — this fires subscribeAttrs, NOT subscribeMany
    act(() => mock.setAttrs('item-a', { name: 'Alpha', value: 99 }))

    expect(captured).toEqual([{ name: 'Alpha', value: 99 }])
  })

  test('cleans up attr subscriptions when items are removed', () => {
    const mock = createMockRuntime()
    mock.setItems([itemA, itemB])
    mock.setAttrs('item-a', { name: 'A', value: 1 })
    mock.setAttrs('item-b', { name: 'B', value: 2 })

    const unsubSpy = vi.fn()
    const origSubscribeAttrs = mock.runtime.subscribeAttrs.bind(mock.runtime)
    mock.runtime.subscribeAttrs = (scope, attrNames, listener) => {
      const unsub = origSubscribeAttrs(scope, attrNames, listener)
      if (scope._nodeId === 'item-b') {
        return () => {
          unsubSpy()
          unsub()
        }
      }
      return unsub
    }

    renderHook(mock.runtime)
    expect(captured.length).toBe(2)

    // Remove itemB from the list
    act(() => mock.setItems([itemA]))

    expect(captured.length).toBe(1)
    expect(unsubSpy).toHaveBeenCalled()
  })
})
