# Weather Sync Architecture
## Cloudflare Durable Object + WebSocket signaling + WebRTC DataChannel

## 1. Goal

Two clients open the same app URL with the same room slug, discover each other through a Cloudflare Durable Object room, establish a WebRTC connection, then exchange app state through `RTCDataChannel`.

One client acts as **main**:
- computes weather state on the frontend
- sends updates to the other client

The Durable Object is used only for:
- rendezvous
- leader selection
- signaling relay
- reconnect coordination

After WebRTC is established, the signaling WebSocket may be closed. If the peer connection breaks, the client reconnects to the Durable Object and renegotiates.

---

## 2. High-level architecture

### Components

**Frontend client**
- parses `roomId` from URL slug
- opens signaling WebSocket to Durable Object room
- creates/accepts WebRTC peer connection
- sends or receives weather updates over `RTCDataChannel`

**Cloudflare Worker**
- routes requests by `roomId`
- resolves one Durable Object instance per room via `idFromName(roomId)`

**Durable Object room**
- keeps room membership
- chooses `main`
- relays signaling messages between peers
- coordinates reconnect and failover

**WebRTC DataChannel**
- carries app messages after negotiation completes
- becomes the primary transport for weather synchronization

---

## 3. URL and room identity

Example:

```text
https://try-weather-studentapp.com/#/2ebd06e9-f6e0-467c-99d6-03d34d8f482c
```

Room ID:

```ts
const roomId = location.hash.slice(2)
```

This `roomId` is used to:
- route the client into the correct Durable Object room
- namespace the signaling session
- isolate failover and renegotiation

---

## 4. Recommended responsibilities

### Durable Object is the source of truth for:
- which peers are currently in the room
- who is `main`
- the current `epoch`
- which signaling round is current

### WebRTC is responsible only for:
- transporting app data between peers
- fast point-to-point communication

### Frontend client is responsible for:
- local UI state
- local weather computation if it is `main`
- reconnecting signaling if P2P breaks

---

## 5. Room state in Durable Object

Suggested in-memory model:

```ts
interface PeerInfo {
  peerId: string
  socket: WebSocket
  joinedAt: number
  lastSeenAt: number
}

interface RoomState {
  roomId: string
  epoch: number
  leaderPeerId: string | null
  peers: Map<string, PeerInfo>
}
```

### Notes

- `epoch` increments whenever a new P2P session should supersede older signaling state.
- If the leader changes, increment `epoch`.
- If a reconnect requires a fresh negotiation, increment `epoch`.
- Ignore stale `offer`, `answer`, or `ice-candidate` messages from older epochs.

If WebSocket Hibernation is used, important state should be recoverable. Practical options:
- persist `leaderPeerId` and `epoch` in DO storage
- attach peer metadata to sockets if needed
- rebuild transient maps after wake-up

---

## 6. Leader election

For this assignment, use centralized election inside the Durable Object.

### Rule

**The first connected peer becomes `main`.**

If `main` disconnects:
- remove it from `peers`
- choose a new leader from remaining peers
- increment `epoch`
- notify room members

### Recommended replacement rule

Use the oldest remaining peer:
- smallest `joinedAt`

This is deterministic and easy to explain.

### Why this is better than browser-only election

Because the Durable Object already coordinates the room. There is no reason to run distributed leader election between browsers when a single room coordinator already exists.

---

## 7. Signaling transport lifecycle

### Initial state
Each client opens a WebSocket to the Durable Object room.

### During setup
The WebSocket is used for:
- `join`
- `room-state`
- `offer`
- `answer`
- `ice-candidate`
- `leader-changed`

### After P2P is established
Once all of the following are true:
- `RTCPeerConnection.connectionState === "connected"` or equivalent healthy state
- `RTCDataChannel.readyState === "open"`

The signaling WebSocket may be closed.

### When connection degrades or fails
The client reopens the signaling WebSocket and performs renegotiation.

---

## 8. WebRTC role assignment

To avoid offer collisions, use a fixed initiator rule.

### Rule

**Follower initiates the WebRTC offer.**

That means:
- `main` waits for offer
- non-leader creates offer
- `main` answers

This is simple and deterministic for a two-peer room.

If you later expand beyond two peers, revise the design. For this assignment, keep the room limited to two active peers.

---

## 9. Full connection flow

### Step 1. Client joins room

Client opens signaling socket and sends:

```json
{
  "type": "join",
  "roomId": "2ebd06e9-f6e0-467c-99d6-03d34d8f482c",
  "peerId": "peer-a"
}
```

### Step 2. Durable Object updates membership

- add peer to room
- if room had no leader, assign this peer as leader
- reply with `room-state`

Example:

```json
{
  "type": "room-state",
  "roomId": "2ebd06e9-f6e0-467c-99d6-03d34d8f482c",
  "epoch": 1,
  "leaderPeerId": "peer-a",
  "peers": ["peer-a"]
}
```

### Step 3. Second peer joins

```json
{
  "type": "join",
  "roomId": "2ebd06e9-f6e0-467c-99d6-03d34d8f482c",
  "peerId": "peer-b"
}
```

Durable Object replies with:

```json
{
  "type": "room-state",
  "roomId": "2ebd06e9-f6e0-467c-99d6-03d34d8f482c",
  "epoch": 1,
  "leaderPeerId": "peer-a",
  "peers": ["peer-a", "peer-b"]
}
```

### Step 4. Follower creates offer

Since `peer-b` is not leader, it creates the offer:

```ts
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
})

const dataChannel = pc.createDataChannel("weather")
const offer = await pc.createOffer()
await pc.setLocalDescription(offer)
```

Then it sends signaling through the Durable Object:

```json
{
  "type": "offer",
  "epoch": 1,
  "from": "peer-b",
  "to": "peer-a",
  "sdp": { "type": "offer", "sdp": "..." }
}
```

### Step 5. Leader answers

`peer-a` receives the offer, sets remote description, creates answer:

```ts
await pc.setRemoteDescription(offer)
const answer = await pc.createAnswer()
await pc.setLocalDescription(answer)
```

Then sends:

```json
{
  "type": "answer",
  "epoch": 1,
  "from": "peer-a",
  "to": "peer-b",
  "sdp": { "type": "answer", "sdp": "..." }
}
```

### Step 6. ICE exchange

Both peers listen for ICE candidates:

```ts
pc.onicecandidate = (event) => {
  if (!event.candidate) return
  signalingSend({
    type: "ice-candidate",
    epoch,
    from: myPeerId,
    to: remotePeerId,
    candidate: event.candidate,
  })
}
```

Message format:

```json
{
  "type": "ice-candidate",
  "epoch": 1,
  "from": "peer-b",
  "to": "peer-a",
  "candidate": { "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 }
}
```

### Step 7. DataChannel opens

When:
- peer connection is healthy
- data channel opens

The room is considered connected.

At this point:
- leader starts sending weather updates
- follower applies them
- signaling WebSocket may be closed

---

## 10. Data channel protocol

Keep the payload protocol simple.

### Message types
- `snapshot`
- `weather-update`
- `heartbeat`
- `resync-needed`

### Example: full snapshot

```json
{
  "type": "snapshot",
  "epoch": 1,
  "payload": {
    "city": "Chicago",
    "tempC": 18,
    "condition": "Cloudy",
    "forecast": []
  },
  "ts": 1760000000000
}
```

### Example: incremental update

```json
{
  "type": "weather-update",
  "epoch": 1,
  "payload": {
    "tempC": 19,
    "condition": "Sunny"
  },
  "ts": 1760000005000
}
```

### Example: heartbeat

```json
{
  "type": "heartbeat",
  "epoch": 1,
  "from": "peer-a",
  "ts": 1760000010000
}
```

---

## 11. What `main` does

The leader peer:
- computes the weather state locally
- sends initial `snapshot` when channel opens
- sends `weather-update` whenever source state changes
- optionally sends heartbeat over DataChannel

The follower peer:
- never computes authoritative room state
- only renders the leader state
- requests resync if needed

This keeps the model simple:
- one writer
- one reader

---

## 12. Disconnect and failure handling

There are three useful classes of problems.

### Case A. Brief network wobble

Symptoms:
- `connectionState === "disconnected"`
- or transient `iceConnectionState` issues

Action:
- wait a short grace period, for example 3 to 5 seconds
- if connection recovers, do nothing

### Case B. Real WebRTC failure

Symptoms:
- `connectionState === "failed"`
- `dataChannel.onclose`
- channel does not recover during grace period

Action:
1. reopen signaling WebSocket to Durable Object
2. send `rejoin`
3. fetch fresh room state
4. renegotiate using a new epoch if needed

### Case C. Main peer actually disappeared

Symptoms:
- Durable Object notices WebSocket close from leader
- or reconnecting follower sees leader absent from room state

Action:
1. Durable Object removes leader from room
2. elects new leader
3. increments epoch
4. emits `leader-changed`
5. new leader becomes the weather producer
6. peers establish a fresh WebRTC session

---

## 13. Reconnect flow

### Client-side logic

A reconnect loop should be explicit.

Pseudo-state machine:

```text
IDLE
  -> SIGNALING_CONNECTING
  -> SIGNALING_CONNECTED
  -> WEBRTC_NEGOTIATING
  -> P2P_CONNECTED
  -> DEGRADED
  -> RECONNECTING
  -> P2P_CONNECTED
```

### Recommended behavior

#### When P2P becomes healthy
- optionally close signaling WebSocket
- keep enough local state to rejoin later

#### When P2P becomes unhealthy
- reopen signaling socket immediately
- request fresh `room-state`
- decide whether to wait, renegotiate, or assume leadership

---

## 14. ICE restart flow

If the peer connection enters `failed`, use ICE restart.

### Initiator side

```ts
pc.restartIce()
const offer = await pc.createOffer()
await pc.setLocalDescription(offer)

signalingSend({
  type: "offer",
  epoch: currentEpoch,
  from: myPeerId,
  to: remotePeerId,
  sdp: pc.localDescription,
})
```

### Responder side

- set remote description
- create answer
- set local description
- send answer back through signaling socket

### Important rule

Only process signaling messages whose `epoch` matches the current room epoch.

---

## 15. Failover when main goes offline

This scenario should be deterministic.

### Sequence

1. `main` disappears.
2. Durable Object observes socket close and removes the peer.
3. Durable Object selects a new leader from remaining peers.
4. Durable Object increments `epoch`.
5. Durable Object sends `leader-changed`.
6. New leader starts computing weather state locally.
7. New P2P negotiation begins.
8. New leader sends fresh `snapshot` after channel opens.

### `leader-changed` example

```json
{
  "type": "leader-changed",
  "epoch": 2,
  "leaderPeerId": "peer-b"
}
```

### New leader action

- switch local role to `main`
- start authoritative weather computation
- if another peer is present, wait for or initiate signaling per room rules

---

## 16. Signaling message catalog

### `join`

```json
{
  "type": "join",
  "roomId": "room-123",
  "peerId": "peer-a"
}
```

### `room-state`

```json
{
  "type": "room-state",
  "roomId": "room-123",
  "epoch": 1,
  "leaderPeerId": "peer-a",
  "peers": ["peer-a", "peer-b"]
}
```

### `offer`

```json
{
  "type": "offer",
  "epoch": 1,
  "from": "peer-b",
  "to": "peer-a",
  "sdp": { "type": "offer", "sdp": "..." }
}
```

### `answer`

```json
{
  "type": "answer",
  "epoch": 1,
  "from": "peer-a",
  "to": "peer-b",
  "sdp": { "type": "answer", "sdp": "..." }
}
```

### `ice-candidate`

```json
{
  "type": "ice-candidate",
  "epoch": 1,
  "from": "peer-a",
  "to": "peer-b",
  "candidate": { "candidate": "..." }
}
```

### `rejoin`

```json
{
  "type": "rejoin",
  "roomId": "room-123",
  "peerId": "peer-a"
}
```

### `leader-changed`

```json
{
  "type": "leader-changed",
  "epoch": 2,
  "leaderPeerId": "peer-b"
}
```

### `bye`

```json
{
  "type": "bye",
  "roomId": "room-123",
  "peerId": "peer-a"
}
```

---

## 17. Client-side pseudocode

### Join and negotiate

```ts
async function connectRoom(roomId: string, peerId: string) {
  const signaling = await openRoomSocket(roomId)

  signaling.send({ type: "join", roomId, peerId })

  signaling.on("room-state", async (state) => {
    setEpoch(state.epoch)
    setLeader(state.leaderPeerId)

    if (state.peers.length < 2) return

    const iAmLeader = state.leaderPeerId === peerId
    if (!iAmLeader) {
      await startOfferFlow(state.epoch)
    }
  })

  signaling.on("offer", async (msg) => {
    if (msg.epoch !== currentEpoch) return
    await acceptOffer(msg)
  })

  signaling.on("answer", async (msg) => {
    if (msg.epoch !== currentEpoch) return
    await acceptAnswer(msg)
  })

  signaling.on("ice-candidate", async (msg) => {
    if (msg.epoch !== currentEpoch) return
    await pc.addIceCandidate(msg.candidate)
  })
}
```

### P2P failure handling

```ts
function attachConnectionWatchers(pc: RTCPeerConnection, dc: RTCDataChannel) {
  pc.onconnectionstatechange = async () => {
    if (pc.connectionState === "disconnected") {
      scheduleGraceCheck()
    }

    if (pc.connectionState === "failed") {
      await recoverP2P()
    }
  }

  dc.onclose = async () => {
    await recoverP2P()
  }
}
```

### Recovery

```ts
async function recoverP2P() {
  const signaling = await reopenRoomSocket(roomId)
  signaling.send({ type: "rejoin", roomId, peerId })

  const roomState = await waitForRoomState(signaling)
  setEpoch(roomState.epoch)
  setLeader(roomState.leaderPeerId)

  const iAmLeader = roomState.leaderPeerId === peerId
  if (!iAmLeader && roomState.peers.length >= 2) {
    pc.restartIce()
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    signaling.send({
      type: "offer",
      epoch: roomState.epoch,
      from: peerId,
      to: roomState.leaderPeerId,
      sdp: pc.localDescription,
    })
  }
}
```

---

## 18. Durable Object pseudocode

```ts
class WeatherRoom {
  state: DurableObjectState
  peers = new Map<string, PeerInfo>()
  leaderPeerId: string | null = null
  epoch = 1

  onJoin(peerId: string, socket: WebSocket) {
    this.peers.set(peerId, {
      peerId,
      socket,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
    })

    if (!this.leaderPeerId) {
      this.leaderPeerId = peerId
    }

    this.sendTo(peerId, {
      type: "room-state",
      roomId: this.roomId,
      epoch: this.epoch,
      leaderPeerId: this.leaderPeerId,
      peers: [...this.peers.keys()],
    })

    this.broadcast({
      type: "room-state",
      roomId: this.roomId,
      epoch: this.epoch,
      leaderPeerId: this.leaderPeerId,
      peers: [...this.peers.keys()],
    })
  }

  onSocketClose(peerId: string) {
    this.peers.delete(peerId)

    if (this.leaderPeerId === peerId) {
      this.leaderPeerId = this.pickNextLeader()
      this.epoch += 1

      this.broadcast({
        type: "leader-changed",
        epoch: this.epoch,
        leaderPeerId: this.leaderPeerId,
      })
    }
  }

  pickNextLeader(): string | null {
    const remaining = [...this.peers.values()].sort((a, b) => a.joinedAt - b.joinedAt)
    return remaining[0]?.peerId ?? null
  }

  relay(msg: any) {
    const target = this.peers.get(msg.to)
    if (target) {
      target.socket.send(JSON.stringify(msg))
    }
  }
}
```

---

## 19. Constraints and assumptions

This design assumes:
- at most two active peers in a room
- no sensitive data is exchanged
- signaling can be reopened on demand
- one peer is authoritative at any time

If you later need:
- more than two peers
- mesh networking
- multi-writer conflict resolution
- long-lived room history

then the protocol should be redesigned.

---

## 20. Recommended implementation decisions

### Keep
- Durable Object as room coordinator
- WebSocket only for signaling
- WebRTC only for app transport
- centralized leader selection in DO
- `epoch` on every signaling message

### Avoid
- distributed leader election between browsers
- multiple concurrent offers from both peers
- trusting stale signaling messages
- trying to keep signaling permanently open unless needed

---

## 21. Suggested test cases

### Core
- first peer joins and becomes leader
- second peer joins and receives correct `room-state`
- follower initiates WebRTC offer
- leader answers and DataChannel opens

### Failure
- transient disconnect does not immediately trigger failover
- `failed` connection causes signaling reconnect
- leader disconnect causes `leader-changed`
- remaining peer becomes leader
- new epoch invalidates stale signaling messages

### Recovery
- reconnect after closed signaling socket works
- reconnect after `main` disappearance creates fresh P2P session
- fresh leader sends full snapshot after failover

---

## 22. Final recommendation

For this assignment, the cleanest implementation is:

1. `roomId` comes from URL slug.
2. A Cloudflare Durable Object represents the room.
3. Clients use a temporary WebSocket connection to the room for signaling.
4. Durable Object elects `main` centrally.
5. Non-leader creates WebRTC offer.
6. After `RTCDataChannel` is open, weather data flows over P2P.
7. Signaling socket closes in steady state.
8. On `failed` or `channel closed`, signaling socket is reopened.
9. Durable Object coordinates renegotiation and leader failover.

This gives you:
- a simple story
- reliable cross-device discovery
- real peer-to-peer data transfer
- deterministic leader failover
- a reasonable scope for a test assignment
