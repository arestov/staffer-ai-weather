import { merge as mergeDcl } from 'dkt/dcl/merge.js'
import { SelectedLocationPopoverRouter } from './SelectedLocationPopover'

const RootRouter = mergeDcl({
  model_name: 'weather_session_root',
  attrs: {
    sessionKey: ['input', null],
    route: ['input', null],
    closedAt: ['input', null],
    isCommonRoot: ['input', false],
  },
  rels: {
    'router-selectedLocationPopover': ['nest', [SelectedLocationPopoverRouter]],
  },
})

export default RootRouter

