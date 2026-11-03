import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { CONFIG_DIR } from '../config'
import type { AgendaAgent } from '../../shared/agendaTypes'
import { AGENDA_MAIN_AGENT_ID, AGENDA_MAIN_AGENT_TITLE } from '../../shared/agendaTypes'

function agendaDir(): string {
  return path.join(CONFIG_DIR, 'agenda')
}

function agentsFile(): string {
  return path.join(agendaDir(), 'agents.json')
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

function normalizeTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 80) : ''
}

/** Chat session id that stores the agent's persistent conversation. */
export function agentChatId(agentId: string): string {
  return `agenda-agent-${agentId}`
}

function normalizeAgent(value: unknown, now: number): AgendaAgent | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!id) return null
  const isMain = id === AGENDA_MAIN_AGENT_ID || record.isMain === true
  const title = normalizeTitle(record.title) || (isMain ? AGENDA_MAIN_AGENT_TITLE : 'Agenda agent')
  return {
    id,
    title,
    isMain,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : now
  }
}

/**
 * Loads every agent, always guaranteeing that the main agent exists and is
 * first. This is the only entry point so the invariant cannot drift.
 */
export function loadAgents(): AgendaAgent[] {
  const now = Date.now()
  const raw = readJsonFile<unknown[]>(agentsFile(), [])
  const agents: AgendaAgent[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(raw) ? raw : []) {
    const agent = normalizeAgent(entry, now)
    if (!agent || seen.has(agent.id)) continue
    seen.add(agent.id)
    agents.push(agent)
  }

  const main = agents.find((agent) => agent.isMain)
  if (!main) {
    agents.unshift({
      id: AGENDA_MAIN_AGENT_ID,
      title: AGENDA_MAIN_AGENT_TITLE,
      isMain: true,
      createdAt: now,
      updatedAt: now
    })
  } else if (main.id !== AGENDA_MAIN_AGENT_ID) {
    // A hand-edited file must not lose the stable main id.
    main.id = AGENDA_MAIN_AGENT_ID
    main.isMain = true
  }
  return agents.sort((left, right) => {
    if (left.isMain) return -1
    if (right.isMain) return 1
    return left.createdAt - right.createdAt
  })
}

export function saveAgents(agents: AgendaAgent[]): void {
  writeJsonAtomic(agentsFile(), agents)
}

export function getAgent(id: string): AgendaAgent | null {
  return loadAgents().find((agent) => agent.id === id) ?? null
}

export function createAgent(title?: string): AgendaAgent {
  const now = Date.now()
  const agent: AgendaAgent = {
    id: randomUUID(),
    title: normalizeTitle(title) || 'New Agenda agent',
    isMain: false,
    createdAt: now,
    updatedAt: now
  }
  const agents = loadAgents()
  agents.push(agent)
  saveAgents(agents)
  return agent
}

export function renameAgent(id: string, title: string): AgendaAgent | null {
  const agents = loadAgents()
  const agent = agents.find((candidate) => candidate.id === id)
  if (!agent) return null
  const nextTitle = normalizeTitle(title)
  if (!nextTitle) return null
  agent.title = nextTitle
  agent.updatedAt = Date.now()
  saveAgents(agents)
  return agent
}

/** Derives a short agent title from the first user message. */
export function titleFromMessage(message: string): string {
  const cleaned = message
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'Agenda agent'
  const sentence = cleaned.split(/(?<=[.!?])\s/)[0] || cleaned
  const title = sentence.length > 48 ? `${sentence.slice(0, 47).trimEnd()}…` : sentence
  return title || 'Agenda agent'
}

/**
 * Applies the first-message title to an agent that still has its placeholder
 * name. Explicit renames are never overwritten.
 */
export function applyFirstMessageTitle(id: string, message: string): AgendaAgent | null {
  const agents = loadAgents()
  const agent = agents.find((candidate) => candidate.id === id)
  if (!agent || agent.isMain) return null
  if (agent.title !== 'New Agenda agent' && agent.title !== 'Agenda agent') return null
  agent.title = titleFromMessage(message)
  agent.updatedAt = Date.now()
  saveAgents(agents)
  return agent
}

/** Removes only the agent record; callers own schedules, runs and chat cleanup. */
export function removeAgentRecord(id: string): boolean {
  const agents = loadAgents()
  const agent = agents.find((candidate) => candidate.id === id)
  if (!agent || agent.isMain) return false
  saveAgents(agents.filter((candidate) => candidate.id !== id))
  return true
}

/** Ensures the main agent exists during startup and after migrations. */
export function ensureAgents(): AgendaAgent[] {
  const agents = loadAgents()
  if (!fs.existsSync(agentsFile())) saveAgents(agents)
  return agents
}
