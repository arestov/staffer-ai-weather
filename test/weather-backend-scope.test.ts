import { describe, expect, test, vi } from 'vitest'
import { createScopedWeatherBackendApi, type WeatherBackendApi } from '../src/worker/weather-backend-api'

describe('scoped weather backend api', () => {
  test('binds saved places operations to the provided session key scope', async () => {
    const baseApi: WeatherBackendApi = {
      source_name: 'weatherBackend',
      errors_fields: [],
      lookupLocationSearchCache: vi.fn(async () => ({
        query: 'tokyo',
        results: [],
        cacheStatus: 'miss',
        expiresAt: null,
      })),
      storeLocationSearchCache: vi.fn(async () => {}),
      fetchSavedSearchLocations: vi.fn(async () => []),
      saveSavedSearchLocation: vi.fn(async () => []),
      removeSavedSearchLocation: vi.fn(async () => []),
    }

    const scopedApi = createScopedWeatherBackendApi(baseApi, 'session-alpha')

    await scopedApi.lookupLocationSearchCache('tokyo')
    await scopedApi.storeLocationSearchCache('tokyo', [])
    await scopedApi.fetchSavedSearchLocations()
    await scopedApi.saveSavedSearchLocation({
      id: 'tokyo-1',
      name: 'Tokyo',
      subtitle: 'Tokyo, Japan',
      latitude: 35.6762,
      longitude: 139.6503,
      timezone: 'Asia/Tokyo',
    })
    await scopedApi.removeSavedSearchLocation('tokyo-1')

    expect(baseApi.lookupLocationSearchCache).toHaveBeenCalledWith('tokyo')
    expect(baseApi.storeLocationSearchCache).toHaveBeenCalledWith('tokyo', [])
    expect(baseApi.fetchSavedSearchLocations).toHaveBeenCalledWith('session-alpha')
    expect(baseApi.saveSavedSearchLocation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tokyo-1' }),
      'session-alpha',
    )
    expect(baseApi.removeSavedSearchLocation).toHaveBeenCalledWith('tokyo-1', 'session-alpha')
  })
})