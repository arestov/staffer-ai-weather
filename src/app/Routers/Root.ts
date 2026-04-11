const RootRouter = {
  model_name: 'weather_session_root',
  attrs: {
    sessionKey: ['input', null] as const,
    route: ['input', null] as const,
    closedAt: ['input', null] as const,
    isCommonRoot: ['input', false] as const,
  },
}

export default RootRouter
