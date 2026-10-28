/**
 * Agenda shared types.
 *
 * Agenda is a desktop-only Prism mode for scheduled tasks executed by an AI agent.
 * The executor has full access to the machine, so safety comes from the permission
 * mode rather than from OS-level isolation.
 */

/** Shortest cadence Agenda accepts, in minutes. */
export const AGENDA_MIN_INTERVAL_MINUTES = 120
/** Longest cadence Agenda accepts, in minutes (31 days). */
export const AGENDA_MAX_INTERVAL_MINUTES = 31 * 24 * 60

/** Permission mode for Agenda actions. `safe` is always the default. */
export type AgendaPermissionMode = 'safe' | 'yolo'

/** Actions that require an explicit user decision while in `safe` mode. */
export type AgendaPermissionKind = 'terminal' | 'mcp_tool' | 'mcp_install' | 'schedule_create'

/** Persisted Agenda settings. */
export interface AgendaSettings {
  permissionMode: AgendaPermissionMode
  /** True once the user has explicitly accepted the risk of running in YOLO. */
  yoloAcknowledged: boolean
  /** Maximum number of task runs executing at the same time. */
  maxConcurrentRuns: number
  /**
   * Default model for new Agenda tasks and for the planner that drafts them.
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

export type AgendaTaskStatus = 'active' | 'paused'

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

export interface AgendaTask {
  id: string
  title: string
  instructions: string
  /** Absolute path of the task folder. */
  folder: string
  status: AgendaTaskStatus
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
