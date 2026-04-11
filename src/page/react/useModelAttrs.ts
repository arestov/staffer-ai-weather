import { useSyncRoot } from './useSyncRoot'
import type { WeatherPageSyncRuntime } from '../createPageSyncReceiverRuntime'

export const useModelAttrs = (
  runtime: WeatherPageSyncRuntime,
  attr_names: string[],
) => {
  const snapshot = useSyncRoot(runtime)
  const result: Record<string, unknown> = {}

  for (let i = 0; i < attr_names.length; i += 1) {
    const name = attr_names[i]
    result[name] = snapshot[name as keyof typeof snapshot]
  }

  return result
}
