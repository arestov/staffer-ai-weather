# P2P-синхронизация weather app через Pusher + WebRTC DataChannel

## Цель

Нужно связать два или более клиента по общему `slug/roomId`, используя:

- **Pusher** — только как signaling transport
- **WebRTC DataChannel** — как основной канал передачи данных приложения
- **slug / roomId** — как идентификатор сессии

Один клиент играет роль **main**:

- вычисляет или получает погодные данные на фронтенде
- рассылает их остальным клиентам

Остальные клиенты:

- подключаются к `main`
- принимают `weather-update`
- при исчезновении `main` переизбирают нового

---

## Короткая версия архитектуры

### Слои

#### 1. Room identity

Общий URL:

```text
https://try-weather-studentapp.com/#/<slug>
```

Например:

```text
https://try-weather-studentapp.com/#/2ebd06e9-f6e0-467c-99d6-03d34d8f482c
```

`slug` используется как `roomId`.

#### 2. Signaling layer

Через Pusher-каталог комнаты:

```text
public-room-<roomId>
```

или любой другой публичный канал с достаточно длинным room id.

Через него передаются только:

- `hello`
- `peer-list` (опционально, локально собранный)
- `leader-claim`
- `offer`
- `answer`
- `ice-candidate`
- `reconnect-request`
- `main-left`

#### 3. Data plane

Через WebRTC `RTCDataChannel`.

Именно здесь идут:

- `weather-update`
- `heartbeat`
- `snapshot`
- `request-state`
- `ack`

#### 4. Role logic

В каждой комнате есть один **main**.

Он:

- инициирует вычисление/получение погодных данных
- отвечает новым клиентам
- реплицирует state остальным

Если `main` исчезает, выбирается новый.

---

## Основные сущности

### `roomId`

Идентификатор комнаты из URL.

### `peerId`

Уникальный id клиента в рамках комнаты.

Рекомендуется:

- UUID v4
- генерировать при каждой новой вкладке / сессии

Пример:

```ts
const peerId = crypto.randomUUID();
```

### `sessionEpoch`

Счётчик поколения текущего main.

Нужен, чтобы отличать:

- старого `main`
- нового `main` после failover

Начальное значение: `0`.

При переизбрании увеличивается.

### `role`

- `main`
- `replica`
- `candidate`

---

## Общая логика выбора main

Для тестового задания лучше не усложнять.

### Рекомендуемое правило

**Main = peer с минимальным `peerId` среди online peers.**

Плюсы:

- детерминированно
- оба клиента приходят к одному и тому же решению
- не нужен внешний сервер
- не зависит от порядка прихода сообщений так сильно, как правило “первый вошедший”

### Альтернатива

**Первый вошедший = main**

Это проще визуально, но хуже переживает reconnect и race conditions.

Поэтому ниже будет использоваться правило:

> активный `main` — это peer с минимальным `peerId` среди известных живых peers в комнате

---

## Каналы и соединения

## Pusher

Один signaling channel на комнату:

```text
weather-signal-<roomId>
```

Все участники комнаты подписываются на него.

## WebRTC

Для простоты — mesh c `main` в центре:

- каждый replica поднимает отдельное WebRTC-соединение с `main`
- `main` держит по одному `RTCPeerConnection` на каждого replica

То есть:

- `main <-> replicaA`
- `main <-> replicaB`
- `main <-> replicaC`

Не replica-to-replica.

Это проще всего для тестового.

---

## Почему не один общий DataChannel на всех

WebRTC DataChannel — это канал **между двумя peers**, а не общая шина комнаты.

Поэтому если в комнате больше двух клиентов, `main` должен держать отдельный peer connection на каждого участника.

Для случая “обычно 2 клиента” это вообще идеально.

---

## Формат signaling-сообщений через Pusher

Все сообщения должны содержать:

```ts
interface BaseSignalMessage {
  type: string;
  roomId: string;
  fromPeerId: string;
  toPeerId?: string; // optional для broadcast
  sessionEpoch: number;
  ts: number;
  nonce: string;
}
```

### 1. `hello`

Отправляется сразу после подписки на Pusher-канал.

```ts
interface HelloMessage extends BaseSignalMessage {
  type: 'hello';
}
```

Назначение:

- объявить о своём присутствии
- пополнить локальный список peers
- триггернуть election

### 2. `leader-claim`

Сообщение: “считаю себя main”.

```ts
interface LeaderClaimMessage extends BaseSignalMessage {
  type: 'leader-claim';
  claimedLeaderPeerId: string;
}
```

### 3. `offer`

```ts
interface OfferMessage extends BaseSignalMessage {
  type: 'offer';
  toPeerId: string;
  sdp: RTCSessionDescriptionInit;
}
```

### 4. `answer`

```ts
interface AnswerMessage extends BaseSignalMessage {
  type: 'answer';
  toPeerId: string;
  sdp: RTCSessionDescriptionInit;
}
```

### 5. `ice-candidate`

```ts
interface IceCandidateMessage extends BaseSignalMessage {
  type: 'ice-candidate';
  toPeerId: string;
  candidate: RTCIceCandidateInit;
}
```

### 6. `reconnect-request`

```ts
interface ReconnectRequestMessage extends BaseSignalMessage {
  type: 'reconnect-request';
  targetRole: 'main' | 'replica';
}
```

### 7. `main-left`

```ts
interface MainLeftMessage extends BaseSignalMessage {
  type: 'main-left';
  departedPeerId: string;
}
```

Это опционально. Иногда клиент просто исчезнет без graceful shutdown, поэтому нельзя полагаться только на это сообщение.

---

## Формат DataChannel-сообщений

Базовый формат:

```ts
interface BaseDataMessage {
  type: string;
  fromPeerId: string;
  sessionEpoch: number;
  ts: number;
}
```

### 1. `weather-update`

```ts
interface WeatherUpdateMessage extends BaseDataMessage {
  type: 'weather-update';
  payload: {
    city: string;
    tempC: number;
    condition: string;
    humidity?: number;
    windKph?: number;
    icon?: string;
    sourceTs: number;
    revision: number;
  };
}
```

### 2. `snapshot`

Полный снимок текущего состояния.

```ts
interface SnapshotMessage extends BaseDataMessage {
  type: 'snapshot';
  payload: {
    weather: {
      city: string;
      tempC: number;
      condition: string;
      sourceTs: number;
      revision: number;
    };
    leaderPeerId: string;
  };
}
```

### 3. `request-state`

Новый replica может запросить полный state.

```ts
interface RequestStateMessage extends BaseDataMessage {
  type: 'request-state';
}
```

### 4. `heartbeat`

```ts
interface HeartbeatMessage extends BaseDataMessage {
  type: 'heartbeat';
  role: 'main' | 'replica';
}
```

### 5. `ack`

```ts
interface AckMessage extends BaseDataMessage {
  type: 'ack';
  ackType: string;
  ackRevision?: number;
}
```

---

## Полный сценарий установки соединения

## Шаг 1. Клиент открывает URL

Из URL извлекается `roomId`.

```ts
const roomId = location.hash.replace(/^#\//, '');
const peerId = crypto.randomUUID();
```

Клиент создаёт локальное состояние:

```ts
interface PeerMeta {
  peerId: string;
  lastSeenTs: number;
  isAlive: boolean;
}
```

Хранит:

- `knownPeers: Map<string, PeerMeta>`
- `currentLeaderPeerId: string | null`
- `sessionEpoch: number`
- `pcByPeerId: Map<string, RTCPeerConnection>`
- `dcByPeerId: Map<string, RTCDataChannel>`

---

## Шаг 2. Подключение к Pusher

Клиент подписывается на:

```text
weather-signal-<roomId>
```

После успешной подписки отправляет:

```json
{
  "type": "hello",
  "roomId": "...",
  "fromPeerId": "peer-A",
  "sessionEpoch": 0,
  "ts": 1710000000000,
  "nonce": "..."
}
```

---

## Шаг 3. Сбор списка peers

Каждый клиент, получив `hello`, добавляет peer в `knownPeers`.

После небольшой задержки стабилизации, например `300–800 ms`, запускает election.

Задержка нужна, чтобы:

- успело прийти несколько `hello`
- уменьшить race condition

---

## Шаг 4. Election main

Каждый клиент вычисляет:

```ts
const alivePeerIds = [...knownPeers.keys(), selfPeerId].sort();
const electedLeader = alivePeerIds[0];
```

Если `electedLeader === selfPeerId`, клиент считает себя кандидатом в `main` и отправляет:

```json
{
  "type": "leader-claim",
  "roomId": "...",
  "fromPeerId": "peer-A",
  "claimedLeaderPeerId": "peer-A",
  "sessionEpoch": 1,
  "ts": 1710000000000,
  "nonce": "..."
}
```

После этого локально ставит:

- `role = 'main'`
- `currentLeaderPeerId = selfPeerId`
- `sessionEpoch += 1` только при фактической смене main

Остальные ставят:

- `role = 'replica'`
- `currentLeaderPeerId = electedLeader`

---

## Шаг 5. Установление WebRTC между replica и main

### Кто инициирует?

Рекомендуемая модель:

- **replica инициирует соединение к main**
- **main отвечает**

Это упрощает логику:

- replica видит, кто leader
- replica создаёт `RTCPeerConnection`
- replica создаёт DataChannel
- replica отправляет `offer` main
- main принимает `offer` и возвращает `answer`

---

## Шаг 6. Replica создаёт peer connection

Пример конфигурации:

```ts
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
});
```

Для тестового этого достаточно. Для production чаще нужен TURN.

Replica создаёт DataChannel:

```ts
const dc = pc.createDataChannel('weather', {
  ordered: true
});
```

Навешивает обработчики:

- `dc.onopen`
- `dc.onmessage`
- `pc.onicecandidate`
- `pc.onconnectionstatechange`

Затем:

```ts
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
```

И шлёт через Pusher:

```json
{
  "type": "offer",
  "roomId": "...",
  "fromPeerId": "replica-B",
  "toPeerId": "main-A",
  "sessionEpoch": 1,
  "sdp": { "type": "offer", "sdp": "..." },
  "ts": 1710000000000,
  "nonce": "..."
}
```

---

## Шаг 7. Main принимает offer

Main:

1. создаёт `RTCPeerConnection` для `fromPeerId`
2. ставит `pc.ondatachannel`
3. делает `setRemoteDescription(offer)`
4. делает `createAnswer()`
5. делает `setLocalDescription(answer)`
6. шлёт `answer` обратно через Pusher

Main не обязан сам создавать DataChannel в этой модели: он получает канал через `ondatachannel`.

---

## Шаг 8. Обмен ICE candidates

Обе стороны в `pc.onicecandidate` шлют кандидатов через Pusher:

```json
{
  "type": "ice-candidate",
  "roomId": "...",
  "fromPeerId": "peer-A",
  "toPeerId": "peer-B",
  "sessionEpoch": 1,
  "candidate": { ... },
  "ts": 1710000000000,
  "nonce": "..."
}
```

Получатель вызывает:

```ts
await pc.addIceCandidate(candidate);
```

---

## Шаг 9. Открытие DataChannel

Когда у replica и main:

- `pc.connectionState === 'connected'` или `completed` по ICE
- `dc.readyState === 'open'`

считаем data-plane установленным.

Replica после `open` может сразу отправить:

```json
{
  "type": "request-state",
  "fromPeerId": "replica-B",
  "sessionEpoch": 1,
  "ts": 1710000000000
}
```

Main отвечает `snapshot`.

---

## Шаг 10. Репликация погодных данных

Только `main` вычисляет состояние.

Например, раз в 5 секунд:

1. получает/рассчитывает weather data
2. увеличивает `revision`
3. отправляет `weather-update` во все открытые DataChannel'ы

Пример:

```json
{
  "type": "weather-update",
  "fromPeerId": "main-A",
  "sessionEpoch": 1,
  "ts": 1710000000000,
  "payload": {
    "city": "Murmansk",
    "tempC": 7,
    "condition": "Cloudy",
    "sourceTs": 1710000000000,
    "revision": 14
  }
}
```

Replica принимает только сообщения от `currentLeaderPeerId` и только для текущего `sessionEpoch`.

Это важно, чтобы не применять stale updates от старого main.

---

## Heartbeat и liveness

## Что нужно отслеживать

Нужно понимать:

- жив ли signaling peer через Pusher
- жив ли WebRTC data plane
- жив ли main

### Heartbeat по DataChannel

Main раз в `5–10 секунд` шлёт:

```json
{
  "type": "heartbeat",
  "fromPeerId": "main-A",
  "sessionEpoch": 1,
  "ts": 1710000000000,
  "role": "main"
}
```

Replica хранит `lastMainHeartbeatTs`.

Если heartbeat не приходил, например, `> 15 секунд`, replica начинает подозревать отказ main.

### Pusher presence of signaling

Даже если Pusher не presence-канал, сам факт продолжения signaling session может помочь для reconnect.

Но главным источником истины для data plane считаем именно WebRTC + heartbeat от main.

---

## Что делать, если main ушёл offline

Нужно покрыть два сценария:

### Сценарий A. Graceful shutdown

Main перед закрытием вкладки пытается послать через Pusher:

```json
{
  "type": "main-left",
  "roomId": "...",
  "fromPeerId": "main-A",
  "departedPeerId": "main-A",
  "sessionEpoch": 1,
  "ts": 1710000000000,
  "nonce": "..."
}
```

Получатели:

1. помечают старого main как offline
2. удаляют его из `knownPeers`
3. запускают re-election

### Сценарий B. Hard disconnect

Например:

- вкладка упала
- мобильная сеть пропала
- устройство ушло sleep

Тогда `main-left` не придёт.

В этом случае replica обнаруживает проблему по одному из условий:

- `pc.connectionState === 'failed'`
- `dc.readyState === 'closed'`
- heartbeat timeout

После этого replica:

1. помечает `currentLeaderPeerId` как suspect offline
2. ждёт маленький grace period, например `2–3 сек`
3. если main не восстановился — исключает его из election набора
4. запускает новый election

---

## Re-election после падения main

Алгоритм:

1. Собрать список живых peers, исключая подозреваемого main.
2. Вычислить нового лидера как peer с минимальным `peerId`.
3. Если это self — отправить `leader-claim` с новым `sessionEpoch`.
4. Остальные переключаются на нового main.

Важно:

- `sessionEpoch` должен увеличиваться при смене main
- все новые `offer/answer/ice-candidate` и `weather-update` должны нести новый `sessionEpoch`

Это защищает от ситуации, когда старый main ожил позже и пытается слать старые обновления.

---

## Что делать, если старый main вернулся

После возвращения старый main не должен автоматически забирать лидерство обратно только потому, что у него “peerId меньше”.

Для тестового есть два возможных режима.

### Режим 1. Лидерство стабильное до следующего failover

Рекомендуется.

То есть:

- если в комнате уже есть валидный `main` с текущим `sessionEpoch`
- вернувшийся peer становится обычным `replica`
- не происходит немедленная переизбрация

Это уменьшает flapping.

### Режим 2. Всегда пересчитывать минимальный peerId

Это проще формально, но хуже UX.

После reconnect лидер может постоянно перескакивать.

### Рекомендация

Использовать **sticky leader**:

- `main` держит лидерство, пока не исчез
- новый election происходит только по фактическому отказу main
- вернувшийся старый main становится replica

Это лучший режим для тестового.

---

## Установление соединения после failover

Когда выбран новый main:

1. Новый main отправляет `leader-claim`.
2. Каждый replica, увидев нового leader, проверяет:
   - есть ли уже рабочий `RTCPeerConnection` к этому leader
3. Если нет — инициирует новый WebRTC handshake:
   - `offer`
   - `answer`
   - `ice-candidate`
4. После открытия DataChannel отправляет `request-state`
5. Новый main шлёт `snapshot`

---

## Что делать, если WebRTC просто временно разорвался

Не всякий обрыв означает смену main.

Нужно различать:

### `disconnected`

Это может быть временный сбой.

Действие:

- подождать `3–5 секунд`
- не менять leader немедленно

### `failed`

Это более серьёзный признак.

Действие:

- попытаться выполнить ICE restart
- использовать Pusher для новой переговорки

---

## Полная схема восстановления WebRTC-соединения

### Сценарий: replica потерял связь с main, но main вероятно ещё жив

#### Шаг 1. Зафиксировать деградацию

Replica видит:

- `pc.connectionState === 'disconnected'` или `failed`
- heartbeat timeout

#### Шаг 2. Перейти в состояние `reconnecting`

Replica:

- не сбрасывает сразу role
- не инициирует election мгновенно
- запускает reconnect timer, например `4 секунды`

#### Шаг 3. Попытка ICE restart

Replica делает:

```ts
pc.restartIce();
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
```

И отправляет через Pusher targeted `offer` к текущему main.

#### Шаг 4. Main отвечает новым `answer`

Если main жив, он:

- принимает новый offer
- отдаёт answer
- обмен продолжается

#### Шаг 5. Если reconnect не удался

Если за timeout не удалось восстановить DataChannel:

- main считается offline/suspect
- запускается failover election

---

## Рекомендуемая state machine клиента

```text
idle
  -> signaling-connected
  -> discovering
  -> electing
  -> main | replica

main
  -> serving
  -> degraded
  -> reconnecting
  -> offline

replica
  -> connecting-to-main
  -> synced
  -> degraded
  -> reconnecting
  -> electing
```

### Подробно

#### `idle`

Клиент только открыл страницу.

#### `signaling-connected`

Подключён к Pusher.

#### `discovering`

Обменивается `hello`, собирает peers.

#### `electing`

Определяет main.

#### `main`

Считается лидером.

#### `serving`

Рассылает updates.

#### `replica`

Обычный клиент.

#### `connecting-to-main`

Строит WebRTC канал к main.

#### `synced`

Получает weather updates.

#### `degraded`

Подозревается потеря связи.

#### `reconnecting`

Пытается восстановить WebRTC через Pusher signaling.

---

## Тайминги для тестового задания

Рекомендуемые значения:

- election debounce: `500 ms`
- heartbeat interval от main: `5 s`
- heartbeat timeout: `15 s`
- reconnect grace period: `4 s`
- ICE restart retry count: `2`
- full failover decision after no success: `8–12 s`

Это достаточно мягкие значения для демо.

---

## Практическая логика выбора main

### Рекомендуемый окончательный алгоритм

1. После `hello` собрать peers.
2. Если `currentLeaderPeerId` уже известен и лидер жив — не переизбирать.
3. Если лидера нет или он признан offline — выполнить election.
4. Election rule:
   - выбрать peer с минимальным `peerId` среди живых
5. Победитель отправляет `leader-claim` c `sessionEpoch + 1`.
6. Остальные принимают его как новый источник истины.
7. После этого все replica строят соединение к нему.

Это даёт:

- детерминированность
- sticky leader
- failover только по необходимости

---

## Рекомендуемая логика reconnect/failover

### Replica side

При потере связи с main:

1. Сначала попытаться восстановить WebRTC к **текущему** main.
2. Если восстановить не удалось за timeout — считать main упавшим.
3. Удалить/пометить main как offline.
4. Запустить re-election.
5. Подключиться к новому main.

### Main side

Если main потерял конкретного replica:

- не влияет на лидерство
- main просто ждёт, пока replica переподключится

Если main сам понимает, что теряет сеть:

- по возможности шлёт `main-left`
- закрывает свои `RTCPeerConnection`

---

## Как обрабатывать несколько replica

Если в комнате больше двух клиентов:

### На стороне main

Хранить:

```ts
const peerConnections = new Map<string, RTCPeerConnection>();
const dataChannels = new Map<string, RTCDataChannel>();
```

На каждый `replicaPeerId`:

- отдельный `RTCPeerConnection`
- отдельный `RTCDataChannel`

При новом weather update:

```ts
for (const [peerId, dc] of dataChannels) {
  if (dc.readyState === 'open') {
    dc.send(JSON.stringify(message));
  }
}
```

---

## Что делать с Pusher после установки WebRTC

Есть два режима.

### Режим A. Оставить Pusher подключённым

Рекомендуется для тестового.

Плюсы:

- проще reconnect
- проще ICE restart
- проще failover
- меньше спецкейсов

Минус:

- лишнее открытое соединение

### Режим B. Отключать Pusher после установки DataChannel

Технически можно.

Но тогда при разрыве придётся:

1. заново подключаться к Pusher
2. заново подписываться на signaling room
3. только потом запускать reconnect/failover

Для тестового это лишняя сложность.

### Рекомендация

**Оставить Pusher подключённым всё время**, но использовать его только для:

- первичной переговорки
- ICE restart
- failover election
- reconnect после обрыва

А реальные данные приложения гонять только через WebRTC.

---

## Минимальный набор событий в коде

## Pusher handlers

- `onHello`
- `onLeaderClaim`
- `onOffer`
- `onAnswer`
- `onIceCandidate`
- `onReconnectRequest`
- `onMainLeft`

## WebRTC handlers

- `pc.onicecandidate`
- `pc.onconnectionstatechange`
- `pc.ondatachannel`
- `dc.onopen`
- `dc.onclose`
- `dc.onmessage`

---

## Псевдокод полного сценария

```ts
start() {
  connectToPusher(roomId);
}

onPusherSubscribed() {
  sendHello();
  scheduleElection();
}

onHello(msg) {
  markPeerAlive(msg.fromPeerId);
  scheduleElection();
}

scheduleElection() {
  debounce(() => {
    if (hasAliveLeader()) return;

    const elected = electLeaderByMinPeerId();

    if (elected === selfPeerId) {
      becomeMain();
      broadcastLeaderClaim();
    } else {
      becomeReplica(elected);
      ensureConnectionToLeader(elected);
    }
  }, 500);
}

ensureConnectionToLeader(leaderPeerId) {
  if (hasOpenDataChannelTo(leaderPeerId)) return;
  createOfferToLeader(leaderPeerId);
}

onOffer(msg) {
  if (!isCurrentMain()) return;
  acceptOfferAndReply(msg);
}

onAnswer(msg) {
  applyAnswer(msg);
}

onIceCandidate(msg) {
  addRemoteCandidate(msg);
}

onDataChannelOpen(peerId) {
  if (isReplicaToCurrentLeader(peerId)) {
    sendRequestState(peerId);
  }
}

onDataMessage(msg) {
  switch (msg.type) {
    case 'snapshot':
      applySnapshot(msg.payload);
      break;
    case 'weather-update':
      if (isFromCurrentLeader(msg.fromPeerId, msg.sessionEpoch)) {
        applyWeather(msg.payload);
      }
      break;
    case 'heartbeat':
      noteLeaderHeartbeat();
      break;
  }
}

mainTick() {
  if (!isMain()) return;
  const weather = computeWeather();
  revision++;
  broadcastWeatherUpdate(weather, revision);
  broadcastHeartbeat();
}

onConnectionStateFailed(peerId) {
  if (peerId !== currentLeaderPeerId) return;
  tryReconnectToLeader();
}

tryReconnectToLeader() {
  restartIceTo(currentLeaderPeerId);
  startReconnectTimer();
}

onReconnectTimeout() {
  markLeaderOffline(currentLeaderPeerId);
  clearLeader();
  scheduleElection();
}
```

---

## Рекомендуемая реализация для тестового задания

### Самая практичная версия

- `roomId` из URL slug
- Pusher channel: `weather-signal-${roomId}`
- один `main`
- election: sticky leader + min peerId as fallback
- replica инициирует WebRTC к main
- все weather updates идут по DataChannel
- Pusher остаётся подключённым для reconnect/failover
- heartbeat от main каждые 5 секунд
- failover после 8–12 секунд безуспешного восстановления

---

## Что сказать на защите

Короткое объяснение архитектуры:

> Приложение использует `slug` как идентификатор комнаты. Через Pusher реализован signaling-слой: discovery peers, выбор main, exchange of offer/answer/ICE candidates и reconnect orchestration. После этого основной обмен состоянием погоды идёт через WebRTC DataChannel. Один клиент играет роль main и рассчитывает weather state на фронтенде, остальные получают snapshot и incremental updates. При потере main replicas сначала пытаются восстановить соединение, а затем запускают failover election и выбирают нового main.

---

## Что можно упростить ещё сильнее

Если точно будет только **2 клиента**, можно убрать часть сложности:

- не делать полноценный peer list
- считать, что если я первый — я main
- если main пропал — второй становится main
- держать только один `RTCPeerConnection`

Но если хочешь, чтобы решение выглядело инженерно сильнее, лучше оставить схему из этого документа.

---

## Итог

Для тестового задания оптимальна схема:

- **slug** = идентификатор комнаты
- **Pusher** = signaling и reconnect coordination
- **WebRTC DataChannel** = передача погодных данных
- **main** = один выбранный клиент
- **sticky leader + failover** = устойчивое поведение при обрывах

Это даёт понятную архитектуру, которую легко объяснить и реализовать без полноценного backend.
