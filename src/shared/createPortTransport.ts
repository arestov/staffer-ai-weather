import type {
  DomSyncPortLike,
  DomSyncTransportLike,
  DomSyncTransportPayloadLike,
} from 'dkt/dom-sync/transport.js'

const createListenerSet = <Message>() => {
  const listeners = new Set<(message: Message) => void>()

  return {
    emit(message: Message) {
      for (const listener of listeners) {
        listener(message)
      }
    },
    listen(listener: (message: Message) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const addMessageListener = <Message>(
  endpoint: DomSyncPortLike<Message>,
  listener: (event: DomSyncTransportPayloadLike<Message>) => void,
) => {
  if (typeof endpoint?.addEventListener === 'function') {
    endpoint.addEventListener('message', listener)
    endpoint.start?.()
    return
  }

  if (typeof endpoint?.on === 'function') {
    endpoint.on('message', listener)
    endpoint.start?.()
    return
  }

  throw new Error('port endpoint must support addEventListener() or on()')
}

const removeMessageListener = <Message>(
  endpoint: DomSyncPortLike<Message>,
  listener: (event: DomSyncTransportPayloadLike<Message>) => void,
) => {
  if (typeof endpoint?.removeEventListener === 'function') {
    endpoint.removeEventListener('message', listener)
    return
  }

  if (typeof endpoint?.off === 'function') {
    endpoint.off('message', listener)
    return
  }

  if (typeof endpoint?.removeListener === 'function') {
    endpoint.removeListener('message', listener)
  }
}

const extractMessage = <Message>(payload: DomSyncTransportPayloadLike<Message>) =>
  typeof payload === 'object' && payload !== null && 'data' in payload
    ? payload.data
    : (payload as Message)

export const createPortTransport = <Message>(
  port: DomSyncPortLike<Message>,
): DomSyncTransportLike<Message> => {
  if (!port) {
    throw new Error('port is required')
  }

  const listeners = createListenerSet<Message>()
  const on_message = (payload: DomSyncTransportPayloadLike<Message>) => {
    listeners.emit(extractMessage(payload))
  }

  addMessageListener(port, on_message)

  return {
    send(message: Message, transfer_list?: Transferable[]) {
      port.postMessage(message, transfer_list || [])
    },
    listen(listener: (message: Message) => void) {
      return listeners.listen(listener)
    },
    destroy() {
      removeMessageListener(port, on_message)
      port.close?.()
    },
  }
}
