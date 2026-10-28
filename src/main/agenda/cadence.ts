import type { AgendaTask } from '../../shared/agendaTypes.ts'
import {
  AGENDA_MAX_INTERVAL_MINUTES,
  AGENDA_MIN_INTERVAL_MINUTES
} from '../../shared/agendaTypes.ts'

const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS

/** Shortest cadence Agenda accepts. */
export const MIN_INTERVAL_MINUTES = AGENDA_MIN_INTERVAL_MINUTES
/** Longest cadence Agenda accepts, in minutes (31 days). */
export const MAX_INTERVAL_MINUTES = AGENDA_MAX_INTERVAL_MINUTES

/** Clamps any cadence input to the supported range. `null` means one-shot. */
export function normalizeIntervalMinutes(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(numeric)))
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function withTimeOfDay(dayStart: number, hour: number, minute: number): number {
  return dayStart + hour * 60 * MINUTE_MS + minute * MINUTE_MS
}

/**
 * Computes the next scheduled time from the schedule itself, never from the
 * completion time. That keeps a task from drifting when a run takes longer
 * than expected.
 */
export function computeNextRunAt(
  task: Pick<AgendaTask, 'intervalMinutes' | 'anchor' | 'nextRunAt'>,
  from: number
): number | null {
  const interval = task.intervalMinutes
  if (interval === null) return null

  const anchor = task.anchor
  if (!anchor) {
    const base = task.nextRunAt ?? from
    let next = base + interval * MINUTE_MS
    // Skip over every occurrence that was missed while Prism was closed. The
    // scheduler records a single catch-up run, never a burst.
    while (next <= from) next += interval * MINUTE_MS
    return next
  }

  const intervalMs = interval * MINUTE_MS

  if (anchor.weekday !== undefined && intervalMs >= DAY_MS - MINUTE_MS) {
    const days = Math.max(1, Math.round(intervalMs / DAY_MS))
    // Once the task has a scheduled occurrence, stride from it so a catch-up
    // cannot shorten a multi-week cadence to a single week.
    if (task.nextRunAt !== null) {
      let candidate = task.nextRunAt + days * DAY_MS
      while (candidate <= from) candidate += days * DAY_MS
      return candidate
    }
    // A new task starts on the next matching weekday. Walking day by day is
    // required here: stepping by `days` would keep the same weekday forever.
    let candidate = withTimeOfDay(startOfLocalDay(from), anchor.hour, anchor.minute)
    while (new Date(candidate).getDay() !== anchor.weekday || candidate <= from) {
      candidate += DAY_MS
    }
    return candidate
  }

  if (anchor.dayOfMonth !== undefined) {
    const target = Math.min(31, Math.max(1, anchor.dayOfMonth))
    const cursor = new Date(from)
    for (let step = 0; step < 60; step += 1) {
      const year = cursor.getFullYear()
      const month = cursor.getMonth() + step
      const day = Math.min(target, new Date(year, month + 1, 0).getDate())
      const candidate = withTimeOfDay(
        new Date(year, month, day, 0, 0, 0, 0).getTime(),
        anchor.hour,
        anchor.minute
      )
      if (candidate > from) return candidate
    }
    return from + intervalMs
  }

  // Daily (or sub-daily) clock anchor: keep the requested time of day.
  const days = Math.max(1, Math.round(intervalMs / DAY_MS))
  let candidate = withTimeOfDay(startOfLocalDay(from), anchor.hour, anchor.minute)
  while (candidate <= from) candidate += days * DAY_MS
  return candidate
}
