import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_PERSONA,
  PERSONA_STYLE_GUARD,
  TONE_PRESETS,
  TONE_PRESET_IDS,
  buildPersonaPreview,
  compilePersona,
  normalizePersona,
  type PersonaSettings
} from '../src/shared/persona.ts'

const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length

test('disabled profile compiles to an empty string', () => {
  assert.equal(compilePersona({ ...DEFAULT_PERSONA, enabled: false }), '')
})

test('every preset compiles deterministically, lean, guarded and anchored', () => {
  for (const id of TONE_PRESET_IDS) {
    const persona: PersonaSettings = { ...DEFAULT_PERSONA, enabled: true, preset: id }
    const first = compilePersona(persona)
    const second = compilePersona(persona)
    assert.notEqual(first, '', `preset ${id} must compile to content`)
    assert.equal(first, second, `preset ${id} must compile deterministically`)
    assert.ok(first.startsWith('# Communication Style'), `preset ${id} missing header`)
    assert.ok(first.endsWith(PERSONA_STYLE_GUARD), `preset ${id} missing guard clause`)
    assert.ok(countWords(first) <= 110, `preset ${id} exceeds lean token budget`)
    assert.ok(first.includes(TONE_PRESETS[id].tokens[0]), `preset ${id} missing style tokens`)
  }
})

test('neutral preset with untouched defaults stays minimal', () => {
  const compiled = compilePersona({ ...DEFAULT_PERSONA, enabled: true })
  assert.ok(compiled.startsWith('# Communication Style'))
  assert.ok(countWords(compiled) < 40)
  assert.ok(!compiled.includes('emojis:'), 'default emoji level must be omitted')
})

test('every tuning dial changes the compiled output', () => {
  const base: PersonaSettings = { ...DEFAULT_PERSONA, enabled: true, preset: 'friendly' }

  assert.ok(compilePersona({ ...base, proximity: 3 }).includes('proximity: close like a trusted friend'))
  assert.ok(compilePersona({ ...base, formality: 3 }).includes('register: formal register'))
  assert.ok(compilePersona({ ...base, humor: 0 }).includes('humor: none'))
  assert.ok(compilePersona({ ...base, verbosity: 0 }).includes('verbosity: ultra-brief'))
  assert.ok(compilePersona({ ...base, emojiLevel: 3 }).includes('emojis: liberal'))
  assert.notEqual(compilePersona({ ...base, emojiLevel: 3 }), compilePersona(base))
  assert.ok(compilePersona({ ...base, slang: 'full' }).includes('slang: full slang and regionalisms'))
})

test('worst-case fully tuned persona still respects the lean budget', () => {
  const loud: PersonaSettings = {
    enabled: true,
    preset: 'cynical',
    proximity: 3,
    formality: 3,
    humor: 3,
    verbosity: 3,
    emojiLevel: 3,
    slang: 'full'
  }
  const compiled = compilePersona(loud)
  assert.ok(countWords(compiled) <= 110)
  assert.ok(compiled.includes(PERSONA_STYLE_GUARD))
})

test('normalizePersona clamps values, falls back on unknown presets and backfills', () => {
  const normalized = normalizePersona({
    enabled: true,
    preset: 'made-up-preset',
    proximity: 99,
    formality: -4,
    humor: 2.9,
    emojiLevel: 'lots',
    slang: 'extreme'
  })
  assert.deepEqual(normalized, {
    enabled: true,
    preset: 'neutral',
    proximity: 3,
    formality: 0,
    humor: 3,
    verbosity: 1,
    emojiLevel: 0,
    slang: 'off'
  })
  assert.deepEqual(normalizePersona(null), DEFAULT_PERSONA)
  assert.deepEqual(normalizePersona({ enabled: true }), {
    ...DEFAULT_PERSONA,
    enabled: true
  })
  const partial = normalizePersona({ enabled: true, preset: 'warm', verbosity: 2 })
  assert.equal(partial.preset, 'warm')
  assert.equal(partial.verbosity, 2)
  assert.equal(partial.formality, DEFAULT_PERSONA.formality)
})

test('normalizePersona never returns a shared mutable reference', () => {
  assert.notEqual(normalizePersona(undefined), DEFAULT_PERSONA)
})

test('buildPersonaPreview scales emojis with emoji level and stays LLM-free', () => {
  const presetId = 'friendly'
  const preset = TONE_PRESETS[presetId]
  const none = buildPersonaPreview({ ...DEFAULT_PERSONA, enabled: true, preset: presetId })
  assert.equal(none.sample, preset.sample)

  const some = buildPersonaPreview({
    ...DEFAULT_PERSONA,
    enabled: true,
    preset: presetId,
    emojiLevel: 2
  })
  assert.ok(some.sample.startsWith(preset.sample))
  assert.ok(some.sample.includes(preset.emojiPool[0]))
  assert.ok(some.summary.includes('Emojis: Some'))
  assert.ok(some.summary.includes('Friendly'))
})

test('compilePersona is a pure function of the settings object', () => {
  const a: PersonaSettings = { ...DEFAULT_PERSONA, enabled: true, preset: 'philosophical', verbosity: 0 }
  const b: PersonaSettings = { ...DEFAULT_PERSONA, enabled: true, preset: 'philosophical', verbosity: 0 }
  assert.equal(compilePersona(a), compilePersona(b))
  assert.equal(compilePersona({ ...a, verbosity: 3 }), compilePersona({ ...b, verbosity: 3 }))
})
