import type { AgendaRunRecord, AgendaRunTrigger, AgendaTask } from '../../shared/agendaTypes'
import { appendRunLog, computeNextRunAt, loadTasks, saveTasks } from './tasks'
import {
  createRunRecord,
  deleteRunRecordsForTask,
  markInterruptedRuns,
  writeRun
} from './runs'

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

interface QueueEntry {
  taskId: string
  scheduledFor: number
  trigger: AgendaRunTrigger
}

const active = new Map<string, AbortController>()
const running = new Map<string, Promise<void>>()
const queue: QueueEntry[] = []

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

/** Task ids that currently have a live run, for the sidebar badges. */
export function getActiveRunTaskIds(): string[] {
  return [...active.keys()]
}

function markTask(taskId: string, patch: Partial<AgendaTask>): void {
  const tasks = loadTasks()
  const index = tasks.findIndex((task) => task.id === taskId)
  if (index < 0) return
  tasks[index] = { ...tasks[index], ...patch, updatedAt: Date.now() }
  saveTasks(tasks)
}

function isQueued(taskId: string): boolean {
  return queue.some((entry) => entry.taskId === taskId)
}

function removeFromQueue(taskId: string): void {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (queue[index].taskId === taskId) queue.splice(index, 1)
  }
}

async function executeTask(entry: QueueEntry): Promise<void> {
  const { taskId, scheduledFor, trigger } = entry
  const tasks = loadTasks()
  const task = tasks.find((candidate) => candidate.id === taskId)
  if (!task) return

  // A scheduled occurrence is only valid while the schedule is still active.
  // Manual and agent runs are explicit user intent and may target any status.
  if (trigger === 'scheduled' && task.status !== 'active') {
    appendRunLog(task, 'scheduled run discarded: the schedule is no longer active')
    return
  }

  const controller = new AbortController()
  active.set(taskId, controller)

  const missed = trigger === 'scheduled' && Date.now() - scheduledFor > MISSED_THRESHOLD_MS
  const run = createRunRecord(task, { trigger, catchUp: missed })
  writeRun(run)
  appendRunLog(
    task,
    `run ${run.id} started (${trigger}${missed ? ', catch-up' : ''})`
  )
  markTask(taskId, { lastRunAt: run.startedAt, lastRunStatus: run.status })

  try {
    if (!executor) {
      run.status = 'failed'
      run.error = 'The Agenda executor is not configured yet.'
    } else {
      const result = await executor({ ...task, title: run.taskTitle, prompt: run.prompt, instructions: run.instructions }, run, controller.signal)
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

    // A one-shot schedule never fires again. It completes after its run even
    // when the user or an agent triggered it manually, but a cancelled run must
    // not silently complete the schedule.
    const current = loadTasks().find((candidate) => candidate.id === taskId)
    if (
      current &&
      current.intervalMinutes === null &&
      current.status === 'active' &&
      run.status !== 'stopped'
    ) {
      markTask(taskId, { lastRunStatus: run.status, status: 'completed', nextRunAt: null })
    } else {
      markTask(taskId, { lastRunStatus: run.status })
    }
    active.delete(taskId)
  }
}

function drainQueue(): void {
  while (active.size < maxConcurrentRuns && queue.length > 0) {
    const entry = queue.shift()
    if (!entry) break
    if (active.has(entry.taskId)) continue
    const execution = executeTask(entry).finally(() => {
      running.delete(entry.taskId)
      drainQueue()
    })
    running.set(entry.taskId, execution)
    void execution
  }
}

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
      // A one-shot task has no next occurrence; complete it so the UI reflects
      // that the schedule is finished.
      if (task.intervalMinutes === null) {
        task.status = 'completed'
        task.nextRunAt = null
      }
      changed = true

      if (active.has(task.id) || isQueued(task.id)) {
        const skipped = createRunRecord(task, {
          trigger: 'scheduled',
          status: 'skipped'
        })
        skipped.finishedAt = now
        skipped.summary = 'Skipped: the previous run is still active.'
        writeRun(skipped)
        appendRunLog(task, `run ${skipped.id} skipped (still running)`)
        continue
      }

      if (queue.length >= MAX_QUEUE) {
        appendRunLog(task, 'run dropped: the queue is full')
        continue
      }

      queue.push({ taskId: task.id, scheduledFor, trigger: 'scheduled' })
    }

    if (changed) saveTasks(tasks)
    drainQueue()
  } finally {
    ticking = false
  }
}

/**
 * Runs a task immediately. Unlike a scheduled occurrence, this never changes
 * the task status or its next occurrence.
 */
export function runTaskNow(
  taskId: string,
  trigger: Extract<AgendaRunTrigger, 'manual' | 'agent'>
): { ok: boolean; error?: string } {
  const task = loadTasks().find((candidate) => candidate.id === taskId)
  if (!task) return { ok: false, error: 'Schedule not found.' }
  if (task.status === 'cancelled') {
    return { ok: false, error: 'Cancelled schedules cannot be run.' }
  }
  if (task.status === 'draft') {
    return { ok: false, error: 'Activate the schedule before running it.' }
  }
  if (active.has(taskId)) {
    return { ok: false, error: 'This schedule already has a run in progress.' }
  }
  if (isQueued(taskId)) {
    return { ok: false, error: 'This schedule is already queued to run.' }
  }
  if (queue.length >= MAX_QUEUE) {
    return { ok: false, error: 'The run queue is full. Try again in a moment.' }
  }
  queue.push({ taskId, scheduledFor: Date.now(), trigger })
  drainQueue()
  return { ok: true }
}

/** Stops queued and active runs for a task without changing its status. */
export async function cancelTaskRun(taskId: string): Promise<boolean> {
  removeFromQueue(taskId)
  const controller = active.get(taskId)
  if (!controller) return false
  controller.abort()
  const execution = running.get(taskId)
  if (execution) await execution.catch(() => undefined)
  return true
}

/** Clears pending occurrences while keeping an already-running run alive. */
export function dropQueuedRuns(taskId: string): void {
  removeFromQueue(taskId)
}

export function startScheduler(): void {
  if (ticker) return
  markInterruptedRuns()
  tick()
  ticker = setInterval(() => tick(), TICK_MS)
  // Keep the scheduler referenced so it keeps running (and keeps the process
  // alive) while Prism is minimized to the system tray instead of being
  // collected as an unreferenced timer.
}

export function stopScheduler(): void {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
  for (const controller of active.values()) controller.abort()
  active.clear()
  queue.length = 0
}

/**
 * Stops the task's active run, waits for it to finish writing, then deletes its
 * run records. Called before a task is deleted so nothing is left orphaned.
 */
export async function deleteRunsForTask(taskId: string): Promise<void> {
  removeFromQueue(taskId)
  active.get(taskId)?.abort()
  const execution = running.get(taskId)
  if (execution) await execution.catch(() => undefined)
  deleteRunRecordsForTask(taskId)
}

/** Stops every active run. Used when Prism quits; runs end as `stopped`. */
export function interruptActiveRuns(): void {
  for (const controller of active.values()) controller.abort()
  stopScheduler()
}

export { listRuns } from './runs'
