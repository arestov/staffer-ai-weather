# Session Key / Slug Startup Design

## Цель

Сделать `#/{$slug}` главным public entrypoint приложения.

`slug` становится стабильным user-facing ключом сессии:

- создается при первом открытии;
- хранится в `localStorage` как последний просмотренный;
- может быть переопределен ссылкой;
- может быть пересоздан через `#/new`;
- передается в `SharedWorker`;
- определяет изолированный app instance в worker;
- используется backend scope для saved places.

При этом разные вкладки с разными slug должны жить независимо, а вкладки с одинаковым slug должны подключаться к одному user-specific app state.

## Требования

### Startup URL rules

При загрузке страницы:

- если hash пустой, page выбирает `sessionKey` из `localStorage`, либо генерирует новый;
- после этого page делает `history.replaceState()` на `#/{$sessionKey}`;
- если hash равен `#/new`, page генерирует новый `sessionKey` и делает `replaceState()` на `#/{$sessionKey}`;
- если hash уже содержит `#/{$sessionKey}`, page принимает этот ключ как source of truth;
- после любой успешной нормализации page сохраняет `sessionKey` в `localStorage` как последний просмотренный.

### Live switching

Если hash меняется во время жизни страницы:

- page вычисляет новый `sessionKey`;
- если ключ реально изменился, page сообщает его worker;
- worker отвязывает stream от старого app/session context;
- worker переводит stream на app instance, соответствующий новому ключу;
- UI получает новый `TREE_ROOT` и продолжает работать без перезагрузки страницы.

### Worker isolation rules

Для каждого уникального `sessionKey` worker должен держать отдельный изолированный app instance:

- свой `AppRoot` graph;
- свой набор `WeatherLocation` / `SelectedLocation`;
- свой saved places state;
- свой lifecycle cleanup.

Router/navigation state остается page/session-local, а user data становится `sessionKey`-local.

## Почему текущая архитектура недостаточна

Сейчас в worker живет singleton `current_app`.

Это означает:

- все вкладки делят один `AppRoot`;
- `savedSearchLocations` общие для всех вкладок;
- набор selected locations общий для всех вкладок;
- `sessionId` существует только внутри worker и не связан с URL.

Такая схема не покрывает сценарии:

- «зайти по ссылке и как бы залогиниться»;
- «переключиться на другой slug на живой странице»;
- «вкладки с разными пользователями продолжают работать параллельно».

## Новая модель

### Термины

- `sessionKey`: public stable slug из URL и `localStorage`
- `sessionId`: internal worker-side id конкретного stream/session-root binding

### Итоговая структура

```txt
Browser tab
  -> sessionKey from hash/localStorage
  -> SharedWorker stream
  -> worker app entry keyed by sessionKey
       -> isolated AppRoot runtime
       -> per-connection SessionRoot instances
```

### Почему нужны и `sessionKey`, и `sessionId`

`sessionKey` должен быть стабильным и человеко-передаваемым.

`sessionId` удобно оставить внутренним, потому что:

- один `sessionKey` может иметь несколько открытых вкладок;
- у каждой вкладки может быть свой session-local router state;
- reconnect/switch проще выражать как rebinding потока на новый app entry.

## Page-side design

### Новый слой: session key bootstrap controller

Page до запуска основного bootstrap делает:

1. читает `window.location.hash`;
2. нормализует его в `sessionKey`;
3. при необходимости делает `history.replaceState()`;
4. сохраняет ключ в `localStorage`;
5. вызывает `session.bootstrap({ sessionKey })`.

После этого controller подписывается на `hashchange` и повторяет ту же нормализацию.

### Нормализация hash

Поддерживаем только верхнеуровневый формат:

- `#` / `#/` / пусто -> взять last key или создать новый;
- `#/new` -> всегда создать новый;
- `#/abc` -> использовать `abc`;
- все лишние слэши по краям удаляются.

Для v1 достаточно одного сегмента после `#/`.

### LocalStorage

Один ключ:

```ts
const LAST_SESSION_KEY_STORAGE_KEY = 'weather:last-session-key'
```

Page обновляет его:

- после initial normalization;
- после live switch;
- после обработки `#/new`.

## Transport contract changes

### Bootstrap request

```ts
type ReactSyncControlBootstrapSessionMessage = {
  type: APP_MSG.CONTROL_BOOTSTRAP_SESSION
  session_id?: string
  session_key?: string
  route?: unknown
}
```

### Session booted response

```ts
type ReactSyncSessionBootedMessage = {
  type: APP_MSG.SESSION_BOOTED
  session_id: string
  session_key: string
  root_node_id: string
}
```

Page snapshot тоже должен знать `sessionKey`, чтобы UI и тесты видели текущий public key.

## Worker-side design

### App pool по `sessionKey`

Вместо singleton `current_app` worker хранит pool:

```ts
type AppEntry = {
  sessionKey: string
  app: WeatherAppRuntime
  connections: Set<string>
  sessionManager: ReturnType<typeof createSessionManager>
  weatherFetchStarted: boolean
  liveUpdateTimer: ReturnType<typeof setTimeout> | null
  status: 'active' | 'closing'
}
```

```ts
type WorkerState = {
  appsBySessionKey: Map<string, AppEntry>
  sessionKeyByStreamId: Map<string, string>
}
```

### Важная граница ответственности

`AppEntry` отвечает за user-specific state:

- isolated `AppRoot`;
- weather graph;
- saved places sync scope;
- live weather refresh timer.

`SessionManager` внутри `AppEntry` отвечает только за page/session-local streams и `SessionRoot`.

### Bootstrap потока

При `CONTROL_BOOTSTRAP_SESSION(session_key)` worker делает:

1. `ensureAppEntry(sessionKey)`;
2. если stream был привязан к другому `sessionKey`, отвязывает его от старого `AppEntry`;
3. в новом `AppEntry` создает или reuses session-local binding;
4. вызывает `sync_sender.addSyncStream(sessionRoot, stream, ...)`;
5. шлет `SESSION_BOOTED` с `session_id`, `session_key`, `root_node_id`.

### Live switch между slug

Повторный `CONTROL_BOOTSTRAP_SESSION` с другим `session_key` для того же stream считается штатным switch-сценарием.

Worker обязан:

- удалить stream из старого `sync_sender`;
- detach из старого `SessionManager`;
- attach к новому `AppEntry`;
- не трогать другие вкладки, сидящие на старом `sessionKey`.

### Cleanup

Cleanup нужен на двух уровнях:

1. session-local cleanup внутри `AppEntry.sessionManager`;
2. app-level cleanup, когда у `AppEntry` не осталось stream и истек grace period.

Это позволяет:

- быстро переживать reload на том же slug;
- не держать бесконечно много app instances в worker.

## Backend scope design

### Saved places

`savedSearchLocations` остаются на `AppRoot`, но теперь это безопасно, потому что `AppRoot` изолирован по `sessionKey`.

Worker при создании app runtime должен подать в backend API scope-aware adapter:

- `fetchSavedSearchLocations(sessionKey)`
- `saveSavedSearchLocation(place, sessionKey)`
- `removeSavedSearchLocation(placeId, sessionKey)`

Итог:

- `saved places` разделяются по slug;
- search cache остается default/shared и не зависит от slug.

### Search cache

Поиск локаций не меняется:

- lookup/store search cache продолжают использовать default backend shard;
- slug туда не передается.

## Page runtime snapshot

Нужно расширить `PageRootSnapshot`:

```ts
type PageRootSnapshot = {
  booted: boolean
  ready: boolean
  version: number
  rootNodeId: string | null
  sessionId: string | null
  sessionKey: string | null
  weatherLoadStatus: string
  weatherLoadError: string | null
}
```

Это нужно для:

- отладки;
- UI header;
- тестов startup/switch.

## Реализация по файлам

### Page side

- `src/page/createPageSyncReceiverRuntime.ts`
  - добавить `session_key` в bootstrap request и `SESSION_BOOTED`
  - сохранить `sessionKey` в snapshot
- `src/page/createWeatherAppSession.ts`
  - добавить `bootstrap({ sessionKey })`
- `src/main.tsx`
  - добавить startup controller для hash/localStorage
- новый helper, например `src/page/sessionKeyUrlState.ts`
  - parse/normalize/generate/persist/bind hash

### Worker side

- `src/worker/model-runtime.ts`
  - заменить singleton app на pool по `sessionKey`
  - сделать stream rebinding между app entries
  - изолировать live update timers per app entry
- `src/worker/session-manager.ts`
  - можно reuse почти без изменений, но теперь он принадлежит `AppEntry`
- `src/shared/messageTypes.ts`
  - добавить `session_key`

### Data/backend integration

- `src/worker/weather-backend-api.ts`
  - добавить scope-aware binding helper
- `src/models/AppRoot.ts`
  - load/save/remove saved places должны ходить с scope текущего app entry

## Тестовая стратегия

### Vitest / jsdom

В `vitest` удобно проверить детерминированную логику без реального браузера:

- normalize пустого hash в `#/{$slug}`;
- reuse `localStorage` ключа;
- `#/new` всегда создает новый key;
- page runtime отправляет `session_key` в bootstrap message;
- worker rebinding на другой `sessionKey` меняет root и не ломает старый app entry;
- saved places scope уходит в backend adapter с нужным `sessionKey`.

### Playwright

Для multi-tab сценария нужен реальный браузер с `SharedWorker`.

Достаточно одного browser instance и двух tabs/pages.

Два отдельных Playwright browser instance не нужны, потому что задача проверяет:

- общую origin storage/model среду;
- одну SharedWorker область;
- две вкладки, которые одновременно живут с разными slug.

Именно две tabs лучше всего проверяют реальное поведение.

### Что покрыть в Playwright

1. открыть `/#/` и убедиться, что произошел `replace` в `#/generated-key`;
2. открыть вторую вкладку на `/#/new` и убедиться, что у нее другой key;
3. убедиться, что первая вкладка осталась на старом key и продолжает работать;
4. при открытии явного `/#/{existingKey}` подключиться к уже существующему user scope;
5. убедиться, что live change `location.hash` переводит страницу на другой worker app.

## Риски

### R1. Старый singleton assumptions в worker

Сейчас weather fetch timer и debug dump завязаны на singleton app.

Нужно аккуратно перевести их на `AppEntry`, иначе будет путаница между slug.

### R2. Test harness использует один worker runtime

Текущий harness может подразумевать singleton graph.

Нужно обновить debug helpers так, чтобы можно было инспектировать app по `sessionKey` или хотя бы активный stream binding.

### R3. `savedSearchLocations` tests смотрят в `AppRoot`

После app pool это остается валидным, но тесты должны явно учитывать, какой `sessionKey` сейчас активен.

## Решения для v1

- `sessionKey` генерируется как `crypto.randomUUID()`;
- поддерживается только один path segment после `#/`;
- `#/new` зарезервирован как команда;
- multi-tab тест делаем через Playwright с двумя tabs, не через два browser instance.

## Критерий готовности

Фича считается реализованной, когда:

- `/#/` всегда нормализуется в `/#/{slug}` до app bootstrap;
- last viewed slug хранится и переиспользуется;
- `/#/new` создает новый slug;
- live hash switch переводит страницу на другой worker app;
- worker держит изолированные app instances по slug;
- saved places scoped по slug;
- две вкладки с разными slug работают параллельно;
- это подтверждено `vitest` и `playwright` тестами.