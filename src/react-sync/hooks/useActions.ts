import { useReactScopeRuntime } from './useReactScopeRuntime'
import { useScope } from './useScope'

export const useActions = () => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()

  return {
    dispatch(actionName: string, payload?: unknown) {
      runtime.dispatch(actionName, payload, scope)
    },
  }
}
