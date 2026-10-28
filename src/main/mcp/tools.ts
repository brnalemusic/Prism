import type { OpenAiToolDefinition } from '../ai/types'
import {
  mcpToolName,
  parseMcpToolName,
  type McpToolInfo
} from '../../shared/mcpTypes'
import { callTool, ensureServer, getCachedTools } from './manager'

/**
 * Tools exposed to the model. Only servers already started and cached appear
 * here, so this stays synchronous inside the chat pipeline.
 */
export function getMcpToolDefinitions(serverIds: string[]): OpenAiToolDefinition[] {
  return getCachedTools(serverIds).map((tool: McpToolInfo) => ({
    type: 'function',
    function: {
      name: mcpToolName(tool.serverId, tool.name),
      description:
        tool.description ||
        `${tool.name} from the MCP server "${tool.serverId}".`,
      parameters: tool.inputSchema
    }
  }))
}

function resolveOriginalToolName(fullName: string, serverId: string): string | null {
  const parsed = parseMcpToolName(fullName)
  if (!parsed) return null
  const match = getCachedTools([serverId]).find(
    (tool) => mcpToolName(tool.serverId, tool.name) === fullName
  )
  return match?.name ?? null
}

/**
 * Executes an MCP tool by its Prism-qualified name. The original tool name is
 * recovered from the cached tool list, so sanitized names still map correctly.
 */
export async function executeMcpToolCall(
  fullName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<string> {
  const parsed = parseMcpToolName(fullName)
  if (!parsed) throw new Error('Unknown MCP tool.')

  await ensureServer(parsed.serverId)
  const toolName = resolveOriginalToolName(fullName, parsed.serverId)
  if (!toolName) {
    throw new Error(`The MCP server "${parsed.serverId}" does not expose this tool anymore.`)
  }
  return callTool(parsed.serverId, toolName, args, signal)
}
