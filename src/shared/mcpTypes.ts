/**
 * Reusable MCP (Model Context Protocol) types.
 *
 * The JSON file keeps the portable `mcpServers` shape used by other clients;
 * Prism-only metadata lives under the sibling `prism` key.
 */

export type McpTransport = 'stdio' | 'http'

export type McpServerState = 'stopped' | 'starting' | 'ready' | 'error'

export interface McpServerConfig {
  id: string
  name: string
  transport: McpTransport
  /** Executable for stdio servers, e.g. `npx`. */
  command: string
  args: string[]
  /** Environment variable names. Values are stored encrypted, never in mcp.json. */
  envKeys: string[]
  /** Endpoint for HTTP servers. */
  url: string
  /** Gallery preset this server came from, when it was installed from the gallery. */
  presetId?: string
  /** Secret key sent as `Authorization: Bearer <value>` for HTTP servers. */
  authEnvKey?: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface McpToolInfo {
  serverId: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpServerStatus {
  id: string
  state: McpServerState
  error: string | null
  tools: McpToolInfo[]
}

export interface McpServerDraft {
  id?: string
  name: string
  transport: McpTransport
  command: string
  args: string[]
  /** Environment values to add or replace. A blank value keeps the stored one. */
  env: Record<string, string>
  /** Keys the user removed in the editor. */
  removedEnvKeys?: string[]
  url: string
  enabled?: boolean
  /** Gallery preset this server came from. Preserved when the draft omits it. */
  presetId?: string
  /** Secret key used as a bearer token. Preserved when the draft omits it. */
  authEnvKey?: string
}

export interface McpInstallPreset {
  id: string
  name: string
  description: string
  transport: McpTransport
  command: string
  args: string[]
  url: string
  /** Environment variables the preset expects, with a human hint. */
  envHints?: Array<{ key: string; hint: string }>
}

/** Pre-configured integrations shown in Settings → MCP and available to Agenda. */
export const MCP_GALLERY_PRESET_IDS = ['github', 'supabase', 'gmail'] as const

export type McpGalleryPresetId = (typeof MCP_GALLERY_PRESET_IDS)[number]

export type McpBrand = McpGalleryPresetId

const MCP_GALLERY_LABELS: Record<McpGalleryPresetId, string> = {
  github: 'GitHub',
  supabase: 'Supabase',
  gmail: 'Gmail'
}

export function normalizeMcpGalleryPresetId(value: unknown): McpGalleryPresetId | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return (MCP_GALLERY_PRESET_IDS as readonly string[]).includes(normalized)
    ? (normalized as McpGalleryPresetId)
    : null
}

export function mcpGalleryLabel(presetId: McpGalleryPresetId): string {
  return MCP_GALLERY_LABELS[presetId]
}

/** One credential collected by the native Prism sign-in dialog. */
export interface McpCredentialField {
  key: string
  label: string
  placeholder?: string
  hint?: string
  /** Masked in the dialog. Values are always stored encrypted. */
  secret?: boolean
  helpUrl?: string
  helpLabel?: string
}

export interface McpGalleryPreset {
  id: McpGalleryPresetId
  name: string
  description: string
  brand: McpBrand
  transport: McpTransport
  command: string
  args: string[]
  url: string
  /** Secret key sent as `Authorization: Bearer <value>` for HTTP servers. */
  authEnvKey?: string
  /** Credentials the sign-in dialog asks for. */
  fields: McpCredentialField[]
}

/** Pending sign-in shown by the global Prism dialog. */
export interface McpLoginRequest {
  requestId: string
  presetId: McpGalleryPresetId
  presetName: string
  description: string
  brand: McpBrand
  fields: McpCredentialField[]
  /** Fields that already have a stored value. A blank input keeps the current value. */
  existingKeys: string[]
  taskId?: string
  taskTitle?: string
  runId?: string
  createdAt: number
  expiresAt: number
}

export interface McpLoginResolution {
  requestId: string
  cancelled?: boolean
  values?: Record<string, string>
}

export interface McpConnectPresetResult {
  ok: boolean
  cancelled?: boolean
  server?: McpServerConfig
  status?: McpServerStatus
  /** Tool names exposed by the server after connecting. */
  tools?: string[]
  error?: string
}

/** Name prefix that keeps MCP tools from colliding with native Prism tools. */
export const MCP_TOOL_PREFIX = 'mcp__'

function shortHash(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }
  return (hash >>> 0).toString(36)
}

export function mcpToolName(serverId: string, toolName: string): string {
  const safeServer = serverId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, '_')
  const base = `${MCP_TOOL_PREFIX}${safeServer}__${safeTool}`
  // OpenAI-compatible function names are limited to 64 characters.
  if (base.length <= 64) return base
  const hash = shortHash(toolName)
  return `${base.slice(0, 64 - hash.length - 1)}_${hash}`
}

export function parseMcpToolName(name: string): { serverId: string; toolName: string } | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null
  const rest = name.slice(MCP_TOOL_PREFIX.length)
  const separator = rest.indexOf('__')
  if (separator <= 0) return null
  return {
    serverId: rest.slice(0, separator),
    toolName: rest.slice(separator + 2)
  }
}
