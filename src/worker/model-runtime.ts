import { prepare as prepareAppRuntime } from 'dkt/runtime/app/prepare.js'
import { SYNCR_TYPES } from 'dkt-all/libs/provoda/SyncR_TYPES.js'
import { APP_MSG, RUNTIME_LOG_SCOPE } from '../shared/messageTypes'
import { createWeatherAppRoot } from '../app/createWeatherAppRoot'

const createWorkerStream = (transport: {
  send(message: unknown, transfer_list?: Transferable[]): void
}) => ({
  id: `weather-stream-${Math.random().toString(36).slice(2)}`,
  send(list: unknown[]) {
    transport.send({
      type: APP_MSG.SYNC_HANDLE,
      sync_type: SYNCR_TYPES.UPDATE,
      payload: list.slice(),
    })
  },
  sendDict(dict: unknown[]) {
    transport.send({
      type: APP_MSG.SYNC_HANDLE,
      sync_type: SYNCR_TYPES.SET_DICT,
      payload: dict.slice(),
    })
  },
  sendWithType(sync_type: number, payload: unknown) {
    transport.send({
      type: APP_MSG.SYNC_HANDLE,
      sync_type,
      payload,
    })
  },
})

export const createWeatherModelRuntime = () => {
  let current_app: any = null
  let booting = false
  const connections = new Set<{
    transport: {
      send(message: unknown, transfer_list?: Transferable[]): void
      listen(listener: (message: any) => void): () => void
      destroy(): void
    }
    stream: ReturnType<typeof createWorkerStream>
    destroyed: boolean
  }>()

  const emitForConnection = (
    connection: { transport: { send(message: unknown): void } },
    message: unknown,
  ) => {
    connection.transport.send(message)
  }

  const appendLog = (
    connection: { transport: { send(message: unknown): void } },
    message: string,
  ) => {
    emitForConnection(connection, {
      type: APP_MSG.RUNTIME_LOG,
      scope: RUNTIME_LOG_SCOPE.SHARED_WORKER,
      message,
    })
  }

  const emitError = (
    connection: { transport: { send(message: unknown): void } },
    error: unknown,
  ) => {
    emitForConnection(connection, {
      type: APP_MSG.RUNTIME_ERROR,
      message:
        error instanceof Error ? error.stack || error.message : String(error),
    })
  }

  const bootstrapApp = async () => {
    if (current_app) {
      return current_app
    }

    if (booting) {
      while (!current_app) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return current_app
    }

    booting = true
    const runtime = prepareAppRuntime({
      sync_sender: true,
      warnUnexpectedAttrs: true,
      onError(error) {
        for (const connection of connections) {
          emitError(connection, error)
        }
      },
    })
    const { AppRoot } = createWeatherAppRoot()
    const inited = await runtime.start({
      App: AppRoot,
      interfaces: {
        requests_manager: {
          addRequest() {},
          considerOwnerAsImportant() {},
          stopRequests() {},
        },
      },
    })

    current_app = {
      runtime,
      inited,
    }
    booting = false

    return current_app
  }

  const handleDispatchAction = async (
    connection: { transport: { send(message: unknown): void } },
    action_name: string,
    payload: unknown,
  ) => {
    const app = await bootstrapApp()
    await app.inited.app_model.dispatch(action_name, payload)
    appendLog(connection, `dispatched app action -> ${action_name}`)
  }

  const handleMessage = async (
    connection: {
      transport: { send(message: unknown): void }
      stream: ReturnType<typeof createWorkerStream>
    },
    message: any,
  ) => {
    switch (message?.type) {
      case APP_MSG.CONTROL_BOOTSTRAP_MODEL: {
        const app = await bootstrapApp()
        await app.runtime.sync_sender.addSyncStream(
          app.inited.app_model,
          connection.stream,
        )
        emitForConnection(connection, {
          type: APP_MSG.MODEL_BOOTED,
          root_node_id: app.inited.app_model._node_id,
        })
        appendLog(connection, 'shared worker connection booted')
        return
      }
      case APP_MSG.CONTROL_DISPATCH_APP_ACTION: {
        await handleDispatchAction(
          connection,
          message.action_name,
          message.payload,
        )
        return
      }
      case APP_MSG.CONTROL_SET_LOCATION: {
        await handleDispatchAction(connection, 'setLocation', message.payload)
        return
      }
      case APP_MSG.CONTROL_REFRESH_WEATHER: {
        await handleDispatchAction(connection, 'refreshWeather', message.payload)
        return
      }
      case APP_MSG.SYNC_UPDATE_STRUCTURE_USAGE: {
        const app = await bootstrapApp()
        app.runtime.sync_sender.updateStructureUsage(connection.stream.id, message.data)
        return
      }
      case APP_MSG.SYNC_REQUIRE_SHAPE: {
        const app = await bootstrapApp()
        app.runtime.sync_sender.requireShapeForModel(connection.stream.id, message.data)
        return
      }
    }
  }

  const connect = (transport: {
    send(message: unknown, transfer_list?: Transferable[]): void
    listen(listener: (message: any) => void): () => void
    destroy(): void
  }) => {
    const connection = {
      transport,
      stream: createWorkerStream(transport),
      destroyed: false,
    }
    connections.add(connection)

    const unlisten = transport.listen((message) => {
      Promise.resolve(handleMessage(connection, message)).catch((error) =>
        emitError(connection, error),
      )
    })

    transport.send({
      type: APP_MSG.RUNTIME_LOG,
      scope: RUNTIME_LOG_SCOPE.SHARED_WORKER,
      message: 'runtime listener attached',
    })

    return {
      async destroy() {
        if (connection.destroyed) {
          return
        }

        connection.destroyed = true
        unlisten?.()
        connections.delete(connection)
        transport.destroy()
      },
    }
  }

  return {
    connect,
    bootstrapApp,
  }
}
