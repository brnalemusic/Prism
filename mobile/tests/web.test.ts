import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validatePublicUrl } from '../src/tools/web'

test('public URL validation rejects local and private destinations', () => {
  for (const url of [
    'http://localhost',
    'http://127.0.0.1',
    'http://10.0.0.2',
    'http://192.168.1.4',
    'http://172.16.0.4',
    'file:///etc/passwd'
  ]) {
    assert.throws(() => validatePublicUrl(url))
  }
  assert.equal(validatePublicUrl('https://example.com/page').hostname, 'example.com')
})
