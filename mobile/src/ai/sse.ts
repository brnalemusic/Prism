import type { ProviderProtocol } from '../domain/types'

export interface SseEvent {
  event: string | null
  data: string
}

export interface StreamDelta {
  delta?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string; thoughtSignature?: string }>
  toolCallDeltas?: Array<{ index: number; id?: string; name?: string; argumentsDelta?: string }>
  done?: boolean
  error?: string
}

/**
 * Incremental SSE parser. Chat providers seldom align chunks with line
 * boundaries, so the decoder keeps a buffer between pushes and only emits
 * complete events.
 */
export class SseDecoder {
  private buffer = ''
  private dataLines: string[] = []
  private eventName: string | null = null

  push(chunk: string): SseEvent[] {
    if (chunk.length === 0) return []
    let text = chunk
    if (this.buffer.length === 0 && text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    this.buffer += text

    const events: SseEvent[] = []
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      const event = this.consumeLine(line)
      if (event) events.push(event)
      newline = this.buffer.indexOf('\n')
    }
    return events
  }

  /** Flushes a trailing line and any event that was never terminated by a blank line. */
  flush(): SseEvent[] {
    const events: SseEvent[] = []
    if (this.buffer.length > 0) {
      const line = this.buffer.replace(/\r$/, '')
      this.buffer = ''
      const event = this.consumeLine(line)
      if (event) events.push(event)
    }
    const pending = this.dispatch()
    if (pending) events.push(pending)
    return events
  }

  private consumeLine(line: string): SseEvent | null {
    if (line === '') return this.dispatch()
    if (line.startsWith(':')) return null

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') this.eventName = value
    else if (field === 'data') this.dataLines.push(value)
    return null
  }

  private dispatch(): SseEvent | null {
    if (this.dataLines.length === 0) {
      this.eventName = null
      return null
    }
    const event: SseEvent = { event: this.eventName, data: this.dataLines.join('\n') }
    this.dataLines = []
    this.eventName = null
    return event
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function readMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  const record = asRecord(value)
  if (!record) return undefined
  const message = record.message
  return typeof message === 'string' ? message : undefined
}

export function extractOpenAiDelta(payload: unknown): string {
  const choices = asRecord(payload)?.choices
  if (!Array.isArray(choices)) return ''
  let output = ''
  for (const choice of choices) {
    const delta = asRecord(asRecord(choice)?.delta)?.content
    if (typeof delta === 'string') {
      output += delta
      continue
    }
    if (Array.isArray(delta)) {
      for (const part of delta) {
        const text = asRecord(part)?.text
        if (typeof text === 'string') output += text
      }
    }
  }
  return output
}

function extractOpenAiToolDeltas(payload: unknown): StreamDelta['toolCallDeltas'] {
  const choices = asRecord(payload)?.choices
  if (!Array.isArray(choices)) return []
  const deltas: NonNullable<StreamDelta['toolCallDeltas']> = []
  for (const choice of choices) {
    const calls = asRecord(asRecord(choice)?.delta)?.tool_calls
    if (!Array.isArray(calls)) continue
    for (const item of calls) {
      const call = asRecord(item)
      const fn = asRecord(call?.function)
      if (!call || typeof call.index !== 'number') continue
      deltas.push({
        index: call.index,
        ...(typeof call.id === 'string' ? { id: call.id } : {}),
        ...(typeof fn?.name === 'string' ? { name: fn.name } : {}),
        ...(typeof fn?.arguments === 'string' ? { argumentsDelta: fn.arguments } : {})
      })
    }
  }
  return deltas
}

export function extractGeminiDelta(payload: unknown): string {
  const candidates = asRecord(payload)?.candidates
  if (!Array.isArray(candidates)) return ''
  let output = ''
  for (const candidate of candidates) {
    const parts = asRecord(asRecord(candidate)?.content)?.parts
    if (!Array.isArray(parts)) continue
    for (const part of parts) {
      const record = asRecord(part)
      if (!record || record.thought === true) continue
      if (typeof record.text === 'string') output += record.text
    }
  }
  return output
}

function extractGeminiToolCalls(payload: unknown): StreamDelta['toolCalls'] {
  const candidates = asRecord(payload)?.candidates
  if (!Array.isArray(candidates)) return []
  const calls: NonNullable<StreamDelta['toolCalls']> = []
  for (const candidate of candidates) {
    if (!asRecord(candidate)?.finishReason) continue
    const parts = asRecord(asRecord(candidate)?.content)?.parts
    if (!Array.isArray(parts)) continue
    for (const part of parts) {
      const call = asRecord(asRecord(part)?.functionCall)
      if (call && typeof call.name === 'string') {
        calls.push({
          id: `gemini_${calls.length}`,
          name: call.name,
          arguments: JSON.stringify(call.args ?? {}),
          ...(typeof asRecord(part)?.thoughtSignature === 'string'
            ? { thoughtSignature: asRecord(part)?.thoughtSignature as string }
            : {})
        })
      }
    }
  }
  return calls
}

export function extractGeminiBlockReason(payload: unknown): string | undefined {
  const feedback = asRecord(asRecord(payload)?.promptFeedback)
  const reason = feedback?.blockReason
  return typeof reason === 'string' ? `Request blocked by Gemini (${reason}).` : undefined
}

export function extractAnthropicDelta(event: SseEvent): string {
  if (event.event !== 'content_block_delta') return ''
  let payload: unknown
  try {
    payload = JSON.parse(event.data)
  } catch {
    return ''
  }
  const delta = asRecord(asRecord(payload)?.delta)
  if (!delta) return ''
  if (delta.type !== 'text_delta') return ''
  return typeof delta.text === 'string' ? delta.text : ''
}

export function extractAnthropicToolDelta(event: SseEvent): StreamDelta['toolCallDeltas'] {
  try {
    const payload = asRecord(JSON.parse(event.data))
    if (!payload) return []
    if (event.event === 'content_block_start') {
      const block = asRecord(payload.content_block)
      if (block?.type === 'tool_use' && typeof block.name === 'string') {
        return [{ index: Number(payload.index) || 0, id: String(block.id ?? ''), name: block.name }]
      }
    }
    if (event.event === 'content_block_delta') {
      const delta = asRecord(payload.delta)
      if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        return [{ index: Number(payload.index) || 0, argumentsDelta: delta.partial_json }]
      }
    }
  } catch {}
  return []
}

export function extractAnthropicError(event: SseEvent): string | undefined {
  if (event.event !== 'error') return undefined
  try {
    const payload = JSON.parse(event.data)
    return readMessage(asRecord(payload)?.error) ?? 'Anthropic returned an error.'
  } catch {
    return 'Anthropic returned an error.'
  }
}

/**
 * Turns one SSE event into text/terminal/error information for a protocol.
 * Unknown or unparseable events are ignored so keep-alive traffic stays quiet.
 */
export function extractStreamDelta(protocol: ProviderProtocol, event: SseEvent): StreamDelta {
  if (protocol === 'anthropic') {
    const error = extractAnthropicError(event)
    if (error) return { delta: '', error }
    if (event.event === 'message_stop') return { delta: '', done: true }
    const toolCallDeltas = extractAnthropicToolDelta(event) ?? []
    const delta = extractAnthropicDelta(event)
    return {
      delta,
      ...(toolCallDeltas.length ? { toolCallDeltas } : {})
    }
  }

  if (event.data.trim() === '[DONE]') return { delta: '', done: true }

  let payload: unknown
  try {
    payload = JSON.parse(event.data)
  } catch {
    return { delta: '' }
  }

  const failure = readMessage(asRecord(payload)?.error)
  if (failure) return { delta: '', error: failure }

  if (protocol === 'gemini') {
    const delta = extractGeminiDelta(payload)
    const toolCalls = extractGeminiToolCalls(payload) ?? []
    const error = extractGeminiBlockReason(payload)
    return { delta, ...(toolCalls.length ? { toolCalls } : {}), ...(error ? { error } : {}) }
  }
  const delta = extractOpenAiDelta(payload)
  const toolCallDeltas = extractOpenAiToolDeltas(payload) ?? []
  return { delta, ...(toolCallDeltas.length ? { toolCallDeltas } : {}) }
}
