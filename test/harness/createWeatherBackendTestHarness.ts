import { vi } from 'vitest'
import type { LocationSearchResult } from '../../src/app/rels/location-models'
import backendWorker, {
  SavedPlacesDurableObject,
  SearchCacheDurableObject,
} from '../../weather-backend/src/index'
import type {
  DurableObjectNamespaceLike,
  DurableObjectStateLike,
  DurableObjectStorageLike,
  WorkerEnv,
} from '../../weather-backend/src/contracts'

type SearchFixture = {
  results?: LocationSearchResult[]
  status?: number
}

type DurableObjectInstance = {
  fetch(request: Request): Promise<Response>
}

class MemoryStorage implements DurableObjectStorageLike {
  private readonly values = new Map<string, unknown>()

  async get<T = unknown>(key: string) {
    return this.values.get(key) as T | undefined
  }

  async put<T = unknown>(key: string, value: T) {
    this.values.set(key, value)
  }

  async delete(key: string) {
    return this.values.delete(key)
  }
}

class MemoryState implements DurableObjectStateLike {
  readonly storage = new MemoryStorage()

  async blockConcurrencyWhile<T>(callback: () => Promise<T>) {
    return await callback()
  }
}

class FakeDurableObjectNamespace<TEnv>
  implements DurableObjectNamespaceLike {
  private readonly instances = new Map<string, DurableObjectInstance>()

  constructor(
    private readonly createInstance: (
      state: DurableObjectStateLike,
      env: TEnv,
    ) => DurableObjectInstance,
    private readonly getEnv: () => TEnv,
  ) {}

  idFromName(name: string) {
    return name
  }

  get(id: string) {
    let instance = this.instances.get(id)

    if (!instance) {
      instance = this.createInstance(new MemoryState(), this.getEnv())
      this.instances.set(id, instance)
    }

    return {
      fetch: async (request: Request | string) => {
        const nextRequest = typeof request === 'string'
          ? new Request(request)
          : request

        return instance.fetch(nextRequest)
      },
    }
  }
}

const normalizeQuery = (query: string) => query.trim().toLowerCase()

const toOpenMeteoPayload = (results: LocationSearchResult[]) => ({
  results: results.map((result) => ({
    name: result.name,
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone ?? undefined,
    admin1: result.subtitle || undefined,
  })),
})

export type WeatherBackendTestHarness = {
  env: WorkerEnv
  fetch: ReturnType<typeof vi.fn>
  seedSavedPlaces(places: LocationSearchResult[]): Promise<void>
  upstreamSearchFetch: ReturnType<typeof vi.fn>
}

export const createWeatherBackendTestHarness = (options?: {
  initialSavedPlaces?: LocationSearchResult[]
  searchFixtures?: Record<string, SearchFixture>
}) => {
  const searchFixtures = options?.searchFixtures ?? {}
  const env = {
    DEFAULT_PLACES_SCOPE: 'default',
    LOCATION_SEARCH_CACHE_TTL_SECONDS: '86400',
    LOCATION_SEARCH_CACHE_MAX_ENTRIES: '256',
    MAX_SAVED_PLACES: '50',
    LOCATION_SEARCH_RESULT_LIMIT: '8',
  } as Partial<WorkerEnv>

  const upstreamSearchFetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    const query = normalizeQuery(url.searchParams.get('name') ?? '')
    const fixture = searchFixtures[query] ?? { results: [] }

    return new Response(JSON.stringify(toOpenMeteoPayload(fixture.results ?? [])), {
      status: fixture.status ?? 200,
      headers: {
        'content-type': 'application/json',
      },
    })
  })

  env.fetchImpl = upstreamSearchFetch

  const getEnv = () => env as WorkerEnv

  env.SEARCH_CACHE = new FakeDurableObjectNamespace(
    (state, runtimeEnv) => new SearchCacheDurableObject(state, runtimeEnv),
    getEnv,
  )
  env.SAVED_PLACES = new FakeDurableObjectNamespace(
    (state, runtimeEnv) => new SavedPlacesDurableObject(state, runtimeEnv),
    getEnv,
  )

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlValue = input instanceof Request
      ? input.url
      : typeof input === 'string'
        ? input
        : input.toString()
    const url = new URL(urlValue, 'http://weather.test')
    const request = input instanceof Request
      ? input
      : new Request(url.toString(), init)

    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 })
    }

    return await backendWorker.fetch(request, env as WorkerEnv)
  })

  const seedSavedPlaces = async (places: LocationSearchResult[]) => {
    await fetch('http://weather.test/api/places?scope=default', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ places }),
    })
  }

  const harness: WeatherBackendTestHarness = {
    env: env as WorkerEnv,
    fetch,
    async seedSavedPlaces(places) {
      await seedSavedPlaces(places)
    },
    upstreamSearchFetch,
  }

  if (options?.initialSavedPlaces?.length) {
    void seedSavedPlaces(options.initialSavedPlaces)
  }

  return harness
}