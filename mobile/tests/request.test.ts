import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProviderProfile } from '../src/domain/types'
import { AiRequestError, buildChatRequest } from '../src/ai/request'
import { trimTurns } from '../src/ai/persona'

const provider = (
  overrides: Partial<ProviderProfile> & Pick<ProviderProfile, 'protocol' | 'baseUrl'>
): ProviderProfile => ({
  id: 'prov_1',
  name: 'Test provider',
  models: [{ id: 'model-a', label: 'Model A' }],
  createdAt: 0,
  ...overrides
})

const turns = [
  { role: 'user' as const, content: 'Hello' },
  { role: 'assistant' as const, content: 'Hi there' },
  { role: 'user' as const, content: 'Explain SSE' }
]

test('Gemini request uses SSE streamGenerateContent and the key header', () => {
  const request = buildChatRequest({
    provider: provider({
      protocol: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/'
    }),
    modelId: 'gemini-3.6-flash',
    apiKey: 'secret',
    turns,
    systemPrompt: 'system'
  })

  assert.equal(
    request.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse'
  )
  assert.equal(request.headers['x-goog-api-key'], 'secret')
  assert.equal(request.url.includes('secret'), false)

  const body = JSON.parse(request.body)
  assert.deepEqual(body.systemInstruction, { parts: [{ text: 'system' }] })
  assert.deepEqual(body.contents[1], { role: 'model', parts: [{ text: 'Hi there' }] })
  assert.equal(body.contents.length, 3)
})

test('OpenAI-compatible request streams chat completions with bearer auth', () => {
  const request = buildChatRequest({
    provider: provider({ protocol: 'openai', baseUrl: 'https://api.openai.com/v1' }),
    modelId: 'gpt-4o',
    apiKey: 'sk-test',
    turns,
    systemPrompt: 'system'
  })

  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(request.headers.Authorization, 'Bearer sk-test')
  const body = JSON.parse(request.body)
  assert.equal(body.model, 'gpt-4o')
  assert.equal(body.stream, true)
  assert.deepEqual(body.messages[0], { role: 'system', content: 'system' })
  assert.equal(body.messages.length, 4)
})

test('OpenAI endpoint that already ends in chat/completions is respected', () => {
  const request = buildChatRequest({
    provider: provider({
      protocol: 'openai',
      baseUrl: 'https://gateway.example.com/v1/chat/completions'
    }),
    modelId: 'x',
    apiKey: 'k',
    turns,
    systemPrompt: 's'
  })
  assert.equal(request.url, 'https://gateway.example.com/v1/chat/completions')
})

test('Anthropic request normalises the /v1 path and sends version header', () => {
  const withV1 = buildChatRequest({
    provider: provider({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' }),
    modelId: 'claude-sonnet-5',
    apiKey: 'sk-ant',
    turns,
    systemPrompt: 'system'
  })
  assert.equal(withV1.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(withV1.headers['anthropic-version'], '2023-06-01')
  assert.equal(withV1.headers['x-api-key'], 'sk-ant')
  const body = JSON.parse(withV1.body)
  assert.equal(body.system, 'system')
  assert.equal(body.stream, true)
  assert.equal(body.messages.length, 3)

  const bareHost = buildChatRequest({
    provider: provider({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' }),
    modelId: 'claude-sonnet-5',
    apiKey: 'sk-ant',
    turns,
    systemPrompt: 'system'
  })
  assert.equal(bareHost.url, 'https://api.anthropic.com/v1/messages')
})

test('remote providers require an API key, loopback endpoints do not', () => {
  assert.throws(
    () =>
      buildChatRequest({
        provider: provider({ protocol: 'openai', baseUrl: 'https://api.example.com/v1' }),
        modelId: 'm',
        apiKey: '',
        turns,
        systemPrompt: 's'
      }),
    (error: unknown) => error instanceof AiRequestError
  )

  const local = buildChatRequest({
    provider: provider({ protocol: 'openai', baseUrl: 'http://localhost:11434/v1' }),
    modelId: 'llama3',
    apiKey: '',
    turns,
    systemPrompt: 's'
  })
  assert.equal(local.headers.Authorization, undefined)
})

test('invalid base URLs and empty conversations are rejected', () => {
  assert.throws(
    () =>
      buildChatRequest({
        provider: provider({ protocol: 'openai', baseUrl: 'api.example.com' }),
        modelId: 'm',
        apiKey: 'k',
        turns,
        systemPrompt: 's'
      }),
    /must start with http/
  )

  assert.throws(
    () =>
      buildChatRequest({
        provider: provider({ protocol: 'openai', baseUrl: 'https://api.example.com' }),
        modelId: 'm',
        apiKey: 'k',
        turns: [],
        systemPrompt: 's'
      }),
    /nothing to send/
  )
})

test('trimTurns keeps only the newest turns', () => {
  const many = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: String(index)
  }))
  const trimmed = trimTurns(many, 4)
  assert.deepEqual(
    trimmed.map((turn) => turn.content),
    ['26', '27', '28', '29']
  )
  assert.equal(trimTurns(many, 100), many)
})
