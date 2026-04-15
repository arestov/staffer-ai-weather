/**
 * Adapts a PeerRoom + DataChannel pair into a DomSyncTransportLike<Message>
 * compatible interface.
 *
 * For the SERVER side: one peerTransport per remote client.
 * For the CLIENT side: one peerTransport pointing to the server.
 */

export interface PeerTransport<Message> {
  send(message: Message, transfer_list?: Transferable[]): void
  listen(listener: (message: Message) => void): () => void
  destroy(): void
}

export const createPeerTransport = <Message>(
  sendFn: (data: unknown) => void,
): PeerTransport<Message> => {
  const listeners = new Set<(message: Message) => void>()
  let destroyed = false

  return {
    send(message: Message) {
      if (destroyed) return
      sendFn(message)
    },

    listen(listener: (message: Message) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /**
     * Called externally when a DataChannel message arrives.
     * This is NOT part of the DomSyncTransportLike interface — it's
     * for the PeerRoom event handler to push messages into the transport.
     */
    _receive(message: Message) {
      if (destroyed) return
      for (const fn of listeners) {
        fn(message)
      }
    },

    destroy() {
      destroyed = true
      listeners.clear()
    },
  } as PeerTransport<Message> & { _receive(message: Message): void }
}

export type PeerTransportWithReceive<Message> = PeerTransport<Message> & {
  _receive(message: Message): void
}
