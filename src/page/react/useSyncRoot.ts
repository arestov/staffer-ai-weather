import { useSyncExternalStore } from 'react'
import type { PageSyncRuntime } from '../createPageSyncReceiverRuntime'

export const useSyncRoot = (runtime: PageSyncRuntime) =>
  useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  )
