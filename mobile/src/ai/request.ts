import type { ChatTurn, ProviderProfile } from '../domain/types'

export class AiRequestError extends Error {
  status?: number

  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message)
    this.name = 'AiRequestError'
    this.status = options?.status
    if (options?.cause !== undefined) {
      // `cause` is supported on modern Hermes; assign defensively for older runtimes.
      ;(this as AiRequestError & { cause?: unknown }).cause = options.cause
    }
  }
}

export interface ChatHttpRequest {
  url: string
  headers: Record<string, string>
  body: string
}

export interface BuildChatRequestInput {
  provider: ProviderProfile
  modelId: string
  apiKey: string
  turns: ChatTurn[]
  systemPrompt: string
}

const ANTHROPIC_MAX_TOKENS = 4096
const TEMPERATURE = 0.7

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) throw new AiRequestError('This provider has no base URL yet.')
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new AiRequestError('The base URL must start with http:// or https://.')
  }
  return trimmed
}

export function isLoopbackHost(baseUrl: string): boolean {
  try {
    const host = new URL(normalizeBaseUrl(baseUrl)).hostname.toLowerCase()
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local')
    )
  } catch {
    return false
  }
}

function requireKey(provider: ProviderProfile, apiKey: string): string {
  const key = apiKey.trim()
  if (key) return key
  if (isLoopbackHost(provider.baseUrl)) return ''
  throw new AiRequestError(`Add an API key for ${provider.name} in Settings.`)
}

function buildGemini(input: BuildChatRequestInput, apiKey: string): ChatHttpRequest {
  const base = normalizeBaseUrl(input.provider.baseUrl)
  const contents = input.turns.map((turn) => ({
    role: turn.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: turn.content }]
  }))
  return {
    url: `${base}/models/${encodeURIComponent(input.modelId)}:streamGenerateContent?alt=sse`,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.systemPrompt }] },
      contents,
      generationConfig: { temperature: TEMPERATURE, maxOutputTokens: ANTHROPIC_MAX_TOKENS }
    })
  }
}

function buildOpenAi(input: BuildChatRequestInput, apiKey: string): ChatHttpRequest {
  const base = normalizeBaseUrl(input.provider.baseUrl)
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return {
    url,
    headers,
    body: JSON.stringify({
      model: input.modelId,
      stream: true,
      temperature: TEMPERATURE,
      messages: [
        { role: 'system', content: input.systemPrompt },
        ...input.turns.map((turn) => ({ role: turn.role, content: turn.content }))
      ]
    })
  }
}

function buildAnthropic(input: BuildChatRequestInput, apiKey: string): ChatHttpRequest {
  const base = normalizeBaseUrl(input.provider.baseUrl)
  const url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01'
  }
  if (apiKey) headers['x-api-key'] = apiKey
  return {
    url,
    headers,
    body: JSON.stringify({
      model: input.modelId,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      temperature: 1,
      system: input.systemPrompt,
      stream: true,
      messages: input.turns.map((turn) => ({ role: turn.role, content: turn.content }))
    })
  }
}

export function buildChatRequest(input: BuildChatRequestInput): ChatHttpRequest {
  if (input.turns.length === 0) {
    throw new AiRequestError('There is nothing to send yet.')
  }
  if (!input.modelId.trim()) {
    throw new AiRequestError('Pick a model for this conversation first.')
  }
  const apiKey = requireKey(input.provider, input.apiKey)

  switch (input.provider.protocol) {
    case 'gemini':
      return buildGemini(input, apiKey)
    case 'anthropic':
      return buildAnthropic(input, apiKey)
    default:
      return buildOpenAi(input, apiKey)
  }
}
