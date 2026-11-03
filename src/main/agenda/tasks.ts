import { randomInt } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { CONFIG_DIR } from '../config'
import { describeAgendaCadence } from '../../shared/agendaTypes'
import { AGENDA_MAIN_AGENT_ID } from '../../shared/agendaTypes'
import type {
  AgendaAnchor,
  AgendaTask,
  AgendaTaskOrigin,
  AgendaTaskStatus
} from '../../shared/agendaTypes'
import { computeNextRunAt, normalizeIntervalMinutes } from './cadence'

export {
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  computeNextRunAt,
  normalizeIntervalMinutes
} from './cadence'

export interface CreateAgendaTaskInput {
  agentId?: string
  title: string
  prompt: string
  instructions: string
  origin?: AgendaTaskOrigin
  /** `draft` creates the record without scheduling it. Defaults to `active`. */
  status?: Extract<AgendaTaskStatus, 'draft' | 'active'>
  intervalMinutes: number | null
  anchor: AgendaAnchor | null
  mcpServerIds?: string[]
  modelKey?: string | null
  /** Explicit first run. Defaults to now for one-shot tasks and now + interval otherwise. */
  firstRunAt?: number | null
}

const TASK_STATUSES = new Set<AgendaTaskStatus>([
  'draft',
  'active',
  'paused',
  'completed',
  'cancelled'
])

function agendaDir(): string {
  return path.join(CONFIG_DIR, 'agenda')
}

function tasksFile(): string {
  return path.join(agendaDir(), 'tasks.json')
}

/** Root folder that holds every task folder. */
export function agendaTasksRoot(): string {
  return path.join(app.getPath('documents'), 'Prism', 'Agenda')
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'task'
}

function readJsonFile<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback
    const raw = fs.readFileSync(file, 'utf8').trim()
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch (error) {
    console.warn(`[agenda] could not read ${file}:`, error)
    return fallback
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

function readStatus(value: unknown): AgendaTaskStatus {
  return typeof value === 'string' && TASK_STATUSES.has(value as AgendaTaskStatus)
    ? (value as AgendaTaskStatus)
    : 'paused'
}

function readOrigin(value: unknown): AgendaTaskOrigin {
  return value === 'ai' ? 'ai' : 'manual'
}

/**
 * Defensive normalization for records written by older builds. Migrations do
 * the heavy lifting once; this keeps a hand-edited or partially written file
 * from breaking the whole Agenda surface.
 */
function normalizeTask(value: unknown): AgendaTask | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) return null
  const now = Date.now()
  const title =
    typeof record.title === 'string' && record.title.trim() ? record.title.trim() : 'Untitled schedule'
  return {
    id: record.id,
    agentId:
      typeof record.agentId === 'string' && record.agentId.trim()
        ? record.agentId.trim()
        : AGENDA_MAIN_AGENT_ID,
    title,
    prompt:
      typeof record.prompt === 'string' && record.prompt.trim() ? record.prompt : title,
    instructions: typeof record.instructions === 'string' ? record.instructions : '',
    folder: typeof record.folder === 'string' ? record.folder : '',
    status: readStatus(record.status),
    origin: readOrigin(record.origin),
    intervalMinutes:
      typeof record.intervalMinutes === 'number' ? record.intervalMinutes : null,
    anchor:
      record.anchor && typeof record.anchor === 'object'
        ? (record.anchor as AgendaAnchor)
        : null,
    mcpServerIds: Array.isArray(record.mcpServerIds)
      ? record.mcpServerIds.filter((entry): entry is string => typeof entry === 'string')
      : [],
    modelKey: typeof record.modelKey === 'string' && record.modelKey.trim() ? record.modelKey : null,
    nextRunAt: typeof record.nextRunAt === 'number' ? record.nextRunAt : null,
    lastRunAt: typeof record.lastRunAt === 'number' ? record.lastRunAt : null,
    lastRunStatus:
      typeof record.lastRunStatus === 'string'
        ? (record.lastRunStatus as AgendaTask['lastRunStatus'])
        : null,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : now
  }
}

export function loadTasks(): AgendaTask[] {
  const tasks = readJsonFile<unknown[]>(tasksFile(), [])
  if (!Array.isArray(tasks)) return []
  return tasks.map(normalizeTask).filter((task): task is AgendaTask => Boolean(task))
}

export function saveTasks(tasks: AgendaTask[]): void {
  writeJsonAtomic(tasksFile(), tasks)
}

export function getTask(id: string): AgendaTask | null {
  return loadTasks().find((task) => task.id === id) ?? null
}

export function listTasksForAgent(agentId: string): AgendaTask[] {
  return loadTasks().filter((task) => task.agentId === agentId)
}

export function countTasksForAgent(agentId: string): number {
  return listTasksForAgent(agentId).length
}

/** Generates a unique 12-digit schedule id. */
export function generateScheduleId(existingIds?: Iterable<string>): string {
  const taken = new Set(existingIds ?? loadTasks().map((task) => task.id))
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const id = String(randomInt(100_000_000_000, 1_000_000_000_000))
    if (!taken.has(id)) return id
  }
  throw new Error('Could not generate a unique schedule id.')
}

function ensureTaskFolder(folder: string, title: string, id: string): void {
  fs.mkdirSync(path.join(folder, '.agenda'), { recursive: true })
  const manifestPath = path.join(folder, '.agenda', 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    writeJsonAtomic(manifestPath, { id, title, createdAt: Date.now() })
  }
  const statePath = path.join(folder, '.agenda', 'state.md')
  if (!fs.existsSync(statePath)) {
    fs.writeFileSync(
      statePath,
      `# ${title}\n\nThis file is the only memory carried between runs. Keep it short and useful.\n`,
      'utf8'
    )
  }
}

export function createTask(input: CreateAgendaTaskInput): AgendaTask {
  const now = Date.now()
  const title = input.title.trim() || 'Untitled schedule'
  const prompt = input.prompt.trim() || title
  const instructions = input.instructions.trim()
  if (!instructions) throw new Error('A schedule needs instructions.')

  const id = generateScheduleId()
  const folder = path.join(agendaTasksRoot(), `${slugify(title)}-${id}`)
  ensureTaskFolder(folder, title, id)

  const intervalMinutes = normalizeIntervalMinutes(input.intervalMinutes)
  const status: Extract<AgendaTaskStatus, 'draft' | 'active'> =
    input.status === 'draft' ? 'draft' : 'active'
  const task: AgendaTask = {
    id,
    agentId: input.agentId?.trim() || AGENDA_MAIN_AGENT_ID,
    title,
    prompt,
    instructions,
    folder,
    status,
    origin: input.origin === 'ai' ? 'ai' : 'manual',
    intervalMinutes,
    anchor: input.anchor,
    mcpServerIds: input.mcpServerIds ?? [],
    modelKey: input.modelKey?.trim() || null,
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: null,
    createdAt: now,
    updatedAt: now
  }

  if (status === 'active') {
    task.nextRunAt =
      input.firstRunAt ??
      (intervalMinutes === null
        ? now
        : computeNextRunAt({ intervalMinutes, anchor: input.anchor, nextRunAt: null }, now))
  }

  const tasks = loadTasks()
  tasks.push(task)
  saveTasks(tasks)
  return task
}

export function updateTask(id: string, patch: Partial<AgendaTask>): AgendaTask | null {
  const tasks = loadTasks()
  const index = tasks.findIndex((task) => task.id === id)
  if (index < 0) return null

  const current = tasks[index]
  const normalizedPatch: Partial<AgendaTask> = {
    ...patch,
    ...(patch.intervalMinutes === undefined
      ? {}
      : { intervalMinutes: normalizeIntervalMinutes(patch.intervalMinutes) }),
    ...(patch.modelKey === undefined
      ? {}
      : { modelKey: patch.modelKey?.trim() || null }),
    ...(patch.status === undefined ? {} : { status: readStatus(patch.status) })
  }
  const next: AgendaTask = {
    ...current,
    ...normalizedPatch,
    id: current.id,
    folder: current.folder,
    createdAt: current.createdAt,
    updatedAt: Date.now()
  }

  const intervalChanged =
    normalizedPatch.intervalMinutes !== undefined &&
    normalizedPatch.intervalMinutes !== current.intervalMinutes
  const anchorChanged =
    normalizedPatch.anchor !== undefined &&
    JSON.stringify(normalizedPatch.anchor) !== JSON.stringify(current.anchor)
  const scheduleChanged = intervalChanged || anchorChanged
  const statusChanged = normalizedPatch.status !== undefined && normalizedPatch.status !== current.status
  const becameActive = statusChanged && next.status === 'active'
  const resumedFromPause = becameActive && current.status === 'paused'

  if (next.status === 'active') {
    if (scheduleChanged || (statusChanged && !resumedFromPause) || next.nextRunAt === null) {
      next.nextRunAt =
        next.intervalMinutes === null
          ? Date.now()
          : computeNextRunAt({ ...next, nextRunAt: null }, Date.now())
    } else if (resumedFromPause && normalizedPatch.nextRunAt === undefined) {
      next.nextRunAt =
        next.intervalMinutes === null ? Date.now() : computeNextRunAt(next, Date.now())
    }
  } else {
    // Only an active schedule may have a pending occurrence.
    next.nextRunAt = null
  }

  tasks[index] = next
  saveTasks(tasks)
  return next
}

export function setTaskStatus(id: string, status: AgendaTaskStatus): AgendaTask | null {
  return updateTask(id, { status })
}

export function deleteTask(id: string, deleteFolder: boolean): boolean {
  const tasks = loadTasks()
  const task = tasks.find((candidate) => candidate.id === id)
  if (!task) return false

  saveTasks(tasks.filter((candidate) => candidate.id !== id))
  if (deleteFolder) {
    const root = path.resolve(agendaTasksRoot())
    const target = path.resolve(task.folder)
    // Never delete outside the Agenda folder, even if tasks.json was edited by hand.
    if (!target.startsWith(`${root}${path.sep}`)) {
      console.warn('[agenda] refused to delete a folder outside the Agenda root:', target)
      return true
    }
    try {
      fs.rmSync(target, { recursive: true, force: true })
    } catch (error) {
      console.warn('[agenda] could not delete the task folder:', error)
    }
  }
  return true
}

/** Human description of a cadence, used in prompts and the UI. */
export function describeCadence(intervalMinutes: number | null): string {
  return describeAgendaCadence(intervalMinutes)
}

/** Appends a line to the task folder run log. Used by the scheduler and the executor. */
export function appendRunLog(task: AgendaTask, line: string): void {
  try {
    fs.mkdirSync(path.join(task.folder, '.agenda'), { recursive: true })
    fs.appendFileSync(
      path.join(task.folder, '.agenda', 'runs.log'),
      `${new Date().toISOString()} ${line}\n`,
      'utf8'
    )
  } catch (error) {
    console.warn('[agenda] could not append to the run log:', error)
  }
}
