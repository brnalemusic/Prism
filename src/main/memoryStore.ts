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
  buildTurnRecallBlock,
  keywordize,
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
  MemoryStats,
  MemoryStoreEvent,
  MemoryTier,
  MemoryWrite
} from '../shared/memoryCore.ts'

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
  observeCompletedTurn(chatId: string): void
  startupCatchUp(): CatchUpReport
  runMaintenance(): number
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

export function createMemoryService(options: MemoryServiceOptions): MemoryService {
  const chatsDir = options.chatsDir
  const memoryDir = options.memoryDir
  const config = normalizeMemoryConfig(options.config ?? DEFAULT_MEMORY_CONFIG)
  const now = options.now ?? (() => Date.now())
  const notify = options.notify ?? (() => {})

  const memoriesPath = path.join(memoryDir, 'memories.json')
  const metaPath = path.join(memoryDir, 'meta.json')
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const ensureDirs = (): void => {
    fs.mkdirSync(memoryDir, { recursive: true })
  }

  const readStore = (): MemoryStoreData => {
    ensureDirs()
    if (!fs.existsSync(memoriesPath)) return { memories: [] }
    try {
      const data = safeJsonParse<MemoryStoreData>(fs.readFileSync(memoriesPath, 'utf-8'), {
        memories: []
      })
      return { memories: Array.isArray(data.memories) ? data.memories : [] }
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

  const readMeta = (): MemoryMetaData => {
    ensureDirs()
    if (!fs.existsSync(metaPath)) return { watermarks: {} }
    return safeJsonParse<MemoryMetaData>(fs.readFileSync(metaPath, 'utf-8'), { watermarks: {} })
  }

  const writeMeta = (meta: MemoryMetaData): void => {
    ensureDirs()
    try {
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
    } catch (error) {
      console.error('[Memory] Failed to persist meta.json:', error)
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
