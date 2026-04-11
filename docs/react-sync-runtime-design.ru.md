# React Sync Runtime Для Weather

## Назначение

Для `weather` нужен отдельный page-side runtime, который повторяет только sync contract сообщений, но не повторяет DKT view runtime.

Причины:

- `SyncReceiver` и `MDProxy` уже решают более широкую задачу, чем нужно React
- они знают про DKT `View`, reuse, batching, `dom_shape_ids`, `callbacks flow`
- React-ветка должна быть проще, отдельно импортироваться и развиваться независимо

Идея:

- worker-side остается на обычном `prepareAppRuntime({ sync_sender: true })`
- page-side получает новый `ReactSyncReceiver`
- React читает данные только через scope-based API

## Цели

- не форкать wire protocol `sync_sender`
- убрать зависимость page runtime от `View`, `PvTemplate`, `dom-owner`
- сделать точечные подписки по attrs и rels
- подготовить основу для `defineShape`
- подготовить основу для `SessionRoot` pool

## Не-цели

- не поддерживать DKT template reuse
- не строить API случайного доступа по `node_id`
- не переносить в React runtime весь `SyncReceiver`

## Границы ответственности

### Worker-side

Остается прежним:

- один `AppRoot`
- `SessionRoot` pool
- `sync_sender`
- app/session actions

### Page-side

Новый runtime делает только:

- принимает `SET_DICT`, `SET_MODEL_SCHEMA`, `TREE_ROOT`, `UPDATE`
- собирает partial graph текущего `SessionRoot`
- поддерживает подписки:
  - attrs текущего узла
  - один `rel`
  - состав и порядок списка
- отправляет:
  - `SYNC_RPC`
  - `SYNC_UPDATE_STRUCTURE_USAGE`
  - `SYNC_REQUIRE_SHAPE`

## Transport contract

React runtime не должен вводить новый протокол. Он должен повторять уже существующие сообщения:

- `SYNC_HANDLE`
- `SYNC_RPC`
- `SYNC_UPDATE_STRUCTURE_USAGE`
- `SYNC_REQUIRE_SHAPE`

Входящие sync payload:

- `SET_DICT`
- `SET_MODEL_SCHEMA`
- `TREE_ROOT`
- `UPDATE`

## Внутренняя модель данных

### Узел graph cache

```ts
type ReactSyncNode = {
  nodeId: string
  modelName: string | null
  hierarchyNum: number | null
  constrId: string | number | null
  attrs: Record<string, unknown>
  rels: Record<string, null | string | string[]>
  attrsVersion: number
  relsVersion: number
}
```

### Runtime state

```ts
type ReactSyncReceiverState = {
  rootNodeId: string | null
  dictFlat: readonly (string | undefined)[] | null
  modelSchema: unknown | null
  nodesById: Map<string, ReactSyncNode>

  attrSubsByNodeId: Map<string, Map<string, Set<() => void>>>
  relSubsByNodeId: Map<string, Map<string, Set<() => void>>>
  listSubsByNodeId: Map<string, Map<string, Set<() => void>>>
  rootSubs: Set<() => void>
}
```

## Scope как opaque handle

Наружу React не должен видеть `nodeId`. Вместо этого runtime отдает opaque scope:

```ts
type ScopeHandle = {
  readonly kind: 'scope'
  readonly _nodeId: string
  readonly _runtime: ReactSyncReceiver
}
```

Это internal identity. Публично компоненты знают только:

- есть текущий scope
- у него можно читать attrs
- из него можно идти вниз по `rel`

## Как обновляется graph

### `TREE_ROOT`

На `TREE_ROOT` runtime должен:

- создать root node, если его нет
- сохранить `rootNodeId`
- уведомить root subscribers

### `UPDATE`

При `UPDATE` runtime:

- проходит flat batch
- обновляет attrs и rels узлов
- при tree chunks создает недостающие узлы
- собирает dirty subscription buckets
- только после полного разбора batch уведомляет listeners

Это важно, чтобы не дергать React на каждую пару `attr/value`.

## Точечные подписки

### Attr subscriptions

`useAttrs(['name', 'status'])` подписывается только на:

- `attrSubsByNodeId[nodeId]['name']`
- `attrSubsByNodeId[nodeId]['status']`

Изменение `updatedAt` не должно ререндерить этот компонент.

### One relation subscriptions

`One rel="foo"` подписывается только на:

- `relSubsByNodeId[parentId]['foo']`

### Many relation subscriptions

`Many rel="items-list"` подписывается только на:

- `listSubsByNodeId[parentId]['items-list']`

Изменение attrs item не должно ререндерить list container.

## Shape layer

`ReactSyncReceiver` не должен сам придумывать shape language. Он должен только уметь:

- принять compiled graph fragment от `ShapeRegistry`
- один раз опубликовать его через `SYNC_UPDATE_STRUCTURE_USAGE`
- для mounted scope отправить `SYNC_REQUIRE_SHAPE([nodeId, ...shapeIds])`

Разделение:

- `ShapeRegistry` отвечает за declarations и compilation
- `ReactSyncReceiver` отвечает за mounted instances и transport

## Mounted shape lifecycle

Для каждого `nodeId` нужен refcount shape usage:

```ts
type MountedShapeEntry = {
  nodeId: string
  shapeId: string
  refs: number
}
```

Поведение:

- mount: `refs++`
- unmount: `refs--`
- при переходе `0 -> 1` и `1 -> 0` runtime пересчитывает полный набор active shape ids для узла и отправляет новый `require`

`requireShapeForModel` должен всегда отправлять полный набор shape ids для узла, а не дельту.

## Связь с текущим weather spike

Текущее `weather/src/page/createPageSyncReceiverRuntime.ts` полезно как временный spike, но не как целевая архитектура.

Его ограничения:

- глобальный root snapshot
- один общий `version`
- React подписан на весь snapshot
- чтение идет через `rootMpx.getAttr(...)`
- shape usage пока опирается на `BlankAppRootView`

Целевая архитектура должна уйти от этого к:

- node-local subscriptions
- scope-based чтению
- отдельному `ShapeRegistry`

## Предлагаемая структура файлов

```txt
weather/src/react-sync/
  receiver/
    ReactSyncReceiver.ts
    ReactSyncNode.ts
    batch.ts
    subscriptions.ts
  scope/
    ScopeHandle.ts
    ScopeContext.tsx
    RootScope.tsx
  shape/
    ShapeRegistry.ts
    defineShape.ts
    compileShape.ts
  hooks/
    useAttrs.ts
    useActions.ts
    useOne.ts
    useMany.ts
  components/
    One.tsx
    Many.tsx
    Path.tsx
```

## Этапы реализации

### Этап 1. Базовый runtime без React API

- создать `ReactSyncNode`
- создать `ReactSyncReceiver`
- реализовать прием:
  - `SET_DICT`
  - `SET_MODEL_SCHEMA`
  - `TREE_ROOT`
  - `UPDATE`
- покрыть парсинг update batch unit tests

Критерий готовности:

- runtime собирает локальный graph без использования DKT `SyncReceiver`

### Этап 2. Subscription layer

- добавить `subscribeAttrs(nodeId, fields, listener)`
- добавить `subscribeRel(nodeId, relName, listener)`
- добавить `subscribeList(nodeId, relName, listener)`
- реализовать dirty bucket accumulation и batched notify

Критерий готовности:

- attr update не триггерит unrelated rel/list subscribers

### Этап 3. Scope handles

- добавить `getRootScope()`
- добавить internal `getScopeByNodeId()`
- добавить чтение:
  - `readAttrs(scope, fields)`
  - `readOne(scope, rel)`
  - `readMany(scope, rel)`

Критерий готовности:

- React можно подключать через opaque scope вместо snapshot DTO

### Этап 4. Shape integration

- добавить `ShapeRegistry`
- компилировать shape declarations в graph fragments
- публиковать graph fragments через `SYNC_UPDATE_STRUCTURE_USAGE`
- реализовать mounted shape refcounts
- отправлять `SYNC_REQUIRE_SHAPE`

Критерий готовности:

- runtime запрашивает данные без `BlankAppRootView`

### Этап 5. Замена page spike runtime

- убрать привязку приложения к root snapshot
- подключить новый runtime к `RootScope`, `One`, `Many`, `useAttrs`
- оставить старый page runtime только как временный fallback, если нужно

Критерий готовности:

- React приложение работает поверх scope/subscription API

## Тестовый план

### Unit tests

- `TREE_ROOT` создает root node
- tree base/tree attrs/tree rels корректно создают graph
- attr update уведомляет только нужные attr listeners
- one-rel update уведомляет только нужный rel listener
- list reorder уведомляет только list listener
- shape mount/unmount корректно меняет набор requested shape ids

### Integration tests

- `SharedWorker -> page -> React` bootstrap
- `useAttrs` получает root attrs
- `One` корректно пересобирает дочерний scope
- `Many` не ререндерит весь список при update attrs одного item

## Риски

### Parking

Сейчас parking можно не переносить. Сначала надо померить:

- объем attrs
- число inactive nodes
- стоимость реконструкции

Если parking понадобится, его лучше делать отдельной React-specific реализацией, а не копировать DKT parking layer как есть.

### Shape compiler

Слишком ранняя попытка повторить старый DKT shape DSL может раздуть проект.

Рекомендация:

- v1 ограничить `attrs + nested rels`
- не пытаться достичь полного feature parity со старым `View`

## Что покрывает документ

Документ покрывает:

- зачем нужен отдельный React sync runtime
- какую внутреннюю модель он должен держать
- как он должен подписывать React
- как он должен отправлять shape usage и shape request
- в каком порядке его внедрять

Публичный React API описан в [react-scope-api-design.ru.md](./react-scope-api-design.ru.md).

Worker-side модель `SessionRoot` описана в [session-root-design.ru.md](./session-root-design.ru.md).
