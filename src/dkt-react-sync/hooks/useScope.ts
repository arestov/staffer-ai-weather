import { useContext } from 'react'
import { ScopeContext } from '../../dkt-react-sync/context/ScopeContext'

export const useScope = () => {
  return useContext(ScopeContext)
}
