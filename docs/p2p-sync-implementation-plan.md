# P2P Sync — план реализации

## Общая идея

Сейчас:
```
Page (React) ←→ SharedWorker (model-runtime, app state)
```

Хотим:
```
Page A ←→ Worker A (server) ←→ Pusher presence ←→ Worker B (client) ←→ Page B
```

Worker содержит всю логику: подключение к Pusher, election, relay сообщений.
Страница не знает о P2P — для неё всё выглядит как обычные sync messages.

---

## Архитектура

### Роли

- **server** — worker, который запустил `model-runtime` (app runtime работает локально)
- **client** — worker, который НЕ запускает app runtime, а проксирует сообщения через Pusher/WebRTC к server'у

### Определение роли при загрузке

1. Worker подключается к Pusher presence channel: `presence-weather-<sessionKey>`
2. Параллельно загружается (но не запускается) `model-runtime` — оптимизация
3. Если в presence уже есть member с `role: 'server'` → этот worker становится **client**
4. Если нет → этот worker становится **server**, помечает себя `role: 'server'` в presence metadata

### Протокол

Слой 1 — **Signaling** (Pusher presence channel):
- `hello` — discovery
- `role-announce` — объявление роли (server/client)
- WebRTC signaling: `offer`, `answer`, `ice-candidate`
- `server-leaving` — graceful disconnect

Слой 2 — **Data plane** (WebRTC DataChannel):
- Все `ReactSyncTransportMessage` пересылаются as-is
- Client → Server: `CONTROL_*`, `SYNC_RPC`, `SYNC_UPDATE_STRUCTURE_USAGE`, `SYNC_REQUIRE_SHAPE`
- Server → Client: `SESSION_BOOTED`, `SYNC_HANDLE`, `WEATHER_LOAD_STATE`, etc.

### Почему WebRTC а не только Pusher

- Pusher имеет ограничение 10KB на сообщение для client events
- `SYNC_HANDLE` с `SET_DICT` может быть значительно больше
- WebRTC DataChannel не имеет ограничений (SCTP фрагментация)
- Pusher нужен только для discovery + signaling

---

## Детальный flow

### Server path (worker без существующего server в presence)

```
1. Worker init
2. connectToPusher(sessionKey)
3. pusher.subscribe(`presence-weather-${sessionKey}`)
4. onSubscribed → проверить members
5. Нет members с role:server → я server
6. Запустить model-runtime (ensureAppEntry)
7. Слушать page messages → model-runtime (как сейчас)
8. При новом client в presence:
   a. Принять WebRTC offer
   b. Открыть DataChannel
   c. Создать виртуальный "remote stream" для model-runtime
   d. model-runtime.connect(remoteTransport) — такой же connect как для page
9. Relay sync messages через DataChannel ↔ model-runtime
```

### Client path (worker с существующим server в presence)

```
1. Worker init
2. connectToPusher(sessionKey)
3. pusher.subscribe(`presence-weather-${sessionKey}`)
4. onSubscribed → есть member с role:server
5. НЕ запускать model-runtime
6. Создать WebRTC offer → отправить через Pusher
7. Получить answer, обменяться ICE candidates
8. Открыть DataChannel
9. Page messages → DataChannel → server worker → model-runtime
10. model-runtime ответы → DataChannel → page
```

### Failover

Если server уходит:
1. Client обнаруживает через presence `member_removed` + heartbeat timeout
2. Client запускает model-runtime (app уже загружен, запуск быстрый)
3. Client становится server
4. Другие clients переподключаются

---

## Файловая структура

### Новые файлы — P2P protocol (отделён от приложения)

```
src/p2p/
  PeerRoom.ts            — главный класс: Pusher + WebRTC + role election
  PusherSignaling.ts     — обёртка над Pusher для signaling
  WebRTCPeer.ts          — обёртка над RTCPeerConnection + DataChannel
  types.ts               — типы сообщений, роли, конфиги
  createPeerTransport.ts — адаптер: DataChannel → DomSyncTransportLike
```

### Новые файлы — тесты

```
test/p2p/
  peer-room.test.ts               — unit тесты PeerRoom (mock Pusher + WebRTC)
  playwright-p2p-sync.mjs         — E2E: 2-3 браузера, синхронизация через Pusher
  playwright-p2p-failover.mjs     — E2E: disconnect/reconnect сценарии
```

### Модифицируемые файлы

#### `src/worker/shared-worker.ts`
- Добавить: после создания model-runtime, инициализировать PeerRoom
- PeerRoom решает:
  - Стать server → `runtime.connect(peerTransport)` для каждого remote client
  - Стать client → перенаправлять page transport через DataChannel

#### `src/worker/model-runtime.ts`
- **Минимальные изменения**: model-runtime уже поддерживает несколько `connect()` вызовов
- Возможно: экспорт `ensureAppEntry` для отложенного запуска (сейчас вызывается внутри `bootstrapSession`)

#### `src/shared/messageTypes.ts`
- Добавить: `P2P_ROLE_CHANGED` message для уведомления page о роли (опционально)

#### `src/page/createWeatherAppSession.ts`
- Передавать `sessionKey` в SharedWorker URL params (уже есть `weatherBackendBaseUrl` паттерн)

---

## Порядок реализации

### Фаза 1 — Protocol layer (без приложения)

1. **`src/p2p/types.ts`** — типы
2. **`src/p2p/PusherSignaling.ts`** — Pusher presence + signaling messages
3. **`src/p2p/WebRTCPeer.ts`** — peer connection management
4. **`src/p2p/PeerRoom.ts`** — orchestration: election + connection lifecycle
5. **`src/p2p/createPeerTransport.ts`** — DataChannel → Transport adapter

### Фаза 2 — Unit тесты protocol

6. **`test/p2p/peer-room.test.ts`** — mock-based тесты election, messaging

### Фаза 3 — E2E тесты с Playwright

7. **Test server** — миниальный HTML + JS для тестирования P2P без weather app
8. **`test/p2p/playwright-p2p-sync.mjs`** — 2-3 headless браузера, verify:
   - Двое подключаются к одному room
   - Один становится server, другой client
   - Server шлёт данные → client получает
   - Client шлёт запрос → server обрабатывает

9. **`test/p2p/playwright-p2p-failover.mjs`** — verify:
   - Server уходит → client становится server
   - Третий browser подключается после failover
   - Reconnect после временного разрыва

### Фаза 4 — Интеграция в приложение

10. **`src/worker/shared-worker.ts`** — подключение PeerRoom
11. **Integration tests** — weather app с двумя браузерами:
    - Оба видят одинаковые weather данные
    - Один меняет location → другой видит изменение
    - Server tab закрывается → client продолжает работать

---

## Конфигурация Pusher

```ts
const PUSHER_CONFIG = {
  appKey: '7e2ce96e11e1907a7548',
  cluster: 'eu',
}
```

Presence channel name: `presence-weather-<sessionKey>`

Member metadata:
```ts
{
  peerId: string        // crypto.randomUUID()
  role: 'server' | 'client'
  joinedAt: number      // timestamp
}
```

---

## WebRTC конфигурация

```ts
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}
```

DataChannel: `{ ordered: true, label: 'weather-sync' }`

Сообщения через DataChannel — JSON-encoded `ReactSyncTransportMessage`.

---

## Edge cases

1. **Оба считают себя server** — невозможно при корректном Pusher presence, но на всякий случай: сравнение `joinedAt`, при равенстве — по `peerId`
2. **Pusher disconnect** — retry с exponential backoff; WebRTC может продолжать работать
3. **Большие sync messages** — DataChannel поддерживает до ~256KB в одном send, для больших — chunk protocol (вряд ли нужно для weather)
4. **Worker в service worker context** — Pusher.js нужен importScripts; для SharedWorker — стандартный import

---

## Зависимости

- `pusher-js` — нужно добавить в dependencies
- WebRTC — нативный API браузера, без библиотек
- Для тестов: Playwright уже установлен (`^1.59.1`)
