import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatModelList,
  parseModelList,
  providerNeedsKey,
  validateProviderDraft
} from '../src/ai/validation'

const draft = {
  name: 'Work key',
  protocol: 'openai' as const,
  baseUrl: 'https://api.openai.com/v1',
  models: [{ id: 'gpt-4o', label: 'gpt-4o' }],
  apiKey: 'sk-test'
}

test('a complete draft has no errors', () => {
  assert.deepEqual(validateProviderDraft(draft, { hasStoredKey: false }), {})
})

test('missing name, url and models are reported together', () => {
  const errors = validateProviderDraft(
    { name: ' ', protocol: 'openai', baseUrl: '', models: [], apiKey: '' },
    { hasStoredKey: false }
  )
  assert.ok(errors.name)
  assert.ok(errors.baseUrl)
  assert.ok(errors.models)
})

test('a key is required once the base URL is valid', () => {
  const errors = validateProviderDraft({ ...draft, apiKey: '' }, { hasStoredKey: false })
  assert.match(errors.apiKey ?? '', /API key/)
})

test('stored keys can be kept without re-entering them', () => {
  const errors = validateProviderDraft({ ...draft, apiKey: undefined }, { hasStoredKey: true })
  assert.equal(errors.apiKey, undefined)
})

test('loopback endpoints do not require a key', () => {
  assert.equal(providerNeedsKey('openai', 'http://localhost:11434/v1'), false)
  assert.equal(providerNeedsKey('openai', 'http://192.168.1.10:8080/v1'), true)
  assert.equal(providerNeedsKey('gemini', 'https://generativelanguage.googleapis.com/v1beta'), true)
  assert.equal(
    validateProviderDraft(
      {
        ...draft,
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        models: [{ id: 'llama3', label: 'llama3' }]
      },
      { hasStoredKey: false }
    ).apiKey,
    undefined
  )
})

test('model ids parse from newlines and commas without duplicates', () => {
  const models = parseModelList('a, b\n c\n\nb ')
  assert.deepEqual(
    models.map((model) => model.id),
    ['a', 'b', 'c']
  )
  assert.equal(formatModelList(models), 'a\nb\nc')
})
