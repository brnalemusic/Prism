/**
 * Personality profile (M1): deterministic, token-lean persona presets and
 * controls. Pure module — no Electron imports — so main, renderer and tests
 * can share it. Everything here must stay free of side effects and LLM calls.
 */

export type TonePresetId =
  | 'neutral'
  | 'friendly'
  | 'cynical'
  | 'philosophical'
  | 'warm'
  | 'quirky'
  | 'motivational'

export type SlangLevel = 'off' | 'light' | 'full'

/** 0–3 dial used by proximity, formality, humor, verbosity and emoji level. */
export type PersonaLevel = 0 | 1 | 2 | 3

export interface PersonaSettings {
  enabled: boolean
  preset: TonePresetId
  proximity: PersonaLevel
  formality: PersonaLevel
  emojiLevel: PersonaLevel
  humor: PersonaLevel
  verbosity: PersonaLevel
  slang: SlangLevel
}

export interface TonePreset {
  id: TonePresetId
  label: string
  description: string
  /** Style tokens (short traits) compiled into the system prompt. */
  tokens: string[]
  emojiPool: string[]
  /** Sample phrase used only by the local (LLM-free) preview. */
  sample: string
}

export const TONE_PRESET_IDS: TonePresetId[] = [
  'neutral',
  'friendly',
  'cynical',
  'philosophical',
  'warm',
  'quirky',
  'motivational'
]

export const TONE_PRESETS: Record<TonePresetId, TonePreset> = {
  neutral: {
    id: 'neutral',
    label: 'Neutral',
    description: 'Objective, clear and unbiased. The default assistant register.',
    tokens: ['neutral', 'objective', 'clear'],
    emojiPool: [],
    sample: 'Understood. Here is what I found.'
  },
  friendly: {
    id: 'friendly',
    label: 'Friendly',
    description: 'Cheerful, warm and encouraging without being over-familiar.',
    tokens: ['cheerful and approachable', 'positive and encouraging', 'conversational warmth'],
    emojiPool: ['😊', '👍', '✨'],
    sample: "That sounds great — let's figure it out together!"
  },
  cynical: {
    id: 'cynical',
    label: 'Cynical',
    description: 'Dry wit and light sarcasm with blunt, playful honesty.',
    tokens: ['dry wit and light sarcasm', 'playfully skeptical', 'bluntly honest'],
    emojiPool: ['🙃', '😏'],
    sample: "Oh good, another thing to fix. Let's see how deep this rabbit hole goes."
  },
  philosophical: {
    id: 'philosophical',
    label: 'Philosophical',
    description: 'Thoughtful and reflective, framing problems in the bigger picture.',
    tokens: ['thoughtful and reflective', 'frames things in the big picture', 'invites deeper questioning'],
    emojiPool: ['🌌', '🤔'],
    sample: 'Every system we build is a mirror of the questions we choose to ask.'
  },
  warm: {
    id: 'warm',
    label: 'Warm',
    description: 'Caring, patient and reassuring — celebrates your wins with you.',
    tokens: ['warm and caring', 'patient and reassuring', 'celebrates your wins'],
    emojiPool: ['💛', '🤗', '🌸'],
    sample: "Don't worry — I've got your back. Let's take this one step at a time."
  },
  quirky: {
    id: 'quirky',
    label: 'Quirky',
    description: 'Playfully eccentric with unexpected analogies and light wordplay.',
    tokens: ['playfully eccentric', 'unexpected analogies', 'light-hearted wordplay'],
    emojiPool: ['🦄', '🤪', '✨'],
    sample: 'Plot twist: we can actually do that. Let me grab my giraffe hat.'
  },
  motivational: {
    id: 'motivational',
    label: 'Motivational',
    description: 'Energetic and action-oriented, building momentum and confidence.',
    tokens: ['energetic and encouraging', 'action-oriented', 'builds confidence'],
    emojiPool: ['🔥', '💪', '🚀'],
    sample: "You've got this — let's turn that idea into something real today."
  }
}

export const PERSONA_STYLE_GUARD =
  'Applies to tone and wording only — never overrides accuracy, safety, tool rules, or user-language matching.'

export type PersonaDimKey = 'proximity' | 'formality' | 'humor' | 'verbosity' | 'emojiLevel'

export const PERSONA_DIMENSIONS: Array<{
  key: PersonaDimKey
  label: string
  steps: string[]
}> = [
  { key: 'proximity', label: 'Proximity', steps: ['Distant', 'Approachable', 'Warm', 'Close'] },
  { key: 'formality', label: 'Formality', steps: ['Relaxed', 'Casual', 'Polished', 'Formal'] },
  { key: 'humor', label: 'Humor', steps: ['None', 'Light', 'Playful', 'Witty'] },
  { key: 'verbosity', label: 'Verbosity', steps: ['Brief', 'Concise', 'Detailed', 'Rich'] },
  { key: 'emojiLevel', label: 'Emojis', steps: ['None', 'Few', 'Some', 'Plentiful'] }
]

export const SLANG_OPTIONS: Array<{ value: SlangLevel; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'light', label: 'Light' },
  { value: 'full', label: 'Full' }
]

export const DEFAULT_PERSONA: PersonaSettings = {
  enabled: false,
  preset: 'neutral',
  proximity: 1,
  formality: 1,
  humor: 1,
  verbosity: 1,
  emojiLevel: 0,
  slang: 'off'
}

/** Values that compilePersona treats as "no tuning needed" and omits. */
const DIM_DEFAULTS: { proximity: PersonaLevel; formality: PersonaLevel; humor: PersonaLevel; verbosity: PersonaLevel; emojiLevel: PersonaLevel; slang: SlangLevel } = {
  proximity: 1,
  formality: 1,
  humor: 1,
  verbosity: 1,
  emojiLevel: 0,
  slang: 'off'
}

const PROXIMITY_WORDS = ['distant and reserved', 'approachable', 'warm and familiar', 'close like a trusted friend']
const FORMALITY_WORDS = ['relaxed register', 'semi-casual register', 'polished register', 'formal register']
const HUMOR_WORDS = ['none', 'light', 'playful', 'frequent witty']
const VERBOSITY_WORDS = ['ultra-brief', 'concise', 'detailed', 'rich and expansive']
const EMOJI_WORDS = ['', 'sparing', 'moderate', 'liberal']
const SLANG_WORDS: Record<SlangLevel, string> = {
  off: '',
  light: 'light slang',
  full: 'full slang and regionalisms'
}

const clampLevel = (value: number): PersonaLevel =>
  Math.min(3, Math.max(0, Math.round(value))) as PersonaLevel

/**
 * Validates and backfills any partial/unknown shape into a full PersonaSettings.
 * Mirrors the defensive style used by config normalization.
 */
export function normalizePersona(value: unknown): PersonaSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PERSONA }
  const raw = value as Record<string, unknown>
  const level = (candidate: unknown, fallback: PersonaLevel): PersonaLevel =>
    typeof candidate === 'number' && Number.isFinite(candidate)
      ? clampLevel(candidate)
      : fallback
  const preset =
    typeof raw.preset === 'string' && TONE_PRESETS[raw.preset as TonePresetId]
      ? (raw.preset as TonePresetId)
      : DEFAULT_PERSONA.preset
  const slang: SlangLevel =
    raw.slang === 'light' || raw.slang === 'full' ? raw.slang : DEFAULT_PERSONA.slang
  return {
    enabled: raw.enabled === true,
    preset,
    proximity: level(raw.proximity, DIM_DEFAULTS.proximity),
    formality: level(raw.formality, DIM_DEFAULTS.formality),
    humor: level(raw.humor, DIM_DEFAULTS.humor),
    verbosity: level(raw.verbosity, DIM_DEFAULTS.verbosity),
    emojiLevel: level(raw.emojiLevel, DIM_DEFAULTS.emojiLevel),
    slang
  }
}

/**
 * Compiles the persona into a single, deliberately compact `# Communication
 * Style` system-prompt block. Deterministic: same settings, same output.
 * Dimensions left at their defaults are omitted to keep token cost minimal.
 * Returns an empty string when the profile is disabled.
 */
export function compilePersona(settings: PersonaSettings): string {
  if (!settings.enabled) return ''
  const s = normalizePersona(settings)
  const preset = TONE_PRESETS[s.preset]
  const frags: string[] = [preset.tokens.join(', ')]
  if (s.proximity !== DIM_DEFAULTS.proximity) frags.push(`proximity: ${PROXIMITY_WORDS[s.proximity]}`)
  if (s.formality !== DIM_DEFAULTS.formality) frags.push(`register: ${FORMALITY_WORDS[s.formality]}`)
  if (s.humor !== DIM_DEFAULTS.humor) frags.push(`humor: ${HUMOR_WORDS[s.humor]}`)
  if (s.verbosity !== DIM_DEFAULTS.verbosity) frags.push(`verbosity: ${VERBOSITY_WORDS[s.verbosity]}`)
  if (s.emojiLevel !== DIM_DEFAULTS.emojiLevel) frags.push(`emojis: ${EMOJI_WORDS[s.emojiLevel]}`)
  if (s.slang !== DIM_DEFAULTS.slang) frags.push(`slang: ${SLANG_WORDS[s.slang]}`)
  return `# Communication Style\n${frags.join('. ')}.\n${PERSONA_STYLE_GUARD}`
}

/**
 * Local, LLM-free preview material: a sample phrase shaped by the preset and
 * emoji level, plus the human-readable tuning summary shown as chips.
 */
export function buildPersonaPreview(settings: PersonaSettings): {
  sample: string
  summary: string[]
} {
  const s = normalizePersona(settings)
  const preset = TONE_PRESETS[s.preset]
  const emojis = preset.emojiPool.slice(0, s.emojiLevel).join(' ')
  const sample = `${preset.sample}${s.emojiLevel > 0 && emojis ? ` ${emojis}` : ''}`
  const summary: string[] = [preset.label]
  for (const dim of PERSONA_DIMENSIONS) {
    summary.push(`${dim.label}: ${dim.steps[s[dim.key]]}`)
  }
  const slangLabel = SLANG_OPTIONS.find((option) => option.value === s.slang)?.label ?? 'Off'
  summary.push(`Slang: ${slangLabel}`)
  return { sample, summary }
}
