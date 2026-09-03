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
import { createMemoryService, executeMemoryTool } from '../src/main/memoryStore.ts'

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

test('PT: lone self-disclosure auto-commits (first-person slots are high-precision)', () => {
  const result = runExtraction(base(['Meu nome é Ana.']))
  assert.equal(result.commits.length, 1)
  assert.equal(result.commits[0].factKey, 'user.name=ana')
  assert.ok(result.commits[0].confidence >= 0.8)
  assert.equal(result.suggestions.length, 0)
})

test('EN: lone structured slot auto-commits', () => {
  const result = runExtraction(base(['I live in São Paulo.']))
  assert.equal(result.commits.length, 1)
  assert.equal(result.commits[0].factKey, 'user.location=sao-paulo')
  assert.equal(result.suggestions.length, 0)
})

test('PT/EN: bare preference auto-commits with positive polarity', () => {
  for (const message of ['Eu gosto muito de café.', 'I really love coffee.']) {
    const result = runExtraction(base([message]))
    assert.equal(result.commits.length, 1, message)
    assert.equal(result.suggestions.length, 0, message)
    assert.ok(result.commits[0].factKey?.startsWith('pref.'), message)
    assert.equal(result.commits[0].polarity, 'positive', message)
  }
})

test('PT/EN: negative preference commits with negative polarity', () => {
  for (const message of ['Eu odeio café.', "I don't like cilantro."]) {
    const result = runExtraction(base([message]))
    assert.equal(result.commits.length, 1, message)
    assert.equal(result.commits[0].polarity, 'negative', message)
    assert.ok(result.commits[0].factKey?.startsWith('pref.'), message)
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

test('an independent re-mention promotes a seeded possible memory to committed', () => {
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
  assert.ok(ptProject.commits[0].factKey?.startsWith('user.project='))
  const enPet = runExtraction(base(['I have a dog named Rex.']))
  assert.equal(enPet.commits[0].factKey, 'user.family.pet=dog')
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
    assert.ok(entries.some((entry) => entry.tier === 'committed'))

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
// ---------------------------------------------------------------------------
// AI memory tool (Hermes-style USER.md / MEMORY.md management)
// ---------------------------------------------------------------------------

test('memory tool: add commits to the right store, respects budgets and guards', () => {
  const root = tempRoot()
  try {
    const service = createMemoryService({
      chatsDir: path.join(root, 'chats'),
      memoryDir: path.join(root, 'memory')
    })
    const add = (target: 'user' | 'memory', content: string) =>
      service.memoryTool({ action: 'add', target, content }, 'chat-tool-1')

    const userFact = add('user', 'O usuário prefere respostas curtas.')
    assert.equal(userFact.ok, true)
    assert.ok(userFact.usage.includes('user '))
    assert.ok(userFact.entry)
    assert.equal(userFact.entry!.tier, 'committed')
    assert.equal(userFact.entry!.kind, 'preference')
    assert.equal(userFact.entry!.polarity, 'positive')
    assert.ok(userFact.entry!.factKey!.startsWith('tool.user.'))

    const memoryFact = add('memory', 'O projeto usa React 19.')
    assert.equal(memoryFact.ok, true)
    assert.equal(memoryFact.entry!.kind, 'fact')

    // Duplicate rejected without writing.
    const dup = add('user', 'O usuário prefere respostas curtas.')
    assert.equal(dup.ok, true)
    assert.ok(dup.message.includes('duplicate'))
    assert.equal(service.list().length, 2)

    // The tool never writes 'possible' entries.
    assert.equal(service.list().some((m) => m.tier === 'possible'), false)

    // Security gate refuses credentials.
    const secret = add('memory', 'Minha senha é hunter2 e meu token api_key=abc123')
    assert.equal(secret.ok, false)
    assert.ok(secret.message.includes('secret') || secret.message.includes('credential'))

    // Per-entry cap.
    assert.equal(add('memory', 'x'.repeat(400)).ok, false)

    // Budget error surfaces usage for consolidation.
    const overBudget = add('user', 'y'.repeat(1400))
    assert.equal(overBudget.ok, false)
    assert.ok(overBudget.usage.includes('1375'))

    // Adapter used by the tool runtime round-trips through the same path.
    const adapter = JSON.parse(
      executeMemoryTool({ action: 'add', target: 'user', content: 'O usuário gosta de café.' }, 'c1')
    )
    assert.equal(adapter.ok, true)
    assert.ok(adapter.entry.factKey.startsWith('tool.user.'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('memory tool: replace and remove via unique substring, ambiguity refused', () => {
  const root = tempRoot()
  try {
    const service = createMemoryService({
      chatsDir: path.join(root, 'chats'),
      memoryDir: path.join(root, 'memory')
    })
    service.memoryTool({ action: 'add', target: 'user', content: 'O usuário se chama Ana.' }, 'c1')
    service.memoryTool({ action: 'add', target: 'user', content: 'O usuário mora em São Paulo.' }, 'c1')

    // Replace with a unique substring.
    const replaced = service.memoryTool(
      { action: 'replace', target: 'user', old_text: 'se chama Ana', content: 'O usuário se chama Ana Clara.' },
      'c1'
    )
    assert.equal(replaced.ok, true)
    assert.equal(replaced.entry!.content, 'O usuário se chama Ana Clara.')
    assert.equal(replaced.entry!.confidence, 0.95)
    assert.ok(replaced.entry!.keywords.length > 0)

    // Ambiguity: substring matches two entries.
    const ambiguous = service.memoryTool({ action: 'remove', target: 'user', old_text: 'O usuário' }, 'c1')
    assert.equal(ambiguous.ok, false)
    assert.ok(Array.isArray(ambiguous.matches) && ambiguous.matches.length === 2)

    // No match lists current entries as guidance.
    const missing = service.memoryTool({ action: 'remove', target: 'user', old_text: 'não existe isso' }, 'c1')
    assert.equal(missing.ok, false)
    assert.ok(Array.isArray(missing.matches) && missing.matches.length >= 1)

    // Remove soft-archives (restorable).
    const removed = service.memoryTool({ action: 'remove', target: 'user', old_text: 'se chama Ana Clara' }, 'c1')
    assert.equal(removed.ok, true)
    assert.equal(service.list().length, 1)
    assert.equal(service.list({ includeArchived: true }).filter((m) => m.archived).length, 1)

    // Target scoping: preference content on 'memory' never touches the user scope.
    service.memoryTool({ action: 'add', target: 'memory', content: 'O usuário prefere café forte.' }, 'c1')
    const userScope = service.list().filter((m) => m.kind === 'preference')
    assert.equal(userScope.length, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})


// ---------------------------------------------------------------------------
// Adversarial robustness corpus — messy PT-BR / EN real speech
// ---------------------------------------------------------------------------

test('adversarial corpus: triggers, natural phrasings, corrections, negation, multi-intent, precision', () => {
  const cases = [
    { id: 't1', lang: 'PT', msg: 'lembre que eu gosto de café', commitKeys: ['pref.cafe'], pos: true },
    { id: 't2', lang: 'PT', msg: 'Lembra que meu aniversário é 12/03', commitKeys: ['user.birthday'] },
    { id: 't3', lang: 'PT', msg: 'me chame de Ana', commitKeys: ['user.name'] },
    { id: 't4', lang: 'EN', msg: 'remember that I love pizza', commitKeys: ['pref.pizza'], pos: true },
    { id: 't5', lang: 'PT', msg: 'lembre q eu gosto de café', commitKeys: ['pref.cafe'], pos: true },
    { id: 'n1', lang: 'PT', msg: 'eu tenho 24 anos', commitKeys: ['user.age'] },
    { id: 'n2', lang: 'EN', msg: "i'm 24 years old", commitKeys: ['user.age'] },
    { id: 'n3', lang: 'PT', msg: 'moro em Porto Alegre', commitKeys: ['user.location'] },
    { id: 'n4', lang: 'EN', msg: 'I live in Lisbon', commitKeys: ['user.location'] },
    { id: 'n5', lang: 'PT', msg: 'sou desenvolvedor', commitKeys: ['user.occupation'] },
    { id: 'n6', lang: 'EN', msg: "i'm a developer", commitKeys: ['user.occupation'] },
    { id: 'n7', lang: 'PT', msg: 'meu nome é João', commitKeys: ['user.name'] },
    { id: 'n8', lang: 'EN', msg: 'my name is John', commitKeys: ['user.name'] },
    { id: 'n9', lang: 'PT', msg: 'tenho um cachorro chamado Rex', commitKeys: ['user.family.pet'] },
    { id: 'n10', lang: 'PT', msg: 'eu estudo engenharia', commitKeys: ['user.study'] },
    { id: 'n11', lang: 'PT', msg: 'a minha idade é 19 anos', commitKeys: ['user.age'] },
    { id: 'neg1', lang: 'PT', msg: 'eu não gosto de queijo', commitKeys: ['pref.queijo'], neg: true },
    { id: 'neg2', lang: 'PT', msg: 'odeio acordar cedo', commitKeys: ['pref.acordar'], neg: true },
    { id: 'neg3', lang: 'EN', msg: 'i hate waking up early', commitKeys: ['pref.waking'], neg: true },
    { id: 'neg4', lang: 'PT', msg: 'não suporto atraso', commitKeys: ['pref.atraso'], neg: true },
    { id: 'neg5', lang: 'EN', msg: "can't stand cilantro", commitKeys: ['pref.cilantro'], neg: true },
    { id: 'c1', lang: 'PT', msg: 'na verdade, eu não gosto de café, prefiro chá', commitKeys: ['pref.cafe', 'pref.cha'] },
    { id: 'c2', lang: 'EN', msg: 'my bad, I actually love pineapple on pizza', commitKeys: ['pref.pineapple'], pos: true },
    { id: 'sh1', lang: 'PT', msg: 'meu amigo disse que ele gosta de café' },
    { id: 'sh2', lang: 'EN', msg: 'she said she hates coffee' },
    { id: 'sh3', lang: 'PT', msg: 'no trabalho eles usam Node' },
    { id: 'sh4', lang: 'PT', msg: 'meu chefe acha que eu sou ótimo' },
    { id: 'a1', lang: 'PT', msg: 'meu amigo tem 30 anos' },
    { id: 'a2', lang: 'EN', msg: 'she adores coffee' },
    { id: 'a3', lang: 'PT', msg: 'minha mãe mora em Curitiba' },
    { id: 'a4', lang: 'PT', msg: 'meu gato gosta de atum' },
    { id: 'a5', lang: 'PT', msg: 'vocú gosta de futebol?' },
    { id: 'a6', lang: 'PT', msg: 'tenho 10 anos de experiéncia em vendas' },
    { id: 'q1', lang: 'PT', msg: 'hoje eu vou ao dentista' },
    { id: 'q2', lang: 'PT', msg: 'se eu comprar um carro, vai ser elétrico' },
    { id: 'q3', lang: 'PT', msg: 'talvez eu mude de cidade' },
    { id: 'q4', lang: 'EN', msg: 'I might move to Berlin' },
    { id: 'q5', lang: 'PT', msg: 'pretendo começar a correr' },
    { id: 'q6', lang: 'PT', msg: 'não sei se gosto de café' },
    { id: 'q7', lang: 'EN', msg: "i'm not sure if I like coffee" },
    { id: 's1', lang: 'PT', msg: 'tó ligado que vocú lembra das parada' },
    { id: 's2', lang: 'PT', msg: 'me chama de Biel', commitKeys: ['user.name'] },
    { id: 's3', lang: 'EN', msg: 'bro, call me Ace', commitKeys: ['user.name'] },
    { id: 's4', lang: 'PT', msg: 'meu nome e ana', commitKeys: ['user.name'] },
    { id: 's5', lang: 'PT', msg: 'eu gosto de cafe', commitKeys: ['pref.cafe'], pos: true },
    { id: 'm1', lang: 'PT', msg: 'meu nome é Ana e eu tenho 19 anos', commitKeys: ['user.name', 'user.age'] },
    { id: 'm2', lang: 'EN', msg: "I'm John, I live in Dublin and I love tea", commitKeys: ['user.name', 'user.location', 'pref.tea'] },
    { id: 'm3', lang: 'PT', msg: 'gosto de café mas odeio leite', commitKeys: ['pref.cafe', 'pref.leite'] },
    { id: 'm4', lang: 'PT', msg: 'meu nome é João e eu odeio acordar cedo', commitKeys: ['user.name', 'pref.acordar'] },
    { id: 'm5', lang: 'EN', msg: 'my name is John, i work as a designer', commitKeys: ['user.name', 'user.occupation'] },
    { id: 'x1', lang: 'PT', msg: 'minha senha é hunter2' },
    { id: 'x2', lang: 'EN', msg: 'my password is hunter2' },
    { id: 'x3', lang: 'PT', msg: 'api_key = sk-1234567890abcdef' },
    { id: 'q8', lang: 'PT', msg: 'vocú lembra onde eu deixei minhas chaves?' },
    { id: 'q9', lang: 'PT', msg: 'eu quero uma pizza' },
    { id: 'q10', lang: 'EN', msg: 'can you help me with Python?' },
    { id: 'q11', lang: 'PT', msg: 'não lembre disso' },
    { id: 'q12', lang: 'PT', msg: 'meu projeto X está com bug', commitKeys: ['user.project'] },
    { id: 'h1', lang: 'PT', msg: 'eu sempre tomo café de manhã', commitKeys: ['pref.cafe'], pos: true },
    { id: 'h2', lang: 'EN', msg: 'i always have coffee in the morning', commitKeys: ['pref.coffee'], pos: true },
    { id: 'h3', lang: 'PT', msg: 'eu nunca como carne', commitKeys: ['pref.carne'], neg: true },
    { id: 'h4', lang: 'PT', msg: 'minha comida favorita é pizza', commitKeys: ['pref.pizza'], pos: true },
    { id: 'h5', lang: 'PT', msg: 'faz um ano que trabalho com dados', commitKeys: ['user.occupation'] },
    { id: 'h6', lang: 'PT', msg: 'tenho 2 gatos', commitKeys: ['user.family.pet'] },
    { id: 'h7', lang: 'PT', msg: 'gosto muito de café', commitKeys: ['pref.cafe'], pos: true },
  ] as const

  for (const c of cases) {
    const message = `${c.id}: ${c.msg}`
    const result = runExtraction(base([c.msg], c.id))
    const commits = result.commits.map((w) => w.factKey ?? '')
    const suggests = result.suggestions.map((w) => w.factKey ?? '')
    if (!('commitKeys' in c)) {
      assert.equal(commits.length + suggests.length, 0, `${message}: expected none, got ${JSON.stringify(commits)}`)
      continue
    }
    for (const k of c.commitKeys) {
      const hit = result.commits.find((w) => w.factKey?.startsWith(k))
      assert.ok(hit, `${message}: missing commit ${k} (got ${JSON.stringify(commits)})`)
      if ('neg' in c && hit) assert.equal(hit.polarity, 'negative', `${message}: ${k} polarity`)
      if ('pos' in c && hit) assert.equal(hit.polarity, 'positive', `${message}: ${k} polarity`)
    }
    assert.ok(commits.length <= c.commitKeys.length, `${message}: unexpected extra commits ${JSON.stringify(commits)}`)
  }
})
