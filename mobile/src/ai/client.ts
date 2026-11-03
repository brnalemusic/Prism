import { fetch as streamingFetch } from 'expo/fetch'
import type { ChatTurn, ProviderProfile } from '../domain/types'
import { MOBILE_SYSTEM_PROMPT } from './persona'
import { AiRequestError, buildChatRequest } from './request'
import { SseDecoder, extractStreamDelta, type SseEvent } from './sse'
import type { ToolCall } from './toolCatalog'

export interface StreamChatOptions {
  provider: ProviderProfile
  modelId: string
  apiKey: string
  turns: ChatTurn[]
  signal?: AbortSignal
  onDelta: (delta: string) => void
  onToolCall?: (call: ToolCall) => Promise<string>
  onToolProgress?: (
    call: ToolCall,
    status: 'pending' | 'running' | 'done' | 'error',
    result?: string
  ) => void
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: unknown }).name
  return name === 'AbortError' || name === 'CancelledError'
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

async function readFailureMessage(response: {
  text: () => Promise<string>
}): Promise<string | null> {
  try {
    const raw = await response.text()
    if (!raw) return null
    const parsed = toRecord(JSON.parse(raw))
    const error = toRecord(parsed?.error)
    const message = error?.message ?? parsed?.message ?? parsed?.detail
    if (typeof message === 'string' && message.trim()) return message.trim()
    return raw.slice(0, 240)
  } catch {
    return null
  }
}

function describeStatus(status: number, providerName: string): string {
  if (status === 401 || status === 403) {
    return `${providerName} rejected this API key. Check it in Settings → Providers.`
  }
  if (status === 404) {
    return `${providerName} could not find that endpoint or model. Check the base URL and model id.`
  }
  if (status === 429) {
    return `${providerName} is rate limiting this key. Wait a moment or switch models.`
  }
  if (status >= 500) {
    return `${providerName} had a server error (${status}). Try again in a moment.`
  }
  return `${providerName} rejected the request (${status}).`
}

/**
 * Streams one assistant reply. Uses `expo/fetch`, which exposes a real
 * ReadableStream on native unlike the RN fetch polyfill.
 */
export async function streamChat(options: StreamChatOptions): Promise<string> {
  const turns = [...options.turns]
  let text = ''
  const executions = new Map<string, number>()
  for (let round = 0; round < 8; round += 1) {
    const request = buildChatRequest({
      provider: options.provider,
      modelId: options.modelId,
      apiKey: options.apiKey,
      turns,
      systemPrompt: MOBILE_SYSTEM_PROMPT,
      tools: Boolean(options.onToolCall)
    })

    let response: Awaited<ReturnType<typeof streamingFetch>>
    try {
      response = await streamingFetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: options.signal
      })
    } catch (error) {
      if (isAbortError(error)) throw error
      const detail = error instanceof Error ? error.message : ''
      throw new AiRequestError(
        detail
          ? `Could not reach ${options.provider.name}: ${detail}`
          : `Could not reach ${options.provider.name}. Check your connection.`,
        { cause: error }
      )
    }

    if (!response.ok) {
      const detail = await readFailureMessage(response)
      throw new AiRequestError(detail ?? describeStatus(response.status, options.provider.name), {
        status: response.status
      })
    }

    const body = response.body
    if (!body)
      throw new AiRequestError(
        'This device could not open a streaming response. Update Prism Mobile and try again.'
      )

    const reader = body.getReader()
    const textDecoder = new TextDecoder()
    const sse = new SseDecoder()
    let roundText = ''
    const calls = new Map<number, ToolCall>()

    const consume = (events: SseEvent[]): void => {
      for (const event of events) {
        const result = extractStreamDelta(options.provider.protocol, event)
        if (result.error) throw new AiRequestError(result.error)
        if (result.delta) {
          text += result.delta
          roundText += result.delta
          options.onDelta(result.delta)
        }
        for (const complete of result.toolCalls ?? []) {
          calls.set(calls.size, complete)
          options.onToolProgress?.(complete, 'pending')
        }
        for (const delta of result.toolCallDeltas ?? []) {
          const current = calls.get(delta.index) ?? {
            id: delta.id ?? `call_${delta.index}`,
            name: '',
            arguments: ''
          }
          calls.set(delta.index, {
            id: delta.id || current.id,
            name: delta.name || current.name,
            arguments: current.arguments + (delta.argumentsDelta ?? '')
          })
          const partial = calls.get(delta.index)!
          options.onToolProgress?.(partial, 'pending')
        }
      }
    }

    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (!value) continue
        consume(sse.push(textDecoder.decode(value, { stream: true })))
      }
      consume(sse.push(textDecoder.decode()))
      consume(sse.flush())
    } catch (error) {
      if (isAbortError(error)) throw error
      if (error instanceof AiRequestError) throw error
      const detail = error instanceof Error ? error.message : ''
      throw new AiRequestError(
        detail ? `The stream stopped unexpectedly: ${detail}` : 'The stream stopped unexpectedly.',
        { cause: error }
      )
    } finally {
      try {
        reader.releaseLock()
      } catch {
        // Reader may already be released after a transport failure.
      }
    }

    const toolCalls = Array.from(calls.values()).filter(
      (call) => call.id && call.name && call.arguments
    )
    if (calls.size > 0 && toolCalls.length !== calls.size) {
      throw new AiRequestError(
        'The provider returned an incomplete tool call. No tools were executed.'
      )
    }
    if (!toolCalls.length) return text
    const assistantTurn: ChatTurn = {
      role: 'assistant' as const,
      content: roundText || null,
      tool_calls: toolCalls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        ...('thoughtSignature' in call && typeof call.thoughtSignature === 'string'
          ? { thought_signature: call.thoughtSignature }
          : {}),
        function: { name: call.name, arguments: call.arguments }
      }))
    }
    turns.push(assistantTurn)
    if (options.provider.protocol === 'gemini') {
      for (const call of toolCalls) {
        options.onToolProgress?.(call, 'running')
        const result = await options.onToolCall!(call)
        turns.push({ role: 'tool', content: result, name: call.name, tool_call_id: call.id })
        options.onToolProgress?.(call, 'done', result)
      }
      continue
    }
    for (const call of toolCalls) {
      options.onToolProgress?.(call, 'pending')
      options.onToolProgress?.(call, 'running')
      let result: string
      const fingerprint = `${call.name}:${call.arguments}`
      const attempts = (executions.get(fingerprint) ?? 0) + 1
      executions.set(fingerprint, attempts)
      if (attempts > 3) {
        result = JSON.stringify({
          ok: false,
          error: {
            code: 'REPEATED_CALL',
            message: 'Blocked repeated tool call with identical arguments.',
            retryable: false
          }
        })
        turns.push({ role: 'tool', content: result, name: call.name, tool_call_id: call.id })
        options.onToolProgress?.(call, 'error', result)
        continue
      }
      try {
        result = await options.onToolCall!(call)
      } catch (error) {
        result = JSON.stringify({
          ok: false,
          error: {
            code: 'EXECUTION_FAILED',
            message: error instanceof Error ? error.message : String(error),
            retryable: false
          }
        })
      }
      turns.push({ role: 'tool', content: result, name: call.name, tool_call_id: call.id })
      options.onToolProgress?.(call, 'done', result)
    }
  }
  return text
}
