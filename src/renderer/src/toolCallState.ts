import type { ToolAttachment } from '../../shared/types'

export interface ToolCallState {
  id?: string
  name: string
  args: Record<string, unknown>
  result?: string
  attachments?: ToolAttachment[]
  status: string
  startedAt?: number
  finishedAt?: number
}

export interface ToolCallStartEvent {
  callId: string
  name: string
  args: Record<string, unknown>
  timestamp?: number
}

export interface ToolCallEndEvent {
  callId: string
  name: string
  result: string
  attachments?: ToolAttachment[]
}

export function isToolErrorResult(result?: string): boolean {
  if (!result) return false
  if (result.startsWith('Error')) return true
  try {
    return JSON.parse(result)?.ok === false
  } catch {
    return false
  }
}

export function isToolCancelledResult(result?: string): boolean {
  if (!result) return false
  try {
    const code = JSON.parse(result)?.error?.code
    return code === 'CANCELLED' || code === 'IMAGE_CANCELLED'
  } catch {
    return false
  }
}

export function applyToolCallStart<T extends ToolCallState>(
  calls: T[],
  event: ToolCallStartEvent
): T[] {
  if (!event.callId) return calls
  const updated = calls.map((call) =>
    call.status === 'running' && call.result !== undefined
      ? ({
          ...call,
          status: isToolErrorResult(call.result) ? 'error' : 'done'
        } as T)
      : call
  )
  const index = updated.findIndex((call) => call.id === event.callId)
  if (index === -1) {
    return [
      ...updated,
      {
        id: event.callId,
        name: event.name,
        args: event.args || {},
        status: 'running',
        startedAt: event.timestamp || Date.now()
      } as T
    ]
  }
  updated[index] = {
    ...updated[index],
    id: event.callId,
    name: event.name,
    args: event.args || {},
    status: 'running',
    result: undefined,
    attachments: undefined,
    startedAt: event.timestamp || Date.now(),
    finishedAt: undefined
  }
  return updated
}

export function applyToolCallEnd<T extends ToolCallState>(
  calls: T[],
  event: ToolCallEndEvent
): T[] {
  if (!event.callId) return calls
  const index = calls.findIndex((call) => call.id === event.callId)
  if (index === -1) {
    return [
      ...calls,
      {
        id: event.callId,
        name: event.name,
        args: {},
        result: event.result,
        attachments: event.attachments,
        finishedAt: Date.now(),
        status: isToolCancelledResult(event.result)
          ? 'cancelled'
          : isToolErrorResult(event.result)
            ? 'error'
            : 'done'
      } as T
    ]
  }
  const updated = [...calls]
  updated[index] = {
    ...updated[index],
    name: event.name,
    result: event.result,
    attachments: event.attachments,
    finishedAt: Date.now(),
    status: isToolCancelledResult(event.result)
      ? 'cancelled'
      : isToolErrorResult(event.result)
        ? 'error'
        : 'done'
  }
  return updated
}
