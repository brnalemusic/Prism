import assert from 'node:assert/strict'
import test from 'node:test'
import { TRUSTED_PROVIDERS, findTrustedProvider, normalizeBaseUrl } from '../src/main/ai/trustedRegistry.ts'

test('trusted provider catalog has unique IDs and canonical endpoint mappings', () => {
  assert.equal(new Set(TRUSTED_PROVIDERS.map((provider) => provider.id)).size, TRUSTED_PROVIDERS.length)
  assert.equal(findTrustedProvider('https://api.openai.com/v1/')?.id, 'openai')
  assert.equal(findTrustedProvider('https://api.puter.com/puterai/openai/v1')?.completionType, 'puter_native')
  assert.equal(normalizeBaseUrl(' https://api.openai.com/v1/ '), 'https://api.openai.com/v1')
})

test('model discovery request uses normalized endpoint semantics', () => {
  const baseUrl = normalizeBaseUrl('https://example.test/v1/')
  assert.equal(`${baseUrl}/models`, 'https://example.test/v1/models')
})
