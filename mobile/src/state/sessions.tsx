import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { isAbortError, streamChat } from '../ai/client'
import { trimTurns } from '../ai/persona'
import { AiRequestError } from '../ai/request'
import type { ChatMessage, ChatSession, ChatTurn, ProviderProfile } from '../domain/types'
import { createId } from '../lib/id'
import { deriveTitle, previewText } from '../lib/text'
import { readApiKey } from '../storage/secrets'
import {
  MAX_STORED_SESSIONS,
  readSessionIndex,
  readSessionMessages,
  removeSessionMessages,
  writeSessionIndex,
  writeSessionMessages
} from '../storage/sessions'
import { useSettings } from './settings'

interface StreamTarget {
  sessionId: string
  messageId: string
}

interface SessionsContextValue {
  ready: boolean
  sessions: ChatSession[]
  streaming: StreamTarget | null
  getMessages: (sessionId: string) => ChatMessage[] | undefined
  ensureLoaded: (sessionId: string) => Promise<void>
  createSession: (options?: {
    providerId?: string | null
    modelId?: string | null
    title?: string
  }) => Promise<ChatSession | null>
  sendMessage: (sessionId: string, text: string) => Promise<void>
  retryLast: (sessionId: string) => Promise<void>
  stopStreaming: () => void
  renameSession: (sessionId: string, title: string) => void
  deleteSession: (sessionId: string) => Promise<void>
  clearHistory: () => Promise<void>
  setSessionModel: (sessionId: string, providerId: string, modelId: string) => void
}

const SessionsContext = createContext<SessionsContextValue | null>(null)

const sortSessions = (sessions: ChatSession[]): ChatSession[] =>
  [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

function toTurns(messages: ChatMessage[]): ChatTurn[] {
  const usable = messages
    .filter((message) => message.content.trim().length > 0 && message.status !== 'error')
    .map((message) => ({ role: message.role, content: message.content }))
  const trimmed = trimTurns(usable)
  let start = 0
  while (start < trimmed.length && trimmed[start]?.role === 'assistant') start += 1
  return trimmed.slice(start)
}

function describeError(error: unknown): string {
  if (error instanceof AiRequestError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong while talking to the model.'
}

export function SessionsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { providers, defaultProviderId, defaultModelId } = useSettings()

  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({})
  const [streaming, setStreaming] = useState<StreamTarget | null>(null)
  const [ready, setReady] = useState(false)

  const sessionsRef = useRef<ChatSession[]>([])
  const messagesRef = useRef<Record<string, ChatMessage[]>>({})
  const streamingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const providersRef = useRef<ProviderProfile[]>(providers)

  useEffect(() => {
    providersRef.current = providers
  }, [providers])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const index = await readSessionIndex()
      if (cancelled) return
      sessionsRef.current = index
      setSessions(index)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const applySessions = useCallback((next: ChatSession[]) => {
    const sorted = sortSessions(next)
    sessionsRef.current = sorted
    setSessions(sorted)
    void writeSessionIndex(sorted)
  }, [])

  const setMessagesFor = useCallback((sessionId: string, list: ChatMessage[]) => {
    const next = { ...messagesRef.current, [sessionId]: list }
    messagesRef.current = next
    setMessages(next)
  }, [])

  const patchAssistant = useCallback(
    (sessionId: string, messageId: string, patch: Partial<ChatMessage>) => {
      const list = messagesRef.current[sessionId]
      if (!list) return
      const next = list.map((message) =>
        message.id === messageId ? { ...message, ...patch } : message
      )
      setMessagesFor(sessionId, next)
    },
    [setMessagesFor]
  )

  const appendAssistantDelta = useCallback(
    (sessionId: string, messageId: string, delta: string) => {
      const list = messagesRef.current[sessionId]
      if (!list) return
      const index = list.findIndex((message) => message.id === messageId)
      if (index === -1) return
      const current = list[index]
      if (!current) return
      const next = list.slice()
      next[index] = { ...current, content: current.content + delta }
      setMessagesFor(sessionId, next)
    },
    [setMessagesFor]
  )

  const ensureLoaded = useCallback(
    async (sessionId: string) => {
      if (messagesRef.current[sessionId]) return
      const stored = await readSessionMessages(sessionId)
      if (messagesRef.current[sessionId]) return
      setMessagesFor(sessionId, stored)
    },
    [setMessagesFor]
  )

  const createSession = useCallback<SessionsContextValue['createSession']>(
    async (options) => {
      const list = providersRef.current
      if (list.length === 0) return null
      const provider =
        list.find((candidate) => candidate.id === options?.providerId) ??
        list.find((candidate) => candidate.id === defaultProviderId) ??
        list[0]
      if (!provider) return null
      const modelId =
        provider.models.find((model) => model.id === options?.modelId)?.id ??
        (provider.id === defaultProviderId && defaultModelId
          ? provider.models.find((model) => model.id === defaultModelId)?.id
          : undefined) ??
        provider.models[0]?.id
      if (!modelId) return null

      const now = Date.now()
      const session: ChatSession = {
        id: createId('chat'),
        title: options?.title?.trim() || 'New session',
        createdAt: now,
        updatedAt: now,
        providerId: provider.id,
        modelId,
        messageCount: 0,
        preview: ''
      }

      const overflow = sessionsRef.current.slice(MAX_STORED_SESSIONS - 1)
      if (overflow.length > 0) {
        void Promise.all(overflow.map((old) => removeSessionMessages(old.id)))
      }
      applySessions([session, ...sessionsRef.current.slice(0, MAX_STORED_SESSIONS - 1)])
      setMessagesFor(session.id, [])
      void writeSessionMessages(session.id, [])
      return session
    },
    [applySessions, defaultModelId, defaultProviderId, setMessagesFor]
  )

  const sendMessage = useCallback<SessionsContextValue['sendMessage']>(
    async (sessionId, rawText) => {
      const text = rawText.trim()
      if (!text || streamingRef.current) return

      const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
      if (!session) return

      const provider =
        providersRef.current.find((candidate) => candidate.id === session.providerId) ??
        providersRef.current[0]
      if (!provider) return

      const modelId =
        provider.models.find((model) => model.id === session.modelId)?.id ??
        provider.models[0]?.id ??
        ''

      await ensureLoaded(sessionId)
      const history = messagesRef.current[sessionId] ?? []

      const now = Date.now()
      const userMessage: ChatMessage = {
        id: createId('msg'),
        role: 'user',
        content: text,
        createdAt: now,
        status: 'complete'
      }
      const assistantId = createId('msg')
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: now + 1,
        status: 'streaming',
        providerId: provider.id,
        modelId
      }

      const working = [...history, userMessage, assistantMessage]
      setMessagesFor(sessionId, working)

      const shouldTitle = history.length === 0
      const title = shouldTitle ? deriveTitle(text) : session.title
      applySessions(
        sessionsRef.current.map((candidate) =>
          candidate.id === sessionId
            ? {
                ...candidate,
                title,
                providerId: provider.id,
                modelId,
                updatedAt: now,
                messageCount: working.length,
                preview: previewText(text)
              }
            : candidate
        )
      )

      abortRef.current = new AbortController()
      streamingRef.current = true
      setStreaming({ sessionId, messageId: assistantId })

      const startedAt = Date.now()
      let pending = ''
      let flushTimer: ReturnType<typeof setTimeout> | null = null
      const flush = (): void => {
        flushTimer = null
        if (!pending) return
        const chunk = pending
        pending = ''
        appendAssistantDelta(sessionId, assistantId, chunk)
      }
      const queue = (delta: string): void => {
        pending += delta
        if (flushTimer === null) flushTimer = setTimeout(flush, 24)
      }

      const finish = async (patch: Partial<ChatMessage>): Promise<void> => {
        if (flushTimer !== null) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        flush()
        patchAssistant(sessionId, assistantId, { durationMs: Date.now() - startedAt, ...patch })

        const finalMessages = messagesRef.current[sessionId] ?? []
        await writeSessionMessages(sessionId, finalMessages)
        const finalAssistant = finalMessages.find((message) => message.id === assistantId)
        const updatedAt = Date.now()
        applySessions(
          sessionsRef.current.map((candidate) =>
            candidate.id === sessionId
              ? {
                  ...candidate,
                  updatedAt,
                  messageCount: finalMessages.length,
                  preview:
                    finalAssistant?.status === 'error'
                      ? (finalAssistant.error ?? 'Request failed')
                      : previewText(finalAssistant?.content || text)
                }
              : candidate
          )
        )
        streamingRef.current = false
        abortRef.current = null
        setStreaming(null)
      }

      try {
        const apiKey = await readApiKey(provider.id)
        const turns = [...toTurns(history), { role: 'user' as const, content: text }]
        await streamChat({
          provider,
          modelId,
          apiKey,
          turns,
          signal: abortRef.current.signal,
          onDelta: queue
        })
        await finish({ status: 'complete' })
      } catch (error) {
        if (isAbortError(error) || abortRef.current?.signal.aborted) {
          await finish({ status: 'stopped' })
          return
        }
        await finish({ status: 'error', error: describeError(error) })
      }
    },
    [appendAssistantDelta, applySessions, ensureLoaded, patchAssistant, setMessagesFor]
  )

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const retryLast = useCallback(
    async (sessionId: string) => {
      if (streamingRef.current) return
      const list = await (async () => {
        await ensureLoaded(sessionId)
        return messagesRef.current[sessionId] ?? []
      })()
      let userIndex = -1
      for (let index = list.length - 1; index >= 0; index -= 1) {
        if (list[index]?.role === 'user') {
          userIndex = index
          break
        }
      }
      if (userIndex === -1) return
      const text = list[userIndex]?.content ?? ''
      const kept = list.slice(0, userIndex)
      setMessagesFor(sessionId, kept)
      await writeSessionMessages(sessionId, kept)
      await sendMessage(sessionId, text)
    },
    [ensureLoaded, sendMessage, setMessagesFor]
  )

  const renameSession = useCallback(
    (sessionId: string, title: string) => {
      const nextTitle = title.trim().slice(0, 80)
      if (!nextTitle) return
      applySessions(
        sessionsRef.current.map((session) =>
          session.id === sessionId ? { ...session, title: nextTitle } : session
        )
      )
    },
    [applySessions]
  )

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (streamingRef.current && streaming?.sessionId === sessionId) {
        abortRef.current?.abort()
      }
      applySessions(sessionsRef.current.filter((session) => session.id !== sessionId))
      const nextMessages = { ...messagesRef.current }
      delete nextMessages[sessionId]
      messagesRef.current = nextMessages
      setMessages(nextMessages)
      await removeSessionMessages(sessionId)
    },
    [applySessions, streaming]
  )

  const clearHistory = useCallback(async () => {
    abortRef.current?.abort()
    const ids = sessionsRef.current.map((session) => session.id)
    applySessions([])
    messagesRef.current = {}
    setMessages({})
    await Promise.all(ids.map((id) => removeSessionMessages(id)))
  }, [applySessions])

  const setSessionModel = useCallback(
    (sessionId: string, providerId: string, modelId: string) => {
      applySessions(
        sessionsRef.current.map((session) =>
          session.id === sessionId ? { ...session, providerId, modelId } : session
        )
      )
    },
    [applySessions]
  )

  const value = useMemo<SessionsContextValue>(
    () => ({
      ready,
      sessions,
      streaming,
      getMessages: (sessionId: string) => messages[sessionId],
      ensureLoaded,
      createSession,
      sendMessage,
      retryLast,
      stopStreaming,
      renameSession,
      deleteSession,
      clearHistory,
      setSessionModel
    }),
    [
      ready,
      sessions,
      streaming,
      messages,
      ensureLoaded,
      createSession,
      sendMessage,
      retryLast,
      stopStreaming,
      renameSession,
      deleteSession,
      clearHistory,
      setSessionModel
    ]
  )

  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>
}

export function useSessions(): SessionsContextValue {
  const context = useContext(SessionsContext)
  if (!context) throw new Error('useSessions must be used inside SessionsProvider')
  return context
}
