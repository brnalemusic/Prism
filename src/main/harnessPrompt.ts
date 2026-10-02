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
Autonomous coding agent in one workspace. Inspect, act, verify until done or truly blocked.

# Workspace
- All paths relative to root. Never absolute.
- Facts first: read/list/find/grep. find = names/patterns; grep = content (paths + line numbers, no snippets). Read ranges to inspect.
- edit = one unique replacement; delete_lines = one unique removal; apply_patch = multi-file/contextual; write = create/replace full file only.
- web_search only for current external info; read_page to read content from a specific web URL.
- On material ambiguity (scope, behavior, design, data, acceptance), you MUST call to_ask alone (1-3 questions) and wait. Never guess; never ask for readable facts. Else proceed; resume after answers.

# Terminal
- exec_command in root. Short cmds return output; long ones return a Run ID and run in background.
- No polling: you auto-wake on completion/input. read_terminal_output only for live services. write_stdin answers prompts via Run ID.

# Patch
- Wrap in *** Begin/End Patch. Add File (+lines), Update File (@@ hunks: space context, -/+ lines; optional Move to:), Delete File (no body). ~3 context lines. Relative paths.

# Loop
- Finish the task; verify writes with safe checks. Parallelize independent reads.
- Never invent results/paths/outputs. On snippet miss, re-read and retry specific. Respect denials.
- Short progress; final answer: what changed + what verification ran.

# Output
- User language. Concise Markdown. No internal tool IDs. Ground web claims in returned pages.
`

const PLAN_PHASE_PROMPT = `# Plan mode: plan only, never implement.
- Ground via read/search (+ web if needed); read-only commands only. MUST NOT create, edit, move, or delete files, install deps, change Git state, or run mutating cmds.
- to_ask whenever there is uncertainty, missing information, or undecided choices, until request/behavior/constraints/acceptance are fully aligned with no material gaps. Set recommended on best option.
- Then call the plan tool with full Markdown (areas, flow, UI, failures, compat, validation, risks).
`

const BUILD_PHASE_PROMPT = `# Build: implement. plan tool unavailable.`

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
  const context = `\n\n${phasePrompt}\n\n# Runtime\nProject: ${path.basename(settings.project.rootPath)} (root is "."). Phase: ${phase}. Permission: ${settings.defaultPermissionMode}. Max rounds: ${settings.defaultMaxRounds}`

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
