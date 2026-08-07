export interface ToolCallState {
  id?: string
  name: string
  args: Record<string, unknown>
  result?: string
  status: string
}

export interface ToolCallStartEvent {
  callId: string
  name: string
  args: Record<string, unknown>
}

export interface ToolCallEndEvent {
  callId: string
  name: string
  result: string
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
        status: 'running'
      } as T
    ]
  }
  updated[index] = {
    ...updated[index],
    id: event.callId,
    name: event.name,
    args: event.args || {},
    status: 'running'
  }
  return updated
}

export function applyToolCallEnd<T extends ToolCallState>(
  calls: T[],
  event: ToolCallEndEvent
): T[] {
  if (!event.callId) return calls
  const index = calls.findIndex((call) => call.id === event.callId)
  if (index === -1) return calls
  const updated = [...calls]
  updated[index] = {
    ...updated[index],
    name: event.name,
    result: event.result,
    status: isToolErrorResult(event.result) ? 'error' : 'done'
  }
  return updated
}
