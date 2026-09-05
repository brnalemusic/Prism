import { randomUUID } from 'crypto'
import type { AppConfig } from './config'
import type { MemoryService } from './memoryStore'
import {
  getActiveModels,
  providerHasCompletionCredential,
  resolveProviderAndModel
} from './ai/providerManager'
import { streamOpenAiCompletion } from './ai/openaiClient'
import { buildMemoryReviewPrompt, parseMemoryReviewDecisions } from '../shared/memoryReview'
import type { MemoryReviewInfo, MemoryReviewStatus } from '../shared/memoryCore'
import type { ProviderConfig, ProviderModel } from '../shared/types'

const ACCOUNT_MEMORY_MODEL_KEY = 'prism_provider:prism-ai/arcadia-1.0-mini'

interface ResolvedMemoryReviewRoute {
  provider: ProviderConfig | null
  model: ProviderModel | null
  key?: string
  name?: string
  usingFallback: boolean
  status: MemoryReviewInfo['routeStatus']
}

interface MemoryReviewSchedulerOptions {
  getConfig: () => AppConfig
  getMemoryService: () => MemoryService
  notify: (status: MemoryReviewStatus) => void
}

export interface MemoryReviewScheduler {
  start(): void
  stop(): void
  reconfigure(): void
  runNow(): Promise<void>
  getInfo(): MemoryReviewInfo
}

function activeModelByKey(key: string | undefined): ReturnType<typeof getActiveModels>[number] | undefined {
  if (!key) return undefined
  return getActiveModels().find(
    (entry) =>
      entry.fullKey === key ||
      entry.model.id === key ||
      entry.model.name === key
  )
}

export function resolveMemoryReviewRoute(config: AppConfig): ResolvedMemoryReviewRoute {
  const requested = config.memory.reviewModel?.trim()
  const configured = activeModelByKey(requested)
  const accountDefault = activeModelByKey(ACCOUNT_MEMORY_MODEL_KEY)
  const main = activeModelByKey(config.lastSelectedChatModel)

  const candidates = requested
    ? [configured, main]
    : [accountDefault, main]
  const selected = candidates.find((candidate) => {
    if (!candidate) return false
    const resolved = resolveProviderAndModel(candidate.fullKey)
    return Boolean(
      resolved.provider &&
      resolved.model &&
      providerHasCompletionCredential(resolved.provider)
    )
  })
  if (!selected) {
    return {
      provider: null,
      model: null,
      usingFallback: Boolean(requested || accountDefault),
      status: 'unavailable'
    }
  }

  const resolved = resolveProviderAndModel(selected.fullKey)
  const usedConfigured = Boolean(requested && configured?.fullKey === selected.fullKey)
  const usedAccountDefault = Boolean(!requested && accountDefault?.fullKey === selected.fullKey)

  return {
    provider: resolved.provider!,
    model: resolved.model!,
    key: selected.fullKey,
    name: resolved.model!.name || resolved.model!.id,
    usingFallback: !usedConfigured && !usedAccountDefault,
    status: usedConfigured
      ? 'configured'
      : usedAccountDefault
        ? 'account-default'
        : 'main-fallback'
  }
}

export function createMemoryReviewScheduler(
  options: MemoryReviewSchedulerOptions
): MemoryReviewScheduler {
  let timer: ReturnType<typeof setInterval> | null = null
  let activeController: AbortController | null = null
  let running = false

  const emit = (status: MemoryReviewStatus): void => options.notify(status)

  const runNow = async (): Promise<void> => {
    const config = options.getConfig()
    if (!config.memory.reviewEnabled || running) return
    const memory = options.getMemoryService()
    const batches = memory.getReviewBatches()
    const runId = randomUUID()
    const startedAt = Date.now()
    let chatsProcessed = 0
    let memoriesSaved = 0
    let userMemories = 0
    let generalMemories = 0
    let lastError = ''

    if (batches.length === 0) {
      memory.recordReviewSummary(0)
      emit({
        state: 'completed',
        runId,
        startedAt,
        finishedAt: Date.now(),
        chatsTotal: 0,
        chatsProcessed: 0,
        memoriesSaved: 0,
        userMemories: 0,
        generalMemories: 0
      })
      return
    }

    const route = resolveMemoryReviewRoute(config)

    if (!route.provider || !route.model) {
      emit({
        state: 'failed',
        runId,
        startedAt,
        finishedAt: Date.now(),
        chatsTotal: batches.length,
        chatsProcessed: 0,
        memoriesSaved: 0,
        userMemories: 0,
        generalMemories: 0,
        usingFallback: route.usingFallback,
        error: 'No memory review model or main chat model is available.'
      })
      return
    }

    running = true
    emit({
      state: 'started',
      runId,
      startedAt,
      chatsTotal: batches.length,
      chatsProcessed,
      memoriesSaved,
      userMemories,
      generalMemories,
      modelName: route.name,
      usingFallback: route.usingFallback
    })

    try {
      for (const batch of batches) {
        activeController = new AbortController()
        const timeout = setTimeout(() => activeController?.abort(), 60_000)
        timeout.unref()
        try {
          const prompt = buildMemoryReviewPrompt(batch, memory.list({ includeArchived: true }))
          const response = await streamOpenAiCompletion(
            route.provider,
            route.model.id,
            [{ role: 'user', content: prompt }],
            [],
            activeController.signal,
            { onTextDelta: () => {}, onReasoningDelta: () => {}, onToolCallDelta: () => {} }
          )
          const decisions = parseMemoryReviewDecisions(response.text)
          const applied = memory.applyReviewDecisions(batch, decisions)
          memoriesSaved += applied.saved
          userMemories += applied.user
          generalMemories += applied.memory
          chatsProcessed += 1
          emit({
            state: 'progress',
            runId,
            startedAt,
            chatsTotal: batches.length,
            chatsProcessed,
            memoriesSaved,
            userMemories,
            generalMemories,
            modelName: route.name,
            usingFallback: route.usingFallback
          })
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
          console.error(`[Memory Review] Failed for chat ${batch.chatId}:`, error)
        } finally {
          clearTimeout(timeout)
          activeController = null
        }
      }

      memory.recordReviewSummary(memoriesSaved)
      emit({
        state: lastError ? 'failed' : 'completed',
        runId,
        startedAt,
        finishedAt: Date.now(),
        chatsTotal: batches.length,
        chatsProcessed,
        memoriesSaved,
        userMemories,
        generalMemories,
        modelName: route.name,
        usingFallback: route.usingFallback,
        ...(lastError ? { error: lastError } : {})
      })
    } finally {
      running = false
      activeController = null
    }
  }

  const schedule = (): void => {
    if (timer) clearInterval(timer)
    timer = null
    const config = options.getConfig()
    const memory = options.getMemoryService()
    memory.updateConfig(config.memory)
    if (!config.memory.reviewEnabled) return
    timer = setInterval(() => void runNow(), config.memory.reviewIntervalMinutes * 60_000)
    timer.unref()
  }

  return {
    start(): void {
      options.getMemoryService().initializeReviewCheckpoints()
      schedule()
    },
    stop(): void {
      if (timer) clearInterval(timer)
      timer = null
      activeController?.abort()
      activeController = null
    },
    reconfigure(): void {
      schedule()
    },
    runNow,
    getInfo(): MemoryReviewInfo {
      const summary = options.getMemoryService().getReviewSummary()
      const route = resolveMemoryReviewRoute(options.getConfig())
      return {
        lastReviewedAt: summary.lastReviewedAt,
        lastSavedCount: summary.lastSavedCount,
        resolvedModelKey: route.key,
        resolvedModelName: route.name,
        usingFallback: route.usingFallback,
        routeStatus: route.status
      }
    }
  }
}
