import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { CONFIG_DIR } from '../config'
import type { McpServerConfig, McpServerDraft, McpTransport } from '../../shared/mcpTypes'

interface PortableServerEntry {
  command?: string
  args?: string[]
  url?: string
  type?: string
}

interface PrismServerMeta {
  name?: string
  transport?: McpTransport
  envKeys?: string[]
  enabled?: boolean
  createdAt?: number
  updatedAt?: number
}

interface McpFileShape {
  mcpServers?: Record<string, PortableServerEntry>
  prism?: {
    servers?: Record<string, PrismServerMeta>
  }
}

function mcpFile(): string {
  return path.join(CONFIG_DIR, 'mcp.json')
}

function readFile(): McpFileShape {
  try {
    if (!fs.existsSync(mcpFile())) return {}
    const raw = fs.readFileSync(mcpFile(), 'utf8').trim()
    if (!raw) return {}
    const parsed = JSON.parse(raw) as McpFileShape
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    console.warn('[mcp] could not read mcp.json:', error)
    return {}
  }
}

function writeFile(value: McpFileShape): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  const target = mcpFile()
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, target)
}

function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'server'
  )
}

export function loadServers(): McpServerConfig[] {
  const file = readFile()
  const entries = file.mcpServers ?? {}
  const meta = file.prism?.servers ?? {}
  return Object.entries(entries).map(([id, entry]) => {
    const info = meta[id] ?? {}
    const transport: McpTransport =
      info.transport === 'http' || (!entry.command && entry.url) ? 'http' : 'stdio'
    return {
      id,
      name: info.name?.trim() || id,
      transport,
      command: entry.command?.trim() || '',
      args: Array.isArray(entry.args) ? entry.args.map(String) : [],
      envKeys: Array.isArray(info.envKeys) ? info.envKeys.map(String) : [],
      url: entry.url?.trim() || '',
      enabled: info.enabled !== false,
      createdAt: info.createdAt ?? 0,
      updatedAt: info.updatedAt ?? 0
    }
  })
}

export function getServer(id: string): McpServerConfig | null {
  return loadServers().find((server) => server.id === id) ?? null
}

export function saveServer(draft: McpServerDraft): McpServerConfig {
  const file = readFile()
  file.mcpServers = file.mcpServers ?? {}
  file.prism = file.prism ?? {}
  file.prism.servers = file.prism.servers ?? {}

  const now = Date.now()
  const id = draft.id?.trim() || `${slugify(draft.name)}-${randomUUID().slice(0, 6)}`
  const previous = file.prism.servers[id] ?? {}
  const transport: McpTransport = draft.transport === 'http' ? 'http' : 'stdio'
  const args = Array.isArray(draft.args) ? draft.args.map(String) : []
  const command = typeof draft.command === 'string' ? draft.command.trim() : ''
  const url = typeof draft.url === 'string' ? draft.url.trim() : ''
  const envKeys = Object.keys(draft.env ?? {}).filter((key) => key.trim())

  file.mcpServers[id] =
    transport === 'http'
      ? { type: 'http', url }
      : { command, args }

  file.prism.servers[id] = {
    name: draft.name.trim() || id,
    transport,
    envKeys,
    enabled: draft.enabled ?? previous.enabled ?? true,
    createdAt: previous.createdAt ?? now,
    updatedAt: now
  }

  writeFile(file)

  return {
    id,
    name: file.prism.servers[id].name ?? id,
    transport,
    command: transport === 'stdio' ? command : '',
    args: transport === 'stdio' ? args : [],
    envKeys,
    url: transport === 'http' ? url : '',
    enabled: file.prism.servers[id].enabled !== false,
    createdAt: file.prism.servers[id].createdAt ?? now,
    updatedAt: now
  }
}

export function deleteServer(id: string): boolean {
  const file = readFile()
  if (!file.mcpServers?.[id]) return false
  delete file.mcpServers[id]
  if (file.prism?.servers) delete file.prism.servers[id]
  writeFile(file)
  return true
}

export function setServerEnabled(id: string, enabled: boolean): McpServerConfig | null {
  const file = readFile()
  if (!file.mcpServers?.[id]) return null
  file.prism = file.prism ?? {}
  file.prism.servers = file.prism.servers ?? {}
  file.prism.servers[id] = {
    ...file.prism.servers[id],
    enabled,
    updatedAt: Date.now()
  }
  writeFile(file)
  return getServer(id)
}
