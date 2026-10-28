import type { AgendaAnchor } from '../../shared/agendaTypes'
import { AGENDA_MAX_INTERVAL_MINUTES, AGENDA_MIN_INTERVAL_MINUTES } from '../../shared/agendaTypes'
import { loadConfig } from '../config'
import { providerHasCompletionCredential, resolveProviderAndModel } from '../ai/providerManager'
import { streamOpenAiCompletion } from '../ai/openaiClient'

export interface AgendaTaskDraft {
  title: string
  instructions: string
  intervalMinutes: number | null
  anchor: AgendaAnchor | null
}

const SYSTEM_PROMPT = `You turn a user request into a Prism Agenda task.

Reply with a single JSON object and nothing else:
{
  "title": "short task title",
  "instructions": "what the agent must do on every run, including where to keep files and what to update in .agenda/state.md",
  "intervalMinutes": 120 | 240 | ... | 44640 | null,
  "anchor": null | { "kind": "time", "hour": 8, "minute": 0, "weekday": 1, "dayOfMonth": 1 }
}

Rules:
- intervalMinutes is the cadence in minutes. The minimum is 120 (2 hours) and the maximum is 44640 (31 days).
- Use null only when the user explicitly wants a one-shot task.
- Map natural language: "every day" = 1440, "every week" = 10080, "every month" = 43200, "twice a day" = 720.
- Use anchor when the request names a clock time or calendar day: "every morning at 8" = daily anchor 08:00, "every Monday at 9" = weekly anchor with weekday 1 at 09:00, "on the 1st at 9" = monthly anchor with dayOfMonth 1 at 09:00.
- anchor.hour is 0-23, anchor.minute is 0-59, anchor.weekday is 0 (Sunday) to 6 (Saturday), anchor.dayOfMonth is 1-31. Never combine weekday and dayOfMonth. Only use an anchor when intervalMinutes is 1440 or longer. Use weekday only when intervalMinutes is a whole number of weeks (10080, 20160, 30240, 40320), and dayOfMonth only for the monthly cadence (43200).
- Never invent extra fields. Never wrap the JSON in markdown fences.
- The instructions must be self-contained: the executor starts with a fresh context on every run.
- Keep the title under 60 characters.`

function extractJson(raw: string): unknown {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The assistant did not return a JSON object.')
  return JSON.parse(candidate.slice(start, end + 1))
}

function normalizeInterval(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.min(
    AGENDA_MAX_INTERVAL_MINUTES,
    Math.max(AGENDA_MIN_INTERVAL_MINUTES, Math.round(numeric))
  )
}

/** Validates the clock anchor the model proposed. Invalid anchors are dropped. */
function normalizeAnchor(value: unknown, intervalMinutes: number | null): AgendaAnchor | null {
  if (!value || typeof value !== 'object' || intervalMinutes === null) return null
  if (intervalMinutes < 1440) return null
  const record = value as Record<string, unknown>
  if (record.kind !== 'time') return null

  const hour = Number(record.hour)
  const minute = record.minute === undefined ? 0 : Number(record.minute)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null

  const weekday = record.weekday === undefined ? undefined : Number(record.weekday)
  const dayOfMonth = record.dayOfMonth === undefined ? undefined : Number(record.dayOfMonth)
  if (weekday !== undefined && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) {
    return null
  }
  if (
    dayOfMonth !== undefined &&
    (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)
  ) {
    return null
  }
  if (weekday !== undefined && dayOfMonth !== undefined) return null
  // Weekly anchors only make sense for whole-week cadences, and monthly
  // anchors for the monthly cadence. Anything else would silently drift.
  if (weekday !== undefined && intervalMinutes % 10080 !== 0) return null
  if (dayOfMonth !== undefined && intervalMinutes !== 43200) return null

  return {
    kind: 'time',
    hour,
    minute,
    ...(weekday !== undefined ? { weekday } : {}),
    ...(dayOfMonth !== undefined ? { dayOfMonth } : {})
  }
}

/**
 * Turns a natural-language request into a task draft. It never creates the task:
 * the renderer shows the draft and the user commits it explicitly.
 */
export async function planAgendaTask(request: string): Promise<AgendaTaskDraft> {
  const config = loadConfig()
  const modelKey = config.lastSelectedChatModel || ''
  const { provider, model } = resolveProviderAndModel(modelKey)
  if (!provider || !model || !providerHasCompletionCredential(provider)) {
    throw new Error('Select an active chat model and provider before using the Agenda composer.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90_000)
  try {
    const result = await streamOpenAiCompletion(
      provider,
      model.id,
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: request.trim() }
      ],
      [],
      controller.signal,
      {
        onTextDelta: () => undefined,
        onReasoningDelta: () => undefined,
        onToolCallDelta: () => undefined
      }
    )

    const parsed = extractJson(result.text) as Record<string, unknown>
    const title = typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 80) : ''
    const instructions =
      typeof parsed.instructions === 'string' ? parsed.instructions.trim() : ''
    if (!title || !instructions) {
      throw new Error('The assistant returned an incomplete task.')
    }

    const intervalMinutes = normalizeInterval(parsed.intervalMinutes)
    return {
      title,
      instructions,
      intervalMinutes,
      anchor: normalizeAnchor(parsed.anchor, intervalMinutes)
    }
  } finally {
    clearTimeout(timeout)
  }
}
