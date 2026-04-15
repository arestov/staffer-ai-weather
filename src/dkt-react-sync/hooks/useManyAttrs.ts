import { useMemo, useEffect, useState, useRef } from 'react'
import { useReactScopeRuntime } from './useReactScopeRuntime'
import { useScope } from './useScope'
import { useShape } from './useShape'
import { defineShape } from '../shape/defineShape'

const EMPTY_DATA: readonly Record<string, unknown>[] = Object.freeze([])

/**
 * Read attrs from all items in a many-relation.
 *
 * Combines subscribeMany (list membership) with subscribeAttrs (per-item attr
 * values) so the parent component re-renders when either the item list or any
 * individual item's attrs change.
 */
export const useManyAttrs = (
  rel: string,
  fields: readonly string[],
): readonly Record<string, unknown>[] => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()
  const fieldsKey = fields.join('\x00')

  const nestedShape = useMemo(
    () => defineShape({ many: { [rel]: defineShape({ attrs: fields }) } }),
    [rel, fieldsKey],
  )
  useShape(nestedShape)

  const [data, setData] = useState<readonly Record<string, unknown>[]>(EMPTY_DATA)
  const itemCleanupsRef = useRef(new Map<string, () => void>())

  useEffect(() => {
    if (!scope) {
      setData(EMPTY_DATA)
      return
    }

    const readAll = () => {
      const items = runtime.readMany(scope, rel)
      setData(items.map((item) => runtime.readAttrs(item, fields)))

      const currentIds = new Set(items.map((i) => i._nodeId))
      const cleanups = itemCleanupsRef.current

      for (const [id, cleanup] of cleanups) {
        if (!currentIds.has(id)) {
          cleanup()
          cleanups.delete(id)
        }
      }

      for (const item of items) {
        if (!cleanups.has(item._nodeId)) {
          cleanups.set(item._nodeId, runtime.subscribeAttrs(item, fields, readAll))
        }
      }
    }

    const cleanupList = runtime.subscribeMany(scope, rel, readAll)
    readAll()

    return () => {
      cleanupList()
      for (const cleanup of itemCleanupsRef.current.values()) cleanup()
      itemCleanupsRef.current.clear()
    }
  }, [runtime, scope, rel, fieldsKey])

  return data
}
