import type { ChatMessage, ChatSession } from '../domain/types'
import { readJson, removeKey, writeJson } from './preferences'

const INDEX_KEY = 'prism.mobile.sessions.v1.index'
const messagesKey = (sessionId: string): string => `prism.mobile.sessions.v1.messages.${sessionId}`

export const MAX_STORED_SESSIONS = 120

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function sanitizeSession(value: unknown): ChatSession | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !value.id) return null
  return {
    id: value.id,
    title: typeof value.title === 'string' && value.title ? value.title : 'New session',
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    providerId: typeof value.providerId === 'string' ? value.providerId : '',
    modelId: typeof value.modelId === 'string' ? value.modelId : '',
    messageCount: typeof value.messageCount === 'number' ? value.messageCount : 0,
    preview: typeof value.preview === 'string' ? value.preview : ''
  }
}

function sanitizeMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !value.id) return null
  const role = value.role === 'assistant' ? 'assistant' : value.role === 'user' ? 'user' : null
  if (!role) return null
  const status =
    value.status === 'streaming' ||
    value.status === 'complete' ||
    value.status === 'error' ||
    value.status === 'stopped'
      ? value.status
      : 'complete'
  return {
    id: value.id,
    role,
    content: typeof value.content === 'string' ? value.content : '',
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    status: status === 'streaming' ? 'stopped' : status,
    providerId: typeof value.providerId === 'string' ? value.providerId : undefined,
    modelId: typeof value.modelId === 'string' ? value.modelId : undefined,
    error: typeof value.error === 'string' ? value.error : undefined,
    durationMs: typeof value.durationMs === 'number' ? value.durationMs : undefined
  }
}

export async function readSessionIndex(): Promise<ChatSession[]> {
  const raw = await readJson<unknown>(INDEX_KEY, [])
  if (!Array.isArray(raw)) return []
  return raw
    .map(sanitizeSession)
    .filter((session): session is ChatSession => session !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_STORED_SESSIONS)
}

export async function writeSessionIndex(sessions: ChatSession[]): Promise<void> {
  await writeJson(INDEX_KEY, sessions.slice(0, MAX_STORED_SESSIONS))
}

export async function readSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const raw = await readJson<unknown>(messagesKey(sessionId), [])
  if (!Array.isArray(raw)) return []
  return raw.map(sanitizeMessage).filter((message): message is ChatMessage => message !== null)
}

export async function writeSessionMessages(
  sessionId: string,
  messages: ChatMessage[]
): Promise<void> {
  await writeJson(messagesKey(sessionId), messages)
}

export async function removeSessionMessages(sessionId: string): Promise<void> {
  await removeKey(messagesKey(sessionId))
}
