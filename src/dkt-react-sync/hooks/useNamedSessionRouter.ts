import { useEffect, useSyncExternalStore } from 'react'
import { useReactScopeRuntime } from './useReactScopeRuntime'
import type { ReactSyncScopeHandle } from '../scope/ScopeHandle'
import { getRelShape } from '../shape/autoShapes'

const useMountedRelShape = (
  scope: ReactSyncScopeHandle | null,
  relName: string,
) => {
  const runtime = useReactScopeRuntime()

  useEffect(() => {
    if (!scope) {
      return
    }

    return runtime.mountShape(scope, getRelShape(relName))
  }, [runtime, scope, relName])
}

const useOneScope = (
  scope: ReactSyncScopeHandle | null,
  relName: string,
) => {
  const runtime = useReactScopeRuntime()

  useMountedRelShape(scope, relName)

  return useSyncExternalStore(
    (listener) =>
      scope ? runtime.subscribeOne(scope, relName, listener) : () => {},
    () => (scope ? runtime.readOne(scope, relName) : null),
    () => (scope ? runtime.readOne(scope, relName) : null),
  )
}

export const useNamedSessionRouter = (routerName: string) => {
  const runtime = useReactScopeRuntime()

  const rootScope = useSyncExternalStore(
    runtime.subscribeRootScope.bind(runtime),
    runtime.getRootScope.bind(runtime),
    runtime.getRootScope.bind(runtime),
  )

  const routerScope = useOneScope(rootScope, routerName)
  const currentScope = useOneScope(routerScope, 'current_mp_md')

  return {
    rootScope,
    routerScope,
    currentScope,
    currentNodeId: currentScope?._nodeId ?? null,
    clearCurrent() {
      if (!routerScope) {
        return
      }

      runtime.dispatch('eraseModel', undefined, routerScope)
    },
    openResource(contextModelId: string) {
      if (!rootScope || !contextModelId) {
        return
      }

      runtime.dispatch(
        'navigateRouterToResource',
        {
          context_md_id: contextModelId,
          router_name: routerName,
        },
        rootScope,
      )
    },
  }
}



