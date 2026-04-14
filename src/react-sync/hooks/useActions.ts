import { useReactScopeRuntime } from './useReactScopeRuntime'
import { useScope } from '../../dkt-react-sync/hooks/useScope'

export const useActions = () => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()

  return {
    dispatch(actionName: string, payload?: unknown) {
      runtime.dispatch(actionName, payload, scope)
    },
  }
}


