# Ревью DKT-кода: src/models — чистота, разделение эффектов, сравнение с linkkraft

> Дата: 2026-04-16
> Scope: `weather/src/models/` vs `linkcraft/src/models/` (эталон)

---

## Содержание

1. [Общая оценка](#1-общая-оценка)
2. [Структура моделей: weather vs linkkraft](#2-структура-моделей-weather-vs-linkkraft)
3. [Pure data: attrs](#3-pure-data-attrs)
4. [Pure functions: actions](#4-pure-functions-actions)
5. [Разделение side effects](#5-разделение-side-effects)
6. [Type guards и валидация](#6-type-guards-и-валидация)
7. [Конкретные замечания по файлам](#7-конкретные-замечания-по-файлам)
8. [Паттерны linkkraft, которые стоит перенять](#8-паттерны-linkkraft-которые-стоит-перенять)
9. [Сводная таблица](#9-сводная-таблица)
10. [Рекомендации с планами исправления](#10-рекомендации-с-планами-исправления)

---

## 1. Общая оценка

**Weather models в целом следуют DKT-идиомам корректно**, но есть систематические отклонения от эталона linkkraft в трёх областях:

| Область | linkkraft (эталон) | weather (текущий код) |
|---|---|---|
| **Чистота actions** | Actions возвращают data-descriptors. Никогда не вызывают API. | ✅ Соблюдается |
| **Разделение effects** | Чёткая 3-tier: `api` → `in` → `out` | ⚠️ Используется `effects.out` с `async` fn, содержащими полный цикл: fetch → dispatch. Нет `effects.in` (state_request). |
| **comp vs input баланс** | Много `comp` attrs (derived data). Ratio ≈ 2:1 comp:input | ⚠️ Преобладают `input` attrs. comp используется редко |
| **Вспомогательные pure functions** | Вынесены в отдельные утилиты | ✅ `weatherFormat.ts` — хороший пример |

---

## 2. Структура моделей: weather vs linkkraft

### linkkraft (11 основных моделей + вложенные)

```
App.js                      — root, rels/actions, effects в отдельном файле
├─ NavigationStep/
│   ├─ BaseStep.js          — 100% comp attrs, 0 effects
│   ├─ NavigationStep.js    — 13 comp / 6 input, effects: только nanoid
│   └─ acknowledgeSpawnedStepCreated.js  — отдельный pure action
├─ SearchingStep.js         — 0 effects, всё data-driven
├─ Snapshot.js              — полный effects 3-tier (api/in/out)
├─ TwitterImport.js         — самый тяжёлый по effects, 13 injected deps
├─ LiveDocument.js
├─ Routers/
│   ├─ Root.js              — effects: api + out (BrowserWindow)
│   └─ MainNavigation/      — router actions, bwlevs_for
└─ App/effects-api.js       — 17+ app-level API фабрик
```

### weather (10 файлов + пустая папка Routers/)

```
AppRoot.ts                  — root, всё в одном файле (~500 строк)
├─ WeatherLocation.ts       — effects.out с async networking
├─ CurrentWeather.ts        — pure data (только input)
├─ HourlyForecastSeries.ts  — pure data (только input)
├─ DailyForecastSeries.ts   — pure data (только input)
├─ SelectedLocation.ts      — actions + ref mechanism
├─ SelectedLocationPopoverRouter.ts  — router + effects.out
├─ SessionRoot.ts           — extends SessionRoot base
├─ RootRouter.ts            — session router config
├─ weatherFormat.ts         — pure utility functions ✅
└─ weatherSeed.ts           — pure initial data builders ✅
```

**Наблюдение**: В linkkraft эффекты вынесены в отдельные файлы (`effects-api.js`, `TwitterImporter.js`). В weather всё inline в определении модели.

---

## 3. Pure data: attrs

### linkkraft — эталонный подход

Модель `NavigationStep` — 13 `comp` attrs / 7 `input` attrs. `BaseStep` — 100% `comp`. Derived data вычисляется через `comp`, а не хранится как `input`:

```js
// linkkraft: NavigationStep — всё derived через comp
commonLocation: ['comp', ['&parsedURL', '&usableUrl'], removeURLTags],
usableUrl: ['comp', ['url', 'wantedUrl'], (arg1, arg2) => arg1 || arg2],
titleWords: ['comp', ['&title'], getWords],
domain: ['comp', ['parsedURL.host']],
urlAsSubtitle: ['comp', ['&parsedURL'], (parsed) => ({ hostname: ..., shortPathname: ... })],
resourceInPersonalCollection: ['comp', ['< @one:isInPersonalCollection < resourceCommonLocation'], Boolean],
```

Compute-функции вынесены в утилиты: `getTitleSentenses.js`, `parseURLLite.js`, `removeURLTags.js`.

### weather — текущий код

`WeatherLocation` — 2 `comp` / 8 `input`. `AppRoot` — 1 `comp` / ~13 `input`. Leaf-модели (`CurrentWeather`, `HourlyForecastSeries`, `DailyForecastSeries`) — 0 `comp` / все `input`.

```ts
// weather: AppRoot — много input, мало comp
location: ['input', 'pending'],
status: ['input', 'booting'],
temperatureText: ['input', '-- °C'],
summary: ['input', 'Waiting for backend weather data'],
updatedAt: ['input', null],
weatherLoadStatus: ['input', 'ready'],
weatherLoadError: ['input', null],
// ...единственный comp:
weatherUpdatedSummary: ['comp', [...], buildWeatherUpdatedSummary],
```

**Проблема**: `temperatureText`, `summary`, `status` в `AppRoot` — это legacy input attrs, которые дублируют данные из `WeatherLocation.currentWeather`. В linkkraft такие derived-значения были бы `comp` на нужном уровне модели.

**Хороший пример** в weather — `WeatherLocation` использует `comp` для sparkline:

```ts
hourlySparkline: ['comp',
  ['< @all:temperatureC < hourlyForecastSeries', '< @all:time < hourlyForecastSeries', ...],
  buildHourlySparkline,
],
```

Это именно linkkraft-паттерн: `comp` с `@all` по children + чистая функция. Функции `buildHourlySparkline` и `buildDailySparkline` — отличные pure functions.

### Статистика comp:input

| Модель | comp | input | Ratio |
|---|---|---|---|
| **linkkraft BaseStep** | ~8 | 0 | ∞ |
| **linkkraft NavigationStep** | 13 | 7 | 1.9:1 |
| **linkkraft SearchingStep** | 4 | 3 | 1.3:1 |
| **linkkraft TwitterImport** | 7 | 6 | 1.2:1 |
| weather AppRoot | 1 | ~13 | 0.08:1 |
| weather WeatherLocation | 2 | 8 | 0.25:1 |
| weather SelectedLocationPopoverRouter | 1 | ~12 | 0.08:1 |
| weather CurrentWeather | 0 | 10 | 0 |

---

## 4. Pure functions: actions

### linkkraft — эталонный подход

Actions ВСЕГДА возвращают data-descriptors. Никакого I/O. Единственное исключение — `showOnMapWrap` в `MainNavigation`, и это осознанный escape hatch роутера.

```js
// linkkraft: createRootStep — чистый data-descriptor
createRootStep: {
  to: {
    navigationSteps: ['<< navigationSteps', { method: 'at_start', can_create: true, can_hold_refs: true }],
    locations: ['<< locations', { method: 'at_start', can_use_refs: true }],
  },
  fn: ({ wantedUrl, type }) => {
    const newStepRef = 'createdStep'
    return {
      navigationSteps: { attrs: { wantedUrl }, hold_ref_id: newStepRef, extra: { type } },
      locations: { use_ref_id: newStepRef },
    }
  },
},
```

### weather — текущий код

**Actions в weather тоже чистые** — это соблюдается корректно. Все `fn` возвращают data-descriptors:

```ts
// weather: replaceWeatherLocation — чистый data-descriptor ✅
replaceWeatherLocation: {
  to: {
    _createWeatherLocation: ['<< weatherLocation << #', { method: 'at_end', can_create: true, can_hold_refs: true, ... }],
    weatherLocation: ['<< weatherLocation', { method: 'set_one', can_use_refs: true }],
  },
  fn: (payload: unknown) => {
    if (!isLocationSearchResult(payload)) return {}
    return {
      _createWeatherLocation: { attrs: { ... }, hold_ref_id: WEATHER_LOCATION_REF_ID },
      weatherLocation: { use_ref_id: WEATHER_LOCATION_REF_ID },
    }
  },
},
```

**Оценка**: ✅ Паритет с linkkraft. Все action fn — pure functions.

### Паттерн $noop

В обоих кодовых базах активно используется `$noop` для условного пропуска записи:

```ts
// weather: корректное использование $noop для stale-response guard ✅
applyLocationSearchResponse: {
  fn: [
    ['$noop', 'activeSearchRequestId'] as const,
    (payload, noop, activeSearchRequestId) => {
      if (!isSearchResponsePayload(payload) || payload.requestId !== activeSearchRequestId) {
        return noop
      }
      return { searchStatus: 'ready', searchResults: payload.results }
    },
  ],
},
```

---

## 5. Разделение side effects

### linkkraft — эталонная 3-tier архитектура

В linkkraft side effects строго разделены на три слоя:

**`effects.api`** — создание/уничтожение внешних ресурсов:
```js
// linkkraft: Snapshot — lifecycle-managed API
api: {
  screenshotsApi: [
    ['shouldMakeScreenshot'],              // gate: когда создавать
    ['#snapshotScreenshoter', 'self'],     // dependencies
    (snapshotScreenshoter, self) => ({...}), // factory
  ],
},
```

**`effects.in`** — загрузка данных через declarative state_request:
```js
// linkkraft: Snapshot — state_request с parse
in: {
  makeScreenshot: {
    type: 'state_request',
    states: ['goodBounds', 'hasScreenshot'],
    api: 'screenshotsApi',
    parse: (value) => value,
    fn: [['id', 'goodLiveBounds', 'goodBounds'], async (api, _, ...) => { ... }],
  },
},
```

**`effects.out`** — реакция на изменение state → side effect:
```js
// linkkraft: Root — минимальный out-effect
out: {
  toggleMode: {
    api: 'browserViewsLayouter',
    trigger: ['wideSchemaMode'],
    fn: (api, { value }) => api.setOverviewMode(Boolean(value)),
  },
},
```

**Ключевая идея linkkraft**: `effects.out` ТОЛЬКО запускает side effect. Результат side effect возвращается через `effects.in` (state_request/subscribe). Вызов `requestState()` — мост между out и in.

```
state change → effects.out (trigger) → requestState() → effects.in (state_request) → new state
```

### weather — отклонение от 3-tier

В weather `effects.out` берёт на себя полный цикл: и запрос, и обработку результата:

```ts
// weather: WeatherLocation — out-эффект делает ВСЁ
effects: {
  out: {
    loadWeatherForReplacement: {
      api: ['self'],
      trigger: ['weatherLoadRequest'],
      require: ['weatherLoadRequest'],
      is_async: true,
      fn: [
        ['weatherLoadRequest'] as const,
        async (self, _task, weatherLoadRequest) => {
          // ❌ Fetch в out-эффекте
          const weather = await fetchWeatherFromOpenMeteo(
            weatherLoadRequest.latitude,
            weatherLoadRequest.longitude,
          )
          // ❌ Dispatch результата прямо из out-эффекта
          await self.dispatch('applyWeatherFromRequest', {
            requestId: weatherLoadRequest.requestId,
            weather,
          })
        },
      ],
    },
  },
},
```

```ts
// weather: AppRoot — тот же паттерн
effects: {
  out: {
    syncSavedSearchLocations: {
      api: ['self'],
      is_async: true,
      fn: [
        ['savedSearchLocationsSyncRequest', 'savedSearchLocations'] as const,
        async (self, _task, syncRequest, savedLocations) => {
          // ❌ API call + dispatch в out-эффекте
          const places = await weatherBackend.fetchSavedSearchLocations()
          await self.dispatch('applySavedSearchLocationsSyncResult', { ... })
        },
      ],
    },
    autoDetectMainLocation: {
      api: ['self'],
      is_async: true,
      fn: [
        ['autoGeoStatus'] as const,
        async (self, _task, autoGeoStatus) => {
          // ❌ Тот же паттерн: fetch + dispatch
          const result = await geoLocation.detectLocation()
          await self.dispatch('applyAutoDetectedLocation', result)
        },
      ],
    },
  },
},
```

```ts
// weather: SelectedLocationPopoverRouter — оба out-эффекта
effects: {
  out: {
    runLocationSearch: {
      api: ['self'],
      is_async: true,
      fn: async (self, _task, searchRequest) => {
        const results = await locationSearch.search(searchRequest.query)
        await self.dispatch('applyLocationSearchResponse', { ... })
      },
    },
    runCurrentLocationLookup: {
      api: ['self'],
      is_async: true,
      fn: async (self, _task, currentLocationRequest) => {
        const result = await geoLocation.detectLocationByCoordinates({ ... })
        await self.dispatch('applyCurrentLocationLookupResponse', { ... })
      },
    },
  },
},
```

### Что не так с этим паттерном

| Проблема | Описание |
|---|---|
| **Нарушение single responsibility** | `effects.out` отвечает и за trigger, и за I/O, и за обработку результата |
| **Отсутствие state lifecycle** | `state_request` даёт бесплатно: `$meta$states$X$load_attempted`, `$meta$states$X$error`, `$meta$states$X$loading` — в weather этого нет, вся мета-информация дублируется вручную (`searchStatus`, `searchError`, `savedSearchLocationsSyncStatus`) |
| **API не абстрагированы** | В linkkraft API получается через `#name` injection. В weather `self.getInterface()` вызывается прямо в fn, с fallback на `self.app?.getInterface()` |
| **`self.dispatch()` в effects** | В linkkraft `effects.out.fn` не вызывает `dispatch`. В weather это основной паттерн — `async fn → fetch → self.dispatch(actionName)` |

### Как DKT управляет lifecycle через requestState / resetRequestedState

В linkkraft и Sidekick используется цикл **requestState → state_request → parse**, а для сброса — **resetRequestedState → requestState**. Вот как это работает в DKT-фреймворке:

#### requestState(stateName)

1. Проверяет: если state уже загружен (non-null) или `$done` flag = true, или в процессе (`process: true`) — **ничего не делает**
2. Создаёт store с `process: true`
3. Устанавливает мета-attrs:
   - `$meta$attrs$${stateName}$loading = true`
   - `$meta$attrs$${stateName}$load_attempting = true`
4. Рекурсивно запрашивает зависимости (dependencies из `fn`)
5. Вызывает `fn` из соответствующего `effects.in` (state_request)
6. По завершении:
   - **Успех**: `parse(result)` → записывает attrs из parse + `$meta$attrs$X$complete = true` + `$meta$attrs$X$load_attempted = true`
   - **Ошибка**: `$meta$attrs$X$load_attempted = true`, логирует ошибку
7. Встроенная **cancellation**: если во время запроса был вызван `resetRequestedState`, store reference не совпадает → ответ **молча отбрасывается** (`wasReset()` guard)

#### resetRequestedState(stateName)

1. Находит `_states_reqs_index[stateName]` → первый matching `StateReqMap`
2. **Удаляет request store** (`deleteReqState`) — это инвалидирует `wasReset()` guard в текущем in-flight запросе
3. Обнуляет все мета-attrs: `loading`, `load_attempting`, `load_attempted`, `complete` → `false`
4. Обнуляет сам state и `$done` flag

#### Паттерн reset + re-request (из FeaturesAndAuth.js)

```js
// linkkraft: единственный пример resetRequestedState
fn: (self) => {
  self.resetRequestedState('gumroadKeyToConsider')   // отменить текущий + обнулить state
  self.input(() => {
    self.requestState('gumroadKeyToConsider')          // запустить новый запрос
  })
}
```

`self.input()` гарантирует, что reset завершился (attrs записаны через data bus) перед стартом нового запроса.

#### Что это даёт бесплатно

| Фича | Вручную (weather) | Через state_request (linkkraft) |
|---|---|---|
| Loading state | `searchStatus: ['input', 'idle']` + ручное обновление | `$meta$attrs$X$loading` — автоматически |
| Error state | `searchError: ['input', null]` + ручной dispatch | `$meta$attrs$X$error` — автоматически при reject |
| Completed flag | `savedSearchLocationsSyncStatus: ['input', 'ready']` | `$meta$attrs$X$complete` — автоматически при resolve |
| Stale response guard | `activeSearchRequestId` + ручное сравнение | `wasReset()` — автоматическая отмена при store mismatch |
| Re-fetch | Ручной action + requestId increment | `resetRequestedState()` + `requestState()` |
| Cancel in-flight | Нет (stale response просто отбрасывается в action) | Store deletion → response silently dropped |

#### Аналогия с Sidekick (из api-sync-report)

В Sidekick `SearchResults` использует тот же механизм:

```js
// Sidekick: SearchResults.produce.resetQuery
produce: {
  resetQuery: {
    trigger: ['queryCriteria'],
    fn: (self, queryCriteria) => {
      self.resetRequestedState('freshSearchItems')  // отменить + обнулить
      if (queryCriteria) {
        self.requestState('freshSearchItems')        // запустить новый
      }
    },
  },
},
```

А `freshSearchItems` загружается через `consume.loadSearchItems` (`state_request`), который вызывает `api.search(queryCriteria)` и парсит результат. UI при этом использует fallback-логику:

```js
// Sidekick: пока freshSearchItems не готов, показывать предыдущий searchItems
searchItems: ['comp', ['hasFreshSearchItems', 'freshSearchItems', 'searchItems'],
  (hasFresh, fresh, current) => (hasFresh ? fresh : current) || [],
],
```

### Как бы это выглядело в linkkraft-стиле

```ts
// Гипотетический linkkraft-стиль для WeatherLocation
effects: {
  api: {
    weatherApi: [
      ['weatherLoadRequest'],                    // gate: создать когда есть запрос
      ['weatherLoaderSource'],                    // injected interface
      (weatherLoader) => weatherLoader,           // factory
      (api) => api.dispose?.(),                   // dispose
    ],
  },
  in: {
    loadWeather: {
      type: 'state_request',
      states: ['weatherData'],
      api: 'weatherApi',
      parse: (raw) => ({ weatherData: raw }),
      fn: [
        ['latitude', 'longitude'],
        async (api, _, lat, lon) => api.fetchWeather(lat, lon),
      ],
    },
  },
  out: {
    triggerWeatherLoad: {
      api: ['self'],
      trigger: ['weatherLoadRequest'],
      require: ['weatherLoadRequest'],
      fn: (self) => { self.requestState('weatherData') },
    },
  },
},
```

---

## 6. Type guards и валидация

### linkkraft

JS-кодовая база, минимальная runtime-валидация:
- `assert(data.extra?.type)` + `switch` в `handleInit`
- `model_name` discrimination в `switch` (роутеры)
- Ошибки при неизвестных типах: `throw new Error('Unknown way source of nav-step')`

### weather

TS-кодовая база, обширная runtime-валидация через type guards:

```ts
// weather: типичный type guard — повторяется ~10 раз
const isLocationSearchResult = (value: unknown): value is LocationSearchResult => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LocationSearchResult>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.subtitle === 'string' &&
    typeof candidate.latitude === 'number' &&
    typeof candidate.longitude === 'number'
  )
}
```

**Проблемы**:

1. **Дублирование**: `isLocationSearchResult` определена в 3 местах:
   - `WeatherLocation.ts` (canonical)
   - `AppRoot.ts` (копия)
   - `SelectedLocationPopoverRouter.ts` (копия)

2. **Чрезмерная оборонительность**: Actions получают `payload: unknown` и вручную валидируют каждый аргумент, включая `activeSearchRequestId`:
   ```ts
   // weather: каждый action проверяет каждый аргумент
   fn: [
     ['$noop', 'activeSavedSearchLocationsSyncRequestId'] as const,
     (payload: unknown, noop: unknown, activeSavedSearchLocationsSyncRequestId: unknown) => {
       if (
         !isSavedSearchLocationsSyncResponsePayload(payload) ||
         typeof activeSavedSearchLocationsSyncRequestId !== 'number' ||
         payload.requestId !== activeSavedSearchLocationsSyncRequestId
       ) {
         return noop
       }
       // ...
     },
   ],
   ```

   В linkkraft type guards минимальны — `data.extra.type` и `assert` на границах. Внутренние attrs (прочитанные из собственного state) НЕ валидируются, потому что модель сама гарантирует их тип.

3. **Сравнение подходов**:

| Подход | linkkraft | weather |
|---|---|---|
| Типизация payload | Нет (JS). Деструктуризация напрямую | `payload: unknown` → type guard |
| Типизация deps из state | Нет валидации (trust the framework) | `typeof x === 'number'` на своих же attrs |
| Повторное использование guards | N/A (их мало) | Дублирование в 3+ файлах |

---

## 7. Конкретные замечания по файлам

### AppRoot.ts

**Размер**: ~500 строк в одном файле. В linkkraft `App.js` — ~160 строк + `effects-api.js` отдельно.

**Замечания**:
1. ❌ `effects.out.syncSavedSearchLocations` — 40 строк async логики с `self.getInterface()` + `try/catch` + `self.dispatch()`. Это анти-паттерн для DKT.
2. ❌ `effects.out.autoDetectMainLocation` — аналогично.
3. ⚠️ Старые input attrs (`location`, `status`, `temperatureText`, `summary`, `updatedAt`) не используются в рендеринге (судя по архитектуре). Legacy?
4. ✅ `weatherUpdatedSummary` comp attr — хороший пример с чистой функцией `buildWeatherUpdatedSummary`.
5. ✅ Helpers вверху файла (`isLocationSearchResult`, `normalizeLocation`, `formatUpdatedAt`, `buildWeatherUpdatedSummary`) — все pure functions.
6. ✅ Multi-step `handleInit` action — корректное использование фаз с refs.

### WeatherLocation.ts

**Размер**: ~400 строк — модель + обширные pure utility functions.

**Замечания**:
1. ✅ `buildHourlySparkline`, `buildDailySparkline` — отличные pure functions, используемые в `comp` attrs.
2. ✅ `applyWeather` action — чистый, возвращает data-descriptor для создания currentWeather + hourly/daily series.
3. ✅ `applyWeatherFromRequest` / `failWeatherFromRequest` — корректный stale-request guard через requestId.
4. ❌ `effects.out.loadWeatherForReplacement` — async fn с `fetchWeatherFromOpenMeteo()` + `self.dispatch()`. Должно быть `effects.in` (state_request) + `effects.out` (trigger).
5. ❌ `import { fetchWeatherFromOpenMeteo } from '../worker/weather-api'` — прямой import сетевой функции в файл модели. В linkkraft networking API получаются через injected interfaces (`#name`), а не direct import.

### SelectedLocation.ts

**Замечания**:
1. ✅ Чистые actions `replaceWeatherLocation` и `applyAutoLocation` — корректное использование `hold_ref_id`/`use_ref_id`.
2. ✅ Нет effects — модель полностью data-driven.
3. ⚠️ `replaceWeatherLocation` и `applyAutoLocation` практически идентичны (разница — `isAutoSelected: false` vs отсутствие). Потенциальный DRY кандидат.

### SelectedLocationPopoverRouter.ts

**Размер**: ~600 строк — самый большой файл.

**Замечания**:
1. ❌ Два `effects.out` (`runLocationSearch`, `runCurrentLocationLookup`) с полным async циклом внутри.
2. ⚠️ `self.app?.getInterface('locationSearch')` — доступ к API через runtime casting, а не через `effects.api` declaration.
3. ✅ Actions чистые. `submitLocationSearch`, `cancelLocationEditing`, `selectLocationSearchResult` — все data-descriptors.
4. ✅ Builder-функции `buildSearchResetState`, `buildSearchingState` — хорошие pure helpers.
5. ⚠️ Очень много `to` targets (9-11 attrs за action). Возможно стоит группировать в compound attr.

### CurrentWeather.ts, HourlyForecastSeries.ts, DailyForecastSeries.ts

**Замечания**:
1. ✅ Чистые leaf-модели, только `input` attrs.
2. ⚠️ Нет ни одного `comp` attr — все derived values (`temperatureText`, `summary`, `label`) записываются как input в `applyWeather` action родителя. В linkkraft-стиле они были бы `comp` на самой модели:

```ts
// Как бы выглядело в linkkraft-стиле:
attrs: {
  temperatureC: ['input', null],
  weatherCode: ['input', null],
  isDay: ['input', null],
  // derived:
  temperatureText: ['comp', ['temperatureC'], formatTemperature],
  summary: ['comp', ['weatherCode', 'isDay'], weatherCodeToSummary],
},
```

### weatherFormat.ts

**Замечания**:
1. ✅ Идеальный пример pure utility module. Все функции — чистые, тестируемые, без зависимостей.
2. ✅ Аналог linkkraft'овских `getTitleSentenses.js`, `parseURLLite.js`.

### weatherSeed.ts

**Замечания**:
1. ✅ Pure data builders. `buildInitialWeatherLocations`, `buildInitialSelectedLocations` — чистые функции.
2. ✅ `CREATION_SHAPE` declarations — корректный DKT паттерн.

---

## 8. Паттерны linkkraft, которые стоит перенять

### 8.1. effects.in (state_request) вместо async effects.out

**linkkraft** разделяет "запустить загрузку" и "обработать результат":

```
[state change] → effects.out → self.requestState('X')
                                      ↓
                              effects.in (state_request) → parse → new attrs
```

**weather** объединяет всё в один async blob:

```
[state change] → effects.out → async { fetch(); self.dispatch('apply', result) }
```

Первый подход даёт бесплатный lifecycle (`$meta$states$X$loading/error/complete`), cancellation и чистый parse.

### 8.2. effects.api для lifecycle management

В linkkraft:
```js
api: {
  importer: [
    'shouldExecute',                    // gate attr
    ['#fs', '#path', '#BrowserView'],   // injected deps
    (fs, path, BrowserView, ...) => TwitterImporter(...),  // factory
    (api) => api.dispose(),             // dispose
  ],
},
```

В weather API получаются через `self.getInterface()` / `self.app?.getInterface()` прямо в runtime:
```ts
const weatherBackend = (
  self.getInterface('weatherBackend') ??
  self.getInterface('weatherBackendSource')
) as WeatherBackendApi | null
```

Это bypasses DKT's lifecycle management и не даёт фреймворку управлять созданием/уничтожением API.

### 8.3. Comp attrs на leaf-моделях

В linkkraft даже `BaseStep` (базовый класс) содержит 8+ comp attrs и 0 input. Derived data вычисляется максимально близко к source.

В weather `CurrentWeather` — 0 comp attrs. Формат `temperatureText` вычисляется в parent action и записывается как `input`. Это создаёт coupling: parent знает о presentation-формате child.

### 8.4. Выделение effects в отдельный файл

linkkraft: `App.js` (~160 строк) + `App/effects-api.js` (17 API фабрик)

weather: `AppRoot.ts` (~500 строк) — всё в одном файле.

### 8.5. Минимальная валидация internal state

linkkraft не проверяет свои собственные attrs в action fn. Если `textQuery` объявлен как `['input']`, action просто использует его. Guard'ы только на payload и на cross-model boundaries.

weather проверяет даже `typeof activeSavedSearchLocationsSyncRequestId === 'number'` — хотя это свой собственный input attr с дефолтом `0`.

---

## 9. Сводная таблица

| Критерий | linkkraft | weather | Оценка |
|---|---|---|---|
| Actions — pure functions | ✅ 100% (кроме router `dispatch`) | ✅ 100% | ✅ Паритет |
| comp attrs использование | ✅ Активное (2:1 ratio) | ⚠️ Минимальное (0.1:1) | ⚠️ Слабее |
| effects 3-tier разделение | ✅ api/in/out строго | ❌ Только out с async | ❌ Не соответствует |
| API injection через `#name` | ✅ Через effects.api + interfaces | ❌ self.getInterface() runtime | ⚠️ Workaround |
| Pure utility functions | ✅ Отдельные файлы | ✅ weatherFormat, weatherSeed | ✅ Паритет |
| Файловая организация | ✅ Модель + эффекты раздельно | ⚠️ Всё в одном файле | ⚠️ Можно улучшить |
| Type guards | Минимальные (JS) | Обширные, с дублированием | ⚠️ Избыточные |
| Builder helpers в actions | ✅ Inline data-descriptors | ✅ buildSearchResetState и др. | ✅ Паритет |
| Creation shapes | ✅ Используются | ✅ Используются | ✅ Паритет |
| $noop conditional writes | ✅ Повсеместно | ✅ Повсеместно | ✅ Паритет |
| hold_ref_id/use_ref_id | ✅ Корректно | ✅ Корректно | ✅ Паритет |

---

## 10. Рекомендации с планами исправления

### Высокий приоритет

---

### Рекомендация 1. Перевести effects.out с async циклом на 3-tier

**Суть проблемы**: 5 эффектов реализованы как `effects.out { async fn → fetch → self.dispatch() }`. Нужно разделить на `effects.api` (lifecycle) → `effects.in` (state_request) → `effects.out` (trigger).

**Контекст**: В AppRoot уже есть `effects.api` маппинг injected interfaces:
```ts
// Уже существует в AppRoot
effects: { api: {
  locationSearch:  [['_node_id'], ['locationSearchSource'], (src) => src],
  weatherLoader:   [['_node_id'], ['weatherLoaderSource'],  (src) => src],
  weatherBackend:  [['_node_id'], ['weatherBackendSource'], (src) => src],
  geoLocation:     [['_node_id'], ['geoLocationSource'],    (src) => src],
} }
```

#### Plan: WeatherLocation.loadWeatherForReplacement

**Текущее состояние**: Direct import `fetchWeatherFromOpenMeteo`, async fn с `self.dispatch()`.

**Целевое**:

```ts
// WeatherLocation.ts — целевой вариант
effects: {
  api: {
    weatherApi: [
      ['weatherLoadRequest'],                  // gate: создать только когда есть запрос
      ['weatherLoaderSource'],                 // injected interface из model-runtime
      (weatherLoader) => weatherLoader,
    ],
  },
  in: {
    loadWeatherData: {
      type: 'state_request',
      states: ['weatherResponse'],            // новый input attr для сырого ответа
      api: 'weatherApi',
      parse: (raw) => ({ weatherResponse: raw }),
      fn: [
        ['latitude', 'longitude'],
        async (api, _, lat, lon) => api.loadByCoordinates({ latitude: lat, longitude: lon }),
      ],
    },
  },
  out: {
    triggerWeatherLoad: {
      api: ['self'],
      trigger: ['weatherLoadRequest'],
      require: ['weatherLoadRequest'],
      fn: (self) => {
        self.resetRequestedState('weatherResponse')
        self.input(() => { self.requestState('weatherResponse') })
      },
    },
  },
},
```

**Шаги**:
1. Добавить `weatherResponse: ['input', null]` и `$meta$attrs$weatherResponse$complete: ['input']` в attrs
2. Заменить `effects.out.loadWeatherForReplacement` на три tier: api + in + out
3. Убрать прямой import `fetchWeatherFromOpenMeteo` из файла модели
4. Добавить `handleAttr:weatherResponse` action — когда weatherResponse приходит, вызвать `applyWeather` (или сделать `weatherResponse` comp → `applyWeather` через action)
5. Можно убрать ручные `loadStatus`/`lastError` attrs и использовать `$meta$attrs$weatherResponse$loading` / `$meta$attrs$weatherResponse$complete`
6. **Stale-request guard**: `resetRequestedState` автоматически отбрасывает in-flight ответы → можно убрать ручной `requestId` mechanism

**Альтернативный подход (минимальный)**: Если полный переход на state_request слишком объёмный, можно начать с замены direct import на `effects.api` + использование `weatherLoader` interface:

```ts
// Минимальный шаг: заменить direct import на effects.api
effects: {
  api: {
    weatherApi: [
      ['weatherLoadRequest'],
      ['weatherLoaderSource'],
      (weatherLoader) => weatherLoader,
    ],
  },
  out: {
    loadWeatherForReplacement: {
      api: ['self', 'weatherApi'],          // ← используем объявленный API
      trigger: ['weatherLoadRequest'],
      require: ['weatherLoadRequest'],
      is_async: true,
      fn: [
        ['weatherLoadRequest'],
        async (self, weatherApi, _task, req) => {
          const weather = await weatherApi.loadByCoordinates({ latitude: req.latitude, longitude: req.longitude })
          await self.dispatch('applyWeatherFromRequest', { requestId: req.requestId, weather })
        },
      ],
    },
  },
},
```

#### Plan: AppRoot.syncSavedSearchLocations

**Текущее состояние**: Сложный async fn c branching (load/save/remove), `self.getInterface('weatherBackend')`, `self.dispatch()`.

**Целевое**:

```ts
// AppRoot — savedSearchLocations через state_request
effects: {
  in: {
    loadSavedSearchLocations: {
      type: 'state_request',
      states: ['savedSearchLocationsResponse'],
      api: 'weatherBackend',
      parse: (places) => ({ savedSearchLocationsResponse: places }),
      fn: [
        ['savedSearchLocationsSyncRequest'],
        async (api, _, syncRequest) => {
          if (syncRequest.kind === 'load') return api.fetchSavedSearchLocations()
          if (syncRequest.kind === 'save') return api.saveSavedSearchLocation(syncRequest.place)
          return api.removeSavedSearchLocation(syncRequest.placeId)
        },
      ],
    },
  },
  out: {
    triggerSavedSearchLocationsSync: {
      api: ['self'],
      trigger: ['savedSearchLocationsSyncRequest'],
      require: ['savedSearchLocationsSyncRequest'],
      fn: (self) => {
        self.resetRequestedState('savedSearchLocationsResponse')
        self.input(() => { self.requestState('savedSearchLocationsResponse') })
      },
    },
  },
},
```

**Шаги**:
1. Добавить `savedSearchLocationsResponse: ['input', null]` attr
2. Добавить `handleAttr:savedSearchLocationsResponse` → обновлять `savedSearchLocations` из ответа
3. Убрать ручные `savedSearchLocationsSyncStatus`/`savedSearchLocationsSyncError` — заменить на `$meta$attrs$savedSearchLocationsResponse$loading` / `$meta$attrs$savedSearchLocationsResponse$complete`
4. Убрать `activeSavedSearchLocationsSyncRequestId` — `resetRequestedState` сам обеспечит cancellation

#### Plan: AppRoot.autoDetectMainLocation

**Текущее состояние**: Простой: trigger на `autoGeoStatus === 'pending'` → `geoLocation.detectLocation()` → `self.dispatch()`.

**Целевое**:

```ts
effects: {
  in: {
    detectGeoLocation: {
      type: 'state_request',
      states: ['autoDetectedLocation'],
      api: 'geoLocation',
      parse: (result) => ({ autoDetectedLocation: result }),
      fn: [[], async (api) => api.detectLocation()],
    },
  },
  out: {
    triggerGeoDetection: {
      api: ['self'],
      trigger: ['autoGeoStatus'],
      require: ['autoGeoStatus'],
      fn: [
        ['autoGeoStatus'],
        (self, _, autoGeoStatus) => {
          if (autoGeoStatus !== 'pending') return
          self.requestState('autoDetectedLocation')
        },
      ],
    },
  },
},
```

**Шаги**:
1. Добавить `autoDetectedLocation: ['input', null]`
2. Добавить `handleAttr:autoDetectedLocation` → вызвать `applyAutoDetectedLocation`
3. Убрать `autoGeoStatus`/`autoGeoError` ручное управление → использовать `$meta$attrs$autoDetectedLocation$loading` / `$meta$attrs$autoDetectedLocation$complete`

#### Plan: SelectedLocationPopoverRouter.runLocationSearch

**Текущее состояние**: Trigger на `searchRequest` → `locationSearch.search(query)` → `self.dispatch()`.

**Целевое**:

```ts
effects: {
  api: {
    locationSearchApi: [
      ['searchRequest'],                       // gate: создать когда есть запрос
      ['locationSearchSource'],                // injected через app
      (locationSearch) => locationSearch,
    ],
  },
  in: {
    executeLocationSearch: {
      type: 'state_request',
      states: ['searchResponseData'],
      api: 'locationSearchApi',
      parse: (results) => ({ searchResponseData: results }),
      fn: [
        ['searchRequest'],
        async (api, _, searchRequest) => api.search(searchRequest.query),
      ],
    },
  },
  out: {
    triggerLocationSearch: {
      api: ['self'],
      trigger: ['searchRequest'],
      require: ['searchRequest'],
      fn: (self) => {
        self.resetRequestedState('searchResponseData')
        self.input(() => { self.requestState('searchResponseData') })
      },
    },
  },
},
```

**Шаги**:
1. Добавить `searchResponseData: ['input', null]`
2. `handleAttr:searchResponseData` → записать в `searchResults` + установить `searchStatus: 'ready'`
3. Убрать `activeSearchRequestId` — `resetRequestedState` обеспечивает cancellation
4. Убрать ручные `searchStatus`/`searchError` — **или** оставить для UI, но заполнять из `$meta$attrs$searchResponseData$*`

**Примечание по injected interface**: `locationSearchSource` объявлен на AppRoot. Для доступа из child модели в `effects.api` потребуется либо:
- app-level interface forwarding (AppRoot уже регистрирует `locationSearch` через `effects.api`)
- доступ через `'locationSearchSource'` interface name — проверить, пробрасывается ли он по дереву

#### Plan: SelectedLocationPopoverRouter.runCurrentLocationLookup

Аналогичен runLocationSearch. Целевая структура:

```ts
effects: {
  api: {
    geoLocationApi: [
      ['currentLocationRequest'],
      ['geoLocationSource'],
      (geo) => geo,
    ],
  },
  in: {
    executeCurrentLocationLookup: {
      type: 'state_request',
      states: ['currentLocationResponseData'],
      api: 'geoLocationApi',
      parse: (result) => ({ currentLocationResponseData: result }),
      fn: [
        ['currentLocationRequest'],
        async (api, _, req) =>
          req.kind === 'browserCoordinates'
            ? api.detectLocationByCoordinates({ latitude: req.latitude, longitude: req.longitude })
            : api.detectLocation(),
      ],
    },
  },
  out: {
    triggerCurrentLocationLookup: {
      api: ['self'],
      trigger: ['currentLocationRequest'],
      require: ['currentLocationRequest'],
      fn: (self) => {
        self.resetRequestedState('currentLocationResponseData')
        self.input(() => { self.requestState('currentLocationResponseData') })
      },
    },
  },
},
```

#### Порядок миграции (рекомендуемый)

| Этап | Эффект | Сложность | Риск |
|---|---|---|---|
| 1 | `autoDetectMainLocation` (AppRoot) | Низкая — простой single-call | Минимальный, вызывается один раз |
| 2 | `loadWeatherForReplacement` (WeatherLocation) | Средняя — нужен refactor requestId | Средний, основной data flow |
| 3 | `runLocationSearch` (PopoverRouter) | Средняя — нужна отмена + UI status | Низкий, изолированный UI |
| 4 | `runCurrentLocationLookup` (PopoverRouter) | Средняя — аналогично #3 | Низкий, изолированный UI |
| 5 | `syncSavedSearchLocations` (AppRoot) | Высокая — 3 вида операций, branching | Средний, persistence |

На каждом этапе: сделать миграцию → запустить тесты → убедиться что UI работает → следующий этап.

---

### Рекомендация 2. Добавить comp attrs на leaf-модели

**Суть**: `CurrentWeather`, `HourlyForecastSeries`, `DailyForecastSeries` содержат 0 comp attrs. Все derived values (`temperatureText`, `summary`, `label`) записываются parent-action'ом как input.

**Как исправить**:

Для `CurrentWeather`:
```ts
import { formatTemperature, weatherCodeToSummary } from './weatherFormat'

export const CurrentWeather = model({
  model_name: 'weather_current_weather',
  attrs: {
    // raw data — input
    temperatureC: ['input', null],
    apparentTemperatureC: ['input', null],
    weatherCode: ['input', null],
    isDay: ['input', null],
    windSpeed10m: ['input', null],
    updatedAt: ['input', null],
    location: ['input', ''],
    // derived — comp ← NEW
    temperatureText: ['comp', ['temperatureC'], formatTemperature],
    summary: ['comp', ['weatherCode', 'isDay'], weatherCodeToSummary],
    status: ['comp', ['temperatureC'], (t) => t !== null ? 'ready' : 'booting'],
  },
})
```

Для `HourlyForecastSeries`:
```ts
attrs: {
  time: ['input', null],
  temperatureC: ['input', null],
  weatherCode: ['input', null],
  // derived — comp ← NEW
  label: ['comp', ['time'], formatHourlyLabel],
  temperatureText: ['comp', ['temperatureC'], formatTemperature],
  summary: ['comp', ['weatherCode'], (code) => weatherCodeToSummary(code, true)],
},
```

Для `DailyForecastSeries`:
```ts
attrs: {
  date: ['input', null],
  temperatureMaxC: ['input', null],
  temperatureMinC: ['input', null],
  weatherCode: ['input', null],
  // derived — comp ← NEW
  label: ['comp', ['date'], formatDailyLabel],
  temperatureText: ['comp', ['temperatureMinC', 'temperatureMaxC'],
    (min, max) => `${formatTemperature(min)} / ${formatTemperature(max)}`],
  summary: ['comp', ['weatherCode'], (code) => weatherCodeToSummary(code, true)],
},
```

**Шаги**:
1. Добавить `comp` attrs на leaf-модели
2. В `WeatherLocation.applyWeather` action — перестать записывать `temperatureText`, `summary`, `label`. Записывать только raw data attrs
3. Проверить, что React-компоненты подписаны на те же имена attrs (они уже есть в shapes — не требуется изменений)
4. Удалить неиспользуемые attrs если они больше не нужны

**Влияние**: Уменьшает coupling parent → child. Parent больше не знает о presentation-формате child. Чистые функции из `weatherFormat.ts` переиспользуются напрямую.

---

### Рекомендация 3. Устранить дублирование isLocationSearchResult

**Текущее состояние**: Определена в 3 файлах:
- `WeatherLocation.ts` (canonical, exported)
- `AppRoot.ts` (копия, не exported)
- `SelectedLocationPopoverRouter.ts` (копия, не exported)

**Как исправить**:
1. Оставить canonical определение в `WeatherLocation.ts` (уже exported)
2. В `AppRoot.ts` и `SelectedLocationPopoverRouter.ts` — заменить копию на import:
   ```ts
   import { isLocationSearchResult } from './WeatherLocation'
   ```
3. Удалить локальные копии функции

**Аналогично** для `toErrorMessage` — определена в 3 файлах. Вынести в `shared/` или утилиту.

---

### Средний приоритет

---

### Рекомендация 4. Вынести effects из AppRoot.ts в отдельный файл

**Как исправить**:

Создать `src/models/AppRoot/effects-api.ts`:

```ts
// src/models/AppRoot/effects-api.ts
export const appEffects = {
  effects: {
    api: {
      locationSearch: [['_node_id'], ['locationSearchSource'], (src) => src],
      weatherLoader: [['_node_id'], ['weatherLoaderSource'], (src) => src],
      weatherBackend: [['_node_id'], ['weatherBackendSource'], (src) => src],
      geoLocation: [['_node_id'], ['geoLocationSource'], (src) => src],
    },
    in: { /* state_request declarations */ },
    out: { /* trigger declarations */ },
  },
}
```

В `AppRoot.ts`:
```ts
import { appEffects } from './AppRoot/effects-api'
const app_props = mergeDcl({ ...appEffects, ... })
```

**Результат**: `AppRoot.ts` уменьшится с ~500 до ~300 строк. Эффекты тестируемы отдельно.

---

### Рекомендация 5. Перевести API injection на effects.api декларации

**Текущее состояние**: child-модели получают API через runtime:
```ts
// SelectedLocationPopoverRouter — текущий код
const app = (self as { app?: { getInterface: ... } }).app
const locationSearch = app?.getInterface('locationSearch') as LocationSearchApi | null
```

**Как исправить**: Объявить API в `effects.api` child-модели через `#name` interface или parent forwarding:

```ts
// SelectedLocationPopoverRouter — целевой код
effects: {
  api: {
    locationSearchApi: [
      ['searchRequest'],                        // gate
      ['locationSearchSource'],                 // injected interface name
      (locationSearch) => locationSearch,
    ],
    geoLocationApi: [
      ['currentLocationRequest'],
      ['geoLocationSource'],
      (geo) => geo,
    ],
  },
},
```

Если `locationSearchSource` не пробрасывается от app к child автоматически, потребуется:
- Либо зарегистрировать interface через `#locationSearch` convention
- Либо использовать `'< @one:locationSearchSource < $root'` comp attr для forwarding

**Выигрыш**: DKT управляет lifecycle API. API создаётся только когда gate attr truthy, и dispose когда gate falsy.

---

### Рекомендация 6. Убрать избыточную валидацию internal attrs

**Текущее состояние**: Actions проверяют `typeof x === 'number'` на своих же input attrs с дефолтом `0`.

**Как исправить**:

```ts
// Было:
fn: [
  ['$noop', 'activeSearchRequestId'] as const,
  (payload: unknown, noop: unknown, activeSearchRequestId: unknown) => {
    if (typeof activeSearchRequestId !== 'number') return noop  // ← избыточно
    // ...
  },
],

// Стало:
fn: [
  ['$noop', 'activeSearchRequestId'] as const,
  (payload: unknown, noop: unknown, activeSearchRequestId: number) => {
    // activeSearchRequestId гарантированно number (default = 0)
    // ...
  },
],
```

**Правило**: Валидировать `payload` (приходит извне) — нужно. Валидировать собственные input attrs с дефолтом — избыточно.

**Исключение**: Если рекомендация 1 реализована, ручные `activeRequestId` attrs исчезнут вместе с их проверками.

---

### Низкий приоритет

---

### Рекомендация 7. Ревизия legacy attrs в AppRoot

**Текущее состояние**: `location`, `status`, `temperatureText`, `summary`, `updatedAt` — input attrs на AppRoot.

**Как проверить**: grep по кодовой базе на использование этих attrs. Если используются только в legacy `setLocation`/`refreshWeather` actions и нигде в UI — удалить attrs и actions.

**Шаги**:
1. `grep -r "setLocation\|refreshWeather" src/` — найти все вызовы
2. Проверить, есть ли dispatch этих actions из worker/runtime
3. Если только из `model-runtime.ts` — проверить, не заменены ли они на `WeatherLocation.applyWeather`
4. Если не используются — удалить attrs + actions + связанные pure functions

---

### Рекомендация 8. Разбить SelectedLocationPopoverRouter

**Текущее состояние**: 600 строк — router + search state + current location lookup + saved locations forwarding.

**Как исправить**: По аналогии с linkkraft (`SearchingStep` + `SearchingStepLevel`):

```
SelectedLocationPopoverRouter.ts      — router shell (50 строк)
├─ LocationSearchBehaviour.ts         — search state machine + effects (250 строк)
└─ CurrentLocationBehaviour.ts        — geo lookup state + effects (150 строк)
```

Router остаётся тонким: `handleRel:current_mp_md`, navigation. Всё search-related state и effects живёт в отдельной модели (вложенной через `nest` rel).

**Шаги**:
1. Выделить search-related attrs/actions/effects в `LocationSearchBehaviour`
2. Выделить currentLocation-related attrs/actions/effects в `CurrentLocationBehaviour`
3. Router оставить с rels: `searchBehaviour: ['nest', [LocationSearchBehaviour]]`, `currentLocationBehaviour: ['nest', [CurrentLocationBehaviour]]`
4. Forwarding actions из router в child-модели
