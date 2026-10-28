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
