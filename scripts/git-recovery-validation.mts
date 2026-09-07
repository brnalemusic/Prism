import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { isReadOnlyHarnessPlanCommand } from '../src/main/harnessPlan.ts'

const exec = promisify(execFile)
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-git-recovery-test-'))
const moduleFile = path.join(temporary, 'recovery.mjs')
await build({ entryPoints: ['src/main/harnessGitRecovery.ts'], outfile: moduleFile, bundle: true, platform: 'node', format: 'esm', external: ['./ai'], logLevel: 'silent' })
const api = await import(pathToFileURL(moduleFile).href) as typeof import('../src/main/harnessGitRecovery.ts')
let serial = 0
async function git(root: string, ...args: string[]): Promise<string> {
  return (await exec('git', args, { cwd: root, windowsHide: true, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(temporary, 'empty-config'), GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' } })).stdout.trim()
}
async function repo(): Promise<string> {
  const root = path.join(temporary, `repo-${++serial}`)
  await fs.mkdir(root)
  await git(root, 'init', '-b', 'main')
  await git(root, 'config', 'user.name', 'Recovery Test')
  await git(root, 'config', 'user.email', 'recovery@example.invalid')
  await git(root, 'config', 'commit.gpgsign', 'false')
  await fs.writeFile(path.join(root, 'file.txt'), 'base\n')
  await git(root, 'add', '.')
  await git(root, 'commit', '-m', 'Fixture')
  return root
}
async function commit(root: string, text: string): Promise<void> {
  await fs.writeFile(path.join(root, 'file.txt'), text)
  await git(root, 'add', 'file.txt')
  await git(root, 'commit', '-m', 'Fixture change')
}
async function conflict(): Promise<string> {
  const root = await repo()
  await git(root, 'switch', '-c', 'feature')
  await commit(root, 'feature\n')
  await git(root, 'switch', 'main')
  await commit(root, 'main\n')
  api.configureGitRecovery(path.join(temporary, `state-${serial}`))
  const result = await api.runTrackedGitAction(root, { kind: 'merge', branch: 'feature' })
  assert.equal(result.ok, false)
  assert.equal(result.snapshot.operation?.kind, 'merge')
  return root
}
async function action(root: string, kind: 'retryOperation' | 'cancelRecovery', extra: Record<string, unknown> = {}): Promise<Awaited<ReturnType<typeof api.runTrackedGitAction>>> {
  const snapshot = await api.getTrackedGitSnapshot(root)
  const r = snapshot.recovery!
  return api.runTrackedGitAction(root, { kind, recovery: { id: r.id, revision: r.revision, requestId: crypto.randomUUID() }, ...extra })
}

test('Git recovery integration', async (t) => {
  try {
    await t.test('Plan rejects mutating Git arguments and shell evaluation', () => {
      for (const cmd of ['git branch -D main', 'git branch new', 'git branch --edit-description', 'git diff --output=x', 'git log --output=x', 'rg --pre=evil pattern', 'Get-Content $(evil)', 'git status\ngit reset --hard']) assert.equal(isReadOnlyHarnessPlanCommand(cmd), false, cmd)
      for (const cmd of ['git status --short', 'git branch --show-current', 'git diff --cached --stat', 'git ls-files --unmerged', 'rg -n "Harness" src']) assert.equal(isReadOnlyHarnessPlanCommand(cmd), true, cmd)
    })
    await t.test('Merge survives Plan/Build handoff and rejects unstaged and unrelated changes', async () => {
      const root = await conflict()
      const original = (await api.getTrackedGitSnapshot(root)).recovery!
      await api.bindGitPlan({ projectPath: root, chatId: 'plan', recoveryId: original.id, phase: 'plan' })
      await api.bindGitPlan({ projectPath: root, chatId: 'build', sourceChatId: 'plan', plan: 'Resolve file and validate.', phase: 'build' })
      const runId = await api.beginGitBuild('build')
      await fs.writeFile(path.join(root, 'file.txt'), 'resolved\n')
      await api.finishGitBuild('build', runId, true, 1)
      assert.equal((await api.getTrackedGitSnapshot(root)).recovery?.canRetry, false)
      await git(root, 'add', 'file.txt')
      await fs.writeFile(path.join(root, 'extra.txt'), 'unrelated')
      await git(root, 'add', 'extra.txt')
      assert.match((await api.getTrackedGitSnapshot(root)).recovery?.reason || '', /unrelated/i)
      await git(root, 'rm', '--cached', 'extra.txt')
      await fs.unlink(path.join(root, 'extra.txt'))
      assert.equal((await api.getTrackedGitSnapshot(root)).recovery?.canRetry, true)
      const done = await action(root, 'retryOperation')
      assert.equal(done.ok, true)
      assert.equal(done.snapshot.operation, undefined)
      assert.equal((await git(root, 'rev-list', '--parents', '-n', '1', 'HEAD')).split(' ').length, 3)
      const restored = await api.getChatGitRecoveries(root, 'build')
      assert.equal(restored[0].state, 'completed')
      assert.deepEqual(restored[0].cards, [{ chatId: 'build', afterMessage: 1, step: 1 }])
    })
    await t.test('Cancelled Build cannot enable Retry and Abort requires confirmation', async () => {
      const root = await conflict()
      await api.bindGitPlan({ projectPath: root, chatId: 'same', recoveryId: (await api.getTrackedGitSnapshot(root)).recovery!.id, phase: 'plan' })
      await api.bindGitPlan({ projectPath: root, chatId: 'same', plan: 'Resolve.', phase: 'build' })
      const run = await api.beginGitBuild('same')
      await commitResolution(root)
      await api.finishGitBuild('same', run, false, 2)
      assert.equal((await api.getTrackedGitSnapshot(root)).recovery?.canRetry, false)
      await assert.rejects(action(root, 'cancelRecovery'), /Confirm/)
      const result = await action(root, 'cancelRecovery', { confirmation: 'ABORT' })
      assert.equal(result.snapshot.operation, undefined)
      assert.equal(result.snapshot.recovery?.state, 'aborted')
    })
    await t.test('Ready resolution persists, rejects duplicate Retry and altered staging', async () => {
      const root = await conflict()
      await commitResolution(root)
      const ready = (await api.getTrackedGitSnapshot(root)).recovery!
      api.configureGitRecovery(path.join(temporary, `state-${serial}`))
      assert.equal((await api.getTrackedGitSnapshot(root)).recovery?.canRetry, true)
      await fs.writeFile(path.join(root, 'file.txt'), 'different\n')
      await git(root, 'add', 'file.txt')
      assert.equal((await api.getTrackedGitSnapshot(root)).recovery?.canRetry, false)
      await api.bindGitPlan({ projectPath: root, chatId: 'review', recoveryId: ready.id, phase: 'plan' })
      await api.bindGitPlan({ projectPath: root, chatId: 'review', plan: 'Review the staged resolution.', phase: 'build' })
      const run = await api.beginGitBuild('review')
      await api.finishGitBuild('review', run, true, 1)
      const current = (await api.getTrackedGitSnapshot(root)).recovery!
      const request = { kind: 'retryOperation' as const, recovery: { id: current.id, revision: current.revision, requestId: crypto.randomUUID() } }
      const results = await Promise.allSettled([api.runTrackedGitAction(root, request), api.runTrackedGitAction(root, request)])
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    })
    await t.test('Sync stops at conflicts and requires a separate Push after Retry', async () => {
      const root = await remoteConflict()
      const sync = await api.runTrackedGitAction(root, { kind: 'sync' })
      assert.equal(sync.snapshot.operation?.kind, 'rebase')
      await commitResolution(root)
      const continued = await action(root, 'retryOperation')
      assert.equal(continued.ok, true)
      assert.equal(continued.snapshot.recovery?.step, 'push')
      assert.equal(continued.snapshot.recovery?.state, 'ready')
      const remoteBefore = await git(root, 'ls-remote', 'origin', 'refs/heads/main')
      assert.ok(!remoteBefore.startsWith(await git(root, 'rev-parse', 'HEAD')))
      assert.equal((await action(root, 'retryOperation')).snapshot.recovery?.state, 'completed')
      assert.ok((await git(root, 'ls-remote', 'origin', 'refs/heads/main')).startsWith(await git(root, 'rev-parse', 'HEAD')))
    })
    await t.test('Rejected Push offers an explicit rebase and preserves its destination', async () => {
      const root = await remoteConflict()
      const push = await api.runTrackedGitAction(root, { kind: 'push' })
      assert.equal(push.snapshot.recovery?.needsPull, true)
      await assert.rejects(action(root, 'retryOperation'), /./)
      const pulled = await action(root, 'retryOperation', { integrateRemote: true })
      assert.equal(pulled.snapshot.operation?.kind, 'rebase')
      await commitResolution(root)
      const resolved = await action(root, 'retryOperation')
      assert.equal(resolved.snapshot.recovery?.step, 'push')
      assert.equal((await action(root, 'cancelRecovery', { confirmation: 'ABORT' })).snapshot.recovery?.state, 'aborted')
      assert.equal(await fs.readFile(path.join(root, 'file.txt'), 'utf8'), 'resolved\n')
    })
    await t.test('Pull can stop twice without replaying the original Pull', async () => {
      const root = await remoteConflict(true)
      const first = await api.runTrackedGitAction(root, { kind: 'pull' })
      assert.equal(first.snapshot.operation?.kind, 'rebase')
      await commitResolution(root)
      const second = await action(root, 'retryOperation')
      assert.equal(second.snapshot.operation?.kind, 'rebase')
      assert.equal(second.snapshot.recovery?.generation, 2)
      await fs.writeFile(path.join(root, 'second.txt'), 'resolved second\n')
      await git(root, 'add', 'second.txt')
      const done = await action(root, 'retryOperation')
      assert.equal(done.snapshot.recovery?.state, 'completed')
    })
    await t.test('Build blocks Git mutations in another worktree sharing references', async () => {
      const root = await conflict()
      const other = path.join(temporary, `worktree-${serial}`)
      await git(root, 'worktree', 'add', '-b', 'other', other, 'feature')
      const r = (await api.getTrackedGitSnapshot(root)).recovery!
      await api.bindGitPlan({ projectPath: root, chatId: 'worktree-build', recoveryId: r.id, phase: 'plan' })
      await api.bindGitPlan({ projectPath: root, chatId: 'worktree-build', plan: 'Resolve.', phase: 'build' })
      const run = await api.beginGitBuild('worktree-build')
      await assert.rejects(api.runTrackedGitAction(other, { kind: 'createBranch', name: 'unsafe-concurrent' }), /linked Build/)
      await api.finishGitBuild('worktree-build', run, false, 1)
      await action(root, 'cancelRecovery', { confirmation: 'ABORT' })
    })
    await t.test('Dirty integration and unconfirmed destructive operations do not mutate', async () => {
      const root = await repo()
      api.configureGitRecovery(path.join(temporary, `state-${serial}`))
      await fs.writeFile(path.join(root, 'file.txt'), 'dirty\n')
      await assert.rejects(api.runTrackedGitAction(root, { kind: 'merge', branch: 'main' }), /local changes/)
      await assert.rejects(api.runTrackedGitAction(root, { kind: 'reset', hash: await git(root, 'rev-parse', 'HEAD'), mode: 'hard' }), /Confirm/)
      assert.equal(await fs.readFile(path.join(root, 'file.txt'), 'utf8'), 'dirty\n')
    })
    await t.test('External completion disables old controls', async () => {
      const root = await conflict()
      await git(root, 'merge', '--abort')
      const s = await api.getTrackedGitSnapshot(root)
      assert.equal(s.recovery?.state, 'completed')
      assert.equal(s.recovery?.canRetry, false)
    })
  } finally {
    assert.ok(temporary.startsWith(path.join(os.tmpdir(), 'prism-git-recovery-test-')))
    await fs.rm(temporary, { recursive: true, force: true })
  }
})

async function commitResolution(root: string): Promise<void> {
  await fs.writeFile(path.join(root, 'file.txt'), 'resolved\n')
  await git(root, 'add', 'file.txt')
}

async function remoteConflict(twoCommits = false): Promise<string> {
  const root = await repo()
  await fs.writeFile(path.join(root, 'second.txt'), 'base second\n')
  await git(root, 'add', '.')
  await git(root, 'commit', '-m', 'Second fixture file')
  const remote = path.join(temporary, `remote-${serial}.git`)
  await fs.mkdir(remote)
  await git(remote, 'init', '--bare', '-b', 'main')
  await git(root, 'remote', 'add', 'origin', remote)
  await git(root, 'push', '-u', 'origin', 'main')
  const peer = path.join(temporary, `peer-${serial}`)
  await git(temporary, 'clone', remote, peer)
  await git(peer, 'config', 'user.name', 'Peer')
  await git(peer, 'config', 'user.email', 'peer@example.invalid')
  await commit(root, 'local\n')
  if (twoCommits) {
    await fs.writeFile(path.join(root, 'second.txt'), 'local second\n')
    await git(root, 'add', '.')
    await git(root, 'commit', '-m', 'Second local change')
    await fs.writeFile(path.join(peer, 'second.txt'), 'remote second\n')
    await git(peer, 'add', '.')
  }
  await commit(peer, 'remote\n')
  await git(peer, 'push', 'origin', 'main')
  api.configureGitRecovery(path.join(temporary, `state-${serial}`))
  return root
}
