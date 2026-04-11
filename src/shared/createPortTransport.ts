const createListenerSet = () => {
  const listeners = new Set<(message: unknown) => void>()

  return {
    emit(message: unknown) {
      for (const listener of listeners) {
        listener(message)
      }
    },
    listen(listener: (message: unknown) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const addMessageListener = (endpoint: any, listener: (event: any) => void) => {
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

const removeMessageListener = (endpoint: any, listener: (event: any) => void) => {
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

const extractMessage = (payload: any) => payload?.data ?? payload

export const createPortTransport = (port: any) => {
  if (!port) {
    throw new Error('port is required')
  }

  const listeners = createListenerSet()
  const on_message = (payload: any) => {
    listeners.emit(extractMessage(payload))
  }

  addMessageListener(port, on_message)

  return {
    send(message: unknown, transfer_list?: Transferable[]) {
      port.postMessage(message, transfer_list || [])
    },
    listen(listener: (message: unknown) => void) {
      return listeners.listen(listener)
    },
    destroy() {
      removeMessageListener(port, on_message)
      port.close?.()
    },
  }
}
