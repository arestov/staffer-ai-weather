import type { ReactNode } from 'react'
import { useShape } from '../../dkt-react-sync/hooks/useShape'
import type { DefinedReactShape } from '../../dkt-react-sync/shape/defineShape'

export const MountedShape = ({
  shape,
  children,
}: {
  shape: DefinedReactShape
  children: ReactNode
}) => {
  useShape(shape)

  return <>{children}</>
}


