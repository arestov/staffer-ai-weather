# Ревью React-кода: производительность, хуки, организация

## Общая оценка

Кодовая база хорошо структурирована: кастомная система синхронизации (`dkt-react-sync`) грамотно использует `useSyncExternalStore`, утилитные функции вынесены за пределы компонентов, cleanup-функции написаны аккуратно. Ниже — конкретные проблемы и рекомендации.

---

## 1. useEffect — аудит всех использований

В проекте **8 useEffect** и **1 useLayoutEffect**. Большинство из них — легитимные случаи (подписки на DOM-события, императивное управление фокусом/попапами, инициализация анимаций). Однако несколько эффектов можно улучшить или заменить.

### 1.1. `SelectedLocationPopoverLayer` — 3 useEffect + 1 useLayoutEffect

**Файл:** `src/components/SelectedLocationPopover.tsx`

| Эффект | Назначение | Зависимости | Вердикт |
|--------|-----------|-------------|---------|
| useEffect #1 (строка ~133) | Показ/скрытие popover через Popover API | `[currentNodeId, currentScope]` | ✅ Легитимный — императивный DOM API |
| useEffect #2 (строка ~167) | Закрытие по Escape | `[clearCurrent, currentNodeId, currentScope]` | ⚠️ Можно заменить на `onKeyDown` на элементе |
| useEffect #3 (строка ~187) | Управление фокусом (focus при открытии, возврат при закрытии) | `[currentNodeId, currentScope]` | ⚠️ Можно частично упростить |
| useLayoutEffect (строка ~377) | Прокрутка к выбранной локации | `[selectedLocationId]` | ✅ Легитимный — layout-зависимая операция |

**Рекомендации:**

- **Escape-handler**: вместо `useEffect` с `document.addEventListener('keydown')` можно использовать `onKeyDown` на самом popover-элементе. Это устранит подписку/отписку и будет декларативнее:
  ```tsx
  <section
    ref={popoverRef}
    onKeyDown={(e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        clearCurrent()
      }
    }}
    ...
  >
  ```

- **Консолидация эффектов #1 и #3**: оба зависят от `[currentNodeId, currentScope]` и управляют DOM-состоянием попапа. Их можно объединить в один эффект, что уменьшит количество рендер-циклов.

### 1.2. `AppHeader` — 1 useEffect

**Файл:** `src/components/AppHeader.tsx`

- Подписка на `pointerdown` и `keydown` для закрытия панели по клику снаружи / по Escape.
- Зависимость `[isOpen]`, cleanup корректный.
- **Вердикт:** ✅ Легитимный. Можно заменить на Popover API (`popover="auto"`) — браузер сам обработает light-dismiss.

### 1.3. `useShape` — 1 useEffect

**Файл:** `src/dkt-react-sync/hooks/useShape.ts`

- Монтирует shape-определение на scope, cleanup через `runtime.mountShape()`.
- **Вердикт:** ✅ Легитимный — подписка на внешнюю систему.

### 1.4. `useManyAttrs` — 1 useEffect

**Файл:** `src/dkt-react-sync/hooks/useManyAttrs.ts`

- Управляет подписками на список many-relation и на атрибуты каждого элемента.
- **Вердикт:** ✅ Легитимный, но есть проблемы производительности (см. раздел 2).

### 1.5. `useLottieWeatherIcon` — 1 useEffect

**Файл:** `src/lottie/useLottieWeatherIcon.ts`

- Загружает Lottie-модуль, создаёт canvas, инициализирует анимацию.
- Паттерн `cancelled` flag для предотвращения race condition.
- **Вердикт:** ✅ Легитимный — единственный способ управлять императивной библиотекой.

### 1.6. `useMountedRelShape` — 1 useEffect

**Файл:** `src/dkt-react-sync/hooks/useNamedSessionRouter.ts`

- Аналогичен `useShape` — монтирует shape по имени relation.
- **Вердикт:** ✅ Легитимный.

---

## 2. Производительность — критические проблемы

### 2.1. `useManyAttrs` — самый дорогой хук

**Проблема:** При изменении *любого* элемента в many-relation, `readAll()` перечитывает атрибуты *всех* элементов и вызывает `setData()` с новым массивом. Каждый вызов `setData` — это ре-рендер родительского компонента + всех его потомков.

```ts
const readAll = () => {
  const items = runtime.readMany(scope, rel)
  setData(items.map((item) => runtime.readAttrs(item, fields))) // ← новый массив каждый раз
  // ...
}
```

**Где используется:**
- `WeatherGraph` → `WeatherUpdateTimestamp` — читает `['name', 'weatherFetchedAt']` всех локаций
- `WeatherSparkline` → `HourlySparklineSection` — читает 8 полей всех hourly-записей
- `WeatherSparkline` → `DailySparklineSection` — читает 9 полей всех daily-записей

**Рекомендации:**
1. Добавить shallow-сравнение данных перед вызовом `setData` — если атрибуты не изменились, не обновлять стейт:
   ```ts
   const readAll = () => {
     const items = runtime.readMany(scope, rel)
     const next = items.map((item) => runtime.readAttrs(item, fields))
     setData((prev) => shallowEqualArray(prev, next) ? prev : next)
   }
   ```
2. Как альтернатива — перенести `useManyAttrs` на `useSyncExternalStore` (как `useAttrs`), чтобы React сам решал, когда ре-рендерить. Это устранит промежуточное состояние через `useState` + `useEffect`.

### 2.2. `useAttrs` — normalizeFields на каждый рендер

```ts
export const useAttrs = (fields: readonly string[]) => {
  const normalizedFields = normalizeFields(fields) // ← новый массив каждый рендер
  const shape = getAttrsShape(normalizedFields)
  // ...
  return useSyncExternalStore(
    (listener) => runtime.subscribeAttrs(resolvedScope, normalizedFields, listener),
    () => runtime.readAttrs(resolvedScope, normalizedFields),
    // ...
  )
}
```

**Проблема:** `normalizeFields` возвращает новый массив каждый рендер. `useSyncExternalStore` получает новые функции subscribe/getSnapshot (замыкания на `normalizedFields`), что приводит к повторной подписке каждый рендер.

**Рекомендация:** Мемоизировать `normalizedFields`:
```ts
const fieldsKey = fields.join('\x00')
const normalizedFields = useMemo(() => normalizeFields(fields), [fieldsKey])
```

### 2.3. `useActions` — нестабильная ссылка

```ts
export const useActions = () => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()

  return {  // ← новый объект каждый рендер
    dispatch(actionName: string, payload?: unknown) {
      runtime.dispatch(actionName, payload, scope)
    },
  }
}
```

**Проблема:** Каждый вызов возвращает новый объект. Если потребители передают `dispatch` как проп, это сломает мемоизацию дочерних компонентов.

**Рекомендация:**
```ts
export const useActions = () => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()

  const dispatch = useCallback(
    (actionName: string, payload?: unknown) => {
      runtime.dispatch(actionName, payload, scope)
    },
    [runtime, scope],
  )

  return useMemo(() => ({ dispatch }), [dispatch])
}
```

### 2.4. `useNamedSessionRouter` — нестабильный возвращаемый объект

```ts
export const useNamedSessionRouter = (routerName: string) => {
  // ...
  return {
    rootScope,
    routerScope,
    currentScope,
    currentNodeId: currentScope?._nodeId ?? null,
    clearCurrent() { /* ... */ },  // ← новая функция каждый рендер
    openResource(contextModelId: string) { /* ... */ },  // ← новая функция каждый рендер
  }
}
```

**Рекомендация:** Стабилизировать `clearCurrent` и `openResource` через `useCallback`, а весь объект — через `useMemo`.

### 2.5. Отсутствие `React.memo`

Ни один компонент в проекте не обёрнут в `React.memo`. Для текущего масштаба приложения это допустимо, но стоит добавить для:

| Компонент | Причина |
|-----------|---------|
| `SelectedLocationSearchPanel` | Чистый презентационный компонент, ~15 пропсов, рендерится внутри часто обновляемого popover |
| `SelectedLocationPopoverHeader` | Простой компонент, ре-рендерится при каждом изменении родителя |
| `WeatherReadoutFallback` / `ForecastPanelsFallback` | Статические fallback-компоненты |

### 2.6. Обработчики событий в `SelectedLocationPopover`

Все обработчики (`handleSubmitSearch`, `handleRetrySearch`, `handleSelectLocation`, `handleQueryChange`, `forgetSearchLocation`, `handleUseCurrentLocation`, inline-стрелки в `onCancel`, `onStartEdit`) создаются заново на каждый рендер.

Если добавить `React.memo` на `SelectedLocationSearchPanel`, эти нестабильные ссылки сведут его мемоизацию к нулю. Обработчики нужно обернуть в `useCallback`.

---

## 3. Организация компонентов

### 3.1. Структура — хорошо

- `src/components/` — UI-компоненты приложения
- `src/dkt-react-sync/` — кастомный runtime, хуки, контексты, shapes
- `src/lottie/` — изоляция Lottie-логики
- `src/models/` — модели данных

Разделение ответственности выдержано хорошо.

### 3.2. `SelectedLocationPopover.tsx` — слишком большой файл

**~600 строк**, содержит:
- `SelectedLocationPopoverLayer` — управление попапом, 3 useEffect, portal
- `SelectedLocationPopover` — основной контент попапа, debounce, dispatch
- `SelectedLocationPopoverSearchTrigger` — кнопка-триггер
- `SelectedLocationPopoverHeader` — шапка с кнопкой закрытия
- `SelectedLocationPopoverWeatherSection` — обёртка для погодной секции
- `SelectedLocationPopoverWeatherSectionInner` — отображение погоды

**Рекомендация:** Вынести вспомогательные компоненты в отдельные файлы или хотя бы сгруппировать:
```
components/
  selected-location-popover/
    SelectedLocationPopoverLayer.tsx
    SelectedLocationPopover.tsx
    SelectedLocationPopoverHeader.tsx
    SelectedLocationPopoverWeatherSection.tsx
```

### 3.3. Дублирование логики типизации `routerAttrs`

В `SelectedLocationPopover` каждый атрибут из `useAttrs` вручную приводится к типу:
```ts
const isEditingLocation = Boolean(routerAttrs.isEditingLocation)
const searchQuery = typeof routerAttrs.searchQuery === 'string' ? routerAttrs.searchQuery : ''
const searchStatus = typeof routerAttrs.searchStatus === 'string' ? routerAttrs.searchStatus : 'idle'
// ... ещё 5 таких строк
```

Аналогичный паттерн в `WeatherLocationInner`, `WeatherCards`.

**Рекомендация:** Создать типизированную обёртку или утилиту:
```ts
const str = (val: unknown, fallback = ''): string =>
  typeof val === 'string' ? val : fallback

// Использование:
const searchQuery = str(routerAttrs.searchQuery)
const searchStatus = str(routerAttrs.searchStatus, 'idle')
```

### 3.4. `WeatherCards.tsx` — хорошая организация

Утилитные функции (`renderTemp`, `formatUpdatedAt`, `dedupeLabels`) вынесены за пределы компонентов. Shape-определения на уровне модуля. Компоненты-заглушки отделены.

### 3.5. Нет code-splitting

Ни один компонент не использует `React.lazy` / `Suspense`. Для текущего размера приложения это некритично, но при росте стоит рассмотреть lazy-загрузку `SelectedLocationPopoverLayer` (тяжёлый компонент, открывается по действию пользователя) и Lottie-иконок.

---

## 4. Паттерны хуков — что хорошо

| Паттерн | Где | Оценка |
|---------|-----|--------|
| `useSyncExternalStore` для внешнего стейта | `useAttrs`, `useSyncRoot`, `One`, `Many`, `RootScope` | ✅ Отлично — правильный способ подписки на внешние хранилища |
| Cancelled-flag для async | `useLottieWeatherIcon` | ✅ Предотвращает race condition |
| `Object.freeze` в `defineShape` | `dkt-react-sync/shape` | ✅ Иммутабельность shape-объектов |
| Stable keys в `Many` | `_nodeId` как key | ✅ Корректная идентификация элементов |
| Утилиты вне компонентов | `WeatherCards`, `WeatherSparkline` | ✅ Не пересоздаются при рендере |
| Cleanup во всех эффектах | Все 8 useEffect | ✅ Нет утечек подписок |

---

## 5. Сводка рекомендаций по приоритету

### Высокий приоритет

1. **`useManyAttrs`**: добавить shallow-сравнение перед `setData`, или мигрировать на `useSyncExternalStore`
2. **`useAttrs`**: мемоизировать `normalizedFields` через `useMemo` чтобы избежать повторных подписок
3. **`useActions`**: стабилизировать возвращаемый объект через `useCallback` + `useMemo`

### Средний приоритет

4. **`SelectedLocationPopoverLayer`**: объединить эффекты #1 и #3 (одинаковые зависимости), заменить Escape-эффект на `onKeyDown`
5. **`useNamedSessionRouter`**: стабилизировать `clearCurrent` / `openResource` через `useCallback`
6. **`SelectedLocationPopover`**: обернуть обработчики в `useCallback`

### Низкий приоритет

7. **`React.memo`** для `SelectedLocationSearchPanel`, fallback-компонентов
8. **Разбить** `SelectedLocationPopover.tsx` на подфайлы
9. **Утилита** для типизации attr-значений (`str()`, `bool()`)
10. **`React.lazy`** для `SelectedLocationPopoverLayer` и Lottie

---

## 6. Где useEffect оправдан, а где нет

### ✅ useEffect оправдан

- **Подписка на DOM-события** (`AppHeader`, `SelectedLocationPopoverLayer` escape)  — хотя Escape можно заменить на `onKeyDown`
- **Императивный DOM API** (Popover API — `showPopover`/`hidePopover`)
- **Подписка на внешнюю систему** (`useShape`, `useManyAttrs`, `useMountedRelShape`)
- **Инициализация императивных библиотек** (`useLottieWeatherIcon`)

### ❌ useEffect не нужен

- В проекте **нет** классических антипаттернов: нет useEffect для data fetching, нет useEffect для derived state, нет useEffect для преобразования пропсов в стейт.
- Единственное улучшение — замена Escape-эффекта на декларативный `onKeyDown`.

### Вывод

Код придерживается рекомендации «You Might Not Need an Effect» — все эффекты работают с реальными side-effects (DOM API, внешние подписки, анимации). Грубых нарушений нет.

---

## 7. DKT-протокол vs React-слой: где теряется гранулярность

### Как работает DKT-протокол

DKT — бинарный синхронизационный протокол с **field-level гранулярностью**:

- Бэкенд присылает только изменённые поля: `[nodeId, attrKey, attrValue, ...]`
- `ReactSyncReceiver` хранит in-memory граф узлов (`Map<nodeId, { attrs, rels }>`)
- Подписки организованы **по отдельным полям**: `Map<nodeId, Map<fieldName, Set<Listener>>>`
- При обновлении `flushDirtyNamed()` нотифицирует **только** listener-ы затронутых полей
- `readAttrs()` кеширует результаты по ключу `nodeId + fieldNames` и возвращает **ту же ссылку**, если значения не изменились (`Object.is` проверка по каждому полю)

```
Бэкенд: "у узла X поле temperature изменилось на 25"
  → Receiver: dirty = {X: ['temperature']}
  → flushDirty: нотифицирует только listener-ы поля temperature узла X
  → readAttrs(X, ['temperature']): возвращает кешированный объект или новый
```

**Вывод:** Протокол и receiver реализованы очень эффективно. Проблемы возникают на уровне React-хуков, которые не полностью используют эту гранулярность.

### Проблема `useAttrs` — лишние циклы subscribe/unsubscribe

```ts
// useAttrs.ts
const normalizedFields = normalizeFields(fields)  // ← новый массив каждый рендер

return useSyncExternalStore(
  (listener) => runtime.subscribeAttrs(resolvedScope, normalizedFields, listener),
  //                                                   ^^^^^^^^^^^^^^^^
  // замыкание захватывает новый normalizedFields → новая функция → React переподписывается
  () => runtime.readAttrs(resolvedScope, normalizedFields),
)
```

**Что происходит:**
1. Компонент рендерится
2. `normalizeFields(fields)` создаёт **новый массив** (даже если поля те же)
3. Замыкания `subscribe` и `getSnapshot` — **новые функции** (захватывают новый массив)
4. `useSyncExternalStore` видит новый `subscribe` → **отписывается от старого, подписывается заново**
5. На стороне receiver это означает: удалить listener из `attrSubsByNodeId`, добавить заново

**Реальный ущерб:** Ре-рендеров это не вызывает (receiver кеширует snapshot и возвращает ту же ссылку), но каждый рендер любого компонента с `useAttrs` — это бесполезный цикл unsubscribe + subscribe на receiver-е. При частых обновлениях (например, sparkline с 24+ hourly элементами) это заметная нагрузка на GC.

**Исправление:**
```ts
export const useAttrs = (fields: readonly string[]) => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()
  const fieldsKey = fields.join('\x00')
  const normalizedFields = useMemo(() => normalizeFields(fields), [fieldsKey])
  // теперь замыкания стабильны между рендерами, если поля не менялись
  // ...
}
```

### Проблема `useManyAttrs` — потеря гранулярности DKT

Это **главная архитектурная проблема**. DKT присылает `"у узла X поле Y изменилось"`, а `useManyAttrs` в ответ перечитывает **весь список**.

```
DKT: "у hourly[3].temperature изменилось на 18°C"
  → receiver: нотифицирует listener поля temperature узла hourly[3]
  → useManyAttrs: readAll() → перечитывает ВСЕ 24 hourly-элемента
  → setData(newArray) → ре-рендер родителя + всех потомков
```

**Почему так:**

```ts
// useManyAttrs.ts
const readAll = () => {
  const items = runtime.readMany(scope, rel)        // все элементы
  setData(items.map(item => runtime.readAttrs(item, fields)))  // новый массив
  //      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  // Array.map() всегда создаёт новый массив
  // setData() всегда вызывает ре-рендер (новая ссылка !== старая)

  // Подписываемся на attrs каждого элемента → вызовут тот же readAll
  for (const item of items) {
    cleanups.set(item._nodeId, runtime.subscribeAttrs(item, fields, readAll))
    //                                                              ^^^^^^^
    // ВСЕ per-item подписки ведут к ОДНОЙ функции readAll
  }
}
```

**Что теряется:**
- Receiver знает, что изменился только `hourly[3].temperature`
- Receiver нотифицирует только listener этого конкретного поля
- Но listener — это `readAll`, который перечитывает **все 24 элемента**
- `items.map(...)` создаёт новый массив → `setData` → React ре-рендерит

**При этом** `readAttrs()` receiver-а для неизменённых элементов возвращает кешированные ссылки. Но `Array.map()` оборачивает их в новый массив, и `useState` не делает shallow compare.

### Почему `useManyAttrs` использует `useState + useEffect`, а не `useSyncExternalStore`

Причина в том, что `useManyAttrs` управляет **двухуровневыми подписками**: на список (какие элементы) + на атрибуты каждого элемента. Это динамический набор подписок, который меняется при добавлении/удалении элементов. `useSyncExternalStore` предполагает одну стабильную подписку, что не подходит для этого случая напрямую.

Однако можно обернуть двухуровневую подписку в единый subscribe/getSnapshot контракт, если управлять ею через ref:

```ts
// Концептуальный пример — миграция на useSyncExternalStore
export const useManyAttrs = (rel: string, fields: readonly string[]) => {
  const runtime = useReactScopeRuntime()
  const scope = useScope()
  const fieldsKey = fields.join('\x00')

  // ... useShape ...

  const storeRef = useRef<ManyAttrsStore | null>(null)

  // Ленивая инициализация store
  if (!storeRef.current || storeRef.current.scope !== scope
      || storeRef.current.rel !== rel || storeRef.current.fieldsKey !== fieldsKey) {
    storeRef.current?.dispose()
    storeRef.current = new ManyAttrsStore(runtime, scope, rel, fields, fieldsKey)
  }

  const store = storeRef.current

  useEffect(() => () => { store.dispose() }, [store])

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

// Store инкапсулирует двухуровневые подписки
class ManyAttrsStore {
  private snapshot: readonly Record<string, unknown>[] = EMPTY_DATA
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    if (!this.active) this.activate()
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = () => this.snapshot

  private rebuildSnapshot() {
    const items = this.runtime.readMany(this.scope, this.rel)
    const next = items.map(item => this.runtime.readAttrs(item, this.fields))

    // shallow compare: если все элементы — те же ссылки, не обновляем snapshot
    if (next.length === this.snapshot.length &&
        next.every((item, i) => item === this.snapshot[i])) {
      return  // ← НЕ нотифицируем React, snapshot стабильный
    }

    this.snapshot = next
    for (const l of this.listeners) l()
  }
}
```

**Ключевое отличие:** `getSnapshot` возвращает стабильную ссылку, пока данные не изменились. React вызывает `getSnapshot` и сравнивает с предыдущим значением (`Object.is`). Если ссылка та же — ре-рендера нет.

### Таблица: где DKT-гранулярность доходит до React, а где теряется

| Хук | DKT гранулярность | React-слой | Потери |
|-----|-------------------|------------|--------|
| `useAttrs` | ✅ Per-field подписка, кешированный snapshot | ⚠️ Лишние subscribe/unsubscribe циклы из-за нестабильного `normalizedFields` | Нагрузка на GC, нет лишних ре-рендеров |
| `useManyAttrs` | ✅ Per-field подписка | ❌ Любое изменение → `readAll` → новый массив → ре-рендер | Полная потеря гранулярности, каскадные ре-рендеры |
| `useShape` | ✅ mount/unmount shape | ✅ Корректно | Нет потерь |
| `One` / `Many` (компоненты) | ✅ Per-rel подписка | ✅ `useSyncExternalStore` со стабильными snapshot-ами | Нет потерь |
| `useNamedSessionRouter` | ✅ Per-rel подписка | ✅ `useSyncExternalStore` | Нет потерь |

### Рекомендации

1. **`useAttrs`** — мемоизировать `normalizedFields` через `useMemo` с `fieldsKey`. Минимальное изменение, убирает subscribe-churn.

2. **`useManyAttrs`** — мигрировать на `useSyncExternalStore` с shallow compare массива snapshot-ов. Receiver уже возвращает стабильные ссылки для неизменённых элементов, поэтому `snapshot[i] === prevSnapshot[i]` будет `true` для всех элементов, кроме реально изменившегося. Это восстановит field-level гранулярность DKT на уровне React.

3. **Альтернатива для `useManyAttrs`** (без переписывания хука) — добавить shallow compare перед `setData`:
   ```ts
   const readAll = () => {
     const items = runtime.readMany(scope, rel)
     const next = items.map(item => runtime.readAttrs(item, fields))
     setData(prev =>
       prev.length === next.length && prev.every((v, i) => v === next[i])
         ? prev
         : next
     )
   }
   ```
   Это работает, потому что `readAttrs` receiver-а уже кеширует объекты.
