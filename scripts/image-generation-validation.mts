import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildImageGenerationEndpoint,
  canRetryImageGenerationResult,
  detectImageMimeType,
  ImageGenerationError,
  isImageGenerationCompletionType,
  isStrictBase64,
  mapImageGenerationHttpError,
  parseImageGenerationResponse,
  resolveExactImageRouteFromProviders,
  sanitizeGeneratedImageFilename
} from '../src/main/ai/imageGenerationCore.ts'
import { deriveImageGenerationLifecycle } from '../src/renderer/src/imageGenerationState.ts'

test('builds normalized OpenAI-compatible image endpoints', () => {
  assert.equal(
    buildImageGenerationEndpoint('https://api.openai.com/v1'),
    'https://api.openai.com/v1/images/generations'
  )
  assert.equal(
    buildImageGenerationEndpoint('https://example.test/v1/chat/completions'),
    'https://example.test/v1/images/generations'
  )
  assert.equal(
    buildImageGenerationEndpoint('https://example.test/v1/responses?key=secret'),
    'https://example.test/v1/images/generations'
  )
})

test('accepts OpenAI URL and base64 response forms and rejects empty responses', () => {
  assert.deepEqual(parseImageGenerationResponse({ data: [{ b64_json: 'YWJjZA==' }] }), [
    { type: 'base64', value: 'YWJjZA==' }
  ])
  assert.deepEqual(
    parseImageGenerationResponse({ data: [{ url: 'https://cdn.example.test/image.png' }] }),
    [{ type: 'url', value: 'https://cdn.example.test/image.png' }]
  )
  assert.throws(
    () => parseImageGenerationResponse({ data: [] }),
    (error) =>
      error instanceof ImageGenerationError && error.details.code === 'IMAGE_EMPTY_RESPONSE'
  )
  assert.throws(
    () => parseImageGenerationResponse({ data: [{ url: 'file:///tmp/image.png' }] }),
    (error) =>
      error instanceof ImageGenerationError && error.details.code === 'IMAGE_MALFORMED_RESPONSE'
  )
})

test('maps provider failures to safe actionable image errors', () => {
  assert.equal(mapImageGenerationHttpError(401, 'bad key').code, 'IMAGE_AUTH')
  assert.equal(mapImageGenerationHttpError(429, 'quota exhausted').code, 'IMAGE_QUOTA')
  assert.equal(mapImageGenerationHttpError(429, 'slow down').code, 'IMAGE_RATE_LIMIT')
  assert.equal(
    mapImageGenerationHttpError(400, 'model text-only does not support image generation').code,
    'IMAGE_MODEL_UNSUPPORTED'
  )
  assert.equal(
    mapImageGenerationHttpError(404, 'route not found').code,
    'IMAGE_ENDPOINT_UNSUPPORTED'
  )
  assert.equal(mapImageGenerationHttpError(503, 'unavailable').retryable, true)
})

test('validates base64 and detects supported image signatures', () => {
  assert.equal(isStrictBase64('YWJjZA=='), true)
  assert.equal(isStrictBase64('not base64!'), false)
  assert.equal(
    detectImageMimeType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/png'
  )
  assert.equal(detectImageMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(detectImageMimeType(Uint8Array.from(Buffer.from('RIFFxxxxWEBP'))), 'image/webp')
})

test('recognizes only supported route types and sanitizes download names', () => {
  assert.equal(isImageGenerationCompletionType('chat_completions'), true)
  assert.equal(isImageGenerationCompletionType('responses'), true)
  assert.equal(isImageGenerationCompletionType('gemini_native'), false)
  assert.equal(
    sanitizeGeneratedImageFilename('../unsafe<>name.png', 'image/png', new Date('2026-08-24')),
    'unsafename.png'
  )
  assert.equal(
    sanitizeGeneratedImageFilename('', 'image/jpeg', new Date('2026-08-24')),
    'prism-generated-image-2026-08-24.jpg'
  )
})

test('resolves only exact enabled provider-model routes', () => {
  const providers = [
    {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'secret',
      completionType: 'responses' as const,
      isTrusted: true,
      models: [
        { id: 'gpt-image:1', enabled: true, isTrusted: true },
        { id: 'disabled-image', enabled: false, isTrusted: true }
      ]
    }
  ]
  assert.equal(
    resolveExactImageRouteFromProviders(providers, 'openai:gpt-image:1').model?.id,
    'gpt-image:1'
  )
  assert.equal(resolveExactImageRouteFromProviders(providers, 'gpt-image:1').model, null)
  assert.equal(resolveExactImageRouteFromProviders(providers, 'openai:disabled-image').model, null)
})

test('offers retry only for successful decode retries or retryable tool failures', () => {
  assert.equal(canRetryImageGenerationResult({ ok: true, output: 'generated' }), true)
  assert.equal(canRetryImageGenerationResult({ ok: false, error: { retryable: true } }), true)
  assert.equal(canRetryImageGenerationResult({ ok: false, error: { retryable: false } }), false)
})

test('derives deterministic UI lifecycle transitions', () => {
  assert.equal(
    deriveImageGenerationLifecycle({
      toolStatus: 'running',
      attachmentCount: 0,
      decoded: false,
      decodeFailed: false
    }),
    'generating'
  )
  assert.equal(
    deriveImageGenerationLifecycle({
      toolStatus: 'done',
      attachmentCount: 1,
      decoded: false,
      decodeFailed: false
    }),
    'loading-image'
  )
  assert.equal(
    deriveImageGenerationLifecycle({
      toolStatus: 'done',
      attachmentCount: 1,
      decoded: true,
      decodeFailed: false
    }),
    'completed'
  )
  assert.equal(
    deriveImageGenerationLifecycle({
      toolStatus: 'done',
      attachmentCount: 1,
      decoded: false,
      decodeFailed: true
    }),
    'error'
  )
  assert.equal(
    deriveImageGenerationLifecycle({
      toolStatus: 'cancelled',
      attachmentCount: 0,
      decoded: false,
      decodeFailed: false
    }),
    'cancelled'
  )
})
