import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  changesDiff,
  parsePatchSections,
  replaceUnique,
  replaceUniqueAfter
} from '../src/main/harnessFileOperations.ts'
import { resolveHarnessProjectPath } from '../src/main/harnessPathPolicy.ts'
import { harnessWildcardRegex } from '../src/main/harnessGlob.ts'
import {
  buildHarnessSystemPrompt,
  getHarnessInstructionStatus,
  HARNESS_SYSTEM_MAX_CHARACTERS
} from '../src/main/harnessPrompt.ts'
import type { EffectiveHarnessSettings } from '../src/shared/types.ts'

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

test('Harness instructions preserve precedence and cap oversized AGENTS.md', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-harness-prompt-'))
  try {
    await fs.writeFile(path.join(root, 'AGENTS.md'), `REPO_MARKER\n${'r'.repeat(90_000)}`)
    const settings: EffectiveHarnessSettings = {
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
    assert.ok(result.prompt.indexOf('GLOBAL_MARKER') < result.prompt.indexOf('REPO_MARKER'))
    assert.ok(result.prompt.indexOf('REPO_MARKER') < result.prompt.indexOf('PROJECT_MARKER'))
    assert.ok(result.prompt.length <= HARNESS_SYSTEM_MAX_CHARACTERS)
    assert.ok(result.warnings.some((warning) => warning.includes('AGENTS.md')))
    assert.deepEqual(
      result.entries.map((entry) => entry.kind),
      ['system', 'global', 'repo', 'project']
    )
    assert.equal(result.entries[2].content.includes('REPO_MARKER'), true)

    const status = await getHarnessInstructionStatus(settings)
    assert.equal(status.repoExists, true)
    assert.ok(status.repoIncludedCharacters < status.repoCharacters)
    assert.ok(status.estimatedTokens <= 20_000)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
