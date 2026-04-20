import { toErrorMessage } from './weatherFormat'

const REQUEST_ERROR_PREFIX = '[request_id='

export const createTaggedRequestError = (requestId: number, error: unknown) => {
  return new Error(`${REQUEST_ERROR_PREFIX}${requestId}] ${toErrorMessage(error)}`)
}

export const parseTaggedRequestError = (value: unknown) => {
  if (typeof value !== 'string') {
    return null
  }

  const match = /^\[request_id=(\d+)\]\s*(.*)$/.exec(value)
  if (!match) {
    return null
  }

  return {
    requestId: Number(match[1]),
    message: match[2] || 'Unknown request error',
  }
}
