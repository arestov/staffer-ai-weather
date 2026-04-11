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

  SYNC_HANDLE: 'sync:handle',
  SYNC_RPC: 'sync:rpc',
  SYNC_UPDATE_STRUCTURE_USAGE: 'sync:update-structure-usage',
  SYNC_REQUIRE_SHAPE: 'sync:require-shape',
} as const

export const RUNTIME_LOG_SCOPE = Object.freeze({
  SHARED_WORKER: 'shared-worker',
  PAGE_RUNTIME: 'page-runtime',
} as const)
