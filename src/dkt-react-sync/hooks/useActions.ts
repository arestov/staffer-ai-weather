import { useReactScopeRuntime } from '../../dkt-react-sync/hooks/useReactScopeRuntime'
import { useScope } from '../../dkt-react-sync/hooks/useScope'

export const useActions = () => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()

  return runtime.getDispatch(scope)
}



