import { useSyncExternalStore } from 'react'
import { ReactScopeRuntimeContext } from '../context/ReactScopeRuntimeContext'
import { ScopeContext } from '../context/ScopeContext'
import type { ReactScopeRuntime } from '../runtime/ReactScopeRuntime'

export const RootScope = ({
  runtime,
  children,
  fallback = null,
}: {
  runtime: ReactScopeRuntime
  children: React.ReactNode
  fallback?: React.ReactNode
}) => {
  const rootScope = useSyncExternalStore(
    runtime.subscribeRootScope.bind(runtime),
    runtime.getRootScope.bind(runtime),
    runtime.getRootScope.bind(runtime),
  )

  return (
    <ReactScopeRuntimeContext.Provider value={runtime}>
      {rootScope ? (
        <ScopeContext.Provider value={rootScope}>{children}</ScopeContext.Provider>
      ) : (
        fallback
      )}
    </ReactScopeRuntimeContext.Provider>
  )
}
