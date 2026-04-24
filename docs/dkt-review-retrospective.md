# Ретроспектива реализации dkt-code-review рекомендаций

> Дата: 2026-04-16
> Обновлено: 2026-04-20
> Scope: Реализация 8 рекомендаций из `docs/dkt-code-review.md` на кодовой базе `weather/src/models/`
> Коммиты: b0517a2 → d4c36e6 (9 коммитов, ~16 файлов)

---

## Содержание

0. [Status as of 2026-04-20](#0-status-as-of-2026-04-20)
1. [Сводка: план vs реальность](#1-сводка-план-vs-реальность)
2. [Неочевидные проблемы при реализации](#2-неочевидные-проблемы-при-реализации)
3. [Обнаруженные странности DKT](#3-обнаруженные-странности-dkt)
4. [Где DKT можно улучшить](#4-где-dkt-можно-улучшить)
5. [Сильные стороны DKT](#5-сильные-стороны-dkt)
6. [Слабые стороны DKT](#6-слабые-стороны-dkt)
7. [Статистика изменений](#7-статистика-изменений)

---

## 0. Status as of 2026-04-20

| Рек | Текущий статус | Комментарий |
|---|---|---|
| **1. 3-tier effects** | Частично устарел как формулировка проблемы | В weather исходный переход на `effects.api` / `effects.in` / `effects.out` реализован, но далее часть dispatch-result логики была заменена на `state_request.action` + `handleAttr:`. Раздел 9 теперь важнее как актуализация, чем как продолжение этой рекомендации. |
| **2. comp attrs** | Актуально и закреплено | `CurrentWeather`, `HourlyForecastSeries`, `DailyForecastSeries` уже используют `comp`, creation shapes обновлены. |
| **3. Дедупликация** | Актуально и завершено | Общие helper'ы вынесены, дубли удалены. |
| **4. Извлечение effects** | Актуально и завершено | `AppRoot/effects.ts` существует, split по файлам сохранён. |
| **5. API injection** | Актуально и завершено | `effects.api` используется; direct imports сетевых сервисов убраны. |
| **6. Убрать typeof** | Актуально и завершено | Большая часть redundant `typeof`-проверок удалена. |
| **7. Legacy attrs** | По-прежнему не требуется удаление | Эти attrs используются в UI и runtime; вывод о ложной тревоге остаётся верным. |
| **8. Разбить PopoverRouter** | Частично актуально | File-level split реализован и остаётся правильным компромиссом; model-level split по-прежнему упирается в cross-cutting actions. |

### Что устарело в самом документе

- Раздел 8 ниже теперь стоит читать как историческое объяснение, а не как текущую рекомендацию.
- Раздел 9 ниже в weather уже устарел: dispatch-result out-effects в этой форме заменены на `state_request.action` и `handleAttr:`.
- Пункт про `$now` остаётся полезным, но теперь это скорее общий runtime-паттерн DKT, а не обязательный workaround для weather.

---

## 1. Сводка: план vs реальность

| Рек | План | Реальность | Отклонение |
|---|---|---|---|
| **1. 3-tier effects** | Разделить 5 async effects.out на api/in/out | Сделано для всех 5 эффектов (AppRoot ×2, PopoverRouter ×2, WeatherLocation ×1). Потребовалось 3+ итерации отладки для AppRoot | **Значительное** — план не предупреждал о timing-проблемах с API на root-модели |
| **2. comp attrs** | Добавить comp на CurrentWeather, Hourly, Daily | Сделано. Потребовалось обновить `weatherSeed.ts` (creation shapes) и убрать производные поля из `applyWeather` | **Минимальное** — план был точным |
| **3. Дедупликация** | Убрать копии `isLocationSearchResult`, `toErrorMessage` | Сделано. `isLocationSearchResult` уже был exported, копии в AppRoot и PopoverRouter заменены на import | **Минимальное** |
| **4. Извлечение effects** | Вынести effects из AppRoot в отдельный файл | Сделано: `AppRoot/effects.ts`. Перенесены также приватные хелперы `isSavedSearchLocationsSyncRequest` и `getLocationSearchResults` | **Минимальное** — но doc предлагал только `effects-api.ts`, а реально пришлось выносить all 3 tiers |
| **5. API injection** | Перевести child-модели на effects.api | Уже сделано в рамках Rec 1. Все `self.getInterface()` были заменены на effects.api declarations | **Пропущен** — план не учёл, что Rec 1 и Rec 5 пересекаются |
| **6. Убрать typeof** | Убрать typeof-проверки на собственные input attrs | Сделано: 15 typeof-проверок убрано (9 ternary + 6 guard) | **Минимальное** |
| **7. Legacy attrs** | Проверить и удалить неиспользуемые attrs | Проверено: attrs используются в UI (WeatherCards.tsx) и worker-runtime. Удаление не требуется | **Ложное срабатывание** — план предполагал что attrs legacy, но они в активном использовании |
| **8. Разбить PopoverRouter** | Разделить на 3 модели: router shell + 2 behaviour | Разделено на файлы (helpers.ts + effects.ts), но **НЕ** на отдельные DKT-модели. Cross-cutting actions (buildSearchResetState пишет в attrs обоих поведений) сделали разбиение на nest-модели нецелесообразным | **Существенное** — реализован file-level split вместо model-level split |

---

## 2. Неочевидные проблемы при реализации

### 2.1. `state_request.name` — обязательное поле при нескольких state_requests

**Проблема**: DKT внутренне использует `req_item.name || "default_attrs_request_name"` для индексации state_request'ов. Если в одной модели два state_request БЕЗ явного `name`, оба получают одинаковый ключ и фреймворк падает с ошибкой `"attr request name should be uniq"`.

**Как обнаружено**: Runtime error при первом запуске после конвертации AppRoot на 3-tier (две state_request: `detectGeoLocation` + `syncSavedSearchLocationsData`).

**Вывод**: `name` — фактически required-поле, а не optional, когда модель содержит 2+ state_requests. Документация (если она есть) этого не отражает.

### 2.2. API timing на root-модели — effects.api vs state_request.api

**Проблема**: `effects.api` declarations (например `geoLocation` derived from `geoLocationSource`) ещё **не готовы** в момент `handleInit` root-модели. Если `state_request.api` указывает на **вычисленное** имя API (`api: 'geoLocation'`), DKT не может найти API и запрос зависает.

**Решение**: Для root model state_requests использовать **исходное** имя interface (`api: 'geoLocationSource'` вместо `api: 'geoLocation'`). Child-модели этой проблемы не имеют — они создаются после полной инициализации root.

**Вывод**: Асимметрия поведения между root и child моделями — неочевидна и не документирована.

### 2.3. effects.out timing — `api: ['self', 'apiName']` vs `api: ['self']`

**Проблема**: Effect с `api: ['self', 'geoLocation']` создаётся только когда **ОБА** API готовы. Если `autoGeoStatus` уже установлен в `'pending'` до момента создания эффекта, `trigger: ['autoGeoStatus']` **не сработает** повторно — значение не изменилось.

**Решение**: Использовать `api: ['self']` для trigger-эффектов, которые должны реагировать на начальное состояние. Позволить `requestState` внутри fn самому обработать отсутствие API.

**Вывод**: Семантика `api` в effects.out — это не зависимость для fn, а **gate для создания** эффекта. Это ключевое отличие от effects.api, где `api` — зависимость для factory.

### 2.4. Cross-cutting actions блокируют model-level split

**Проблема**: В PopoverRouter функция `buildSearchResetState` пишет одновременно в:
- search attrs (`searchQuery`, `searchStatus`, `searchError`, `searchResults`, `searchRequest`, `activeSearchRequestId`)
- currentLocation attrs (`currentLocationStatus`, `currentLocationError`, `currentLocationRequest`)
- router attr (`isEditingLocation`)

Это используется в 6+ actions из обеих "поведенческих" групп. Разбиение на отдельные DKT-модели потребовало бы координации через forwarding actions или shared state — усложнив код вместо упрощения.

**Решение**: File-level extraction (helpers.ts + effects.ts) вместо model-level split.

**Вывод**: Модель DKT атомарна по транзакциям — один action пишет в N attrs одной модели атомарно. Разбиение на nested models ломает эту атомарность.

### 2.5. `#name` convention для auto-forwarding interfaces

**Открытие**: В `effects.api` зависимость `['#locationSearch']` автоматически forwarded от `$root`. Это undocumented convention — нигде в коде weather не было явного forwarding, но `#` prefix заставляет DKT искать interface у root и пробрасывать к child.

---

## 3. Обнаруженные странности DKT

### 3.1. Implicit defaults с подводными камнями

| Поведение | Что происходит | Ожидание |
|---|---|---|
| `state_request` без `name` | Используется `"default_attrs_request_name"` | Ожидалось auto-naming по ключу effects.in |
| `effects.api` на root модели | Не готовы при handleInit | Ожидалось что effects.api декларации доступны сразу |
| `api` массив в effects.out | Gate для создания эффекта, не deps для fn | Ожидалось что это зависимости для fn |
| `trigger` на effects.out | Реагирует на **изменение**, не на текущее значение | Ожидалось что при создании эффекта trigger проверит текущее значение |

### 3.2. `requestState` ищет по state name, не по effect key

`self.requestState('autoDetectedLocation')` ищет state_request, у которого `states: ['autoDetectedLocation']`, а **не** effect с ключом `autoDetectedLocation`. Это значит:
- Effect key (`detectGeoLocation`) — для организации кода
- States array (`['autoDetectedLocation']`) — для runtime lookup
- Name (`'detectGeoLocation'`) — для уникальности в map

Три разных идентификатора для одной сущности.

### 3.3. `self.input(() => { ... })` — скрытый механизм синхронизации

В паттерне `resetRequestedState` + `requestState` вызов `self.input()` гарантирует, что reset attrs записаны через data bus **до** нового запроса. Без `self.input()` новый `requestState` может увидеть старый store и отбросить запрос как "уже выполненный".

Это критически важный implementation detail, который нигде не объяснён.

### 3.4. `parse` в state_request ДОЛЖЕН вернуть объект со ВСЕМИ ключами из `states[]`

Если `states: ['autoDetectedLocation']`, то `parse` ОБЯЗАН вернуть `{ autoDetectedLocation: ... }`. Несовпадение ключей приведёт к тихому провалу — attr не обновится.

---

## 4. Где DKT можно улучшить

### 4.1. Ошибки и валидация

| Что добавить | Приоритет | Описание |
|---|---|---|
| **Ошибка при дублировании state_request name** | Высокий | Сейчас: `"attr request name should be uniq"` — непонятно какой. Улучшить: указать оба конфликтующих names + модель |
| **Auto-name для state_request** | Высокий | Вместо `"default_attrs_request_name"` использовать ключ из effects.in: `effects.in.detectGeoLocation` → `name: 'detectGeoLocation'`. Устранит class of bugs |
| **Warning при api ссылке на несуществующий interface** | Средний | `state_request.api: 'geoLocation'` на root модели тихо зависает. Нужен warning с timeout или eager validation |
| **Проверка parse return keys vs states** | Средний | Если `parse` не возвращает ключ из `states[]`, DKT должен выдать ошибку, а не тихо проигнорировать |
| **Документация timing-модели** | Средний | Когда effects.api ready, когда handleInit fires, порядок инициализации root vs children |

### 4.2. Документация

| Тема | Что написать |
|---|---|
| **state_request lifecycle** | Полный цикл: requestState → wasReset guard → parse → attrs. Включая cancel-поведение |
| **effects.out.api семантика** | `api` — это gate для **создания** эффекта, не dependency injection. trigger проверяет **изменения** после создания |
| **`#name` interface forwarding** | Как root effects.api пробрасываются к children через `#` convention |
| **`self.input()` timing** | Зачем нужен, как работает data bus synchronization, паттерн reset + re-request |
| **Root vs child model asymmetry** | API timing, handleInit, interface availability |

### 4.3. Изменения поведения

| Что изменить | Обоснование |
|---|---|
| **Auto-naming state_request по ключу effects.in** | Устраняет обязательность `name` при 2+ requests. Обратная совместимость: если `name` указан явно — используется, иначе берётся ключ |
| **Eager resolve effects.api при handleInit root** | Root-модель — особый случай. effects.api должны быть доступны к моменту первого requestState |
| **`create_when: { api_inits: true }` + initial trigger** | При создании эффекта с `create_when: { api_inits: true }`, если trigger attr уже имеет non-null значение — выполнить fn сразу (fire-on-create semantics) |

---

## 5. Сильные стороны DKT

### 5.1. Атомарные транзакции actions
Action fn возвращает data-descriptor → фреймворк применяет все изменения атомарно. Нет промежуточных состояний, нет race conditions между attrs одной модели. Это фундаментально правильный дизайн.

### 5.2. Declarative state_request lifecycle
`requestState` / `resetRequestedState` + automatic `wasReset()` guard — элегантный механизм cancellation. Нет manual AbortController, нет stale response tracking. После перехода на 3-tier стало возможно удалить ручные `activeRequestId` attrs и `typeof` guards.

### 5.3. `$noop` conditional writes
Возможность условно пропустить запись через `$noop` — простой и мощный паттерн. Не нужен if/return{}/throw — просто `return noop`.

### 5.4. Comp attrs с deep rel dependencies
`['comp', ['< @all:temperatureC < hourlyForecastSeries'], buildSparkline]` — декларативная агрегация данных из children. Реактивная, кешируемая, чистая.

### 5.5. `hold_ref_id` / `use_ref_id` mechanism
Создание нод и связывание через refs в одном action — позволяет выражать сложные create-and-link операции как pure data-descriptors.

### 5.6. `mergeDcl` для composable model definitions
Возможность собирать модель из частей через `mergeDcl` — позволяет file-level separation без потери целостности.

---

## 6. Слабые стороны DKT

### 6.1. Отсутствие документации
Самая критичная проблема. Каждый из пунктов раздела 2 ("неочевидные проблемы") был обнаружен **только через runtime ошибки и экспериментирование**. Нет ни reference manual, ни migration guide, ни FAQ по типичным ошибкам.

### 6.2. Три идентификатора для одного state_request
- Effect key (организационный)
- `name` (для uniqueness в map)
- `states[]` entries (для lookup через requestState)

Это создаёт cognitive overhead и источник ошибок. В идеале — один идентификатор, остальные выводятся.

### 6.3. Implicit behaviors без runtime warnings
- `api` в effects.out — gate, не dep (нет warning при неправильном использовании)
- `trigger` не fires при создании (нет warning что начальное значение проигнорировано)
- `parse` return keys не валидируются против `states[]`

### 6.4. Root-model asymmetry
Effects.api на root модели ведут себя иначе, чем на child моделях. Нет explicit documentation этой разницы, нет compile-time или runtime предупреждения.

### 6.5. TypeScript typing gaps
- `model()` generic inference для action `fn` с `[deps, handler]` tuple form периодически ломается
- `payload: unknown` повсюду — нет способа задать тип payload декларативно
- Effects API types — полностью `unknown`, нет type-safe way объявить что `api` имеет метод `search()`

### 6.6. Монолитные модели при cross-cutting state
DKT не имеет нативного механизма для "partial state groups" внутри одной модели. Если 2 behaviour'а разделяют attrs через cross-cutting actions — их нельзя разнести в nested models без потери атомарности. Единственный workaround — file-level split.

---

## 7. Статистика изменений

### Коммиты

| Коммит | Описание | Файлов | +/- |
|---|---|---|---|
| 67177cb | feat: refreshState for weather loading | 4 | +87/-87 |
| 3b4ba74 | refactor: convert to 3-tier effects | 7 | +338/-251 |
| 10eb5aa | refactor: comp attrs on leaf models | 7 | +32/-34 |
| 11552d2 | refactor: deduplicate shared helpers | 4 | +18/-32 |
| 4a9dfb5 | refactor: extract AppRoot effects | 3 | +240/-231 |
| f464d86 | refactor: remove redundant typeof | 2 | +24/-60 |
| b5f8026 | docs: verify legacy attrs | 0 | empty |
| d4c36e6 | refactor: extract PopoverRouter modules | 3 | +434/-416 |

### Итоговое состояние файлов

| Файл | До (строк) | После (строк) | Δ |
|---|---|---|---|
| AppRoot.ts | ~550 | 508 (+ 228 effects.ts) | +186 (split) |
| WeatherLocation.ts | ~400 | 395 | -5 |
| SelectedLocationPopoverRouter.ts | ~750 | 392 (+ 204 + 172 extracted) | +18 (split) |
| CurrentWeather.ts | ~15 | 21 | +6 |
| HourlyForecastSeries.ts | ~14 | 19 | +5 |
| DailyForecastSeries.ts | ~18 | 27 | +9 |

### Метрики качества

- Тесты: 92/92 pass на каждом коммите (zero regressions)
- Удалённые дублирования: `isLocationSearchResult` (×2 копии), `toErrorMessage` (×2 копии)
- Удалённые typeof проверки: 15 штук
- Direct import networking функций: 1 → 0 (`fetchWeatherFromOpenMeteo` заменён на injected interface)
- `self.getInterface()` вызовов: 4 → 0 (заменены на effects.api declarations)


p.s.
для вызова out effect приходится использовать инвалидацию состояния (например с помощью значения $now) -> trigger

---

## 8. `$now` и идемпотентность action fn

> Примечание 2026-04-20: для weather этот раздел частично исторический. После перехода на `$fx_` многие случаи повторного запуска больше не требуют `Date.now()`-маркировки, но сам паттерн всё ещё важен там, где action result должен отличаться между вызовами.

### Проблема: inline_subwalker с пустым payload

`AppRoot.retryWeatherLoad` транслирует действие на все `weatherLocation` через `inline_subwalker`:

```ts
retryWeatherLoad: {
  to: {
    _retryAllLocations: ['<< @all:weatherLocation', { action: 'retryWeatherLoad', inline_subwalker: true }],
  },
  fn: () => ({ _retryAllLocations: {} }),
}
```

При повторных вызовах `fn` возвращает структурно-идентичный `{}` — dkt обнаруживает что "ничего не изменилось" и **не пропагирует** subwalker dispatch. Первый retry работает, второй и третий — нет.

### Решение: `$now` как уникализатор payload

```ts
fn: [
  ['$now'] as const,
  (_payload: unknown, now: number) => ({
    _retryAllLocations: { at: now },
  }),
],
```

`$now` гарантирует уникальный timestamp на каждый вызов → dkt видит изменённый payload → subwalker dispatch проходит.

### Паттерн

Любое действие, которое должно "просто сработать" при каждом вызове (retry, refresh, ping), требует `$now` в зависимостях — иначе dkt может оптимизировать повторный вызов как no-op. Это касается:
- action fn с пустым или статическим payload
- inline_subwalker проброс в children
- trigger-зависимости в effects.out

Это фундаментальная особенность: dkt — **реактивный** фреймворк, action fn — **чистая функция от состояния**. Для императивного "просто сделай" нужен уникальный маркер в зависимостях.

---

## 9. Проблема «dispatch result» out-effects

> Примечание 2026-04-20: для weather этот раздел уже в основном устарел. Последние изменения перевели маршрутизацию результата state_request на `state_request.action` + `handleAttr:` и meta-error attrs, поэтому классические dispatch-result out-effects здесь больше не являются текущим паттерном.

### Суть паттерна

После перехода на 3-tier effects и `$fx_` в кодовой базе остались out-effects, единственная задача которых — прочитать результат `state_request` и вызвать `self.dispatch()` для маршрутизации ok/error в разные actions. Это **императивный мост** между декларативным state_request и декларативными actions.

Затронутые out-effects:

| Out-effect | Модель | Что делает |
|---|---|---|
| `applyDetectedGeoLocation` | AppRoot/effects.ts | `autoDetectedLocation` → `applyAutoDetectedLocation` / `failAutoGeoDetection` |
| `applyFetchedWeatherData` | WeatherLocation.ts | `weatherData` → `applyWeather` / `failWeather` |
| `applySearchResponseData` | PopoverRouter/effects.ts | `searchResponseData` → `applyLocationSearchResponse` / `failLocationSearchResponse` |
| `applyCurrentLocationResult` | PopoverRouter/effects.ts | `currentLocationResponseData` → `applyCurrentLocationLookupResponse` / `failCurrentLocationLookupResponse` |
| `applySavedSearchLocationsSyncData` | AppRoot/effects.ts | `savedSearchLocationsSyncResult` → `applySavedSearchLocationsSyncResult` / `failSavedSearchLocationsSyncRequest` |

### Анатомия проблемы на примере `applyDetectedGeoLocation`

Полная цепочка geo-detection:

```
handleInit step 6
  → $fx_autoDetectedLocation { intent: 'request' }
    → detectGeoLocation state_request (effects.in)
      → api.detectLocation()
        → parse: { autoDetectedLocation: result }
          → attr autoDetectedLocation = { ok, data } | { ok: false, message }
            → applyDetectedGeoLocation (effects.out)    ← ПРОБЛЕМНЫЙ СЛОЙ
              → self.dispatch('applyAutoDetectedLocation', result.data)
                → action: sets autoGeoStatus='done', inline_subwalker → applyAutoLocation
                  → SelectedLocation: create WeatherLocation + $fx_weatherData
              ИЛИ
              → self.dispatch('failAutoGeoDetection', result.message)
                → action: sets autoGeoStatus='error', autoGeoError=message
```

Out-effect `applyDetectedGeoLocation` занимает ~15 строк кода:

```ts
applyDetectedGeoLocation: {
  api: ['self'],
  trigger: ['autoDetectedLocation'],
  require: ['autoDetectedLocation'],
  create_when: { api_inits: true },
  is_async: true,
  fn: [
    ['autoDetectedLocation'] as const,
    async (self, _task, autoDetectedLocation) => {
      const result = autoDetectedLocation as { ok: boolean; data?: unknown; message?: string }
      if (result.ok) {
        await self.dispatch('applyAutoDetectedLocation', result.data)
      } else {
        await self.dispatch('failAutoGeoDetection', result.message)
      }
    },
  ],
}
```

Этот код:
- Не делает async работы (dispatch — единственный вызов)
- Не использует внешние API (только `self`)
- Является чистой маршрутизацией по полю `ok`
- Повторяется с минимальными вариациями во всех 5 случаях

### Почему это проблема

1. **Boilerplate**: 5 почти-идентичных out-effects по ~15 строк = ~75 строк кода, которые делают одно: `if (result.ok) dispatch(A) else dispatch(B)`
2. **`is_async: true`**: каждый dispatch result effect объявлен как async, хотя реальной async-логики нет — `self.dispatch()` мог бы быть sync
3. **`create_when: { api_inits: true }`**: нужен только чтобы гарантировать создание эффекта на root — но сам эффект не использует никакого API кроме `self`
4. **Скрытая связность**: out-effect знает имена actions (`'applyAutoDetectedLocation'`, `'failAutoGeoDetection'`) через строковые литералы — нет compile-time проверки
5. **Промежуточный attr**: `autoDetectedLocation` существует исключительно как канал данных между state_request и out-effect → action. Если бы routing ok/error был декларативным, этот attr не нужен

### Что могло бы заменить этот паттерн

Идеальное решение на уровне DKT — декларативная маршрутизация результата state_request:

```ts
// Гипотетический синтаксис — НЕ реализован в DKT
effects: {
  in: {
    detectGeoLocation: {
      type: 'state_request',
      states: ['autoDetectedLocation'],
      api: 'geoLocationSource',
      // Декларативный routing вместо out-effect
      on_ok: { action: 'applyAutoDetectedLocation', field: 'data' },
      on_error: { action: 'failAutoGeoDetection', field: 'message' },
      fn: [/* ... */],
    },
  },
}
```

Это устранило бы все 5 dispatch result out-effects и промежуточные attrs.

### Текущий статус

Dispatch result out-effects остаются в коде. Они работают корректно, но представляют собой самый объёмный и наименее декларативный слой в 3-tier effects architecture. Это кандидат №1 для следующего этапа упрощения DKT framework.
