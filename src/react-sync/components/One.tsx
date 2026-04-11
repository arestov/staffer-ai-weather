import { useSyncExternalStore } from 'react'
import { ScopeContext } from '../context/ScopeContext'
import { useReactScopeRuntime } from '../hooks/useReactScopeRuntime'
import { useShape } from '../hooks/useShape'
import { getRelShape } from '../shape/autoShapes'
import { useScope } from '../hooks/useScope'

export const One = ({
  rel,
  children,
  fallback = null,
}: {
  rel: string
  children: React.ReactNode
  fallback?: React.ReactNode
}) => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()
  const shape = getRelShape(rel)

  useShape(shape)

  const childScope = useSyncExternalStore(
    (listener) => runtime.subscribeOne(scope, rel, listener),
    () => runtime.readOne(scope, rel),
    () => runtime.readOne(scope, rel),
  )

  if (!childScope) {
    return <>{fallback}</>
  }

  return <ScopeContext.Provider value={childScope}>{children}</ScopeContext.Provider>
}
