import { useEffect } from 'react'
import { useReactScopeRuntime } from '../../dkt-react-sync/hooks/useReactScopeRuntime'
import { useScope } from '../../dkt-react-sync/hooks/useScope'
import type { DefinedReactShape } from '../shape/defineShape'

export const useShape = (shape: DefinedReactShape | null | undefined) => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()

  useEffect(() => {
    if (!shape || !scope) {
      return
    }

    return runtime.mountShape(scope, shape)
  }, [runtime, scope, shape])
}
