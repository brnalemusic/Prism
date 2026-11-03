import { randomInt } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { CONFIG_DIR } from '../config'
import { AGENDA_MAIN_AGENT_ID, isAgendaScheduleId } from '../../shared/agendaTypes'
import type { AgendaRunRecord, AgendaTask } from '../../shared/agendaTypes'
import { ensureAgents } from './agents'
import { loadTasks, saveTasks } from './tasks'

function runsDir(): string {
  return path.join(CONFIG_DIR, 'agenda', 'runs')
}

function readJson<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * Migrates the legacy Agenda store in place:
 *
 * - Every schedule gets a unique 12-digit id, and run records are remapped.
 * - Legacy schedules are assigned to the main agent.
 * - Run records gain the snapshots the detail view needs.
 * - One-shot schedules that already ran are marked completed.
 *
 * The migration is idempotent and runs before the scheduler starts.
 */
export function migrateAgendaData(): void {
  ensureAgents()
  const tasks = loadTasks()
  if (tasks.length === 0 && !fs.existsSync(runsDir())) return

  const taken = new Set(tasks.filter((task) => isAgendaScheduleId(task.id)).map((task) => task.id))
  const remap = new Map<string, string>()
  let tasksChanged = false

  for (const task of tasks) {
    if (!isAgendaScheduleId(task.id)) {
      const previous = task.id
      let next = ''
      for (let attempt = 0; attempt < 10_000; attempt += 1) {
        const candidate = String(randomInt(100_000_000_000, 1_000_000_000_000))
        if (!taken.has(candidate)) {
          next = candidate
          break
        }
      }
      if (!next) {
        console.warn('[agenda] could not allocate a new schedule id for', previous)
        continue
      }
      taken.add(next)
      remap.set(previous, next)
      task.id = next
      tasksChanged = true
    }

    if (task.agentId !== AGENDA_MAIN_AGENT_ID) {
      // Legacy records had no agent; all of them belong to the main agent.
      if (!task.agentId || task.agentId === 'legacy') {
        task.agentId = AGENDA_MAIN_AGENT_ID
        tasksChanged = true
      }
    }

    if (task.intervalMinutes === null && task.status === 'paused' && task.lastRunAt !== null) {
      task.status = 'completed'
      task.nextRunAt = null
      tasksChanged = true
    }

    // Keep the folder manifest in sync with the numeric id.
    try {
      const manifestPath = path.join(task.folder, '.agenda', 'manifest.json')
      const manifest = readJson<Record<string, unknown>>(manifestPath)
      if (manifest && manifest.id !== task.id) {
        writeJson(manifestPath, { ...manifest, id: task.id })
      }
    } catch {
      /* A missing folder is not fatal; the next run recreates it. */
    }
  }

  if (tasksChanged) saveTasks(tasks)

  const dir = runsDir()
  if (!fs.existsSync(dir)) return
  const byId = new Map(tasks.map((task) => [task.id, task]))
  for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith('.json'))) {
    const file = path.join(dir, name)
    const raw = readJson<Record<string, unknown>>(file)
    if (!raw) continue
    const previousTaskId = typeof raw.taskId === 'string' ? raw.taskId : ''
    const taskId = remap.get(previousTaskId) ?? previousTaskId
    const task: AgendaTask | undefined = byId.get(taskId)
    if (!task) continue

    const next: AgendaRunRecord = {
      id: typeof raw.id === 'string' ? raw.id : path.basename(name, '.json'),
      taskId,
      agentId:
        typeof raw.agentId === 'string' && raw.agentId ? raw.agentId : task.agentId,
      taskTitle:
        typeof raw.taskTitle === 'string' && raw.taskTitle ? raw.taskTitle : task.title,
      prompt:
        typeof raw.prompt === 'string' && raw.prompt ? raw.prompt : task.prompt || task.title,
      instructions:
        typeof raw.instructions === 'string' ? raw.instructions : task.instructions,
      trigger:
        raw.trigger === 'manual' || raw.trigger === 'agent' ? raw.trigger : 'scheduled',
      status:
        typeof raw.status === 'string'
          ? (raw.status as AgendaRunRecord['status'])
          : 'interrupted',
      startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : Date.now(),
      finishedAt: typeof raw.finishedAt === 'number' ? raw.finishedAt : null,
      summary: typeof raw.summary === 'string' ? raw.summary : null,
      error: typeof raw.error === 'string' ? raw.error : null,
      catchUp: raw.catchUp === true,
      permissionPrompts:
        typeof raw.permissionPrompts === 'number' ? raw.permissionPrompts : 0,
      modelKey:
        typeof raw.modelKey === 'string' && raw.modelKey ? raw.modelKey : task.modelKey
    }
    if (
      next.taskId !== raw.taskId ||
      next.agentId !== raw.agentId ||
      next.taskTitle !== raw.taskTitle ||
      next.prompt !== raw.prompt ||
      next.instructions !== raw.instructions ||
      next.trigger !== raw.trigger
    ) {
      writeJson(file, next)
    }
  }

  console.log(
    `[agenda] migration complete: ${tasks.length} schedules, ${remap.size} ids remapped`
  )
}
