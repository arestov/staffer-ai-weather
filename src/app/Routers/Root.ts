import { merge as mergeDcl } from 'dkt/dcl/merge.js'

const RootRouter = mergeDcl({
  model_name: 'weather_session_root',
  attrs: {
    sessionKey: ['input', null],
    route: ['input', null],
    closedAt: ['input', null],
    isCommonRoot: ['input', false],
  },
})

export default RootRouter
