import { useSyncExternalStore } from 'react'
import type { PageSyncRuntime } from '../createPageSyncReceiverRuntime'

export const useModelAttrs = (
  runtime: PageSyncRuntime,
  attrNames: string[],
) =>
  useSyncExternalStore(
    (listener) => runtime.subscribeRootAttrs(attrNames, listener),
    () => runtime.getRootAttrs(attrNames),
    () => runtime.getRootAttrs(attrNames),
  )
