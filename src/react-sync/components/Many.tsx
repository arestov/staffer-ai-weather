import { ScopeContext } from '../context/ScopeContext'
import { useReactScopeRuntime } from '../hooks/useReactScopeRuntime'
import { useShape } from '../hooks/useShape'
import { getRelShape } from '../shape/autoShapes'
import { useScope } from '../hooks/useScope'
import { useSyncExternalStore } from 'react'

const EMPTY_ITEMS = Object.freeze([]) as readonly []

export const Many = ({
  rel,
  item: Item,
  empty = null,
}: {
  rel: string
  item: React.ComponentType
  empty?: React.ReactNode
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

  if (!scope || !items.length) {
    return <>{empty}</>
  }

  return (
    <>
      {items.map((itemScope) => (
        <ScopeContext.Provider key={itemScope._nodeId} value={itemScope}>
          <Item />
        </ScopeContext.Provider>
      ))}
    </>
  )
}
