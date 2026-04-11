# SessionRoot Pool Под Одним AppRoot

## Главная формулировка

В `SharedWorker` живет один `AppRoot` instance.

Этот `AppRoot`:

- владеет pool `SessionRoot`
- создает и удаляет session instances
- владеет общими app-level ресурсами

То есть правильная модель:

- не `AppRoot pool`
- а `SessionRoot pool` под одним `AppRoot`

## Зачем это нужно

Для каждой новой вкладки нужно иметь:

- свой `SessionRoot`
- свой router/navigation state
- свой sync stream
- свой page-side React runtime

При этом хочется сохранить:

- единый `SharedWorker`
- единый `AppRoot`
- единый app-level runtime

## Цели

- один `AppRoot`
- один `SessionRoot` на вкладку/сессию
- привязка sync stream к `SessionRoot`, а не к `AppRoot`
- session-local router
- явный lifecycle connect/disconnect/destroy

## Не-цели

- не делать app-global router для всех вкладок
- не смешивать page instance и session graph
- не делить один `SessionRoot` между независимыми вкладками по умолчанию

## Worker-side модель данных

```ts
type SessionEntry = {
  sessionId: string
  sessionRoot: ModelLike
  streamIds: Set<string>
  lastSeenAt: number
  status: 'active' | 'closing'
}

type WorkerSessionState = {
  appRoot: ModelLike | null
  sessionsById: Map<string, SessionEntry>
  sessionIdByStreamId: Map<string, string>
  connectionsByStreamId: Map<string, ConnectionEntry>
}
```

### ConnectionEntry

```ts
type ConnectionEntry = {
  streamId: string
  transport: TransportLike
  connectedAt: number
}
```

## Почему stream должен быть привязан к SessionRoot

Если stream привязан к `AppRoot`, page увидит app-global graph, а не graph текущей вкладки.

Это ломает:

- изоляцию navigation state
- `RootScope` как root текущей session
- корректность shape requests

Поэтому:

- `sync_sender.addSyncStream()` должен вызываться для `SessionRoot`
- `TREE_ROOT` должен указывать на node конкретного `SessionRoot`

## Session bootstrap protocol

Нужен явный session-aware control contract.

### Минимальные сообщения

- `CONTROL_BOOTSTRAP_SESSION`
- `SESSION_BOOTED`
- `CONTROL_CLOSE_SESSION`

### Bootstrap request

```ts
type BootstrapSessionMessage = {
  type: APP_MSG.CONTROL_BOOTSTRAP_SESSION
  session_id?: string
  route?: unknown
}
```

### Bootstrap response

```ts
type SessionBootedMessage = {
  type: APP_MSG.SESSION_BOOTED
  session_id: string
  root_node_id: string
}
```

После `SESSION_BOOTED` page уже должен считать, что:

- stream привязан к `SessionRoot`
- входящий `TREE_ROOT` относится к текущей session

## Жизненный цикл SessionRoot

### Создание

1. page открывает `SharedWorker` connection
2. page шлет `CONTROL_BOOTSTRAP_SESSION`
3. worker создает или находит `SessionRoot`
4. worker создает sync stream
5. worker делает `sync_sender.addSyncStream(sessionRoot, stream)`
6. page получает `SESSION_BOOTED`
7. page-side runtime получает `TREE_ROOT`

### Активная работа

Во время жизни вкладки:

- actions идут в свой `SessionRoot`
- sync updates приходят только по session stream
- shape requests относятся только к этой session

### Отключение вкладки

При `destroy()` или `port close`:

- worker отвязывает stream
- удаляет mapping `streamId -> sessionId`
- решает, удалять session сразу или после grace period

### Удаление session

Session можно удалять, если:

- у нее нет активных stream
- она не закреплена политикой reconnect
- она не нужна app-level логике

## Session policy

Есть два возможных режима.

### Вариант A. Новый SessionRoot на новую вкладку

Плюсы:

- самая простая модель
- меньше lifecycle edge cases

Минусы:

- reload теряет session-local state

### Вариант B. Reattach по session token

Плюсы:

- можно переживать reload/dev reconnect

Минусы:

- сложнее cleanup и ownership

Рекомендация:

- v1: новый `SessionRoot` на новую вкладку
- v2: optional reattach по `sessionId`

## Router внутри SessionRoot

Router должен быть session-local.

Это означает:

- route state живет внутри `SessionRoot`
- navigation actions адресуются `SessionRoot`
- derived rels для React считаются относительно `SessionRoot`

Нельзя держать router глобально на `AppRoot`, если разные вкладки должны иметь разную navigation state.

## Как page-side runtime видит мир

Page-side React runtime знает только:

- root текущего `SessionRoot`
- свой sync stream
- свои mounted shapes

Он не должен знать:

- про другие session в worker
- про чужие router state
- про чужие shape requests

Из этого следует:

- `RootScope` означает root текущей session
- `Path`, `One`, `Many`, `useAttrs` работают только внутри session subtree

## Предлагаемая структура файлов

```txt
weather/src/worker/
  model-runtime.ts
  session-manager.ts
  session-bootstrap.ts
  shared-worker.ts
```

### session-manager.ts

Должен отвечать за:

- `ensureSession(sessionId?)`
- `attachStream(sessionId, streamId, stream)`
- `detachStream(streamId)`
- `destroySession(sessionId)`
- `getSessionByStream(streamId)`

## Пошаговый план реализации

### Фаза 1. Inventory текущего SessionRoot кода

- найти существующую реализацию `SessionRoot` и pool в `linkcraft`
- проверить, что реально работает, а что выключено
- отделить session logic от старого UI-specific кода

Результат:

- понятно, что можно reuse, а что лучше адаптировать локально

### Фаза 2. Worker session manager

- создать `session-manager.ts`
- завести registry session и stream
- реализовать `ensureSession/attach/detach/destroy`

Результат:

- worker умеет держать несколько вкладок

### Фаза 3. Привязка sync stream к SessionRoot

- заменить binding на `sync_sender.addSyncStream(sessionRoot, stream)`
- убедиться, что `TREE_ROOT` указывает на session root

Результат:

- page-side runtime получает graph своей session, а не всего app root

### Фаза 4. Session bootstrap contract

- добавить `CONTROL_BOOTSTRAP_SESSION`
- добавить `SESSION_BOOTED`
- переподключить page bootstrap на session-aware flow

Результат:

- lifecycle становится явным и понятным

### Фаза 5. Session-local router

- поднять simple router на уровень `SessionRoot`
- направить туда navigation actions

Результат:

- две вкладки могут жить на разных route одновременно

### Фаза 6. Cleanup и reconnect

- добавить `CONTROL_CLOSE_SESSION`
- добавить idle cleanup timer
- при необходимости позже добавить reattach policy

Результат:

- worker не накапливает мертвые session

## Тестовый план

### Unit

- `ensureSession()` создает session один раз
- `attachStream()` мапит stream на session
- `detachStream()` удаляет mapping
- `destroySession()` чистит registry

### Integration

- две вкладки создают два `SessionRoot`
- каждая вкладка получает свой `TREE_ROOT`
- route update в одной вкладке не меняет другую
- actions одной session не текут в другую

### Lifecycle

- disconnect корректно освобождает stream
- reconnect не ломает pool
- cleanup timer удаляет пустые session

## Риски

### Частично выключенный существующий код

Если текущая `SessionRoot` логика в `linkcraft` частично выключена, есть риск потратить время на оживление неподходящих частей.

Смягчение:

- сначала inventory
- потом точечный reuse

### Смешение app и session responsibilities

Если действия и route state не разделить явно, быстро появятся неочевидные сайд-эффекты.

Смягчение:

- app-level state остается на `AppRoot`
- route/session-local state остается на `SessionRoot`

### Утечки session

Если не сделать явный cleanup, `SharedWorker` будет накапливать старые session.

Смягчение:

- `stream -> session` registry
- idle cleanup
- явный `close` протокол

## Что покрывает документ

Документ покрывает:

- правильную модель “один `AppRoot`, много `SessionRoot`”
- привязку sync stream к `SessionRoot`
- session bootstrap lifecycle
- session-local router
- пошаговый план внедрения

Page-side runtime описан в [react-sync-runtime-design.ru.md](./react-sync-runtime-design.ru.md).

Публичный React API и `defineShape` описаны в [react-scope-api-design.ru.md](./react-scope-api-design.ru.md).
