export type StreamFrameScheduler = (callback: FrameRequestCallback) => number
export type StreamFrameCanceller = (handle: number) => void

export interface StreamPhaseSnapshot {
  /** The provider is still emitting reasoning in the latest observed phase. */
  activeThinking: boolean
  /** Keep the indicator visible for a frame when reasoning and text share one frame. */
  showThinking: boolean
  thinkingStartedAt?: number
  thinkingDurationMs: number
}

interface StreamPhaseState {
  activeThinking: boolean
  sawThinkingSinceFlush: boolean
  thinkingStartedAt?: number
  thinkingDurationMs: number
}

interface PendingStreamChunk<T> {
  value: T
  phase: StreamPhaseSnapshot
}

function createPhaseState(): StreamPhaseState {
  return {
    activeThinking: false,
    sawThinkingSinceFlush: false,
    thinkingDurationMs: 0
  }
}

function updatePhaseState(
  state: StreamPhaseState,
  isThinking: boolean,
  now: number
): StreamPhaseSnapshot {
  if (isThinking && !state.activeThinking) {
    state.activeThinking = true
    state.thinkingStartedAt = now
  } else if (!isThinking && state.activeThinking) {
    state.thinkingDurationMs += Math.max(0, now - (state.thinkingStartedAt || now))
    state.activeThinking = false
    state.thinkingStartedAt = undefined
  }

  if (isThinking) state.sawThinkingSinceFlush = true

  return {
    activeThinking: state.activeThinking,
    showThinking: state.activeThinking || state.sawThinkingSinceFlush,
    thinkingStartedAt: state.thinkingStartedAt,
    thinkingDurationMs: state.thinkingDurationMs
  }
}

function snapshotPhaseState(state: StreamPhaseState): StreamPhaseSnapshot {
  return {
    activeThinking: state.activeThinking,
    showThinking: state.activeThinking || state.sawThinkingSinceFlush,
    thinkingStartedAt: state.thinkingStartedAt,
    thinkingDurationMs:
      state.thinkingDurationMs +
      (state.activeThinking && state.thinkingStartedAt
        ? Math.max(0, Date.now() - state.thinkingStartedAt)
        : 0)
  }
}

export function thinkingDurationSeconds(durationMs: number): number {
  return durationMs > 0 ? Math.max(1, Math.round(durationMs / 1000)) : 0
}

/** Keeps the latest cumulative chunk for each chat without dropping phase transitions. */
export class PerChatStreamBuffer<T extends { chatId: string }> {
  private readonly pending = new Map<string, PendingStreamChunk<T>>()
  private readonly scheduled = new Map<string, number>()
  private readonly phases = new Map<string, StreamPhaseState>()
  private readonly schedule: StreamFrameScheduler
  private readonly cancel: StreamFrameCanceller
  private readonly consume: (value: T, phase: StreamPhaseSnapshot) => void

  constructor(
    schedule: StreamFrameScheduler,
    cancel: StreamFrameCanceller,
    consume: (value: T, phase: StreamPhaseSnapshot) => void
  ) {
    // Browser frame APIs are Web IDL methods and must keep the renderer global
    // as their receiver. Calling a raw requestAnimationFrame stored on this
    // class as `this.schedule()` can fail before the pending chunk is consumed.
    this.schedule = (callback) => schedule.call(globalThis, callback)
    this.cancel = (handle) => cancel.call(globalThis, handle)
    this.consume = consume
  }

  push(value: T, now = Date.now()): void {
    if (!value || !value.chatId) return
    const phaseState = this.phases.get(value.chatId) || createPhaseState()
    this.phases.set(value.chatId, phaseState)
    const phase = updatePhaseState(
      phaseState,
      Boolean((value as { isThinking?: boolean }).isThinking),
      now
    )
    this.pending.set(value.chatId, { value, phase })

    if (this.scheduled.has(value.chatId)) return
    const handle = this.schedule(() => {
      this.scheduled.delete(value.chatId)
      const pending = this.pending.get(value.chatId)
      if (!pending) return
      this.pending.delete(value.chatId)
      phaseState.sawThinkingSinceFlush = false
      try {
        this.consume(pending.value, pending.phase)
      } catch (err) {
        console.error('Error consuming stream chunk:', err)
      }
    })
    this.scheduled.set(value.chatId, handle)
  }

  flush(chatId: string): void {
    if (!chatId) return
    const handle = this.scheduled.get(chatId)
    if (handle !== undefined) this.cancel(handle)
    this.scheduled.delete(chatId)

    const pending = this.pending.get(chatId)
    if (!pending) return
    this.pending.delete(chatId)
    const phaseState = this.phases.get(chatId)
    if (phaseState) phaseState.sawThinkingSinceFlush = false
    try {
      this.consume(pending.value, pending.phase)
    } catch (err) {
      console.error('Error flushing stream chunk:', err)
    }
  }

  finalize(chatId: string, now = Date.now()): StreamPhaseSnapshot {
    this.flush(chatId)
    const state = this.phases.get(chatId)
    if (!state) {
      return {
        activeThinking: false,
        showThinking: false,
        thinkingDurationMs: 0
      }
    }

    if (state.activeThinking) {
      state.thinkingDurationMs += Math.max(0, now - (state.thinkingStartedAt || now))
      state.activeThinking = false
      state.thinkingStartedAt = undefined
    }
    const snapshot = snapshotPhaseState(state)
    this.phases.delete(chatId)
    return snapshot
  }

  flushAll(): void {
    for (const chatId of [...this.pending.keys()]) this.flush(chatId)
  }

  clear(): void {
    for (const handle of this.scheduled.values()) this.cancel(handle)
    this.scheduled.clear()
    this.pending.clear()
    this.phases.clear()
  }
}
