import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createGeoLocationApi,
  detectAutoLocation,
  fetchCountryIs,
  fetchOpenMeteoGeocoding,
} from '../src/worker/geo-location-api'

const berlinGeocodingResult = {
  id: 2950159,
  name: 'Berlin',
  latitude: 52.52437,
  longitude: 13.41053,
  timezone: 'Europe/Berlin',
  country: 'Germany',
  country_code: 'DE',
  admin1: 'Land Berlin',
}

const makeJsonResponse = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
})

describe('geo-location-api', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchCountryIs', () => {
    test('returns ip and country from country.is', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse({ ip: '1.2.3.4', country: 'DE' })))

      const result = await fetchCountryIs()

      expect(result).toEqual({ ip: '1.2.3.4', country: 'DE' })
      expect(fetch).toHaveBeenCalledWith('https://api.country.is/')
    })

    test('throws when country.is returns non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse(null, false, 503)))

      await expect(fetchCountryIs()).rejects.toThrow('country.is responded with 503')
    })
  })

  describe('fetchOpenMeteoGeocoding', () => {
    test('returns a LocationSearchResult for the first geocoding hit', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(makeJsonResponse({ results: [berlinGeocodingResult] })),
      )

      const result = await fetchOpenMeteoGeocoding('Berlin')

      expect(result).toEqual({
        id: '2950159',
        name: 'Berlin',
        subtitle: 'Land Berlin, Germany',
        latitude: 52.52437,
        longitude: 13.41053,
        timezone: 'Europe/Berlin',
      })
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('geocoding-api.open-meteo.com'))
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('name=Berlin'))
    })

    test('omits missing admin1 from subtitle', async () => {
      const resultWithoutAdmin1 = { ...berlinGeocodingResult, admin1: undefined }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(makeJsonResponse({ results: [resultWithoutAdmin1] })),
      )

      const result = await fetchOpenMeteoGeocoding('Berlin')

      expect(result.subtitle).toBe('Germany')
    })

    test('throws when geocoding returns an empty list', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse({ results: [] })))

      await expect(fetchOpenMeteoGeocoding('Unknown')).rejects.toThrow(
        'No geocoding results found',
      )
    })

    test('throws when Open-Meteo geocoding returns non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse(null, false, 422)))

      await expect(fetchOpenMeteoGeocoding('Berlin')).rejects.toThrow(
        'Open-Meteo geocoding responded with 422',
      )
    })
  })

  describe('detectLocationByCoordinates', () => {
    test('returns coordinate-only location without additional network requests', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const geoApi = createGeoLocationApi()
      const result = await geoApi.detectLocationByCoordinates({ latitude: 52.52, longitude: 13.4 })

      expect(result).toEqual({
        id: 'coords-52.5200-13.4000',
        name: '',
        subtitle: '',
        latitude: 52.52,
        longitude: 13.4,
        timezone: null,
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('detectAutoLocation', () => {
    test('uses country.is country code to select a geocoding query', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeJsonResponse({ ip: '1.2.3.4', country: 'DE' }))
        .mockResolvedValueOnce(makeJsonResponse({ results: [berlinGeocodingResult] }))

      vi.stubGlobal('fetch', fetchMock)

      const result = await detectAutoLocation()

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.country.is/')
      expect(fetchMock.mock.calls[1][0]).toContain('name=Berlin')
      expect(result.name).toBe('Berlin')
      expect(result.timezone).toBe('Europe/Berlin')
    })

    test('falls back to country code as query when code is not in the map', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeJsonResponse({ ip: '9.9.9.9', country: 'XX' }))
        .mockResolvedValueOnce(makeJsonResponse({ results: [{ ...berlinGeocodingResult, name: 'XX' }] }))

      vi.stubGlobal('fetch', fetchMock)

      await detectAutoLocation()

      expect(fetchMock.mock.calls[1][0]).toContain('name=XX')
    })

    test('propagates error when country.is fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse(null, false, 500)))

      await expect(detectAutoLocation()).rejects.toThrow('country.is responded with 500')
    })

    test('propagates error when no geocoding results found', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeJsonResponse({ ip: '1.2.3.4', country: 'DE' }))
        .mockResolvedValueOnce(makeJsonResponse({ results: [] }))

      vi.stubGlobal('fetch', fetchMock)

      await expect(detectAutoLocation()).rejects.toThrow('No geocoding results found')
    })
  })
})
