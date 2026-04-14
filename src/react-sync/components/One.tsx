import { useSyncExternalStore } from 'react'
import { ScopeContext } from '../../dkt-react-sync/context/ScopeContext'
import { useReactScopeRuntime } from '../../dkt-react-sync/hooks/useReactScopeRuntime'
import { useShape } from '../../dkt-react-sync/hooks/useShape'
import { getRelShape } from '../shape/autoShapes'
import { useScope } from '../../dkt-react-sync/hooks/useScope'

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
    (listener) => (scope ? runtime.subscribeOne(scope, rel, listener) : () => {}),
    () => (scope ? runtime.readOne(scope, rel) : null),
    () => (scope ? runtime.readOne(scope, rel) : null),
  )

  if (!scope || !childScope) {
    return <>{fallback}</>
  }

  return <ScopeContext.Provider value={childScope}>{children}</ScopeContext.Provider>
}




