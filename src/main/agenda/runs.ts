import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { CONFIG_DIR } from '../config'
import type {
  AgendaRunRecord,
  AgendaRunStatus,
  AgendaRunTrigger,
  AgendaTask
} from '../../shared/agendaTypes'
import { AGENDA_MAIN_AGENT_ID } from '../../shared/agendaTypes'
import { broadcastIpc } from '../safeSend'
import { loadTasks, saveTasks } from './tasks'

const RUN_STATUSES = new Set<AgendaRunStatus>([
  'queued',
  'running',
  'completed',
  'failed',
  'skipped',
  'missed',
  'interrupted',
  'stopped'
])

function runsDir(): string {
  return path.join(CONFIG_DIR, 'agenda', 'runs')
}

/** Chat session id that stores a run transcript. */
export function runChatId(runId: string): string {
  return `agenda-${runId}`
}

function readTrigger(value: unknown): AgendaRunTrigger {
  return value === 'manual' || value === 'agent' ? value : 'scheduled'
}

/**
 * Normalizes legacy run records, which had no agent, prompt or instruction
 * snapshots. Missing snapshots fall back to the current task so old history
 * stays readable.
 */
function normalizeRun(
  value: unknown,
  tasks: Map<string, AgendaTask>
): AgendaRunRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) return null
  if (typeof record.taskId !== 'string' || !record.taskId) return null
  const task = tasks.get(record.taskId)
  const status =
    typeof record.status === 'string' && RUN_STATUSES.has(record.status as AgendaRunStatus)
      ? (record.status as AgendaRunStatus)
      : 'interrupted'
  return {
    id: record.id,
    taskId: record.taskId,
    agentId:
      typeof record.agentId === 'string' && record.agentId.trim()
        ? record.agentId
        : task?.agentId ?? AGENDA_MAIN_AGENT_ID,
    taskTitle:
      typeof record.taskTitle === 'string' && record.taskTitle.trim()
        ? record.taskTitle
        : task?.title ?? 'Deleted schedule',
    prompt:
      typeof record.prompt === 'string' && record.prompt.trim()
        ? record.prompt
        : task?.prompt ?? task?.title ?? '',
    instructions:
      typeof record.instructions === 'string'
        ? record.instructions
        : task?.instructions ?? '',
    trigger: readTrigger(record.trigger),
    status,
    startedAt: typeof record.startedAt === 'number' ? record.startedAt : Date.now(),
    finishedAt: typeof record.finishedAt === 'number' ? record.finishedAt : null,
    summary: typeof record.summary === 'string' ? record.summary : null,
    error: typeof record.error === 'string' ? record.error : null,
    catchUp: record.catchUp === true,
    permissionPrompts:
      typeof record.permissionPrompts === 'number' ? record.permissionPrompts : 0,
    modelKey: typeof record.modelKey === 'string' && record.modelKey.trim() ? record.modelKey : null
  }
}

export function writeRun(run: AgendaRunRecord, broadcast = true): void {
  try {
    fs.mkdirSync(runsDir(), { recursive: true })
    fs.writeFileSync(
      path.join(runsDir(), `${run.id}.json`),
      `${JSON.stringify(run, null, 2)}\n`,
      'utf8'
    )
    if (broadcast) broadcastIpc('agenda-runs-changed')
  } catch (error) {
    console.warn('[agenda] could not persist the run record:', error)
  }
}

export function listRuns(taskId?: string): AgendaRunRecord[] {
  try {
    const dir = runsDir()
    if (!fs.existsSync(dir)) return []
    const tasks = new Map(loadTasks().map((task) => [task.id, task]))
    const runs = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        try {
          return normalizeRun(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')), tasks)
        } catch {
          return null
        }
      })
      .filter((run): run is AgendaRunRecord => Boolean(run))
    return runs
      .filter((run) => (taskId ? run.taskId === taskId : true))
      .sort((a, b) => b.startedAt - a.startedAt)
  } catch (error) {
    console.warn('[agenda] could not list runs:', error)
    return []
  }
}

export function getRun(id: string): AgendaRunRecord | null {
  return listRuns().find((run) => run.id === id) ?? null
}

/** Builds a run with the task snapshots required by the detail view. */
export function createRunRecord(
  task: AgendaTask,
  options: { trigger: AgendaRunTrigger; catchUp?: boolean; status?: AgendaRunStatus }
): AgendaRunRecord {
  return {
    id: randomUUID(),
    taskId: task.id,
    agentId: task.agentId,
    taskTitle: task.title,
    prompt: task.prompt,
    instructions: task.instructions,
    trigger: options.trigger,
    status: options.status ?? 'running',
    startedAt: Date.now(),
    finishedAt: null,
    summary: null,
    error: null,
    catchUp: options.catchUp ?? false,
    permissionPrompts: 0,
    modelKey: task.modelKey
  }
}

export function deleteRunRecord(id: string): void {
  try {
    fs.rmSync(path.join(runsDir(), `${id}.json`), { force: true })
  } catch (error) {
    console.warn('[agenda] could not delete a run record:', error)
  }
}

/** Deletes only the persisted run records for a task, not the transcript files. */
export function deleteRunRecordsForTask(taskId: string): void {
  for (const run of listRuns(taskId)) deleteRunRecord(run.id)
  broadcastIpc('agenda-runs-changed')
}

/**
 * A run left as `running` means Prism closed (or crashed) mid-run. Mark it as
 * interrupted on startup so history never shows a ghost run.
 */
export function markInterruptedRuns(): void {
  const runs = listRuns().filter((run) => run.status === 'running')
  if (runs.length === 0) return
  const tasks = loadTasks()
  let tasksChanged = false
  for (const run of runs) {
    run.status = 'interrupted'
    run.finishedAt = run.finishedAt ?? Date.now()
    run.error = run.error ?? 'Prism closed while this run was executing.'
    writeRun(run, false)
    const task = tasks.find((candidate) => candidate.id === run.taskId)
    if (task) {
      task.lastRunStatus = 'interrupted'
      task.updatedAt = Date.now()
      tasksChanged = true
    }
  }
  if (tasksChanged) saveTasks(tasks)
  broadcastIpc('agenda-runs-changed')
}
