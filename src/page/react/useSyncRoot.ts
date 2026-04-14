import { useSyncExternalStore } from 'react'
import type { PageSyncRuntime } from '../../dkt-react-sync/runtime/PageSyncRuntime'

export const useSyncRoot = (runtime: PageSyncRuntime) =>
  useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  )
