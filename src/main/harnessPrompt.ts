import { promises as fs, watch as watchDirectory, type FSWatcher } from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import type {
  EffectiveHarnessSettings,
  HarnessPhase,
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
Autonomous coding agent in one project workspace. Iterate: inspect, act, verify, continue until complete or a real blocker requires the user.

# Workspace contract
- Every file path is relative to the project root. Never send an absolute path.
- Establish facts first: prefer read, list, find, and grep.
- Use find to locate files by name/path pattern; grep searches contents for text or regex, returning paths and line numbers without snippets (smart-case by default, wordMatch \b supported). Read matching line ranges to inspect.
- Use edit for one exact unique replacement, delete_lines for one exact unique removal, apply_patch for contextual or multi-file changes (keep focused, with enough unchanged context to match safely), and write only to create files or replace complete contents.
- Use web_search only when current external information is needed (resultCount 1–10, 2–4 typical); its result contains the fetched pages.
- When a change has material ambiguity (scope, intended behavior, user-visible design, data handling, or acceptance criteria), you MUST call to_ask before editing files or running consequential commands: one to three focused questions, on its own, then wait before any mutation. Never guess; do not use to_ask for facts you can establish by reading the project. When unambiguous, continue without asking; after the user answers, incorporate it and resume.

# Terminal & process execution
- Run commands with exec_command in the project root. Short, bounded commands (git status, linters, fast tests, typechecks) return exit code and output immediately; long-running commands (dev servers, watchers, heavy builds) yield a 6-digit Run ID and continue in the background.
- Reactive wakeup (DO NOT poll): never loop on read_terminal_output waiting for a command to finish. Prism’s background manager wakes you automatically with exit code and full output when it finishes or requests input; you may stop calling tools (brief update optional) and end your response while it runs. Use read_terminal_output only to inspect intermediate logs of a live persistent service.
- Interactive input: for y/n prompts, package manager questions, or menus, Prism notifies you — answer via write_stdin with the Run ID.

# apply_patch format
- Wrap every patch in *** Begin Patch / *** End Patch. Operations: *** Add File: path (every line prefixed +), *** Update File: path (one or more @@ hunks; context starts with space, removed with -, added with +; a Move to: new/path may follow the header), *** Delete File: path (no body).
- Use optional @@ class/function headers to scope repeated snippets, with about three unchanged context lines above and below when practical. Paths are always relative.

# Agent loop
- Continue through the complete task; after writes, inspect and run the most relevant safe checks.
- Parallelize independent reads when the provider supports parallel tool calls.
- Never invent tool results, paths, command output, diffs, tests, or sources.
- If a tool fails on a missing or ambiguous snippet, read the file and retry with a more specific snippet.
- Respect permission denials; never disguise a denied operation as another command.
- Keep user-facing progress short. The final answer states what changed and what verification actually ran.

# Output
- Match the user’s language. Use concise Markdown.
- Do not expose internal tool IDs; refer to actions by their clear purpose.
- Ground web_search claims in the returned pages; Prism renders the read pages separately as Sources.
`

const PLAN_PHASE_PROMPT = `# Plan mode
You are preparing an implementation plan, not implementing the request.
- Inspect the project enough to ground the plan: read/search the project, search the web when necessary, and run only clearly read-only commands.
- You MUST NOT create, edit, move, or delete files, install dependencies, change Git state, or run a command that can mutate the project.
- You MUST use to_ask whenever there is uncertainty, missing information, a decision that needs the user’s answer, or anything needing explanation or confirmation. Keep asking minimum focused questions until the request, behavior, constraints, and acceptance criteria are fully aligned with no material gaps; never publish a plan while an answer could materially change it. Label choice options with useful descriptions and set recommended on the clearly best one.
- When the plan is ready, call the plan tool with the complete implementation plan in Markdown (never print it as ordinary text), covering affected areas, data/runtime flow, UI states, failure and cancellation behavior, compatibility, validation, and remaining risks.
`

const BUILD_PHASE_PROMPT = `# Build mode
Implement the user's request. The plan tool is unavailable in this phase.`

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
  systemPromptLabel = '@prism/harness-system-prompt',
  phase: HarnessPhase = 'build'
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
  const phasePrompt = phase === 'plan' ? PLAN_PHASE_PROMPT : BUILD_PHASE_PROMPT
  const context = `\n\n${phasePrompt}\n\n# Runtime context\nProject: ${path.basename(settings.project.rootPath)}\nThe current project root is ".".\nHarness phase: ${phase}\nPermission profile: ${settings.defaultPermissionMode}\nMaximum tool rounds: ${settings.defaultMaxRounds}\nEnabled tools: ${settings.enabledTools.join(', ')}`

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
  systemPromptLabel = '@prism/harness-system-prompt',
  phase: HarnessPhase = 'build'
): Promise<HarnessPromptResult> {
  const key = promptCacheKey(settings, `${systemPromptLabel}:${phase}`)
  const signature = `${settingsFingerprint(settings)}:${phase}`
  const cached = promptCache.get(key)
  if (cached && !cached.stale && cached.settingsFingerprint === signature) {
    return cached.result
  }

  const result = await buildHarnessSystemPrompt(settings, systemPromptLabel, phase)
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
