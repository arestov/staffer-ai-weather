# Подключение Open-Meteo backend

## Цель

Заменить seed-данные (`weatherSeed.ts`) реальными данными из Open-Meteo Forecast API.
Добавить автоматическое обновление каждые 10 минут (live update).

## Границы задачи

Делаем:
- расширение существующих моделей raw-атрибутами из API
- worker-side fetch + нормализация ответа Open-Meteo
- action `applyWeather` на `WeatherLocation` для полного обновления поддерева
- live update через periodic refresh в worker

Не делаем:
- перенос weather graph из AppRoot в SessionRoot
- модель поиска городов (SearchLocationCandidate)
- промежуточную модель WeatherDashboard
- рефакторинг UI-компонентов

---

## Текущая архитектура

### Граф моделей

```
AppRoot
  ├── weatherLocation: WeatherLocation[]       (model, many)
  │     ├── currentWeather: CurrentWeather      (model)
  │     ├── hourlyForecastSeries: HourlyForecastSeries[]  (model, many)
  │     └── dailyForecastSeries: DailyForecastSeries[]    (model, many)
  ├── location: SelectedLocation[]              (model, many)
  │     └── weatherLocation → WeatherLocation   (input, linking)
  ├── mainLocation → SelectedLocation           (input, linking)
  └── additionalLocations → SelectedLocation[]  (input, linking, many)
```

### Как работает сейчас

1. `AppRoot.handleInit` создаёт 4 `WeatherLocation` с захардкоженными именами (Moscow, Berlin, Portland, Lisbon)
2. Каждый `WeatherLocation.handleInit` заполняет `currentWeather`, `hourlyForecastSeries`, `dailyForecastSeries` через `buildWeatherState()` / `buildForecastSeries()` из `weatherSeed.ts` — это фейковые данные
3. UI читает display-атрибуты: `temperatureText`, `summary`, `label`
4. Worker умеет: bootstrap session, dispatch action по `scope_node_id`, `CONTROL_SET_LOCATION`, `CONTROL_REFRESH_WEATHER`

### Поток данных

```
[Page]                        [SharedWorker]              [Open-Meteo]
  │ CONTROL_BOOTSTRAP_SESSION     │                           │
  │──────────────────────────────>│ bootstrapApp()            │
  │                               │ hookSessionRoot()         │
  │                               │ addSyncStream()           │
  │<──────────────────────────────│ SESSION_BOOTED            │
  │<──────────────────────────────│ SYNC_HANDLE (tree)        │
  │                               │                           │
  │ CONTROL_DISPATCH_APP_ACTION   │                           │
  │  action: 'refreshWeather'     │                           │
  │──────────────────────────────>│ dispatch(action, payload) │
  │<──────────────────────────────│ SYNC_HANDLE (updates)     │
```

После интеграции между `dispatch` и `SYNC_HANDLE` появится реальный fetch:

```
  │ CONTROL_DISPATCH_APP_ACTION   │                           │
  │  action: 'refreshWeather'     │                           │
  │──────────────────────────────>│ fetch /v1/forecast ───────│────>
  │                               │<──────────────────────────│
  │                               │ dispatch('applyWeather')  │
  │<──────────────────────────────│ SYNC_HANDLE (updates)     │
```

---

## Секция 1. Модели

### Что меняется

Расширяем существующие модели raw-атрибутами из Open-Meteo API. Display-атрибуты (`temperatureText`, `summary`, `label`) остаются — они заполняются из raw-данных при `applyWeather`.

### WeatherLocation — добавить координаты и статус загрузки

Текущее:
```ts
attrs: {
  name: ['input', ''],
}
```

Новое:
```ts
attrs: {
  name: ['input', ''],
  latitude: ['input', null],
  longitude: ['input', null],
  timezone: ['input', null],
  loadStatus: ['input', 'idle'],    // idle | loading | ready | error | stale
  lastError: ['input', null],
  weatherFetchedAt: ['input', null], // ISO string
}
```

`loadStatus` нужен UI для отображения загрузки/ошибки. `latitude` + `longitude` нужны worker для fetch.

Добавить action `applyWeather` — принимает нормализованный payload, обновляет всё поддерево: currentWeather, hourlyForecastSeries, dailyForecastSeries, плюс свои атрибуты.

Добавить action `failWeather` — ставит `loadStatus: 'error'` и `lastError`.

### CurrentWeather — добавить raw-атрибуты

Текущее:
```ts
attrs: {
  location: ['input', ''],
  status: ['input', 'booting'],
  temperatureText: ['input', '-- °C'],
  summary: ['input', 'Waiting for weather data'],
  updatedAt: ['input', null],
}
```

Новое:
```ts
attrs: {
  // display (заполняются из raw при applyWeather)
  location: ['input', ''],
  status: ['input', 'booting'],
  temperatureText: ['input', '-- °C'],
  summary: ['input', 'Waiting for weather data'],
  updatedAt: ['input', null],
  // raw
  temperatureC: ['input', null],
  apparentTemperatureC: ['input', null],
  weatherCode: ['input', null],
  isDay: ['input', null],
  windSpeed10m: ['input', null],
}
```

### HourlyForecastSeries — добавить raw-атрибуты

Текущее:
```ts
attrs: {
  label: ['input', ''],
  temperatureText: ['input', '-- °C'],
  summary: ['input', ''],
}
```

Новое:
```ts
attrs: {
  // display
  label: ['input', ''],
  temperatureText: ['input', '-- °C'],
  summary: ['input', ''],
  // raw
  time: ['input', null],           // ISO string
  temperatureC: ['input', null],
  precipitationProbability: ['input', null],
  weatherCode: ['input', null],
  windSpeed10m: ['input', null],
}
```

### DailyForecastSeries — добавить raw-атрибуты

Текущее:
```ts
attrs: {
  label: ['input', ''],
  temperatureText: ['input', '-- °C'],
  summary: ['input', ''],
}
```

Новое:
```ts
attrs: {
  // display
  label: ['input', ''],
  temperatureText: ['input', '-- °C'],
  summary: ['input', ''],
  // raw
  date: ['input', null],           // YYYY-MM-DD
  temperatureMaxC: ['input', null],
  temperatureMinC: ['input', null],
  precipitationProbabilityMax: ['input', null],
  weatherCode: ['input', null],
  windSpeedMax: ['input', null],
  sunrise: ['input', null],
  sunset: ['input', null],
}
```

### Action `applyWeather` на WeatherLocation

Принимает payload:
```ts
type ApplyWeatherPayload = {
  current: {
    temperatureC: number
    apparentTemperatureC: number
    weatherCode: number
    isDay: boolean
    windSpeed10m: number
  }
  hourly: Array<{
    time: string
    temperatureC: number
    precipitationProbability: number
    weatherCode: number
    windSpeed10m: number
  }>
  daily: Array<{
    date: string
    weatherCode: number
    temperatureMaxC: number
    temperatureMinC: number
    precipitationProbabilityMax: number
    windSpeedMax: number
    sunrise: string
    sunset: string
  }>
  fetchedAt: string
}
```

Декларация action:
```ts
applyWeather: {
  to: {
    loadStatus: ['loadStatus'],
    lastError: ['lastError'],
    weatherFetchedAt: ['weatherFetchedAt'],
    currentWeather: [
      '<< currentWeather',
      { method: 'set_one', can_create: true, creation_shape: CURRENT_WEATHER_CREATION_SHAPE },
    ],
    hourlyForecastSeries: [
      '<< hourlyForecastSeries',
      { method: 'set_many', can_create: true, creation_shape: FORECAST_SERIES_CREATION_SHAPE },
    ],
    dailyForecastSeries: [
      '<< dailyForecastSeries',
      { method: 'set_many', can_create: true, creation_shape: FORECAST_SERIES_CREATION_SHAPE },
    ],
  },
  fn: [
    ['name'],
    (payload: ApplyWeatherPayload, locationName: string) => {
      // Формирует display attrs из raw data
      // Возвращает обновления для всех targets
    },
  ],
}
```

Логика fn:
- `currentWeather.attrs` заполняется из `payload.current` + генерация display-полей (`temperatureText`, `summary`)
- `hourlyForecastSeries` — массив объектов `{ attrs: { ...raw, label, temperatureText, summary } }` из `payload.hourly`
- `dailyForecastSeries` — аналогично из `payload.daily`
- `loadStatus` → `'ready'`
- `lastError` → `null`
- `weatherFetchedAt` → `payload.fetchedAt`

### Action `failWeather` на WeatherLocation

```ts
failWeather: {
  to: {
    loadStatus: ['loadStatus'],
    lastError: ['lastError'],
  },
  fn: (payload: { message: string }) => ({
    loadStatus: 'error',
    lastError: payload.message,
  }),
}
```

### Creation shapes — обновить

`CURRENT_WEATHER_CREATION_SHAPE` и `FORECAST_SERIES_CREATION_SHAPE` нужно расширить новыми attr-именами, чтобы `can_create: true` создавал модели с полным набором полей.

```ts
export const CURRENT_WEATHER_CREATION_SHAPE = {
  attrs: [
    'location', 'status', 'temperatureText', 'summary', 'updatedAt',
    'temperatureC', 'apparentTemperatureC', 'weatherCode', 'isDay', 'windSpeed10m',
  ],
}

export const FORECAST_SERIES_CREATION_SHAPE = {
  attrs: [
    'label', 'temperatureText', 'summary',
    'time', 'date', 'temperatureC', 'temperatureMaxC', 'temperatureMinC',
    'precipitationProbability', 'precipitationProbabilityMax',
    'weatherCode', 'windSpeed10m', 'windSpeedMax', 'sunrise', 'sunset',
  ],
}

export const WEATHER_LOCATION_BASE_CREATION_SHAPE = {
  attrs: ['name', 'latitude', 'longitude', 'timezone'],
}
```

### Обновить seed-данные

В `weatherSeed.ts` захардкоженные города должны включать координаты:

```ts
const INITIAL_LOCATIONS = [
  { name: 'Moscow', latitude: 55.7558, longitude: 37.6173, timezone: 'Europe/Moscow' },
  { name: 'Berlin', latitude: 52.52, longitude: 13.405, timezone: 'Europe/Berlin' },
  { name: 'Portland', latitude: 45.5152, longitude: -122.6784, timezone: 'America/Los_Angeles' },
  { name: 'Lisbon', latitude: 38.7223, longitude: -9.1393, timezone: 'Europe/Lisbon' },
]
```

`buildInitialWeatherLocations()` должен возвращать записи с координатами:
```ts
export const buildInitialWeatherLocations = () =>
  INITIAL_LOCATIONS.map(loc => ({
    attrs: {
      name: loc.name,
      latitude: loc.latitude,
      longitude: loc.longitude,
      timezone: loc.timezone,
    },
  }))
```

---

## Секция 2. Worker fetch

### Новый файл: `src/worker/weather-api.ts`

Содержит:
1. `fetchWeatherFromOpenMeteo(lat, lon)` — один комбинированный запрос к Open-Meteo
2. `normalizeWeatherResponse(raw)` — преобразование ответа в `ApplyWeatherPayload`

### Open-Meteo запрос

```ts
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast'

async function fetchWeatherFromOpenMeteo(
  latitude: number,
  longitude: number,
): Promise<ApplyWeatherPayload> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m',
    forecast_hours: '12',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset',
    forecast_days: '5',
    timezone: 'auto',
  })

  const response = await fetch(`${OPEN_METEO_BASE}?${params}`)

  if (!response.ok) {
    throw new Error(`Open-Meteo responded with ${response.status}`)
  }

  const raw = await response.json()
  return normalizeWeatherResponse(raw)
}
```

### Нормализация

`normalizeWeatherResponse` преобразует Open-Meteo формат (параллельные массивы `time[]`, `temperature_2m[]`, ...) в массивы объектов:

```ts
function normalizeWeatherResponse(raw: OpenMeteoRawResponse): ApplyWeatherPayload {
  return {
    current: {
      temperatureC: raw.current.temperature_2m,
      apparentTemperatureC: raw.current.apparent_temperature,
      weatherCode: raw.current.weather_code,
      isDay: Boolean(raw.current.is_day),
      windSpeed10m: raw.current.wind_speed_10m,
    },
    hourly: raw.hourly.time.map((time, i) => ({
      time,
      temperatureC: raw.hourly.temperature_2m[i],
      precipitationProbability: raw.hourly.precipitation_probability[i],
      weatherCode: raw.hourly.weather_code[i],
      windSpeed10m: raw.hourly.wind_speed_10m[i],
    })),
    daily: raw.daily.time.map((date, i) => ({
      date,
      weatherCode: raw.daily.weather_code[i],
      temperatureMaxC: raw.daily.temperature_2m_max[i],
      temperatureMinC: raw.daily.temperature_2m_min[i],
      precipitationProbabilityMax: raw.daily.precipitation_probability_max[i],
      windSpeedMax: raw.daily.wind_speed_10m_max[i],
      sunrise: raw.daily.sunrise[i],
      sunset: raw.daily.sunset[i],
    })),
    fetchedAt: new Date().toISOString(),
  }
}
```

### Встройка в model-runtime

В `model-runtime.ts` рядом с `bootstrapSession`:

```ts
const fetchWeatherForAllLocations = async (app: WeatherAppRuntime) => {
  const appModel = app.inited.app_model
  const locations = _listRels(appModel, 'weatherLocation')  // уже импортирован

  for (const location of locations) {
    const lat = location.getAttr('latitude')
    const lon = location.getAttr('longitude')

    if (lat == null || lon == null) continue

    try {
      await location.dispatch('applyWeather', /* будет в следующем шаге */ 'loading')
      const payload = await fetchWeatherFromOpenMeteo(lat, lon)
      await location.dispatch('applyWeather', payload)
    } catch (error) {
      await location.dispatch('failWeather', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
```

Вызов после bootstrap:
```ts
// в bootstrapSession, после emitForConnection SESSION_BOOTED:
fetchWeatherForAllLocations(app).catch(error => {
  appendLog(connection, `weather fetch failed: ${error}`)
})
```

### Обработка `CONTROL_REFRESH_WEATHER`

Текущий handler в `model-runtime.ts` вызывает `dispatch('refreshWeather')`, который просто обновляет seed-данные. Заменить на:

```ts
case APP_MSG.CONTROL_REFRESH_WEATHER: {
  const app = await bootstrapApp()
  await fetchWeatherForAllLocations(app)
  return
}
```

---

## Секция 3. Live update

### Механизм

Recursive `setTimeout` в worker. Не `setInterval`, потому что при долгом fetch не должны накапливаться параллельные запросы.

### Реализация в `model-runtime.ts`

```ts
let liveUpdateTimer: ReturnType<typeof setTimeout> | null = null
const LIVE_UPDATE_INTERVAL_MS = 10 * 60 * 1000  // 10 минут
const LIVE_UPDATE_RETRY_MS = 30 * 1000           // 30 секунд при ошибке
const LIVE_UPDATE_MAX_RETRIES = 3

const startLiveUpdate = (app: WeatherAppRuntime) => {
  if (liveUpdateTimer != null) return

  let retryCount = 0

  const tick = async () => {
    liveUpdateTimer = null

    try {
      await fetchWeatherForAllLocations(app)
      retryCount = 0
      liveUpdateTimer = setTimeout(tick, LIVE_UPDATE_INTERVAL_MS)
    } catch {
      retryCount += 1
      const delay = retryCount <= LIVE_UPDATE_MAX_RETRIES
        ? LIVE_UPDATE_RETRY_MS
        : LIVE_UPDATE_INTERVAL_MS
      liveUpdateTimer = setTimeout(tick, delay)
    }
  }

  liveUpdateTimer = setTimeout(tick, LIVE_UPDATE_INTERVAL_MS)
}

const stopLiveUpdate = () => {
  if (liveUpdateTimer != null) {
    clearTimeout(liveUpdateTimer)
    liveUpdateTimer = null
  }
}
```

### Запуск и остановка

- Запуск: после первого успешного `fetchWeatherForAllLocations` в `bootstrapSession`
- Остановка: при `CONTROL_CLOSE_SESSION` если больше нет активных connection'ов

```ts
// в bootstrapSession, после fetch:
fetchWeatherForAllLocations(app)
  .then(() => startLiveUpdate(app))
  .catch(error => appendLog(connection, `initial fetch failed: ${error}`))
```

```ts
// в обработке port close / CONTROL_CLOSE_SESSION:
if (connections.size === 0) {
  stopLiveUpdate()
}
```

---

## Шаги реализации

### Шаг 1. Расширить модели и seed

Файлы: `src/app/rels/location-models.ts`, `src/app/rels/weatherSeed.ts`

1. Добавить raw-атрибуты в `CurrentWeather`, `HourlyForecastSeries`, `DailyForecastSeries`
2. Добавить `latitude`, `longitude`, `timezone`, `loadStatus`, `lastError`, `weatherFetchedAt` в `WeatherLocation`
3. Обновить creation shapes
4. Добавить координаты в `INITIAL_LOCATIONS` и `buildInitialWeatherLocations()`
5. Добавить action `applyWeather` на `WeatherLocation`
6. Добавить action `failWeather` на `WeatherLocation`

**Проверка:** `npm run build` без ошибок. UI работает как раньше (seed-данные заполняют display attrs).

### Шаг 2. Worker-side fetch

Файлы: `src/worker/weather-api.ts` (новый), `src/worker/model-runtime.ts`

1. Создать `weather-api.ts` с `fetchWeatherFromOpenMeteo()` и `normalizeWeatherResponse()`
2. Добавить `fetchWeatherForAllLocations()` в `model-runtime.ts`
3. Вызвать после `bootstrapSession`
4. Заменить handler `CONTROL_REFRESH_WEATHER` на реальный fetch

**Проверка:** при открытии приложения карточки показывают данные из Open-Meteo. Кнопка refresh (если есть) обновляет данные.

### Шаг 3. Live update

Файлы: `src/worker/model-runtime.ts`

1. Добавить `startLiveUpdate()` / `stopLiveUpdate()`
2. Запускать после первого успешного fetch
3. Останавливать при отсутствии активных connection

**Проверка:** через 10 минут данные обновляются автоматически. При ошибке — retry через 30 секунд, до 3 раз.

### Шаг 4. Форматирование display attrs из raw data

Файлы: `src/app/rels/weatherSeed.ts` или отдельный `src/app/rels/weatherFormat.ts`

1. Вынести функцию `weatherCodeToSummary(code, isDay)` для преобразования WMO weather code в текстовое описание
2. Функция `formatTemperature(celsius)` → `"15 °C"`
3. Функция `formatHourlyLabel(isoTime)` → `"14:00"`, `"15:00"`
4. Функция `formatDailyLabel(dateString)` → `"Mon"`, `"Tue"`
5. Использовать эти функции в action `applyWeather` для заполнения display attrs

**Проверка:** карточки показывают осмысленный текст вместо raw чисел.
