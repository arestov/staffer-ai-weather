import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ReactSyncScopeHandle } from '../scope/ScopeHandle'
import { getRelShape } from '../shape/autoShapes'
import { useReactScopeRuntime } from './useReactScopeRuntime'

const useMountedRelShape = (scope: ReactSyncScopeHandle | null, relName: string) => {
  const runtime = useReactScopeRuntime()

  useEffect(() => {
    if (!scope) {
      return
    }

    return runtime.mountShape(scope, getRelShape(relName))
  }, [runtime, scope, relName])
}

const useOneScope = (scope: ReactSyncScopeHandle | null, relName: string) => {
  const runtime = useReactScopeRuntime()

  useMountedRelShape(scope, relName)

  return useSyncExternalStore(
    (listener) => (scope ? runtime.subscribeOne(scope, relName, listener) : () => {}),
    () => (scope ? runtime.readOne(scope, relName) : null),
    () => (scope ? runtime.readOne(scope, relName) : null),
  )
}

const noop = () => {}

export const useNamedSessionRouter = (routerName: string) => {
  const runtime = useReactScopeRuntime()

  const rootScope = useSyncExternalStore(
    runtime.subscribeRootScope.bind(runtime),
    runtime.getRootScope.bind(runtime),
    runtime.getRootScope.bind(runtime),
  )

  const routerScope = useOneScope(rootScope, routerName)
  const currentScope = useOneScope(routerScope, 'current_mp_md')

  const routerDispatch = runtime.getDispatch(routerScope)
  const rootDispatch = runtime.getDispatch(rootScope)

  const clearCurrent = useMemo(
    () => (routerScope ? () => routerDispatch('eraseModel') : noop),
    [routerScope, routerDispatch],
  )

  const openResource = useMemo(
    () =>
      rootScope
        ? (contextModelId: string) => {
            if (!contextModelId) return
            rootDispatch('navigateRouterToResource', {
              context_md_id: contextModelId,
              router_name: routerName,
            })
          }
        : noop,
    [rootScope, rootDispatch, routerName],
  )

  return useMemo(
    () => ({
      rootScope,
      routerScope,
      currentScope,
      currentNodeId: currentScope?._nodeId ?? null,
      clearCurrent,
      openResource,
    }),
    [rootScope, routerScope, currentScope, clearCurrent, openResource],
  )
}
