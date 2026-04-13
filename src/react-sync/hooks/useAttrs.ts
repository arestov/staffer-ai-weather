import { useSyncExternalStore } from 'react'
import { getAttrsShape } from '../shape/autoShapes'
import { useReactScopeRuntime } from './useReactScopeRuntime'
import { useShape } from './useShape'
import { useScope } from './useScope'

const normalizeFields = (fields: readonly string[]) =>
  Array.from(new Set(fields)).sort()

export const useAttrs = (fields: readonly string[]) => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()
  const normalizedFields = normalizeFields(fields)
  const shape = getAttrsShape(normalizedFields)
  const resolvedScope = scope ?? runtime.getRootScope()

  if (!resolvedScope) {
    throw new Error('react sync scope is required. render inside RootScope')
  }

  useShape(shape)

  return useSyncExternalStore(
    (listener) => runtime.subscribeAttrs(resolvedScope, normalizedFields, listener),
    () => runtime.readAttrs(resolvedScope, normalizedFields),
    () => runtime.readAttrs(resolvedScope, normalizedFields),
  )
}
