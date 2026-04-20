import { createTaggedRequestError } from '../requestTaggedError'
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
            return null
          }

          try {
            const results = await api.search(searchRequest.query)
            return {
              requestId: searchRequest.requestId,
              results,
            }
          } catch (error) {
            throw createTaggedRequestError(searchRequest.requestId, error)
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
            return null
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
              requestId: currentLocationRequest.requestId,
              result,
            }
          } catch (error) {
            throw createTaggedRequestError(currentLocationRequest.requestId, error)
          }
        },
      ],
    },
  },
} as const
