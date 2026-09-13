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
import { interChatManager } from './ai/interChatManager'
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
import { searchAndReadWeb, readWebPage } from './webSearchService'
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
    'Read a line range from one project file. Relative paths only.',
    {
      path: text('Relative file path.'),
      startLine: integer('First line (1-based).'),
      limit: integer('Max lines.')
    },
    ['path']
  ),
  definition('list', 'List a project directory.', { path: text('Relative dir. "." = root.') }, []),
  definition(
    'find',
    'Find files by name/pattern. No content search.',
    {
      query: text('Path fragment or wildcard.'),
      path: text('Optional dir to search from.'),
      limit: integer('Max matches.')
    },
    ['query']
  ),
  definition(
    'grep',
    'Search file contents; returns paths + line numbers only. Then read ranges.',
    {
      query: text('Text or regex.'),
      path: text('Optional dir/file to search in.'),
      include: text('Optional glob, e.g. "*.ts".'),
      isRegex: boolean('Treat query as regex.'),
      caseSensitive: boolean('Case-sensitive (smart-case default).'),
      wordMatch: boolean('Whole words only.'),
      limit: integer('Max matches (default 200).')
    },
    ['query']
  ),
  definition(
    'to_ask',
    'Ask clarifying questions and wait. Use before code changes on uncertainty.',
    {
      session_id: text('Questionnaire ID.'),
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        description: '1-3 questions.',
        items: {
          type: 'object',
          properties: {
            id: text('Question ID.'),
            type: text('Type.', ['multiple-choice', 'multiple-select', 'essay']),
            title: text('Category.'),
            prompt: text('Question text.'),
            options: {
              type: 'array',
              minItems: 2,
              maxItems: 10,
              description: 'Choices.',
              items: {
                type: 'object',
                properties: {
                  value: text('Choice value.'),
                  label: text('Choice title.'),
                  description: text('Choice help.'),
                  recommended: boolean('True for recommended option.')
                },
                required: ['value', 'label'],
                additionalProperties: false
              }
            },
            max_selections: integer('Max selections; omit for unlimited.')
          },
          required: ['id', 'type', 'title', 'prompt'],
          additionalProperties: false
        }
      }
    },
    ['session_id', 'questions']
  ),
  definition(
    'plan',
    'Publish the implementation plan. Call after inspecting and resolving decisions.',
    { markdown: text('Full plan in Markdown.') },
    ['markdown']
  ),
  definition(
    'write',
    'Create or fully replace a file.',
    {
      path: text('Relative path.'),
      content: text('Full file contents.'),
      mode: text('create fails if exists; overwrite replaces.', ['create', 'overwrite'])
    },
    ['path', 'content', 'mode']
  ),
  definition(
    'edit',
    'Replace one exact unique snippet.',
    {
      path: text('Relative path.'),
      oldText: text('Exact current text.'),
      newText: text('Replacement text.')
    },
    ['path', 'oldText', 'newText']
  ),
  definition(
    'delete_lines',
    'Delete one exact unique snippet.',
    {
      path: text('Relative path.'),
      oldText: text('Exact text to remove (unique with context).')
    },
    ['path', 'oldText']
  ),
  definition(
    'apply_patch',
    'Apply a contextual multi-file patch.',
    { patch: text('Patch wrapped in *** Begin/End Patch.') },
    ['patch']
  ),
  definition(
    'exec_command',
    'Run a command in root. Short cmds return output; long ones return a Run ID and auto-notify. Do not poll.',
    {
      cmd: text('Command.'),
      yieldTimeMs: integer('Wait ms before backgrounding.')
    },
    ['cmd']
  ),
  definition(
    'write_stdin',
    'Send text/keys to a running command.',
    {
      runId: text('Terminal Run ID.'),
      input: text('Stdin text.'),
      keys: { type: 'array', description: 'Optional keys.', items: text('Key.') },
      pressEnter: boolean('Press Enter. Default true.')
    },
    ['runId']
  ),
  definition(
    'read_terminal_output',
    'Read output so far for a Run ID. Live services/debugging only. Never poll.',
    { runId: text('Terminal Run ID.') },
    ['runId']
  ),
  definition(
    'web_search',
    'Quick web search; auto-reads pages. 2-4 sources typical, max 10.',
    {
      query: text('Search query.'),
      resultCount: integer('Sources (1-10).', 1, 10)
    },
    ['query', 'resultCount']
  ),
  definition(
    'read_page',
    'Read and extract the full content of a web page URL directly. ALWAYS use this tool whenever you need to read, inspect, check, or analyze an external link or web page without opening a browser.',
    {
      url: text('The HTTP(S) URL of the web page to read.'),
      maxCharacters: integer('Maximum characters to return (default 50,000, max 100,000).', 1000, 100000)
    },
    ['url']
  ),
  definition(
    'send_message_to_chat',
    'Send a message, status update, or task to another chat or to the supervising agent. Non-blocking.',
    {
      target: text('Destination agent: "chat" or "harness".', ['chat', 'harness']),
      message: text('Message or task content.'),
      path: text('Optional project path (mandatory if target is "harness").'),
      harness_mode: text('Optional harness mode ("plan" or "build").', ['plan', 'build']),
      target_chat_id: text('Optional target chat ID. If omitted, opens a new background chat.')
    },
    ['target', 'message']
  ),
  definition(
    'answer_subagent_question',
    'Submit decisions and answers to a clarifying questionnaire raised by a delegated sub-agent. Unblocks the sub-agent so it can continue running.',
    {
      session_id: text('The questionnaire session ID.'),
      answers: {
        type: 'object',
        description: 'Key-value map of question IDs to chosen answers.'
      }
    },
    ['session_id', 'answers']
  ),
  definition(
    'cancel_subagent_task',
    'Abort and cancel an active sub-agent task that was delegated by this agent. Stops model execution, terminates any background terminal processes, and cleans up resources.',
    {
      target_chat_id: text('The chat ID of the sub-agent to cancel.'),
      reason: text('Optional reason for cancellation.')
    },
    ['target_chat_id']
  )
]

const LABELS: Record<HarnessToolName, string> = {
  read: 'Reading file',
  list: 'Listing directory',
  find: 'Finding files',
  grep: 'Searching code',
  to_ask: 'Asking a question',
  plan: 'Preparing implementation plan',
  write: 'Writing file',
  edit: 'Editing file',
  delete_lines: 'Deleting lines',
  apply_patch: 'Applying patch',
  exec_command: 'Running command',
  write_stdin: 'Sending terminal input',
  read_terminal_output: 'Reading terminal output',
  web_search: 'Searching the web',
  read_page: 'Reading web page',
  send_message_to_chat: 'Sending message to chat',
  answer_subagent_question: 'Answering sub-agent question',
  cancel_subagent_task: 'Cancelling sub-agent task'
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
    return requestQuestionnaire(args, context.signal, context.chatId)
  }
  if (name === 'plan') {
    const markdown = requiredString(args, 'markdown')
    return JSON.stringify({ published: true, markdown })
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
  if (name === 'read_page') {
    const url =
      typeof args.url === 'string' && args.url.trim()
        ? args.url.trim()
        : typeof args.link === 'string' && args.link.trim()
          ? args.link.trim()
          : ''
    if (!url) throw new Error('A valid HTTP(S) URL is required.')
    const maxCharacters =
      typeof args.maxCharacters === 'number' && args.maxCharacters > 0
        ? args.maxCharacters
        : (context.settings.maxReadCharacters || 50_000)
    return JSON.stringify(await readWebPage(url, { maxCharacters }, context.signal))
  }
  if (name === 'send_message_to_chat') {
    const result = await interChatManager.dispatchInterChatTask({
      senderChatId: context.chatId,
      target: args.target === 'harness' ? 'harness' : 'chat',
      message: requiredString(args, 'message'),
      path: typeof args.path === 'string' ? args.path : undefined,
      harness_mode: args.harness_mode === 'plan' ? 'plan' : 'build',
      target_chat_id: typeof args.target_chat_id === 'string' ? args.target_chat_id : undefined
    })
    if (!result.ok) {
      throw new Error(`Error delegating task: ${result.error || 'Failed to dispatch task.'}`)
    }
    return JSON.stringify(result, null, 2)
  }
  if (name === 'answer_subagent_question') {
    const result = interChatManager.answerSubAgentQuestion(
      requiredString(args, 'session_id'),
      context.chatId,
      (args.answers as Record<string, any>) || {}
    )
    if (!result.ok) {
      throw new Error(`Error answering sub-agent question: ${result.error || 'Failed to submit responses.'}`)
    }
    return JSON.stringify(result, null, 2)
  }
  if (name === 'cancel_subagent_task') {
    const result = interChatManager.cancelSubAgentTask(
      requiredString(args, 'target_chat_id'),
      context.chatId,
      typeof args.reason === 'string' ? args.reason : undefined
    )
    if (!result.ok) {
      throw new Error(`Error cancelling sub-agent task: ${result.error || 'Failed to cancel task.'}`)
    }
    return JSON.stringify(result, null, 2)
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
