import { model } from 'dkt/model.js'
import { isLocationSearchResult } from './WeatherLocation'
import {
  WEATHER_LOCATION_BASE_CREATION_SHAPE,
  WEATHER_LOCATION_REPLACEMENT_CREATION_SHAPE,
} from './weatherSeed'

const makeParentRel = () =>
  ['comp', ['<<<< ^'], (parent: unknown) => parent, { linking: '<<<< ^' }] as const

const WEATHER_LOCATION_REF_ID = 'new_weather_location'

export const SelectedLocation = model({
  model_name: 'weather_selected_location',
  attrs: {
    isAutoSelected: ['input', false],
  },
  rels: {
    weatherLocation: ['input', { linking: '<< weatherLocation << #' }],
    nav_parent_at_perspectivator_weather_selected_location_popover_router: makeParentRel(),
  },
  actions: {
    replaceWeatherLocation: [
      {
        to: {
          isAutoSelected: ['isAutoSelected'],
          _createWeatherLocation: [
            '<< weatherLocation << #',
            {
              method: 'at_end',
              can_create: true,
              can_hold_refs: true,
              creation_shape: WEATHER_LOCATION_REPLACEMENT_CREATION_SHAPE,
            },
          ],
          weatherLocation: [
            '<< weatherLocation',
            {
              method: 'set_one',
              can_use_refs: true,
            },
          ],
        },
        fn: (payload: unknown) => {
          if (!isLocationSearchResult(payload)) {
            return {}
          }
          return {
            isAutoSelected: false,
            _createWeatherLocation: {
              attrs: {
                name: payload.name,
                latitude: payload.latitude,
                longitude: payload.longitude,
                timezone: payload.timezone,
                loadStatus: 'loading',
              },
              hold_ref_id: WEATHER_LOCATION_REF_ID,
            },
            weatherLocation: { use_ref_id: WEATHER_LOCATION_REF_ID },
          }
        },
      },
      {
        to: {
          _fxWeather: ['< $fx_weatherData < weatherLocation', { intent: 'request' }],
        },
        fn: () => ({
          _fxWeather: {},
        }),
      },
    ],
    applyAutoLocation: [
      {
        to: {
          _createWeatherLocation: [
            '<< weatherLocation << #',
            {
              method: 'at_end',
              can_create: true,
              can_hold_refs: true,
              creation_shape: WEATHER_LOCATION_BASE_CREATION_SHAPE,
            },
          ],
          weatherLocation: [
            '<< weatherLocation',
            {
              method: 'set_one',
              can_use_refs: true,
            },
          ],
        },
        fn: (payload: unknown) => {
          if (!isLocationSearchResult(payload)) {
            return {}
          }
          return {
            _createWeatherLocation: {
              attrs: {
                name: payload.name,
                latitude: payload.latitude,
                longitude: payload.longitude,
                timezone: payload.timezone,
              },
              hold_ref_id: WEATHER_LOCATION_REF_ID,
            },
            weatherLocation: { use_ref_id: WEATHER_LOCATION_REF_ID },
          }
        },
      },
      {
        to: {
          _fxWeather: ['< $fx_weatherData < weatherLocation', { intent: 'request' }],
        },
        fn: () => ({
          _fxWeather: {},
        }),
      },
    ],
  },
})
