import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildImageEditFormData,
  buildAdapterImageEndpoint,
  buildImageGenerationEndpoint,
  canRetryImageGenerationResult,
  defaultImageGenerationCapabilities,
  detectImageMimeType,
  getImageGenerationCapabilityState,
  hasImageGenerationCredentials,
  imageGenerationSizeToRatio,
  isImageGenerationProtocolIncompatibility,
  ImageGenerationError,
  isImageGenerationCompletionType,
  isStrictBase64,
  mapImageGenerationHttpError,
  parseBase64ImageDataUrl,
  parseAdapterImageResponse,
  parseImageGenerationResponse,
  resolveImageGenerationCandidates,
  resolveExactImageRouteFromProviders,
  sanitizeGeneratedImageFilename,
  shouldForwardImageToolAttachments
} from '../src/main/ai/imageGenerationCore.ts'
import {
  deriveImageGenerationLifecycle,
  formatImageActivityLabel,
  resolveGeneratedImageAspectRatio
} from '../src/renderer/src/imageGenerationState.ts'
import { splitChatTimeline, type ChatTimelineEntry } from '../src/renderer/src/chatTimeline.ts'
import {
  dedupeImageAttachments,
  formatImageAssetReference,
  parseImageAssetReference
} from '../src/main/imageAssets.ts'

test('keeps tool-free assistant text visible after streaming ends', () => {
  const entries: ChatTimelineEntry[] = [
    { kind: 'text', key: 'greeting', content: 'Hello, friend.', textOffset: 0 }
  ]

  const timeline = splitChatTimeline(entries)
  assert.equal(timeline.hasTools, false)
  assert.deepEqual(timeline.history, [])
  assert.deepEqual(timeline.final, entries)
})

test('keeps only successful generated images outside collapsed work', () => {
  const imageAttachment = {
    kind: 'image' as const,
    mimeType: 'image/png' as const,
    data: 'YWJjZA=='
  }
  const entries: ChatTimelineEntry[] = [
    { kind: 'text', key: 'before', content: 'I will make it.', textOffset: 0 },
    {
      kind: 'tool',
      key: 'failed-image',
      tool: {
        id: 'failed-image',
        name: 'generate_image',
        args: {},
        status: 'error',
        result: '{"ok":false,"error":{"retryable":true}}'
      }
    },
    {
      kind: 'tool',
      key: 'completed-image',
      tool: {
        id: 'completed-image',
        name: 'generate_image',
        args: {},
        status: 'done',
        attachments: [imageAttachment]
      }
    },
    { kind: 'text', key: 'final', content: 'Here is the image.', textOffset: 16 }
  ]

  const timeline = splitChatTimeline(entries)
  assert.deepEqual(
    timeline.history.map((entry) => entry.key),
    ['before', 'failed-image']
  )
  assert.deepEqual(
    timeline.final.map((entry) => entry.key),
    ['completed-image', 'final']
  )
})

test('compacts cancelled and attachment-free image results', () => {
  const entries: ChatTimelineEntry[] = [
    {
      kind: 'tool',
      key: 'cancelled-image',
      tool: { name: 'generate_image', args: {}, status: 'cancelled' }
    },
    {
      kind: 'tool',
      key: 'missing-image',
      tool: { name: 'generate_image', args: {}, status: 'done' }
    }
  ]

  const timeline = splitChatTimeline(entries)
  assert.deepEqual(
    timeline.history.map((entry) => entry.key),
    ['cancelled-image', 'missing-image']
  )
  assert.deepEqual(timeline.final, [])
})

test('keeps image activity labels short and quiet', () => {
  assert.equal(
    formatImageActivityLabel('  Painting   a calm blue lake...  ', 'Generating image'),
    'Painting a calm blue lake'
  )
  assert.equal(
    formatImageActivityLabel(
      'Creating an intricate cinematic image with far too many details',
      'Generating image'
    ),
    'Creating an intricate cinematic image with'
  )
  assert.equal(formatImageActivityLabel('...', 'Generating image'), 'Generating image')
})

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
  assert.equal(
    buildImageGenerationEndpoint('https://example.test/v1/images/generations', 'edit'),
    'https://example.test/v1/images/edits'
  )
})

test('builds provider-specific image endpoints', () => {
  assert.equal(
    buildAdapterImageEndpoint({
      baseUrl: 'https://api.openai.com/v1',
      adapter: 'openai_responses',
      model: 'gpt-5.4-image-2',
      operation: 'generate'
    }),
    'https://api.openai.com/v1/responses'
  )
  assert.equal(
    buildAdapterImageEndpoint({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      adapter: 'gemini_generate_content',
      model: 'gemini-image-model',
      operation: 'edit'
    }),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-image-model:generateContent'
  )
  assert.equal(
    buildAdapterImageEndpoint({
      baseUrl: 'https://api.stability.ai',
      adapter: 'stability',
      model: 'stable-image-ultra',
      operation: 'generate',
      stabilityEngine: 'ultra'
    }),
    'https://api.stability.ai/v2beta/stable-image/generate/ultra'
  )
})

test('builds standard multipart image edit requests', async () => {
  const form = buildImageEditFormData({
    model: 'image-model',
    prompt: 'Turn the apple green',
    size: '1024x1024',
    n: 1,
    quality: 'high',
    imageBytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
    imageMimeType: 'image/png',
    filename: 'apple.png'
  })
  assert.equal(form.get('model'), 'image-model')
  assert.equal(form.get('prompt'), 'Turn the apple green')
  assert.equal(form.get('n'), '1')
  const image = form.get('image')
  assert.ok(image instanceof Blob)
  assert.equal(image.type, 'image/png')
  assert.equal(image.size, 4)
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

test('normalizes Responses, Gemini, and Stability image payloads', () => {
  assert.deepEqual(
    parseAdapterImageResponse(
      { output: [{ type: 'image_generation_call', result: 'YWJjZA==' }] },
      'openai_responses'
    ),
    [{ type: 'base64', value: 'YWJjZA==' }]
  )
  assert.deepEqual(
    parseAdapterImageResponse(
      { candidates: [{ content: { parts: [{ inlineData: { data: 'YWJjZA==' } }] } }] },
      'gemini_generate_content'
    ),
    [{ type: 'base64', value: 'YWJjZA==' }]
  )
  assert.deepEqual(parseAdapterImageResponse({ image: 'YWJjZA==' }, 'stability'), [
    { type: 'base64', value: 'YWJjZA==' }
  ])
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
  assert.equal(
    mapImageGenerationHttpError(405, 'method not allowed', 'edit').code,
    'IMAGE_EDIT_UNSUPPORTED'
  )
  assert.equal(
    mapImageGenerationHttpError(400, 'model does not support image editing', 'edit').userMessage,
    'The selected model cannot edit images.'
  )
  assert.equal(mapImageGenerationHttpError(503, 'unavailable').retryable, true)
  assert.equal(
    mapImageGenerationHttpError(400, 'unsupported endpoint').code,
    'IMAGE_ENDPOINT_UNSUPPORTED'
  )
  assert.equal(
    isImageGenerationProtocolIncompatibility(mapImageGenerationHttpError(404, 'route not found')),
    true
  )
  assert.equal(
    isImageGenerationProtocolIncompatibility(mapImageGenerationHttpError(400, 'invalid size')),
    false
  )
})

test('validates opaque image references and deduplicates identical visual payloads', () => {
  const id = '4c6bb34d-8c5d-4cd8-8f79-81b41e7ce217'
  const reference = formatImageAssetReference(id)
  assert.equal(reference, `prism-image://asset/${id}`)
  assert.equal(parseImageAssetReference(reference), id)
  assert.equal(parseImageAssetReference('file:///unsafe/image.png'), null)
  const image = { kind: 'image' as const, mimeType: 'image/png' as const, data: 'YWJjZA==' }
  assert.equal(
    dedupeImageAttachments([
      image,
      { ...image, mimeType: 'image/jpeg' as const, name: 'same-bytes-different-source.jpg' }
    ]).length,
    1
  )
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
  assert.equal(isImageGenerationCompletionType('gemini_native'), true)
  assert.equal(isImageGenerationCompletionType('puter_native'), true)
  assert.equal(
    sanitizeGeneratedImageFilename('../unsafe<>name.png', 'image/png', new Date('2026-08-24')),
    'unsafename.png'
  )
  assert.equal(
    sanitizeGeneratedImageFilename('', 'image/jpeg', new Date('2026-08-24')),
    'prism-generated-image-2026-08-24.jpg'
  )
})

test('defaults image capability state to automatic and preserves operation independence', () => {
  const provider = {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'secret',
    completionType: 'chat_completions' as const,
    isTrusted: true,
    models: []
  }
  const model = {
    id: 'text-looking-model',
    enabled: true,
    isTrusted: false,
    imageGeneration: { adapter: 'openai_images' as const, generate: true, edit: true }
  }
  const capabilities = defaultImageGenerationCapabilities(provider.completionType)
  assert.equal(getImageGenerationCapabilityState(capabilities, 'generate').status, 'unknown')
  assert.equal(
    getImageGenerationCapabilityState(
      { ...capabilities!, edit: { status: 'unsupported' } },
      'generate'
    ).status,
    'unknown'
  )
  assert.equal(
    resolveImageGenerationCandidates({ provider, model, operation: 'generate' })[0],
    'openai_images'
  )
})

test('orders known protocols deterministically and keeps unknown models eligible', () => {
  const provider = {
    id: 'custom',
    name: 'Custom Gateway',
    baseUrl: 'https://gateway.example.test/v1',
    apiKey: 'secret',
    completionType: 'responses' as const,
    isTrusted: false,
    models: []
  }
  const model = { id: 'vision-text-2026', enabled: true, isTrusted: false }
  assert.deepEqual(resolveImageGenerationCandidates({ provider, model, operation: 'generate' }), [
    'openai_responses',
    'openai_images'
  ])
})

test('accepts native Puter sessions without API keys and converts image sizes to ratios', () => {
  const nativePuter = {
    id: 'puter',
    name: 'Puter.js',
    baseUrl: 'https://api.puter.com/puterai/openai/v1',
    apiKey: '',
    puterAuthToken: 'user-pays-session',
    completionType: 'puter_native' as const,
    isTrusted: true,
    models: []
  }
  assert.equal(hasImageGenerationCredentials(nativePuter), true)
  assert.equal(hasImageGenerationCredentials({ ...nativePuter, puterAuthToken: '' }), false)
  assert.deepEqual(imageGenerationSizeToRatio('1536x1024'), { w: 1536, h: 1024 })
  assert.equal(imageGenerationSizeToRatio('wide'), null)
})

test('parses only valid base64 image data URLs returned by native providers', () => {
  assert.deepEqual(parseBase64ImageDataUrl('data:image/png;base64,YWJjZA=='), {
    mimeType: 'image/png',
    base64: 'YWJjZA=='
  })
  assert.equal(parseBase64ImageDataUrl('https://cdn.example.test/image.png'), null)
  assert.equal(parseBase64ImageDataUrl('data:image/png;base64,not base64!'), null)
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
  assert.equal(
    canRetryImageGenerationResult({
      ok: false,
      error: { code: 'INVALID_ARGUMENTS', retryable: true }
    }),
    false
  )
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
  assert.equal(resolveGeneratedImageAspectRatio(1, 1536, 1024, false), 1)
  assert.equal(resolveGeneratedImageAspectRatio(1, 1536, 1024, true), 1.5)
  assert.equal(resolveGeneratedImageAspectRatio(1, 1024, 1536, true), 2 / 3)
})

test('does not resend generated Puter images to models without vision input', () => {
  assert.equal(shouldForwardImageToolAttachments('generate_image'), false)
  assert.equal(shouldForwardImageToolAttachments('computer_use_see_screen'), true)
})
