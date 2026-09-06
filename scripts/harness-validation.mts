import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { installBrokenPipeGuard } from '../src/main/brokenPipeGuard.ts'
import {
  changesDiff,
  parsePatchSections,
  replaceUnique,
  replaceUniqueAfter
} from '../src/main/harnessFileOperations.ts'
import { resolveHarnessProjectPath } from '../src/main/harnessPathPolicy.ts'
import {
  getHarnessToolNamesForPhase,
  isReadOnlyHarnessPlanCommand
} from '../src/main/harnessPlan.ts'
import {
  materializeQuestionnaireResponses,
  normalizeQuestionnaire,
  QUESTIONNAIRE_CUSTOM_OPTION_VALUE
} from '../src/shared/questionnaire.ts'
import {
  buildHarnessImplementationHandoff,
  parseHarnessPlanCommand
} from '../src/shared/harnessPlanCommand.ts'
import { harnessWildcardRegex } from '../src/main/harnessGlob.ts'
import { grepFiles } from '../src/main/harnessGrep.ts'
import {
  buildHarnessSystemPrompt,
  getHarnessInstructionStatus,
  HARNESS_SYSTEM_MAX_CHARACTERS
} from '../src/main/harnessPrompt.ts'
import {
  createPinnedModelInvoker,
  resolveRequestModelKey,
  resolveRunWorkspace
} from '../src/main/ai/sessionRuntime.ts'
import {
  PerChatStreamBuffer,
  thinkingDurationSeconds
} from '../src/renderer/src/chatStreamBuffer.ts'
import {
  asHarnessRecord,
  decodeHarnessToolResult,
  stringifyHarnessValue
} from '../src/renderer/src/harnessToolPresentation.ts'
import { applyToolCallEnd, applyToolCallStart } from '../src/renderer/src/toolCallState.ts'
import {
  getHarnessGitSnapshot,
  parseHarnessGitStatus,
  runHarnessGitAction
} from '../src/main/harnessGit.ts'
import type {
  EffectiveHarnessSettings,
  HarnessStartupProjectMode,
  HarnessProjectConfig
} from '../src/shared/types.ts'

const execFileAsync = promisify(execFile)

test('edit and delete snippets require one exact match', () => {
  assert.equal(
    replaceUnique('before\ntarget\nafter', 'target', 'changed'),
    'before\nchanged\nafter'
  )
  assert.equal(replaceUnique('before\ntarget\nafter', 'target\n', ''), 'before\nafter')
  assert.throws(() => replaceUnique('same\nsame', 'same', ''), /matched 2 locations/)
  assert.throws(() => replaceUnique('content', 'missing', ''), /not found/)
})

test('Codex patch envelope parses add, scoped update, move, and delete operations', () => {
  const sections = parsePatchSections(`*** Begin Patch
*** Add File: src/new.ts
+export const created = true
*** Update File: src/old.ts
*** Move to: src/moved.ts
@@ function run()
-  return false
+  return true
*** Delete File: src/unused.ts
*** End Patch`)
  assert.deepEqual(
    sections.map(({ kind, path: filePath, moveTo }) => ({ kind, path: filePath, moveTo })),
    [
      { kind: 'add', path: 'src/new.ts', moveTo: undefined },
      { kind: 'update', path: 'src/old.ts', moveTo: 'src/moved.ts' },
      { kind: 'delete', path: 'src/unused.ts', moveTo: undefined }
    ]
  )
  assert.throws(() => parsePatchSections('*** Add File: no-envelope'), /Begin Patch/)
})

test('scoped patch replacement disambiguates repeated code after an @@ header', () => {
  const source = 'class First\nreturn false\nclass Second\nreturn false\n'
  const scope = source.indexOf('class Second') + 'class Second'.length
  const result = replaceUniqueAfter(source, 'return false', 'return true', scope)
  assert.equal(result.content, 'class First\nreturn false\nclass Second\nreturn true\n')
})

test('diff output is compact Git-style text', () => {
  const diff = changesDiff([
    { kind: 'update', path: 'src/a.ts', before: 'one\ntwo\nthree', after: 'one\nchanged\nthree' }
  ])
  assert.match(diff, /^--- a\/src\/a\.ts/m)
  assert.match(diff, /^\+\+\+ b\/src\/a\.ts/m)
  assert.match(diff, /^-two$/m)
  assert.match(diff, /^\+changed$/m)
})

test('find wildcard distinguishes one directory level from recursive matches', () => {
  const oneLevel = harnessWildcardRegex('src/*.ts')
  const recursive = harnessWildcardRegex('src/**/*.ts')
  assert.equal(oneLevel.test('src/index.ts'), true)
  assert.equal(oneLevel.test('src/deep/index.ts'), false)
  assert.equal(recursive.test('src/index.ts'), true)
  assert.equal(recursive.test('src/deep/index.ts'), true)
})

test('grepFiles searches code returning 1-based line numbers and respects filters and exclusions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-harness-grep-'))
  try {
    await fs.mkdir(path.join(root, 'src', 'utils'), { recursive: true })
    await fs.mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'src', 'index.ts'),
      '// entry\nexport function runMain() {\n  return 42\n}\n'
    )
    await fs.writeFile(
      path.join(root, 'src', 'utils', 'helper.ts'),
      'export function helper() {\n  // RUNMAIN helper\n  return 100\n}\n'
    )
    await fs.writeFile(
      path.join(root, 'src', 'doc.md'),
      '# Documentation\nMentions runMain here\n'
    )
    await fs.writeFile(
      path.join(root, 'node_modules', 'pkg', 'ignored.ts'),
      'export function runMain() {}\n'
    )
    // Binary file
    await fs.writeFile(path.join(root, 'src', 'asset.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))

    // 1. Literal case-insensitive search
    const allMatches = await grepFiles(root, root, 'runmain')
    assert.equal(allMatches.totalMatches, 3)
    assert.deepEqual(
      allMatches.matches.map((m) => ({ path: m.path.replace(/\\/g, '/'), lines: m.lines })),
      [
        { path: 'src/doc.md', lines: [2] },
        { path: 'src/index.ts', lines: [2] },
        { path: 'src/utils/helper.ts', lines: [2] }
      ]
    )

    // 2. Case-sensitive search
    const exactMatches = await grepFiles(root, root, 'runMain', { caseSensitive: true })
    assert.equal(exactMatches.totalMatches, 2)
    assert.deepEqual(
      exactMatches.matches.map((m) => ({ path: m.path.replace(/\\/g, '/'), lines: m.lines })),
      [
        { path: 'src/doc.md', lines: [2] },
        { path: 'src/index.ts', lines: [2] }
      ]
    )

    // 3. Glob filtering via include
    const tsMatches = await grepFiles(root, root, 'runmain', { include: '*.ts' })
    assert.equal(tsMatches.totalMatches, 2)
    assert.deepEqual(
      tsMatches.matches.map((m) => ({ path: m.path.replace(/\\/g, '/'), lines: m.lines })),
      [
        { path: 'src/index.ts', lines: [2] },
        { path: 'src/utils/helper.ts', lines: [2] }
      ]
    )

    // 4. Regex search
    const regexMatches = await grepFiles(root, root, 'function\\s+\\w+', { isRegex: true })
    assert.equal(regexMatches.totalMatches, 2)
    assert.deepEqual(
      regexMatches.matches.map((m) => ({ path: m.path.replace(/\\/g, '/'), lines: m.lines })),
      [
        { path: 'src/index.ts', lines: [2] },
        { path: 'src/utils/helper.ts', lines: [1] }
      ]
    )

    // 5. Smart-case search (automatic case-sensitivity when uppercase letters present)
    const smartCaseMatches = await grepFiles(root, root, 'RUNMAIN')
    assert.equal(smartCaseMatches.totalMatches, 1)
    assert.deepEqual(
      smartCaseMatches.matches.map((m) => ({ path: m.path.replace(/\\/g, '/'), lines: m.lines })),
      [{ path: 'src/utils/helper.ts', lines: [2] }]
    )

    // 6. Explicit caseSensitive: false overrides smart-case
    const forcedInsensitive = await grepFiles(root, root, 'RUNMAIN', { caseSensitive: false })
    assert.equal(forcedInsensitive.totalMatches, 3)

    // 7. WordMatch (whole word boundary)
    const wordMatches = await grepFiles(root, root, 'runMain', { wordMatch: true })
    assert.equal(wordMatches.totalMatches, 2)
    assert.deepEqual(
      wordMatches.matches.map((m) => ({ path: m.path.replace(/\\/g, '/'), lines: m.lines })),
      [
        { path: 'src/doc.md', lines: [2] },
        { path: 'src/index.ts', lines: [2] }
      ]
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Harness path policy rejects absolute paths and traversal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-harness-path-'))
  try {
    await fs.mkdir(path.join(root, 'src'))
    await fs.writeFile(path.join(root, 'src', 'index.ts'), 'ok')
    assert.equal(
      await resolveHarnessProjectPath(root, 'src/index.ts'),
      path.join(root, 'src', 'index.ts')
    )
    await assert.rejects(() => resolveHarnessProjectPath(root, '../outside.txt'), /escapes/)
    await assert.rejects(
      () => resolveHarnessProjectPath(root, path.resolve(root, 'src')),
      /relative/
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Plan mode terminal gate permits inspection and rejects mutation or external paths', () => {
  assert.equal(isReadOnlyHarnessPlanCommand('git status --short'), true)
  assert.equal(isReadOnlyHarnessPlanCommand('rg -n "Harness" src'), true)
  assert.equal(isReadOnlyHarnessPlanCommand('Get-Content src/main/index.ts'), true)
  assert.equal(isReadOnlyHarnessPlanCommand('Set-Content src/main/index.ts changed'), false)
  assert.equal(isReadOnlyHarnessPlanCommand('Get-Content ../secret.txt'), false)
  assert.equal(isReadOnlyHarnessPlanCommand('git status; git reset --hard'), false)
  assert.equal(isReadOnlyHarnessPlanCommand('rg Harness | Set-Content result.txt'), false)
})

test('Plan phase exposes inspection plus plan and never exposes mutation tools', () => {
  const enabled = [
    'read',
    'to_ask',
    'write',
    'apply_patch',
    'exec_command',
    'web_search'
  ] as const
  assert.deepEqual(getHarnessToolNamesForPhase([...enabled], 'plan'), [
    'read',
    'to_ask',
    'exec_command',
    'web_search',
    'plan'
  ])
  assert.deepEqual(getHarnessToolNamesForPhase([...enabled, 'plan'], 'build'), [...enabled])
  assert.deepEqual(getHarnessToolNamesForPhase(['read'], 'plan'), ['read', 'to_ask', 'plan'])
})

test('Harness recognizes only the dollar-prefixed Plan command and preserves its request', () => {
  assert.deepEqual(parseHarnessPlanCommand('$plan'), { matched: true, request: '' })
  assert.deepEqual(parseHarnessPlanCommand('$PLAN inspect this project'), {
    matched: true,
    request: 'inspect this project'
  })
  assert.equal(parseHarnessPlanCommand('/plan inspect this project').matched, false)
  assert.equal(parseHarnessPlanCommand('$planner').matched, false)
})

test('Build handoff combines the approved plan and prepared context', () => {
  const handoff = buildHarnessImplementationHandoff('## Steps\n- Change runtime', '## Context\nUse project A')
  assert.match(handoff, /# Approved Implementation Plan/)
  assert.match(handoff, /Change runtime/)
  assert.match(handoff, /# Implementation Context/)
  assert.match(handoff, /Use project A/)
  assert.match(handoff, /Begin implementing this plan now/)
})

test('Questionnaires normalize multiple selection, limits, and the native write-in option', () => {
  const questions = normalizeQuestionnaire([
    {
      id: 'features',
      type: 'multiple-select',
      title: 'Features',
      prompt: 'Choose features',
      max_selections: 2,
      options: [
        {
          value: 'search',
          label: 'Search',
          description: 'Search the current project.',
          recommended: true
        },
        { value: QUESTIONNAIRE_CUSTOM_OPTION_VALUE, label: 'Conflicting custom value' }
      ]
    },
    {
      id: 'approach',
      type: 'multiple-choice',
      title: 'Approach',
      prompt: 'Choose one',
      options: [{ value: 'native', label: 'Native' }]
    }
  ])

  assert.equal(questions[0].max_selections, 2)
  assert.equal(questions[0].options?.[0].description, 'Search the current project.')
  assert.equal(questions[0].options?.[0].recommended, true)
  assert.deepEqual(
    questions[0].options?.map((option) => option.value),
    ['search', QUESTIONNAIRE_CUSTOM_OPTION_VALUE]
  )
  assert.equal(questions[1].max_selections, undefined)
  assert.equal(questions[1].options?.at(-1)?.label, 'Write your own answer')

  assert.deepEqual(
    materializeQuestionnaireResponses(
      questions,
      {
        features: ['search', QUESTIONNAIRE_CUSTOM_OPTION_VALUE],
        approach: QUESTIONNAIRE_CUSTOM_OPTION_VALUE
      },
      { features: 'Timeline', approach: 'Custom architecture' }
    ),
    {
      features: ['Search', 'Timeline'],
      approach: 'Custom architecture'
    }
  )
})

test('Harness instructions preserve precedence and cap oversized AGENTS.md', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-harness-prompt-'))
  try {
    await fs.writeFile(path.join(root, 'AGENTS.md'), `REPO_MARKER\n${'r'.repeat(90_000)}`)
    const settings: EffectiveHarnessSettings = {
      toolManifestVersion: 2,
      projectsRoot: root,
      defaultPermissionMode: 'ask',
      defaultMaxRounds: 200,
      enabledTools: ['read', 'edit', 'delete_lines', 'apply_patch'],
      maxReadLines: 800,
      maxReadCharacters: 80_000,
      maxTerminalOutputCharacters: 100_000,
      maxContextCharacters: 80_000,
      webPageCount: 5,
      showSteps: true,
      showThinking: true,
      animateActivity: true,
      reduceMotion: false,
      userGlobalInstructions: 'GLOBAL_MARKER',
      yoloAcknowledged: false,
      project: {
        rootPath: root,
        displayName: 'Prompt test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        userProjectInstructions: 'PROJECT_MARKER'
      }
    }
    const result = await buildHarnessSystemPrompt(settings)
    assert.equal(result.prompt.includes('MUST call to_ask'), true)
    assert.ok(result.prompt.indexOf('GLOBAL_MARKER') < result.prompt.indexOf('REPO_MARKER'))
    assert.ok(result.prompt.indexOf('REPO_MARKER') < result.prompt.indexOf('PROJECT_MARKER'))
    assert.ok(result.prompt.length <= HARNESS_SYSTEM_MAX_CHARACTERS)
    assert.ok(result.warnings.some((warning) => warning.includes('AGENTS.md')))
    assert.deepEqual(
      result.entries.map((entry) => entry.kind),
      ['system', 'global', 'repo', 'project']
    )
    assert.equal(result.entries[2].content.includes('REPO_MARKER'), true)

    const planResult = await buildHarnessSystemPrompt(settings, '@test/harness', 'plan')
    assert.match(planResult.prompt, /# Plan mode/)
    assert.match(planResult.prompt, /call the plan tool/)
    assert.match(planResult.prompt, /MUST NOT create, edit, move, or delete files/)
    assert.match(planResult.prompt, /whenever there is uncertainty, missing information/)
    assert.match(planResult.prompt, /fully aligned with no material gaps/)
    assert.notEqual(planResult.fingerprint, result.fingerprint)

    const status = await getHarnessInstructionStatus(settings)
    assert.equal(status.repoExists, true)
    assert.ok(status.repoIncludedCharacters < status.repoCharacters)
    assert.ok(status.estimatedTokens <= 20_000)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Harness discovers Prism repo instructions in .agents/rules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-harness-prompt-rules-'))
  try {
    const instructionPath = path.join(root, '.agents', 'rules', 'AGENTS.md')
    await fs.mkdir(path.dirname(instructionPath), { recursive: true })
    await fs.writeFile(instructionPath, 'NESTED_REPO_MARKER')
    const settings: EffectiveHarnessSettings = {
      toolManifestVersion: 2,
      projectsRoot: root,
      defaultPermissionMode: 'ask',
      defaultMaxRounds: 200,
      enabledTools: ['read'],
      maxReadLines: 800,
      maxReadCharacters: 80_000,
      maxTerminalOutputCharacters: 100_000,
      maxContextCharacters: 80_000,
      webPageCount: 5,
      showSteps: true,
      showThinking: true,
      animateActivity: true,
      reduceMotion: false,
      userGlobalInstructions: '',
      yoloAcknowledged: false,
      project: { rootPath: root, displayName: 'Prompt test', createdAt: Date.now(), updatedAt: Date.now() }
    }
    const result = await buildHarnessSystemPrompt(settings)
    const status = await getHarnessInstructionStatus(settings)
    assert.match(result.prompt, /NESTED_REPO_MARKER/)
    assert.equal(result.repoInstructionsLoaded, true)
    assert.deepEqual(status.repoInstructionPaths, [instructionPath])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Harness pins its session model and never falls through to Chat selection', () => {
  assert.equal(
    resolveRequestModelKey('harness', undefined, 'provider:harness-model', 'provider:chat-model'),
    'provider:harness-model'
  )
  assert.equal(
    resolveRequestModelKey(
      'harness',
      'provider:explicit-model',
      'provider:harness-model',
      'provider:chat-model'
    ),
    'provider:explicit-model'
  )
  assert.equal(resolveRequestModelKey('harness', undefined, undefined, 'provider:chat-model'), '')
  assert.equal(resolveRunWorkspace('chat', 'harness'), 'harness')
})

test('tool rounds keep the pinned provider model after a tool response', () => {
  const observedRuns: Array<{ provider: string; model: string }> = []
  const invokePinnedModel = createPinnedModelInvoker({ id: 'harness-provider' }, 'selected-model')
  let mutableChatModel = 'chat-default'
  invokePinnedModel((provider, model) => observedRuns.push({ provider: provider.id, model }))
  mutableChatModel = 'chat-model-changed-after-tool'
  invokePinnedModel((provider, model) => observedRuns.push({ provider: provider.id, model }))
  assert.deepEqual(observedRuns, [
    { provider: 'harness-provider', model: 'selected-model' },
    { provider: 'harness-provider', model: 'selected-model' }
  ])
  assert.equal(mutableChatModel, 'chat-model-changed-after-tool')
})

test('stream frames remain isolated per chat and retain each latest cumulative chunk', () => {
  const callbacks = new Map<number, FrameRequestCallback>()
  const consumed: Array<{ chatId: string; text: string }> = []
  let nextHandle = 1
  const buffer = new PerChatStreamBuffer<{ chatId: string; text: string }>(
    (callback) => {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    },
    (handle) => callbacks.delete(handle),
    (value) => consumed.push(value)
  )

  buffer.push({ chatId: 'harness-1', text: 'partial' })
  buffer.push({ chatId: 'chat-1', text: 'chat-final' })
  buffer.push({ chatId: 'harness-1', text: 'harness-final' })
  for (const callback of [...callbacks.values()]) callback(0)

  assert.deepEqual(consumed, [
    { chatId: 'harness-1', text: 'harness-final' },
    { chatId: 'chat-1', text: 'chat-final' }
  ])
})

test('stream frame APIs retain a native-compatible global receiver', () => {
  const callbacks = new Map<number, FrameRequestCallback>()
  let scheduleReceiver: unknown
  let cancelReceiver: unknown
  const buffer = new PerChatStreamBuffer<{ chatId: string; text: string }>(
    function schedule(this: unknown, callback) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      scheduleReceiver = this
      callbacks.set(1, callback)
      return 1
    },
    function cancel(this: unknown, handle) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      cancelReceiver = this
      callbacks.delete(handle)
    },
    () => undefined
  )

  buffer.push({ chatId: 'native-frame-api', text: 'visible while streaming' })
  assert.equal(scheduleReceiver, globalThis)

  buffer.flush('native-frame-api')
  assert.equal(cancelReceiver, globalThis)
  assert.equal(callbacks.size, 0)
})

test('stream phase keeps Thinking visible across a coalesced reasoning-to-text frame', () => {
  const callbacks = new Map<number, FrameRequestCallback>()
  const consumed: Array<{
    value: { chatId: string; text: string; isThinking: boolean }
    showThinking: boolean
    activeThinking: boolean
    thinkingDurationMs: number
  }> = []
  let nextHandle = 1
  const buffer = new PerChatStreamBuffer(
    (callback) => {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    },
    (handle) => callbacks.delete(handle),
    (value, phase) =>
      consumed.push({
        value,
        showThinking: phase.showThinking,
        activeThinking: phase.activeThinking,
        thinkingDurationMs: phase.thinkingDurationMs
      })
  )

  buffer.push({ chatId: 'chat-thinking', text: 'thought', isThinking: true }, 1_000)
  buffer.push({ chatId: 'chat-thinking', text: 'answer', isThinking: false }, 3_000)
  for (const callback of [...callbacks.values()]) callback(0)

  assert.equal(consumed.length, 1)
  assert.equal(consumed[0].value.text, 'answer')
  assert.equal(consumed[0].showThinking, true)
  assert.equal(consumed[0].activeThinking, false)
  assert.equal(thinkingDurationSeconds(consumed[0].thinkingDurationMs), 2)
  assert.equal(
    thinkingDurationSeconds(buffer.finalize('chat-thinking', 5_000).thinkingDurationMs),
    2
  )
})

test('finalizing a cancelled thinking stream preserves its elapsed duration', () => {
  const buffer = new PerChatStreamBuffer(
    () => 1,
    () => undefined,
    () => undefined
  )

  buffer.push({ chatId: 'cancelled-thinking', text: 'partial', isThinking: true }, 10_000)
  const finalPhase = buffer.finalize('cancelled-thinking', 30_000)

  assert.equal(finalPhase.activeThinking, false)
  assert.equal(thinkingDurationSeconds(finalPhase.thinkingDurationMs), 20)
})

test('finalizing a cancelled response flushes its latest cumulative text', () => {
  const callbacks = new Map<number, FrameRequestCallback>()
  const consumed: Array<{ chatId: string; text: string }> = []
  const buffer = new PerChatStreamBuffer<{ chatId: string; text: string }>(
    (callback) => {
      callbacks.set(1, callback)
      return 1
    },
    (handle) => callbacks.delete(handle),
    (value) => consumed.push(value)
  )

  buffer.push({ chatId: 'cancelled-response', text: 'partial' })
  buffer.push({ chatId: 'cancelled-response', text: 'partial response received' })
  buffer.finalize('cancelled-response')

  assert.deepEqual(consumed, [
    { chatId: 'cancelled-response', text: 'partial response received' }
  ])
  assert.equal(callbacks.size, 0)
})

test('large cumulative stream payloads are retained without intermediate React updates', () => {
  const callbacks = new Map<number, FrameRequestCallback>()
  const consumed: Array<{ chatId: string; text: string }> = []
  let nextHandle = 1
  const buffer = new PerChatStreamBuffer<{ chatId: string; text: string }>(
    (callback) => {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    },
    (handle) => callbacks.delete(handle),
    (value) => consumed.push(value)
  )
  const largeText = 'x'.repeat(100_000)

  buffer.push({ chatId: 'large-chat', text: largeText.slice(0, 20) })
  buffer.push({ chatId: 'large-chat', text: largeText })
  for (const callback of [...callbacks.values()]) callback(0)

  assert.deepEqual(consumed, [{ chatId: 'large-chat', text: largeText }])
})

test('tool lifecycle reconciles by call id even when an end event arrives first', () => {
  const ended = applyToolCallEnd([], {
    callId: 'call-2',
    name: 'read',
    result: JSON.stringify({ ok: true, output: 'done' })
  })
  assert.equal(ended.length, 1)
  assert.equal(ended[0].id, 'call-2')
  assert.equal(ended[0].status, 'done')

  const restarted = applyToolCallStart(ended, {
    callId: 'call-2',
    name: 'read',
    args: { path: 'README.md' },
    timestamp: 10
  })
  assert.equal(restarted.length, 1)
  assert.equal(restarted[0].status, 'done')
  assert.equal(restarted[0].result, JSON.stringify({ ok: true, output: 'done' }))
  assert.deepEqual(restarted[0].args, { path: 'README.md' })
})

test('malformed Harness tool data is normalized into a renderable fallback', () => {
  const decoded = decodeHarnessToolResult('{not-json')
  assert.equal(decoded.outputText, '{not-json')
  assert.deepEqual(decoded.sources, [])
  assert.deepEqual(asHarnessRecord(['invalid', 'arguments']), {})

  const circular: Record<string, unknown> = {}
  circular.self = circular
  assert.equal(stringifyHarnessValue(circular), '[object Object]')
})

test('Deep Research subagent tool data decodes title, queries, and summary', () => {
  const payload = JSON.stringify({
    ok: true,
    output: JSON.stringify({
      title: 'Dominance of Chinese AI companies in the 2026 market',
      queries: [
        'Chinese AI competitiveness 2026',
        'Chinese AI benchmarks 2026',
        'Market highlight of Chinese AI companies 2026',
        'What is the state of the Chinese AI market in 2026?'
      ],
      summary: 'Comprehensive analysis exceeding 1000 characters...',
      sources: [
        {
          title: 'Source 1',
          url: 'https://example.com/article1',
          domain: 'example.com',
          faviconUrl: ''
        }
      ],
      isSubagentFetch: true
    })
  })

  const decoded = decodeHarnessToolResult(payload)
  assert.ok(decoded.fetchSubagent)
  assert.equal(decoded.fetchSubagent.title, 'Dominance of Chinese AI companies in the 2026 market')
  assert.equal(decoded.fetchSubagent.query, 'Dominance of Chinese AI companies in the 2026 market')
  assert.equal(decoded.fetchSubagent.queries?.length, 4)
  assert.equal(decoded.fetchSubagent.sources.length, 1)
})

test('closed parent log pipes do not crash the Electron main process', () => {
  const brokenPipe = new EventEmitter()
  installBrokenPipeGuard(brokenPipe)
  assert.doesNotThrow(() => {
    brokenPipe.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))
  })

  const unexpectedFailure = new EventEmitter()
  installBrokenPipeGuard(unexpectedFailure)
  assert.throws(
    () =>
      unexpectedFailure.emit('error', Object.assign(new Error('disk failure'), { code: 'EIO' })),
    /disk failure/
  )
})

test('startup project resolution respects last_opened, default_project, and prompt modes', () => {
  const projA: HarnessProjectConfig = {
    rootPath: 'C:\\Projects\\A',
    displayName: 'Project A',
    createdAt: 10,
    updatedAt: 10
  }
  const projB: HarnessProjectConfig = {
    rootPath: 'C:\\Projects\\B',
    displayName: 'Project B',
    createdAt: 20,
    updatedAt: 20
  }

  const resolveStartup = (
    mode: HarnessStartupProjectMode,
    defaultPath?: string,
    lastPath?: string,
    projects: Record<string, HarnessProjectConfig> = {}
  ): HarnessProjectConfig | null => {
    if (mode === 'prompt') return null
    if (mode === 'default_project' && defaultPath) {
      const match = Object.values(projects).find(
        (p) => p.rootPath.toLowerCase() === defaultPath.toLowerCase()
      )
      if (match) return match
    }
    if (lastPath) {
      const match = Object.values(projects).find(
        (p) => p.rootPath.toLowerCase() === lastPath.toLowerCase()
      )
      if (match) return match
    }
    const list = Object.values(projects)
    return list[0] || null
  }

  const projects = {
    'c:\\projects\\a': projA,
    'c:\\projects\\b': projB
  }

  // 1. prompt mode -> null
  assert.equal(resolveStartup('prompt', 'C:\\Projects\\B', 'C:\\Projects\\A', projects), null)

  // 2. default_project mode -> projB
  assert.equal(
    resolveStartup('default_project', 'C:\\Projects\\B', 'C:\\Projects\\A', projects)?.rootPath,
    'C:\\Projects\\B'
  )

  // 3. last_opened mode -> projA
  assert.equal(
    resolveStartup('last_opened', 'C:\\Projects\\B', 'C:\\Projects\\A', projects)?.rootPath,
    'C:\\Projects\\A'
  )

  // 4. default_project mode fallback when defaultPath missing -> last opened
  assert.equal(
    resolveStartup('default_project', undefined, 'C:\\Projects\\A', projects)?.rootPath,
    'C:\\Projects\\A'
  )
})

test('deleteHarnessProject logic cleans up project dictionary and referenced paths', () => {
  const projA = { rootPath: 'C:\\Projects\\A', displayName: 'Project A' }
  const projB = { rootPath: 'C:\\Projects\\B', displayName: 'Project B' }

  let currentSettings = {
    projects: {
      'c:\\projects\\a': projA,
      'c:\\projects\\b': projB
    },
    lastProjectPath: 'C:\\Projects\\A',
    defaultProjectPath: 'C:\\Projects\\A'
  }

  const deleteProject = (pathToDelete: string): void => {
    const key = pathToDelete.toLowerCase()
    const updatedProjects = { ...currentSettings.projects }
    delete updatedProjects[key as keyof typeof updatedProjects]

    const remaining = Object.values(updatedProjects)
    let nextLast = currentSettings.lastProjectPath
    if (nextLast && nextLast.toLowerCase() === key) {
      nextLast = remaining[0]?.rootPath
    }
    let nextDefault = currentSettings.defaultProjectPath
    if (nextDefault && nextDefault.toLowerCase() === key) {
      nextDefault = undefined
    }

    currentSettings = {
      projects: updatedProjects,
      lastProjectPath: nextLast || '',
      defaultProjectPath: nextDefault
    }
  }

  deleteProject('C:\\Projects\\A')
  assert.equal(Object.keys(currentSettings.projects).length, 1)
  assert.equal(currentSettings.lastProjectPath, 'C:\\Projects\\B')
  assert.equal(currentSettings.defaultProjectPath, undefined)
})

test('check folder existence safely reports missing without throwing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-harness-proj-test-'))
  const missingDir = path.join(tempDir, 'does-not-exist')

  const checkFolder = async (
    folderPath: string
  ): Promise<{ exists: boolean; isDirectory: boolean }> => {
    try {
      const stat = await fs.stat(folderPath)
      return { exists: true, isDirectory: stat.isDirectory() }
    } catch {
      return { exists: false, isDirectory: false }
    }
  }

  const before = await checkFolder(missingDir)
  assert.equal(before.exists, false)
  assert.equal(before.isDirectory, false)

  await fs.mkdir(missingDir, { recursive: true })
  const after = await checkFolder(missingDir)
  assert.equal(after.exists, true)
  assert.equal(after.isDirectory, true)

  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
})

test('Git Control parses porcelain state and performs local checkpoint operations safely', async () => {
  assert.deepEqual(parseHarnessGitStatus(' M src/app.ts\0?? notes.md\0UU conflict.ts\0'), [
    { path: 'src/app.ts', indexStatus: ' ', workTreeStatus: 'M', isUntracked: false, isConflicted: false },
    { path: 'notes.md', indexStatus: '?', workTreeStatus: '?', isUntracked: true, isConflicted: false },
    { path: 'conflict.ts', indexStatus: 'U', workTreeStatus: 'U', isUntracked: false, isConflicted: true }
  ])

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-harness-git-'))
  const runGit = async (...args: string[]): Promise<void> => {
    await execFileAsync('git', args, { cwd: root, windowsHide: true })
  }
  try {
    await runGit('init')
    await runGit('config', 'user.name', 'Harness Test')
    await runGit('config', 'user.email', 'harness-test@example.invalid')
    await fs.writeFile(path.join(root, 'README.md'), '# Harness\n')
    await runGit('add', '.')
    await runGit('commit', '-m', 'Initial commit')

    await fs.writeFile(path.join(root, 'README.md'), '# Harness\n\nGit Control\n')
    const initial = await getHarnessGitSnapshot(root)
    assert.equal(initial.isGit, true)
    assert.equal(initial.files.length, 1)
    assert.ok(initial.branch)

    const committed = await runHarnessGitAction(root, {
      kind: 'commit',
      options: {
        message: 'Add Git Control coverage',
        sign: false,
        signoff: true,
        coAuthor: {
          name: 'brnalemusic',
          email: 'brenoalexandre.music@gmail.com'
        }
      }
    })
    assert.equal(committed.ok, true)
    assert.equal(committed.snapshot.files.length, 0)
    assert.equal(committed.snapshot.commits[0]?.subject, 'Add Git Control coverage')
    const commitBody = await execFileAsync('git', ['log', '-1', '--format=%B'], {
      cwd: root,
      windowsHide: true
    })
    assert.match(
      commitBody.stdout,
      /Co-authored-by: brnalemusic <brenoalexandre\.music@gmail\.com>/
    )

    const created = await runHarnessGitAction(root, { kind: 'createBranch', name: 'checkpoint-test' })
    assert.equal(created.ok, true)
    assert.equal(created.snapshot.branch, 'checkpoint-test')
    const renamed = await runHarnessGitAction(root, {
      kind: 'renameBranch',
      from: 'checkpoint-test',
      to: 'checkpoint-renamed'
    })
    assert.equal(renamed.ok, true)
    assert.equal(renamed.snapshot.branch, 'checkpoint-renamed')

    const initialBranch = initial.branch!
    const switched = await runHarnessGitAction(root, {
      kind: 'switchBranch',
      name: initialBranch
    })
    assert.equal(switched.ok, true)
    assert.equal(switched.snapshot.branch, initialBranch)
    assert.equal(
      switched.snapshot.branches.find((branch) => branch.name === initialBranch)?.isCurrent,
      true
    )

    const switchedBack = await runHarnessGitAction(root, {
      kind: 'switchBranch',
      name: 'checkpoint-renamed'
    })
    assert.equal(switchedBack.ok, true)
    assert.equal(switchedBack.snapshot.branch, 'checkpoint-renamed')

    const reset = await runHarnessGitAction(root, {
      kind: 'reset',
      hash: 'HEAD~1',
      mode: 'soft'
    })
    assert.equal(reset.ok, true)
    assert.ok(reset.snapshot.files.length > 0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
