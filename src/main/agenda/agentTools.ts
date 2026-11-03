import type { OpenAiToolDefinition } from '../ai/types'
import type { ValidatedToolExecution } from '../toolRuntime'
import type { AgendaAnchor, AgendaTask, AgendaTaskStatus } from '../../shared/agendaTypes'
import {
  AGENDA_MAX_INTERVAL_MINUTES,
  AGENDA_MIN_INTERVAL_MINUTES,
  describeAgendaAnchor,
  describeAgendaCadence,
  isAgendaScheduleId,
  normalizeAgendaScheduleId
} from '../../shared/agendaTypes'
import { getPermissionMode, requestPermission } from '../permissions/broker'
import { broadcastIpc } from '../safeSend'
import { deleteChatSession } from '../history'
import { loadServers } from '../mcp/store'
import {
  countTasksForAgent,
  createTask,
  deleteTask,
  loadTasks,
  updateTask
} from './tasks'
import {
  cancelTaskRun,
  deleteRunsForTask,
  dropQueuedRuns,
  runTaskNow
} from './scheduler'
import { listRuns, runChatId } from './runs'
import { getAgent } from './agents'
import { normalizeIntervalMinutes } from './cadence'

export const AGENDA_AGENT_TOOL_NAMES = [
  'agenda_list_schedules',
  'agenda_search_schedules',
  'agenda_create_schedule',
  'agenda_update_schedule',
  'agenda_run_schedule',
  'agenda_delete_schedule'
] as const

const ANCHOR_SCHEMA = {
  type: 'object',
  description:
    'Optional clock anchor. Use for wall-clock schedules such as "every day at 08:00".',
  properties: {
    kind: { type: 'string', enum: ['time'] },
    hour: { type: 'integer', description: '0-23' },
    minute: { type: 'integer', description: '0-59' },
    weekday: {
      type: 'integer',
      description: '0 = Sunday … 6 = Saturday. Only for whole-week intervals.'
    },
    dayOfMonth: { type: 'integer', description: '1-31. Only for the monthly interval (43200).' }
  },
  required: ['kind', 'hour', 'minute']
}

const STATUS_ENUM = ['draft', 'active', 'paused', 'completed', 'cancelled']

const DEFINITIONS: OpenAiToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'agenda_list_schedules',
      description:
        'List the schedules owned by this Agenda agent. Use it before creating or editing when the user refers to existing work.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: STATUS_ENUM, description: 'Optional status filter.' },
          limit: { type: 'integer', description: 'Maximum results (1-50, default 20).' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'agenda_search_schedules',
      description:
        'Find schedules. Pass an exact 12-digit id to look it up globally; otherwise search by text. Never invent an id.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact 12-digit schedule id.' },
          query: { type: 'string', description: 'Text to match in title, prompt or instructions.' },
          status: { type: 'string', enum: STATUS_ENUM, description: 'Optional status filter.' },
          allAgents: {
            type: 'boolean',
            description: 'Search every Agenda agent instead of only this one.'
          },
          limit: { type: 'integer', description: 'Maximum results (1-50, default 20).' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'agenda_create_schedule',
      description:
        'Create a schedule owned by this agent. A title, a prompt and self-contained execution instructions are required. Choose draft when the plan still needs approval; otherwise create it active.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Mandatory short schedule name, under 60 characters.'
          },
          prompt: {
            type: 'string',
            description: 'The user request that produced this schedule, in their own terms.'
          },
          instructions: {
            type: 'string',
            description:
              'Self-contained execution brief for every run: goal, steps, folder policy, what to avoid, what to write in .agenda/state.md.'
          },
          status: {
            type: 'string',
            enum: ['active', 'draft'],
            description: 'Production-ready (active) or a draft for review. Defaults to active.'
          },
          intervalMinutes: {
            type: ['integer', 'null'],
            description: `Cadence in minutes (${AGENDA_MIN_INTERVAL_MINUTES}-${AGENDA_MAX_INTERVAL_MINUTES}), or null for a one-shot schedule.`
          },
          anchor: ANCHOR_SCHEMA,
          mcpServerIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Installed MCP server ids the run needs.'
          },
          modelKey: {
            type: 'string',
            description: 'Optional model override for runs. Omit to use the Agenda model.'
          }
        },
        required: ['title', 'prompt', 'instructions', 'intervalMinutes']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'agenda_update_schedule',
      description:
        'Edit an existing schedule by its exact 12-digit id. Only include the fields that change.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact 12-digit schedule id.' },
          title: { type: 'string' },
          prompt: { type: 'string' },
          instructions: { type: 'string' },
          status: { type: 'string', enum: STATUS_ENUM },
          intervalMinutes: {
            type: ['integer', 'null'],
            description: 'New cadence in minutes, or null for a one-shot schedule.'
          },
          anchor: ANCHOR_SCHEMA,
          mcpServerIds: { type: 'array', items: { type: 'string' } },
          modelKey: { type: ['string', 'null'] }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'agenda_run_schedule',
      description:
        'Run a schedule immediately. Running does not pause, resume or otherwise change its status.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact 12-digit schedule id.' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'agenda_delete_schedule',
      description:
        'Permanently delete a schedule, stop its active run and remove its run history. This cannot be undone.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exact 12-digit schedule id.' }
        },
        required: ['id']
      }
    }
  }
]

export function getAgendaAgentToolDefinitions(): OpenAiToolDefinition[] {
  return DEFINITIONS
}

export function isAgendaAgentTool(name: string): boolean {
  return (AGENDA_AGENT_TOOL_NAMES as readonly string[]).includes(name)
}

export interface AgendaAgentToolRuntime {
  chatId: string
  agentId: string
  signal?: AbortSignal
  recordPrompt: () => void
}

type ToolArgs = Record<string, unknown>

function success(args: ToolArgs, payload: Record<string, unknown>): ValidatedToolExecution {
  return {
    args,
    envelope: { ok: true, output: JSON.stringify(payload) },
    modelContent: JSON.stringify(payload)
  }
}

function failure(
  code: 'INVALID_ARGUMENTS' | 'EXECUTION_FAILED' | 'CANCELLED',
  message: string
): ValidatedToolExecution {
  return {
    args: {},
    envelope: { ok: false, error: { code, message, retryable: false } },
    modelContent: JSON.stringify({ ok: false, error: message })
  }
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readLimit(value: unknown, fallback = 20): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.min(50, Math.round(numeric)))
}

function readStringArray(value: unknown): string[] | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) return null
  return [...new Set(value.map((entry) => String(entry).trim()).filter(Boolean))]
}

function readStatus(value: unknown): AgendaTaskStatus | null {
  return typeof value === 'string' && STATUS_ENUM.includes(value)
    ? (value as AgendaTaskStatus)
    : null
}

/** Validates a clock anchor; invalid anchors are rejected, never silently kept. */
function readAnchor(value: unknown, intervalMinutes: number | null): AgendaAnchor | null | 'invalid' {
  if (value === null || value === undefined) return null
  if (!value || typeof value !== 'object') return 'invalid'
  if (intervalMinutes === null || intervalMinutes < 1440) return 'invalid'
  const record = value as Record<string, unknown>
  if (record.kind !== 'time') return 'invalid'
  const hour = Number(record.hour)
  const minute = record.minute === undefined ? 0 : Number(record.minute)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return 'invalid'
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return 'invalid'
  const weekday = record.weekday === undefined ? undefined : Number(record.weekday)
  const dayOfMonth = record.dayOfMonth === undefined ? undefined : Number(record.dayOfMonth)
  if (weekday !== undefined && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) {
    return 'invalid'
  }
  if (
    dayOfMonth !== undefined &&
    (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)
  ) {
    return 'invalid'
  }
  if (weekday !== undefined && dayOfMonth !== undefined) return 'invalid'
  if (weekday !== undefined && intervalMinutes % 10080 !== 0) return 'invalid'
  if (dayOfMonth !== undefined && intervalMinutes !== 43200) return 'invalid'
  return {
    kind: 'time',
    hour,
    minute,
    ...(weekday !== undefined ? { weekday } : {}),
    ...(dayOfMonth !== undefined ? { dayOfMonth } : {})
  }
}

function describeSchedule(task: AgendaTask): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    origin: task.origin,
    agentId: task.agentId,
    prompt: task.prompt,
    instructions: task.instructions,
    cadence: describeAgendaCadence(task.intervalMinutes),
    intervalMinutes: task.intervalMinutes,
    anchor: task.anchor,
    anchorDescription: describeAgendaAnchor(task.anchor),
    nextRunAt: task.nextRunAt,
    lastRunAt: task.lastRunAt,
    lastRunStatus: task.lastRunStatus,
    mcpServerIds: task.mcpServerIds,
    modelKey: task.modelKey,
    folder: task.folder,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  }
}

function describeCadenceWithAnchor(
  intervalMinutes: number | null,
  anchor: AgendaAnchor | null
): string {
  return `${describeAgendaCadence(intervalMinutes)}${anchor ? ` ${describeAgendaAnchor(anchor)}` : ''}`
}

async function gate(
  runtime: AgendaAgentToolRuntime,
  input: {
    kind: 'schedule_create' | 'schedule_update' | 'schedule_run' | 'schedule_delete'
    title: string
    summary: string
    detail?: string
    task?: AgendaTask
  }
): Promise<ValidatedToolExecution | null> {
  if (getPermissionMode() === 'safe') runtime.recordPrompt()
  const outcome = await requestPermission(
    {
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      detail: input.detail,
      taskId: input.task?.id,
      taskTitle: input.task?.title
    },
    runtime.signal
  )
  if (outcome === 'allowed') return null
  return failure(
    'CANCELLED',
    outcome === 'timeout'
      ? 'The request timed out and was denied.'
      : 'The user denied this schedule change. Explain what was skipped and continue.'
  )
}

function findById(raw: unknown): { task: AgendaTask | null; error?: ValidatedToolExecution } {
  const id = normalizeAgendaScheduleId(raw)
  if (!id) {
    return {
      task: null,
      error: failure(
        'INVALID_ARGUMENTS',
        'Schedule ids have exactly 12 digits. Search for the schedule first and use the id returned by the tool.'
      )
    }
  }
  const task = loadTasks().find((candidate) => candidate.id === id) ?? null
  if (!task) {
    return { task: null, error: failure('EXECUTION_FAILED', `There is no schedule with id ${id}.`) }
  }
  return { task }
}

function validateServerIds(raw: unknown): { ids?: string[]; error?: string } {
  const requested = readStringArray(raw)
  if (requested === null) return {}
  const installed = new Set(loadServers().map((server) => server.id))
  const unknown = requested.filter((id) => !installed.has(id))
  if (unknown.length > 0) {
    return {
      error: `Unknown MCP server ids: ${unknown.join(', ')}. Install the server first or omit it.`
    }
  }
  return { ids: requested }
}

async function listSchedules(
  runtime: AgendaAgentToolRuntime,
  args: ToolArgs
): Promise<ValidatedToolExecution> {
  const status = args.status === undefined ? null : readStatus(args.status)
  if (args.status !== undefined && !status) return failure('INVALID_ARGUMENTS', 'Unknown status filter.')
  const limit = readLimit(args.limit)
  const tasks = loadTasks()
    .filter((task) => task.agentId === runtime.agentId)
    .filter((task) => (status ? task.status === status : true))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit)
  return success(args, {
    ok: true,
    count: tasks.length,
    total: countTasksForAgent(runtime.agentId),
    schedules: tasks.map(describeSchedule)
  })
}

function searchSchedules(
  runtime: AgendaAgentToolRuntime,
  args: ToolArgs
): ValidatedToolExecution {
  const rawId = args.id === undefined ? '' : String(args.id).trim()
  if (rawId) {
    if (!isAgendaScheduleId(rawId)) {
      return failure(
        'INVALID_ARGUMENTS',
        'Schedule ids have exactly 12 digits. Search by text, then use the exact id returned by the tool.'
      )
    }
    const task = loadTasks().find((candidate) => candidate.id === rawId)
    if (!task) return failure('EXECUTION_FAILED', `There is no schedule with id ${rawId}.`)
    return success(args, { ok: true, count: 1, schedules: [describeSchedule(task)] })
  }

  const query = readText(args.query).toLowerCase()
  const status = args.status === undefined ? null : readStatus(args.status)
  if (args.status !== undefined && !status) return failure('INVALID_ARGUMENTS', 'Unknown status filter.')
  const allAgents = args.allAgents === true
  const tasks = loadTasks()
    .filter((task) => (allAgents ? true : task.agentId === runtime.agentId))
    .filter((task) => (status ? task.status === status : true))
    .filter((task) => {
      if (!query) return true
      return [task.id, task.title, task.prompt, task.instructions]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, readLimit(args.limit))
  return success(args, {
    ok: true,
    count: tasks.length,
    schedules: tasks.map(describeSchedule)
  })
}

async function createSchedule(
  runtime: AgendaAgentToolRuntime,
  args: ToolArgs
): Promise<ValidatedToolExecution> {
  const title = readText(args.title)
  const prompt = readText(args.prompt)
  const instructions = readText(args.instructions)
  if (!title) return failure('INVALID_ARGUMENTS', 'A schedule name is required.')
  if (title.length > 80) return failure('INVALID_ARGUMENTS', 'Keep the schedule name under 80 characters.')
  if (!prompt) return failure('INVALID_ARGUMENTS', 'The prompt is required.')
  if (!instructions) return failure('INVALID_ARGUMENTS', 'Execution instructions are required.')

  const status = args.status === undefined ? 'active' : args.status
  if (status !== 'active' && status !== 'draft') {
    return failure('INVALID_ARGUMENTS', 'Choose "active" or "draft" when creating a schedule.')
  }

  const rawInterval = args.intervalMinutes
  if (rawInterval === undefined) {
    return failure('INVALID_ARGUMENTS', 'Specify a cadence, or null for a one-shot schedule.')
  }
  const numericInterval = rawInterval === null ? null : Number(rawInterval)
  if (
    numericInterval !== null &&
    (!Number.isFinite(numericInterval) ||
      numericInterval < AGENDA_MIN_INTERVAL_MINUTES ||
      numericInterval > AGENDA_MAX_INTERVAL_MINUTES)
  ) {
    return failure(
      'INVALID_ARGUMENTS',
      `Cadence must be between ${AGENDA_MIN_INTERVAL_MINUTES} and ${AGENDA_MAX_INTERVAL_MINUTES} minutes, or null for a one-shot schedule.`
    )
  }
  const intervalMinutes = normalizeIntervalMinutes(numericInterval)
  const anchor = readAnchor(args.anchor, intervalMinutes)
  if (anchor === 'invalid') {
    return failure(
      'INVALID_ARGUMENTS',
      'The anchor is not valid for this cadence. Use hour/minute; weekday only for whole-week intervals; dayOfMonth only for 43200 minutes.'
    )
  }
  const servers = validateServerIds(args.mcpServerIds)
  if (servers.error) return failure('INVALID_ARGUMENTS', servers.error)

  const agent = getAgent(runtime.agentId)
  if (!agent) return failure('EXECUTION_FAILED', 'This Agenda agent no longer exists.')

  const denied = await gate(runtime, {
    kind: 'schedule_create',
    title: status === 'draft' ? 'Save a draft schedule' : 'Create a schedule',
    summary: `${title} — ${describeCadenceWithAnchor(intervalMinutes, anchor)}`,
    detail: instructions
  })
  if (denied) return denied

  const task = createTask({
    agentId: runtime.agentId,
    title,
    prompt,
    instructions,
    origin: 'ai',
    status,
    intervalMinutes,
    anchor,
    mcpServerIds: servers.ids ?? [],
    modelKey: readText(args.modelKey) || null
  })
  broadcastIpc('agenda-tasks-changed')
  return success(args, {
    ok: true,
    created: true,
    schedule: describeSchedule(task),
    message:
      status === 'draft'
        ? `Draft "${task.title}" saved (${task.id}). It will not run until the user activates it.`
        : `Schedule "${task.title}" created (${task.id}).`
  })
}

async function updateSchedule(
  runtime: AgendaAgentToolRuntime,
  args: ToolArgs
): Promise<ValidatedToolExecution> {
  const found = findById(args.id)
  if (found.error) return found.error
  const task = found.task as AgendaTask

  const patch: Partial<AgendaTask> = {}
  const changes: string[] = []

  if (args.title !== undefined) {
    const title = readText(args.title)
    if (!title) return failure('INVALID_ARGUMENTS', 'A schedule name cannot be empty.')
    if (title.length > 80) return failure('INVALID_ARGUMENTS', 'Keep the schedule name under 80 characters.')
    patch.title = title
    changes.push('name')
  }
  if (args.prompt !== undefined) {
    const prompt = readText(args.prompt)
    if (!prompt) return failure('INVALID_ARGUMENTS', 'The prompt cannot be empty.')
    patch.prompt = prompt
    changes.push('prompt')
  }
  if (args.instructions !== undefined) {
    const instructions = readText(args.instructions)
    if (!instructions) return failure('INVALID_ARGUMENTS', 'Execution instructions cannot be empty.')
    patch.instructions = instructions
    changes.push('instructions')
  }

  const nextInterval =
    args.intervalMinutes === undefined
      ? task.intervalMinutes
      : normalizeIntervalMinutes(args.intervalMinutes === null ? null : Number(args.intervalMinutes))
  if (args.intervalMinutes !== undefined) {
    const numeric = args.intervalMinutes === null ? null : Number(args.intervalMinutes)
    if (
      numeric !== null &&
      (!Number.isFinite(numeric) ||
        numeric < AGENDA_MIN_INTERVAL_MINUTES ||
        numeric > AGENDA_MAX_INTERVAL_MINUTES)
    ) {
      return failure(
        'INVALID_ARGUMENTS',
        `Cadence must be between ${AGENDA_MIN_INTERVAL_MINUTES} and ${AGENDA_MAX_INTERVAL_MINUTES} minutes, or null for a one-shot schedule.`
      )
    }
    patch.intervalMinutes = nextInterval
    changes.push('cadence')
  }
  if (args.anchor !== undefined) {
    const anchor = readAnchor(args.anchor, nextInterval)
    if (anchor === 'invalid') {
      return failure('INVALID_ARGUMENTS', 'The anchor is not valid for this cadence.')
    }
    patch.anchor = anchor
    changes.push('anchor')
  }
  if (args.status !== undefined) {
    const status = readStatus(args.status)
    if (!status) return failure('INVALID_ARGUMENTS', 'Unknown schedule status.')
    patch.status = status
    changes.push(`status to ${status}`)
  }
  if (args.mcpServerIds !== undefined) {
    const servers = validateServerIds(args.mcpServerIds)
    if (servers.error) return failure('INVALID_ARGUMENTS', servers.error)
    patch.mcpServerIds = servers.ids ?? []
    changes.push('MCP servers')
  }
  if (args.modelKey !== undefined) {
    patch.modelKey = readText(args.modelKey) || null
    changes.push('model')
  }

  if (changes.length === 0) return failure('INVALID_ARGUMENTS', 'No changes were provided.')

  const denied = await gate(runtime, {
    kind: 'schedule_update',
    title: 'Change a schedule',
    summary: `${task.title} (${task.id}) — ${changes.join(', ')}`,
    detail: patch.instructions ?? undefined,
    task
  })
  if (denied) return denied

  const next = updateTask(task.id, patch)
  if (!next) return failure('EXECUTION_FAILED', 'The schedule disappeared before it could be updated.')
  if (
    next.status === 'paused' ||
    next.status === 'draft' ||
    next.status === 'completed' ||
    next.status === 'cancelled'
  ) {
    dropQueuedRuns(next.id)
  }
  if (next.status === 'cancelled' || next.status === 'completed') {
    // Cancelling or completing stops the live run but preserves its history.
    await cancelTaskRun(next.id).catch(() => undefined)
  }
  broadcastIpc('agenda-tasks-changed')
  return success(args, {
    ok: true,
    updated: true,
    schedule: describeSchedule(next),
    message: `Schedule "${next.title}" (${next.id}) updated: ${changes.join(', ')}.`
  })
}

async function runSchedule(
  runtime: AgendaAgentToolRuntime,
  args: ToolArgs
): Promise<ValidatedToolExecution> {
  const found = findById(args.id)
  if (found.error) return found.error
  const task = found.task as AgendaTask

  const denied = await gate(runtime, {
    kind: 'schedule_run',
    title: 'Run a schedule now',
    summary: `${task.title} (${task.id})`,
    task
  })
  if (denied) return denied

  const result = runTaskNow(task.id, 'agent')
  if (!result.ok) return failure('EXECUTION_FAILED', result.error ?? 'Could not start the run.')
  broadcastIpc('agenda-tasks-changed')
  return success(args, {
    ok: true,
    started: true,
    scheduleId: task.id,
    message: `"${task.title}" is starting now. Its transcript will appear in the schedule detail.`
  })
}

async function deleteSchedule(
  runtime: AgendaAgentToolRuntime,
  args: ToolArgs
): Promise<ValidatedToolExecution> {
  const found = findById(args.id)
  if (found.error) return found.error
  const task = found.task as AgendaTask

  const runs = listRuns(task.id)
  const denied = await gate(runtime, {
    kind: 'schedule_delete',
    title: 'Delete a schedule',
    summary: `${task.title} (${task.id}) — ${runs.length} run${runs.length === 1 ? '' : 's'} will be removed`,
    task
  })
  if (denied) return denied

  await deleteRunsForTask(task.id)
  for (const run of runs) deleteChatSession(runChatId(run.id))
  const deleted = deleteTask(task.id, true)
  if (!deleted) return failure('EXECUTION_FAILED', 'The schedule could not be deleted.')
  broadcastIpc('agenda-tasks-changed')
  return success(args, {
    ok: true,
    deleted: true,
    scheduleId: task.id,
    message: `Schedule "${task.title}" (${task.id}) and its history were deleted.`
  })
}

/**
 * Executes one agent-only Agenda tool. Returns null when the name does not
 * belong to this surface so the regular tool runtime can handle it.
 */
export async function executeAgendaAgentTool(
  name: string,
  args: unknown,
  runtime: AgendaAgentToolRuntime
): Promise<ValidatedToolExecution | null> {
  if (!isAgendaAgentTool(name)) return null
  const record = args && typeof args === 'object' ? (args as ToolArgs) : {}

  switch (name) {
    case 'agenda_list_schedules':
      return listSchedules(runtime, record)
    case 'agenda_search_schedules':
      return searchSchedules(runtime, record)
    case 'agenda_create_schedule':
      return createSchedule(runtime, record)
    case 'agenda_update_schedule':
      return updateSchedule(runtime, record)
    case 'agenda_run_schedule':
      return runSchedule(runtime, record)
    case 'agenda_delete_schedule':
      return deleteSchedule(runtime, record)
    default:
      return null
  }
}
