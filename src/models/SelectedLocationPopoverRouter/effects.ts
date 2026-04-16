import { toErrorMessage } from '../weatherFormat'
import { isCurrentLocationRequest, isSearchRequest } from './helpers'

export const popoverRouterEffects = {
  api: {
    locationSearchApi: [
      ['_node_id'] as const,
      ['#locationSearch'] as const,
      (locationSearch: unknown) => locationSearch,
    ],
    geoLocationApi: [
      ['_node_id'] as const,
      ['#geoLocation'] as const,
      (geoLocation: unknown) => geoLocation,
    ],
  },
  in: {
    executeLocationSearch: {
      type: 'state_request',
      name: 'executeLocationSearch',
      states: ['searchResponseData'],
      api: 'locationSearchApi',
      parse: (result: unknown) => ({ searchResponseData: result }),
      fn: [
        ['searchRequest'] as const,
        async (
          api: { search: (query: string) => Promise<unknown> },
          _opts: unknown,
          searchRequest: unknown,
        ) => {
          if (!isSearchRequest(searchRequest)) {
            return { ok: false as const, message: 'Invalid search request' }
          }

          try {
            const results = await api.search(searchRequest.query)
            return {
              ok: true as const,
              requestId: searchRequest.requestId,
              results,
            }
          } catch (error) {
            return {
              ok: false as const,
              requestId: searchRequest.requestId,
              message: toErrorMessage(error),
            }
          }
        },
      ],
    },
    executeCurrentLocationLookup: {
      type: 'state_request',
      name: 'executeCurrentLocationLookup',
      states: ['currentLocationResponseData'],
      api: 'geoLocationApi',
      parse: (result: unknown) => ({ currentLocationResponseData: result }),
      fn: [
        ['currentLocationRequest'] as const,
        async (
          api: {
            detectLocation: () => Promise<unknown>
            detectLocationByCoordinates: (coords: {
              latitude: number
              longitude: number
            }) => Promise<unknown>
          },
          _opts: unknown,
          currentLocationRequest: unknown,
        ) => {
          if (!isCurrentLocationRequest(currentLocationRequest)) {
            return { ok: false as const, message: 'Invalid current location request' }
          }

          try {
            const result =
              currentLocationRequest.kind === 'browserCoordinates'
                ? await api.detectLocationByCoordinates({
                    latitude: currentLocationRequest.latitude,
                    longitude: currentLocationRequest.longitude,
                  })
                : await api.detectLocation()
            return {
              ok: true as const,
              requestId: currentLocationRequest.requestId,
              result,
            }
          } catch (error) {
            return {
              ok: false as const,
              requestId: currentLocationRequest.requestId,
              message: toErrorMessage(error),
            }
          }
        },
      ],
    },
  },
  out: {
    triggerLocationSearch: {
      api: ['self', 'locationSearchApi'],
      trigger: ['searchRequest'],
      require: ['searchRequest'],
      create_when: {
        api_inits: true,
      },
      fn: (self: {
        resetRequestedState: (name: string) => unknown
        input: (callback: () => void) => unknown
        requestState: (name: string) => unknown
      }) => {
        self.resetRequestedState('searchResponseData')
        self.input(() => {
          self.requestState('searchResponseData')
        })
      },
    },
    applySearchResponseData: {
      api: ['self'],
      trigger: ['searchResponseData'],
      require: ['searchResponseData'],
      create_when: {
        api_inits: true,
      },
      is_async: true,
      fn: [
        ['searchResponseData'] as const,
        async (
          self: { dispatch: (actionName: string, payload?: unknown) => Promise<void> | void },
          _task: unknown,
          searchResponseData: unknown,
        ) => {
          const result = searchResponseData as {
            ok: boolean
            requestId?: number
            results?: unknown[]
            message?: string
          }
          if (result.ok) {
            await self.dispatch('applyLocationSearchResponse', {
              requestId: result.requestId,
              results: result.results,
            })
          } else if (result.requestId != null) {
            await self.dispatch('failLocationSearchResponse', {
              requestId: result.requestId,
              message: result.message,
            })
          }
        },
      ],
    },
    triggerCurrentLocationLookup: {
      api: ['self', 'geoLocationApi'],
      trigger: ['currentLocationRequest'],
      require: ['currentLocationRequest'],
      create_when: {
        api_inits: true,
      },
      fn: (self: {
        resetRequestedState: (name: string) => unknown
        input: (callback: () => void) => unknown
        requestState: (name: string) => unknown
      }) => {
        self.resetRequestedState('currentLocationResponseData')
        self.input(() => {
          self.requestState('currentLocationResponseData')
        })
      },
    },
    applyCurrentLocationResult: {
      api: ['self'],
      trigger: ['currentLocationResponseData'],
      require: ['currentLocationResponseData'],
      create_when: {
        api_inits: true,
      },
      is_async: true,
      fn: [
        ['currentLocationResponseData'] as const,
        async (
          self: { dispatch: (actionName: string, payload?: unknown) => Promise<void> | void },
          _task: unknown,
          currentLocationResponseData: unknown,
        ) => {
          const result = currentLocationResponseData as {
            ok: boolean
            requestId?: number
            result?: unknown
            message?: string
          }
          if (result.ok) {
            await self.dispatch('applyCurrentLocationLookupResponse', {
              requestId: result.requestId,
              result: result.result,
            })
          } else if (result.requestId != null) {
            await self.dispatch('failCurrentLocationLookupResponse', {
              requestId: result.requestId,
              message: result.message,
            })
          }
        },
      ],
    },
  },
}
