import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MOBILE_TOOLS, mobileToolDefinitions, parseToolArguments } from '../src/ai/toolCatalog'

test('Mobile catalog is explicit and provider declarations are mapped', () => {
  assert.deepEqual(
    MOBILE_TOOLS.map((tool) => tool.name),
    ['web_search', 'read_page', 'list_files', 'read_file', 'write_file', 'execute_terminal_command']
  )
  assert.equal((mobileToolDefinitions('openai')[0] as { type: string }).type, 'function')
  assert.ok('functionDeclarations' in (mobileToolDefinitions('gemini')[0] as object))
  assert.ok((mobileToolDefinitions('anthropic')[0] as { input_schema?: object }).input_schema)
})

test('argument validation rejects unknown fields, invalid types and limits', () => {
  assert.deepEqual(
    parseToolArguments({
      id: '1',
      name: 'web_search',
      arguments: '{"query":"cats","resultCount":3}'
    }),
    { query: 'cats', resultCount: 3 }
  )
  assert.throws(
    () =>
      parseToolArguments({
        id: '1',
        name: 'web_search',
        arguments: '{"query":"cats","unexpected":true}'
      }),
    /Unsupported argument/
  )
  assert.throws(
    () =>
      parseToolArguments({
        id: '1',
        name: 'web_search',
        arguments: '{"query":"cats","resultCount":10}'
      }),
    /between 1 and 5/
  )
  assert.throws(
    () => parseToolArguments({ id: '1', name: 'browser_click', arguments: '{}' }),
    /unavailable/
  )
})
