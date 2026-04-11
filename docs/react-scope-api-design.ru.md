# React Scope API Для Weather

## Назначение

Этот документ описывает публичный React API поверх нового page-side sync runtime.

Цель API:

- скрыть `node_id`
- оставить traversal только top-down
- связать shape с React component type
- дать понятные primitives для чтения attrs и rels

Опора:

- runtime internals из [react-sync-runtime-design.ru.md](./react-sync-runtime-design.ru.md)

## Главная идея

React-компонент не знает про `node_id`. Он знает только:

- я рендерюсь в некотором текущем scope
- у scope можно читать attrs
- из scope можно идти вниз по `rel_name`
- в scope можно диспатчить действия

То есть публичный surface должен быть небольшим:

- `RootScope`
- `useAttrs(fields)`
- `useActions()`
- `One`
- `Many`
- `Path`
- `defineShape`

## Не-цели

- не давать `getNode(id)`
- не давать `useNode(id)`
- не давать leaf-компонентам произвольный graph traversal

## RootScope

### Семантика

`RootScope` делает root scope текущего `SessionRoot` доступным через React context.

### Пример

```tsx
<RootScope>
  <Dashboard />
</RootScope>
```

### Ответственность

- взять `rootScope` у runtime
- положить его в `ScopeContext`
- инициировать root-level shape usage для subtree

## useAttrs

### Семантика

`useAttrs(fields)` читает attrs только текущего scope и подписывается только на них.

### Пример

```tsx
const { name, status } = useAttrs(['name', 'status'])
```

### Требования

- работает только внутри `ScopeContext`
- не подписывает компонент на весь runtime целиком
- update неиспользуемого attr не должен вызывать rerender

### Реализация

Через `useSyncExternalStore`:

- `subscribeAttrs(scope, fields, listener)`
- `readAttrs(scope, fields)`

Желательно нормализовать `fields` внутри hook:

- dedupe
- sort

## useActions

### Семантика

Возвращает действия текущего scope.

### Минимальный контракт

```ts
type ScopeActions = {
  dispatch(actionName: string, payload?: unknown): void
}
```

### Рекомендация

В v1 держать только `dispatch`. Не открывать сразу:

- `pass`
- `updateLocal`
- app-global actions

Если нужен action вне текущего scope, он должен идти через отдельный session/runtime API, а не через `useActions`.

## One

### Семантика

`One rel="foo"` переходит от текущего scope к одному дочернему scope по relation `foo`.

### Пример

```tsx
<One rel="current_app_user">
  <ProfileCard />
</One>
```

### Контракт

- подписка только на relation `foo`
- если relation `null`, рендерить `fallback` или `null`
- если relation unexpectedly many, это ошибка контракта

### Пример props

```ts
type OneProps = {
  rel: string
  children: React.ReactNode
  fallback?: React.ReactNode
}
```

## Many

### Семантика

`Many rel="items-list"` рендерит список дочерних scope.

### Пример

```tsx
<Many rel="items-list" item={WorkspaceItem} />
```

### Контракт

- подписка только на состав и порядок relation
- attrs item не должны ререндерить весь list container
- key строится по внутренней identity узла, но наружу не торчит

### Пример props

```ts
type ManyProps = {
  rel: string
  item: React.ComponentType
  empty?: React.ReactNode
}
```

В v1 не открывать лишние пропсы вроде `getNodeId` или `selector`.

## Path

### Семантика

`Path` это sugar над вложенными `One`.

### Пример

```tsx
<Path rels={['current_app_user', 'workspaces', 'activeWS']}>
  <Many rel="services-list" item={ServiceItem} />
</Path>
```

Эквивалент:

```tsx
<One rel="current_app_user">
  <One rel="workspaces">
    <One rel="activeWS">
      <Many rel="services-list" item={ServiceItem} />
    </One>
  </One>
</One>
```

### Рекомендация

`Path` не должен иметь отдельную сложную подписочную логику. Это просто композиция `One`.

## defineShape

### Зачем нужен

`defineShape` нужен, чтобы:

- декларативно описать данные, нужные subtree
- привязать это описание к React component type
- публиковать usage graph без `BlankAppRootView`

### Минимальный формат

Для v1 лучше взять простой формат:

```ts
type ShapeSpec = {
  attrs?: readonly string[]
  one?: Record<string, ShapeSpec>
  many?: Record<string, ShapeSpec>
}
```

### Пример

```ts
const ServiceItemShape = defineShape({
  attrs: ['name', 'isActive', 'unreadCount'],
})

const WorkspaceShape = defineShape({
  attrs: ['title'],
  many: {
    'services-list': ServiceItemShape,
  },
})
```

### Требования

- shape immutable
- shape cacheable
- shape declaration component-level
- shape request instance-level

## Привязка shape к компоненту

Нужен удобный helper, чтобы shape жил рядом с компонентом:

```ts
shapeOf(ServiceItem, ServiceItemShape)
```

или альтернативно:

```ts
ServiceItem.shape = ServiceItemShape
```

Рекомендация:

- сделать явный helper `shapeOf(Component, shape)`
- не полагаться только на mutation function object

## Базовый пример API

```tsx
const ServiceItemShape = defineShape({
  attrs: ['name', 'isActive', 'unreadCount'],
})

function ServiceItem() {
  const { name, isActive, unreadCount } = useAttrs([
    'name',
    'isActive',
    'unreadCount',
  ])

  const { dispatch } = useActions()

  return (
    <button
      data-active={String(isActive)}
      onClick={() => dispatch('openService')}
    >
      {name} ({unreadCount})
    </button>
  )
}

shapeOf(ServiceItem, ServiceItemShape)

function App() {
  return (
    <RootScope>
      <Path rels={['current_app_user', 'workspaces', 'activeWS']}>
        <Many rel="services-list" item={ServiceItem} />
      </Path>
    </RootScope>
  )
}
```

## Как API сохраняет top-down дисциплину

Разрешенные сценарии:

- `Path`
- вложенные `One`
- `Many`
- derived rel на model layer

Запрещенные сценарии:

- `useNode(id)`
- `getNode(id)`
- случайный доступ к graph из leaf-компонента

Если leaf-компонент требует слишком далекий кусок graph:

- либо поднимать traversal выше
- либо добавлять более близкий relation в model/session graph

## Ошибки контракта

В dev режиме нужно падать явно, если:

- `useAttrs` вызван вне `ScopeContext`
- `One` получил many relation
- `Many` получил one relation
- shape declaration противоречит runtime usage

В production можно деградировать мягче:

- `One` рендерит `fallback`
- `Many` рендерит `empty`

## Пошаговая реализация

### Этап 1. Scope context

- создать `ScopeContext`
- создать `RootScope`
- добавить internal `useScope`

### Этап 2. Hooks

- реализовать `useAttrs`
- реализовать `useActions`
- подключить их к `ReactSyncReceiver`

### Этап 3. Traversal components

- реализовать `One`
- реализовать `Many`
- реализовать `Path` как sugar над `One`

### Этап 4. Shape declarations

- реализовать `defineShape`
- реализовать `shapeOf`
- связать mount/unmount компонента с `ShapeRegistry`

### Этап 5. DX и guardrails

- dev assertions
- удобные типы для readonly fields
- тесты на `One/Many/Path`

## Тестовый план

### Hooks

- `useAttrs` подписывается только на указанные поля
- `useActions` диспатчит в текущий scope
- hooks вне scope падают с понятной ошибкой

### Components

- `One` рендерит fallback при `null`
- `Many` рендерит `empty` при пустом списке
- reorder списка не ломает stable subtree
- item attr update не ререндерит весь список

### Shapes

- `defineShape` immutable
- одинаковый spec компилируется стабильно
- mount/unmount корректно меняет active shape refs

## Что покрывает документ

Документ покрывает:

- публичный React API поверх scope
- форму `defineShape`
- semantics `RootScope`, `One`, `Many`, `Path`, `useAttrs`, `useActions`
- пошаговый план реализации

Runtime internals описаны в [react-sync-runtime-design.ru.md](./react-sync-runtime-design.ru.md).

Worker-side session lifecycle описан в [session-root-design.ru.md](./session-root-design.ru.md).
