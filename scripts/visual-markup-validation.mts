import assert from 'node:assert/strict'
import test from 'node:test'
import { getVisualMarkupRange } from '../src/renderer/src/visualMarkup.ts'

test('detects an open visual block and keeps its original offset', () => {
  const content = 'A chart:\n<div class="card"><svg><path d="M0 0" />'
  assert.deepEqual(getVisualMarkupRange(content), {
    start: content.indexOf('<div'),
    end: null
  })
})

test('returns the full range when the outer visual block closes', () => {
  const content = '<section><div>Card</div></section> after'
  assert.deepEqual(getVisualMarkupRange(content), {
    start: 0,
    end: content.indexOf('</section>') + '</section>'.length
  })
})

test('does not detect visual tags inside fenced code and preserves offsets after it', () => {
  const content = '```html\n<div>example</div>\n```\n<svg><path />'
  assert.deepEqual(getVisualMarkupRange(content), {
    start: content.lastIndexOf('<svg'),
    end: null
  })
})

test('ignores an unfinished fenced code block while streaming', () => {
  assert.equal(getVisualMarkupRange('Example:\n```html\n<div>not a live artifact'), null)
})

test('ignores prose with no open visual markup', () => {
  assert.equal(getVisualMarkupRange('A regular answer with **Markdown**.'), null)
})
