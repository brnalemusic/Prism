import type { DemoEvent, DemoScript } from '../../../shared/demo'

export interface DemoPlaybackController {
  stop: () => void
  duration: number
}

export function playDemoScript(
  script: DemoScript,
  onEvent: (event: DemoEvent) => void,
  onDone?: () => void
): DemoPlaybackController {
  const sortedEvents = [...script.events].sort((a, b) => a.at - b.at)
  const duration = sortedEvents.reduce((max, event) => Math.max(max, event.at), 0)
  const hasDoneEvent = sortedEvents.some((event) => event.kind === 'done')
  const startedAt = performance.now()
  let timer: number | null = null
  let nextIndex = 0
  let stopped = false
  let didNotifyDone = false

  const notifyDone = (): void => {
    if (didNotifyDone || stopped) return
    didNotifyDone = true
    onDone?.()
  }

  const scheduleNext = (): void => {
    if (stopped) return

    if (nextIndex >= sortedEvents.length) {
      if (!hasDoneEvent) {
        timer = window.setTimeout(notifyDone, 100)
      }
      return
    }

    const nextEvent = sortedEvents[nextIndex]
    const elapsed = performance.now() - startedAt
    const delay = Math.max(0, nextEvent.at - elapsed)

    timer = window.setTimeout(() => {
      if (stopped) return

      const now = performance.now() - startedAt
      while (nextIndex < sortedEvents.length && sortedEvents[nextIndex].at <= now + 1) {
        const event = sortedEvents[nextIndex]
        nextIndex += 1
        onEvent(event)
        if (event.kind === 'done') {
          notifyDone()
        }
      }

      scheduleNext()
    }, delay)
  }

  scheduleNext()

  return {
    duration,
    stop: () => {
      stopped = true
      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }
}
