import assert from 'node:assert/strict'
import test from 'node:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  DEFAULT_MEMORY_CONFIG,
  MEMORY_GUARD_HEADER,
  MEMORY_PROFILE_HEADER,
  buildMemoryContextBlock,
  buildTurnRecallBlock,
  computeMemoryValue,
  normalizeMemoryConfig,
  recallCandidates,
  runExtraction,
  shouldArchiveEntry
} from '../src/shared/memoryCore.ts'
import type { ExtractionResult, MemoryEntry, MemoryConfig } from '../src/shared/memoryCore.ts'
import { createMemoryService } from '../src/main/memoryStore.ts'

const NOW = 1_700_000_000_000

const base = (newUserMessages: string[], chatId = 'c1', priorMemories: MemoryEntry[] = []): Parameters<typeof runExtraction>[0] => ({
  newUserMessages,
  chatMeta: { chatId },
  priorMemories,
  now: NOW
})

const commitKeys = (result: ExtractionResult): string[] =>
  result.commits.map((write) => write.factKey ?? '')
const suggestKeys = (result: ExtractionResult): string[] =>
  result.suggestions.map((write) => write.factKey ?? '')

// ---------------------------------------------------------------------------
// Config normalization
// ---------------------------------------------------------------------------

test('normalizeMemoryConfig clamps thresholds, swaps inverted pairs and backfills', () => {
  const config = normalizeMemoryConfig({
    commitThreshold: 0.5,
    suggestThreshold: 0.9,
    halfLifeDays: 2,
    excludeChatIds: ['x', 42],
    autoExtract: 'yes'
  })
  assert.equal(config.commitThreshold, 0.9)
  assert.equal(config.suggestThreshold, 0.5)
  assert.equal(config.halfLifeDays, DEFAULT_MEMORY_CONFIG.halfLifeDays)
  assert.deepEqual(config.excludeChatIds, ['x'])
  assert.equal(config.autoExtract, false)
  assert.deepEqual(normalizeMemoryConfig(null), DEFAULT_MEMORY_CONFIG)
})

// ---------------------------------------------------------------------------
// runExtraction — PT/EN fixture cases
// ---------------------------------------------------------------------------

test('PT: explicit commands auto-commit (committed, not suggested)', () => {
  const result = runExtraction(base(['Lembre que meu aniversário é 12/03.']))
  assert.equal(result.commits.length, 1)
  assert.equal(result.commits[0].factKey, 'user.birthday=12-03')
  assert.equal(result.suggestions.length, 0)
})

test('EN: explicit command auto-commits a fact', () => {
  const result = runExtraction(base(['Remember that I am allergic to peanuts.']))
  assert.equal(result.commits.length, 1)
  assert.ok(result.commits[0].confidence >= 0.8)
  assert.equal(result.suggestions.length, 0)
})

test('PT: lone self-disclosure lands as a suggestion, not a commit', () => {
  const result = runExtraction(base(['Meu nome é Ana.']))
  assert.equal(result.commits.length, 0)
  assert.equal(result.suggestions.length, 1)
  assert.equal(result.suggestions[0].factKey, 'user.name=ana')
})

test('EN: lone structured slot stays a suggestion', () => {
  const result = runExtraction(base(['I live in São Paulo.']))
  assert.equal(result.commits.length, 0)
  assert.equal(result.suggestions[0].factKey, 'user.location=sao-paulo')
})

test('PT/EN: bare preference is suggested, never committed', () => {
  for (const message of ['Eu gosto muito de café.', 'I really love coffee.']) {
    const result = runExtraction(base([message]))
    assert.equal(result.commits.length, 0, message)
    assert.equal(result.suggestions.length, 1, message)
    assert.ok(result.suggestions[0].factKey?.startsWith('pref.'), message)
    assert.equal(result.suggestions[0].polarity, 'positive', message)
  }
})

test('PT/EN: negative preference keeps polarity negative', () => {
  for (const message of ['Eu odeio café.', "I don't like cilantro."]) {
    const result = runExtraction(base([message]))
    assert.equal(result.suggestions[0].polarity, 'negative', message)
    assert.ok(result.suggestions[0].factKey?.startsWith('pref.'), message)
  }
})

test('PT/EN: second-hand statements are never extracted', () => {
  for (const message of [
    'Meu chefe disse que sou muito bom.',
    'My boss says I am great at this.',
    'Ele acha que devo mudar de carreira.'
  ]) {
    const result = runExtraction(base([message]))
    assert.equal(result.commits.length, 0, message)
    assert.equal(result.suggestions.length, 0, message)
  }
})

test('credentials and secrets are redacted', () => {
  for (const message of [
    'Minha api_key = sk-abc123def456ghi789jkl012',
    'my password is hunter2secret',
    'A chave é 0123456789abcdef0123456789abcdef01234567'
  ]) {
    const result = runExtraction(base([message]))
    assert.equal(result.commits.length + result.suggestions.length, 0, message)
  }
})

test('hypothetical statements demote below extraction', () => {
  for (const message of ['Se eu um dia morar em Paris.', 'Maybe I will move to Paris someday.']) {
    const result = runExtraction(base([message]))
    assert.equal(result.commits.length + result.suggestions.length, 0, message)
  }
})

test('second explicit confirmation promotes a possible memory to committed', () => {
  const first = runExtraction(base(['Meu nome é Ana.']))
  assert.equal(first.suggestions.length, 1)
  const entry: MemoryEntry = {
    id: 'm1',
    kind: 'about_user',
    content: 'Meu nome é Ana.',
    factKey: 'user.name=ana',
    polarity: 'neutral',
    confidence: 0.55,
    tier: 'possible',
    sourceChatId: 'c1',
    createdAt: NOW - 5 * 86_400_000,
    confirmedAt: NOW - 5 * 86_400_000,
    lastSeenAt: NOW - 5 * 86_400_000,
    lastAccessedAt: NOW - 5 * 86_400_000,
    accessCount: 0,
    pinned: false,
    archived: false,
    keywords: []
  }
  const again = runExtraction(base(['Meu nome é Ana mesmo.'], 'c2', [entry]))
  assert.equal(again.commits.length, 1)
  assert.equal(again.commits[0].action, 'refresh')
  assert.equal(again.commits[0].id, 'm1')
  assert.equal(again.commits[0].promote, true)
})

test('polarity flip with correction signal supersedes the old memory', () => {
  const entry: MemoryEntry = {
    id: 'old',
    kind: 'preference',
    content: 'Eu gosto de café.',
    factKey: 'pref.cafe',
    polarity: 'positive',
    confidence: 0.9,
    tier: 'committed',
    sourceChatId: 'c1',
    createdAt: NOW - 86_400_000,
    confirmedAt: NOW - 86_400_000,
    lastSeenAt: NOW - 86_400_000,
    lastAccessedAt: NOW - 86_400_000,
    accessCount: 2,
    pinned: false,
    archived: false,
    keywords: ['cafe']
  }
  const result = runExtraction(base(['Na verdade, eu odeio café.'], 'c1', [entry]))
  assert.equal(result.commits.length, 1)
  assert.equal(result.commits[0].action, 'supersede')
  assert.equal(result.commits[0].supersedesId, 'old')
})

test('polarity flip without a correction signal becomes a conflict suggestion', () => {
  const entry: MemoryEntry = {
    id: 'old',
    kind: 'preference',
    content: 'Eu gosto de café.',
    factKey: 'pref.cafe',
    polarity: 'positive',
    confidence: 0.9,
    tier: 'committed',
    sourceChatId: 'c1',
    createdAt: NOW - 86_400_000,
    confirmedAt: NOW - 86_400_000,
    lastSeenAt: NOW - 86_400_000,
    lastAccessedAt: NOW - 86_400_000,
    accessCount: 2,
    pinned: false,
    archived: false,
    keywords: ['cafe']
  }
  const result = runExtraction(base(['Eu odeio café.'], 'c1', [entry]))
  assert.equal(result.commits.length, 0)
  assert.equal(result.suggestions.length, 1)
  assert.equal(result.suggestions[0].conflictsWithId, 'old')
})

test('re-mention in the same chat refreshes without promoting', () => {
  const entry: MemoryEntry = {
    id: 'm2',
    kind: 'about_user',
    content: 'Trabalho com design.',
    factKey: 'user.occupation=design',
    polarity: 'neutral',
    confidence: 0.7,
    tier: 'possible',
    sourceChatId: 'c1',
    createdAt: NOW - 3600_000,
    confirmedAt: NOW - 3600_000,
    lastSeenAt: NOW - 3600_000,
    lastAccessedAt: NOW - 3600_000,
    accessCount: 0,
    pinned: false,
    archived: false,
    keywords: ['design']
  }
  const result = runExtraction(base(['Trabalho com design mesmo.'], 'c1', [entry]))
  assert.equal(result.commits.length, 1)
  assert.equal(result.commits[0].action, 'refresh')
  assert.equal(result.commits[0].promote, false)
})

test('PT/EN: project and pet slots produce project/about_user keys', () => {
  const ptProject = runExtraction(base(['Estou trabalhando em um projeto chamado Atlas.']))
  assert.ok(ptProject.suggestions[0].factKey?.startsWith('user.project='))
  const enPet = runExtraction(base(['I have a dog named Rex.']))
  assert.equal(enPet.suggestions[0].factKey, 'user.family.pet=dog')
})

test('explicit forget commands produce ForgetOps', () => {
  for (const message of [
    'Esquece que eu disse que gosto de café.',
    'Delete the memory about the Atlas project.',
    'Apaga todas as memórias.'
  ]) {
    const result = runExtraction(base([message]))
    assert.equal(result.forgets.length, 1, message)
    assert.ok(['all', 'factKey'].includes(result.forgets[0].scope), message)
  }
})

test(`"don't remember" directives never extract`, () => {
  for (const message of ["Don't remember that.", 'Não lembre disso.']) {
    const result = runExtraction(base([message]))
    assert.equal(result.commits.length + result.suggestions.length, 0)
  }
})

test('extraction is deterministic across runs', () => {
  const messages = ['Meu nome é Ana.', 'Gosto muito de café.', 'Moro em São Paulo.']
  const first = runExtraction(base(messages))
  const second = runExtraction(base(messages))
  assert.equal(JSON.stringify(first), JSON.stringify(second))
})

test('excluded chats are skipped entirely', () => {
  const config: MemoryConfig = { ...DEFAULT_MEMORY_CONFIG, excludeChatIds: ['secret-chat'] }
  const result = runExtraction(
    { ...base(['Meu nome é Ana.']), chatMeta: { chatId: 'secret-chat' } },
    config
  )
  assert.equal(result.commits.length + result.suggestions.length, 0)
})

// ---------------------------------------------------------------------------
// Decay math
// ---------------------------------------------------------------------------

test('computeMemoryValue decays with half-life and recovers with access count', () => {
  const fresh = { confidence: 0.9, confirmedAt: NOW, accessCount: 0 }
  const aged = { confidence: 0.9, confirmedAt: NOW - 120 * 86_400_000, accessCount: 0 }
  assert.ok(computeMemoryValue(fresh, NOW, 120) > computeMemoryValue(aged, NOW, 120))
  assert.ok(computeMemoryValue(aged, NOW, 120) < 0.5)
  const used = { confidence: 0.9, confirmedAt: NOW - 120 * 86_400_000, accessCount: 10 }
  assert.ok(computeMemoryValue(used, NOW, 120) > computeMemoryValue(aged, NOW, 120))
})

test('shouldArchiveEntry only archives cold, unpinned, non-expired entries', () => {
  const baseEntry: MemoryEntry = {
    id: 'a1',
    kind: 'fact',
    content: 'X',
    factKey: 'user.x',
    polarity: 'neutral',
    confidence: 0.5,
    tier: 'committed',
    sourceChatId: 'c1',
    createdAt: NOW - 300 * 86_400_000,
    confirmedAt: NOW - 300 * 86_400_000,
    lastSeenAt: NOW - 300 * 86_400_000,
    lastAccessedAt: NOW - 300 * 86_400_000,
    accessCount: 0,
    pinned: false,
    archived: false,
    keywords: []
  }
  assert.ok(shouldArchiveEntry(baseEntry, NOW, 120))
  assert.ok(!shouldArchiveEntry({ ...baseEntry, pinned: true }, NOW, 120))
  assert.ok(!shouldArchiveEntry({ ...baseEntry, lastSeenAt: NOW - 1000 }, NOW, 120))
  const expired = { ...baseEntry, lastSeenAt: NOW - 1000, expiresAt: NOW - 1000 }
  assert.ok(shouldArchiveEntry(expired, NOW, 120))
})

test('recallCandidates ranks pinned and query-overlapping memories first', () => {
  const mk = (id: string, content: string, keywords: string[], pinned = false): MemoryEntry => ({
    id,
    kind: 'about_user',
    content,
    factKey: `user.${id}`,
    polarity: 'neutral',
    confidence: 0.9,
    tier: 'committed',
    sourceChatId: 'c1',
    createdAt: NOW,
    confirmedAt: NOW,
    lastSeenAt: NOW,
    lastAccessedAt: NOW,
    accessCount: 0,
    pinned,
    archived: false,
    keywords
  })
  const memories = [mk('a', 'Moro em São Paulo.', ['paulo']), mk('b', 'Gosto de café.', ['cafe'])]
  const ranked = recallCandidates(memories, 'você lembra que eu gosto de café?', NOW)
  assert.equal(ranked[0].id, 'b')
})

// ---------------------------------------------------------------------------
// Context block formatting (recall + pinned core)
// ---------------------------------------------------------------------------

test('buildMemoryContextBlock honors guard header, budgets, and never injects possible/archived', () => {
  const mk = (id: string, content: string, overrides: Partial<MemoryEntry> = {}): MemoryEntry => ({
    id,
    kind: 'about_user',
    content,
    factKey: `user.${id}`,
    polarity: 'neutral',
    confidence: 0.9,
    tier: 'committed',
    sourceChatId: 'c1',
    createdAt: NOW,
    confirmedAt: NOW,
    lastSeenAt: NOW,
    lastAccessedAt: NOW,
    accessCount: 0,
    pinned: false,
    archived: false,
    keywords: [],
    ...overrides
  })
  const block = buildMemoryContextBlock(
    [
      mk('pin', 'Usuário se chama Ana.', { pinned: true }),
      mk('unpin', 'Gosta de café.'),
      mk('poss', 'Fato possível.', { tier: 'possible' }),
      mk('arch', 'Fato arquivado.', { archived: true }),
      mk('exp', 'Evento vencido.', { expiresAt: NOW - 1 })
    ],
    { now: NOW }
  )
  assert.ok(block)
  assert.ok(block.startsWith(MEMORY_GUARD_HEADER))
  assert.ok(block.includes('Usuário se chama Ana.'))
  assert.ok(block.includes('Gosta de café.'))
  assert.ok(!block.includes('Fato possível.'))
  assert.ok(!block.includes('Fato arquivado.'))
  assert.ok(!block.includes('Evento vencido.'))

  const pinnedOnly = buildMemoryContextBlock(
    [mk('pin', 'Usuário se chama Ana.', { pinned: true }), mk('unpin', 'Gosta de café.')],
    { now: NOW, pinnedOnly: true }
  )
  assert.ok(pinnedOnly)
  assert.ok(pinnedOnly.includes('Ana.'))
  assert.ok(!pinnedOnly.includes('café'))

  assert.equal(
    buildMemoryContextBlock([mk('p', 'Fato possível.', { tier: 'possible' })], { now: NOW }),
    null
  )
  const long = buildMemoryContextBlock([mk('l1', 'x'.repeat(500)), mk('l2', 'y'.repeat(500))], {
    now: NOW,
    maxChars: 700
  })
  assert.ok(long && long.length <= 700)
  assert.ok(!long.includes('y'.repeat(500)))

  const few = buildMemoryContextBlock([mk('e1', 'um'), mk('e2', 'dois'), mk('e3', 'três')], {
    now: NOW,
    maxEntries: 2
  })
  assert.equal((few ?? '').split('\n').filter((line) => line.startsWith('- ')).length, 2)
})

test('buildTurnRecallBlock ranks by overlap, drops pinned (already in core), stays in budget', () => {
  const mk = (id: string, content: string, keywords: string[], pinned = false): MemoryEntry => ({
    id,
    kind: 'about_user',
    content,
    factKey: `user.${id}`,
    polarity: 'neutral',
    confidence: 0.9,
    tier: 'committed',
    sourceChatId: 'c1',
    createdAt: NOW,
    confirmedAt: NOW,
    lastSeenAt: NOW,
    lastAccessedAt: NOW,
    accessCount: 0,
    pinned,
    archived: false,
    keywords
  })
  const memories = [
    mk('pin', 'Usuário se chama Ana.', ['ana'], true),
    mk('cafe', 'Gosta de café com leite.', ['cafe', 'leite']),
    mk('sp', 'Mora em São Paulo.', ['paulo']),
    mk('jogo', 'Joga xadrez.', ['xadrez'])
  ]
  const block = buildTurnRecallBlock(memories, 'você lembra que eu gosto de café?', NOW)
  assert.ok(block)
  assert.ok(!block.includes('Ana.'))
  const lines = (block ?? '').split('\n').filter((line) => line.startsWith('- '))
  assert.equal(lines[0], '- Gosta de café com leite.')
  assert.ok((block ?? '').length <= 900)
  assert.ok(lines.length <= 6)
  assert.equal(buildTurnRecallBlock([], 'qualquer coisa', NOW), null)
})

// ---------------------------------------------------------------------------
// Store round-trip (temp dirs, no Electron)
// ---------------------------------------------------------------------------

const writeChatFile = (root: string, id: string, userMessages: string[]): string => {
  const chatsDir = path.join(root, 'chats')
  fs.mkdirSync(chatsDir, { recursive: true })
  const messages = userMessages.flatMap((text, index) => [
    { role: 'user', content: text },
    { role: 'model', content: `reply ${index}` }
  ])
  const filePath = path.join(chatsDir, `chat_${id}.json`)
  fs.writeFileSync(filePath, JSON.stringify({ id, title: 'T', messages }, null, 2))
  return filePath
}

const tempRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'prism-memory-test-'))

test('store catch-up extracts real chat files, persists, and is idempotent', () => {
  const root = tempRoot()
  try {
    writeChatFile(root, 'chat-a', ['Meu nome é Ana.', 'Moro em São Paulo.'])
    const service = createMemoryService({
      chatsDir: path.join(root, 'chats'),
      memoryDir: path.join(root, 'memory')
    })
    const report = service.startupCatchUp()
    assert.equal(report.chatsProcessed, 1)
    assert.ok(report.commits + report.suggestions >= 2)

    const entries = service.list()
    assert.ok(entries.some((entry) => entry.factKey === 'user.name=ana'))
    assert.ok(entries.some((entry) => entry.factKey === 'user.location=sao-paulo'))
    assert.ok(entries.every((entry) => entry.tier === 'possible'))

    // Idempotent: a second catch-up over the same files adds nothing.
    const again = service.startupCatchUp()
    assert.equal(again.chatsProcessed, 0)
    assert.equal(service.stats().total, entries.length)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('store CRUD: update, pin, archive, restore, remove, stats', () => {
  const root = tempRoot()
  try {
    writeChatFile(root, 'chat-b', ['Meu nome é Bruno.'])
    const service = createMemoryService({
      chatsDir: path.join(root, 'chats'),
      memoryDir: path.join(root, 'memory')
    })
    service.startupCatchUp()
    const [entry] = service.list()

    const updated = service.update(entry.id, { pinned: true, content: 'Pode me chamar de Bruno.' })
    assert.ok(updated)
    assert.equal(updated.pinned, true)
    assert.ok(updated.keywords.length > 0)

    assert.equal(service.archive(entry.id), true)
    assert.equal(service.list().length, 0)
    assert.equal(service.list({ includeArchived: true }).length, 1)
    assert.equal(service.restore(entry.id), true)
    assert.equal(service.list().length, 1)

    const stats = service.stats()
    assert.equal(stats.total, 1)
    assert.equal(stats.pinned, 1)

    assert.equal(service.remove(entry.id), true)
    assert.equal(service.stats().total, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('store supersedes and forgets across chats end to end', () => {
  const root = tempRoot()
  try {
    writeChatFile(root, 'chat-c1', ['Eu gosto de café.'])
    writeChatFile(root, 'chat-c2', ['Na verdade, eu odeio café.'])
    const service = createMemoryService({
      chatsDir: path.join(root, 'chats'),
      memoryDir: path.join(root, 'memory')
    })
    service.startupCatchUp()
    const live = service.list({ includeArchived: false })
    const coffee = live.filter((entry) => entry.factKey?.startsWith('pref.cafe'))
    // Chat c1 suggested pref.cafe (+); chat c2 superseded it (−).
    assert.equal(coffee.length, 1)
    assert.equal(coffee[0].polarity, 'negative')
    const archived = service.list({ includeArchived: true }).filter((entry) => entry.archived)
    assert.equal(archived.length, 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('headless E2E chain: extraction → store write → recall + pinned core blocks', () => {
  const root = tempRoot()
  try {
    writeChatFile(root, 'e2e', [
      'Lembra que eu gosto de café com leite.',
      'Lembra que a minha idade é 19 anos.'
    ])
    const service = createMemoryService({
      chatsDir: path.join(root, 'chats'),
      memoryDir: path.join(root, 'memory')
    })
    // 1. Extraction over a real chat file (same shape Prism persists).
    const report = service.startupCatchUp()
    assert.equal(report.errors, 0)
    assert.ok(report.commits >= 1)

    const committed = service.list().filter((entry) => entry.tier === 'committed' && !entry.archived)
    const coffee = committed.find((entry) => entry.content.includes('café'))
    const age = committed.find((entry) => entry.content.includes('19 anos'))
    assert.ok(coffee)
    assert.ok(age)

    // 2. User pins the coffee preference to the core profile (USER.md analog).
    service.update(coffee!.id, { pinned: true })

    // 3. Core Profile block assembled exactly like systemTools' call site.
    const coreBlock = buildMemoryContextBlock(service.list(), {
      pinnedOnly: true,
      maxChars: 600,
      maxEntries: 8,
      header: MEMORY_PROFILE_HEADER
    })
    assert.ok(coreBlock)
    assert.ok(coreBlock.includes('café'))
    assert.ok(coreBlock.length <= 600)
    assert.ok(coreBlock.startsWith(MEMORY_PROFILE_HEADER))

    // 4. Per-turn recall block assembled exactly like chatHandler/discordGateway.
    const recallBlock = buildTurnRecallBlock(service.list(), 'qual é a minha idade?')
    assert.ok(recallBlock)
    assert.ok(recallBlock.includes('19 anos'))
    assert.ok(!recallBlock.includes('café')) // pinned already rides the core block
    assert.ok(recallBlock.length <= 900)
    assert.ok(recallBlock.startsWith(MEMORY_GUARD_HEADER))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
