export const APP_MSG = {
  CONTROL_BOOTSTRAP_MODEL: 'control:bootstrap-model',
  CONTROL_BOOTSTRAP_SESSION: 'control:bootstrap-session',
  CONTROL_CLOSE_SESSION: 'control:close-session',
  CONTROL_DISPATCH_APP_ACTION: 'control:dispatch-app-action',
  CONTROL_SET_LOCATION: 'control:set-location',
  CONTROL_REFRESH_WEATHER: 'control:refresh-weather',

  MODEL_BOOTED: 'model:booted',
  SESSION_BOOTED: 'session:booted',
  RUNTIME_LOG: 'runtime:log',
  RUNTIME_ERROR: 'runtime:error',
  RUNTIME_READY: 'runtime:ready',
  WEATHER_LOAD_STATE: 'weather:load-state',

  SYNC_HANDLE: 'sync:handle',
  SYNC_RPC: 'sync:rpc',
  SYNC_UPDATE_STRUCTURE_USAGE: 'sync:update-structure-usage',
  SYNC_REQUIRE_SHAPE: 'sync:require-shape',
} as const

export const RUNTIME_LOG_SCOPE = Object.freeze({
  SHARED_WORKER: 'shared-worker',
  PAGE_RUNTIME: 'page-runtime',
} as const)

export type ReactSyncControlBootstrapModelMessage = {
  type: typeof APP_MSG.CONTROL_BOOTSTRAP_MODEL
}

export type ReactSyncControlBootstrapSessionMessage = {
  type: typeof APP_MSG.CONTROL_BOOTSTRAP_SESSION
  session_id?: string
  session_key?: string
  route?: unknown
}

export type ReactSyncControlCloseSessionMessage = {
  type: typeof APP_MSG.CONTROL_CLOSE_SESSION
  session_id?: string | null
}

export type ReactSyncControlDispatchAppActionMessage = {
  type: typeof APP_MSG.CONTROL_DISPATCH_APP_ACTION
  action_name: string
  payload?: unknown
  scope_node_id?: string | null
}

export type ReactSyncControlSetLocationMessage = {
  type: typeof APP_MSG.CONTROL_SET_LOCATION
  payload?: unknown
  scope_node_id?: string | null
}

export type ReactSyncControlRefreshWeatherMessage = {
  type: typeof APP_MSG.CONTROL_REFRESH_WEATHER
  payload?: unknown
  scope_node_id?: string | null
}

export type ReactSyncModelBootedMessage = {
  type: typeof APP_MSG.MODEL_BOOTED
  session_id?: string | null
  root_node_id?: string | null
}

export type ReactSyncSessionBootedMessage = {
  type: typeof APP_MSG.SESSION_BOOTED
  session_id: string
  session_key: string
  root_node_id: string
}

export type ReactSyncRuntimeLogMessage = {
  type: typeof APP_MSG.RUNTIME_LOG
  scope: string
  message: string
}

export type ReactSyncRuntimeErrorMessage = {
  type: typeof APP_MSG.RUNTIME_ERROR
  message: unknown
}

export type ReactSyncRuntimeReadyMessage = {
  type: typeof APP_MSG.RUNTIME_READY
}

export type ReactSyncWeatherLoadStateMessage = {
  type: typeof APP_MSG.WEATHER_LOAD_STATE
  status: string
  error: string | null
}

export type ReactSyncSyncHandleMessage = {
  type: typeof APP_MSG.SYNC_HANDLE
  sync_type: number
  payload: unknown
}

export type ReactSyncSyncRpcMessage = {
  type: typeof APP_MSG.SYNC_RPC
  node_id: string
  args: unknown[]
}

export type ReactSyncSyncUpdateStructureUsageMessage = {
  type: typeof APP_MSG.SYNC_UPDATE_STRUCTURE_USAGE
  data: unknown
}

export type ReactSyncSyncRequireShapeMessage = {
  type: typeof APP_MSG.SYNC_REQUIRE_SHAPE
  data: unknown
}

export type ReactSyncTransportMessage =
  | ReactSyncControlBootstrapModelMessage
  | ReactSyncControlBootstrapSessionMessage
  | ReactSyncControlCloseSessionMessage
  | ReactSyncControlDispatchAppActionMessage
  | ReactSyncControlSetLocationMessage
  | ReactSyncControlRefreshWeatherMessage
  | ReactSyncModelBootedMessage
  | ReactSyncSessionBootedMessage
  | ReactSyncRuntimeLogMessage
  | ReactSyncRuntimeErrorMessage
  | ReactSyncRuntimeReadyMessage
  | ReactSyncWeatherLoadStateMessage
  | ReactSyncSyncHandleMessage
  | ReactSyncSyncRpcMessage
  | ReactSyncSyncUpdateStructureUsageMessage
  | ReactSyncSyncRequireShapeMessage
