import { promises as fs, watch as watchDirectory, type FSWatcher } from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import type {
  EffectiveHarnessSettings,
  HarnessContextInjectionEntry,
  HarnessInstructionStatus
} from '../shared/types'

export const HARNESS_SYSTEM_MAX_CHARACTERS = 80_000
export const HARNESS_SYSTEM_MAX_TOKENS = 20_000
export const HARNESS_USER_INSTRUCTIONS_MAX_CHARACTERS = 5_000

export interface HarnessPromptResult {
  prompt: string
  fingerprint: string
  entries: HarnessContextInjectionEntry[]
  repoInstructionsLoaded: boolean
  repoInstructionsCharacters: number
  warnings: string[]
}

interface CachedHarnessPrompt {
  settingsFingerprint: string
  result: HarnessPromptResult
  stale: boolean
  watchers?: FSWatcher[]
}

const promptCache = new Map<string, CachedHarnessPrompt>()

function promptCacheKey(settings: EffectiveHarnessSettings, label: string): string {
  return `${path.resolve(settings.project.rootPath).toLowerCase()}::${label}`
}

function settingsFingerprint(settings: EffectiveHarnessSettings): string {
  return JSON.stringify({
    global: settings.userGlobalInstructions,
    project: settings.project.userProjectInstructions || '',
    permission: settings.defaultPermissionMode,
    rounds: settings.defaultMaxRounds,
    tools: settings.enabledTools,
    root: settings.project.rootPath
  })
}

function repoInstructionCandidatePaths(rootPath: string): string[] {
  return [
    path.join(rootPath, 'AGENTS.md'),
    path.join(rootPath, '.agents', 'AGENTS.md'),
    path.join(rootPath, '.agents', 'rules', 'AGENTS.md')
  ]
}

function watchProjectInstructions(cacheKey: string, rootPath: string): FSWatcher[] {
  const candidates = repoInstructionCandidatePaths(rootPath).map((filePath) => path.resolve(filePath))
  const directories = [...new Set([rootPath, ...candidates.map((filePath) => path.dirname(filePath))])]
  const watchers: FSWatcher[] = []

  for (const directory of directories) {
    try {
      watchers.push(
        watchDirectory(directory, { persistent: false }, (_eventType, filename) => {
          if (!filename) return
          if (candidates.includes(path.resolve(directory, filename.toString()))) {
            const cached = promptCache.get(cacheKey)
            if (cached) cached.stale = true
          }
        })
      )
    } catch {
      // A candidate directory may not exist. Its parent watcher will notice when it
      // is created; Settings changes also invalidate the cached prompt.
    }
  }
  return watchers
}

const CORE_PROMPT = `# Prism Harness
You are an autonomous coding agent operating inside one project workspace. Work iteratively: inspect, act, verify, and continue until the request is complete or a real blocker requires the user.

# Workspace contract
- Every file path is relative to the project root. Never send an absolute path.
- Prefer read, list, find, and grep to establish facts before changing code.
- Use find to locate files by name or path pattern without reading contents.
- Use grep to search code and text contents across project files for exact text or regex patterns, returning matching file paths and line numbers without line snippets to save tokens. Grep uses smart-case by default (case-sensitive if query contains uppercase letters), and supports wordMatch (whole word matching \b) and regex patterns. Use read on matching line ranges when you need to inspect code.
- Use edit for one exact, unique replacement and delete_lines for one exact, unique removal.
- Use apply_patch for contextual or multi-file changes. Keep patches focused and include enough unchanged context to match safely.
- Use write only when creating a file or intentionally replacing its complete contents.
- Use web_search only when current external information is needed. Its result already contains the fetched source pages.
- When a requested change has a material ambiguity about scope, intended behavior, user-visible design, data handling, or acceptance criteria, you MUST call to_ask before editing files or running consequential commands. Ask only the one to three decisions needed to proceed; do not guess. Call it on its own, then wait for the response before any mutation.
- Do not use to_ask for facts you can establish by reading the project. When the request is already unambiguous, continue without asking. After the user answers, incorporate the answer and resume the loop.

# Terminal & process execution
- Use exec_command to run shell commands in the project root.
- Synchronous vs. Background commands:
  - Short, bounded commands (e.g. git status, linters, fast unit tests, typechecks) execute and return their exit code and complete output immediately.
  - Long-running commands, dev servers, watchers, or heavy builds yield a 6-digit Run ID and continue running in the background.
- Reactive wakeup (DO NOT poll):
  - When a command is running in the background, you do NOT need to wait actively, loop, or sleep.
  - You can stop calling tools, provide a brief update if appropriate, and end your response.
  - Prism's background process manager automatically monitors the process and will resume/wake you up with an automatic system notification as soon as the command finishes (including exit code and full output) or when it requests interactive input.
- NEVER repeatedly call read_terminal_output in a loop to check if a command finished. Polling is strictly prohibited and wastes turns. Only use read_terminal_output when you explicitly need to inspect intermediate logs or diagnose a live persistent service.
- Interactive input: When a command requests interactive input (e.g. confirmation prompts [y/n], package manager questions, select menus), Prism automatically notifies you. Use write_stdin with the Run ID to submit answers or send key sequences.

# apply_patch format
- Wrap every patch in *** Begin Patch and *** End Patch.
- Start each operation with *** Add File: path, *** Update File: path, or *** Delete File: path.
- Add File content uses + at the start of every line. Delete File has no body.
- Update File uses one or more @@ hunks. Inside a hunk, unchanged context starts with a space, removed lines with -, and added lines with +.
- An Update File may put *** Move to: new/path immediately after its header.
- Use an optional @@ class/function header to scope a repeated snippet, and use additional @@ headers when needed to reach unique context.
- Include about three unchanged lines above and below changes when practical. Paths are always relative.

# Agent loop
- Continue through the complete task. After writes, inspect the result and run the most relevant safe checks.
- Parallelize independent reads when the provider supports parallel tool calls.
- Never invent tool results, paths, command output, diffs, tests, or sources.
- If a tool fails because a snippet is missing or ambiguous, read the current file and retry with a more specific exact snippet.
- Respect permission denials. Do not disguise a denied operation as a different command.
- Keep user-facing progress short. The final answer states what changed and what verification actually ran.

# Output
- Match the user's language.
- Use concise Markdown.
- Do not expose internal tool IDs. Refer to actions by their clear purpose.
- When web_search was used, ground claims in the returned pages; Prism renders the read pages separately as Sources.`

function instructionSection(title: string, content: string): string {
  const trimmed = content.trim()
  return trimmed ? `\n\n# ${title}\n${trimmed}` : ''
}

interface RepoInstructions {
  content: string
  paths: string[]
}

async function readRepoInstructions(rootPath: string): Promise<RepoInstructions> {
  const files = await Promise.all(
    repoInstructionCandidatePaths(rootPath).map(async (filePath) => {
      try {
        return { path: filePath, content: await fs.readFile(filePath, 'utf8') }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    })
  )
  const found = files.filter((file): file is { path: string; content: string } => file !== null)
  return {
    content: found.map((file) => file.content).filter((content) => content.trim()).join('\n\n'),
    paths: found.filter((file) => file.content.trim()).map((file) => file.path)
  }
}

export async function buildHarnessSystemPrompt(
  settings: EffectiveHarnessSettings,
  systemPromptLabel = '@prism/harness-system-prompt'
): Promise<HarnessPromptResult> {
  const warnings: string[] = []
  const globalInstructions = settings.userGlobalInstructions.slice(
    0,
    HARNESS_USER_INSTRUCTIONS_MAX_CHARACTERS
  )
  const projectInstructions = (settings.project.userProjectInstructions || '').slice(
    0,
    HARNESS_USER_INSTRUCTIONS_MAX_CHARACTERS
  )
  const repoInstructionFiles = await readRepoInstructions(settings.project.rootPath)
  const repoInstructions = repoInstructionFiles.content
  const context = `\n\n# Runtime context\nProject: ${path.basename(settings.project.rootPath)}\nThe current project root is ".".\nPermission profile: ${settings.defaultPermissionMode}\nMaximum tool rounds: ${settings.defaultMaxRounds}\nEnabled tools: ${settings.enabledTools.join(', ')}`

  const requiredTail =
    instructionSection('User Project Instructions', projectInstructions) + context
  const fixedPrefix =
    CORE_PROMPT + instructionSection('User Global Instructions', globalInstructions)
  const repoHeading = repoInstructions.trim() ? '\n\n# Repo Instructions (AGENTS.md)\n' : ''
  const remainingForRepo = Math.max(
    0,
    HARNESS_SYSTEM_MAX_CHARACTERS - fixedPrefix.length - repoHeading.length - requiredTail.length
  )
  let includedRepoInstructions = repoInstructions.trim()
  if (includedRepoInstructions.length > remainingForRepo) {
    includedRepoInstructions = includedRepoInstructions.slice(0, remainingForRepo)
    warnings.push(
      `AGENTS.md exceeded the Harness system-instruction budget and was truncated to ${remainingForRepo.toLocaleString('en-US')} characters.`
    )
  }

  let prompt = fixedPrefix + repoHeading + includedRepoInstructions + requiredTail
  if (prompt.length > HARNESS_SYSTEM_MAX_CHARACTERS) {
    prompt = prompt.slice(0, HARNESS_SYSTEM_MAX_CHARACTERS)
    warnings.push('Harness system instructions reached the 80,000 character hard limit.')
  }

  const entries: HarnessContextInjectionEntry[] = [
    {
      id: 'harness-system-prompt',
      kind: 'system',
      label: systemPromptLabel,
      origin: 'Prism Harness',
      content: CORE_PROMPT + context,
      characterCount: CORE_PROMPT.length + context.length
    }
  ]
  if (globalInstructions.trim()) {
    entries.push({
      id: 'user-global-instructions',
      kind: 'global',
      label: 'user-global-instructions',
      origin: 'Settings > Harness',
      content: globalInstructions.trim(),
      characterCount: globalInstructions.trim().length
    })
  }
  if (includedRepoInstructions) {
    entries.push({
      id: 'repo-instructions',
      kind: 'repo',
      label: 'repo-instructions · AGENTS.md',
      origin: repoInstructionFiles.paths.join(', '),
      content: includedRepoInstructions,
      characterCount: includedRepoInstructions.length
    })
  }
  if (projectInstructions.trim()) {
    entries.push({
      id: 'user-project-instructions',
      kind: 'project',
      label: 'user-project-instructions',
      origin: settings.project.displayName,
      content: projectInstructions.trim(),
      characterCount: projectInstructions.trim().length
    })
  }

  return {
    prompt,
    fingerprint: createHash('sha256').update(prompt).digest('hex').slice(0, 24),
    entries,
    repoInstructionsLoaded: Boolean(repoInstructions.trim()),
    repoInstructionsCharacters: includedRepoInstructions.length,
    warnings
  }
}

/**
 * Keeps Harness instructions as a session-scoped cached context. The project
 * directory watcher invalidates AGENTS.md changes; Settings changes alter the
 * in-memory signature. Requests that do not change either reuse this result.
 */
export async function getHarnessSystemPrompt(
  settings: EffectiveHarnessSettings,
  systemPromptLabel = '@prism/harness-system-prompt'
): Promise<HarnessPromptResult> {
  const key = promptCacheKey(settings, systemPromptLabel)
  const signature = settingsFingerprint(settings)
  const cached = promptCache.get(key)
  if (cached && !cached.stale && cached.settingsFingerprint === signature) {
    return cached.result
  }

  const result = await buildHarnessSystemPrompt(settings, systemPromptLabel)
  cached?.watchers?.forEach((watcher) => watcher.close())
  promptCache.set(key, {
    settingsFingerprint: signature,
    result,
    stale: false,
    watchers: watchProjectInstructions(key, settings.project.rootPath)
  })
  return result
}

export async function getHarnessInstructionStatus(
  settings: EffectiveHarnessSettings
): Promise<HarnessInstructionStatus> {
  const repoInstructions = await readRepoInstructions(settings.project.rootPath)
  const result = await buildHarnessSystemPrompt(settings)
  const globalCharacters = settings.userGlobalInstructions.slice(
    0,
    HARNESS_USER_INSTRUCTIONS_MAX_CHARACTERS
  ).length
  const projectCharacters = (settings.project.userProjectInstructions || '').slice(
    0,
    HARNESS_USER_INSTRUCTIONS_MAX_CHARACTERS
  ).length
  return {
    projectPath: settings.project.rootPath,
    coreCharacters: CORE_PROMPT.length,
    globalCharacters,
    repoExists: Boolean(repoInstructions.content.trim()),
    repoInstructionPaths: repoInstructions.paths,
    repoCharacters: repoInstructions.content.length,
    repoIncludedCharacters: result.repoInstructionsCharacters,
    projectCharacters,
    totalCharacters: result.prompt.length,
    estimatedTokens: Math.ceil(result.prompt.length / 4),
    warnings: result.warnings
  }
}
