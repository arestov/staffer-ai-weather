# Ревью интеграции Open-Meteo: 3 коммита + план дальнейших шагов

## Статус: код живой

Приложение уже получает настоящие данные из Open-Meteo. REPL-тест подтверждает:
- `temperatureC: 9.7`, `14.4`, `15.9` — реальные значения
- hourly/daily forecast series создаются с правильными label и summary
- `weatherCodeToSummary` корректно маппит WMO-коды

Однако из 4 локаций за 8 секунд REPL-теста полностью обновилась только 1 (nodeId "1", relsVersion: 6).
Остальные 3 показали relsVersion: 2 (только seed из `handleInit`). Причина — последовательный `for...await` в `fetchWeatherForAllLocations`.

---

## Обзор реализации

### Что сделано хорошо

1. **`applyWeather` как single action** — один dispatch обновляет всё поддерево (currentWeather + hourlyForecastSeries + dailyForecastSeries + свои attrs). Это правильный DKT-паттерн: вместо 3-4 отдельных dispatch'ей одна атомарная операция. В Sidekick аналогичный принцип — `state_request` загружает snapshot и проецирует его целиком.

2. **Нормализация отделена от транспорта** — `normalizeWeatherResponse` в `weather-api.ts` преобразует параллельные массивы Open-Meteo в объекты до попадания в модель. Модель получает уже чистый `ApplyWeatherPayload`.

3. **`weatherFormat.ts`** — чистый модуль без зависимостей от runtime. WMO-коды, форматирование температуры и дат — всё в одном месте.

4. **Creation shapes расширены** — `CURRENT_WEATHER_CREATION_SHAPE` и `FORECAST_SERIES_CREATION_SHAPE` включают все новые raw-атрибуты. `set_many` / `set_one` с `can_create: true` корректно создадут модели.

5. **Live update с recursive setTimeout** — правильно: не накапливает параллельные запросы. Retry с backoff.

---

## Что исправить

### 1. Последовательный fetch → параллельный (критично)

**Текущий код** (`model-runtime.ts:77-95`):
```ts
for (const location of locations) {
  // ...
  const payload = await fetchWeatherFromOpenMeteo(lat, lon)
  await location.dispatch('applyWeather', payload)
}
```

4 города × ~1-2 сек на fetch = 4-8 секунд последовательного ожидания.
Каждый `dispatch` тоже `await` — ещё задержка.

**Предложение**: fetch все параллельно, dispatch независимо:

```ts
const fetchWeatherForAllLocations = async (app: WeatherAppRuntime) => {
  const appModel = app.inited.app_model
  const locationRel = _getCurrentRel(appModel, 'weatherLocation') as RuntimeModelLike[] | null
  const locations: RuntimeModelLike[] = Array.isArray(locationRel) ? locationRel : []

  const entries = locations
    .map(location => {
      const lat = location.states?.['latitude'] as number | null | undefined
      const lon = location.states?.['longitude'] as number | null | undefined
      if (lat == null || lon == null) return null
      return { location, lat, lon }
    })
    .filter(Boolean) as Array<{ location: RuntimeModelLike; lat: number; lon: number }>

  // fetch all in parallel
  const results = await Promise.allSettled(
    entries.map(({ lat, lon }) => fetchWeatherFromOpenMeteo(lat, lon))
  )

  // dispatch each result independently (parallel fire, no cross-dependency)
  await Promise.allSettled(
    entries.map(({ location }, i) => {
      const result = results[i]
      if (result.status === 'fulfilled') {
        return location.dispatch('applyWeather', result.value)
      } else {
        return location.dispatch('failWeather', {
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
    })
  )
}
```

Это даёт:
- один цикл ожидания fetch'ей (~1-2 сек вместо 4-8)
- dispatch'и локаций не блокируют друг друга
- если одна локация упала — остальные обновятся

В Sidekick аналогичный подход: `ensureRecipesProm` в `make.js` схлопывает параллельные запросы, а не ставит их в очередь.

**Альтернативный вариант** (если dispatch'и нельзя параллелить в DKT): fetch параллельно, dispatch последовательно. Уже выигрыш 3-4 секунды.

### 2. `loadStatus` не выставляется в `'loading'` перед fetch

План предусматривал `loadStatus: 'idle' | 'loading' | 'ready' | 'error' | 'stale'`, но в `fetchWeatherForAllLocations` перед fetch никто не ставит `loadStatus: 'loading'`. UI не знает, что загрузка идёт.

**Предложение**: добавить action `startWeatherLoad` или выставить `loadStatus` вручную перед `Promise.allSettled`:

```ts
// перед fetch, пометить все локации как loading
await Promise.allSettled(
  entries.map(({ location }) =>
    location.dispatch('applyWeather', /* ...нужен отдельный action или хак... */)
  )
)
```

Лучше добавить простой action:
```ts
startLoading: {
  to: { loadStatus: ['loadStatus'] },
  fn: () => ({ loadStatus: 'loading' }),
}
```

### 3. `weatherFetchStarted` не сбрасывается при reconnect

`weatherFetchStarted = true` ставится один раз. Когда все connection'ы закрываются:
- `stopLiveUpdate()` вызывается (хорошо)
- но `weatherFetchStarted` остаётся `true`

При новом подключении `bootstrapSession` видит `weatherFetchStarted === true` и пропускает `fetchWeatherForAllLocations`. Данные устаревают.

**Предложение**: при `stopLiveUpdate` сбрасывать `weatherFetchStarted = false`:
```ts
const stopLiveUpdate = () => {
  if (liveUpdateTimer != null) {
    clearTimeout(liveUpdateTimer)
    liveUpdateTimer = null
  }
  weatherFetchStarted = false  // позволит перезапуск при reconnect
}
```

### 4. `handleInit` не читает `name` из attrs

В `handleInit.fn` нет массива зависимостей `['name']`:
```ts
fn: (_payload: unknown, locationName: unknown) => {
  const name = typeof locationName === 'string' ? locationName : ''  // всегда ''
```

У `applyWeather` есть `['name'] as const` — и location name корректно передаётся. Но `handleInit` создаёт seed-данные с пустым location. Это pre-existing issue, не от этих коммитов.

**Предложение**:
```ts
fn: [
  ['name'] as const,
  (_payload: unknown, locationName: unknown) => {
    // ...
  },
],
```

### 5. `CONTROL_REFRESH_WEATHER` — fire-and-forget без обратной связи

```ts
case APP_MSG.CONTROL_REFRESH_WEATHER: {
  const app = await bootstrapApp()
  fetchWeatherForAllLocations(app).catch(...)
  return
}
```

Нет способа узнать, завершился ли refresh. Если UI показывает spinner, он не знает когда остановиться.

**Сейчас приемлемо** — `loadStatus` на каждой локации обновится через `applyWeather`/`failWeather`. Но только если п.2 (выставление `'loading'`) будет реализован.

### 6. `attrsVersion: 0` на weather_location

В REPL-выводе все 4 weather_location имеют `attrsVersion: 0`. Это значит loadStatus, weatherFetchedAt и другие атрибуты не попали в sync stream.

Возможные причины:
- UI не подписался на эти атрибуты (нужен shape/structure usage)
- `applyWeather` action record не обновляет attrs модели корректно для sync

**Нужно проверить**: отображаются ли `loadStatus`/`weatherFetchedAt` в UI-компонентах и подписаны ли они через `useAttrs`/`useShape`.

---

## Сравнение с паттернами Sidekick (usage-sidekick)

| Аспект | Sidekick | Weather app | Рекомендация |
|---|---|---|---|
| Initial hydrate | `state_request` + HTTP snapshot | `handleInit` с seed → `applyWeather` с API | ✅ Хороший переходный подход |
| Live update | Pusher channels + `subscribe` | Periodic setTimeout + fetch | ✅ Адекватно для Open-Meteo (нет WebSocket API) |
| Update granularity | Push → refetch целого ресурса (coarse) | fetch → `applyWeather` перезаписывает всё поддерево | ✅ Совпадает с Sidekick-подходом |
| Parallel vs sequential | Request coalescing (`ensureRecipesProm`), dedupe (`getTeam`) | Sequential `for...await` | ❌ Нужен параллелизм |
| Echo suppression | `__lastBatchUpdateAt` | Не нужен (однонаправленный поток) | ✅ Корректно опущено |
| Domain facade | `teamApi`, `sidekickBrowserPolicy` | `weather-api.ts` | ✅ Аналогичное выделение |
| Error → retry | Per-push retry + LS cache fallback | Per-location catch + live update retry | ✅ Достаточно |

---

## Следующие шаги

### Шаг A. Параллелизация fetch (приоритет: высокий)

1. Переписать `fetchWeatherForAllLocations` на `Promise.allSettled` (параллельный fetch + параллельный dispatch)
2. Убедиться, что параллельные `dispatch('applyWeather')` не конфликтуют в DKT runtime (каждый dispatch на отдельной модели — конфликта быть не должно)
3. Проверить через REPL: все 4 локации получают данные за один цикл ожидания

### Шаг B. Добавить `loadStatus: 'loading'` (приоритет: высокий)

1. Добавить action `startLoading` на `WeatherLocation`
2. Вызывать перед запуском fetch'ей
3. UI может показывать skeleton/spinner на основе `loadStatus === 'loading'`

### Шаг C. Исправить `weatherFetchStarted` (приоритет: средний)

1. Сбрасывать `weatherFetchStarted = false` в `stopLiveUpdate()`
2. Или убрать флаг и привязать к наличию таймера: `if (liveUpdateTimer == null) {...}`

### Шаг D. Проверить sync attrs на weather_location (приоритет: средний)

1. Убедиться, что UI-компоненты подписаны на `loadStatus`, `weatherFetchedAt`, `latitude`, `longitude` через shapes/useAttrs
2. Если `attrsVersion` остаётся 0 после `applyWeather`, разобраться в механизме sync для platen attrs vs rel updates в DKT

### Шаг E. Добавить `['name']` dep в `handleInit` (приоритет: низкий)

1. Если seed-данные до сих пор нужны (skeleton до прихода API), добавить dep чтобы location name отображался правильно
2. Или убрать seed из `handleInit` и показывать пустые карточки пока API не ответит

### Шаг F. Stale-маркер при live update (приоритет: низкий)

1. Перед повторным fetch в live update tick выставить `loadStatus: 'stale'` вместо `'loading'`
2. UI может показать "обновление..." поверх уже существующих данных, а не полный skeleton

### Шаг G. Очистка seed-данных (приоритет: низкий)

1. После интеграции `handleInit` в WeatherLocation можно упростить — убрать `buildWeatherState`/`buildForecastSeries`
2. Либо оставить как fallback: если API недоступен, пользователь видит хотя бы placeholder
