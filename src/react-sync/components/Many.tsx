import { ScopeContext } from '../context/ScopeContext'
import { useReactScopeRuntime } from '../hooks/useReactScopeRuntime'
import { useShape } from '../hooks/useShape'
import { getRelShape } from '../shape/autoShapes'
import { useScope } from '../hooks/useScope'
import { useSyncExternalStore } from 'react'

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
    (listener) => runtime.subscribeMany(scope, rel, listener),
    () => runtime.readMany(scope, rel),
    () => runtime.readMany(scope, rel),
  )

  if (!items.length) {
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
