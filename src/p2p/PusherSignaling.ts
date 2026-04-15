import type {
  PeerIdentity,
  SignalMessage,
} from './types'

export type PresenceMember = {
  id: string
  info: PeerIdentity
}

export interface PusherSignalingEvents {
  onMemberAdded(member: PresenceMember): void
  onMemberRemoved(member: PresenceMember): void
  onSignal(message: SignalMessage): void
  onSubscribed(members: Map<string, PresenceMember>): void
  onError(error: unknown): void
}

type PusherLike = {
  subscribe(channelName: string): PusherChannelLike
  unsubscribe(channelName: string): void
  disconnect(): void
}

type PusherChannelLike = {
  bind(event: string, callback: (...args: unknown[]) => void): void
  unbind(event: string, callback?: (...args: unknown[]) => void): void
  trigger(event: string, data: unknown): boolean
  members?: {
    each(callback: (member: { id: string; info: unknown }) => void): void
  }
}

export interface PusherSignaling {
  sendSignal(message: SignalMessage): void
  getMembers(): Map<string, PresenceMember>
  destroy(): void
}

export const createPusherSignaling = (
  pusher: PusherLike,
  roomId: string,
  identity: PeerIdentity,
  events: PusherSignalingEvents,
): PusherSignaling => {
  const channelName = `presence-weather-${roomId}`
  const channel = pusher.subscribe(channelName)
  const members = new Map<string, PresenceMember>()
  let destroyed = false

  channel.bind('pusher:subscription_succeeded', (() => {
    if (destroyed) return

    channel.members?.each((raw: { id: string; info: unknown }) => {
      const member: PresenceMember = {
        id: raw.id,
        info: raw.info as PeerIdentity,
      }
      members.set(member.id, member)
    })

    events.onSubscribed(new Map(members))
  }) as (...args: unknown[]) => void)

  channel.bind('pusher:subscription_error', ((error: unknown) => {
    if (destroyed) return
    events.onError(error)
  }) as (...args: unknown[]) => void)

  channel.bind('pusher:member_added', ((raw: { id: string; info: unknown }) => {
    if (destroyed) return
    const member: PresenceMember = {
      id: raw.id,
      info: raw.info as PeerIdentity,
    }
    members.set(member.id, member)
    events.onMemberAdded(member)
  }) as (...args: unknown[]) => void)

  channel.bind('pusher:member_removed', ((raw: { id: string; info: unknown }) => {
    if (destroyed) return
    const member: PresenceMember = {
      id: raw.id,
      info: raw.info as PeerIdentity,
    }
    members.delete(member.id)
    events.onMemberRemoved(member)
  }) as (...args: unknown[]) => void)

  channel.bind('client-signal', (data: unknown) => {
    if (destroyed) return
    const msg = data as SignalMessage
    // Ignore own messages
    if (msg.fromPeerId === identity.peerId) return
    // If targeted to another peer, skip
    if (msg.toPeerId && msg.toPeerId !== identity.peerId) return
    events.onSignal(msg)
  })

  return {
    sendSignal(message: SignalMessage) {
      if (destroyed) return
      channel.trigger('client-signal', message)
    },

    getMembers() {
      return new Map(members)
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      channel.unbind('client-signal')
      pusher.unsubscribe(channelName)
    },
  }
}
