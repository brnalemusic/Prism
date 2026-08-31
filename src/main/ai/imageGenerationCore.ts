import type {
  ImageGenerationAdapter,
  ImageGenerationCapabilities,
  ProviderConfig,
  ProviderModel
} from '../../shared/types'

export const IMAGE_GENERATION_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type ImageGenerationMimeType = (typeof IMAGE_GENERATION_MIME_TYPES)[number]
export type ImageGenerationOperation = 'generate' | 'edit'

export type ImageGenerationErrorCode =
  | 'IMAGE_ROUTE_MISSING'
  | 'IMAGE_ROUTE_STALE'
  | 'IMAGE_ENDPOINT_UNSUPPORTED'
  | 'IMAGE_MODEL_UNSUPPORTED'
  | 'IMAGE_INVALID_OPTIONS'
  | 'IMAGE_EDIT_SOURCE_MISSING'
  | 'IMAGE_EDIT_SOURCE_INVALID'
  | 'IMAGE_EDIT_UNSUPPORTED'
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
  return (
    value === 'chat_completions' ||
    value === 'responses' ||
    value === 'gemini_native' ||
    value === 'puter_native'
  )
}

export function defaultImageGenerationCapabilities(
  completionType: string
): ImageGenerationCapabilities | null {
  if (completionType === 'puter_native') {
    return { adapter: 'puter', generate: true, edit: true }
  }
  if (completionType === 'responses') {
    return { adapter: 'openai_responses', generate: true, edit: true }
  }
  if (completionType === 'gemini_native') {
    return { adapter: 'gemini_generate_content', generate: true, edit: true }
  }
  if (completionType === 'chat_completions') {
    return { adapter: 'openai_images', generate: true, edit: true }
  }
  return null
}

export function resolveImageGenerationCapabilities(
  provider: ProviderConfig,
  model: ProviderModel
): ImageGenerationCapabilities | null {
  return model.imageGeneration || defaultImageGenerationCapabilities(provider.completionType)
}

export function supportsImageGenerationOperation(
  provider: ProviderConfig,
  model: ProviderModel,
  operation: ImageGenerationOperation
): boolean {
  const capabilities = resolveImageGenerationCapabilities(provider, model)
  return Boolean(capabilities && capabilities[operation])
}

export function hasImageGenerationCredentials(provider: ProviderConfig): boolean {
  return provider.completionType === 'puter_native'
    ? Boolean(provider.puterAuthToken?.trim())
    : Boolean(provider.baseUrl && provider.apiKey)
}

export function imageGenerationSizeToRatio(size: string): { w: number; h: number } | null {
  const match = size.trim().match(/^(\d+)x(\d+)$/)
  if (!match) return null
  const w = Number(match[1])
  const h = Number(match[2])
  return Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 ? { w, h } : null
}

export function parseBase64ImageDataUrl(value: string): {
  mimeType?: string
  base64: string
} | null {
  const match = value.trim().match(/^data:([^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/i)
  if (!match) return null
  const base64 = match[2].replace(/\s/g, '')
  return isStrictBase64(base64)
    ? { ...(match[1] ? { mimeType: match[1].toLowerCase() } : {}), base64 }
    : null
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
  const error = record.error as Record<string, unknown>
  if (
    error.code === 'INVALID_ARGUMENTS' ||
    error.code === 'UNKNOWN_TOOL' ||
    error.code === 'REPEATED_CALL' ||
    error.code === 'CANCELLED'
  ) {
    return false
  }
  return error.retryable === true
}

function trimOperationPath(pathname: string): string {
  return pathname.replace(
    /\/(?:chat\/completions|responses|images\/(?:generations|edits))\/?$/i,
    ''
  )
}

export function buildImageGenerationEndpoint(
  baseUrl: string,
  operation: ImageGenerationOperation = 'generate'
): string {
  const parsed = new URL(baseUrl.trim())
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Provider base URL must use HTTP or HTTPS.')
  }
  parsed.search = ''
  parsed.hash = ''
  const route = operation === 'edit' ? 'edits' : 'generations'
  parsed.pathname = `${trimOperationPath(parsed.pathname).replace(/\/$/, '')}/images/${route}`
  return parsed.toString().replace(/\/$/, '')
}

function normalizedApiRoot(baseUrl: string): URL {
  const parsed = new URL(baseUrl.trim())
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Provider base URL must use HTTP or HTTPS.')
  }
  parsed.search = ''
  parsed.hash = ''
  parsed.pathname = trimOperationPath(parsed.pathname).replace(/\/$/, '')
  return parsed
}

export function buildAdapterImageEndpoint(input: {
  baseUrl: string
  adapter: ImageGenerationAdapter
  model: string
  operation: ImageGenerationOperation
  endpoint?: string
  stabilityEngine?: 'core' | 'ultra'
}): string {
  if (input.endpoint) return new URL(input.endpoint).toString().replace(/\/$/, '')
  if (input.adapter === 'openai_images') {
    return buildImageGenerationEndpoint(input.baseUrl, input.operation)
  }
  const parsed = normalizedApiRoot(input.baseUrl)
  if (input.adapter === 'openai_responses') {
    parsed.pathname = `${parsed.pathname}/responses`
  } else if (input.adapter === 'gemini_generate_content') {
    parsed.pathname = `${parsed.pathname.replace(/\/openai$/i, '')}/models/${encodeURIComponent(input.model)}:generateContent`
  } else if (input.adapter === 'stability') {
    const stabilityRoot = parsed.pathname.replace(/\/v2beta.*$/i, '').replace(/\/$/, '')
    parsed.pathname =
      input.operation === 'edit'
        ? `${stabilityRoot}/v2beta/stable-image/edit/search-and-replace`
        : `${stabilityRoot}/v2beta/stable-image/generate/${input.stabilityEngine || 'core'}`
  } else {
    throw new Error('The selected image adapter does not use an HTTP endpoint.')
  }
  return parsed.toString().replace(/\/$/, '')
}

export function buildImageEditFormData(input: {
  model: string
  prompt: string
  size: string
  n: number
  quality?: string
  imageBytes: Uint8Array
  imageMimeType: ImageGenerationMimeType
  filename: string
}): FormData {
  const imageBuffer = new ArrayBuffer(input.imageBytes.byteLength)
  new Uint8Array(imageBuffer).set(input.imageBytes)
  const form = new FormData()
  form.append('model', input.model)
  form.append('prompt', input.prompt)
  form.append('size', input.size)
  form.append('n', String(input.n))
  if (input.quality) form.append('quality', input.quality)
  form.append('image', new Blob([imageBuffer], { type: input.imageMimeType }), input.filename)
  return form
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

export function parseAdapterImageResponse(
  payload: unknown,
  adapter: ImageGenerationAdapter
): ImageSourceDescriptor[] {
  if (adapter === 'openai_images') return parseImageGenerationResponse(payload)
  const sources: ImageSourceDescriptor[] = []
  const visit = (value: unknown, key = ''): void => {
    if (typeof value === 'string') {
      if (
        /^(?:https?:\/\/)/i.test(value) &&
        /(?:url|image_url)$/i.test(key)
      ) {
        sources.push({ type: 'url', value })
      } else if (
        isStrictBase64(value) &&
        /(?:b64_json|base64|image|result|data)$/i.test(key)
      ) {
        sources.push({ type: 'base64', value: value.replace(/\s/g, '') })
      }
      return
    }
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, key))
      return
    }
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      visit(child, childKey)
    }
  }
  visit(payload)
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
  providerMessage = '',
  operation: ImageGenerationOperation = 'generate'
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
      userMessage:
        operation === 'edit'
          ? 'The selected model cannot edit images.'
          : 'The selected model cannot generate images.',
      retryable: false,
      status,
      providerMessage: safeProviderMessage
    }
  }
  if (status === 404 || status === 405 || status === 501) {
    if (operation === 'edit') {
      return {
        code: 'IMAGE_EDIT_UNSUPPORTED',
        userMessage: 'The selected provider or model does not support image editing.',
        retryable: false,
        status,
        providerMessage: safeProviderMessage
      }
    }
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
        ? operation === 'edit'
          ? 'The selected model cannot edit images.'
          : 'The selected model cannot generate images.'
        : operation === 'edit'
          ? 'The image provider rejected the edit request or source image.'
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
