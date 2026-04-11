import { useSyncExternalStore } from 'react'
import type { WeatherPageSyncRuntime } from '../createPageSyncReceiverRuntime'

export const useModelAttrs = (
  runtime: WeatherPageSyncRuntime,
  attrNames: string[],
) =>
  useSyncExternalStore(
    (listener) => runtime.subscribeRootAttrs(attrNames, listener),
    () => runtime.getRootAttrs(attrNames),
    () => runtime.getRootAttrs(attrNames),
  )
