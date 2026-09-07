import { createHash, randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { HarnessGitAction, HarnessGitActionResult, HarnessGitPlanBinding, HarnessGitRecovery, HarnessGitSnapshot } from '../shared/types'
import { getHarnessGitSnapshot, git, run, runHarnessGitAction } from './harnessGit'

interface RecordEntry extends HarnessGitRecovery {
  version: 1
  original?: HarnessGitAction
  commonDir: string
  head?: string
  remote?: string
  remoteUrl?: string
  remoteRef?: string
  source?: string
  baseline?: Record<string, string>
  conflictPaths: string[]
  approvedPlan?: string
  buildChatId?: string
  runId?: string
  buildSucceeded?: boolean
  verifiedTree?: string
  attempt?: string
  lastAttempt?: string
  prUrl?: string
}

const records = new Map<string, RecordEntry>()
const locks = new Map<string, Promise<void>>()
const liveRuns = new Set<string>()
let loaded: Promise<void> | undefined
let storage = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'PrismDesktop', 'git-recovery')
let publish: (record: HarnessGitRecovery) => void = () => undefined
const terminal = (r: RecordEntry): boolean => ['completed', 'aborted'].includes(r.state)
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

export function configureGitRecovery(directory: string, listener?: typeof publish): void {
  storage = directory
  loaded = undefined
  records.clear()
  liveRuns.clear()
  publish = listener || (() => undefined)
}

export function onGitRecoveryChanged(listener: typeof publish): void { publish = listener }

function view(r: RecordEntry): HarnessGitRecovery {
  const { id, revision, projectPath, repoRoot, action, step, state, branch, operation, reason, canRetry, canAbort, canResolve, needsPull, chatIds, cards, generation } = r
  return structuredClone({ id, revision, projectPath, repoRoot, action, step, state, branch, operation, reason, canRetry, canAbort, canResolve, needsPull, chatIds, cards, generation })
}

async function load(): Promise<void> {
  loaded ||= (async () => {
    await fs.mkdir(storage, { recursive: true })
    for (const name of await fs.readdir(storage)) {
      if (!/^[a-f0-9-]+\.json$/.test(name)) continue
      const r = JSON.parse(await fs.readFile(path.join(storage, name), 'utf8')) as RecordEntry
      if (r.version !== 1 || !r.id || !r.commonDir || !Array.isArray(r.cards)) throw new Error('Git recovery storage needs repair. No Git action was started.')
      records.set(r.id, r)
    }
  })()
  return loaded
}

async function save(r: RecordEntry): Promise<void> {
  r.revision += 1
  const file = path.join(storage, `${r.id}.json`)
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify(r), { flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, file)
  } finally { await fs.unlink(temporary).catch(() => undefined) }
  records.set(r.id, r)
  try { publish(view(r)) } catch { /* A disconnected renderer cannot undo persisted state. */ }
}

async function checked(cwd: string, args: string[]): Promise<string> {
  const result = await git(cwd, args)
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || 'Git command failed.')
  return result.stdout
}

async function identity(projectPath: string): Promise<{ root: string; common: string }> {
  const root = await fs.realpath((await checked(projectPath, ['rev-parse', '--show-toplevel'])).trim())
  const common = await fs.realpath(path.resolve(root, (await checked(root, ['rev-parse', '--git-common-dir'])).trim()))
  return { root, common: process.platform === 'win32' ? common.toLowerCase() : common }
}

async function exclusive<T>(key: string, fn: () => Promise<T>, wait = false): Promise<T> {
  while (locks.has(key)) {
    if (!wait) throw new Error('Another Git action is running for this repository. Try again when it finishes.')
    await locks.get(key)
  }
  let release!: () => void
  locks.set(key, new Promise<void>((resolve) => { release = resolve }))
  try { return await fn() } finally { locks.delete(key); release() }
}

function active(root: string): RecordEntry | undefined {
  return [...records.values()].reverse().find((r) => r.repoRoot === root && !terminal(r))
}

async function indexEntries(root: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {}
  for (const item of (await checked(root, ['ls-files', '--stage', '-z'])).split('\0')) {
    const split = item.indexOf('\t')
    if (split >= 0) entries[item.slice(split + 1)] = (entries[item.slice(split + 1)] || '') + item.slice(0, split)
  }
  return entries
}

async function treeFingerprint(root: string): Promise<string> {
  return digest(await checked(root, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv']) + await checked(root, ['status', '--porcelain=v1', '-z']))
}

async function readiness(r: RecordEntry, snapshot: HarnessGitSnapshot): Promise<string | undefined> {
  if (!snapshot.ok) return snapshot.error || 'Git status is unavailable.'
  if (!snapshot.operation || snapshot.operation.fingerprint !== r.operation?.fingerprint) return 'The pending Git operation changed. Inspect the repository before continuing.'
  if (snapshot.headHash !== r.head) return 'HEAD changed outside this recovery.'
  if (snapshot.conflicts.length) return 'Resolve and explicitly stage all conflicted files first.'
  if (snapshot.files.some((f) => f.isUntracked || f.workTreeStatus !== ' ')) return 'Unstaged or untracked changes remain. Review them before continuing.'
  const current = await indexEntries(r.repoRoot)
  for (const file of new Set([...Object.keys(r.baseline || {}), ...Object.keys(current)])) {
    if (!r.conflictPaths.includes(file) && current[file] !== r.baseline?.[file]) return `An unrelated index entry changed: ${file}. Review it before continuing.`
  }
  const check = await git(r.repoRoot, ['diff', '--cached', '--check'])
  if (check.exitCode !== 0) return check.stdout.trim() || check.stderr.trim() || 'The staged resolution failed Git checks.'
  if (r.buildChatId && !r.buildSucceeded) return 'The approved Build has not completed successfully. Finish its checks before Retry.'
  return undefined
}

async function reconcile(r: RecordEntry, s: HarnessGitSnapshot): Promise<void> {
  const before = JSON.stringify(r)
  if (terminal(r)) return
  r.canRetry = false
  r.canResolve = false
  r.canAbort = true
  if (!s.ok) { r.state = 'blocked'; r.reason = s.error || 'Git status is unavailable.'; r.canAbort = false }
  else if (r.runId && liveRuns.has(r.runId)) { r.canAbort = false }
  else if (['running', 'implementing', 'verifying'].includes(r.state)) {
    r.state = 'uncertain'
    r.reason = 'Execution was interrupted. Review the repository before Retry.'
    r.buildSucceeded = false
  } else if (r.operation && !s.operation) {
    r.state = 'completed'; r.reason = 'The native operation ended outside Git Control. Review the result; no follow-up was started.'; r.canAbort = false
  } else if (r.operation && r.operation.fingerprint !== s.operation?.fingerprint) {
    r.state = 'blocked'; r.reason = 'The native operation changed outside this recovery.'; r.canAbort = false
  } else if (s.operation) {
    r.reason = await readiness(r, s)
    if (!['planning', 'awaiting-approval'].includes(r.state)) r.state = r.reason ? (s.conflicts.length ? 'conflicts' : 'blocked') : 'ready'
    r.canRetry = !r.reason && r.state === 'ready'
    r.canResolve = !r.canRetry
    if (r.canRetry) {
      const fingerprint = await treeFingerprint(r.repoRoot)
      if (r.verifiedTree && r.verifiedTree !== fingerprint) {
        r.state = 'blocked'; r.canRetry = false; r.reason = 'The staged resolution changed after verification. Run the resolution review again.'
      } else r.verifiedTree = fingerprint
    }
  } else if (r.head !== s.headHash || r.branch !== s.branch) {
    r.state = 'blocked'; r.reason = 'The checked-out branch or HEAD changed. End this attempt and review the new state.'
  } else if (['push', 'fetch', 'pull', 'merge', 'createPr'].includes(r.step)) {
    r.canRetry = !r.needsPull
  }
  if (JSON.stringify(r) !== before) await save(r)
}

async function capture(r: RecordEntry, s: HarnessGitSnapshot): Promise<void> {
  r.operation = s.operation
  r.head = s.headHash
  r.conflictPaths = s.conflicts
  r.baseline = await indexEntries(r.repoRoot)
  r.verifiedTree = undefined
  r.buildSucceeded = false
  r.buildChatId = undefined
  r.runId = undefined
  r.generation += 1
  r.state = s.conflicts.length ? 'conflicts' : 'blocked'
}

async function create(projectPath: string, common: string, s: HarnessGitSnapshot, original?: HarnessGitAction): Promise<RecordEntry> {
  const r: RecordEntry = {
    version: 1, id: randomUUID(), revision: 0, projectPath, repoRoot: s.repoRoot!, commonDir: common,
    action: original?.kind || s.operation?.kind || 'external', original, step: original?.kind || 'continue', state: 'running',
    branch: s.branch, head: s.headHash, canRetry: false, canAbort: false, canResolve: false,
    chatIds: [], cards: [], generation: 0, conflictPaths: []
  }
  if (s.operation) await capture(r, s)
  await save(r)
  return r
}

export async function getTrackedGitSnapshot(projectPath: string): Promise<HarnessGitSnapshot> {
  await load()
  const id = await identity(projectPath).catch(() => undefined)
  if (!id) return getHarnessGitSnapshot(projectPath)
  return exclusive(id.common, async () => {
    const s = await getHarnessGitSnapshot(projectPath)
    let r = active(id.root)
    if (!r && s.ok && s.operation) r = await create(projectPath, id.common, s)
    if (r) { await reconcile(r, s); s.recovery = view(r) }
    return s
  }, true)
}

export async function getChatGitRecoveries(projectPath: string, chatId: string): Promise<HarnessGitRecovery[]> {
  await getTrackedGitSnapshot(projectPath)
  return [...records.values()].filter((r) => r.projectPath === projectPath && r.chatIds.includes(chatId)).map(view)
}

function safeRef(value: string): string {
  // eslint-disable-next-line no-control-regex -- Git references must never carry control characters.
  if (!value || value.startsWith('-') || /[\s*~^:?*[\\]/.test(value) || value.includes('..') || value.includes('@{') || /\u0000-\u001f/.test(value) || value.includes('\u0000')) throw new Error('Invalid Git reference or remote name.')
  return value
}

async function destination(r: RecordEntry, s: HarnessGitSnapshot): Promise<void> {
  const requested = r.original && 'remote' in r.original ? r.original.remote : undefined
  const configured = s.branch ? (await git(r.repoRoot, ['config', '--get', `branch.${s.branch}.remote`])).stdout.trim() : ''
  r.remote = safeRef(requested || configured || s.remotes.find((remote) => remote.name === 'origin')?.name || s.remotes[0]?.name || '')
  if (!s.remotes.some((remote) => remote.name === r.remote)) throw new Error('Choose a configured remote first.')
  r.remoteUrl = digest((await checked(r.repoRoot, ['remote', 'get-url', r.remote])).trim())
  const merge = s.branch ? (await git(r.repoRoot, ['config', '--get', `branch.${s.branch}.merge`])).stdout.trim() : ''
  r.remoteRef = safeRef(merge || `refs/heads/${safeRef(s.branch || '')}`)
  if (!r.remoteRef.startsWith('refs/heads/')) throw new Error('The upstream must be a branch.')
}

async function remoteUnchanged(r: RecordEntry): Promise<void> {
  if (digest((await checked(r.repoRoot, ['remote', 'get-url', r.remote!])).trim()) !== r.remoteUrl) throw new Error('The remote URL changed. End this attempt before selecting a new destination.')
}

async function executeStep(r: RecordEntry): Promise<string> {
  const root = r.repoRoot
  if (r.step === 'continue') return checked(root, [r.operation!.kind, '--continue'])
  if (r.step === 'merge') return checked(root, ['merge', '--no-edit', r.source!])
  if (r.step === 'fetch') { await remoteUnchanged(r); return checked(root, ['fetch', '--prune', r.remote!]) }
  if (r.step === 'pull') {
    await remoteUnchanged(r)
    return checked(root, ['-c', 'rebase.autoStash=false', 'pull', '--rebase', r.remote!, r.remoteRef!])
  }
  if (r.step === 'push') {
    await remoteUnchanged(r)
    const remote = (await checked(root, ['ls-remote', '--refs', r.remote!, r.remoteRef!])).trim().split(/\s/)[0]
    if (remote === r.head) return 'The remote already contains this result.'
    const result = await git(root, ['push', '--porcelain', '--set-upstream', r.remote!, `${r.head}:${r.remoteRef}`])
    if (result.exitCode !== 0) {
      r.needsPull = /\[rejected\].*(?:fetch first|non-fast-forward)/i.test(result.stdout)
      throw new Error(result.stderr.trim() || result.stdout.trim() || 'Push failed.')
    }
    return result.stdout
  }
  if (r.step === 'createPr' && r.original?.kind === 'createPr') {
    const a = r.original
    const list = await run('gh', ['pr', 'list', '--state', 'open', '--head', a.head || r.branch!, '--base', a.base, '--json', 'url'], root)
    if (list.exitCode !== 0) throw new Error(list.stderr || 'Could not verify existing pull requests.')
    const existing = JSON.parse(list.stdout) as { url: string }[]
    if (existing.length) { r.prUrl = existing[0].url; return r.prUrl }
    const result = await run('gh', ['pr', 'create', '--base', a.base, '--head', a.head || r.branch!, '--title', a.title, '--body', a.body], root)
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Pull request creation failed.')
    r.prUrl = result.stdout.trim()
    return result.stdout
  }
  const result = await runHarnessGitAction(root, r.original!)
  if (!result.ok) throw new Error(result.error)
  return result.output || ''
}

async function perform(r: RecordEntry, retry: boolean): Promise<HarnessGitActionResult> {
  r.state = 'running'; r.canRetry = false; r.canAbort = false; r.reason = undefined
  await save(r)
  let output = ''
  try {
    output = await executeStep(r)
    let s = await getHarnessGitSnapshot(r.projectPath)
    if (!s.ok) throw new Error(s.error || 'Could not verify the Git result.')
    if (s.operation) { await capture(r, s); r.step = 'continue' }
    else {
      r.operation = undefined; r.head = s.headHash; r.branch = s.branch
      const next = r.action === 'sync' && r.step === 'fetch' ? 'pull'
        : (r.action === 'sync' || r.action === 'push') && (r.step === 'pull' || r.step === 'continue') ? 'push'
        : r.action === 'createPr' && r.step === 'push' ? 'createPr' : undefined
      if (next) {
        r.step = next; r.state = 'ready'; r.canRetry = true; r.canAbort = true
        r.reason = next === 'push' ? 'Integration completed. Retry to confirm the Push.' : 'Retry to continue the next step.'
        await save(r)
        if (!retry) return perform(r, false)
      } else { r.state = 'completed'; r.canAbort = false; r.canRetry = false; r.needsPull = false }
    }
    await save(r)
    await reconcile(r, s)
    s = { ...s, recovery: view(r) }
    return { ok: !s.operation, snapshot: s, output, prUrl: r.prUrl, conflict: s.conflicts.length > 0 }
  } catch (error) {
    r.reason = error instanceof Error ? error.message : String(error)
    const s = await getHarnessGitSnapshot(r.projectPath)
    if (s.ok && s.operation) { await capture(r, s); r.step = 'continue' }
    else r.state = ['push', 'createPr'].includes(r.step) ? 'uncertain' : 'blocked'
    r.canAbort = true
    r.lastAttempt = r.attempt
    await save(r)
    await reconcile(r, s)
    return { ok: false, snapshot: { ...s, recovery: view(r) }, error: r.reason, conflict: s.conflicts.length > 0 }
  }
}

export async function runTrackedGitAction(projectPath: string, action: HarnessGitAction): Promise<HarnessGitActionResult> {
  await load()
  if (!action || !['switchBranch', 'createBranch', 'renameBranch', 'deleteBranch', 'fetch', 'merge', 'commit', 'push', 'pull', 'sync', 'reset', 'createPr', 'retryOperation', 'cancelRecovery', 'abortOperation'].includes(action.kind)) throw new Error('Unknown Git action.')
  const id = await identity(projectPath)
  return exclusive(id.common, async () => {
    if ([...records.values()].some((entry) => entry.commonDir === id.common && entry.runId && liveRuns.has(entry.runId))) throw new Error('Wait for the linked Build to finish before running Git actions.')
    const s = await getHarnessGitSnapshot(projectPath)
    if (!s.ok) return { ok: false, snapshot: s, error: s.error }
    let r = active(id.root)
    if (!r && s.operation) r = await create(projectPath, id.common, s)
    if (action.kind === 'abortOperation') throw new Error('Use the recovery confirmation before aborting.')
    if (action.kind === 'retryOperation' || action.kind === 'cancelRecovery') {
      if (!r || r.id !== action.recovery.id || r.revision !== action.recovery.revision || r.lastAttempt === action.recovery.requestId) throw new Error('This recovery changed. Refresh it before trying again.')
      await reconcile(r, s)
      if (action.kind === 'cancelRecovery') {
        if (!r.canAbort || action.confirmation !== 'ABORT') throw new Error('Confirm Abort before discarding the pending resolution.')
        if (s.operation) await checked(id.root, [s.operation.kind, '--abort'])
        r.state = 'aborted'; r.canRetry = false; r.canAbort = false; r.canResolve = false
        r.reason = s.operation ? 'The native operation was aborted.' : 'The pending attempt was ended. Local commits were preserved.'
        await save(r)
        return { ok: true, snapshot: { ...await getHarnessGitSnapshot(projectPath), recovery: view(r) } }
      }
      if (r.needsPull && action.integrateRemote) {
        if (s.files.length || s.operation) throw new Error('A clean working tree is required before integrating the remote.')
        r.needsPull = false; r.step = 'pull'; r.canRetry = true
      }
      if (!r.canRetry) throw new Error(r.reason || 'This operation is not ready for Retry.')
      if (r.step === 'continue' && await readiness(r, s)) throw new Error('The resolution changed. Verify it again.')
      if (['merge', 'pull'].includes(r.step) && s.files.length) throw new Error('Commit or handle local changes before continuing.')
      r.attempt = action.recovery.requestId; r.lastAttempt = action.recovery.requestId
      return perform(r, true)
    }
    if (r) throw new Error('Finish or end the pending Git recovery first.')
    if (s.conflicts.length) throw new Error('Resolve the unmerged index before starting a Git operation.')
    if (['merge', 'pull', 'sync'].includes(action.kind) && s.files.length) throw new Error('Commit or handle local changes before Merge, Pull, or Sync. Automatic stashing is disabled.')
    for (const key of ['name', 'from', 'to', 'branch', 'remote', 'startPoint', 'hash', 'base', 'head'] as const) {
      if (key in action && (action as unknown as Record<string, unknown>)[key] !== undefined) safeRef(String((action as unknown as Record<string, unknown>)[key] || ''))
    }
    if (action.kind === 'deleteBranch' && action.confirmation !== action.name) throw new Error('Confirm the branch name before deleting it.')
    if (action.kind === 'reset' && (action.confirmation !== action.hash || !['soft', 'hard'].includes(action.mode))) throw new Error('Confirm the reset target and mode.')
    if (action.kind === 'createPr' && (!s.branch || ['main', 'master'].includes(s.branch))) throw new Error('Create a working branch before opening a pull request.')
    r = await create(projectPath, id.common, s, action)
    try {
      if (action.kind === 'merge') r.source = (await checked(id.root, ['rev-parse', '--verify', `${action.branch}^{commit}`])).trim()
      if (['fetch', 'pull', 'push', 'sync', 'createPr'].includes(action.kind)) await destination(r, s)
      if (action.kind === 'sync') r.step = 'fetch'
      if (action.kind === 'createPr') r.step = 'push'
      if (action.kind === 'commit' && !action.options.message?.trim()) throw new Error('A commit message is required.')
    } catch (error) { r.state = 'aborted'; r.reason = String(error); await save(r); throw error }
    return perform(r, false)
  })
}

export async function bindGitPlan(binding: HarnessGitPlanBinding): Promise<void> {
  await load()
  const id = await identity(binding.projectPath)
  await exclusive(id.common, async () => {
    const r = binding.recoveryId ? records.get(binding.recoveryId) : [...records.values()].reverse().find((entry) => entry.chatIds.includes(binding.sourceChatId || binding.chatId) && !terminal(entry))
    if (!r) { if (binding.recoveryId) throw new Error('The Git recovery no longer exists.'); return }
    if (r.repoRoot !== id.root || terminal(r) || (r.runId && liveRuns.has(r.runId))) throw new Error('This Git recovery is unavailable.')
    if (binding.phase === 'build') {
      if (!binding.plan?.trim()) throw new Error('Approve an implementation plan first.')
      r.approvedPlan = binding.plan; r.buildChatId = binding.chatId; r.buildSucceeded = false
      r.state = 'awaiting-approval'
    } else { r.state = 'planning'; r.verifiedTree = undefined }
    r.chatIds = [...new Set([...r.chatIds, binding.chatId])]
    r.canRetry = false
    await save(r)
  })
}

export async function beginGitBuild(chatId: string): Promise<string | undefined> {
  await load()
  const r = [...records.values()].find((entry) => entry.buildChatId === chatId && !terminal(entry))
  if (!r) return undefined
  return exclusive(r.commonDir, async () => {
    if (r.runId && liveRuns.has(r.runId)) throw new Error('The Git resolution is already running.')
    r.runId = randomUUID(); liveRuns.add(r.runId); r.state = 'implementing'; r.canRetry = false; r.canAbort = false
    await save(r)
    return r.runId
  })
}

export async function finishGitBuild(chatId: string, runId: string | undefined, success: boolean, afterMessage: number): Promise<void> {
  if (!runId) return
  const r = [...records.values()].find((entry) => entry.runId === runId && entry.buildChatId === chatId)
  if (!r) return
  await exclusive(r.commonDir, async () => {
    liveRuns.delete(runId)
    r.buildSucceeded = success
    r.state = 'blocked'
    if (!r.cards.some((card) => card.chatId === chatId && card.step === r.generation)) r.cards.push({ chatId, afterMessage, step: r.generation })
    await save(r)
    await reconcile(r, await getHarnessGitSnapshot(r.projectPath))
  }, true)
}

