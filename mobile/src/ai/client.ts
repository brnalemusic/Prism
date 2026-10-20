import { fetch as streamingFetch } from 'expo/fetch'
import type { ChatTurn, ProviderProfile } from '../domain/types'
import { MOBILE_SYSTEM_PROMPT } from './persona'
import { AiRequestError, buildChatRequest } from './request'
import { SseDecoder, extractStreamDelta, type SseEvent } from './sse'

export interface StreamChatOptions {
  provider: ProviderProfile
  modelId: string
  apiKey: string
  turns: ChatTurn[]
  signal?: AbortSignal
  onDelta: (delta: string) => void
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

function handleEvent(
  event: SseEvent,
  protocol: ProviderProfile['protocol'],
  onDelta: (delta: string) => void
): void {
  const result = extractStreamDelta(protocol, event)
  if (result.error) throw new AiRequestError(result.error)
  if (result.delta) onDelta(result.delta)
}

/**
 * Streams one assistant reply. Uses `expo/fetch`, which exposes a real
 * ReadableStream on native unlike the RN fetch polyfill.
 */
export async function streamChat(options: StreamChatOptions): Promise<string> {
  const request = buildChatRequest({
    provider: options.provider,
    modelId: options.modelId,
    apiKey: options.apiKey,
    turns: options.turns,
    systemPrompt: MOBILE_SYSTEM_PROMPT
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
  if (!body) {
    throw new AiRequestError(
      'This device could not open a streaming response. Update Prism Mobile and try again.'
    )
  }

  const reader = body.getReader()
  const textDecoder = new TextDecoder()
  const sse = new SseDecoder()
  let text = ''

  const consume = (events: SseEvent[]): void => {
    for (const event of events) {
      handleEvent(event, options.provider.protocol, (delta) => {
        text += delta
        options.onDelta(delta)
      })
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

  return text
}
