import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getMcpGalleryPreset, getMcpGalleryPresets } from '../src/main/mcp/presets.ts'

test('gallery uses official hosted account OAuth MCP endpoints', () => {
  const presets = getMcpGalleryPresets()
  assert.deepEqual(presets.map((preset) => preset.id), ['github', 'supabase', 'gmail'])
  assert.equal(getMcpGalleryPreset('github')?.url, 'https://api.githubcopilot.com/mcp/')
  assert.equal(getMcpGalleryPreset('supabase')?.url, 'https://mcp.supabase.com/mcp')
  assert.equal(getMcpGalleryPreset('gmail')?.url, 'https://gmailmcp.googleapis.com/mcp/v1')
  assert.ok(presets.every((preset) => preset.transport === 'http'))
  assert.ok(presets.every((preset) => preset.auth === 'oauth' || preset.auth === 'google-oauth-client'))
})

test('gallery metadata is isolated between calls', () => {
  const first = getMcpGalleryPreset('github')
  assert.ok(first)
  first.permissions.push('unexpected')
  assert.equal(getMcpGalleryPreset('github')?.permissions.includes('unexpected'), false)
})
