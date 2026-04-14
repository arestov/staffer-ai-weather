import { model } from 'dkt/model.js'

const makeParentRel = () => [
  'comp',
  ['<<<< ^'],
  (parent: unknown) => parent,
  { linking: '<<<< ^' },
] as const

export const SelectedLocation = model({
  model_name: 'weather_selected_location',
  rels: {
    weatherLocation: ['input', { linking: '<< weatherLocation << #' }],
    nav_parent_at_perspectivator_weather_selected_location_popover_router:
      makeParentRel(),
  },
  actions: {
    replaceWeatherLocation: {
      to: {
        weatherLocation: ['<< weatherLocation', { action: 'replaceLocation', inline_subwalker: true }],
      },
      fn: (payload: unknown) => ({
        weatherLocation: payload,
      }),
    },
  },
})
