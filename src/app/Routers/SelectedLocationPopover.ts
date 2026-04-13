import { input as inputAttrs } from 'dkt/dcl/attrs/input.js'
import { model } from 'dkt/model.js'
import { Router as RouterCore } from 'dkt-all/models/Router.js'

export const SelectedLocationPopoverRouter = model({
  extends: RouterCore,
  model_name: 'weather_selected_location_popover_router',
  is_simple_router: true,
  attrs: {
    ...inputAttrs({
      url_part: null,
      full_page_need: null,
      works_without_main_resident: true,
    }),
  },
})
