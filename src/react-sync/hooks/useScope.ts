import { useContext } from 'react'
import { ScopeContext } from '../context/ScopeContext'

export const useScope = () => {
  const scope = useContext(ScopeContext)

  if (!scope) {
    throw new Error('scope is required. render this hook inside RootScope/One/Many')
  }

  return scope
}
