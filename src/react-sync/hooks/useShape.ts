import { useEffect } from 'react'
import type { DefinedReactShape } from '../shape/defineShape'
import { useReactScopeRuntime } from './useReactScopeRuntime'
import { useScope } from '../../dkt-react-sync/hooks/useScope'

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


