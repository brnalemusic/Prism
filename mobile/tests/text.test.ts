import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deriveTitle,
  formatDuration,
  formatRelativeTime,
  maskApiKey,
  previewText,
  stripMarkdown
} from '../src/lib/text'

test('deriveTitle uses the first meaningful line and strips markdown', () => {
  assert.equal(deriveTitle('\n\n# Fix **the** `build`\nmore'), 'Fix the build')
  assert.equal(deriveTitle('   '), 'New session')
})

test('deriveTitle truncates on a word boundary', () => {
  const title = deriveTitle('Explain how streaming server side events work on a phone', 24)
  assert.ok(title.endsWith('…'))
  assert.ok(title.length <= 25)
  assert.equal(title.includes('  '), false)
})

test('previewText collapses fenced code and links', () => {
  const preview = previewText('Look:\n```ts\nconst a = 1\n```\n[docs](https://example.com)')
  assert.equal(preview.includes('const a'), false)
  assert.ok(preview.includes('docs'))
})

test('stripMarkdown removes emphasis markers', () => {
  assert.equal(stripMarkdown('**bold** and _italic_'), 'bold and italic')
})

test('relative time stays compact', () => {
  const now = 1_700_000_000_000
  assert.equal(formatRelativeTime(now - 10_000, now), 'now')
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5m')
  assert.equal(formatRelativeTime(now - 3 * 3_600_000, now), '3h')
  assert.equal(formatRelativeTime(now - 2 * 86_400_000, now), '2d')
  assert.match(formatRelativeTime(now - 30 * 86_400_000, now), /\d+ \w+/)
})

test('duration and key masking are human sized', () => {
  assert.equal(formatDuration(0), '')
  assert.equal(formatDuration(420), '420 ms')
  assert.equal(formatDuration(1250), '1.3 s')
  assert.equal(maskApiKey('sk-1234567890abcdef'), 'sk-1••••cdef')
  assert.equal(maskApiKey('short'), '••••')
})
