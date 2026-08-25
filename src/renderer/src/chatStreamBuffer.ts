export type StreamFrameScheduler = (callback: FrameRequestCallback) => number
export type StreamFrameCanceller = (handle: number) => void

/** Keeps the latest cumulative chunk for each chat without letting chats overwrite each other. */
export class PerChatStreamBuffer<T extends { chatId: string }> {
  private readonly pending = new Map<string, T>()
  private readonly scheduled = new Map<string, number>()
  private readonly schedule: StreamFrameScheduler
  private readonly cancel: StreamFrameCanceller
  private readonly consume: (value: T) => void

  constructor(
    schedule: StreamFrameScheduler,
    cancel: StreamFrameCanceller,
    consume: (value: T) => void
  ) {
    this.schedule = schedule
    this.cancel = cancel
    this.consume = consume
  }

  push(value: T): void {
    this.pending.set(value.chatId, value)
    if (this.scheduled.has(value.chatId)) return
    const handle = this.schedule(() => {
      this.scheduled.delete(value.chatId)
      const pending = this.pending.get(value.chatId)
      if (!pending) return
      this.pending.delete(value.chatId)
      this.consume(pending)
    })
    this.scheduled.set(value.chatId, handle)
  }

  flush(chatId: string): void {
    const handle = this.scheduled.get(chatId)
    if (handle !== undefined) this.cancel(handle)
    this.scheduled.delete(chatId)
    const pending = this.pending.get(chatId)
    if (!pending) return
    this.pending.delete(chatId)
    this.consume(pending)
  }

  flushAll(): void {
    for (const chatId of [...this.pending.keys()]) this.flush(chatId)
  }

  clear(): void {
    for (const handle of this.scheduled.values()) this.cancel(handle)
    this.scheduled.clear()
    this.pending.clear()
  }
}
