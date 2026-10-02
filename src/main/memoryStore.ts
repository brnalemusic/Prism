/**
 * Memory store (M2): local JSON persistence + incremental extraction triggers.
 * Deliberately Electron-free (dirs are injected) so unit tests and headless
 * catch-up scripts can run the exact same code over real data.
 */
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  DEFAULT_MEMORY_CONFIG,
  MEMORY_GENERAL_BUDGET,
  MEMORY_PROFILE_BUDGET,
  MEMORY_TOOL_ENTRY_CAP,
  buildTurnRecallBlock,
  foldAccents,
  isCredentialLike,
  keywordize,
  memoryStoreForKind,
  normalizeMemoryConfig,
  runExtraction,
  shouldArchiveEntry,
  slugifyKey,
  summarizeMemories
} from '../shared/memoryCore.ts'
import type {
  ForgetOp,
  MemoryBlockOptions,
  MemoryConfig,
  MemoryEntry,
  MemoryEventType,
  MemoryKind,
  MemoryListOptions,
  MemoryPatch,
  MemoryReviewDecision,
  MemoryStats,
  MemoryStoreEvent,
  MemoryTier,
  MemoryToolCall,
  MemoryToolResult,
  MemoryWrite
} from '../shared/memoryCore.ts'
import { sanitizeMemoryReviewText } from '../shared/memoryReview.ts'
import type {
  MemoryReviewApplyResult,
  MemoryReviewBatch
} from '../shared/memoryReview.ts'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Same root Prism uses for chats/config (LOCALAPPDATA first, like config.ts). */
export function defaultPrismDataDir(): string {
  return (
    process.env.LOCALAPPDATA ||
    path.join(os.homedir(), 'AppData', 'Local')
  )
}

const safeJsonParse = <T>(content: string, fallback: T): T => {
  try {
    const parsed = JSON.parse(content) as T
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Store data shapes
// ---------------------------------------------------------------------------

interface MemoryStoreData {
  memories: MemoryEntry[]
}

interface MemoryMetaData {
  watermarks: Record<string, number>
  reviewWatermarks: Record<string, number>
  reviewInitializedAt?: number
  /** Bumps when the review bootstrap policy changes for existing history. */
  reviewBaselineVersion?: number
  lastReviewedAt?: number
  lastReviewSavedCount?: number
  lastMaintenance?: number
}

export interface CatchUpReport {
  chatsScanned: number
  chatsProcessed: number
  commits: number
  suggestions: number
  forgets: number
  archived: number
  errors: number
}

export interface MemoryServiceOptions {
  chatsDir: string
  memoryDir: string
  config?: MemoryConfig
  now?: () => number
  notify?: (event: MemoryStoreEvent) => void
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface MemoryService {
  list(options?: MemoryListOptions): MemoryEntry[]
  getById(id: string): MemoryEntry | undefined
  update(id: string, patch: MemoryPatch): MemoryEntry | null
  archive(id: string): boolean
  restore(id: string): boolean
  remove(id: string): boolean
  stats(): MemoryStats
  updateConfig(config: MemoryConfig): void
  observeCompletedTurn(chatId: string): void
  startupCatchUp(): CatchUpReport
  runMaintenance(): number
  memoryTool(call: MemoryToolCall, chatId?: string): MemoryToolResult
  initializeReviewCheckpoints(): void
  getReviewBatches(): MemoryReviewBatch[]
  applyReviewDecisions(batch: MemoryReviewBatch, decisions: MemoryReviewDecision[]): MemoryReviewApplyResult
  recordReviewSummary(saved: number): void
  getReviewSummary(): { lastReviewedAt?: number; lastSavedCount: number }
}

let activeMemoryService: MemoryService | null = null

/**
 * Module-level handle to the last-created service so non-IPC callers
 * (chatHandler, prompt builders) can reach the store without import cycles.
 */
export function getActiveMemoryService(): MemoryService | null {
  return activeMemoryService
}

/**
 * Appends the per-turn recall block to a prompt string (no-op when the store
 * is not up, nothing matches, or the block would exceed budgets). Shared by the
 * Chat and Discord text surfaces; live voice passes its own smaller budget.
 */
export function appendTurnRecallBlock(
  prompt: string,
  query: string | undefined,
  opts: MemoryBlockOptions = {}
): string {
  const service = activeMemoryService
  if (!service) return prompt
  try {
    const block = buildTurnRecallBlock(service.list(), query, Date.now(), opts)
    return block ? `${prompt}\n\n${block}` : prompt
  } catch (err) {
    console.error('[Memory] Recall injection failed:', err)
    return prompt
  }
}
/** Thin executor adapter: systemTools `case 'memory'` -> store service. */
export function executeMemoryTool(args: Record<string, unknown>, chatId?: string): string {
  const action = String(args.action ?? '')
  const target = String(args.target ?? '')
  if (!['add', 'replace', 'remove'].includes(action)) {
    return JSON.stringify({ ok: false, message: 'Error: unknown action "' + action + '". Use add, replace or remove.', usage: '' } satisfies MemoryToolResult)
  }
  if (!['user', 'memory'].includes(target)) {
    return JSON.stringify({ ok: false, message: 'Error: unknown target "' + target + '". Use "user" (profile facts) or "memory" (general facts).', usage: '' } satisfies MemoryToolResult)
  }
  const service = activeMemoryService
  if (!service) {
    return JSON.stringify({ ok: false, message: 'Error: memory store is not available yet.', usage: '' } satisfies MemoryToolResult)
  }
  const result = service.memoryTool(
    {
      action: action as MemoryToolCall['action'],
      target: target as MemoryToolCall['target'],
      kind: typeof args.kind === 'string' ? args.kind as MemoryKind : undefined,
      content: typeof args.content === 'string' ? args.content : undefined,
      old_text: typeof args.old_text === 'string' ? args.old_text : undefined
    },
    chatId ?? 'tool'
  )
  return JSON.stringify(result)
}


export function createMemoryService(options: MemoryServiceOptions): MemoryService {
  const chatsDir = options.chatsDir
  const memoryDir = options.memoryDir
  let config = normalizeMemoryConfig(options.config ?? DEFAULT_MEMORY_CONFIG)
  const now = options.now ?? (() => Date.now())
  const notify = options.notify ?? (() => {})

  const memoriesPath = path.join(memoryDir, 'memories.json')
  const metaPath = path.join(memoryDir, 'meta.json')
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const ensureDirs = (): void => {
    fs.mkdirSync(memoryDir, { recursive: true })
  }

  const persistStorePayload = (data: MemoryStoreData): boolean => {
    ensureDirs()
    try {
      const payload = JSON.stringify(data, null, 2)
      const tmpPath = `${memoriesPath}.tmp`
      fs.writeFileSync(tmpPath, payload)
      fs.renameSync(tmpPath, memoriesPath)
      return true
    } catch (error) {
      console.error('[Memory] Failed to persist memories.json:', error)
      return false
    }
  }

  const readStore = (): MemoryStoreData => {
    ensureDirs()
    if (!fs.existsSync(memoriesPath)) return { memories: [] }
    try {
      const data = safeJsonParse<MemoryStoreData>(fs.readFileSync(memoriesPath, 'utf-8'), {
        memories: []
      })
      const source = Array.isArray(data.memories) ? data.memories : []
      let migrated = false
      const memories = source.map((entry) => {
        if (entry.store === 'user' || entry.store === 'memory') return entry
        migrated = true
        return { ...entry, store: memoryStoreForKind(entry.kind) }
      })
      if (migrated) persistStorePayload({ memories })
      return { memories }
    } catch {
      // Corrupted store: back it up (mirrors config.ts behavior) and start fresh.
      try {
        fs.copyFileSync(memoriesPath, `${memoriesPath}.corrupted.${Date.now()}.bak`)
      } catch {
        /* best effort */
      }
      return { memories: [] }
    }
  }

  const writeStore = (data: MemoryStoreData): boolean => {
    return persistStorePayload(data)
  }

  const readMeta = (): MemoryMetaData => {
    ensureDirs()
    if (!fs.existsSync(metaPath)) return { watermarks: {}, reviewWatermarks: {} }
    const parsed = safeJsonParse<Partial<MemoryMetaData>>(fs.readFileSync(metaPath, 'utf-8'), {})
    return {
      ...parsed,
      watermarks: parsed.watermarks ?? {},
      reviewWatermarks: parsed.reviewWatermarks ?? {}
    }
  }

  const writeMeta = (meta: MemoryMetaData): boolean => {
    ensureDirs()
    try {
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
      return true
    } catch (error) {
      console.error('[Memory] Failed to persist meta.json:', error)
      return false
    }
  }

  const emit = (type: MemoryEventType, entries: MemoryEntry[], chatId?: string): void => {
    if (entries.length === 0) return
    notify({ type, entries, chatId })
  }

  // -------------------------------------------------------------------------
  // Message text extraction (mirrors getMessageText for the fields we need)
  // -------------------------------------------------------------------------

  const messageText = (message: { role?: string; content?: unknown }): string => {
    if (message.role !== 'user') return ''
    const content = message.content
    if (typeof content === 'string') return content.trim()
    if (Array.isArray(content)) {
      return content
        .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text ?? '') : ''))
        .join(' ')
        .trim()
    }
    if (content && typeof content === 'object' && 'parts' in content) {
      const parts = (content as { parts?: Array<{ text?: unknown }> }).parts
      return (parts ?? []).map((part) => String(part?.text ?? '')).join(' ').trim()
    }
    return ''
  }

  const listChatFiles = (): string[] => {
    if (!fs.existsSync(chatsDir)) return []
    try {
      return fs
        .readdirSync(chatsDir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => path.join(chatsDir, file))
        .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs)
    } catch {
      return []
    }
  }

  const readChatUserMessages = (
    filePath: string
  ): { chatId: string; texts: string[] } => {
    const data = safeJsonParse<{
      id?: string
      messages?: Array<{ role?: string; content?: unknown }>
    }>(fs.readFileSync(filePath, 'utf-8'), {})
    const messages = Array.isArray(data.messages) ? data.messages : []
    const chatId =
      typeof data.id === 'string' && data.id.trim()
        ? data.id
        : path.basename(filePath, '.json').replace(/^chat_/, '')
    // Watermark counts processed USER messages; roles alternate around them.
    const texts = messages.map(messageText).filter(Boolean)
    return { chatId, texts }
  }

  const reviewContentText = (message: Record<string, unknown>): string => {
    const fragments: string[] = []
    const content = message.content
    if (typeof content === 'string') fragments.push(content)
    else if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === 'object' && 'text' in part) {
          fragments.push(String((part as { text?: unknown }).text ?? ''))
        }
      }
    }

    if (Array.isArray(message.parts)) {
      for (const part of message.parts) {
        if (!part || typeof part !== 'object') continue
        const record = part as Record<string, unknown>
        if (typeof record.text === 'string') fragments.push(record.text)
        const functionCall = record.functionCall as { name?: unknown } | undefined
        if (functionCall?.name) fragments.push(`[Tool requested: ${String(functionCall.name)}]`)
        const functionResponse = record.functionResponse as { name?: unknown; response?: unknown } | undefined
        if (functionResponse?.name) {
          const response = functionResponse.response
          const summary = response == null
            ? ''
            : typeof response === 'string'
              ? response
              : JSON.stringify(response)
          fragments.push(`[Tool result: ${String(functionResponse.name)}] ${summary}`)
        }
      }
    }

    if (Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        const name = call && typeof call === 'object'
          ? (call as { function?: { name?: unknown } }).function?.name
          : undefined
        if (name) fragments.push(`[Tool requested: ${String(name)}]`)
      }
    }

    const metadata = message.tool_metadata as { result?: unknown } | undefined
    if (metadata?.result) {
      const result = typeof metadata.result === 'string'
        ? metadata.result
        : JSON.stringify(metadata.result)
      fragments.push(`[Tool metadata] ${result}`)
    }
    return sanitizeMemoryReviewText(fragments.filter(Boolean).join('\n'))
  }

  const readChatReviewBatch = (
    filePath: string,
    fromMessageIndex: number
  ): MemoryReviewBatch | null => {
    const data = safeJsonParse<{
      id?: string
      title?: string
      workspace?: string
      sessionMode?: string
      messages?: Array<Record<string, unknown>>
    }>(fs.readFileSync(filePath, 'utf-8'), {})
    if (data.workspace === 'harness' || data.sessionMode === 'harness') return null
    const messages = Array.isArray(data.messages) ? data.messages : []
    if (fromMessageIndex >= messages.length) return null

    const chatId = typeof data.id === 'string' && data.id.trim()
      ? data.id
      : path.basename(filePath, '.json').replace(/^chat_/, '')
    const lines: string[] = []
    const userLines: string[] = []
    const assistantLines: string[] = []
    const toolLines: string[] = []
    const userMessageIndexes: number[] = []
    let characters = 0
    let toMessageIndex = fromMessageIndex
    const maximumIndex = Math.min(messages.length, fromMessageIndex + 60)

    for (let index = fromMessageIndex; index < maximumIndex; index += 1) {
      const message = messages[index]
      toMessageIndex = index + 1
      if (message.hidden === true || message.role === 'system') continue
      const text = reviewContentText(message)
      if (!text) continue
      const role = message.role === 'user'
        ? 'User'
        : message.role === 'tool'
          ? `Tool${typeof message.name === 'string' ? ` (${message.name})` : ''}`
          : message.role === 'model' || message.role === 'assistant' || message.role === 'ai'
            ? 'Assistant'
            : 'Untrusted'
      const line = `[message ${index}] ${text}`
      if (characters > 0 && characters + line.length + 2 > 24_000) {
        toMessageIndex = index
        break
      }
      lines.push(line)
      if (role === 'User') {
        userLines.push(line)
        userMessageIndexes.push(index)
      } else if (role === 'Assistant') {
        assistantLines.push(line)
      } else {
        toolLines.push(`${role}: ${line}`)
      }
      characters += line.length + 2
    }

    if (toMessageIndex <= fromMessageIndex) return null
    return {
      chatId,
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'Untitled chat',
      fromMessageIndex,
      toMessageIndex,
      transcript: lines.join('\n\n') || '[No reviewable text in this delta]',
      userTranscript: userLines.join('\n\n'),
      assistantTranscript: assistantLines.join('\n\n'),
      toolTranscript: toolLines.join('\n\n'),
      userMessageIndexes
    }
  }

  // -------------------------------------------------------------------------
  // Write application
  // -------------------------------------------------------------------------

  const applyWrites = (writes: MemoryWrite[], chatId: string): { committed: MemoryEntry[]; suggested: MemoryEntry[] } => {
    const store = readStore()
    const committed: MemoryEntry[] = []
    const suggested: MemoryEntry[] = []
    const nowMs = now()
    const toCreate: MemoryEntry[] = []

    const createFrom = (write: MemoryWrite, supersedesId?: string): MemoryEntry => {
      const created = nowMs
      return {
        id: randomUUID(),
        store: memoryStoreForKind(write.kind),
        kind: write.kind,
        content: write.content,
        factKey: write.factKey,
        polarity: write.polarity,
        confidence: write.confidence,
        tier: (write.confidence >= config.commitThreshold ? 'committed' : 'possible') as MemoryTier,
        sourceChatId: write.sourceChatId || chatId,
        createdAt: created,
        confirmedAt: created,
        lastSeenAt: created,
        lastAccessedAt: created,
        accessCount: 0,
        pinned: false,
        archived: false,
        ...(supersedesId ? { supersedesId } : {}),
        ...(write.expiresAt ? { expiresAt: write.expiresAt } : {}),
        keywords: keywordize(write.content)
      }
    }

    for (const write of writes) {
      if (write.action === 'refresh' && write.id) {
        const target = store.memories.find((memory) => memory.id === write.id && !memory.archived)
        if (!target) continue
        target.confidence = write.confidence
        target.confirmedAt = nowMs
        target.lastSeenAt = nowMs
        if (write.promote || write.confidence >= config.commitThreshold) target.tier = 'committed'
        committed.push(target)
        continue
      }
      if (write.action === 'supersede' && write.supersedesId) {
        const oldEntry = store.memories.find((memory) => memory.id === write.supersedesId)
        const replacement = createFrom(write, write.supersedesId)
        replacement.tier = 'committed'
        store.memories.push(replacement)
        committed.push(replacement)
        if (oldEntry && !oldEntry.archived) {
          oldEntry.archived = true
          oldEntry.supersededById = replacement.id
        }
        continue
      }
      toCreate.push(createFrom(write))
    }

    for (const memory of toCreate) {
      store.memories.push(memory)
      if (memory.tier === 'possible') suggested.push(memory)
      else committed.push(memory)
    }

    if (writes.length > 0) writeStore(store)
    return { committed, suggested }
  }

  const executeForgets = (forgets: ForgetOp[]): number => {
    const store = readStore()
    let archived = 0
    const affected: MemoryEntry[] = []
    for (const op of forgets) {
      if (op.scope === 'unclear') continue
      const candidates = store.memories.filter((memory) => {
        if (memory.archived || memory.pinned) return false
        if (op.scope === 'all') return true
        if (op.factKey) {
          const slug = slugifyKey(memory.content)
          return (
            memory.factKey === op.factKey ||
            slug.includes(op.factKey) ||
            op.factKey.includes(slug) ||
            memory.keywords.some(
              (keyword) => keyword.includes(op.factKey ?? '') || (op.factKey ?? '').includes(keyword)
            )
          )
        }
        return false
      })
      for (const memory of candidates) {
        if (!memory.archived) {
          memory.archived = true
          archived += 1
          affected.push(memory)
        }
      }
    }
    if (archived > 0) {
      writeStore(store)
      emit('forget', affected)
    }
    return archived
  }

  // -------------------------------------------------------------------------
  // Extraction trigger
  // -------------------------------------------------------------------------

  const processChatFile = (filePath: string): { commits: number; suggestions: number; forgets: number; skipped: boolean } => {
    if (!fs.existsSync(filePath)) return { commits: 0, suggestions: 0, forgets: 0, skipped: true }
    if (config.excludeChatIds.some((id) => id && filePath.includes(id))) {
      return { commits: 0, suggestions: 0, forgets: 0, skipped: true }
    }

    const meta = readMeta()
    const processed = readChatUserMessages(filePath)
    const processedUsers = meta.watermarks[processed.chatId] ?? 0
    if (processed.texts.length <= processedUsers) {
      return { commits: 0, suggestions: 0, forgets: 0, skipped: true }
    }
    const newTexts = processed.texts.slice(processedUsers)

    const store = readStore()
    const result = runExtraction(
      {
        newUserMessages: newTexts,
        chatMeta: { chatId: processed.chatId },
        priorMemories: store.memories,
        now: now()
      },
      config
    )

    let commits = 0
    let suggestions = 0
    if (result.commits.length > 0 || result.suggestions.length > 0) {
      const applied = applyWrites([...result.commits, ...result.suggestions], processed.chatId)
      commits = applied.committed.length
      suggestions = applied.suggested.length
      emit('write', applied.committed, processed.chatId)
      emit('suggest', applied.suggested, processed.chatId)
    }
    let forgets = 0
    if (result.forgets.length > 0) {
      forgets = executeForgets(result.forgets)
    }

    meta.watermarks[processed.chatId] = processed.texts.length
    writeMeta(meta)
    return { commits, suggestions, forgets, skipped: false }
  }

  const runCatchUp = (): CatchUpReport => {
    const report: CatchUpReport = {
      chatsScanned: 0,
      chatsProcessed: 0,
      commits: 0,
      suggestions: 0,
      forgets: 0,
      archived: 0,
      errors: 0
    }
    report.chatsScanned = listChatFiles().length
    for (const filePath of listChatFiles()) {
      try {
        const result = processChatFile(filePath)
        if (!result.skipped) {
          report.chatsProcessed += 1
          report.commits += result.commits
          report.suggestions += result.suggestions
          report.forgets += result.forgets
        }
      } catch (error) {
        report.errors += 1
        console.error(`[Memory] Catch-up failed for ${filePath}:`, error)
      }
    }
    report.archived = runMaintenance()
    console.log(
      `[Memory] Catch-up finished: ${report.chatsProcessed}/${report.chatsScanned} chats, ` +
        `${report.commits} committed, ${report.suggestions} suggested, ${report.forgets} forgotten, ${report.archived} archived.`
    )
    return report
  }

  const runMaintenance = (): number => {
    const store = readStore()
    const meta = readMeta()
    const nowMs = now()
    const archived: MemoryEntry[] = []
    for (const memory of store.memories) {
      if (memory.archived) continue
      if (shouldArchiveEntry(memory, nowMs, config.halfLifeDays)) {
        memory.archived = true
        archived.push(memory)
      }
    }
    if (archived.length > 0) {
      writeStore(store)
      emit('archived', archived)
    }
    meta.lastMaintenance = nowMs
    writeMeta(meta)
    return archived.length
  }

  const service: MemoryService = {
    list(options: MemoryListOptions = {}): MemoryEntry[] {
      const store = readStore()
      const query = options.query?.trim().toLowerCase()
      return store.memories
        .filter((memory) => {
          if (!options.includeArchived && memory.archived) return false
          if (options.tier && memory.tier !== options.tier) return false
          if (options.kind && memory.kind !== options.kind) return false
          if (query) {
            const haystack = `${memory.content} ${memory.keywords.join(' ')} ${memory.factKey ?? ''}`.toLowerCase()
            if (!query.split(/\s+/).every((term) => haystack.includes(term))) return false
          }
          return true
        })
        .sort((a, b) => (a.archived === b.archived ? b.createdAt - a.createdAt : a.archived ? 1 : -1))
    },

    getById(id: string): MemoryEntry | undefined {
      return readStore().memories.find((memory) => memory.id === id)
    },

    update(id: string, patch: MemoryPatch): MemoryEntry | null {
      const store = readStore()
      const memory = store.memories.find((entry) => entry.id === id)
      if (!memory) return null
      if (typeof patch.content === 'string' && patch.content.trim()) {
        memory.content = patch.content.trim()
        memory.keywords = keywordize(memory.content)
      }
      if (patch.kind && ['about_user', 'preference', 'fact', 'event', 'project', 'behavioral'].includes(patch.kind)) {
        memory.kind = patch.kind as MemoryKind
        memory.store = memoryStoreForKind(memory.kind)
      }
      if (patch.store === 'user' || patch.store === 'memory') {
        memory.store = patch.store
        if (memoryStoreForKind(memory.kind) !== patch.store) {
          memory.kind = patch.store === 'user' ? 'about_user' : 'fact'
        }
      }
      if (patch.tier && (patch.tier === 'committed' || patch.tier === 'possible')) {
        memory.tier = patch.tier
      }
      if (typeof patch.pinned === 'boolean') memory.pinned = patch.pinned
      writeStore(store)
      return memory
    },

    archive(id: string): boolean {
      const store = readStore()
      const memory = store.memories.find((entry) => entry.id === id && !entry.archived)
      if (!memory) return false
      memory.archived = true
      writeStore(store)
      emit('archived', [memory])
      return true
    },

    restore(id: string): boolean {
      const store = readStore()
      const memory = store.memories.find((entry) => entry.id === id && entry.archived)
      if (!memory) return false
      memory.archived = false
      writeStore(store)
      return true
    },

    remove(id: string): boolean {
      const store = readStore()
      const index = store.memories.findIndex((entry) => entry.id === id)
      if (index === -1) return false
      store.memories.splice(index, 1)
      writeStore(store)
      return true
    },

    stats(): MemoryStats {
      return summarizeMemories(readStore().memories)
    },

    updateConfig(nextConfig: MemoryConfig): void {
      config = normalizeMemoryConfig(nextConfig)
      if (!config.autoExtract) {
        for (const timer of debounceTimers.values()) clearTimeout(timer)
        debounceTimers.clear()
      }
    },

    initializeReviewCheckpoints(): void {
      const meta = readMeta()
      if (meta.reviewBaselineVersion === 1) return
      for (const filePath of listChatFiles()) {
        try {
          const data = safeJsonParse<{
            id?: string
            workspace?: string
            sessionMode?: string
            messages?: unknown[]
          }>(fs.readFileSync(filePath, 'utf-8'), {})
          if (data.workspace === 'harness' || data.sessionMode === 'harness') continue
          const chatId = typeof data.id === 'string' && data.id.trim()
            ? data.id
            : path.basename(filePath, '.json').replace(/^chat_/, '')
          meta.reviewWatermarks[chatId] = Array.isArray(data.messages) ? data.messages.length : 0
        } catch {
          /* Leave unreadable chats for a later review cycle. */
        }
      }
      meta.reviewInitializedAt = now()
      meta.reviewBaselineVersion = 1
      writeMeta(meta)
    },

    getReviewBatches(): MemoryReviewBatch[] {
      const meta = readMeta()
      const batches: MemoryReviewBatch[] = []
      for (const filePath of listChatFiles()) {
        if (config.excludeChatIds.some((id) => id && filePath.includes(id))) continue
        try {
          const data = safeJsonParse<{ id?: string }>(fs.readFileSync(filePath, 'utf-8'), {})
          const chatId = typeof data.id === 'string' && data.id.trim()
            ? data.id
            : path.basename(filePath, '.json').replace(/^chat_/, '')
          const batch = readChatReviewBatch(filePath, meta.reviewWatermarks[chatId] ?? 0)
          if (batch) batches.push(batch)
        } catch (error) {
          console.error(`[Memory] Failed to prepare review batch for ${filePath}:`, error)
        }
      }
      return batches
    },

    observeCompletedTurn(chatId: string): void {
      if (!config.autoExtract) return
      const existing = debounceTimers.get(chatId)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        debounceTimers.delete(chatId)
        const filePath = path.join(chatsDir, `chat_${chatId.replace(/[^a-zA-Z0-9-]/g, '')}.json`)
        if (!fs.existsSync(filePath)) return
        try {
          processChatFile(filePath)
        } catch (error) {
          console.error(`[Memory] observeCompletedTurn failed for ${chatId}:`, error)
        }
      }, 4000)
      timer.unref()
      debounceTimers.set(chatId, timer)
    },

    memoryTool(call: MemoryToolCall, chatId = 'tool'): MemoryToolResult {
      const budget = call.target === 'user' ? MEMORY_PROFILE_BUDGET : MEMORY_GENERAL_BUDGET
      const usageText = (): string => {
        const used = (target: 'user' | 'memory'): number =>
          readStore()
            .memories.filter((m) => !m.archived && m.tier === 'committed' && m.store === target)
            .reduce((sum, m) => sum + m.content.length, 0)
        return 'user ' + used('user') + '/' + MEMORY_PROFILE_BUDGET + ' · memory ' + used('memory') + '/' + MEMORY_GENERAL_BUDGET
      }
      const store = readStore()
      const scope = store.memories.filter(
        (m) => !m.archived && m.tier === 'committed' && m.store === call.target
      )
      const used = scope.reduce((sum, m) => sum + m.content.length, 0)
      const refuse = (message: string, includeEntries = false): MemoryToolResult => ({
        ok: false,
        message,
        ...(includeEntries ? { matches: scope.map((entry) => entry.content) } : {}),
        usage: usageText()
      })

      if (call.action === 'add') {
        const content = (call.content ?? '').trim()
        if (!content) return refuse('Error: content is required for add.')
        if (content.length > MEMORY_TOOL_ENTRY_CAP) {
          return refuse('Error: entry too long (' + content.length + ' chars, max ' + MEMORY_TOOL_ENTRY_CAP + '). Keep it compact.')
        }
        if (isCredentialLike(content)) {
          return refuse('Error: content looks like a secret or credential and was refused.')
        }
        const folded = (value: string): string => foldAccents(value.toLowerCase())
        if (scope.some((m) => folded(m.content) === folded(content))) {
          return { ok: true, message: 'No duplicate added — this fact is already saved.', usage: usageText() }
        }
        if (used + content.length > budget) {
          return refuse('Error: ' + call.target + ' store is full (' + used + '/' + budget + '). Consolidate existing entries (replace/remove) before adding.', true)
        }
        const requestedKind = call.kind && memoryStoreForKind(call.kind) === call.target
          ? call.kind
          : undefined
        const kind: MemoryKind = requestedKind ?? (
          call.target === 'user'
            ? /\b(gosto|prefiro|prefere|adoro|odeio|detesto|curto|favorit|like|prefer|love|hate)\b|n[ãa]o\s+gosto/i.test(content)
              ? 'preference'
              : 'about_user'
            : 'fact'
        )
        const polarity =
          kind === 'preference'
            ? /\b(odeio|detesto|hate|can'?t\s+stand)\b|n[ãa]o\s+gosto|don'?t\s+like/i.test(content)
              ? 'negative'
              : 'positive'
            : 'neutral'
        const created = now()
        const entry: MemoryEntry = {
          id: randomUUID(),
          store: call.target,
          kind,
          content,
          factKey: 'tool.' + call.target + '.' + slugifyKey(content).slice(0, 60),
          polarity,
          confidence: 0.95,
          tier: 'committed',
          sourceChatId: chatId,
          createdAt: created,
          confirmedAt: created,
          lastSeenAt: created,
          lastAccessedAt: created,
          accessCount: 0,
          pinned: false,
          archived: false,
          keywords: keywordize(content)
        }
        store.memories.push(entry)
        if (!writeStore(store)) return refuse('Error: failed to persist the memory entry.')
        emit('write', [entry], chatId)
        return { ok: true, message: 'Added to long-term memory.', usage: usageText(), entry }
      }

      const oldText = (call.old_text ?? '').trim()
      if (!oldText) return refuse('Error: old_text is required for replace/remove.')
      const foldedText = foldAccents(oldText.toLowerCase())
      const matches = scope.filter((m) => foldAccents(m.content.toLowerCase()).includes(foldedText))
      if (matches.length === 0) {
        return { ok: false, message: 'Error: no memory contains that text. Current entries:', matches: scope.slice(0, 5).map((m) => m.content), usage: usageText() }
      }
      if (matches.length > 1) {
        return { ok: false, message: 'Error: old_text matches multiple entries — make it more specific.', matches: matches.map((m) => m.content), usage: usageText() }
      }
      const entry = matches[0]

      if (call.action === 'replace') {
        const content = (call.content ?? '').trim()
        if (!content) return refuse('Error: content is required for replace.')
        if (content.length > MEMORY_TOOL_ENTRY_CAP) {
          return refuse('Error: entry too long (' + content.length + ' chars, max ' + MEMORY_TOOL_ENTRY_CAP + '). Keep it compact.')
        }
        if (isCredentialLike(content)) {
          return refuse('Error: content looks like a secret or credential and was refused.')
        }
        const usageAfterReplace = used - entry.content.length + content.length
        if (usageAfterReplace > budget) {
          return refuse('Error: ' + call.target + ' store would exceed its limit (' + usageAfterReplace + '/' + budget + '). Consolidate or remove an entry first.', true)
        }
        entry.content = content
        const requestedKind = call.kind && memoryStoreForKind(call.kind) === call.target
          ? call.kind
          : undefined
        entry.store = call.target
        entry.kind = requestedKind ?? (
          call.target === 'user'
            ? /\b(gosto|prefiro|prefere|adoro|odeio|detesto|curto|favorit|like|prefer|love|hate)\b|n[ãa]o\s+gosto/i.test(content)
              ? 'preference'
              : 'about_user'
            : 'fact'
        )
        entry.polarity = entry.kind === 'preference'
          ? /\b(odeio|detesto|hate|can'?t\s+stand)\b|n[ãa]o\s+gosto|don'?t\s+like/i.test(content)
            ? 'negative'
            : 'positive'
          : 'neutral'
        entry.keywords = keywordize(content)
        entry.confidence = 0.95
        entry.confirmedAt = now()
        entry.lastSeenAt = now()
        if (!writeStore(store)) return refuse('Error: failed to persist the memory update.')
        emit('write', [entry], chatId)
        return { ok: true, message: 'Memory updated.', usage: usageText(), entry }
      }

      // remove: soft archive (restorable), never a destructive delete.
      entry.archived = true
      if (!writeStore(store)) return refuse('Error: failed to persist the memory removal.')
      emit('archived', [entry], chatId)
      return { ok: true, message: 'Memory removed (archived; restorable).', usage: usageText(), entry }
    },

    applyReviewDecisions(
      batch: MemoryReviewBatch,
      decisions: MemoryReviewDecision[]
    ): MemoryReviewApplyResult {
      const result: MemoryReviewApplyResult = { saved: 0, user: 0, memory: 0, rejected: 0 }
      for (const decision of decisions) {
        const hasUserEvidence = decision.sourceUserMessageIndexes.some((index) =>
          batch.userMessageIndexes.includes(index)
        )
        if (!hasUserEvidence) {
          result.rejected += 1
          continue
        }
        const applied = service.memoryTool(decision, batch.chatId)
        if (!applied.ok) {
          result.rejected += 1
          continue
        }
        if (!applied.entry) continue
        result.saved += 1
        result[decision.target] += 1
      }
      if (result.rejected > 0) return result
      const meta = readMeta()
      meta.reviewWatermarks[batch.chatId] = Math.max(
        meta.reviewWatermarks[batch.chatId] ?? 0,
        batch.toMessageIndex
      )
      if (!writeMeta(meta)) throw new Error('Failed to persist the memory review checkpoint.')
      return result
    },

    recordReviewSummary(saved: number): void {
      const meta = readMeta()
      meta.lastReviewedAt = now()
      meta.lastReviewSavedCount = Math.max(0, Math.floor(saved))
      writeMeta(meta)
    },

    getReviewSummary(): { lastReviewedAt?: number; lastSavedCount: number } {
      const meta = readMeta()
      return {
        lastReviewedAt: meta.lastReviewedAt,
        lastSavedCount: meta.lastReviewSavedCount ?? 0
      }
    },

    startupCatchUp(): CatchUpReport {
      return runCatchUp()
    },

    runMaintenance(): number {
      return runMaintenance()
    }
  }
  activeMemoryService = service
  return service
}
