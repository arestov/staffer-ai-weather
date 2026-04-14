import { createContext } from 'react'
import type { ReactScopeRuntime } from '../../react-sync/runtime/ReactScopeRuntime'

export const ReactScopeRuntimeContext = createContext<ReactScopeRuntime | null>(
  null,
)

