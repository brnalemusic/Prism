import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  computeNextRunAt,
  normalizeIntervalMinutes
} from '../src/main/agenda/cadence.ts'
import { describeAgendaCadence } from '../src/shared/agendaTypes.ts'
import { mcpToolName, parseMcpToolName } from '../src/shared/mcpTypes.ts'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

const at = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0
): number => new Date(year, month - 1, day, hour, minute, 0, 0).getTime()

test('normalizeIntervalMinutes clamps to the supported range', () => {
  assert.equal(normalizeIntervalMinutes(null), null)
  assert.equal(normalizeIntervalMinutes(undefined), null)
  assert.equal(normalizeIntervalMinutes(Number.NaN), null)
  assert.equal(normalizeIntervalMinutes(Number.POSITIVE_INFINITY), null)
  assert.equal(normalizeIntervalMinutes(0), MIN_INTERVAL_MINUTES)
  assert.equal(normalizeIntervalMinutes(119), MIN_INTERVAL_MINUTES)
  assert.equal(normalizeIntervalMinutes(120), 120)
  assert.equal(normalizeIntervalMinutes('720'), 720)
  assert.equal(normalizeIntervalMinutes(120.4), 120)
  assert.equal(normalizeIntervalMinutes(999_999), MAX_INTERVAL_MINUTES)
})

test('rolling schedules advance from the schedule, not the completion time', () => {
  const from = at(2026, 1, 15, 10, 0)
  const task = { intervalMinutes: 120, anchor: null, nextRunAt: from }
  assert.equal(computeNextRunAt(task, from), from + 2 * HOUR)

  // A run that finished late still advances by exactly one interval.
  const late = from + 45 * MINUTE
  assert.equal(computeNextRunAt({ ...task, nextRunAt: from }, late), from + 2 * HOUR)
})

test('rolling schedules skip every missed occurrence and land in the future', () => {
  const from = at(2026, 1, 15, 10, 0)
  const next = computeNextRunAt(
    { intervalMinutes: 120, anchor: null, nextRunAt: from - 10 * HOUR },
    from
  )
  assert.equal(next, from + 2 * HOUR)
  assert.ok(next !== null && next > from)
})

test('rolling schedules without a previous occurrence start one interval from now', () => {
  const from = at(2026, 1, 15, 10, 0)
  assert.equal(
    computeNextRunAt({ intervalMinutes: 240, anchor: null, nextRunAt: null }, from),
    from + 4 * HOUR
  )
})

test('one-shot tasks have no next occurrence', () => {
  assert.equal(
    computeNextRunAt({ intervalMinutes: null, anchor: null, nextRunAt: null }, Date.now()),
    null
  )
})

test('daily anchors keep the requested time of day', () => {
  const anchor = { kind: 'time' as const, hour: 9, minute: 30 }
  assert.equal(
    computeNextRunAt(
      { intervalMinutes: 1440, anchor, nextRunAt: null },
      at(2026, 1, 15, 8, 0)
    ),
    at(2026, 1, 15, 9, 30)
  )
  assert.equal(
    computeNextRunAt(
      { intervalMinutes: 1440, anchor, nextRunAt: null },
      at(2026, 1, 15, 10, 0)
    ),
    at(2026, 1, 16, 9, 30)
  )
})

test('weekly anchors land on the requested weekday and time', () => {
  const anchor = { kind: 'time' as const, hour: 9, minute: 0, weekday: 1 }
  // Jan 15 2026 is a Thursday; the next Monday is Jan 19.
  assert.equal(
    computeNextRunAt(
      { intervalMinutes: 10080, anchor, nextRunAt: null },
      at(2026, 1, 15, 10, 0)
    ),
    at(2026, 1, 19, 9, 0)
  )
})

test('multi-week anchors keep the requested stride after a scheduled run', () => {
  const anchor = { kind: 'time' as const, hour: 9, minute: 0, weekday: 1 }
  // Jan 12 2026 is a Monday. The occurrence at 09:00 already fired, so a
  // two-week cadence moves to Jan 26 instead of collapsing to next Monday.
  assert.equal(
    computeNextRunAt(
      { intervalMinutes: 20160, anchor, nextRunAt: at(2026, 1, 12, 9, 0) },
      at(2026, 1, 12, 10, 0)
    ),
    at(2026, 1, 26, 9, 0)
  )
})

test('a new multi-week task starts on the next anchored weekday', () => {
  const anchor = { kind: 'time' as const, hour: 9, minute: 0, weekday: 1 }
  assert.equal(
    computeNextRunAt(
      { intervalMinutes: 20160, anchor, nextRunAt: null },
      at(2026, 1, 12, 10, 0)
    ),
    at(2026, 1, 19, 9, 0)
  )
})

test('multi-day anchors keep their stride and time of day', () => {
  const anchor = { kind: 'time' as const, hour: 9, minute: 0 }
  assert.equal(
    computeNextRunAt(
      { intervalMinutes: 2880, anchor, nextRunAt: null },
      at(2026, 1, 15, 10, 0)
    ),
    at(2026, 1, 17, 9, 0)
  )
})

test('monthly anchors clamp to the last day of short months', () => {
  const anchor = { kind: 'time' as const, hour: 9, minute: 0, dayOfMonth: 31 }
  assert.equal(
    computeNextRunAt(
      { intervalMinutes: 43200, anchor, nextRunAt: null },
      at(2026, 1, 15, 10, 0)
    ),
    at(2026, 1, 31, 9, 0)
  )
  assert.equal(
    computeNextRunAt(
      { intervalMinutes: 43200, anchor, nextRunAt: null },
      at(2026, 1, 31, 10, 0)
    ),
    at(2026, 2, 28, 9, 0)
  )
})

test('describeAgendaCadence reads naturally', () => {
  assert.equal(describeAgendaCadence(null), 'once')
  assert.equal(describeAgendaCadence(120), 'every 2 hours')
  assert.equal(describeAgendaCadence(1440), 'every day')
  assert.equal(describeAgendaCadence(2880), 'every 2 days')
  assert.equal(describeAgendaCadence(90), 'every 90 minutes')
})

test('MCP tool names round-trip through the Prism prefix', () => {
  const full = mcpToolName('github-main', 'create_issue')
  assert.equal(full, 'mcp__github-main__create_issue')
  assert.deepEqual(parseMcpToolName(full), {
    serverId: 'github-main',
    toolName: 'create_issue'
  })

  const sanitized = mcpToolName('my server', 'read.file')
  assert.equal(sanitized, 'mcp__my_server__read_file')
  assert.ok(parseMcpToolName(sanitized))
})

test('long MCP tool names stay within the 64-character function limit', () => {
  const full = mcpToolName('server', 'x'.repeat(120))
  assert.ok(full.length <= 64, `expected <= 64 characters, got ${full.length}`)
  assert.ok(full.startsWith('mcp__server__'))
  assert.ok(parseMcpToolName(full))
})
