import type { ProviderConfig, ProviderModel } from '../../shared/types'

export const IMAGE_GENERATION_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type ImageGenerationMimeType = (typeof IMAGE_GENERATION_MIME_TYPES)[number]

export type ImageGenerationErrorCode =
  | 'IMAGE_ROUTE_MISSING'
  | 'IMAGE_ROUTE_STALE'
  | 'IMAGE_ENDPOINT_UNSUPPORTED'
  | 'IMAGE_MODEL_UNSUPPORTED'
  | 'IMAGE_INVALID_OPTIONS'
  | 'IMAGE_AUTH'
  | 'IMAGE_QUOTA'
  | 'IMAGE_RATE_LIMIT'
  | 'IMAGE_PROVIDER'
  | 'IMAGE_TIMEOUT'
  | 'IMAGE_NETWORK'
  | 'IMAGE_MALFORMED_RESPONSE'
  | 'IMAGE_EMPTY_RESPONSE'
  | 'IMAGE_REMOTE_FETCH'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_INVALID_DATA'
  | 'IMAGE_DECODE'
  | 'IMAGE_CANCELLED'

export interface ImageGenerationErrorDetails {
  code: ImageGenerationErrorCode
  userMessage: string
  retryable: boolean
  status?: number
  providerMessage?: string
}

export class ImageGenerationError extends Error {
  readonly details: ImageGenerationErrorDetails

  constructor(details: ImageGenerationErrorDetails) {
    super(details.userMessage)
    this.name = 'ImageGenerationError'
    this.details = details
  }
}

export interface ImageSourceDescriptor {
  type: 'base64' | 'url'
  value: string
}

export function isImageGenerationCompletionType(value: string): boolean {
  return value === 'chat_completions' || value === 'responses'
}

export function resolveExactImageRouteFromProviders(
  providers: ProviderConfig[],
  fullKey?: string
): { provider: ProviderConfig | null; model: ProviderModel | null } {
  if (!fullKey || !fullKey.includes(':')) return { provider: null, model: null }
  const [providerId, ...modelParts] = fullKey.split(':')
  const modelId = modelParts.join(':')
  const provider = providers.find((candidate) => candidate.id === providerId)
  if (!provider) return { provider: null, model: null }
  const model = provider.models.find((candidate) => candidate.id === modelId && candidate.enabled)
  return model ? { provider, model } : { provider: null, model: null }
}

export function canRetryImageGenerationResult(result: unknown): boolean {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false
  const record = result as Record<string, unknown>
  if (record.ok === true) return true
  if (record.ok !== false || !record.error || typeof record.error !== 'object') return false
  return (record.error as Record<string, unknown>).retryable === true
}

function trimOperationPath(pathname: string): string {
  return pathname.replace(/\/(?:chat\/completions|responses|images\/generations)\/?$/i, '')
}

export function buildImageGenerationEndpoint(baseUrl: string): string {
  const parsed = new URL(baseUrl.trim())
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Provider base URL must use HTTP or HTTPS.')
  }
  parsed.search = ''
  parsed.hash = ''
  parsed.pathname = `${trimOperationPath(parsed.pathname).replace(/\/$/, '')}/images/generations`
  return parsed.toString().replace(/\/$/, '')
}

export function parseImageGenerationResponse(payload: unknown): ImageSourceDescriptor[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ImageGenerationError({
      code: 'IMAGE_MALFORMED_RESPONSE',
      userMessage: 'The image provider returned an invalid response.',
      retryable: true
    })
  }

  const data = (payload as Record<string, unknown>).data
  if (!Array.isArray(data)) {
    throw new ImageGenerationError({
      code: 'IMAGE_MALFORMED_RESPONSE',
      userMessage: 'The image provider returned an invalid response.',
      retryable: true
    })
  }
  if (data.length === 0) {
    throw new ImageGenerationError({
      code: 'IMAGE_EMPTY_RESPONSE',
      userMessage: 'The image provider returned no images.',
      retryable: true
    })
  }

  const sources: ImageSourceDescriptor[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (typeof record.b64_json === 'string' && record.b64_json.trim()) {
      sources.push({ type: 'base64', value: record.b64_json.trim() })
      continue
    }
    if (typeof record.url === 'string' && record.url.trim()) {
      let parsed: URL
      try {
        parsed = new URL(record.url.trim())
      } catch {
        continue
      }
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        sources.push({ type: 'url', value: parsed.toString() })
      }
    }
  }

  if (sources.length === 0) {
    throw new ImageGenerationError({
      code: 'IMAGE_MALFORMED_RESPONSE',
      userMessage: 'The image provider did not return a usable image.',
      retryable: true
    })
  }
  return sources
}

export function isStrictBase64(value: string): boolean {
  const compact = value.replace(/\s/g, '')
  return compact.length > 0 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(compact)
}

export function detectImageMimeType(bytes: Uint8Array): ImageGenerationMimeType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

function providerMessageSuggestsUnsupportedModel(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('model') &&
    (normalized.includes('image') ||
      normalized.includes('generation') ||
      normalized.includes('unsupported') ||
      normalized.includes('not support') ||
      normalized.includes('not found'))
  )
}

export function mapImageGenerationHttpError(
  status: number,
  providerMessage = ''
): ImageGenerationErrorDetails {
  const safeProviderMessage = providerMessage.trim().slice(0, 500) || undefined
  if (status === 401 || status === 403) {
    return {
      code: 'IMAGE_AUTH',
      userMessage: 'The image provider rejected its credentials.',
      retryable: false,
      status,
      providerMessage: safeProviderMessage
    }
  }
  if (status === 404 && providerMessageSuggestsUnsupportedModel(providerMessage)) {
    return {
      code: 'IMAGE_MODEL_UNSUPPORTED',
      userMessage: 'The selected model cannot generate images.',
      retryable: false,
      status,
      providerMessage: safeProviderMessage
    }
  }
  if (status === 404 || status === 405 || status === 501) {
    return {
      code: 'IMAGE_ENDPOINT_UNSUPPORTED',
      userMessage: 'The selected provider does not support image generation at this endpoint.',
      retryable: false,
      status,
      providerMessage: safeProviderMessage
    }
  }
  if (status === 408 || status === 504) {
    return {
      code: 'IMAGE_TIMEOUT',
      userMessage: 'Image generation timed out.',
      retryable: true,
      status,
      providerMessage: safeProviderMessage
    }
  }
  if (status === 429) {
    const isQuota = /quota|credit|billing|insufficient/i.test(providerMessage)
    return {
      code: isQuota ? 'IMAGE_QUOTA' : 'IMAGE_RATE_LIMIT',
      userMessage: isQuota
        ? 'The image provider quota is exhausted.'
        : 'The image provider rate limit was reached.',
      retryable: !isQuota,
      status,
      providerMessage: safeProviderMessage
    }
  }
  if (status === 400 || status === 422) {
    const unsupportedModel = providerMessageSuggestsUnsupportedModel(providerMessage)
    return {
      code: unsupportedModel ? 'IMAGE_MODEL_UNSUPPORTED' : 'IMAGE_INVALID_OPTIONS',
      userMessage: unsupportedModel
        ? 'The selected model cannot generate images.'
        : 'The image provider rejected the requested options.',
      retryable: false,
      status,
      providerMessage: safeProviderMessage
    }
  }
  return {
    code: 'IMAGE_PROVIDER',
    userMessage: 'The image provider could not complete the request.',
    retryable: status >= 500,
    status,
    providerMessage: safeProviderMessage
  }
}

export function sanitizeGeneratedImageFilename(
  value: string,
  mimeType: ImageGenerationMimeType,
  date = new Date()
): string {
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1]
  const fallback = `prism-generated-image-${date.toISOString().slice(0, 10)}`
  const base = (value || fallback)
    .replace(/\.[a-zA-Z0-9]{1,5}$/i, '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 96)
  return `${base || fallback}.${extension}`
}
