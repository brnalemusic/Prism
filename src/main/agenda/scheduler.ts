import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { CONFIG_DIR } from '../config'
import type { AgendaRunRecord, AgendaRunStatus, AgendaTask } from '../../shared/agendaTypes'
import { appendRunLog, computeNextRunAt, loadTasks, saveTasks } from './tasks'
import { broadcastIpc } from '../safeSend'

/** How often the scheduler looks for due tasks. */
const TICK_MS = 30 * 1000
/** A task that is more than this late is recorded as a catch-up run. */
const MISSED_THRESHOLD_MS = 60 * 1000
const MAX_QUEUE = 20

export type AgendaRunExecutor = (
  task: AgendaTask,
  run: AgendaRunRecord,
  signal: AbortSignal
) => Promise<{ summary?: string; permissionPrompts?: number } | void>

let executor: AgendaRunExecutor | null = null
let ticker: NodeJS.Timeout | null = null
let ticking = false
let maxConcurrentRuns = 2

const active = new Map<string, AbortController>()
const running = new Map<string, Promise<void>>()
const queue: string[] = []

function runsDir(): string {
  return path.join(CONFIG_DIR, 'agenda', 'runs')
}

function writeRun(run: AgendaRunRecord): void {
  try {
    fs.mkdirSync(runsDir(), { recursive: true })
    fs.writeFileSync(path.join(runsDir(), `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`, 'utf8')
    broadcastIpc('agenda-runs-changed')
  } catch (error) {
    console.warn('[agenda] could not persist the run record:', error)
  }
}

export function listRuns(taskId?: string): AgendaRunRecord[] {
  try {
    const dir = runsDir()
    if (!fs.existsSync(dir)) return []
    const runs = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as AgendaRunRecord
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

export function setRunExecutor(next: AgendaRunExecutor | null): void {
  executor = next
}

export function configureScheduler(options: { maxConcurrentRuns: number }): void {
  maxConcurrentRuns = Math.max(1, Math.min(8, options.maxConcurrentRuns))
}

export function getActiveRunCount(): number {
  return active.size
}

export function getQueuedRunCount(): number {
  return queue.length
}

function markTask(taskId: string, patch: Partial<AgendaTask>): void {
  const tasks = loadTasks()
  const index = tasks.findIndex((task) => task.id === taskId)
  if (index < 0) return
  tasks[index] = { ...tasks[index], ...patch, updatedAt: Date.now() }
  saveTasks(tasks)
}

async function executeTask(taskId: string, scheduledFor: number): Promise<void> {
  const tasks = loadTasks()
  const task = tasks.find((candidate) => candidate.id === taskId)
  if (!task) return

  const controller = new AbortController()
  active.set(taskId, controller)

  const missed = Date.now() - scheduledFor > MISSED_THRESHOLD_MS
  const run: AgendaRunRecord = {
    id: randomUUID(),
    taskId,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    summary: null,
    error: null,
    catchUp: missed,
    permissionPrompts: 0
  }
  writeRun(run)
  appendRunLog(task, `run ${run.id} started${missed ? ' (catch-up)' : ''}`)
  markTask(taskId, { lastRunAt: run.startedAt, lastRunStatus: run.status })

  try {
    if (!executor) {
      run.status = 'failed'
      run.error = 'The Agenda executor is not configured yet.'
    } else {
      const result = await executor(task, run, controller.signal)
      run.permissionPrompts = result?.permissionPrompts ?? 0
      if (controller.signal.aborted) {
        run.status = 'stopped'
      } else {
        run.status = 'completed'
        run.summary = result?.summary ?? null
      }
    }
  } catch (error) {
    run.status = controller.signal.aborted ? 'stopped' : 'failed'
    run.error = error instanceof Error ? error.message : String(error)
  } finally {
    run.finishedAt = Date.now()
    writeRun(run)
    appendRunLog(task, `run ${run.id} ${run.status}${run.error ? `: ${run.error}` : ''}`)
    markTask(taskId, { lastRunStatus: run.status as AgendaRunStatus })
    active.delete(taskId)
  }
}

function drainQueue(): void {
  while (active.size < maxConcurrentRuns && queue.length > 0) {
    const taskId = queue.shift()
    if (!taskId) break
    if (active.has(taskId)) continue
    const scheduledFor = dueTimes.get(taskId) ?? Date.now()
    dueTimes.delete(taskId)
    const execution = executeTask(taskId, scheduledFor).finally(() => {
      running.delete(taskId)
      drainQueue()
    })
    running.set(taskId, execution)
    void execution
  }
}

const dueTimes = new Map<string, number>()

/**
 * Looks for due tasks, advances their schedule and queues them.
 *
 * Overlapping occurrences of the same task are recorded as `skipped` instead of
 * stacking up. Missed occurrences while Prism was closed produce exactly one
 * catch-up run, never a burst.
 */
export function tick(now = Date.now()): void {
  if (ticking) return
  ticking = true
  try {
    const tasks = loadTasks()
    let changed = false

    for (const task of tasks) {
      if (task.status !== 'active' || task.nextRunAt === null) continue
      if (task.nextRunAt > now) continue

      const scheduledFor = task.nextRunAt
      const nextRunAt = computeNextRunAt({ ...task, nextRunAt: scheduledFor }, now)
      task.nextRunAt = nextRunAt
      // A one-shot task has no next occurrence; pause it so the UI reflects that.
      if (task.intervalMinutes === null) task.status = 'paused'
      changed = true

      if (active.has(task.id) || queue.includes(task.id)) {
        const skipped: AgendaRunRecord = {
          id: randomUUID(),
          taskId: task.id,
          status: 'skipped',
          startedAt: now,
          finishedAt: now,
          summary: 'Skipped: the previous run is still active.',
          error: null,
          catchUp: false,
          permissionPrompts: 0
        }
        writeRun(skipped)
        appendRunLog(task, `run ${skipped.id} skipped (still running)`)
        continue
      }

      if (queue.length >= MAX_QUEUE) {
        appendRunLog(task, 'run dropped: the queue is full')
        continue
      }

      dueTimes.set(task.id, scheduledFor)
      queue.push(task.id)
    }

    if (changed) saveTasks(tasks)
    drainQueue()
  } finally {
    ticking = false
  }
}

export function startScheduler(): void {
  if (ticker) return
  markInterruptedRuns()
  tick()
  ticker = setInterval(() => tick(), TICK_MS)
  if (typeof ticker.unref === 'function') ticker.unref()
}

/**
 * A run record left as `running` means Prism closed (or crashed) mid-run. Mark
 * it as interrupted on startup so the history never shows a ghost run.
 */
function markInterruptedRuns(): void {
  const runs = listRuns().filter((run) => run.status === 'running')
  if (runs.length === 0) return
  const tasks = loadTasks()
  let tasksChanged = false
  for (const run of runs) {
    run.status = 'interrupted'
    run.finishedAt = run.finishedAt ?? Date.now()
    run.error = run.error ?? 'Prism closed while this run was executing.'
    writeRun(run)
    const task = tasks.find((candidate) => candidate.id === run.taskId)
    if (task) {
      task.lastRunStatus = 'interrupted'
      task.updatedAt = Date.now()
      tasksChanged = true
    }
  }
  if (tasksChanged) saveTasks(tasks)
}

export function stopScheduler(): void {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
  for (const controller of active.values()) controller.abort()
  active.clear()
  queue.length = 0
  dueTimes.clear()
}

/**
 * Stops the task's active run, waits for it to finish writing, then deletes its
 * run records. Called before a task is deleted so nothing is left orphaned.
 */
export async function deleteRunsForTask(taskId: string): Promise<void> {
  active.get(taskId)?.abort()
  const queued = queue.indexOf(taskId)
  if (queued >= 0) queue.splice(queued, 1)
  dueTimes.delete(taskId)
  const execution = running.get(taskId)
  if (execution) await execution.catch(() => undefined)
  for (const run of listRuns(taskId)) {
    try {
      fs.rmSync(path.join(runsDir(), `${run.id}.json`), { force: true })
    } catch (error) {
      console.warn('[agenda] could not delete a run record:', error)
    }
  }
  broadcastIpc('agenda-runs-changed')
}

/** Stops every active run. Used when Prism quits; runs end as `stopped`. */
export function interruptActiveRuns(): void {
  for (const controller of active.values()) controller.abort()
  stopScheduler()
}
