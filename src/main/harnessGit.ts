import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import * as path from 'path'
import { promisify } from 'util'
import type {
  HarnessGitAction,
  HarnessGitActionResult,
  HarnessGitBranch,
  HarnessGitCommit,
  HarnessGitFile,
  HarnessGitOperation,
  HarnessGitRemote,
  HarnessGitSnapshot
} from '../shared/types'
import type { OpenAiMessage } from './ai/types'

const execFileAsync = promisify(execFile)
const MAX_BUFFER = 5 * 1024 * 1024

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

interface ExecFailure extends Error {
  code?: number | string
  stdout?: string
  stderr?: string
}

function commandError(result: CommandResult): Error {
  return new Error(result.stderr.trim() || result.stdout.trim() || 'Git command failed.')
}

async function run(command: string, args: string[], cwd: string): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      windowsHide: true,
      maxBuffer: MAX_BUFFER
    })
    return { stdout, stderr, exitCode: 0 }
  } catch (error) {
    const failure = error as ExecFailure
    return {
      stdout: failure.stdout || '',
      stderr: failure.stderr || failure.message || '',
      exitCode: typeof failure.code === 'number' ? failure.code : 1
    }
  }
}

async function git(cwd: string, args: string[]): Promise<CommandResult> {
  return run('git', args, cwd)
}

function baseSnapshot(projectPath: string, error?: string): HarnessGitSnapshot {
  return {
    ok: false,
    projectPath,
    isGit: false,
    detached: false,
    ahead: 0,
    behind: 0,
    files: [],
    conflicts: [],
    branches: [],
    remotes: [],
    commits: [],
    signing: { enabled: false },
    github: { available: false, authenticated: false },
    error
  }
}

export function parseHarnessGitStatus(output: string): HarnessGitFile[] {
  const entries = output.split('\0').filter(Boolean)
  const files: HarnessGitFile[] = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry.length < 4) continue
    const indexStatus = entry.slice(0, 1)
    const workTreeStatus = entry.slice(1, 2)
    let filePath = entry.slice(3)
    // Porcelain v1 places the previous path after a rename/copy entry.
    if (indexStatus === 'R' || indexStatus === 'C') index += 1
    const isConflicted = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(
      `${indexStatus}${workTreeStatus}`
    )
    files.push({
      path: filePath,
      indexStatus,
      workTreeStatus,
      isUntracked: `${indexStatus}${workTreeStatus}` === '??',
      isConflicted
    })
  }
  return files
}

function parseBranches(output: string, currentBranch?: string): HarnessGitBranch[] {
  const parts = output.split('\0').filter(Boolean)
  const branches: HarnessGitBranch[] = []
  for (let index = 0; index + 3 < parts.length; index += 4) {
    const name = parts[index]
    const head = parts[index + 1]
    const upstream = parts[index + 2]
    const isRemote = name.startsWith('origin/') || name.includes('/') && name.startsWith('refs/remotes/')
    if (name.endsWith('/HEAD')) continue
    branches.push({
      name: isRemote ? name.replace(/^[^/]+\//, '') : name,
      fullName: name,
      isCurrent: head === '*' || name === currentBranch,
      isRemote,
      upstream: upstream || undefined
    })
  }
  return branches.sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1
    if (left.isRemote !== right.isRemote) return left.isRemote ? 1 : -1
    return left.name.localeCompare(right.name)
  })
}

function parseRemotes(output: string): HarnessGitRemote[] {
  const byName = new Map<string, HarnessGitRemote>()
  for (const line of output.split(/\r?\n/)) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim())
    if (!match) continue
    const remote = byName.get(match[1]) || { name: match[1] }
    if (match[3] === 'fetch') remote.fetchUrl = match[2]
    else remote.pushUrl = match[2]
    byName.set(match[1], remote)
  }
  return [...byName.values()]
}

function parseCommits(output: string): HarnessGitCommit[] {
  const parts = output.split('\0').filter(Boolean)
  const commits: HarnessGitCommit[] = []
  for (let index = 0; index + 4 < parts.length; index += 5) {
    commits.push({
      hash: parts[index],
      shortHash: parts[index + 1],
      subject: parts[index + 2],
      author: parts[index + 3],
      authoredAt: parts[index + 4]
    })
  }
  return commits
}

async function operationFor(repoRoot: string): Promise<HarnessGitOperation | undefined> {
  const gitDir = await git(repoRoot, ['rev-parse', '--git-dir'])
  if (gitDir.exitCode !== 0) return undefined
  const resolvedGitDir = path.resolve(repoRoot, gitDir.stdout.trim())
  const [mergeHead, rebaseMerge, rebaseApply, cherryPickHead] = await Promise.all([
    fs.stat(path.join(resolvedGitDir, 'MERGE_HEAD')).then(() => true).catch(() => false),
    fs.stat(path.join(resolvedGitDir, 'rebase-merge')).then(() => true).catch(() => false),
    fs.stat(path.join(resolvedGitDir, 'rebase-apply')).then(() => true).catch(() => false),
    fs.stat(path.join(resolvedGitDir, 'CHERRY_PICK_HEAD')).then(() => true).catch(() => false)
  ])
  if (mergeHead) return { kind: 'merge' }
  if (rebaseMerge || rebaseApply) return { kind: 'rebase' }
  if (cherryPickHead) return { kind: 'cherry-pick' }
  return undefined
}

async function githubStatus(cwd: string): Promise<HarnessGitSnapshot['github']> {
  const result = await run('gh', ['auth', 'status', '--hostname', 'github.com'], cwd)
  if (result.exitCode !== 0) return { available: !/not recognized|ENOENT/i.test(result.stderr), authenticated: false }
  const account = /account\s+([\w-]+)/i.exec(result.stderr + result.stdout)
  return { available: true, authenticated: true, username: account?.[1] }
}

function trimOutput(value: string): string {
  return value.trim().slice(0, 4000)
}

async function resolveRepository(projectPath: string): Promise<{ repoRoot?: string; error?: string }> {
  const resolvedProjectPath = path.resolve(projectPath)
  try {
    const stats = await fs.stat(resolvedProjectPath)
    if (!stats.isDirectory()) return { error: 'The selected Harness project is not a directory.' }
  } catch {
    return { error: 'The selected Harness project folder no longer exists.' }
  }
  const result = await git(resolvedProjectPath, ['rev-parse', '--show-toplevel'])
  if (result.exitCode !== 0) return { error: 'This project is not a Git repository.' }
  return { repoRoot: result.stdout.trim() }
}

export async function getHarnessGitSnapshot(projectPath: string): Promise<HarnessGitSnapshot> {
  const resolvedProjectPath = path.resolve(projectPath)
  const repository = await resolveRepository(resolvedProjectPath)
  if (!repository.repoRoot) return baseSnapshot(resolvedProjectPath, repository.error)
  const repoRoot = repository.repoRoot
  const [branchResult, upstreamResult, statusResult, branchesResult, remotesResult, commitsResult, signResult, formatResult, keyResult, defaultResult, github] = await Promise.all([
    git(repoRoot, ['branch', '--show-current']),
    git(repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
    git(repoRoot, ['status', '--porcelain=v1', '-z']),
    git(repoRoot, ['for-each-ref', '--format=%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(objectname:short)%00', 'refs/heads', 'refs/remotes']),
    git(repoRoot, ['remote', '-v']),
    git(repoRoot, ['log', '-20', '--format=%H%x00%h%x00%s%x00%an%x00%aI%x00']),
    git(repoRoot, ['config', '--bool', 'commit.gpgsign']),
    git(repoRoot, ['config', '--get', 'gpg.format']),
    git(repoRoot, ['config', '--get', 'user.signingkey']),
    git(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']),
    githubStatus(repoRoot)
  ])
  const branch = branchResult.stdout.trim() || undefined
  const upstream = upstreamResult.exitCode === 0 ? upstreamResult.stdout.trim() : undefined
  let ahead = 0
  let behind = 0
  if (upstream) {
    const counts = await git(repoRoot, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`])
    if (counts.exitCode === 0) {
      const [behindValue, aheadValue] = counts.stdout.trim().split(/\s+/).map(Number)
      behind = Number.isFinite(behindValue) ? behindValue : 0
      ahead = Number.isFinite(aheadValue) ? aheadValue : 0
    }
  }
  const files = parseHarnessGitStatus(statusResult.stdout)
  const fallbackDefault = branch === 'main' || branch === 'master' ? branch : 'main'
  const defaultBranch = defaultResult.exitCode === 0
    ? defaultResult.stdout.trim().replace(/^origin\//, '')
    : fallbackDefault
  return {
    ok: true,
    projectPath: resolvedProjectPath,
    repoRoot,
    isGit: true,
    branch,
    detached: !branch,
    upstream,
    ahead,
    behind,
    files,
    conflicts: files.filter((file) => file.isConflicted).map((file) => file.path),
    branches: parseBranches(branchesResult.stdout, branch),
    remotes: parseRemotes(remotesResult.stdout),
    commits: parseCommits(commitsResult.stdout),
    operation: await operationFor(repoRoot),
    signing: {
      enabled: signResult.stdout.trim().toLowerCase() === 'true',
      format: formatResult.stdout.trim() || undefined,
      key: keyResult.stdout.trim() || undefined
    },
    github,
    defaultBranch
  }
}

function requireValue(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required.`)
  return trimmed
}

function currentRemote(snapshot: HarnessGitSnapshot, requested?: string): string {
  return requested || snapshot.remotes.find((remote) => remote.name === 'origin')?.name || snapshot.remotes[0]?.name || 'origin'
}

async function runGitOrThrow(cwd: string, args: string[]): Promise<CommandResult> {
  const result = await git(cwd, args)
  if (result.exitCode !== 0) throw commandError(result)
  return result
}

async function abortOperation(cwd: string, operation?: HarnessGitOperation): Promise<CommandResult> {
  if (!operation) throw new Error('There is no Git operation to abort.')
  if (operation.kind === 'merge') return runGitOrThrow(cwd, ['merge', '--abort'])
  if (operation.kind === 'rebase') return runGitOrThrow(cwd, ['rebase', '--abort'])
  return runGitOrThrow(cwd, ['cherry-pick', '--abort'])
}

export async function runHarnessGitAction(
  projectPath: string,
  action: HarnessGitAction
): Promise<HarnessGitActionResult> {
  const before = await getHarnessGitSnapshot(projectPath)
  if (!before.isGit || !before.repoRoot) {
    return { ok: false, snapshot: before, error: before.error || 'Git repository unavailable.' }
  }
  const cwd = before.repoRoot
  if (before.operation && action.kind !== 'abortOperation') {
    return { ok: false, snapshot: before, conflict: true, error: 'Resolve or abort the active Git operation first.' }
  }
  if (before.conflicts.length > 0 && action.kind !== 'abortOperation') {
    return { ok: false, snapshot: before, conflict: true, error: 'Resolve or abort conflicted files before continuing.' }
  }

  try {
    let output = ''
    let prUrl: string | undefined
    switch (action.kind) {
      case 'switchBranch': {
        const branch = requireValue(action.name, 'Branch name')
        const remoteBranch = before.branches.find((item) => item.isRemote && (item.fullName === branch || item.name === branch))
        if (remoteBranch) {
          const localName = remoteBranch.name
          const existing = before.branches.find((item) => !item.isRemote && item.name === localName)
          output = (await runGitOrThrow(cwd, existing ? ['switch', localName] : ['switch', '--track', '-c', localName, remoteBranch.fullName])).stdout
        } else {
          output = (await runGitOrThrow(cwd, ['switch', branch])).stdout
        }
        break
      }
      case 'createBranch': {
        const branch = requireValue(action.name, 'Branch name')
        await runGitOrThrow(cwd, ['check-ref-format', '--branch', branch])
        output = (await runGitOrThrow(cwd, action.startPoint ? ['switch', '-c', branch, action.startPoint] : ['switch', '-c', branch])).stdout
        break
      }
      case 'renameBranch': {
        const from = requireValue(action.from, 'Existing branch name')
        const to = requireValue(action.to, 'New branch name')
        await runGitOrThrow(cwd, ['check-ref-format', '--branch', to])
        output = (await runGitOrThrow(cwd, ['branch', '-m', from, to])).stdout
        break
      }
      case 'deleteBranch': {
        const branch = requireValue(action.name, 'Branch name')
        if (action.remote) output = (await runGitOrThrow(cwd, ['push', action.remote, '--delete', branch])).stdout
        else output = (await runGitOrThrow(cwd, [action.force ? 'branch' : 'branch', action.force ? '-D' : '-d', branch])).stdout
        break
      }
      case 'fetch':
        output = (await runGitOrThrow(cwd, ['fetch', currentRemote(before, action.remote), '--prune'])).stdout
        break
      case 'merge':
        output = (await runGitOrThrow(cwd, ['merge', '--no-edit', requireValue(action.branch, 'Branch name')])).stdout
        break
      case 'commit': {
        const options = action.options
        await runGitOrThrow(cwd, ['add', '.'])
        const staged = await git(cwd, ['diff', '--cached', '--quiet'])
        if (staged.exitCode === 0) throw new Error('There are no staged changes to commit.')
        if (staged.exitCode !== 1) throw commandError(staged)
        const args = ['commit', '-m', requireValue(options.message || '', 'Commit message')]
        if (options.sign === true) args.push('-S')
        if (options.sign === false) args.push('--no-gpg-sign')
        if (options.signoff) args.push('--signoff')
        if (options.coAuthor) {
          const name = requireValue(options.coAuthor.name, 'Co-author name')
          const email = requireValue(options.coAuthor.email, 'Co-author email')
          args.push('--trailer', `Co-authored-by: ${name} <${email}>`)
        }
        output = (await runGitOrThrow(cwd, args)).stdout
        break
      }
      case 'push': {
        if (!before.branch) throw new Error('A checked-out branch is required to push.')
        const args = before.upstream ? ['push'] : ['push', '--set-upstream', currentRemote(before, action.remote), before.branch]
        output = (await runGitOrThrow(cwd, args)).stdout
        break
      }
      case 'pull':
        output = (await runGitOrThrow(cwd, action.remote ? ['pull', '--rebase', action.remote] : ['pull', '--rebase'])).stdout
        break
      case 'sync': {
        const remote = currentRemote(before, action.remote)
        await runGitOrThrow(cwd, ['fetch', remote, '--prune'])
        await runGitOrThrow(cwd, ['pull', '--rebase'])
        output = (await runGitOrThrow(cwd, before.upstream ? ['push'] : ['push', '--set-upstream', remote, requireValue(before.branch || '', 'Branch name')])).stdout
        break
      }
      case 'reset':
        output = (await runGitOrThrow(cwd, ['reset', `--${action.mode}`, requireValue(action.hash, 'Commit hash')])).stdout
        break
      case 'abortOperation':
        output = (await abortOperation(cwd, before.operation)).stdout
        break
      case 'createPr': {
        if (!before.branch) throw new Error('A checked-out branch is required to create a pull request.')
        const remote = currentRemote(before)
        if (!before.upstream) await runGitOrThrow(cwd, ['push', '--set-upstream', remote, before.branch])
        const result = await run('gh', ['pr', 'create', '--base', requireValue(action.base, 'Base branch'), '--head', action.head?.trim() || before.branch, '--title', requireValue(action.title, 'Pull request title'), '--body', action.body || ''], cwd)
        if (result.exitCode !== 0) throw commandError(result)
        output = result.stdout
        prUrl = result.stdout.match(/https:\/\/\S+/)?.[0]
        break
      }
    }
    const snapshot = await getHarnessGitSnapshot(projectPath)
    return { ok: true, snapshot, output: trimOutput(output), prUrl }
  } catch (error) {
    const snapshot = await getHarnessGitSnapshot(projectPath)
    const conflict = snapshot.conflicts.length > 0 || Boolean(snapshot.operation)
    return {
      ok: false,
      snapshot,
      conflict,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function normalizeGeneratedMessage(text: string): string {
  const normalized = text
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()
  return normalized.split(/\r?\n/).slice(0, 3).join('\n').slice(0, 500)
}

export async function generateHarnessGitCommitMessage(
  projectPath: string,
  modelKey: string
): Promise<string> {
  const snapshot = await getHarnessGitSnapshot(projectPath)
  if (!snapshot.isGit || !snapshot.repoRoot) throw new Error(snapshot.error || 'Git repository unavailable.')
  const [staged, unstaged] = await Promise.all([
    git(snapshot.repoRoot, ['diff', '--cached', '--stat', '--patch']),
    git(snapshot.repoRoot, ['diff', '--stat', '--patch'])
  ])
  const diff = `${staged.stdout}\n${unstaged.stdout}`.trim().slice(0, 60000)
  if (!diff && snapshot.files.length === 0) throw new Error('There are no changes to describe.')
  const { resolveProviderAndModel, streamOpenAiCompletion } = await import('./ai')
  const { provider, model } = resolveProviderAndModel(modelKey)
  if (!provider || !model) throw new Error('Choose an available Harness model before generating a commit message.')
  const messages: OpenAiMessage[] = [
    {
      role: 'system',
      content: 'You write concise, accurate Git commit messages. Return only the commit message in English, with an imperative subject and optional short body. Do not use Markdown fences.'
    },
    {
      role: 'user',
      content: `Repository branch: ${snapshot.branch || 'detached'}\nChanged files: ${snapshot.files.map((file) => file.path).join(', ') || 'unknown'}\n\nDiff:\n${diff || 'No textual diff was available.'}`
    }
  ]
  let content = ''
  await streamOpenAiCompletion(provider, model.id, messages, [], new AbortController().signal, {
    onTextDelta: (delta) => { content += delta },
    onReasoningDelta: () => undefined,
    onToolCallDelta: () => undefined
  })
  const message = normalizeGeneratedMessage(content)
  if (!message) throw new Error('The selected model did not return a commit message.')
  return message
}
