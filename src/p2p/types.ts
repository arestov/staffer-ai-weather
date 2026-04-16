// ── P2P types ────────────────────────────────────────────────────────

export type PeerRole = 'server' | 'client' | 'undecided'

export interface PeerIdentity {
  peerId: string
  role: PeerRole
  joinedAt: number
}

// ── Pusher signaling messages ────────────────────────────────────────

export interface BaseSignalMessage {
  kind: string
  roomId: string
  fromPeerId: string
  toPeerId?: string
  ts: number
}

export interface RoleAnnounceSignal extends BaseSignalMessage {
  kind: 'role-announce'
  role: PeerRole
  joinedAt: number
}

export interface OfferSignal extends BaseSignalMessage {
  kind: 'offer'
  toPeerId: string
  sdp: RTCSessionDescriptionInit
}

export interface AnswerSignal extends BaseSignalMessage {
  kind: 'answer'
  toPeerId: string
  sdp: RTCSessionDescriptionInit
}

export interface IceCandidateSignal extends BaseSignalMessage {
  kind: 'ice-candidate'
  toPeerId: string
  candidate: RTCIceCandidateInit
}

export interface ServerLeavingSignal extends BaseSignalMessage {
  kind: 'server-leaving'
}

export type SignalMessage =
  | RoleAnnounceSignal
  | OfferSignal
  | AnswerSignal
  | IceCandidateSignal
  | ServerLeavingSignal

// ── DataChannel relay messages ───────────────────────────────────────

export interface RelayEnvelope {
  relay: true
  payload: unknown
}
