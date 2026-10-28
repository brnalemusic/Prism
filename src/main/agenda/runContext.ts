import { executeValidatedTool } from '../toolRuntime'
import type {
  ToolExecutionContext,
  ToolLoopGuard,
  ValidatedToolExecution
} from '../toolRuntime'
import { getPermissionMode, requestPermission } from '../permissions/broker'
import { MCP_TOOL_PREFIX, parseMcpToolName } from '../../shared/mcpTypes'
import type { McpServerConfig, McpTransport } from '../../shared/mcpTypes'
import { executeMcpToolCall, getMcpToolDefinitions } from '../mcp/tools'
import { refreshServer } from '../mcp/manager'
import { loadServerSecrets, saveServerSecrets } from '../mcp/secrets'
import { getServer, saveServer } from '../mcp/store'
import { broadcastIpc } from '../safeSend'
import { getTask, updateTask } from './tasks'
import type { OpenAiToolDefinition } from '../ai/types'

/**
 * Tools that reach the real machine through a shell. In Safe mode each call is
 * gated by the permission broker; in YOLO the broker allows it immediately.
 */
const TERMINAL_TOOLS = new Set(['execute_terminal_command', 'send_terminal_input'])

/** Native tool that lets an Agenda run install its own MCP servers. */
export const AGENDA_INSTALL_MCP_TOOL = 'agenda_install_mcp_server'

const AGENDA_INSTALL_MCP_DEFINITION: OpenAiToolDefinition = {
  type: 'function',
  function: {
    name: AGENDA_INSTALL_MCP_TOOL,
    description:
      'Install or update an MCP server and attach it to the current Agenda task. Use this when the task needs tools that are not available yet. In Safe mode Prism asks the user before installing; if denied, continue without it and report the blocker. The server starts immediately, so its tools are available on the next round.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable server name.' },
        id: {
          type: 'string',
          description: 'Id of an existing server to update. Omit to install a new server.'
        },
        transport: {
          type: 'string',
          enum: ['stdio', 'http'],
          description:
            'stdio runs a local command (npx, uvx, node). http connects to a Streamable HTTP endpoint. Defaults to stdio.'
        },
        command: {
          type: 'string',
          description: 'Executable for stdio servers, for example npx.'
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command arguments, one entry per argument.'
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Environment variables the server needs, such as API keys. Values are stored encrypted.'
        },
        url: {
          type: 'string',
          description: 'Streamable HTTP endpoint for http servers.'
        },
        attachToTask: {
          type: 'boolean',
          description:
            'Attach the server to this task so future runs can use it. Defaults to true.'
        }
      },
      required: ['name']
    }
  }
}

interface AgendaRunContext {
  taskId: string
  taskTitle: string
  runId: string
  mcpServerIds: string[]
  prompts: number
}

/**
 * Agenda runs reuse the regular chat pipeline but must be identifiable from the
 * tool runtime. Keeping this registry in its own module avoids an import cycle
 * between the chat handler and the Agenda executor.
 */
const activeAgendaRuns = new Map<string, AgendaRunContext>()

export function registerAgendaRun(
  chatId: string,
  context: Omit<AgendaRunContext, 'prompts'>
): void {
  activeAgendaRuns.set(chatId, { ...context, prompts: 0 })
}

/** Removes the run and returns how many permission prompts it produced. */
export function unregisterAgendaRun(chatId: string): number {
  const context = activeAgendaRuns.get(chatId)
  activeAgendaRuns.delete(chatId)
  return context?.prompts ?? 0
}

export function isAgendaRun(chatId?: string): boolean {
  return Boolean(chatId && activeAgendaRuns.has(chatId))
}

/** MCP servers attached to the task currently running in this chat. */
export function getAgendaRunMcpServerIds(chatId?: string): string[] {
  if (!chatId) return []
  return activeAgendaRuns.get(chatId)?.mcpServerIds ?? []
}

/** MCP tools available to an Agenda run, resolved from the manager cache. */
export function getAgendaMcpToolDefinitions(chatId?: string): OpenAiToolDefinition[] {
  const serverIds = getAgendaRunMcpServerIds(chatId)
  if (serverIds.length === 0) return []
  return getMcpToolDefinitions(serverIds)
}

/**
 * Native tools that exist only inside Agenda runs. They are appended to the
 * regular tool list so a scheduled task can extend its own capabilities.
 */
export function getAgendaSystemToolDefinitions(chatId?: string): OpenAiToolDefinition[] {
  if (!isAgendaRun(chatId)) return []
  return [AGENDA_INSTALL_MCP_DEFINITION]
}

/** Makes a freshly installed server available to the rest of the current run. */
export function addAgendaRunMcpServer(chatId: string, serverId: string): void {
  const agenda = activeAgendaRuns.get(chatId)
  if (!agenda || agenda.mcpServerIds.includes(serverId)) return
  agenda.mcpServerIds = [...agenda.mcpServerIds, serverId]
}

function failedExecution(message: string): ValidatedToolExecution {
  const envelope = {
    ok: false as const,
    error: { code: 'INVALID_ARGUMENTS' as const, message, retryable: false }
  }
  return { args: {}, envelope, modelContent: JSON.stringify(envelope) }
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => String(entry)).filter((entry) => entry.length > 0)
}

function readEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const env: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const name = key.trim()
    if (!name || typeof raw !== 'string') continue
    env[name] = raw
  }
  return env
}

async function installMcpServerForRun(
  chatId: string,
  args: unknown,
  signal?: AbortSignal
): Promise<ValidatedToolExecution> {
  const agenda = activeAgendaRuns.get(chatId)
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  const name = readText(record.name)
  const id = readText(record.id)
  const transport: McpTransport = record.transport === 'http' ? 'http' : 'stdio'
  const command = readText(record.command)
  const url = readText(record.url)
  const commandArgs = readStringArray(record.args)
  const env = readEnv(record.env)

  if (!name) return failedExecution('The MCP server needs a name.')
  if (transport === 'stdio' && !command) {
    return failedExecution('A stdio MCP server needs a command, for example npx.')
  }
  if (transport === 'http' && !url) {
    return failedExecution('An HTTP MCP server needs a URL.')
  }
  if (id && !getServer(id)) {
    return failedExecution(`There is no MCP server with the id "${id}".`)
  }

  const target = transport === 'http' ? url : [command, ...commandArgs].join(' ')
  if (agenda && getPermissionMode() === 'safe') agenda.prompts += 1
  const outcome = await requestPermission(
    {
      kind: 'mcp_install',
      title: id ? 'Update an MCP server' : 'Install an MCP server',
      summary: `${name} — ${target}`,
      detail:
        transport === 'http'
          ? `HTTP endpoint: ${target}`
          : `Command: ${target}${
              Object.keys(env).length > 0 ? `\nEnvironment: ${Object.keys(env).join(', ')}` : ''
            }`,
      taskId: agenda?.taskId,
      taskTitle: agenda?.taskTitle,
      runId: agenda?.runId
    },
    signal
  )
  if (outcome !== 'allowed') {
    return deniedExecution(
      outcome === 'timeout'
        ? 'The MCP install request timed out and was denied.'
        : 'The user denied installing this MCP server. Continue without it and report what was skipped.'
    )
  }

  // Updating a server keeps secrets the agent did not repeat.
  const mergedEnv: Record<string, string> = id ? { ...loadServerSecrets(id), ...env } : env
  const server: McpServerConfig = saveServer({
    id: id || undefined,
    name,
    transport,
    command,
    args: commandArgs,
    env: mergedEnv,
    url,
    enabled: true
  })
  try {
    saveServerSecrets(server.id, mergedEnv)
  } catch (error) {
    return failedExecution(error instanceof Error ? error.message : String(error))
  }

  const attachToTask = record.attachToTask !== false
  if (attachToTask && agenda) {
    const task = getTask(agenda.taskId)
    if (task && !task.mcpServerIds.includes(server.id)) {
      updateTask(task.id, { mcpServerIds: [...task.mcpServerIds, server.id] })
      broadcastIpc('agenda-tasks-changed')
    }
    addAgendaRunMcpServer(chatId, server.id)
  }

  broadcastIpc('mcp-servers-changed')
  // Restart an updated server so the new command, URL and secrets take effect
  // before the next tool round.
  const status = await refreshServer(server.id)
  const startError = status.state === 'error' ? status.error : null
  const result = {
    ok: startError === null,
    serverId: server.id,
    name: server.name,
    attachedToTask: attachToTask,
    state: status.state,
    tools: status.tools.map((tool) => tool.name),
    error: startError
  }
  return {
    args: record,
    envelope:
      startError === null
        ? { ok: true, output: JSON.stringify(result) }
        : {
            ok: false,
            error: { code: 'EXECUTION_FAILED' as const, message: startError, retryable: false }
          },
    modelContent: JSON.stringify(result)
  }
}

function deniedExecution(message: string): ValidatedToolExecution {
  const envelope = {
    ok: false as const,
    error: {
      code: 'CANCELLED' as const,
      message,
      retryable: false
    }
  }
  return { args: {}, envelope, modelContent: JSON.stringify(envelope) }
}

function describeCommand(name: string, args: unknown): string {
  if (args && typeof args === 'object') {
    const record = args as Record<string, unknown>
    if (typeof record.command === 'string' && record.command.trim()) return record.command.trim()
    if (typeof record.input === 'string' && record.input.trim()) return record.input.trim()
  }
  return name
}

/**
 * Tool executor used only by Agenda runs. Everything is delegated to the normal
 * tool runtime except terminal access, which waits for the Safe-mode decision.
 */
export function createAgendaToolExecutor(
  chatId: string
): (
  name: string,
  args: unknown,
  context: ToolExecutionContext,
  loopGuard: ToolLoopGuard
) => Promise<ValidatedToolExecution> {
  return async (name, args, context, loopGuard) => {
    if (name === AGENDA_INSTALL_MCP_TOOL) {
      return installMcpServerForRun(chatId, args, context.signal)
    }

    if (name.startsWith(MCP_TOOL_PREFIX)) {
      const agenda = activeAgendaRuns.get(chatId)
      const parsed = parseMcpToolName(name)
      if (agenda && getPermissionMode() === 'safe') agenda.prompts += 1
      const outcome = await requestPermission(
        {
          kind: 'mcp_tool',
          title: 'Use an MCP tool',
          summary: `${parsed?.serverId ?? 'MCP'} · ${parsed?.toolName ?? name}`,
          detail: JSON.stringify(args ?? {}, null, 2),
          taskId: agenda?.taskId,
          taskTitle: agenda?.taskTitle,
          runId: agenda?.runId
        },
        context.signal
      )
      if (outcome !== 'allowed') {
        return deniedExecution(
          outcome === 'timeout'
            ? 'The MCP tool request timed out and was denied.'
            : 'The user denied this MCP tool call. Continue without it and report what was skipped.'
        )
      }

      try {
        const output = await executeMcpToolCall(
          name,
          (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
          context.signal
        )
        return {
          args: (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
          envelope: { ok: true, output },
          modelContent: JSON.stringify({ ok: true, output })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return deniedExecution(`MCP tool failed: ${message}`)
      }
    }

    if (TERMINAL_TOOLS.has(name)) {
      const agenda = activeAgendaRuns.get(chatId)
      if (agenda && getPermissionMode() === 'safe') agenda.prompts += 1
      const outcome = await requestPermission(
        {
          kind: 'terminal',
          title: 'Run a terminal command',
          summary: describeCommand(name, args),
          detail: JSON.stringify(args ?? {}, null, 2),
          taskId: agenda?.taskId,
          taskTitle: agenda?.taskTitle,
          runId: agenda?.runId
        },
        context.signal
      )
      if (outcome !== 'allowed') {
        return deniedExecution(
          outcome === 'timeout'
            ? 'The terminal request timed out and was denied. Ask the user before retrying.'
            : 'The user denied this terminal command. Continue without it and report what was skipped.'
        )
      }
    }

    return executeValidatedTool(name, args, context, loopGuard)
  }
}
