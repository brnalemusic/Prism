export type StreamFrameScheduler = (callback: FrameRequestCallback) => number
export type StreamFrameCanceller = (handle: number) => void

/** Keeps the latest cumulative chunk for each chat without letting chats overwrite each other. */
export class PerChatStreamBuffer<T extends { chatId: string }> {
  private readonly pending = new Map<string, T>()
  private rafHandle: number | null = null
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
    if (!value || !value.chatId) return
    this.pending.set(value.chatId, value)
    if (this.rafHandle === null) {
      this.rafHandle = this.schedule(() => {
        this.rafHandle = null
        const chunks = Array.from(this.pending.values())
        this.pending.clear()
        for (const chunk of chunks) {
          try {
            this.consume(chunk)
          } catch (err) {
            console.error('Error consuming stream chunk:', err)
          }
        }
      })
    }
  }

  flush(chatId: string): void {
    if (!chatId) return
    const chunk = this.pending.get(chatId)
    this.pending.delete(chatId)
    if (this.pending.size === 0 && this.rafHandle !== null) {
      this.cancel(this.rafHandle)
      this.rafHandle = null
    }
    if (chunk) {
      try {
        this.consume(chunk)
      } catch (err) {
        console.error('Error flushing stream chunk:', err)
      }
    }
  }

  flushAll(): void {
    if (this.rafHandle !== null) {
      this.cancel(this.rafHandle)
      this.rafHandle = null
    }
    const chunks = Array.from(this.pending.values())
    this.pending.clear()
    for (const chunk of chunks) {
      try {
        this.consume(chunk)
      } catch (err) {
        console.error('Error flushing all stream chunks:', err)
      }
    }
  }

  clear(): void {
    if (this.rafHandle !== null) {
      this.cancel(this.rafHandle)
      this.rafHandle = null
    }
    this.pending.clear()
  }
}
