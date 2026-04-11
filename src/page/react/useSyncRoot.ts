import { useSyncExternalStore } from 'react'
import type { WeatherPageSyncRuntime } from '../createPageSyncReceiverRuntime'

export const useSyncRoot = (runtime: WeatherPageSyncRuntime) =>
  useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  )
