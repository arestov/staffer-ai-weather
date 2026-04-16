import { useContext } from 'react'
import { ReactScopeRuntimeContext } from '../../dkt-react-sync/context/ReactScopeRuntimeContext'

export const useReactScopeRuntime = () => {
  const runtime = useContext(ReactScopeRuntimeContext)

  if (!runtime) {
    throw new Error('react sync runtime is required. render inside RootScope')
  }

  return runtime
}
