import { ScopeContext } from '../../dkt-react-sync/context/ScopeContext'
import { useReactScopeRuntime } from '../../dkt-react-sync/hooks/useReactScopeRuntime'
import { useShape } from '../../dkt-react-sync/hooks/useShape'
import { getRelShape } from '../shape/autoShapes'
import { useScope } from '../../dkt-react-sync/hooks/useScope'
import { useSyncExternalStore } from 'react'

const EMPTY_ITEMS = Object.freeze([]) as readonly []

export const Many = ({
  rel,
  item: Item,
  empty = null,
  limit,
}: {
  rel: string
  item: React.ComponentType
  empty?: React.ReactNode
  limit?: number
}) => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()
  const shape = getRelShape(rel)

  useShape(shape)

  const items = useSyncExternalStore(
    (listener) => (scope ? runtime.subscribeMany(scope, rel, listener) : () => {}),
    () => (scope ? runtime.readMany(scope, rel) : EMPTY_ITEMS),
    () => (scope ? runtime.readMany(scope, rel) : EMPTY_ITEMS),
  )

  const visibleItems =
    typeof limit === 'number' ? items.slice(0, Math.max(0, limit)) : items

  if (!scope || !visibleItems.length) {
    return <>{empty}</>
  }

  return (
    <>
      {visibleItems.map((itemScope) => (
        <ScopeContext.Provider key={itemScope._nodeId} value={itemScope}>
          <Item />
        </ScopeContext.Provider>
      ))}
    </>
  )
}




