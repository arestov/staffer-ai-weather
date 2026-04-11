import { view } from 'dkt/view.js'
import { SessionRootView } from 'dkt-all/views/SessionRootView.js'

export const BlankAppRootView = view({
  extends: SessionRootView,
  view_name: 'WeatherBlankAppRootView',
})
