import { nativeImage } from 'electron'
import { randomUUID } from 'crypto'
import { loadConfig } from '../config'
import { loadChatImageAsset } from '../history'
import {
  asDataUrl,
  imageAssetReference,
  type SystemToolResult,
  type ToolImageAttachment
} from '../toolAttachments'
import { resolveExactProviderAndModel } from './providerManager'
import { generatePuterImage } from './puterClient'
import {
  buildImageGenerationEndpoint,
  buildImageEditFormData,
  detectImageMimeType,
  ImageGenerationError,
  IMAGE_GENERATION_MIME_TYPES,
  hasImageGenerationCredentials,
  imageGenerationSizeToRatio,
  isImageGenerationCompletionType,
  isStrictBase64,
  mapImageGenerationHttpError,
  parseBase64ImageDataUrl,
  parseImageGenerationResponse,
  type ImageGenerationOperation,
  type ImageGenerationMimeType,
  type ImageSourceDescriptor
} from './imageGenerationCore'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024
export interface ImageGenerationArguments {
  prompt: string
  operation: ImageGenerationOperation
  sourceImageRef?: string
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
  if (!hasImageGenerationCredentials(provider)) {
    throw routeError(
      'IMAGE_ROUTE_STALE',
      provider.completionType === 'puter_native'
        ? 'Reconnect your Puter account to use native image generation.'
        : 'The configured image provider is missing its endpoint or credentials.'
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

function editSourceError(message: string): ImageGenerationError {
  return new ImageGenerationError({
    code: 'IMAGE_EDIT_SOURCE_INVALID',
    userMessage: message,
    retryable: false
  })
}

function validateEditSource(attachment: ToolImageAttachment): Buffer {
  if (!isStrictBase64(attachment.data)) {
    throw editSourceError('The selected source image contains invalid data.')
  }
  const bytes = Buffer.from(attachment.data.replace(/\s/g, ''), 'base64')
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw editSourceError('The selected source image is empty or too large.')
  }
  const detectedMime = detectImageMimeType(bytes)
  if (!detectedMime || detectedMime !== attachment.mimeType) {
    throw editSourceError('The selected source image has an invalid or unsupported format.')
  }
  const decoded = nativeImage.createFromBuffer(bytes)
  if (decoded.isEmpty()) throw editSourceError('The selected source image could not be decoded.')
  const { width, height } = decoded.getSize()
  if (width < 1 || height < 1 || width > 16384 || height > 16384) {
    throw editSourceError('The selected source image has invalid dimensions.')
  }
  return bytes
}

function sourceFilename(attachment: ToolImageAttachment): string {
  const extension =
    attachment.mimeType === 'image/jpeg'
      ? 'jpg'
      : attachment.mimeType === 'image/webp'
        ? 'webp'
        : 'png'
  const base = (attachment.name || 'prism-edit-source')
    .replace(/\.[a-zA-Z0-9]{1,5}$/i, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
  return `${base || 'prism-edit-source'}.${extension}`
}

function puterImageError(error: unknown): ImageGenerationError {
  const message = error instanceof Error ? error.message : String(error || '')
  const normalized = message.toLowerCase()
  if (/unauthori[sz]ed|auth|session|login|token/.test(normalized)) {
    return new ImageGenerationError({
      code: 'IMAGE_AUTH',
      userMessage: 'Your Puter account session has expired. Reconnect your account and try again.',
      retryable: false,
      providerMessage: message.slice(0, 500)
    })
  }
  if (/credit|quota|billing|insufficient/.test(normalized)) {
    return new ImageGenerationError({
      code: 'IMAGE_QUOTA',
      userMessage: 'Your Puter account does not have enough credits for this image generation.',
      retryable: false,
      providerMessage: message.slice(0, 500)
    })
  }
  if (/rate.?limit|too many|429/.test(normalized)) {
    return new ImageGenerationError({
      code: 'IMAGE_RATE_LIMIT',
      userMessage: 'Puter rate limited this image generation. Please try again shortly.',
      retryable: true,
      providerMessage: message.slice(0, 500)
    })
  }
  if (/model.*(?:not found|unsupported|invalid)|unsupported.*model/.test(normalized)) {
    return new ImageGenerationError({
      code: 'IMAGE_MODEL_UNSUPPORTED',
      userMessage: 'The selected Puter model cannot generate or edit this image.',
      retryable: false,
      providerMessage: message.slice(0, 500)
    })
  }
  return new ImageGenerationError({
    code: 'IMAGE_PROVIDER',
    userMessage: 'Puter could not complete the image generation.',
    retryable: true,
    providerMessage: message.slice(0, 500)
  })
}

async function awaitPuterImage(source: Promise<string>, signal?: AbortSignal): Promise<string> {
  if (!signal) return source
  if (signal.aborted) throw abortError()
  let onAbort: (() => void) | undefined
  const aborted = new Promise<string>((_resolve, reject) => {
    onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([source, aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

async function materializePuterImage(source: string, signal?: AbortSignal): Promise<ToolImageAttachment> {
  const dataUrl = parseBase64ImageDataUrl(source)
  if (dataUrl) {
    return validateDecodedImage(Buffer.from(dataUrl.base64, 'base64'), dataUrl.mimeType)
  }

  let url: URL
  try {
    url = new URL(source)
  } catch {
    throw new ImageGenerationError({
      code: 'IMAGE_MALFORMED_RESPONSE',
      userMessage: 'Puter returned an invalid generated image source.',
      retryable: true
    })
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ImageGenerationError({
      code: 'IMAGE_MALFORMED_RESPONSE',
      userMessage: 'Puter returned an unsupported generated image source.',
      retryable: true
    })
  }
  const response = await fetchWithTimeout(url, { redirect: 'follow' }, signal, 60_000)
  if (!response.ok) {
    throw new ImageGenerationError({
      code: 'IMAGE_REMOTE_FETCH',
      userMessage: 'The generated Puter image could not be retrieved.',
      retryable: response.status >= 500 || response.status === 408 || response.status === 429,
      status: response.status
    })
  }
  return validateDecodedImage(
    await readResponseBody(response, MAX_IMAGE_BYTES, signal, 60_000),
    response.headers.get('content-type') || undefined
  )
}

async function generatePuterImages(
  args: ImageGenerationArguments,
  provider: NonNullable<ReturnType<typeof resolveExactProviderAndModel>['provider']>,
  model: NonNullable<ReturnType<typeof resolveExactProviderAndModel>['model']>,
  sourceAttachment: ToolImageAttachment | undefined,
  signal?: AbortSignal
): Promise<ToolImageAttachment[]> {
  const ratio = imageGenerationSizeToRatio(args.size)
  if (!ratio) {
    throw new ImageGenerationError({
      code: 'IMAGE_INVALID_OPTIONS',
      userMessage: 'The requested image size is invalid.',
      retryable: false
    })
  }
  if (sourceAttachment) validateEditSource(sourceAttachment)
  const inputImage = sourceAttachment ? asDataUrl(sourceAttachment) : undefined
  const attachments: ToolImageAttachment[] = []
  let firstError: unknown
  for (let index = 0; index < args.n; index += 1) {
    if (signal?.aborted) throw abortError()
    try {
      const source = await awaitPuterImage(
        generatePuterImage({
          authToken: provider.puterAuthToken || '',
          prompt: args.prompt,
          model: model.id,
          ...(model.provider ? { provider: model.provider } : {}),
          ...(args.quality ? { quality: args.quality } : {}),
          ratio,
          ...(inputImage ? { inputImage, inputImageMimeType: sourceAttachment?.mimeType } : {})
        }),
        signal
      )
      attachments.push({ ...(await materializePuterImage(source, signal)), assetId: randomUUID() })
    } catch (error) {
      if (error instanceof ImageGenerationError) {
        if (error.details.code === 'IMAGE_CANCELLED') throw error
        firstError ??= error
      } else {
        firstError ??= puterImageError(error)
      }
    }
  }
  if (signal?.aborted) throw abortError()
  if (attachments.length === 0) {
    throw firstError instanceof Error
      ? firstError
      : new ImageGenerationError({
          code: 'IMAGE_EMPTY_RESPONSE',
          userMessage: 'Puter returned no usable images.',
          retryable: true
        })
  }
  return attachments
}

function buildImageRequest(
  args: ImageGenerationArguments,
  modelId: string,
  apiKey: string,
  sourceAttachment?: ToolImageAttachment
): RequestInit {
  if (args.operation === 'generate') {
    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelId,
        prompt: args.prompt,
        size: args.size,
        n: args.n,
        ...(args.quality ? { quality: args.quality } : {})
      })
    }
  }
  if (!sourceAttachment) {
    throw new ImageGenerationError({
      code: 'IMAGE_EDIT_SOURCE_MISSING',
      userMessage: 'Choose a valid image from this conversation to edit.',
      retryable: false
    })
  }
  const bytes = validateEditSource(sourceAttachment)
  const form = buildImageEditFormData({
    model: modelId,
    prompt: args.prompt,
    size: args.size,
    n: args.n,
    ...(args.quality ? { quality: args.quality } : {}),
    imageBytes: new Uint8Array(bytes),
    imageMimeType: sourceAttachment.mimeType,
    filename: sourceFilename(sourceAttachment)
  })
  return {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  }
}

export async function generateImage(
  args: ImageGenerationArguments,
  signal?: AbortSignal,
  chatId?: string
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
  let sourceAttachment: ToolImageAttachment | undefined
  if (args.operation === 'edit') {
    if (!chatId || !args.sourceImageRef) {
      throw new ImageGenerationError({
        code: 'IMAGE_EDIT_SOURCE_MISSING',
        userMessage: 'Choose an image from this conversation to edit.',
        retryable: false
      })
    }
    sourceAttachment = loadChatImageAsset(chatId, args.sourceImageRef) || undefined
    if (!sourceAttachment) {
      throw editSourceError(
        'The selected image reference is unavailable or does not belong to this conversation.'
      )
    }
  }
  if (provider.completionType === 'puter_native') {
    const attachments = await generatePuterImages(args, provider, model, sourceAttachment, signal)
    const verb = args.operation === 'edit' ? 'Edited' : 'Generated'
    const references = attachments
      .map((attachment) => imageAssetReference(attachment))
      .filter((reference): reference is string => Boolean(reference))
    return {
      output:
        `${verb} ${attachments.length} image${attachments.length === 1 ? '' : 's'} successfully.` +
        (references.length > 0
          ? `\nImage references:\n${references.map((ref) => `- ${ref}`).join('\n')}`
          : ''),
      attachments
    }
  }
  let endpoint: string
  try {
    endpoint = buildImageGenerationEndpoint(provider.baseUrl, args.operation)
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
      buildImageRequest(args, model.id, provider.apiKey, sourceAttachment),
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
        mapImageGenerationHttpError(response.status, response.statusText, args.operation)
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
      mapImageGenerationHttpError(
        response.status,
        readProviderError(payload, response.statusText),
        args.operation
      )
    )
  }

  const sources = parseImageGenerationResponse(payload).slice(0, args.n)
  const attachments: ToolImageAttachment[] = []
  let firstError: unknown
  for (const source of sources) {
    try {
      attachments.push({
        ...(await materializeSource(source, provider.baseUrl, provider.apiKey, signal)),
        assetId: randomUUID()
      })
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

  const verb = args.operation === 'edit' ? 'Edited' : 'Generated'
  const references = attachments
    .map((attachment) => imageAssetReference(attachment))
    .filter((reference): reference is string => Boolean(reference))
  return {
    output:
      `${verb} ${attachments.length} image${attachments.length === 1 ? '' : 's'} successfully.` +
      (references.length > 0
        ? `\nImage references:\n${references.map((ref) => `- ${ref}`).join('\n')}`
        : ''),
    attachments
  }
}

export function asImageGenerationArguments(
  args: Record<string, unknown>
): ImageGenerationArguments {
  return {
    prompt: String(args.prompt || '').trim(),
    operation: args.operation === 'edit' ? 'edit' : 'generate',
    ...(typeof args.source_image_ref === 'string'
      ? { sourceImageRef: args.source_image_ref.trim() }
      : {}),
    size: typeof args.size === 'string' ? args.size : '1024x1024',
    ...(typeof args.quality === 'string' ? { quality: args.quality } : {}),
    n: typeof args.n === 'number' ? args.n : 1
  }
}

export function imageGenerationToolError(error: unknown): ImageGenerationError | null {
  return error instanceof ImageGenerationError ? error : null
}
