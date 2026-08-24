import { nativeImage } from 'electron'
import { loadConfig } from '../config'
import type { SystemToolResult, ToolImageAttachment } from '../toolAttachments'
import { resolveExactProviderAndModel } from './providerManager'
import {
  buildImageGenerationEndpoint,
  detectImageMimeType,
  ImageGenerationError,
  IMAGE_GENERATION_MIME_TYPES,
  isImageGenerationCompletionType,
  isStrictBase64,
  mapImageGenerationHttpError,
  parseImageGenerationResponse,
  type ImageGenerationMimeType,
  type ImageSourceDescriptor
} from './imageGenerationCore'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024
export interface ImageGenerationArguments {
  prompt: string
  size: string
  quality?: string
  n: number
}

function routeError(
  code: 'IMAGE_ROUTE_MISSING' | 'IMAGE_ROUTE_STALE',
  message: string
): ImageGenerationError {
  return new ImageGenerationError({ code, userMessage: message, retryable: false })
}

export function resolveConfiguredImageGenerationRoute(): {
  provider: NonNullable<ReturnType<typeof resolveExactProviderAndModel>['provider']>
  model: NonNullable<ReturnType<typeof resolveExactProviderAndModel>['model']>
} {
  const route = loadConfig().imageGenerationModel
  if (!route) {
    throw routeError(
      'IMAGE_ROUTE_MISSING',
      'Choose an Image Generation Model in Settings > Intelligence Routing.'
    )
  }
  const { provider, model } = resolveExactProviderAndModel(route)
  if (!provider || !model || !isImageGenerationCompletionType(provider.completionType)) {
    throw routeError(
      'IMAGE_ROUTE_STALE',
      'The configured image-generation route is no longer available.'
    )
  }
  if (!provider.baseUrl || !provider.apiKey) {
    throw routeError(
      'IMAGE_ROUTE_STALE',
      'The configured image provider is missing its endpoint or credentials.'
    )
  }
  return { provider, model }
}

export function hasConfiguredImageGenerationRoute(): boolean {
  try {
    resolveConfiguredImageGenerationRoute()
    return true
  } catch {
    return false
  }
}

function abortError(): ImageGenerationError {
  return new ImageGenerationError({
    code: 'IMAGE_CANCELLED',
    userMessage: 'Image generation was cancelled.',
    retryable: false
  })
}

async function fetchWithTimeout(
  input: string | URL,
  init: Omit<RequestInit, 'signal'>,
  externalSignal: AbortSignal | undefined,
  timeoutMs: number
): Promise<Response> {
  if (externalSignal?.aborted) throw abortError()
  const controller = new AbortController()
  const onExternalAbort = (): void => controller.abort()
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (externalSignal?.aborted) throw abortError()
    if (controller.signal.aborted) {
      throw new ImageGenerationError({
        code: 'IMAGE_TIMEOUT',
        userMessage: 'Image generation timed out.',
        retryable: true
      })
    }
    throw error
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

async function readResponseBody(
  response: Response,
  maximumBytes: number,
  externalSignal?: AbortSignal,
  timeoutMs = 60_000
): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length') || '0')
  if (contentLength > maximumBytes) {
    throw new ImageGenerationError({
      code: 'IMAGE_TOO_LARGE',
      userMessage: 'The generated image is too large to display safely.',
      retryable: false
    })
  }
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0
  let cancelled = externalSignal?.aborted === true
  let timedOut = false
  const cancelReader = (): void => {
    cancelled = true
    void reader.cancel().catch(() => {})
  }
  if (cancelled) {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
    throw abortError()
  }
  externalSignal?.addEventListener('abort', cancelReader, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    void reader.cancel().catch(() => {})
  }, timeoutMs)
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (cancelled) throw abortError()
      if (timedOut) {
        throw new ImageGenerationError({
          code: 'IMAGE_TIMEOUT',
          userMessage: 'Image generation timed out.',
          retryable: true
        })
      }
      if (done) break
      const chunk = Buffer.from(value)
      totalBytes += chunk.length
      if (totalBytes > maximumBytes) {
        void reader.cancel().catch(() => {})
        throw new ImageGenerationError({
          code: 'IMAGE_TOO_LARGE',
          userMessage: 'The generated image is too large to display safely.',
          retryable: false
        })
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, totalBytes)
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', cancelReader)
    reader.releaseLock()
  }
}

function validateDecodedImage(bytes: Buffer, declaredMime?: string): ToolImageAttachment {
  if (bytes.length === 0) {
    throw new ImageGenerationError({
      code: 'IMAGE_INVALID_DATA',
      userMessage: 'The image provider returned empty image data.',
      retryable: true
    })
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ImageGenerationError({
      code: 'IMAGE_TOO_LARGE',
      userMessage: 'The generated image is too large to display safely.',
      retryable: false
    })
  }

  const detectedMime = detectImageMimeType(bytes)
  const normalizedDeclared = declaredMime?.split(';')[0].trim().toLowerCase()
  if (!detectedMime) {
    throw new ImageGenerationError({
      code: 'IMAGE_INVALID_DATA',
      userMessage: 'The provider returned an unsupported image format.',
      retryable: true
    })
  }
  if (
    normalizedDeclared &&
    IMAGE_GENERATION_MIME_TYPES.includes(normalizedDeclared as ImageGenerationMimeType) &&
    normalizedDeclared !== detectedMime
  ) {
    throw new ImageGenerationError({
      code: 'IMAGE_INVALID_DATA',
      userMessage: 'The provider returned image data with a mismatched format.',
      retryable: true
    })
  }
  const mimeType = detectedMime

  const decoded = nativeImage.createFromBuffer(bytes)
  if (decoded.isEmpty()) {
    throw new ImageGenerationError({
      code: 'IMAGE_DECODE',
      userMessage: 'The generated image could not be decoded.',
      retryable: true
    })
  }
  const { width, height } = decoded.getSize()
  if (width < 1 || height < 1 || width > 16384 || height > 16384) {
    throw new ImageGenerationError({
      code: 'IMAGE_INVALID_DATA',
      userMessage: 'The generated image has invalid dimensions.',
      retryable: true
    })
  }
  return {
    kind: 'image',
    mimeType,
    data: bytes.toString('base64'),
    width,
    height,
    byteLength: bytes.length
  }
}

async function fetchRemoteImage(
  sourceUrl: string,
  providerBaseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<ToolImageAttachment> {
  const source = new URL(sourceUrl)
  const provider = new URL(providerBaseUrl)
  const request = async (authenticated: boolean): Promise<Response> =>
    fetchWithTimeout(
      source,
      {
        redirect: authenticated ? 'manual' : 'follow',
        headers: authenticated ? { Authorization: `Bearer ${apiKey}` } : undefined
      },
      signal,
      60_000
    )

  let response = await request(false)
  if ((response.status === 401 || response.status === 403) && source.origin === provider.origin) {
    response = await request(true)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) {
        throw new ImageGenerationError({
          code: 'IMAGE_REMOTE_FETCH',
          userMessage: 'The generated image could not be retrieved.',
          retryable: true
        })
      }
      const redirected = new URL(location, source)
      response = await fetchWithTimeout(
        redirected,
        {
          redirect: 'follow',
          headers:
            redirected.origin === provider.origin
              ? { Authorization: `Bearer ${apiKey}` }
              : undefined
        },
        signal,
        60_000
      )
    }
  }
  if (!response.ok) {
    throw new ImageGenerationError({
      code: 'IMAGE_REMOTE_FETCH',
      userMessage: 'The generated image could not be retrieved.',
      retryable: response.status >= 500 || response.status === 408 || response.status === 429,
      status: response.status
    })
  }
  const bytes = await readResponseBody(response, MAX_IMAGE_BYTES, signal, 60_000)
  return validateDecodedImage(bytes, response.headers.get('content-type') || undefined)
}

async function materializeSource(
  source: ImageSourceDescriptor,
  providerBaseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<ToolImageAttachment> {
  if (source.type === 'url') {
    return fetchRemoteImage(source.value, providerBaseUrl, apiKey, signal)
  }
  if (!isStrictBase64(source.value)) {
    throw new ImageGenerationError({
      code: 'IMAGE_INVALID_DATA',
      userMessage: 'The image provider returned malformed image data.',
      retryable: true
    })
  }
  return validateDecodedImage(Buffer.from(source.value.replace(/\s/g, ''), 'base64'))
}

function readProviderError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const record = payload as Record<string, unknown>
  const nested = record.error
  if (typeof nested === 'string') return nested
  if (nested && typeof nested === 'object') {
    const message = (nested as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  return typeof record.message === 'string' ? record.message : fallback
}

export async function generateImage(
  args: ImageGenerationArguments,
  signal?: AbortSignal
): Promise<SystemToolResult> {
  if (signal?.aborted) throw abortError()
  if (!args.prompt || args.prompt.length > 32000) {
    throw new ImageGenerationError({
      code: 'IMAGE_INVALID_OPTIONS',
      userMessage: 'The image prompt is empty or too long.',
      retryable: false
    })
  }
  const { provider, model } = resolveConfiguredImageGenerationRoute()
  let endpoint: string
  try {
    endpoint = buildImageGenerationEndpoint(provider.baseUrl)
  } catch {
    throw new ImageGenerationError({
      code: 'IMAGE_ROUTE_STALE',
      userMessage: 'The configured image provider endpoint is invalid.',
      retryable: false
    })
  }
  let response: Response
  try {
    response = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify({
          model: model.id,
          prompt: args.prompt,
          size: args.size,
          n: args.n,
          ...(args.quality ? { quality: args.quality } : {})
        })
      },
      signal,
      180_000
    )
  } catch (error) {
    if (error instanceof ImageGenerationError) throw error
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw abortError()
    }
    throw new ImageGenerationError({
      code: 'IMAGE_NETWORK',
      userMessage: 'Could not connect to the image provider.',
      retryable: true,
      providerMessage: error instanceof Error ? error.message.slice(0, 500) : undefined
    })
  }

  let payload: unknown
  try {
    const bytes = await readResponseBody(response, MAX_RESPONSE_BYTES, signal, 180_000)
    payload = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    if (error instanceof ImageGenerationError) throw error
    if (!response.ok) {
      throw new ImageGenerationError(
        mapImageGenerationHttpError(response.status, response.statusText)
      )
    }
    throw new ImageGenerationError({
      code: 'IMAGE_MALFORMED_RESPONSE',
      userMessage: 'The image provider returned an invalid response.',
      retryable: true,
      status: response.status
    })
  }
  if (!response.ok) {
    throw new ImageGenerationError(
      mapImageGenerationHttpError(response.status, readProviderError(payload, response.statusText))
    )
  }

  const sources = parseImageGenerationResponse(payload).slice(0, args.n)
  const attachments: ToolImageAttachment[] = []
  let firstError: unknown
  for (const source of sources) {
    try {
      attachments.push(await materializeSource(source, provider.baseUrl, provider.apiKey, signal))
    } catch (error) {
      firstError ??= error
    }
  }
  if (signal?.aborted) throw abortError()
  if (attachments.length === 0) {
    throw firstError instanceof Error
      ? firstError
      : new ImageGenerationError({
          code: 'IMAGE_INVALID_DATA',
          userMessage: 'The image provider returned no usable images.',
          retryable: true
        })
  }

  return {
    output: `Generated ${attachments.length} image${attachments.length === 1 ? '' : 's'} successfully.`,
    attachments
  }
}

export function asImageGenerationArguments(
  args: Record<string, unknown>
): ImageGenerationArguments {
  return {
    prompt: String(args.prompt || '').trim(),
    size: typeof args.size === 'string' ? args.size : '1024x1024',
    ...(typeof args.quality === 'string' ? { quality: args.quality } : {}),
    n: typeof args.n === 'number' ? args.n : 1
  }
}

export function imageGenerationToolError(error: unknown): ImageGenerationError | null {
  return error instanceof ImageGenerationError ? error : null
}
