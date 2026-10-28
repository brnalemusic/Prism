import type { McpServerConfig, McpServerStatus, McpToolInfo } from '../../shared/mcpTypes'
import { broadcastIpc } from '../safeSend'
import { McpHttpClient, McpStdioClient, type McpClientLike } from './client'
import { getServer, loadServers } from './store'
import { buildServerEnv, loadServerSecrets } from './secrets'

interface ManagedServer {
  client: McpClientLike | null
  status: McpServerStatus
}

const managed = new Map<string, ManagedServer>()
const starting = new Map<string, Promise<McpClientLike>>()

function stoppedStatus(id: string, error: string | null = null): McpServerStatus {
  return { id, state: 'stopped', error, tools: [] }
}

function broadcastStatuses(): void {
  broadcastIpc('mcp-status-changed', getStatuses())
}

export function getStatuses(): McpServerStatus[] {
  return loadServers().map((server) => managed.get(server.id)?.status ?? stoppedStatus(server.id))
}

export function getServerStatus(id: string): McpServerStatus {
  return managed.get(id)?.status ?? stoppedStatus(id)
}

export function getCachedTools(serverIds: string[]): McpToolInfo[] {
  return serverIds.flatMap((id) => managed.get(id)?.status.tools ?? [])
}

function createClient(config: McpServerConfig): McpClientLike {
  if (config.transport === 'http') {
    if (!config.url) throw new Error('This HTTP MCP server has no URL.')
    const headers: Record<string, string> = {}
    if (config.authEnvKey) {
      const token = loadServerSecrets(config.id)[config.authEnvKey]?.trim()
      if (!token) {
        throw new Error(
          'This MCP server needs a sign-in. Open Settings → MCP, reconnect it and try again.'
        )
      }
      headers.Authorization = `Bearer ${token}`
    }
    return new McpHttpClient(config.id, config.url, headers)
  }
  if (!config.command) throw new Error('This MCP server has no command.')
  return new McpStdioClient(config.id, config.command, config.args, buildServerEnv(config.id))
}

/** Starts a server if needed and returns a ready client. */
export function ensureServer(serverId: string): Promise<McpClientLike> {
  const config = getServer(serverId)
  if (!config) return Promise.reject(new Error('MCP server not found.'))
  if (!config.enabled) return Promise.reject(new Error('This MCP server is disabled.'))

  const current = managed.get(serverId)
  if (current?.client && current.status.state === 'ready') return Promise.resolve(current.client)

  const inFlight = starting.get(serverId)
  if (inFlight) return inFlight

  const promise = (async (): Promise<McpClientLike> => {
    const client = createClient(config)
    managed.set(serverId, {
      client: null,
      status: { id: serverId, state: 'starting', error: null, tools: [] }
    })
    broadcastStatuses()
    try {
      await client.start()
      const tools = await client.listTools()
      managed.set(serverId, {
        client,
        status: { id: serverId, state: 'ready', error: null, tools }
      })
      broadcastStatuses()
      return client
    } catch (error) {
      client.stop()
      const message = error instanceof Error ? error.message : String(error)
      managed.set(serverId, { client: null, status: stoppedStatus(serverId, message) })
      broadcastStatuses()
      throw new Error(message)
    } finally {
      starting.delete(serverId)
    }
  })()

  starting.set(serverId, promise)
  return promise
}

export async function ensureServers(serverIds: string[]): Promise<void> {
  await Promise.allSettled(serverIds.map((id) => ensureServer(id)))
}

export async function refreshServer(serverId: string): Promise<McpServerStatus> {
  stopServer(serverId)
  try {
    await ensureServer(serverId)
  } catch {
    /* the status already carries the error */
  }
  return getServerStatus(serverId)
}

export function stopServer(serverId: string): void {
  const current = managed.get(serverId)
  if (!current) return
  current.client?.stop()
  managed.set(serverId, { client: null, status: stoppedStatus(serverId) })
  broadcastStatuses()
}

export function stopAll(): void {
  for (const [id, current] of managed) {
    current.client?.stop()
    managed.set(id, { client: null, status: stoppedStatus(id) })
  }
  broadcastStatuses()
}

export async function callTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<string> {
  const client = await ensureServer(serverId)
  return client.callTool(toolName, args, signal)
}

/** Forgets a deleted server so its process does not linger. */
export function forgetServer(serverId: string): void {
  stopServer(serverId)
  managed.delete(serverId)
}
