import type { AnswerSignal, IceCandidateSignal, OfferSignal } from './types'

export interface WebRTCPeerEvents {
  onOpen(): void
  onClose(): void
  onMessage(data: unknown): void
  onIceCandidate(candidate: RTCIceCandidateInit): void
  onError(error: unknown): void
}

export interface WebRTCPeer {
  readonly remotePeerId: string
  readonly state: RTCPeerConnectionState | 'new'
  readonly channelReady: boolean
  send(data: unknown): void
  createOffer(): Promise<RTCSessionDescriptionInit>
  handleOffer(sdp: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit>
  handleAnswer(sdp: RTCSessionDescriptionInit): Promise<void>
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>
  destroy(): void
}

export const createWebRTCPeer = (
  remotePeerId: string,
  rtcConfig: RTCConfiguration,
  initiator: boolean,
  events: WebRTCPeerEvents,
): WebRTCPeer => {
  const pc = new RTCPeerConnection(rtcConfig)
  let dc: RTCDataChannel | null = null
  let channelReady = false
  let destroyed = false

  const setupDataChannel = (channel: RTCDataChannel) => {
    dc = channel

    channel.onopen = () => {
      if (destroyed) return
      channelReady = true
      events.onOpen()
    }

    channel.onclose = () => {
      if (destroyed) return
      channelReady = false
      events.onClose()
    }

    channel.onerror = (ev) => {
      if (destroyed) return
      events.onError(ev)
    }

    channel.onmessage = (ev) => {
      if (destroyed) return
      try {
        const parsed = JSON.parse(ev.data)
        events.onMessage(parsed)
      } catch (error) {
        events.onError(error)
      }
    }
  }

  if (initiator) {
    const channel = pc.createDataChannel('weather-sync', { ordered: true })
    setupDataChannel(channel)
  } else {
    pc.ondatachannel = (ev) => {
      setupDataChannel(ev.channel)
    }
  }

  pc.onicecandidate = (ev) => {
    if (destroyed || !ev.candidate) return
    events.onIceCandidate(ev.candidate.toJSON())
  }

  pc.onconnectionstatechange = () => {
    if (destroyed) return
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      channelReady = false
      events.onClose()
    }
  }

  return {
    get remotePeerId() {
      return remotePeerId
    },

    get state() {
      return pc.connectionState ?? 'new'
    },

    get channelReady() {
      return channelReady
    },

    send(data: unknown) {
      if (!dc || dc.readyState !== 'open') return
      dc.send(JSON.stringify(data))
    },

    async createOffer() {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      return pc.localDescription!.toJSON()
    },

    async handleOffer(sdp: RTCSessionDescriptionInit) {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      return pc.localDescription!.toJSON()
    },

    async handleAnswer(sdp: RTCSessionDescriptionInit) {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    },

    async addIceCandidate(candidate: RTCIceCandidateInit) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      channelReady = false
      dc?.close()
      pc.close()
    },
  }
}
