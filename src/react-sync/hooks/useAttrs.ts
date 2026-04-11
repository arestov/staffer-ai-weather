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

  useShape(shape)

  return useSyncExternalStore(
    (listener) => runtime.subscribeAttrs(scope, normalizedFields, listener),
    () => runtime.readAttrs(scope, normalizedFields),
    () => runtime.readAttrs(scope, normalizedFields),
  )
}
