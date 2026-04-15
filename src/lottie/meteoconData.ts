// Lazy-load map for all meteocon icons used in WMO weather code mapping.
// Each entry is a static string import so Vite can analyze and bundle them.

type LazyIcon = () => Promise<unknown>

const icons: Record<string, LazyIcon> = {
  'clear-day': () => import('@meteocons/lottie/monochrome/clear-day.json').then(m => m.default ?? m),
  'clear-night': () => import('@meteocons/lottie/monochrome/clear-night.json').then(m => m.default ?? m),
  'mostly-clear-day': () => import('@meteocons/lottie/monochrome/mostly-clear-day.json').then(m => m.default ?? m),
  'mostly-clear-night': () => import('@meteocons/lottie/monochrome/mostly-clear-night.json').then(m => m.default ?? m),
  'partly-cloudy-day': () => import('@meteocons/lottie/monochrome/partly-cloudy-day.json').then(m => m.default ?? m),
  'partly-cloudy-night': () => import('@meteocons/lottie/monochrome/partly-cloudy-night.json').then(m => m.default ?? m),
  'overcast': () => import('@meteocons/lottie/monochrome/overcast.json').then(m => m.default ?? m),
  'fog-day': () => import('@meteocons/lottie/monochrome/fog-day.json').then(m => m.default ?? m),
  'fog-night': () => import('@meteocons/lottie/monochrome/fog-night.json').then(m => m.default ?? m),
  'drizzle': () => import('@meteocons/lottie/monochrome/drizzle.json').then(m => m.default ?? m),
  'overcast-drizzle': () => import('@meteocons/lottie/monochrome/overcast-drizzle.json').then(m => m.default ?? m),
  'sleet': () => import('@meteocons/lottie/monochrome/sleet.json').then(m => m.default ?? m),
  'partly-cloudy-day-rain': () => import('@meteocons/lottie/monochrome/partly-cloudy-day-rain.json').then(m => m.default ?? m),
  'partly-cloudy-night-rain': () => import('@meteocons/lottie/monochrome/partly-cloudy-night-rain.json').then(m => m.default ?? m),
  'rain': () => import('@meteocons/lottie/monochrome/rain.json').then(m => m.default ?? m),
  'overcast-rain': () => import('@meteocons/lottie/monochrome/overcast-rain.json').then(m => m.default ?? m),
  'overcast-day-rain': () => import('@meteocons/lottie/monochrome/overcast-day-rain.json').then(m => m.default ?? m),
  'overcast-night-rain': () => import('@meteocons/lottie/monochrome/overcast-night-rain.json').then(m => m.default ?? m),
  'extreme-day-rain': () => import('@meteocons/lottie/monochrome/extreme-day-rain.json').then(m => m.default ?? m),
  'extreme-night-rain': () => import('@meteocons/lottie/monochrome/extreme-night-rain.json').then(m => m.default ?? m),
  'partly-cloudy-day-snow': () => import('@meteocons/lottie/monochrome/partly-cloudy-day-snow.json').then(m => m.default ?? m),
  'partly-cloudy-night-snow': () => import('@meteocons/lottie/monochrome/partly-cloudy-night-snow.json').then(m => m.default ?? m),
  'snow': () => import('@meteocons/lottie/monochrome/snow.json').then(m => m.default ?? m),
  'overcast-snow': () => import('@meteocons/lottie/monochrome/overcast-snow.json').then(m => m.default ?? m),
  'extreme-day-snow': () => import('@meteocons/lottie/monochrome/extreme-day-snow.json').then(m => m.default ?? m),
  'extreme-night-snow': () => import('@meteocons/lottie/monochrome/extreme-night-snow.json').then(m => m.default ?? m),
  'thunderstorms-day': () => import('@meteocons/lottie/monochrome/thunderstorms-day.json').then(m => m.default ?? m),
  'thunderstorms-night': () => import('@meteocons/lottie/monochrome/thunderstorms-night.json').then(m => m.default ?? m),
  'thunderstorms-day-hail': () => import('@meteocons/lottie/monochrome/thunderstorms-day-hail.json').then(m => m.default ?? m),
  'thunderstorms-night-hail': () => import('@meteocons/lottie/monochrome/thunderstorms-night-hail.json').then(m => m.default ?? m),
  'thunderstorms-extreme-day-hail': () => import('@meteocons/lottie/monochrome/thunderstorms-extreme-day-hail.json').then(m => m.default ?? m),
  'thunderstorms-extreme-night-hail': () => import('@meteocons/lottie/monochrome/thunderstorms-extreme-night-hail.json').then(m => m.default ?? m),
  'not-available': () => import('@meteocons/lottie/monochrome/not-available.json').then(m => m.default ?? m),
}

// Cache loaded animation JSON
const cache = new Map<string, Promise<unknown>>()

export const loadMeteoconData = (iconName: string): Promise<unknown> | null => {
  const loader = icons[iconName]
  if (!loader) {
    return null
  }
  let cached = cache.get(iconName)
  if (!cached) {
    cached = loader()
    cache.set(iconName, cached)
  }
  return cached
}
