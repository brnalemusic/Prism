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
  const timers: number[] = []
  const duration = sortedEvents.reduce((max, event) => Math.max(max, event.at), 0)

  for (const event of sortedEvents) {
    timers.push(
      window.setTimeout(() => {
        onEvent(event)
        if (event.kind === 'done') {
          onDone?.()
        }
      }, event.at)
    )
  }

  if (!sortedEvents.some((event) => event.kind === 'done')) {
    timers.push(window.setTimeout(() => onDone?.(), duration + 100))
  }

  return {
    duration,
    stop: () => {
      for (const timer of timers) {
        window.clearTimeout(timer)
      }
    }
  }
}
