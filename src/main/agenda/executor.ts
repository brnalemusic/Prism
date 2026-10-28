import * as fs from 'fs'
import * as path from 'path'
import type { AgendaRunRecord, AgendaTask } from '../../shared/agendaTypes'
import { describeAgendaCadence } from '../../shared/agendaTypes'
import { cancelChatMessage, handleChatMessage } from '../ai/chatHandler'
import {
  providerHasCompletionCredential,
  resolveExactProviderAndModel
} from '../ai/providerManager'
import { isLiveOnlyModel } from '../ai/trustedRegistry'
import { loadConfig } from '../config'
import { loadChatSession } from '../history'
import { appendRunLog } from './tasks'
import { registerAgendaRun, unregisterAgendaRun } from './runContext'
import { ensureServers } from '../mcp/manager'
import { loadServers } from '../mcp/store'

const MAX_STATE_CHARACTERS = 8_000
const MAX_SUMMARY_CHARACTERS = 1_200

function describeAttachedServers(task: AgendaTask): string {
  if (task.mcpServerIds.length === 0) return 'none'
  const byId = new Map(loadServers().map((server) => [server.id, server.name]))
  return task.mcpServerIds
    .map((id) => `${byId.get(id) ?? id} (${id})`)
    .join(', ')
}

function describeInstalledServers(task: AgendaTask): string {
  const installed = loadServers()
  if (installed.length === 0) return 'none'
  const attached = new Set(task.mcpServerIds)
  return installed
    .slice(0, 25)
    .map(
      (server) =>
        `${server.name} (${server.id})${attached.has(server.id) ? ' — attached' : ''}`
    )
    .join(', ')
}

function readState(task: AgendaTask): string {
  try {
    const raw = fs.readFileSync(path.join(task.folder, '.agenda', 'state.md'), 'utf8').trim()
    if (!raw) return '(empty)'
    return raw.length > MAX_STATE_CHARACTERS
      ? `${raw.slice(0, MAX_STATE_CHARACTERS)}\n\n[truncated]`
      : raw
  } catch {
    return '(empty)'
  }
}

/**
 * Resolves the model pinned to this run. There is deliberately no fallback to
 * the mutable Chat/Harness selection: a task without a model is a configuration
 * error the user must fix, not something to paper over with another provider.
 */
function resolveRunModel(task: AgendaTask, run: AgendaRunRecord): string {
  const modelKey = (run.modelKey ?? task.modelKey ?? '').trim()
  if (!modelKey) {
    throw new Error(
      'This task has no model bound. Edit the task and choose a model before it runs again.'
    )
  }
  if (isLiveOnlyModel(modelKey)) {
    throw new Error(
      'This task is bound to a live-only model that cannot run unattended. Edit the task and choose a text model.'
    )
  }
  const { provider, model } = resolveExactProviderAndModel(modelKey)
  if (!provider || !model || !providerHasCompletionCredential(provider)) {
    throw new Error(
      `The model bound to this task (${modelKey}) is unavailable. Edit the task and choose another model.`
    )
  }
  return modelKey
}

function buildPrompt(task: AgendaTask, run: AgendaRunRecord): string {
  const config = loadConfig()
  const mode = config.agenda.permissionMode
  const now = new Date()
  return [
    '# Prism Agenda — scheduled run',
    '',
    `You are the Agenda executor for a recurring task. This is an unattended run started by the scheduler.`,
    '',
    `- Task: ${task.title}`,
    `- Cadence: ${describeAgendaCadence(task.intervalMinutes)}`,
    `- Task folder: ${task.folder}`,
    `- Run ID: ${run.id}`,
    `- Model: ${run.modelKey ?? task.modelKey ?? 'not bound'}`,
    `- Started at: ${now.toLocaleString()}`,
    `- Permission mode: ${mode === 'yolo' ? 'YOLO (no prompts)' : 'Safe (sensitive actions ask the user)'}`,
    `- MCP servers attached: ${describeAttachedServers(task)}`,
    '',
    '## Instructions',
    '',
    task.instructions.trim() || 'No extra instructions were provided. Do the obvious useful work for the task title.',
    '',
    '## MCP tools',
    '',
    `Installed MCP servers: ${describeInstalledServers(task)}.`,
    'If this task needs a capability that is missing, call `agenda_install_mcp_server` to install an MCP server and attach it to this task. Prefer `agenda_mcp_login` with preset `github`, `supabase` or `gmail` when one of those integrations is enough: Prism opens a native sign-in dialog, so never ask the user to paste credentials in chat. In Safe mode the user must approve the connection; if it is denied, continue without it and report the blocker. Never install a server that the task does not need.',
    '',
    '## Memory from previous runs',
    '',
    'This is the only context carried between runs. Everything else starts fresh.',
    '',
    '```markdown',
    readState(task),
    '```',
    '',
    '## Rules',
    '',
    '1. Work inside the task folder. Use its absolute path for terminal commands and file operations, and create or update files there instead of scattering output elsewhere.',
    '2. At the end of the run, rewrite `.agenda/state.md` with a short, factual summary of what was done, what is pending, and anything the next run needs to know. Keep it under 60 lines.',
    '3. Do not create, edit, pause or delete Agenda tasks. You execute this task only.',
    '4. If the task cannot be completed, explain the blocker instead of guessing.',
    '5. Finish with a concise summary of the outcome for the run transcript.',
    '',
    'Start now.'
  ].join('\n')
}

function lastAssistantText(chatId: string): string | null {
  const session = loadChatSession(chatId)
  const messages = session?.messages ?? []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const text =
      typeof message.content === 'string'
        ? message.content
        : Array.isArray(message.content)
          ? message.content
              .map((part) => (typeof part.text === 'string' ? part.text : ''))
              .join(' ')
          : ''
    if (text.trim()) return text.trim()
  }
  return null
}

/**
 * Runs one Agenda task through the regular Prism chat pipeline with a fresh
 * session per run. The session id is prefixed so chat history can hide it.
 */
export async function runAgendaTask(
  task: AgendaTask,
  run: AgendaRunRecord,
  signal: AbortSignal
): Promise<{ summary?: string; permissionPrompts?: number }> {
  const chatId = `agenda-${run.id}`
  const modelKey = resolveRunModel(task, run)

  // Start the attached MCP servers before the chat pipeline asks for the tool
  // list; the adapter only exposes tools that are already cached.
  if (task.mcpServerIds.length > 0) {
    await ensureServers(task.mcpServerIds)
  }

  registerAgendaRun(chatId, {
    taskId: task.id,
    taskTitle: task.title,
    runId: run.id,
    mcpServerIds: task.mcpServerIds
  })

  const onAbort = (): void => {
    cancelChatMessage(chatId)
  }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })

  let permissionPrompts = 0
  try {
    await handleChatMessage(
      null,
      {
        message: buildPrompt(task, run),
        chatId,
        sessionMode: 'execution',
        modelKey
      },
      'chat'
    )
  } finally {
    signal.removeEventListener('abort', onAbort)
    permissionPrompts = unregisterAgendaRun(chatId)
  }

  if (signal.aborted) {
    appendRunLog(task, `run ${run.id} cancelled`)
    throw new Error('Run cancelled.')
  }

  const summary = lastAssistantText(chatId)
  if (!summary) {
    throw new Error(
      'The run produced no response. Check the selected model, the provider API key and the run transcript.'
    )
  }

  return {
    summary:
      summary.length > MAX_SUMMARY_CHARACTERS
        ? `${summary.slice(0, MAX_SUMMARY_CHARACTERS)}…`
        : summary,
    permissionPrompts
  }
}
