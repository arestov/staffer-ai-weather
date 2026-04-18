# DKT: руководство по написанию приложений

> Практическое руководство по архитектуре, паттернам и подводным камням DKT,
> основанное на опыте разработки weather-приложения.

---

## Оглавление — компактный перечень принципов

1. **Структура модели** — attrs (input/comp), actions, effects (api/in/out), rels
2. **Actions — чистые data-descriptors** — без side effects, без await, без `self.dispatch`
3. **3-tier effects** — `effects.api` → `effects.in` → `effects.out` для всей async-логики
4. **`$fx_` — декларативный запуск effects из actions** — замена trigger out-effects
5. **comp attrs для производных данных** — формулы вместо записи в actions
6. **state_request lifecycle** — request → parse → attrs, action, handleAttr:, $meta$error
7. **API injection через effects.api** — не importировать сервисы напрямую
8. **Организация файлов** — shell + effects + helpers для больших моделей
9. **Refs для create-and-link** — `hold_ref_id` / `use_ref_id` в actions
10. **Именование и идентификаторы** — state_request name, effect keys, states[]
11. **Root model — особый случай** — timing API, handleInit, interface availability
12. **Типизация** — обход TS-ограничений в DKT declarations
13. **Тестирование** — 98 тестов, never break the suite

---

## 1. Структура модели

DKT-модель декларируется через `model()` с `mergeDcl()` внутри:

```ts
import { model } from 'dkt/dcl/attrs.js'
import { mergeDcl } from 'dkt/dcl/merge.js'

const dcl = mergeDcl({
  attrs: { /* ... */ },
  actions: { /* ... */ },
  effects: { /* ... */ },
  rels: { /* ... */ },
})

export const MyModel = model('my_model_name', dcl)
```

### Attrs: input vs comp

| Тип | Синтаксис | Назначение |
|---|---|---|
| **input** | `myAttr: ['input']` | Данные, записываемые через actions или state_request |
| **comp** | `myAttr: ['comp', [deps], fn]` | Производные данные, вычисляемые реактивно |

**Правило**: Если значение можно ВЫЧИСЛИТЬ из других attrs — используй comp. Input только для source data.

```ts
attrs: {
  // Input — raw data from API
  temperatureC: ['input'],
  weatherCode: ['input'],
  
  // Comp — derived display values
  temperatureText: ['comp', ['temperatureC'], formatTemperature],
  summary: ['comp', ['weatherCode'], weatherCodeToSummary],
}
```

### Rels

```ts
rels: {
  // Many — owned collection
  items: { model: ItemModel, many: true },
  
  // One — owned single child
  mainItem: { model: ItemModel },
  
  // Input — reference to node owned elsewhere
  linkedItem: { model: ItemModel, input: true },
  
  // Comp — computed from other rels
  activeItems: { model: ItemModel, many: true, comp: true, ... },
}
```

---

## 2. Actions — чистые data-descriptors

**Принцип**: Action fn получает payload + deps, возвращает data-descriptor. Фреймворк атомарно применяет descriptor.

```ts
actions: {
  applyResult: {
    fn: (payload: unknown) => {
      if (!isValidPayload(payload)) return '$noop'
      return {
        status: 'loaded',
        data: payload.data,
        error: null,
      }
    },
  },
}
```

### Что НЕЛЬЗЯ делать в actions

- ❌ `await` — actions синхронные, async-логика в effects
- ❌ `self.dispatch()` — actions не вызывают другие actions
- ❌ `fetch()` или любой I/O
- ❌ `Math.random()`, `Date.now()` — non-deterministic values

### $noop — условный skip

Если action не должен ничего менять, возвращай `'$noop'`. Не нужен if/return/throw — просто skip.

### deps в actions

```ts
actions: {
  updateStatus: {
    dep: 'currentItems',
    fn: (payload: unknown, currentItems: unknown[]) => ({
      itemCount: currentItems.length,
    }),
  },
}
```

---

## 3. 3-tier effects: api → in → out

**Это центральный архитектурный паттерн.** Вся async-логика проходит через 3 уровня:

```
effects.api  →  effects.in (state_request)  →  effects.out (trigger/apply)
 (lifecycle)      (async fetch)                 (orchestration)
```

> **Примечание**: trigger out-effects для запуска state_request из actions заменены на `$fx_` targets (см. раздел 4). Dispatch-result out-effects часто заменяются на `state_request.action` + `handleAttr:` (см. раздел 6). Out-effects по-прежнему нужны для: периодического refresh по таймеру, сложной orchestration с несколькими dispatch, реакции на attrs когда нужен доступ к API.

### effects.api — объявление внешних сервисов

```ts
effects: {
  api: {
    weatherLoader: {
      fn: [
        ['weatherLoaderSource'],
        (weatherLoaderSource: unknown) => weatherLoaderSource,
      ],
    },
    // Для child-моделей — auto-forward от $root:
    locationSearch: {
      fn: [
        ['#locationSearchSource'],
        (source: unknown) => source,
      ],
    },
  },
}
```

**Правило**: `#name` prefix — auto-forwarding interface от `$root`. Child-модель не нуждается в явном forwarding.

### effects.in — state_request (async data loading)

```ts
effects: {
  in: {
    loadWeatherData: {
      type: 'state_request',
      name: 'loadWeatherData',        // ⚠️ ОБЯЗАТЕЛЬНО при 2+ requests
      states: ['weatherData'],          // Какие attrs обновить
      api: 'weatherLoaderSource',       // ⚠️ На root — использовать SOURCE name
      parse: (result: unknown) => ({
        weatherData: result,            // ⚠️ Ключи ДОЛЖНЫ совпадать со states[]
      }),
      fn: [
        ['latitude', 'longitude'] as const,
        async (api: SomeApi, opts: unknown, lat: number, lon: number) => {
          try {
            const data = await api.fetch(lat, lon)
            return { ok: true as const, data }
          } catch (error) {
            return { ok: false as const, message: toErrorMessage(error) }
          }
        },
      ],
    },
  },
}
```

### effects.out — trigger + apply (orchestration)

```ts
effects: {
  out: {
    // Trigger — запуск state_request
    triggerLoad: {
      api: ['self'],                     // ⚠️ Только 'self', не API deps!
      trigger: ['loadStatus'],
      require: ['loadStatus', 'latitude'],
      fn: [
        ['loadStatus', 'latitude', 'longitude'] as const,
        (self: Self, _task: unknown, status: string, lat: number, lon: number) => {
          if (status !== 'pending') return
          self.requestState('weatherData')  // lookup по states[], не по effect key
        },
      ],
    },
    // Apply — обработка результата state_request
    // ⚠️ Рассмотри замену на state_request.action + handleAttr: (раздел 6)
    applyLoadResult: {
      api: ['self'],
      trigger: ['weatherData'],
      fn: [
        ['weatherData'] as const,
        async (self: Self, _task: unknown, result: unknown) => {
          if (!result || typeof result !== 'object') return
          const typed = result as { ok: boolean; data?: unknown; message?: string }
          if (typed.ok) {
            await self.dispatch('applyWeather', typed.data)
          } else {
            await self.dispatch('failWeather', typed.message)
          }
        },
      ],
    },
  },
}
```

### Критические правила effects.out

1. **`api: ['self']`** для trigger-эффектов — НЕ `api: ['self', 'myApi']`. Массив api — это **gate для создания** эффекта, а не dependencies.
2. **`trigger` реагирует на ИЗМЕНЕНИЕ** — если attr уже имеет нужное значение до создания эффекта, trigger не сработает.
3. **`requestState(stateName)`** ищет state_request по значению в `states[]`, не по ключу effects.in.

---

## 4. `$fx_` — декларативный запуск effects из actions

### Проблема: trigger out-effect boilerplate

Старый паттерн требовал цепочку `action → attr → out-effect trigger → self.requestState()`:

```ts
// ❌ Старый паттерн — лишний boilerplate
actions: {
  startLoading: {
    fn: () => ({ loadStatus: 'loading' }),
  },
},
effects: {
  out: {
    triggerWeatherLoad: {
      api: ['self'],
      trigger: ['loadStatus'],
      require: ['loadStatus'],
      fn: [['loadStatus'], (self, _task, status) => {
        if (status === 'loading') self.requestState('weatherData')
      }],
    },
  },
}
```

### Решение: `$fx_` target в action `to:`

`$fx_` позволяет запустить state_request прямо из action descriptor — без промежуточного attr и out-effect:

```ts
// ✅ Декларативный запуск — action напрямую вызывает effect
actions: {
  retryWeatherLoad: {
    to: {
      _fx: ['$fx_weatherData', { intent: 'reload' }],
    },
    fn: () => ({
      _fx: {},
    }),
  },
}
```

### Имя `$fx_` target

Имя эффекта строится из `states[]` массива в state_request: `$fx_` + имя attr.

```ts
effects: {
  in: {
    loadWeather: {
      type: 'state_request',
      states: ['weatherData'],      // ← отсюда
      // ...
    },
  },
}
// → target: '$fx_weatherData'
```

### Intents

| Intent | Описание |
|---|---|
| `request` | Запросить если ещё не загружено (первичная загрузка) |
| `refresh` | Перезапросить, сохраняя текущее значение (stale-while-revalidate) |
| `reload` | Сбросить и запросить заново |
| `reset` | Только сбросить, без нового запроса |
| `append` | Добавить данные (только для `nest_request`) |
| `call` | Безусловный вызов |

### Cross-model `$fx_` — таргетирование эффекта на child-модели

**Ключевой паттерн**: `$fx_` можно комбинировать с rel-путём для запуска эффекта на дочерней модели из action родителя. Вместо `inline_subwalker` + промежуточный action на child — прямой адрес:

```ts
// ✅ Родитель напрямую запускает загрузку на child weatherLocation
actions: {
  handleInit: [
    // step 1: создать weatherLocation
    { /* ... create children ... */ },
    // step 2: запустить $fx_ на child
    {
      to: {
        _fxWeather: ['< $fx_weatherData < weatherLocation', { intent: 'request' }],
      },
      fn: [
        ['$now'] as const,
        (_payload: unknown, now: number) => ({
          _fxWeather: { at: now },
        }),
      ],
    },
  ],
}
```

Синтаксис адреса: `< $fx_{attrName} < {relName}` — multiPath с `$fx_` в позиции state и rel-путём для навигации к целевой модели.

### `$now` для повторных вызовов

DKT оптимизирует повторные вызовы: если fn возвращает тот же объект — действие пропускается. `$now` гарантирует уникальность при каждом вызове:

```ts
fn: [
  ['$now'] as const,
  (_payload: unknown, now: number) => ({
    _fxWeather: { at: now },  // уникальное значение каждый раз
  }),
],
```

### Multi-step action с create + $fx_

Когда нужно создать ноду и сразу запустить загрузку — используй multi-step action (массив шагов):

```ts
// SelectedLocation: создать WeatherLocation + запустить загрузку
actions: {
  replaceWeatherLocation: [
    {
      to: { /* create + link via hold_ref_id/use_ref_id */ },
      fn: (payload) => ({ /* creation descriptor */ }),
    },
    {
      to: {
        _fxWeather: ['< $fx_weatherData < weatherLocation', { intent: 'request' }],
      },
      fn: () => ({ _fxWeather: {} }),
    },
  ],
}
```

### Когда использовать `$fx_` vs out-effect trigger

| Ситуация | Подход |
|---|---|
| Запуск загрузки из action | `$fx_` |
| Запуск загрузки на child из parent action | `$fx_` + rel path |
| Реакция на изменение attr (любой источник) | `handleAttr:` action или out-effect trigger |
| Периодический refresh по таймеру | out-effect + `self.refreshState()` |
| Обработка результата state_request (простой forward) | `state_request.action` + `handleAttr:` |
| Обработка результата state_request (сложная логика) | out-effect (dispatch result) |

---

## 5. comp attrs для производных данных

### Когда использовать comp

- Форматирование для отображения (температура → "22°C")
- Агрегация из children (`['< @all:price < items']`)
- Status derivation (status computed from raw flags)

### comp с deep rel dependencies

```ts
attrs: {
  allTemperatures: [
    'comp',
    ['< @all:temperatureC < hourlyForecastSeries'],
    (temps: number[]) => temps,
  ],
}
```

### Обновление creation shapes

Когда attr переводится с input на comp, **убрать его из creation shape** (`weatherSeed.ts`):

```ts
// До: input attr — включён в shape
const SHAPE = { temperatureText: null, summary: null, temperatureC: null }

// После: comp attrs — исключены из shape
const SHAPE = { temperatureC: null, weatherCode: null }
// temperatureText и summary теперь comp — не нужны в shape
```

---

## 6. state_request lifecycle

### Полный цикл

```
1. Action sets loadStatus = 'pending'
2. effects.out trigger fires, calls self.requestState('dataAttr')
3. DKT checks: is dataAttr already requested?
   - Если wasReset() — отклонить (stale cancel)
4. effects.in fn вызывается с API и resolved deps
5. fn возвращает result
6. parse(result) возвращает { attrName: value }
7. Attrs обновляются
8. Если задан action — dispatches action (см. ниже)
9. handleAttr: actions fire для изменённых attrs
10. effects.out apply fires (если есть)
```

### `action` — действие после успешного parse

Поле `action` в state_request позволяет автоматически dispatch action после успешного завершения:

```ts
effects: {
  in: {
    detectGeoLocation: {
      type: 'state_request',
      states: ['autoDetectedLocation'],
      api: 'geoLocationSource',
      parse: (result: unknown) => ({ autoDetectedLocation: result }),
      action: 'onAutoGeoDetected',  // ← вызывается после успешного parse
      fn: [
        [] as const,
        async (api: { detectLocation: () => Promise<unknown> }) => {
          return await api.detectLocation()
        },
      ],
    },
  },
}
```

**Ограничение**: Action, указанный в `action`, НЕ должен содержать `inline_subwalker` forwarding в своих `to` declarations. Используй его для простых операций (установка статус-attrs).

При ошибке в fn action НЕ вызывается, ошибка попадает в `$meta$error` (см. ниже).

### `$meta$error` — автоматическая обработка ошибок

DKT автоматически управляет error-attrs:

- `$meta$attrs$<attr>$error` — ошибка последнего state_request, записавшего `<attr>`
- `$meta$fx$<fx_name>$error` — ошибка по имени эффекта

Если fn в state_request выбрасывает исключение:
1. Ошибка записывается в `$meta$error` attr
2. `action` НЕ вызывается
3. При следующем успешном запросе `$meta$error` сбрасывается

Это позволяет убрать try/catch + ok/error dispatch из fn:

```ts
// ❌ Старый паттерн — ручная обработка ошибок
fn: [
  [] as const,
  async (api) => {
    try {
      const result = await api.detectLocation()
      return { ok: true, data: result }
    } catch (error) {
      return { ok: false, message: toErrorMessage(error) }
    }
  },
],

// ✅ Новый паттерн — ошибки в $meta$error
fn: [
  [] as const,
  async (api) => {
    return await api.detectLocation()
  },
],
```

### `handleAttr:` — реакция на изменение attr

`handleAttr:<attrName>` — специальный action, который автоматически dispatch при изменении attr. Заменяет dispatch-result out-effects, убирая boilerplate:

```ts
// ❌ Старый паттерн — out-effect для forwarding результата
effects: {
  out: {
    forwardAutoDetectedLocation: {
      api: ['self'],
      trigger: ['autoDetectedLocation'],
      require: ['autoDetectedLocation'],
      is_async: true,
      fn: [
        ['autoDetectedLocation'] as const,
        async (self, _task, location) => {
          await self.dispatch('applyAutoDetectedLocation', location)
        },
      ],
    },
  },
}

// ✅ Новый паттерн — handleAttr реагирует на attr change
actions: {
  'handleAttr:autoDetectedLocation': [
    {
      to: {
        applyAutoLocation: [
          '<< mainLocation',
          { action: 'applyAutoLocation', inline_subwalker: true },
        ],
      },
      fn: (payload: unknown) => {
        const value =
          payload != null && typeof payload === 'object' && 'next_value' in payload
            ? (payload as { next_value: unknown }).next_value
            : null

        if (!isLocationSearchResult(value)) {
          return {}
        }

        return { applyAutoLocation: value }
      },
    },
  ],
}
```

**Payload формат**: `{ next_value: <новое значение>, prev_value: <старое значение> }`

**Когда использовать handleAttr: вместо out-effect**:
- Forwarding attr на child через `inline_subwalker`
- Преобразование attr и dispatch в другой action
- Любая чистая (sync) реакция на изменение attr

**Когда out-effect всё ещё нужен**:
- Нужен доступ к API (`api: ['self', 'myApi']`)
- Async операции (таймеры, сложный orchestration)
- Реакция на несколько attrs одновременно (`trigger: ['a', 'b']`)

### Комбинация: action + handleAttr: (полный паттерн)

Для замены out-effect dispatch-result:

```ts
// state_request: action для статусов, handleAttr для forwarding
effects: {
  in: {
    detectGeoLocation: {
      type: 'state_request',
      states: ['autoDetectedLocation'],
      parse: (result) => ({ autoDetectedLocation: result }),
      action: 'onAutoGeoDetected',      // статус: done
      fn: [[], async (api) => api.detectLocation()],
    },
  },
},
actions: {
  onAutoGeoDetected: {                   // простой статус (без forwarding)
    to: { status: ['autoGeoStatus'], error: ['autoGeoError'] },
    fn: () => ({ status: 'done', error: null }),
  },
  'handleAttr:autoDetectedLocation': [{  // forwarding на child
    to: { applyAutoLocation: ['<< mainLocation', { action: 'applyAutoLocation', inline_subwalker: true }] },
    fn: (payload) => {
      const value = payload?.next_value
      if (!isValid(value)) return {}
      return { applyAutoLocation: value }
    },
  }],
}
```

### requestState + resetRequestedState

```ts
// Re-fetch with stale-while-revalidate
self.requestState('weatherData')

// Hard reset + re-fetch
self.input(() => {
  self.resetRequestedState('weatherData')
})
self.requestState('weatherData')
```

**Критично**: `self.input(() => { reset })` гарантирует что reset пишется в data bus **до** нового requestState. Без wrapper — race condition.

### refreshState — stale-while-revalidate

```ts
self.refreshState('weatherData')
```

Сохраняет текущее значение, запускает новый запрос. Когда ответ приходит — обновляет.

---

## 7. API injection через effects.api

### Почему не прямой import

```ts
// ❌ Плохо — tight coupling, не тестируется
import { fetchWeather } from '../worker/weather-api'
// в effects.out.fn: const data = await fetchWeather(lat, lon)

// ✅ Хорошо — DI через effects.api
effects: {
  api: {
    weatherLoader: {
      fn: [['weatherLoaderSource'], (source) => source],
    },
  },
  in: {
    loadWeather: {
      api: 'weatherLoaderSource',  // injection
      fn: [[], async (api) => api.fetch(...)],
    },
  },
}
```

### Преимущества

- Тестируемость — mock API через interface
- Lifecycle management — API создаётся фреймворком
- Decoupling — модель не знает concrete implementation
- Нет `self.getInterface()` в actions/effects

---

## 8. Организация файлов

### Маленькая модель (<200 строк)

```
src/models/CurrentWeather.ts     # всё в одном файле
```

### Средняя модель (200-500 строк)

```
src/models/WeatherLocation.ts    # attrs + actions + effects (inline)
```

### Большая модель (500+ строк)

```
src/models/AppRoot.ts            # shell: attrs + actions (import effects)
src/models/AppRoot/effects.ts    # effects (api + in + out) + private helpers
```

### Очень большая модель с cross-cutting state

```
src/models/PopoverRouter.ts              # shell: attrs + actions
src/models/PopoverRouter/effects.ts      # effects (api + in + out)
src/models/PopoverRouter/helpers.ts      # types, validators, builders, normalizers
```

### Что выносить в helpers

- Type definitions (interfaces, discriminated unions)
- Type guard validators (`isSearchRequest`, `isValidPayload`)
- State builder functions (`buildResetState`, `buildSearchingState`)
- Input normalizers (`normalizeQuery`, `normalizeBrowserCoords`)
- Constants (`MIN_QUERY_LENGTH`)

### Что НЕ разбивать на отдельные модели

Если actions одной "группы" пишут в attrs другой "группы" — не разбивать. DKT-модель атомарна по транзакциям. Вместо этого — file-level split.

---

## 9. Refs для create-and-link

### Паттерн: создать ноду + привязать input rel

```ts
actions: {
  createLinkedItem: {
    fn: () => ({
      '<< items << #': {              // создать в root.items
        'item_1 hold_ref_id': true,   // tag ref
        name: 'New Item',
      },
      '<< selectedItem': {            // привязать input rel
        'set_one use_ref_id': 'item_1',
      },
    }),
  },
}
```

### Правила refs

| Паттерн | Описание |
|---|---|
| `'<< relName << #'` | Путь к root nesting |
| `'<< relName'` | Путь к своему nesting |
| `hold_ref_id: true` | Запомнить _node_id под заданным именем |
| `use_ref_id: 'refName'` | Подставить сохранённый _node_id |
| `method: 'at_end'` | Добавить в конец many-коллекции |
| `method: 'set_one'` | Заменить единственный child |

### Ловушки

- `input` rels **не поддерживают** `can_create` — нельзя создавать ноду прямо в input rel
- `set_one` на `many: true` — crash. Используй `at_end`, `at_start`, `set_many`
- Порядок не важен — DKT ретраит пока все refs resolve

---

## 10. Именование и идентификаторы

### state_request: три идентификатора

```ts
effects: {
  in: {
    // effect key — организация в коде
    executeLocationSearch: {
      type: 'state_request',
      // name — unique в модели, ОБЯЗАТЕЛЕН при 2+ requests
      name: 'executeLocationSearch',
      // states — какие attrs обновятся, lookup для requestState()
      states: ['searchResponsePayload'],
      // ...
    },
  },
}
```

**Best practice**: Делай `name` = effect key. Это устраняет путаницу.

### Naming conventions

| Сущность | Формат | Пример |
|---|---|---|
| model_name | `snake_case` | `'weather_location'` |
| attrs | `camelCase` | `loadStatus`, `temperatureC` |
| actions | `camelCase`, глагол | `applyWeather`, `handleInit` |
| effects.api keys | `camelCase`, noun | `weatherLoader`, `geoLocation` |
| effects.in keys | `camelCase`, verb | `loadWeatherData`, `executeSearch` |
| effects.out keys | `camelCase`, verb + purpose | `triggerLoad`, `applyLoadResult` |
| state_request name | = effect key | `'loadWeatherData'` |

---

## 11. Root model — особый случай

### API timing

```
Порядок инициализации:
1. Root model создаётся
2. handleInit action выполняется        ← effects.api ещё НЕ готовы
3. effects.api declarations resolve      ← теперь готовы
4. Child models создаются
5. Child handleInit выполняется          ← effects.api child'ов готовы
```

### Следствия

| Ситуация | На root | На child |
|---|---|---|
| `state_request.api` | Использовать SOURCE name (`weatherLoaderSource`) | Можно использовать computed name (`weatherLoader`) |
| `effects.api` в handleInit | Недоступны | Доступны |
| `#name` auto-forwarding | Не применимо (нет parent) | Работает — берёт interface у $root |

### Рекомендация

На root-модели:
- state_request.api → всегда raw source interface
- effects.out trigger → `api: ['self']`, не `api: ['self', 'myApi']`
- Не полагаться на effects.api в handleInit

---

## 12. Типизация

### Известные TS-ограничения

1. **Tuple form `[deps, handler]`** иногда ломает inference в `model()`. Fix: bare function form или explicit typing.
2. **payload: unknown** — DKT не имеет declarative payload typing. Narrow внутри fn.
3. **API types** — `unknown` по умолчанию. Cast внутри fn: `(api: MyApiType, ...)`.

### Type guards вместо typeof

```ts
// ❌ Не нужно — DKT гарантирует что собственные input attrs имеют нужный тип
if (typeof self.activeRequestId !== 'number') return '$noop'

// ✅ Нужно — payload приходит извне
if (!isValidPayload(payload)) return '$noop'
```

### Когда typeof нужен

- На `payload` от dispatch — всегда unknown
- На данные из API response — не доверяй external data
- НЕ нужен на собственных input attrs модели

---

## 13. Тестирование

### Стратегия

- Unit-тесты на model actions (чистые функции)
- Integration-тесты через test harness (model-runtime + mock APIs)
- Всегда запускай полный suite после каждого изменения модели
- Zero tolerance для flaky tests — если тест иногда падает, это bug

### Что тестировать

| Уровень | Что | Как |
|---|---|---|
| **Actions** | Return values для разных payload | Прямой вызов fn |
| **State requests** | Parse return values | Unit test parse fn |
| **Effects orchestration** | Full flow trigger→request→apply | Integration через harness |
| **Comp attrs** | Derived values | Integration — verify through scope attrs |

---

## Appendix: Чеклист перед коммитом

- [ ] Все state_requests имеют уникальный `name` (если их >1 в модели)
- [ ] `parse` возвращает объект со ВСЕМИ ключами из `states[]`
- [ ] Root model state_request.api — source interface name
- [ ] effects.out trigger — `api: ['self']`, не `api: ['self', 'otherApi']`
- [ ] Comp attrs исключены из creation shapes
- [ ] Нет `self.getInterface()` — все API через effects.api
- [ ] Нет typeof на собственных input attrs
- [ ] Нет дублирующихся type guards / helpers
- [ ] `as const` на deps arrays в effects fn
- [ ] `$fx_` target name matches `states[]` attr в state_request
- [ ] Cross-model `$fx_` — нет промежуточного action на child, прямой rel path
- [ ] Trigger out-effects заменены на `$fx_` где это action-initiated загрузка
- [ ] Dispatch-result out-effects → рассмотри `state_request.action` + `handleAttr:`
- [ ] `handleAttr:` payload — извлекай `next_value`, не используй payload напрямую
- [ ] `state_request.action` — action без `inline_subwalker` в `to`
- [ ] fn в state_request — не оборачивай в try/catch, ошибки идут в `$meta$error`
- [ ] Tests pass: 0 failures, 0 regressions
