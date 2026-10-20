import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SseDecoder,
  extractAnthropicDelta,
  extractGeminiDelta,
  extractOpenAiDelta,
  extractStreamDelta
} from '../src/ai/sse'

test('decoder waits for complete events across chunk boundaries', () => {
  const decoder = new SseDecoder()
  assert.deepEqual(decoder.push('data: {"a":'), [])
  assert.deepEqual(decoder.push('1}\n\n'), [{ event: null, data: '{"a":1}' }])
})

test('decoder supports CRLF, comments and multi-line data', () => {
  const decoder = new SseDecoder()
  const events = decoder.push(': keep-alive\r\nevent: delta\r\ndata: first\r\ndata: second\r\n\r\n')
  assert.deepEqual(events, [{ event: 'delta', data: 'first\nsecond' }])
})

test('flush emits an unterminated trailing event', () => {
  const decoder = new SseDecoder()
  assert.deepEqual(decoder.push('data: tail'), [])
  assert.deepEqual(decoder.flush(), [{ event: null, data: 'tail' }])
})

test('decoder ignores a UTF-8 BOM and empty chunks', () => {
  const decoder = new SseDecoder()
  assert.deepEqual(decoder.push(''), [])
  assert.deepEqual(decoder.push('\uFEFFdata: ok\n\n'), [{ event: null, data: 'ok' }])
})

test('OpenAI deltas concatenate content parts', () => {
  assert.equal(
    extractOpenAiDelta({ choices: [{ delta: { content: 'Hel' } }, { delta: { content: 'lo' } }] }),
    'Hello'
  )
  assert.equal(
    extractOpenAiDelta({ choices: [{ delta: { content: [{ text: 'A' }, { text: 'B' }] } }] }),
    'AB'
  )
  assert.equal(extractOpenAiDelta({}), '')
})

test('Gemini deltas skip thought parts and tolerate missing candidates', () => {
  assert.equal(
    extractGeminiDelta({
      candidates: [
        {
          content: { parts: [{ text: 'Vis' }, { text: 'ible' }, { text: 'hidden', thought: true }] }
        }
      ]
    }),
    'Visible'
  )
  assert.equal(extractGeminiDelta({}), '')
})

test('Anthropic deltas only read text_delta events', () => {
  assert.equal(
    extractAnthropicDelta({
      event: 'content_block_delta',
      data: JSON.stringify({ delta: { type: 'text_delta', text: 'hi' } })
    }),
    'hi'
  )
  assert.equal(
    extractAnthropicDelta({
      event: 'content_block_delta',
      data: JSON.stringify({ delta: { type: 'input_json_delta', partial_json: '{' } })
    }),
    ''
  )
  assert.equal(extractAnthropicDelta({ event: 'message_start', data: '{}' }), '')
})

test('stream delta maps protocol events to text, done and errors', () => {
  assert.deepEqual(extractStreamDelta('openai', { event: null, data: '[DONE]' }), {
    delta: '',
    done: true
  })
  assert.deepEqual(
    extractStreamDelta('openai', {
      event: null,
      data: JSON.stringify({ choices: [{ delta: { content: 'x' } }] })
    }),
    { delta: 'x' }
  )
  assert.deepEqual(
    extractStreamDelta('gemini', {
      event: null,
      data: JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })
    }),
    { delta: '', error: 'Request blocked by Gemini (SAFETY).' }
  )
  assert.deepEqual(
    extractStreamDelta('anthropic', {
      event: 'error',
      data: JSON.stringify({ type: 'error', error: { message: 'overloaded' } })
    }),
    { delta: '', error: 'overloaded' }
  )
  assert.deepEqual(extractStreamDelta('anthropic', { event: 'message_stop', data: '{}' }), {
    delta: '',
    done: true
  })
  assert.deepEqual(extractStreamDelta('openai', { event: null, data: 'not json' }), { delta: '' })
})
