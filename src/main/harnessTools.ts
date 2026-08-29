import { promises as fs } from 'fs'
import * as path from 'path'
import type { IpcMainEvent } from 'electron'
import type {
  EffectiveHarnessSettings,
  HarnessApprovalItem,
  HarnessToolName
} from '../shared/types'
import type { OpenAiToolDefinition } from './ai/types'
import { loadConfig } from './config'
import { requestQuestionnaire } from './systemTools'
import { assertCommandAllowed } from './localCommandSandbox'
import {
  changesDiff,
  parsePatchSections,
  replaceUnique,
  replaceUniqueAfter,
  type PreparedFileChange
} from './harnessFileOperations'
import { resolveHarnessProjectPath } from './harnessPathPolicy'
import { harnessWildcardRegex } from './harnessGlob'
import { grepFiles } from './harnessGrep'
import { searchAndReadWeb } from './webSearchService'
import {
  executeTerminalWithInitialWait,
  readTerminalOutput,
  sendTerminalInput
} from './terminalProcessManager'
import type {
  ToolExecutionContext,
  ToolResultEnvelope,
  ValidatedToolExecution
} from './toolRuntime'
import type { JsonSchema, ToolDefinition } from './toolsManifest'

const text = (description: string, enumValues?: string[]): JsonSchema => ({
  type: 'string',
  description,
  ...(enumValues ? { enum: enumValues } : {})
})
const integer = (description: string, minimum = 1, maximum?: number): JsonSchema => ({
  type: 'integer',
  description,
  minimum,
  ...(maximum === undefined ? {} : { maximum })
})
const boolean = (description: string): JsonSchema => ({ type: 'boolean', description })
const definition = (
  name: HarnessToolName,
  description: string,
  properties: Record<string, JsonSchema>,
  required: string[]
): ToolDefinition => ({
  name,
  description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false }
})

export const HARNESS_TOOL_DEFINITIONS: ToolDefinition[] = [
  definition(
    'read',
    'Read a bounded range from one UTF-8 text file in the project. Paths are relative to the project root.',
    {
      path: text('Project-relative file path.'),
      startLine: integer('First line to read, one-based.'),
      limit: integer('Maximum number of lines to return.')
    },
    ['path']
  ),
  definition(
    'list',
    'List the immediate entries in a project directory.',
    { path: text('Project-relative directory path. Use "." for the project root.') },
    []
  ),
  definition(
    'find',
    'Find project files by filename, relative path fragment, or wildcard pattern. Use this for file discovery without searching file contents.',
    {
      query: text('Relative path fragment or wildcard pattern.'),
      path: text('Optional project-relative directory to search from.'),
      limit: integer('Maximum number of matches.')
    },
    ['query']
  ),
  definition(
    'grep',
    'Search code and text contents across project files using regex or literal text patterns. Returns matching file paths and their 1-based line numbers (without line content to conserve tokens). Use the read tool to inspect specific line ranges.',
    {
      query: text('Text or regular expression to search for across file contents.'),
      path: text('Optional project-relative directory or file path to search within.'),
      include: text('Optional wildcard glob pattern to filter files (e.g. "*.ts", "src/**/*.tsx").'),
      isRegex: boolean('Whether query should be treated as a regular expression.'),
      caseSensitive: boolean(
        'Whether matching is case-sensitive. Defaults to true when query contains uppercase characters (smart-case), or false for all-lowercase queries.'
      ),
      wordMatch: boolean(
        'Whether to match whole words only (word boundaries \\b). Defaults to false.'
      ),
      limit: integer('Maximum number of matching lines to return. Defaults to 200.')
    },
    ['query']
  ),
  definition(
    'to_ask',
    'Ask the user concise clarifying questions and wait for their response before continuing. Use this before changing code when a material requirement or tradeoff is uncertain.',
    {
      session_id: text('Unique questionnaire session ID.'),
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        description: 'One to three questions rendered by Prism.',
        items: {
          type: 'object',
          properties: {
            id: text('Unique question ID.'),
            type: text('Question type.', ['multiple-choice', 'essay']),
            title: text('Short category title.'),
            prompt: text('Question shown to the user.'),
            options: {
              type: 'array',
              minItems: 2,
              maxItems: 10,
              description: 'Choices for a multiple-choice question.',
              items: {
                type: 'object',
                properties: {
                  value: text('Stable choice value.'),
                  label: text('User-facing choice label.')
                },
                required: ['value', 'label'],
                additionalProperties: false
              }
            }
          },
          required: ['id', 'type', 'title', 'prompt'],
          additionalProperties: false
        }
      }
    },
    ['session_id', 'questions']
  ),
  definition(
    'write',
    'Create a new UTF-8 file or intentionally replace its complete contents.',
    {
      path: text('Project-relative file path.'),
      content: text('Complete UTF-8 file contents.'),
      mode: text('Use create to fail if the file exists, or overwrite to replace it.', [
        'create',
        'overwrite'
      ])
    },
    ['path', 'content', 'mode']
  ),
  definition(
    'edit',
    'Replace one exact, unique text snippet in a UTF-8 project file.',
    {
      path: text('Project-relative file path.'),
      oldText: text('Exact text currently present in the file.'),
      newText: text('Exact replacement text.')
    },
    ['path', 'oldText', 'newText']
  ),
  definition(
    'delete_lines',
    'Delete one exact, unique text snippet from a UTF-8 project file.',
    {
      path: text('Project-relative file path.'),
      oldText: text('Exact text to remove, including enough surrounding lines to be unique.')
    },
    ['path', 'oldText']
  ),
  definition(
    'apply_patch',
    'Apply a Codex-style contextual patch. It can add, update, move, or delete multiple project files.',
    { patch: text('Patch text enclosed by *** Begin Patch and *** End Patch.') },
    ['patch']
  ),
  definition(
    'exec_command',
    'Run a command in the project root. Short commands return their exit code and output immediately. Long-running commands return a six-digit Run ID and run in the background. You do NOT need to poll: Prism will automatically resume/notify you when a background process completes or needs input.',
    {
      cmd: text('Command to execute using the configured project shell.'),
      yieldTimeMs: integer('Milliseconds to wait before returning a running command.')
    },
    ['cmd']
  ),
  definition(
    'write_stdin',
    'Send text or key sequences to a running terminal command by Run ID.',
    {
      runId: text('Six-digit terminal Run ID.'),
      input: text('Text to write to stdin.'),
      keys: { type: 'array', description: 'Optional key names.', items: text('Key name.') },
      pressEnter: boolean('Press Enter after input text. Defaults to true.')
    },
    ['runId']
  ),
  definition(
    'read_terminal_output',
    'Read terminal output accumulated so far for a Run ID. Use ONLY to inspect intermediate output of live persistent services or for targeted debugging. DO NOT call this repeatedly in a polling loop to wait for completion.',
    { runId: text('Six-digit terminal Run ID.') },
    ['runId']
  ),
  definition(
    'web_search',
    'Search DuckDuckGo HTML and automatically read the requested number of reachable source pages.',
    {
      query: text('Focused web search query.'),
      resultCount: integer(
        'Number of Sources to return. Minimum: 1. Recommended: 2–4. Use 5–8 only for specific cases. Maximum: 10.',
        1,
        10
      )
    },
    ['query', 'resultCount']
  )
]

const LABELS: Record<HarnessToolName, string> = {
  read: 'Reading file',
  list: 'Listing directory',
  find: 'Finding files',
  grep: 'Searching code',
  to_ask: 'Asking a question',
  write: 'Writing file',
  edit: 'Editing file',
  delete_lines: 'Deleting lines',
  apply_patch: 'Applying patch',
  exec_command: 'Running command',
  write_stdin: 'Sending terminal input',
  read_terminal_output: 'Reading terminal output',
  web_search: 'Searching the web'
}

interface HarnessExecutionContext extends ToolExecutionContext {
  projectRoot: string
  settings: EffectiveHarnessSettings
}

function parseArgs(rawArgs: unknown): Record<string, unknown> {
  if (typeof rawArgs === 'string') {
    const parsed = JSON.parse(rawArgs)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Tool arguments must be a JSON object.')
    }
    return parsed as Record<string, unknown>
  }
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    throw new Error('Tool arguments must be an object.')
  }
  return rawArgs as Record<string, unknown>
}

function commandReferencesOutsideProject(command: string): boolean {
  const normalized = command.replace(/\\/g, '/')
  return (
    /(?:^|[\s"'=])(\.\.)(?:\/|$|[\s"';|&])/i.test(normalized) ||
    /(?:^|[\s"'=])(?:[a-z]:\/|\/\/(?:[^/]+)\/|\/(?:home|root|etc|usr|var|opt|tmp|users)\/)/i.test(
      normalized
    ) ||
    /(?:\$env:|\$\{env:|%)(?:userprofile|home|appdata|localappdata|temp|tmp|windir|systemroot)/i.test(
      command
    ) ||
    /(?:^|[\s;&|])(mklink|ln\s+-s|new-item\b[^\r\n]*-itemtype\s+(?:symboliclink|junction))/i.test(
      command
    )
  )
}

function requiredString(args: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = args[key]
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new Error(`arguments.${key} must be a${allowEmpty ? '' : ' non-empty'} string.`)
  }
  return value
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Expected an integer between ${minimum} and ${maximum}.`)
  }
  return value
}

const resolveProjectPath = resolveHarnessProjectPath

async function prepareSimpleChange(
  name: HarnessToolName,
  args: Record<string, unknown>,
  projectRoot: string
): Promise<PreparedFileChange[]> {
  if (!['write', 'edit', 'delete_lines'].includes(name)) return []
  const relativePath = requiredString(args, 'path')
  const target = await resolveProjectPath(projectRoot, relativePath, name === 'write')
  let before = ''
  let exists = true
  try {
    before = await fs.readFile(target, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    exists = false
  }
  if (name === 'write') {
    const mode = requiredString(args, 'mode')
    if (mode !== 'create' && mode !== 'overwrite')
      throw new Error('arguments.mode must be create or overwrite.')
    if (mode === 'create' && exists)
      throw new Error(
        'The file already exists; use mode "overwrite", or "read" and "edit" the original file.'
      )
    if (mode === 'overwrite' && !exists)
      throw new Error('The file does not exist; use mode "create".')
    return [
      {
        kind: exists ? 'update' : 'add',
        path: relativePath,
        before,
        after: requiredString(args, 'content', true)
      }
    ]
  }
  const oldText = requiredString(args, 'oldText')
  return [
    {
      kind: 'update',
      path: relativePath,
      before,
      after: replaceUnique(
        before,
        oldText,
        name === 'edit' ? requiredString(args, 'newText', true) : ''
      )
    }
  ]
}

async function preparePatchChanges(
  patchText: string,
  projectRoot: string
): Promise<PreparedFileChange[]> {
  const sections = parsePatchSections(patchText)
  const changes: PreparedFileChange[] = []
  for (const section of sections) {
    const target = await resolveProjectPath(projectRoot, section.path, section.kind === 'add')
    if (section.kind === 'add') {
      try {
        await fs.access(target)
        throw new Error(`Cannot add existing file: ${section.path}`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (section.lines.some((line) => !line.startsWith('+') && line !== '')) {
        throw new Error(`Every added line must start with + in ${section.path}.`)
      }
      changes.push({
        kind: 'add',
        path: section.path,
        before: '',
        after: section.lines.map((line) => (line.startsWith('+') ? line.slice(1) : '')).join('\n')
      })
      continue
    }

    const before = await fs.readFile(target, 'utf8')
    if (section.kind === 'delete') {
      if (section.lines.some((line) => line.trim())) {
        throw new Error(`Delete File must not include a body: ${section.path}`)
      }
      changes.push({ kind: 'delete', path: section.path, before, after: '' })
      continue
    }

    let after = before.replace(/\r\n/g, '\n')
    let hunk: string[] = []
    let searchStart = 0
    const applyHunk = (): void => {
      if (hunk.length === 0) return
      const oldText = hunk
        .filter((line) => line.startsWith(' ') || line.startsWith('-'))
        .map((line) => line.slice(1))
        .join('\n')
      const newText = hunk
        .filter((line) => line.startsWith(' ') || line.startsWith('+'))
        .map((line) => line.slice(1))
        .join('\n')
      if (!oldText)
        throw new Error(`Update hunks must include existing context in ${section.path}.`)
      const replacement = replaceUniqueAfter(after, oldText, newText, searchStart)
      after = replacement.content
      searchStart = replacement.nextIndex
      hunk = []
    }
    for (const line of section.lines) {
      if (line.startsWith('@@')) {
        applyHunk()
        const scope = line.slice(2).trim()
        if (scope) {
          const scopeIndex = after.indexOf(scope, searchStart)
          if (scopeIndex === -1) {
            throw new Error(`Patch @@ scope was not found in ${section.path}: ${scope}`)
          }
          searchStart = scopeIndex + scope.length
        }
        continue
      }
      if (line === '*** End of File') continue
      if (!line.startsWith(' ') && !line.startsWith('+') && !line.startsWith('-')) {
        throw new Error(`Invalid patch line in ${section.path}: ${line}`)
      }
      hunk.push(line)
    }
    applyHunk()
    const targetPath = section.moveTo
      ? path.relative(projectRoot, await resolveProjectPath(projectRoot, section.moveTo, true))
      : undefined
    if (targetPath) {
      const moveTarget = await resolveProjectPath(projectRoot, targetPath, true)
      try {
        await fs.access(moveTarget)
        throw new Error(`Cannot move to existing file: ${targetPath}`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    changes.push({
      kind: section.moveTo ? 'move' : 'update',
      path: section.path,
      targetPath,
      before,
      after: before.includes('\r\n') ? after.replace(/\n/g, '\r\n') : after
    })
  }
  return changes
}

async function applyPreparedChanges(
  projectRoot: string,
  changes: PreparedFileChange[]
): Promise<void> {
  for (const change of changes) {
    const source = await resolveProjectPath(projectRoot, change.path, change.kind === 'add')
    if (change.kind === 'delete') {
      await fs.unlink(source)
      continue
    }
    const destination = change.targetPath
      ? await resolveProjectPath(projectRoot, change.targetPath, true)
      : source
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, change.after, {
      encoding: 'utf8',
      flag: change.kind === 'add' ? 'wx' : 'w'
    })
    if (change.kind === 'move' && destination !== source) await fs.unlink(source)
  }
}

async function findFiles(
  root: string,
  start: string,
  query: string,
  limit: number
): Promise<string[]> {
  const results: string[] = []
  const usesWildcard = query.includes('*')
  const matcher = usesWildcard ? harnessWildcardRegex(query.replace(/\\/g, '/')) : null
  const walk = async (directory: string): Promise<void> => {
    if (results.length >= limit) return
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (results.length >= limit) break
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const fullPath = path.join(directory, entry.name)
      const relative = path.relative(root, fullPath).replace(/\\/g, '/')
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) await walk(fullPath)
      else if (
        matcher ? matcher.test(relative) : relative.toLowerCase().includes(query.toLowerCase())
      ) {
        results.push(relative)
      }
    }
  }
  await walk(start)
  return results
}



function capOutput(value: string, maximum: number): string {
  if (value.length <= maximum) return value
  return `${value.slice(0, maximum)}\n[Output truncated at ${maximum.toLocaleString('en-US')} characters]`
}

async function executeOperation(
  name: HarnessToolName,
  args: Record<string, unknown>,
  context: HarnessExecutionContext
): Promise<string> {
  const root = context.projectRoot
  if (name === 'read') {
    const relativePath = requiredString(args, 'path')
    const target = await resolveProjectPath(root, relativePath)
    const startLine = boundedInteger(args.startLine, 1, 1, Number.MAX_SAFE_INTEGER)
    const limit = boundedInteger(
      args.limit,
      Math.min(500, context.settings.maxReadLines),
      1,
      context.settings.maxReadLines
    )
    const content = await fs.readFile(target, 'utf8')
    const lines = content.replace(/\r\n/g, '\n').split('\n')
    const selected = lines.slice(startLine - 1, startLine - 1 + limit).join('\n')
    return JSON.stringify({
      path: relativePath,
      startLine,
      endLine: Math.min(lines.length, startLine - 1 + limit),
      totalLines: lines.length,
      content: capOutput(selected, context.settings.maxReadCharacters)
    })
  }
  if (name === 'list') {
    const relativePath = typeof args.path === 'string' && args.path.trim() ? args.path : '.'
    const target = await resolveProjectPath(root, relativePath)
    const entries = await fs.readdir(target, { withFileTypes: true })
    return JSON.stringify({
      path: relativePath,
      entries: entries
        .filter((entry) => entry.name !== '.git')
        .map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file'
        }))
        .sort(
          (left, right) =>
            left.type.localeCompare(right.type) || left.name.localeCompare(right.name)
        )
    })
  }
  if (name === 'find') {
    const query = requiredString(args, 'query')
    const relativePath = typeof args.path === 'string' && args.path.trim() ? args.path : '.'
    const start = await resolveProjectPath(root, relativePath)
    const limit = boundedInteger(args.limit, 200, 1, 1000)
    return JSON.stringify({ query, matches: await findFiles(root, start, query, limit) })
  }
  if (name === 'grep') {
    const query = requiredString(args, 'query')
    const relativePath = typeof args.path === 'string' && args.path.trim() ? args.path : '.'
    const start = await resolveProjectPath(root, relativePath)
    const include =
      typeof args.include === 'string' && args.include.trim() ? args.include.trim() : undefined
    const isRegex = typeof args.isRegex === 'boolean' ? args.isRegex : false
    const caseSensitive =
      typeof args.caseSensitive === 'boolean' ? args.caseSensitive : undefined
    const wordMatch = typeof args.wordMatch === 'boolean' ? args.wordMatch : false
    const limit = boundedInteger(args.limit, 200, 1, 1000)
    const result = await grepFiles(root, start, query, {
      include,
      isRegex,
      caseSensitive,
      wordMatch,
      limit
    })
    return JSON.stringify(result)
  }
  if (name === 'to_ask') {
    return requestQuestionnaire(args, context.signal)
  }
  if (['write', 'edit', 'delete_lines'].includes(name)) {
    const changes = await prepareSimpleChange(name, args, root)
    await applyPreparedChanges(root, changes)
    return JSON.stringify({
      changed: changes.map((change) => change.path),
      diff: changesDiff(changes)
    })
  }
  if (name === 'apply_patch') {
    const changes = await preparePatchChanges(requiredString(args, 'patch'), root)
    await applyPreparedChanges(root, changes)
    return JSON.stringify({
      changed: changes.map((change) => change.targetPath || change.path),
      diff: changesDiff(changes)
    })
  }
  if (name === 'exec_command') {
    const cmd = requiredString(args, 'cmd')
    assertCommandAllowed(cmd)
    const wait = boundedInteger(args.yieldTimeMs, 5_000, 250, 30_000)
    const config = loadConfig()
    const execution = await executeTerminalWithInitialWait(
      cmd,
      {
        chatId: context.chatId || 'harness',
        cwd: root,
        shell: config.terminalShell,
        apiKey: context.apiKey,
        event: context.event as IpcMainEvent | undefined,
        toolCallName: 'exec_command',
        signal: context.signal
      },
      wait
    )
    return JSON.stringify({
      runId: execution.runId,
      completed: execution.completed,
      exitCode: execution.exitCode,
      output: capOutput(execution.output, context.settings.maxTerminalOutputCharacters)
    })
  }
  if (name === 'write_stdin') {
    const runId = requiredString(args, 'runId')
    const output = await sendTerminalInput(
      runId,
      {
        input: typeof args.input === 'string' ? args.input : undefined,
        keys: Array.isArray(args.keys)
          ? args.keys.filter((key): key is string => typeof key === 'string')
          : undefined,
        pressEnter: args.pressEnter !== false
      },
      context.chatId
    )
    return capOutput(output, context.settings.maxTerminalOutputCharacters)
  }
  if (name === 'read_terminal_output') {
    return capOutput(
      readTerminalOutput(requiredString(args, 'runId'), context.chatId),
      context.settings.maxTerminalOutputCharacters
    )
  }
  if (name === 'web_search') {
    const resultCount = args.resultCount
    if (!Number.isInteger(resultCount) || (resultCount as number) < 1 || (resultCount as number) > 10) {
      throw new Error('resultCount must be an integer between 1 and 10.')
    }
    return JSON.stringify(
      await searchAndReadWeb(
        requiredString(args, 'query'),
        { ...context.settings, webPageCount: resultCount as number },
        context.signal
      )
    )
  }
  throw new Error(`Unsupported Harness tool: ${name}`)
}

function failure(args: Record<string, unknown>, error: unknown): ValidatedToolExecution {
  const envelope: ToolResultEnvelope = {
    ok: false,
    error: {
      code: 'EXECUTION_FAILED',
      message: error instanceof Error ? error.message : String(error),
      retryable: true
    }
  }
  return { args, envelope, modelContent: JSON.stringify(envelope) }
}

export function getHarnessOpenAiToolDefinitions(
  enabledTools: HarnessToolName[]
): OpenAiToolDefinition[] {
  const enabled = new Set(enabledTools)
  return HARNESS_TOOL_DEFINITIONS.filter((tool) => enabled.has(tool.name as HarnessToolName)).map(
    (tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema as unknown as Record<string, unknown>
      }
    })
  )
}

export async function previewHarnessTool(
  callId: string,
  nameValue: string,
  rawArgs: unknown,
  projectRoot: string
): Promise<HarnessApprovalItem> {
  if (!HARNESS_TOOL_DEFINITIONS.some((tool) => tool.name === nameValue)) {
    throw new Error(`Unknown Harness tool: ${nameValue}`)
  }
  const name = nameValue as HarnessToolName
  const args = parseArgs(rawArgs)
  let preview: string | undefined
  if (['write', 'edit', 'delete_lines'].includes(name)) {
    preview = changesDiff(await prepareSimpleChange(name, args, projectRoot))
  } else if (name === 'apply_patch') {
    preview = changesDiff(await preparePatchChanges(requiredString(args, 'patch'), projectRoot))
  } else if (name === 'exec_command') {
    preview = `> ${requiredString(args, 'cmd')}`
  }
  return {
    callId,
    name,
    label: LABELS[name],
    args,
    preview,
    destructive: [
      'write',
      'edit',
      'delete_lines',
      'apply_patch',
      'exec_command',
      'write_stdin'
    ].includes(name)
  }
}

export async function executeHarnessTool(
  nameValue: string,
  rawArgs: unknown,
  context: HarnessExecutionContext
): Promise<ValidatedToolExecution> {
  let args: Record<string, unknown> = {}
  let started = false
  try {
    if (!HARNESS_TOOL_DEFINITIONS.some((tool) => tool.name === nameValue)) {
      throw new Error(`Unknown Harness tool: ${nameValue}`)
    }
    args = parseArgs(rawArgs)
    if (
      nameValue === 'to_ask' &&
      (typeof args.session_id !== 'string' || !args.session_id.trim())
    ) {
      args = { ...args, session_id: `harness-question-${crypto.randomUUID()}` }
    }
    context.onStart?.(args)
    started = true
    const output = await executeOperation(nameValue as HarnessToolName, args, context)
    const envelope: ToolResultEnvelope = { ok: true, output }
    return { args, envelope, modelContent: JSON.stringify(envelope) }
  } catch (error) {
    if (!started) context.onStart?.(args)
    return failure(args, error)
  }
}

export function isHarnessToolName(name: string): name is HarnessToolName {
  return HARNESS_TOOL_DEFINITIONS.some((tool) => tool.name === name)
}

export function getHarnessToolLabel(name: string): string {
  return isHarnessToolName(name) ? LABELS[name] : name.replace(/_/g, ' ')
}

export function harnessToolRequiresExternalApproval(nameValue: string, rawArgs: unknown): boolean {
  if (nameValue !== 'exec_command') return false
  try {
    return commandReferencesOutsideProject(requiredString(parseArgs(rawArgs), 'cmd'))
  } catch {
    return true
  }
}
