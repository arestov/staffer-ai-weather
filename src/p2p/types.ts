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

// ── PeerRoom configuration ──────────────────────────────────────────

export interface PeerRoomConfig {
  roomId: string
  pusherKey: string
  pusherCluster: string
  rtcConfig?: RTCConfiguration
  electionDebounceMs?: number
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
}

export const DEFAULT_PEER_ROOM_CONFIG = {
  electionDebounceMs: 500,
  heartbeatIntervalMs: 5_000,
  heartbeatTimeoutMs: 15_000,
  rtcConfig: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  },
} as const satisfies Partial<PeerRoomConfig>

// ── PeerRoom events ─────────────────────────────────────────────────

export type PeerRoomEvent =
  | { type: 'role-decided'; role: PeerRole }
  | { type: 'data-channel-open'; remotePeerId: string }
  | { type: 'data-channel-close'; remotePeerId: string }
  | { type: 'data-channel-message'; remotePeerId: string; data: unknown }
  | { type: 'server-gone' }
  | { type: 'became-server' }
  | { type: 'error'; error: unknown }

export type PeerRoomEventListener = (event: PeerRoomEvent) => void
