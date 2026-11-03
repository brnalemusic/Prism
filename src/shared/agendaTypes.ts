/**
 * Agenda shared types.
 *
 * Agenda is a desktop-only Prism mode for scheduled tasks executed by an AI agent.
 * Each Agenda tab is an independent creation agent that owns its own schedules
 * and conversation history. The executor has full access to the machine, so
 * safety comes from the permission mode rather than from OS-level isolation.
 */

/** Shortest cadence Agenda accepts, in minutes. */
export const AGENDA_MIN_INTERVAL_MINUTES = 120
/** Longest cadence Agenda accepts, in minutes (31 days). */
export const AGENDA_MAX_INTERVAL_MINUTES = 31 * 24 * 60

/** Stable id and title of the agent that owns migrated schedules. */
export const AGENDA_MAIN_AGENT_ID = 'main'
export const AGENDA_MAIN_AGENT_TITLE = 'Main Agenda agent'

/** Number of digits in a schedule id. */
export const AGENDA_SCHEDULE_ID_LENGTH = 12
const AGENDA_SCHEDULE_ID_PATTERN = /^\d{12}$/

/** True when `value` is an exact 12-digit schedule id. */
export function isAgendaScheduleId(value: unknown): value is string {
  return typeof value === 'string' && AGENDA_SCHEDULE_ID_PATTERN.test(value)
}

/** Normalizes a user- or model-provided schedule id, or returns null. */
export function normalizeAgendaScheduleId(value: unknown): string | null {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  const digits = raw.replace(/\s+/g, '')
  return isAgendaScheduleId(digits) ? digits : null
}

/** Permission mode for Agenda actions. `safe` is always the default. */
export type AgendaPermissionMode = 'safe' | 'yolo'

/** Actions that require an explicit user decision while in `safe` mode. */
export type AgendaPermissionKind =
  | 'terminal'
  | 'mcp_tool'
  | 'mcp_install'
  | 'schedule_create'
  | 'schedule_update'
  | 'schedule_run'
  | 'schedule_delete'

/** Persisted Agenda settings. */
export interface AgendaSettings {
  permissionMode: AgendaPermissionMode
  /** True once the user has explicitly accepted the risk of running in YOLO. */
  yoloAcknowledged: boolean
  /** Maximum number of task runs executing at the same time. */
  maxConcurrentRuns: number
  /**
   * Default model for new Agenda tasks and for the agents that create them.
   * Tasks store their own `modelKey`, so changing this never rewrites existing work.
   */
  modelKey: string | null
}

/** A pending permission prompt shown to the user. */
export interface AgendaPermissionRequest {
  requestId: string
  kind: AgendaPermissionKind
  /** Short human label, e.g. "Run terminal command". */
  title: string
  /** One-line summary of the action, e.g. the command itself. */
  summary: string
  /** Optional full detail (command output preview, tool arguments, install command). */
  detail?: string
  taskId?: string
  taskTitle?: string
  runId?: string
  createdAt: number
  expiresAt: number
}

/** What the user chose in the permission dialog. */
export type AgendaPermissionChoice = 'stop' | 'continue' | 'yolo'

/** Result returned to the caller that requested permission. */
export type AgendaPermissionOutcome = 'allowed' | 'denied' | 'timeout' | 'aborted'

/** Payload sent from the renderer when the user resolves a prompt. */
export interface AgendaPermissionResolution {
  requestId: string
  choice: AgendaPermissionChoice
}

/**
 * Lifecycle of a schedule.
 *
 * - `draft`     Created but not scheduled by the user.
 * - `active`    Scheduled and allowed to run.
 * - `paused`    Kept, but no automatic runs.
 * - `completed` Finished (one-shot done or marked complete by the user).
 * - `cancelled` Abandoned; history is preserved.
 */
export type AgendaTaskStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled'

/** Who created the schedule. */
export type AgendaTaskOrigin = 'ai' | 'manual'

/** What started a run. */
export type AgendaRunTrigger = 'scheduled' | 'manual' | 'agent'

export type AgendaRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'missed'
  | 'interrupted'
  | 'stopped'

/** Wall-clock anchor used by the hybrid recurrence model. */
export interface AgendaAnchor {
  kind: 'time'
  hour: number
  minute: number
  /** 0 = Sunday. Only used when the cadence is weekly. */
  weekday?: number
  /** Only used when the cadence is monthly. */
  dayOfMonth?: number
}

/** A persistent Agenda creation agent. Each agent owns its schedules. */
export interface AgendaAgent {
  id: string
  title: string
  /** The main agent cannot be deleted and receives migrated schedules. */
  isMain: boolean
  createdAt: number
  updatedAt: number
}

export interface AgendaTask {
  /** Unique 12-digit numeric id, used verbatim by the AI tools. */
  id: string
  /** Agent that created and owns this schedule. */
  agentId: string
  title: string
  /** Natural-language request that produced the schedule. */
  prompt: string
  /** Execution instructions shown to the run agent. */
  instructions: string
  /** Absolute path of the task folder. */
  folder: string
  status: AgendaTaskStatus
  origin: AgendaTaskOrigin
  /** Fixed interval in minutes, or null for a one-shot task. */
  intervalMinutes: number | null
  anchor: AgendaAnchor | null
  mcpServerIds: string[]
  modelKey: string | null
  nextRunAt: number | null
  lastRunAt: number | null
  lastRunStatus: AgendaRunStatus | null
  createdAt: number
  updatedAt: number
}

/**
 * Human description of a cadence, used in prompts and in the Agenda UI.
 * Kept in the shared layer so the main process and the renderer always agree.
 */
export function describeAgendaCadence(intervalMinutes: number | null): string {
  if (intervalMinutes === null) return 'once'
  const day = 24 * 60
  if (intervalMinutes % day === 0) {
    const days = intervalMinutes / day
    return days === 1 ? 'every day' : `every ${days} days`
  }
  if (intervalMinutes % 60 === 0) {
    const hours = intervalMinutes / 60
    return hours === 1 ? 'every hour' : `every ${hours} hours`
  }
  return `every ${intervalMinutes} minutes`
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function padClock(value: number): string {
  return String(value).padStart(2, '0')
}

/** Human description of a clock anchor, e.g. "Monday at 09:00". */
export function describeAgendaAnchor(anchor: AgendaAnchor | null): string {
  if (!anchor) return ''
  const time = `${padClock(anchor.hour)}:${padClock(anchor.minute)}`
  if (anchor.weekday !== undefined) {
    return `${WEEKDAY_NAMES[anchor.weekday] ?? 'Weekly'} at ${time}`
  }
  if (anchor.dayOfMonth !== undefined) return `day ${anchor.dayOfMonth} at ${time}`
  return `at ${time}`
}

export interface AgendaRunRecord {
  id: string
  taskId: string
  /** Agent that owns the task at the time of the run. */
  agentId: string
  /** Snapshot of the task title so history survives edits and deletion. */
  taskTitle: string
  /** Snapshot of the creation prompt. */
  prompt: string
  /** Snapshot of the instructions executed by this run. */
  instructions: string
  trigger: AgendaRunTrigger
  status: AgendaRunStatus
  startedAt: number
  finishedAt: number | null
  summary: string | null
  error: string | null
  /** True when this run executed an occurrence that was missed while Prism was closed. */
  catchUp: boolean
  /** Number of permission prompts resolved during this run. */
  permissionPrompts: number
  /** Model snapshot captured when the run was created. */
  modelKey: string | null
}

/** Challenge used before deleting an agent together with its schedules. */
export interface AgendaAgentDeletionChallenge {
  challengeId: string
  agentId: string
  agentTitle: string
  scheduleCount: number
  /** 1 = acknowledge, 2 = type the agent title, 3 = solve the generated puzzle. */
  step: 1 | 2 | 3
  expiresAt: number
  /** Present on step 3. The answer is never sent to the renderer. */
  puzzle?: { question: string }
}

export interface AgendaAgentDeletionStepResult {
  ok: boolean
  error?: string
  challenge?: AgendaAgentDeletionChallenge
  complete?: boolean
}

/** Generic IPC envelope used by the Agenda bridge. */
export interface AgendaResult<T> {
  ok: boolean
  data?: T
  error?: string
}

export interface AgendaRunTaskResult {
  ok: boolean
  error?: string
}
