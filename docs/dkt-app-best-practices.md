# DKT: руководство по написанию приложений

> Практическое руководство по архитектуре, паттернам и подводным камням DKT,
> основанное на опыте разработки weather-приложения.

---

## Оглавление — компактный перечень принципов

1. **Структура модели** — attrs (input/comp), actions, effects (api/in/out), rels
2. **Actions — чистые data-descriptors** — без side effects, без await, без `self.dispatch`
3. **3-tier effects** — `effects.api` → `effects.in` → `effects.out` для всей async-логики
4. **comp attrs для производных данных** — формулы вместо записи в actions
5. **state_request lifecycle** — request → parse → attrs, с cancellation через reset
6. **API injection через effects.api** — не importировать сервисы напрямую
7. **Организация файлов** — shell + effects + helpers для больших моделей
8. **Refs для create-and-link** — `hold_ref_id` / `use_ref_id` в actions
9. **Именование и идентификаторы** — state_request name, effect keys, states[]
10. **Root model — особый случай** — timing API, handleInit, interface availability
11. **Типизация** — обход TS-ограничений в DKT declarations
12. **Тестирование** — 92 теста, never break the suite

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

## 4. comp attrs для производных данных

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

## 5. state_request lifecycle

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
8. effects.out apply fires, dispatches action
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

## 6. API injection через effects.api

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

## 7. Организация файлов

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

## 8. Refs для create-and-link

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

## 9. Именование и идентификаторы

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

## 10. Root model — особый случай

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

## 11. Типизация

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

## 12. Тестирование

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
- [ ] Tests pass: 0 failures, 0 regressions
