import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { CONFIG_DIR } from '../config'
import { describeAgendaCadence } from '../../shared/agendaTypes'
import type { AgendaAnchor, AgendaTask, AgendaTaskStatus } from '../../shared/agendaTypes'
import { computeNextRunAt, normalizeIntervalMinutes } from './cadence'

export {
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  computeNextRunAt,
  normalizeIntervalMinutes
} from './cadence'

export interface CreateAgendaTaskInput {
  title: string
  instructions: string
  intervalMinutes: number | null
  anchor: AgendaAnchor | null
  mcpServerIds?: string[]
  modelKey?: string | null
  /** Explicit first run. Defaults to now for one-shot tasks and now + interval otherwise. */
  firstRunAt?: number | null
}

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

export function loadTasks(): AgendaTask[] {
  const tasks = readJsonFile<AgendaTask[]>(tasksFile(), [])
  return Array.isArray(tasks) ? tasks : []
}

export function saveTasks(tasks: AgendaTask[]): void {
  writeJsonAtomic(tasksFile(), tasks)
}

export function getTask(id: string): AgendaTask | null {
  return loadTasks().find((task) => task.id === id) ?? null
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
  const id = randomUUID()
  const title = input.title.trim() || 'Untitled task'
  const folder = path.join(agendaTasksRoot(), `${slugify(title)}-${id.slice(0, 8)}`)
  ensureTaskFolder(folder, title, id)

  const intervalMinutes = normalizeIntervalMinutes(input.intervalMinutes)
  const task: AgendaTask = {
    id,
    title,
    instructions: input.instructions.trim(),
    folder,
    status: 'active',
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

  task.nextRunAt =
    input.firstRunAt ??
    (intervalMinutes === null
      ? now
      : computeNextRunAt({ intervalMinutes, anchor: input.anchor, nextRunAt: null }, now))

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
      : { modelKey: patch.modelKey?.trim() || null })
  }
  const next: AgendaTask = {
    ...current,
    ...normalizedPatch,
    id: current.id,
    folder: current.folder,
    createdAt: current.createdAt,
    updatedAt: Date.now()
  }

  // Any real schedule change recomputes the next run from the new definition.
  // A resume after a pause has no previous anchor, so it starts from now.
  const intervalChanged =
    normalizedPatch.intervalMinutes !== undefined &&
    normalizedPatch.intervalMinutes !== current.intervalMinutes
  const anchorChanged =
    normalizedPatch.anchor !== undefined &&
    JSON.stringify(normalizedPatch.anchor) !== JSON.stringify(current.anchor)
  const scheduleChanged = intervalChanged || anchorChanged
  if (scheduleChanged && next.status === 'active') {
    next.nextRunAt =
      next.intervalMinutes === null
        ? Date.now()
        : computeNextRunAt({ ...next, nextRunAt: null }, Date.now())
  } else if (
    normalizedPatch.status === 'active' &&
    current.status === 'paused' &&
    next.nextRunAt === null &&
    normalizedPatch.nextRunAt === undefined
  ) {
    next.nextRunAt = next.intervalMinutes === null ? Date.now() : computeNextRunAt(next, Date.now())
  }
  if (next.status === 'paused') next.nextRunAt = null

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
