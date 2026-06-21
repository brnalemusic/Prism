import { GoogleGenAI, Content, ThinkingLevel } from '@google/genai'
import * as dotenv from 'dotenv'
import { IpcMainEvent, ipcMain, BrowserWindow } from 'electron'
import * as path from 'path'
import { Agent, setGlobalDispatcher, fetch as undiciFetch } from 'undici'
import {
  getSystemToolsPrompt,
  getSubagentSystemPrompt,
  runTerminalCommand,
  listApplications,
  openApplication,
  openBrowserLink,
  webSearch,
  webSearchContinuous,
  sawLinkFromUrl,
  computerCreateFile,
  computerCreateDirectory,
  computerRemoveFile,
  computerRemoveDirectory,
  computerSaveFile,
  computerAppendToFile,
  computerEditFile,
  computerCopyFile,
  computerMoveFile,
  computerGetFileInfo,
  computerListDirectory,
  computerReadFile,
  captureAppScreenshot,
  openBrowser,
  browserNavigate,
  browserSnapshot,
  browserClick,
  browserType,
  browserPress,
  browserScroll,
  browserBack,
  browserScreenshot,
  closePersistentBrowser,
  webScript,
  detailedDomPage
} from './systemTools'
import type { WebSearchEntry } from './systemTools'
import {
  saveChatSession,
  loadChatSession,
  searchChatHistory,
  searchChatMemory,
  getMessageText
} from './history'
import { loadConfig, saveConfig } from './config'
import { toolsManifest } from './toolsManifest'

// Load environment variables from .env
dotenv.config({ path: path.join(__dirname, '../../.env') })

// Keep-Alive configuration for better latency (3.5 minutes)
const networkAgent = new Agent({
  keepAliveTimeout: 210000,
  keepAliveMaxTimeout: 210000
})
setGlobalDispatcher(networkAgent)
globalThis.fetch = undiciFetch as unknown as typeof globalThis.fetch

// Modelo selecionado atualmente
let currentModelKey = 'prism-6-super-fast'

interface ModelConfig {
  apiModel: string
  thinkingConfig?: {
    thinkingBudget?: number
    thinkingLevel?: ThinkingLevel
    includeThoughts?: boolean
  }
}

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'prism-4': {
    apiModel: 'gemini-3.1-flash-lite',
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: true }
  },
  'prism-4.1': {
    apiModel: 'gemini-3-flash-preview',
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: true }
  },
  'prism-4.2': {
    apiModel: 'gemma-4-26b-a4b-it',
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: true }
  },
  'prism-4.3': {
    apiModel: 'gemma-4-31b-it',
    thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH, includeThoughts: true }
  },
  'prism-5': {
    apiModel: 'gemini-3.5-flash',
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: true }
  },
  'prism-6-super-fast': {
    apiModel: 'gemini-3.1-flash-lite',
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: true }
  },
  'prism-6-fast-old': {
    apiModel: 'gemini-3-flash-preview',
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: true }
  },
  'prism-6-fast': {
    apiModel: 'gemini-3.5-flash',
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: true }
  },
  'prism-6-dragon': {
    apiModel: 'gemma-4-26b-a4b-it',
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: true }
  },
  'prism-6-dense': {
    apiModel: 'gemma-4-31b-it',
    thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH, includeThoughts: true }
  }
}

// Fallback order of models (from highest to lowest)
const MODEL_FALLBACK_ORDER = [
  'prism-6-dense',
  'prism-6-dragon',
  'prism-6-fast',
  'prism-6-fast-old',
  'prism-6-super-fast'
]

const AGENT_TEMPERATURE = 0.7
const TITLE_GENERATION_TEMPERATURE = 1.4
const DEFAULT_SUBAGENT_MODEL_KEY = 'prism-6-dragon'
let currentSubagentModelKey = DEFAULT_SUBAGENT_MODEL_KEY

function getSubagentModelConfig(modelKey = currentSubagentModelKey): ModelConfig {
  const config = MODEL_CONFIGS[modelKey] || MODEL_CONFIGS[DEFAULT_SUBAGENT_MODEL_KEY]
  return {
    apiModel: config.apiModel,
    thinkingConfig: {
      ...config.thinkingConfig,
      thinkingLevel: ThinkingLevel.HIGH,
      includeThoughts: false
    }
  }
}

/**
 * Returns the friendly name of the model based on the key.
 */
function getModelFriendlyName(modelKey: string): string {
  const names: Record<string, string> = {
    'prism-4': 'Prism 4',
    'prism-4.1': 'Prism 4.1',
    'prism-4.2': 'Prism 4.2',
    'prism-4.3': 'Prism 4.3',
    'prism-5': 'Prism 5',
    'prism-6-super-fast': 'Prism 6 Super-Fast',
    'prism-6-fast-old': 'Prism 6 Fast-Old',
    'prism-6-fast': 'Prism 6 Fast',
    'prism-6-dragon': 'Prism 6 Dragon',
    'prism-6-dense': 'Prism 6 Dense'
  }
  return names[modelKey] || 'Prism AI'
}

// Persistent history in memory for the current session
let chatHistory: Content[] = []
let launcherChatHistory: Content[] = []
export let launcherAbortController: AbortController | null = null
let currentSessionId: string = Date.now().toString()

export interface ActiveRun {
  chatId: string
  chatHistory: Content[]
  abortController: AbortController
  modelKey: string
}

export const activeRuns = new Map<string, ActiveRun>()
export const lastScreenshots = new Map<string, string>()

export interface StructuredChatResponse {
  thoughts: string
  finalResponse: string
  rawText: string
  usedFallback: boolean
  isThinking?: boolean
  isWritingToolCall?: boolean
  toolType?: 'task' | 'search'
}

interface ToolArgs extends Record<string, any> {
  command?: string
  appPath?: string
  url?: string
  query?: string
  path?: string
  content?: string
  oldText?: string
  newText?: string
  sourcePath?: string
  destinationPath?: string
  overwrite?: string
  quantity?: string
  launcherShortcut?: string
  modelSelectionShortcut?: string
  screenshotShortcut?: string
  appName?: string
  defaultModel?: string
  subagentModel?: string
  minimizeToTray?: string
  autoLaunch?: string
  quickLauncherMode?: string
  userGeminiKey?: string
  username?: string
  instructions?: string
  model?: string
  thinkMode?: string
  searchEnabled?: string
  ttsVoice?: string
  terminalShell?: string
  zoomFactor?: string
  // Continuous web_search: array of { title, query } kept as a structured value
  // (not stringified) so the backend can iterate and the UI can render titles.
  searches?: WebSearchEntry[]
}

const RAW_TOOL_ARG_TAGS = new Set(['command', 'content', 'oldText', 'newText'])

// Argument keys whose values must be preserved as structured JS objects/arrays
// rather than stringified. Currently used by the continuous web_search tool to
// keep the `searches` array intact through parse/validate.
const OBJECT_TOOL_ARG_TAGS = new Set(['searches'])

function parseToolCall(toolContent: string): { name: string | null; args: ToolArgs } {
  let trimmed = toolContent.trim()

  // Strip markdown code blocks if present
  if (trimmed.startsWith('```')) {
    trimmed = trimmed
      .replace(/^```[a-z]*\n/i, '')
      .replace(/\n```$/i, '')
      .trim()
  }

  // JSON format detection
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed)
      const name = (obj.type || obj.name || null) as string | null
      const args: ToolArgs = {}
      for (const [key, value] of Object.entries(obj)) {
        if (key !== 'type' && key !== 'name') {
          // Preserve structured values (arrays/objects) for tagged keys so they
          // survive parse/validate without being stringified.
          if (OBJECT_TOOL_ARG_TAGS.has(key) && typeof value === 'object' && value !== null) {
            args[key] = value as unknown as string
            continue
          }
          let val = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
          if (!RAW_TOOL_ARG_TAGS.has(key)) {
            val = val.trim()
          }
          args[key] = val
        }
      }
      return { name, args }
    } catch (e) {
      console.warn('Tool call looks like JSON but failed to parse.', e)
    }
  }

  return { name: null, args: {} }
}

interface ValidationResult {
  isMalformed: boolean
  errorType:
    | 'json_syntax_error'
    | 'missing_type'
    | 'invalid_tool'
    | 'missing_args'
    | 'invalid_args'
    | 'xml_error'
    | 'none'
  errorMessage: string
  name: string | null
  args: ToolArgs
}

function getLevenshteinDistance(a: string, b: string): number {
  const tmp: number[][] = []
  for (let i = 0; i <= a.length; i++) {
    tmp[i] = [i]
  }
  for (let j = 0; j <= b.length; j++) {
    tmp[0][j] = j
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1, // deletion
        tmp[i][j - 1] + 1, // insertion
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      )
    }
  }
  return tmp[a.length][b.length]
}

function findClosestTool(name: string): string {
  const tools = Object.keys(toolFunctions)
  if (tools.length === 0) return ''
  let closest = ''
  let minDistance = Infinity
  for (const tool of tools) {
    const dist = getLevenshteinDistance(name.toLowerCase(), tool.toLowerCase())
    if (dist < minDistance) {
      minDistance = dist
      closest = tool
    }
  }
  return closest
}

function validateSchemaArgs(
  toolName: string,
  args: ToolArgs
): { type: 'missing_args' | 'invalid_args'; message: string } | null {
  const schema = toolsManifest.find((t) => t.name === toolName)
  if (!schema) return null

  const expectedParams = schema.parameters || {}
  const passedParams = Object.keys(args)

  // 1. Check for missing required arguments
  const missingArgs: string[] = []
  for (const [paramName, paramDesc] of Object.entries(expectedParams)) {
    if (paramName.includes(':')) continue

    const isOptional = paramDesc.toLowerCase().includes('optional')
    const isRequired = !isOptional

    if (
      isRequired &&
      (args[paramName] === undefined || args[paramName] === null || args[paramName] === '')
    ) {
      missingArgs.push(paramName)
    }
  }

  // Special validation for run_subagents quantity and prompts
  if (toolName === 'run_subagents') {
    const quantityVal = parseInt(args.quantity || '0', 10)
    if (isNaN(quantityVal) || quantityVal <= 0) {
      return {
        type: 'invalid_args',
        message: `Argument "quantity" for "run_subagents" must be a positive integer. Passed: "${args.quantity}".`
      }
    }
    const missingPrompts: string[] = []
    for (let i = 1; i <= quantityVal; i++) {
      const key = `prompt:${i}`
      if (!args[key] || args[key].trim() === '') {
        missingPrompts.push(key)
      }
    }
    if (missingPrompts.length > 0) {
      return {
        type: 'missing_args',
        message: `Tool "run_subagents" is missing required arguments for quantity=${quantityVal}: ${missingPrompts.join(', ')}.`
      }
    }
  }

  // Special validation for configure_prism: make sure at least one parameter is passed
  if (toolName === 'configure_prism') {
    const hasAtLeastOneArg = passedParams.some(
      (key) => key !== 'rawContent' && key !== 'originalName' && expectedParams[key] !== undefined
    )
    if (!hasAtLeastOneArg) {
      return {
        type: 'missing_args',
        message: `Tool "configure_prism" requires at least one setting to configure. Valid parameters are: ${Object.keys(expectedParams).join(', ')}`
      }
    }
  }

  if (missingArgs.length > 0) {
    return {
      type: 'missing_args',
      message: `Missing required argument(s) for tool "${toolName}": ${missingArgs.map((a) => `"${a}"`).join(', ')}.\nExpected parameters:\n${JSON.stringify(expectedParams, null, 2)}`
    }
  }

  // 2. Check for unknown arguments
  const unknownArgs: string[] = []
  for (const passedKey of passedParams) {
    if (passedKey === 'rawContent' || passedKey === 'originalName') continue

    let isExpected = expectedParams[passedKey] !== undefined

    if (!isExpected && toolName === 'run_subagents' && passedKey.startsWith('prompt:')) {
      const parts = passedKey.split(':')
      const num = parseInt(parts[1], 10)
      if (!isNaN(num) && num > 0) {
        isExpected = true
      }
    }

    if (!isExpected) {
      unknownArgs.push(passedKey)
    }
  }

  if (unknownArgs.length > 0) {
    return {
      type: 'invalid_args',
      message: `Unknown argument(s) passed to tool "${toolName}": ${unknownArgs.map((a) => `"${a}"`).join(', ')}.\nValid parameters are: ${Object.keys(expectedParams).join(', ')}`
    }
  }

  // 3. Type/format validation
  for (const [key, value] of Object.entries(args)) {
    if (key === 'rawContent' || key === 'originalName') continue
    // Structured object/array args (e.g. web_search "searches") skip string
    // type/format checks; they are validated by their own branch below.
    if (OBJECT_TOOL_ARG_TAGS.has(key)) continue
    const desc = expectedParams[key] ? expectedParams[key].toLowerCase() : ''

    // Boolean checks
    const expectsBool =
      desc.includes('true/false') ||
      desc.includes('true|false') ||
      desc.includes('optional true|false')
    if (expectsBool) {
      if (value !== 'true' && value !== 'false') {
        return {
          type: 'invalid_args',
          message: `Argument "${key}" for tool "${toolName}" must be a string value of either "true" or "false". Passed: "${value}".`
        }
      }
    }

    // Number checks
    const expectsNumber =
      desc.includes('number') ||
      desc.includes('integer') ||
      desc.includes('max time') ||
      desc.includes('max messages') ||
      desc.includes('starting line number') ||
      desc.includes('ending line number')
    if (expectsNumber) {
      const num = Number(value)
      if (isNaN(num)) {
        return {
          type: 'invalid_args',
          message: `Argument "${key}" for tool "${toolName}" must be a valid number representation. Passed: "${value}".`
        }
      }
    }
  }

  // 4. Continuous web_search "searches" validation
  if (toolName === 'web_search' && args.searches !== undefined) {
    const raw = args.searches as unknown
    if (!Array.isArray(raw) || raw.length === 0) {
      return {
        type: 'invalid_args',
        message:
          'Argument "searches" for tool "web_search" must be a non-empty array of objects, each with "title" and "query" strings.'
      }
    }
    for (let i = 0; i < raw.length; i++) {
      const entry = raw[i] as { title?: unknown; query?: unknown }
      if (
        typeof entry !== 'object' ||
        entry === null ||
        typeof entry.title !== 'string' ||
        typeof entry.query !== 'string' ||
        entry.query.trim() === ''
      ) {
        return {
          type: 'invalid_args',
          message: `Each item in "searches" (index ${i}) must be an object with non-empty string "title" and "query".`
        }
      }
    }
  }

  return null
}

function validateToolCall(toolContent: string): ValidationResult {
  let trimmed = toolContent.trim()

  // Strip markdown code blocks if present
  if (trimmed.startsWith('```')) {
    trimmed = trimmed
      .replace(/^```[a-z]*\n/i, '')
      .replace(/\n```$/i, '')
      .trim()
  }

  // Check if they tried to use XML or a non-JSON format
  if (!trimmed.startsWith('{')) {
    let errorMsg =
      'Every tool call MUST be a valid JSON object. XML and other non-JSON formats are not supported. ' +
      'Please rewrite your tool call as a valid JSON object inside the <tool_call>...</tool_call> tags.'

    if (trimmed.startsWith('<') && (trimmed.includes('</') || trimmed.includes('>'))) {
      errorMsg =
        'XML tool call format is deprecated and not supported. All tool calls MUST strictly be valid JSON objects inside the <tool_call>...</tool_call> tags (e.g., {"type": "web_search", "query": "..."}). Please rewrite it.'
    }

    return {
      isMalformed: true,
      errorType: 'json_syntax_error',
      errorMessage: errorMsg,
      name: null,
      args: { rawContent: toolContent }
    }
  }

  // Must be JSON
  try {
    const obj = JSON.parse(trimmed)
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      return {
        isMalformed: true,
        errorType: 'json_syntax_error',
        errorMessage: 'Every tool call must be a valid JSON object. Parsed JSON was not an object.',
        name: null,
        args: { rawContent: toolContent }
      }
    }

    const name = (obj.type || obj.name || null) as string | null
    if (!name) {
      return {
        isMalformed: true,
        errorType: 'missing_type',
        errorMessage:
          'The tool call is missing the "type" property. Every tool call must start with a "type" property specifying the exact name of the tool (e.g., {"type": "web_search", ...}).',
        name: null,
        args: { rawContent: toolContent }
      }
    }

    if (!toolFunctions[name]) {
      const suggestion = findClosestTool(name)
      return {
        isMalformed: true,
        errorType: 'invalid_tool',
        errorMessage: `The tool name "${name}" is not recognized. Did you mean "${suggestion}"? Available tools are: ${Object.keys(toolFunctions).join(', ')}.`,
        name: name,
        args: { rawContent: toolContent, originalName: name }
      }
    }

    const args: ToolArgs = {}
    for (const [key, value] of Object.entries(obj)) {
      if (key !== 'type' && key !== 'name') {
        // Preserve structured values (arrays/objects) for tagged keys.
        if (OBJECT_TOOL_ARG_TAGS.has(key) && typeof value === 'object' && value !== null) {
          args[key] = value as unknown as string
          continue
        }
        let val = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        if (!RAW_TOOL_ARG_TAGS.has(key)) {
          val = val.trim()
        }
        args[key] = val
      }
    }

    const schemaError = validateSchemaArgs(name, args)
    if (schemaError) {
      return {
        isMalformed: true,
        errorType: schemaError.type,
        errorMessage: schemaError.message,
        name: name,
        args: { rawContent: toolContent, originalName: name }
      }
    }

    return {
      isMalformed: false,
      errorType: 'none',
      errorMessage: '',
      name,
      args
    }
  } catch (err: any) {
    const detail = err.message || ''
    let customExplanation = ''

    if (trimmed.includes("'")) {
      customExplanation +=
        ' Note: JSON keys and string values MUST use double quotes ("), not single quotes (\').'
    }
    if (/,\s*([}\]])/.test(trimmed)) {
      customExplanation +=
        ' Note: Trailing commas before a closing brace } or bracket ] are not allowed in JSON.'
    }
    if (trimmed.includes('“') || trimmed.includes('”')) {
      customExplanation +=
        ' Note: Smart/curly quotes (“ or ”) are invalid. Use standard straight double quotes (").'
    }
    if (trimmed.includes('\n') && !/\\n/.test(trimmed)) {
      customExplanation +=
        ' Note: Raw newlines inside JSON string values are not allowed; use escaped newlines (\\n) instead.'
    }

    const explanation = `JSON Syntax Error: ${detail}.${customExplanation}\nMake sure your tool call is a valid JSON object.`

    return {
      isMalformed: true,
      errorType: 'json_syntax_error',
      errorMessage: explanation,
      name: null,
      args: { rawContent: toolContent }
    }
  }
}

function extractToolCalls(text: string): string[] {
  const toolCalls: string[] = []
  let currentIndex = 0

  while (true) {
    const startIdx = text.indexOf('<tool_call>', currentIndex)
    if (startIdx === -1) break

    const contentStart = startIdx + 11 // '<tool_call>'.length
    let endIdx = -1
    let searchIndex = contentStart

    while (true) {
      const nextCdata = text.indexOf('<![CDATA[', searchIndex)
      const nextEnd = text.indexOf('</tool_call>', searchIndex)

      if (nextEnd === -1) break

      if (nextCdata !== -1 && nextCdata < nextEnd) {
        const cdataEnd = text.indexOf(']]>', nextCdata + 9)
        searchIndex = cdataEnd !== -1 ? cdataEnd + 3 : nextCdata + 9
      } else {
        endIdx = nextEnd
        break
      }
    }

    if (endIdx !== -1) {
      toolCalls.push(text.substring(contentStart, endIdx))
      currentIndex = endIdx + 12 // '</tool_call>'.length
    } else {
      currentIndex = startIdx + 11
    }
  }

  return toolCalls
}

function removeToolCalls(text: string): string {
  let result = text
  let currentIndex = 0
  while (true) {
    const startIdx = result.indexOf('<tool_call>', currentIndex)
    if (startIdx === -1) break

    let searchIndex = startIdx + 11
    let endIdx = -1
    while (true) {
      const nextCdata = result.indexOf('<![CDATA[', searchIndex)
      const nextEnd = result.indexOf('</tool_call>', searchIndex)

      if (nextEnd === -1) break

      if (nextCdata !== -1 && nextCdata < nextEnd) {
        const cdataEnd = result.indexOf(']]>', nextCdata + 9)
        searchIndex = cdataEnd !== -1 ? cdataEnd + 3 : nextCdata + 9
      } else {
        endIdx = nextEnd
        break
      }
    }

    if (endIdx !== -1) {
      result = result.substring(0, startIdx) + result.substring(endIdx + 12)
    } else {
      currentIndex = startIdx + 11
    }
  }
  return result
}

/**
 * Ensures the history fits within a reasonable token limit by removing older messages
 * and aggressively truncating large tool results.
 * Prioritizes keeping: System Prompt > Newer Messages > Older Messages.
 */
function ensureHistoryFitsLimit(history: Content[]): Content[] {
  // 10k characters requested for file reads, but for the WHOLE history
  // we'll use 40k as a safe buffer for context while being much more restrictive than before.
  const MAX_CHARS = 40000

  // 1. Preserve System Messages
  const systemMessages: Content[] = []
  let firstNonSystemIndex = 0
  while (
    firstNonSystemIndex < history.length &&
    (history[firstNonSystemIndex].role === 'system' ||
      (history[firstNonSystemIndex].parts?.[0]?.text?.startsWith('[SYSTEM') ?? false))
  ) {
    systemMessages.push(history[firstNonSystemIndex])
    firstNonSystemIndex++
  }

  const remainingHistory = history.slice(firstNonSystemIndex)

  // 2. Pre-process: Truncate individual tool results if they are huge
  const processedHistory = remainingHistory.map((msg) => {
    if (msg.role === 'user' || msg.role === 'system') {
      const parts = (msg.parts || []).map((part) => {
        if (part.text?.startsWith('[SYSTEM: TOOL RESULTS]')) {
          const MAX_TOOL_RESULT = 5000
          if (part.text.length > MAX_TOOL_RESULT) {
            return {
              ...part,
              text: part.text.substring(0, MAX_TOOL_RESULT) + '\n\n... [TOOL RESULTS TRUNCATED]'
            }
          }
        }
        return part
      })
      return { ...msg, parts }
    }
    return msg
  })

  // 3. Keep messages from NEWER to OLDER until limit reached
  const keptMessages: Content[] = []
  let currentTotal = 0

  // Calculate system message size
  for (const msg of systemMessages) {
    for (const part of msg.parts || []) {
      if (part.text) currentTotal += part.text.length
    }
  }

  // Iterate backwards (Newer -> Older)
  for (let i = processedHistory.length - 1; i >= 0; i--) {
    const msg = processedHistory[i]
    let msgSize = 0
    for (const part of msg.parts || []) {
      if (part.text) msgSize += part.text.length
    }

    if (currentTotal + msgSize < MAX_CHARS) {
      keptMessages.unshift(msg)
      currentTotal += msgSize
    } else {
      // If we can't fit even one more message, stop.
      // We keep the newest possible set.
      break
    }
  }

  return [...systemMessages, ...keptMessages]
}

function normalizeContentsForGemini(contents: Content[]): Content[] {
  const truncatedContents = ensureHistoryFitsLimit(contents)
  const normalized: Content[] = []

  for (const content of truncatedContents) {
    // Map 'system' role to 'user' for Gemini API compatibility if necessary,
    // or just keep it if the SDK handles it (Gemini SDK usually expects 'user'/'model')
    const apiRole = content.role === 'system' ? 'user' : content.role
    const parts = (content.parts || []).map((part) => ({ ...part }))
    const last = normalized[normalized.length - 1]

    if (last && last.role === apiRole) {
      if ((last.parts?.length || 0) > 0 && parts.length > 0) {
        last.parts = [...(last.parts || []), { text: '\n\n' }, ...parts]
      } else {
        last.parts = [...(last.parts || []), ...parts]
      }
    } else {
      normalized.push({ ...content, role: apiRole, parts })
    }
  }

  return normalized
}

function getFinalResponseText(response: {
  text?: string
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
}): string {
  const allParts = response.candidates?.flatMap((candidate) => candidate.content?.parts || []) || []
  const finalParts = allParts
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text || '')

  return allParts.length > 0 ? finalParts.join('') : response.text || ''
}

function getStreamingThinkingConfig(config: ModelConfig): ModelConfig['thinkingConfig'] {
  if (config.apiModel === 'gemma-4-31b-it' && config.thinkingConfig?.includeThoughts) {
    return { ...config.thinkingConfig, includeThoughts: false }
  }

  return config.thinkingConfig
}

function isRetryableGemmaStreamError(error: unknown): boolean {
  const status = (error as { status?: number })?.status
  return status === 500 || status === 503
}

async function collectFinalTextFromStream(
  stream: AsyncGenerator<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
  }>,
  signal?: AbortSignal
): Promise<string> {
  let finalText = ''

  for await (const chunk of stream) {
    if (signal?.aborted) throw new Error('AbortError')
    const parts = chunk.candidates?.[0]?.content?.parts || []
    for (const part of parts) {
      if (part.text && !part.thought) {
        finalText += part.text
      }
    }
  }

  return finalText
}

async function generateSubagentResponse(
  ai: GoogleGenAI,
  modelConfig: ModelConfig,
  history: Content[],
  signal?: AbortSignal
): Promise<string> {
  const contents = normalizeContentsForGemini(history)

  if (modelConfig.apiModel === 'gemma-4-31b-it') {
    try {
      const stream = await ai.models.generateContentStream({
        model: modelConfig.apiModel,
        contents,
        config: {
          temperature: AGENT_TEMPERATURE,
          thinkingConfig: modelConfig.thinkingConfig,
          abortSignal: signal
        }
      })
      return collectFinalTextFromStream(stream, signal)
    } catch (error) {
      if (!modelConfig.thinkingConfig?.includeThoughts || !isRetryableGemmaStreamError(error)) {
        throw error
      }

      const stream = await ai.models.generateContentStream({
        model: modelConfig.apiModel,
        contents,
        config: {
          temperature: AGENT_TEMPERATURE,
          thinkingConfig: { ...modelConfig.thinkingConfig, includeThoughts: false },
          abortSignal: signal
        }
      })
      return collectFinalTextFromStream(stream, signal)
    }
  }

  const result = await ai.models.generateContent({
    model: modelConfig.apiModel,
    contents,
    config: {
      temperature: AGENT_TEMPERATURE,
      thinkingConfig: modelConfig.thinkingConfig,
      abortSignal: signal
    }
  })
  return getFinalResponseText(result)
}

const activeQuestionnaireResolvers = new Map<string, (result: string) => void>()

ipcMain.on(
  'submit-questionnaire',
  (_event, data: { sessionId: string; responses: Record<string, string> }) => {
    const resolver = activeQuestionnaireResolvers.get(data.sessionId)
    if (resolver) {
      resolver(JSON.stringify({ session_id: data.sessionId, responses: data.responses }))
      activeQuestionnaireResolvers.delete(data.sessionId)
    }
  }
)

const toolFunctions: Record<
  string,
  (
    args: ToolArgs,
    event: IpcMainEvent,
    apiKey: string,
    signal?: AbortSignal,
    chatId?: string
  ) => Promise<string>
> = {
  execute_terminal_command: (args, _event, apiKey, signal) =>
    runTerminalCommand(args.command || '', apiKey, signal),
  list_installed_applications: () => listApplications(),
  open_application: (args) => openApplication(args.appPath || ''),
  open_browser_link: (args) => openBrowserLink(args.url || ''),
  open_browser: (args) => openBrowser(args.url),
  browser_navigate: (args) => browserNavigate(args.url || ''),
  browser_snapshot: (args) => browserSnapshot(args.full),
  browser_click: (args) => browserClick(args.elementId || ''),
  browser_type: (args) => browserType(args.elementId || '', args.text || ''),
  browser_press: (args) => browserPress(args.key || ''),
  browser_scroll: (args) => browserScroll(args.direction as 'up' | 'down', args.amount),
  browser_back: () => browserBack(),
  browser_screenshot: async (_args, _event, _apiKey, _signal, chatId) => {
    const res = await browserScreenshot()
    if (res.base64) {
      if (chatId) {
        lastScreenshots.set(chatId, res.base64)
      } else {
        lastScreenshots.set('launcher', res.base64)
      }
    }
    return res.result
  },
  browser_close: () => closePersistentBrowser(),
  web_script: (args) => webScript(args.url || '', args.script || ''),
  detailed_dom_page: (args) => detailedDomPage(args.url),
  web_search: (args, event, _apiKey, signal, chatId) => {
    if (args.searches && Array.isArray(args.searches)) {
      return webSearchContinuous(args.searches as any, {
        signal,
        onProgress: (title) => {
          if (chatId) {
            event.sender.send('chat-tool-update', {
              toolCallName: 'web_search',
              update: { searchTitle: title },
              chatId
            })
          }
        }
      })
    }
    return webSearch(args.query || '', signal)
  },
  saw_link_from_url: (args, _event, _apiKey, signal) => sawLinkFromUrl(args.url || '', signal),
  computer_use_create_file: (args, _event, _apiKey, signal) =>
    computerCreateFile(args.path || '', args.content || '', signal),
  computer_use_create_directory: (args, _event, _apiKey, signal) =>
    computerCreateDirectory(args.path || '', signal),
  computer_use_remove_file: (args, _event, _apiKey, signal) =>
    computerRemoveFile(args.path || '', signal),
  computer_use_remove_directory: (args, _event, _apiKey, signal) =>
    computerRemoveDirectory(args.path || '', signal),
  computer_use_save_file: (args, _event, _apiKey, signal) =>
    computerSaveFile(args.path || '', args.content || '', signal),
  computer_use_append_file: (args, _event, _apiKey, signal) =>
    computerAppendToFile(args.path || '', args.content || '', signal),
  computer_use_edit_file: (args, _event, _apiKey, signal) =>
    computerEditFile(
      args.path || '',
      args.startLine || '',
      args.endLine || '',
      args.newContent || '',
      signal
    ),
  computer_use_copy_file: (args, _event, _apiKey, signal) =>
    computerCopyFile(args.sourcePath || '', args.destinationPath || '', args.overwrite, signal),
  computer_use_move_file: (args, _event, _apiKey, signal) =>
    computerMoveFile(args.sourcePath || '', args.destinationPath || '', args.overwrite, signal),
  computer_use_get_file_info: (args, _event, _apiKey, signal) =>
    computerGetFileInfo(args.path || '', signal),
  computer_use_list_directory: (args, _event, _apiKey, signal) =>
    computerListDirectory(args.path || '', signal),
  computer_use_read_file: (args, _event, _apiKey, signal) =>
    computerReadFile(args.path || '', signal),
  computer_use_see_screen: async (args, _event, _apiKey, _signal, chatId) => {
    const appName = args.appName || 'Entire Screen'
    const capture = await captureAppScreenshot(appName)
    if (capture.base64) {
      lastScreenshots.set(chatId || 'launcher', capture.base64)
    }
    return capture.result
  },
  run_subagents: (args, event, apiKey, signal, chatId) =>
    runSubagents(args, event, apiKey, signal, chatId),
  search_chat_history: (args) => searchChatHistory(args.query || ''),
  search_chat_memory: (args) => searchChatMemory(args.query || ''),
  render_chat_history: async (args) => {
    const query = args.query || ''
    const cleanId = query.replace('chat_', '').replace('.json', '').trim()
    const session = loadChatSession(cleanId)
    if (session) {
      return `Successfully rendered chat history item in UI. Title: "${session.title}", Messages: ${session.messages.length}`
    }
    return `Error: Chat history session "${cleanId}" not found.`
  },
  not_found_chat_history: async () => {
    return 'Successfully registered that no matching chat history was found.'
  },
  open_main_app: async (args) => {
    // BrowserWindow imported above
    const instructions = args.instructions || ''
    const model = args.model || 'prism-5'
    const thinkMode = String(args.thinkMode).trim().toLowerCase() === 'true'
    const searchEnabled = String(args.searchEnabled).trim().toLowerCase() === 'true'

    // Find and hide launcher
    const launcherWin = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().includes('#launcher')
    )
    if (launcherWin) {
      launcherWin.hide()
    }

    // Find and focus main window
    const mainWin = BrowserWindow.getAllWindows().find((win) => {
      const url = win.webContents.getURL()
      return (
        !url.includes('#launcher') &&
        !url.includes('#subagents') &&
        !url.includes('#subagent-settings') &&
        !url.includes('#mini-app')
      )
    })

    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.show()
      mainWin.focus()
      mainWin.webContents.send('open-main-app-with-instructions', {
        instructions,
        model,
        thinkMode,
        searchEnabled
      })
    }

    return 'Main app opened successfully with instructions.'
  },
  // Group Chat tools (handled internally within runSubagents)
  send_group_message: async () => 'Error: send_group_message can only be used by sub-agents.',
  read_group_messages: async () => 'Error: read_group_messages can only be used by sub-agents.',
  wait_for_updates: async () => 'Error: wait_for_updates can only be used by sub-agents.',
  agent_message: async () => 'Error: agent_message is deprecated. Use send_group_message.',
  agent_wait: async () => 'Error: agent_wait is deprecated. Use wait_for_updates.',
  configure_prism: async (args) => {
    try {
      // ipcMain imported above
      const config = loadConfig()
      const changed: string[] = []

      if (args.launcherShortcut !== undefined && args.launcherShortcut !== '') {
        config.launcherShortcut = args.launcherShortcut
        changed.push(`launcherShortcut: "${args.launcherShortcut}"`)
      }
      if (args.screenshotShortcut !== undefined && args.screenshotShortcut !== '') {
        config.screenshotShortcut = args.screenshotShortcut
        changed.push(`screenshotShortcut: "${args.screenshotShortcut}"`)
      }
      if (args.modelSelectionShortcut !== undefined && args.modelSelectionShortcut !== '') {
        config.modelSelectionShortcut = args.modelSelectionShortcut
        changed.push(`modelSelectionShortcut: "${args.modelSelectionShortcut}"`)
      }
      if (args.defaultModel !== undefined && args.defaultModel !== '') {
        config.defaultModel = args.defaultModel
        setGeminiModel(args.defaultModel)
        changed.push(`defaultModel: "${args.defaultModel}"`)
      }
      if (args.subagentModel !== undefined && args.subagentModel !== '') {
        config.subagentModel = args.subagentModel
        setSubagentModel(args.subagentModel)
        changed.push(`subagentModel: "${args.subagentModel}"`)
      }
      if (args.minimizeToTray !== undefined && args.minimizeToTray !== '') {
        config.minimizeToTray = /^(true|1|yes|y)$/i.test(args.minimizeToTray.trim())
        changed.push(`minimizeToTray: ${config.minimizeToTray}`)
      }
      if (args.autoLaunch !== undefined && args.autoLaunch !== '') {
        config.autoLaunch = /^(true|1|yes|y)$/i.test(args.autoLaunch.trim())
        changed.push(`autoLaunch: ${config.autoLaunch}`)
      }
      if (args.quickLauncherMode !== undefined && args.quickLauncherMode !== '') {
        if (args.quickLauncherMode === 'simple' || args.quickLauncherMode === 'advanced') {
          config.quickLauncherMode = args.quickLauncherMode
          changed.push(`quickLauncherMode: "${args.quickLauncherMode}"`)
        }
      }
      if (args.userGeminiKey !== undefined && args.userGeminiKey !== '') {
        config.userGeminiKey = args.userGeminiKey
        setUserApiKey(args.userGeminiKey)
        changed.push('userGeminiKey: "[UPDATED]"')
      }
      if (args.username !== undefined && args.username !== '') {
        config.username = args.username
        changed.push(`username: "${args.username}"`)
      }
      if (args.ttsVoice !== undefined && args.ttsVoice !== '') {
        config.ttsVoice = args.ttsVoice
        changed.push(`ttsVoice: "${args.ttsVoice}"`)
      }
      if (args.theme !== undefined && args.theme !== '') {
        const allowedThemes = ['marine', 'vertez', 'akoustik', 'terno', 'ursula']
        if (allowedThemes.includes(args.theme)) {
          config.theme = args.theme as any
          changed.push(`theme: "${args.theme}"`)
        }
      }
      if (args.terminalShell !== undefined && args.terminalShell !== '') {
        const shell = args.terminalShell.trim()
        if (!shell || /[\r\n;&|]/.test(shell)) {
          return `Error: terminalShell contains invalid characters. Passed: "${args.terminalShell}"`
        }
        config.terminalShell = shell
        changed.push(`terminalShell: "${shell}"`)
      }
      if (args.zoomFactor !== undefined && args.zoomFactor !== '') {
        const val = parseFloat(args.zoomFactor)
        if (!isNaN(val) && val >= 0.5 && val <= 3.0) {
          config.zoomFactor = val
          changed.push(`zoomFactor: ${val}`)
        } else {
          return `Error: zoomFactor must be a number between 0.5 and 3.0. Passed: "${args.zoomFactor}"`
        }
      }

      if (changed.length === 0) {
        return 'No settings provided to configure.'
      }

      const success = saveConfig(config)
      if (success) {
        // Emit to main process so it updates currentConfig and shortcut registration
        ipcMain.emit('update-config-from-tools', null, config)
        return `Successfully configured Prism settings:\n${changed.map((c) => `- ${c}`).join('\n')}`
      } else {
        return 'Error: Failed to save the updated settings.'
      }
    } catch (error) {
      return `Error configuring Prism settings: ${error instanceof Error ? error.message : String(error)}`
    }
  },
  internal_docs_list: async () => {
    try {
      const { app } = require('electron')
      const isDev = !app.isPackaged
      const docsPath = isDev ? path.join(__dirname, '../../resources/docs') : path.join(process.resourcesPath, 'docs')
      
      try {
        const files = await require('fs/promises').readdir(docsPath)
        const mdFiles = files.filter((f: string) => f.endsWith('.md'))
        if (mdFiles.length === 0) return 'No internal documentation found.'
        return `Available internal documentation files:\n${mdFiles.map((f: string) => `- ${f}`).join('\n')}`
      } catch (e: any) {
        if (e.code === 'ENOENT') return 'Documentation directory not found.'
        throw e
      }
    } catch (error) {
      return `Error listing docs: ${error instanceof Error ? error.message : String(error)}`
    }
  },
  internal_docs_read: async (args) => {
    try {
      const { app } = require('electron')
      const isDev = !app.isPackaged
      const docsPath = isDev ? path.join(__dirname, '../../resources/docs') : path.join(process.resourcesPath, 'docs')
      
      const filename = args.filename
      if (!filename || !filename.endsWith('.md')) {
         return 'Error: Invalid filename. Must be a .md file from the internal_docs_list.'
      }
      
      const filePath = path.join(docsPath, path.basename(filename))
      try {
        const content = await require('fs/promises').readFile(filePath, 'utf-8')
        return content
      } catch (e: any) {
        if (e.code === 'ENOENT') return `Error: Documentation file "${filename}" not found.`
        throw e
      }
    } catch (error) {
      return `Error reading doc: ${error instanceof Error ? error.message : String(error)}`
    }
  },
  to_ask: (args, _event, _apiKey, signal) => {
    return new Promise<string>((resolve, reject) => {
      const sessionId =
        args.session_id || `session-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`

      const onAbort = () => {
        activeQuestionnaireResolvers.delete(sessionId)
        reject(new Error('AbortError'))
      }

      if (signal) {
        if (signal.aborted) {
          return reject(new Error('AbortError'))
        }
        signal.addEventListener('abort', onAbort)
      }

      activeQuestionnaireResolvers.set(sessionId, (result) => {
        if (signal) {
          signal.removeEventListener('abort', onAbort)
        }
        resolve(result)
      })
    })
  }
}

interface GroupMessage {
  sender: number | string
  content: string
  timestamp: number
  status: 'working' | 'done' | 'error'
  readBy: (number | string)[]
}

interface SubagentChatLogEntry {
  agentIndex: number | string
  content: string
  status: 'working' | 'done' | 'error'
  timestamp: number
  senderRole?: 'user' | 'master' | 'agent'
  senderName?: string
  chatId?: string
}

const USER_AGENT_INDEX = -1
const HUMAN_USER_SENDER = 'user'

function isExternalSubagentMessage(data: unknown): data is SubagentChatLogEntry {
  if (typeof data !== 'object' || data === null) return false
  const candidate = data as Partial<SubagentChatLogEntry>
  return candidate.agentIndex === USER_AGENT_INDEX && typeof candidate.content === 'string'
}

function getGroupSenderName(sender: number | string): string {
  if (sender === HUMAN_USER_SENDER || sender === USER_AGENT_INDEX) return 'Master Coordinator'
  if (sender === 'master') return 'Master Coordinator'
  return `Agent #${sender}`
}

/**
 * Runs multiple sub-agents in parallel to perform specific tasks.
 */
async function runSubagents(
  args: ToolArgs,
  event: IpcMainEvent,
  apiKey: string,
  parentSignal?: AbortSignal,
  chatId?: string
): Promise<string> {
  const quantity = parseInt(args.quantity || '1')
  const prompts: string[] = []
  for (let i = 1; i <= 20; i++) {
    const p = args[`prompt:${i}`]
    if (p) prompts.push(p)
  }

  if (prompts.length === 0) return 'Error: No prompts provided for agents.'

  const subagentModelKey = currentSubagentModelKey
  const subagentModelConfig = getSubagentModelConfig(subagentModelKey)

  const blackboard: GroupMessage[] = []
  const waiters: (() => void)[] = []
  const subagentChatLog: SubagentChatLogEntry[] = []
  let swarmCompleted = false

  const notifyWaiters = (): void => {
    while (waiters.length > 0) {
      const resolve = waiters.shift()
      if (resolve) resolve()
    }
  }

  // Listener for external messages (from UI/User in subagent window)
  const externalMessageListener = (_event: IpcMainEvent, data: unknown): void => {
    if (isExternalSubagentMessage(data)) {
      const timestamp = typeof data.timestamp === 'number' ? data.timestamp : Date.now()
      const messageData: SubagentChatLogEntry = {
        agentIndex: USER_AGENT_INDEX,
        content: data.content,
        status: 'working',
        timestamp,
        senderRole: 'user',
        senderName: 'You',
        chatId
      }

      blackboard.push({
        sender: HUMAN_USER_SENDER,
        content: messageData.content,
        timestamp,
        status: 'working',
        readBy: []
      })
      subagentChatLog.push(messageData)
    }
    notifyWaiters()
  }
  ipcMain.on('subagent-message-broadcast', externalMessageListener)

  // Promises for Worker Subagents
  const agentPromises = prompts.slice(0, quantity).map(async (prompt, index) => {
    try {
      if (parentSignal?.aborted) throw new Error('AbortError')

      // Small delay to offset workers
      await new Promise((r) => setTimeout(r, 100 + index * 50))

      const ai = new GoogleGenAI({ apiKey })

      const subAgentSystemPrompt = getSubagentSystemPrompt(subagentModelKey, index, quantity)

      // Notify UI about agent check-in
      const checkInData: SubagentChatLogEntry = {
        agentIndex: index,
        content: 'Checking in. Joined Group Chat.',
        status: 'working',
        timestamp: Date.now()
      }
      if (parentSignal?.aborted) throw new Error('AbortError')
      ipcMain.emit('subagent-message-broadcast', null, checkInData)
      subagentChatLog.push(checkInData)

      const history: Content[] = [
        { role: 'user', parts: [{ text: subAgentSystemPrompt }] },
        {
          role: 'model',
          parts: [
            { text: `Agent #${index} checking in. Joined Group Chat. Awaiting initial task...` }
          ]
        },
        {
          role: 'user',
          parts: [
            {
              text: `[YOUR ASSIGNED TASK]: ${prompt}\n\nInitiate your work now. Remember that communication via send_group_message is absolutely mandatory.`
            }
          ]
        }
      ]

      let iteration = 0
      const MAX_AGENT_ITERATIONS = 15
      let finalOutput = ''
      let isAgentFinished = false
      let readCursor = 0

      while (iteration < MAX_AGENT_ITERATIONS && !isAgentFinished && !swarmCompleted) {
        iteration++

        if (parentSignal?.aborted) throw new Error('AbortError')

        // Context Injection: Check for unread messages
        const unreadMessages = blackboard.slice(readCursor).filter((m) => m.sender !== index)
        readCursor = blackboard.length

        if (unreadMessages.length > 0) {
          let teamUpdate = '[UNREAD MESSAGES]:\n'
          for (const msg of unreadMessages) {
            const senderName = getGroupSenderName(msg.sender)
            teamUpdate += `[FROM ${senderName} (${msg.status})]: "${msg.content}"\n`
          }
          history.push({ role: 'user', parts: [{ text: teamUpdate }] })
        }

        // Inject swarm status snapshot
        let activeAgentsList = `[SWARM STATUS SNAPSHOT]:\n- Master Coordinator: ${swarmCompleted ? 'done' : 'working'}\n`
        for (let idx = 0; idx < quantity; idx++) {
          const lastMsg = blackboard
            .slice()
            .reverse()
            .find((m) => m.sender === idx)
          const status = lastMsg ? lastMsg.status : 'inactive/joining'
          activeAgentsList += `- Agent #${idx}: ${status}\n`
        }
        history.push({ role: 'user', parts: [{ text: activeAgentsList }] })

        if (parentSignal?.aborted) throw new Error('AbortError')
        event.sender.send('chat-tool-update', {
          toolCallName: 'run_subagents',
          update: { agentIndex: index, phase: 'thinking' },
          chatId
        })

        const responseText = await generateSubagentResponse(
          ai,
          subagentModelConfig,
          history,
          parentSignal
        )

        history.push({ role: 'model', parts: [{ text: responseText }] })
        finalOutput = responseText

        const toolMatches = extractToolCalls(responseText)

        if (toolMatches.length > 0) {
          const toolPromises = toolMatches.map(async (toolContent) => {
            const { name, args: subArgs } = parseToolCall(toolContent)

            if (name === 'send_group_message') {
              const msgContent = subArgs.content || ''
              const status = (subArgs.status || 'working') as 'working' | 'done' | 'error'

              blackboard.push({
                sender: index,
                content: msgContent,
                timestamp: Date.now(),
                status,
                readBy: [index]
              })
              notifyWaiters()

              const messageData = {
                agentIndex: index,
                content: msgContent,
                status,
                timestamp: Date.now(),
                chatId
              }
              if (parentSignal?.aborted) throw new Error('AbortError')
              ipcMain.emit('subagent-message-broadcast', null, messageData)
              subagentChatLog.push(messageData)

              if (parentSignal?.aborted) throw new Error('AbortError')
              event.sender.send('chat-tool-update', {
                toolCallName: 'run_subagents',
                update: {
                  agentIndex: index,
                  phase: 'tool_use',
                  command: `POST TO GROUP (${status}): "${msgContent}"`
                },
                chatId
              })

              if (status !== 'working') {
                isAgentFinished = true
                const activeWorkers = Array.from({ length: quantity }, (_, i) => i)
                const allFinished = activeWorkers.every((idx) => {
                  if (idx === index) return true
                  const lastMsg = blackboard
                    .slice()
                    .reverse()
                    .find((m) => m.sender === idx)
                  return lastMsg && lastMsg.status !== 'working'
                })
                if (allFinished) {
                  swarmCompleted = true
                  notifyWaiters()
                }
              }
              return `\n[SYSTEM]: Message broadcasted. Status set to ${status}.\n`
            }

            if (name === 'read_group_messages') {
              const since = parseInt(subArgs.sinceTimestamp || '0')
              const limit = parseInt(subArgs.limit || '10')
              const filtered = blackboard.filter((m) => m.timestamp > since).slice(-limit)

              return `\n[GROUP CHAT HISTORY]:\n${filtered
                .map((m) => {
                  const senderName = getGroupSenderName(m.sender)
                  return `${senderName} (${m.status}): ${m.content}`
                })
                .join('\n')}\n`
            }

            if (name === 'wait_for_updates') {
              const timeout = Math.min(parseInt(subArgs.timeoutSeconds || '180'), 180)
              const hasUnread = blackboard.slice(readCursor).some((m) => m.sender !== index)
              if (hasUnread || swarmCompleted) {
                return `\n[SYSTEM]: Resuming immediately.\n`
              }

              if (parentSignal?.aborted) throw new Error('AbortError')
              event.sender.send('chat-tool-update', {
                toolCallName: 'run_subagents',
                update: {
                  agentIndex: index,
                  phase: 'tool_use',
                  command: `WAITING FOR UPDATES...`
                },
                chatId
              })

              await Promise.race([
                new Promise<void>((r) => waiters.push(r)),
                new Promise<void>((r) => setTimeout(r, timeout * 1000)),
                new Promise<void>((_, reject) => {
                  if (parentSignal?.aborted) reject(new Error('AbortError'))
                  parentSignal?.addEventListener('abort', () => reject(new Error('AbortError')))
                })
              ])

              return `\n[SYSTEM]: Resuming after update or timeout.\n`
            }

            if (name && toolFunctions[name]) {
              if (parentSignal?.aborted) throw new Error('AbortError')

              event.sender.send('chat-tool-update', {
                toolCallName: 'run_subagents',
                update: {
                  agentIndex: index,
                  phase: 'tool_use',
                  command: `${name} (${JSON.stringify(subArgs)})`
                },
                chatId
              })

              const toolResult = await toolFunctions[name](
                subArgs,
                event,
                apiKey,
                parentSignal,
                chatId
              )

              if (parentSignal?.aborted) throw new Error('AbortError')

              event.sender.send('chat-tool-update', {
                toolCallName: 'run_subagents',
                update: {
                  agentIndex: index,
                  phase: 'tool_use',
                  command: `${name}`,
                  output: toolResult.substring(0, 100) + (toolResult.length > 100 ? '...' : '')
                },
                chatId
              })

              return `\n[RESULT FOR ${name}]:\n${toolResult}\n`
            }
            return ''
          })

          const toolResults = await Promise.all(toolPromises)
          const allResults = toolResults.join('')
          const parts: NonNullable<Content['parts']> = [
            { text: `[SYSTEM: TOOL RESULTS]${allResults}\nProceed.` }
          ]
          const screenshotBase64 = chatId ? lastScreenshots.get(chatId) : undefined
          if (screenshotBase64) {
            lastScreenshots.delete(chatId!)
            parts.push({
              inlineData: {
                mimeType: 'image/png',
                data: screenshotBase64
              }
            })
          }
          history.push({
            role: 'user',
            parts
          })
          continue
        }

        break
      }

      if (parentSignal?.aborted) throw new Error('AbortError')
      event.sender.send('chat-tool-update', {
        toolCallName: 'run_subagents',
        update: { agentIndex: index, phase: 'done', output: 'Task completed.' },
        chatId
      })

      const cleanedOutput = finalOutput.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim()
      return `[AGENT #${index} FINAL REPORT]:\n${cleanedOutput}`
    } catch (err) {
      if (
        parentSignal?.aborted ||
        (err instanceof Error &&
          (err.name === 'AbortError' || err.name === 'GoogleGenerativeAIAbortError'))
      ) {
        throw new Error('AbortError')
      }

      event.sender.send('chat-tool-update', {
        toolCallName: 'run_subagents',
        update: { agentIndex: index, phase: 'error', output: String(err) },
        chatId
      })
      return `[AGENT #${index} ERROR]:\n${err instanceof Error ? err.message : String(err)}`
    }
  })

  try {
    const results = await Promise.all(agentPromises)
    const combinedReport = results.join('\n\n' + '='.repeat(30) + '\n\n')

    // Append subagent chat log for persistence
    return `${combinedReport}\n\n<subagent_chat>${JSON.stringify(subagentChatLog)}</subagent_chat>`
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return 'Sub-agents execution was cancelled by user.'
    }
    throw err
  } finally {
    ipcMain.removeListener('subagent-message-broadcast', externalMessageListener)
  }
}

/**
 * Initializes or clears the history with system instructions.
 */
export function initGemini(): boolean {
  closePersistentBrowser().catch((err) =>
    console.warn('Failed to close persistent browser in initGemini:', err)
  )
  currentSessionId = Date.now().toString()
  chatHistory = [
    { role: 'system', parts: [{ text: getSystemToolsPrompt(currentModelKey) }] },
    {
      role: 'system',
      parts: [
        {
          text: 'Understood. I am Prism, your automation AI. I will use <tool_call> to interact with the system when necessary, staying focused on your initial goal.'
        }
      ]
    }
  ]
  return true
}

/**
 * Loads a past session into the current history.
 */
export function loadChatIntoHistory(id: string): Content[] {
  closePersistentBrowser().catch((err) =>
    console.warn('Failed to close persistent browser in loadChatIntoHistory:', err)
  )
  const session = loadChatSession(id)
  if (session) {
    currentSessionId = session.id
    const cleanMessages = session.messages.filter((msg) => {
      if (msg.role === 'system') {
        const text = msg.parts?.[0]?.text || ''
        return !text.includes('# Identity') && !text.includes('Understood. I am Prism')
      }
      return true
    })

    // Prepend system messages to the history loaded from disk
    chatHistory = [
      { role: 'system', parts: [{ text: getSystemToolsPrompt(currentModelKey) }] },
      {
        role: 'system',
        parts: [
          {
            text: 'Understood. I am Prism, your automation AI. I will use <tool_call> to interact with the system when necessary, staying focused on your initial goal.'
          }
        ]
      },
      ...cleanMessages
    ]

    return chatHistory
  }
  return []
}

/**
 * Changes the current model. The history is NOT restarted.
 */
export function setGeminiModel(modelKey: string): boolean {
  currentModelKey = modelKey
  // initGemini() was removed to maintain history between changes
  return true
}

export function setSubagentModel(modelKey: string): boolean {
  if (!MODEL_CONFIGS[modelKey]) return false
  currentSubagentModelKey = modelKey
  return true
}

// API Key provided by the user manually
let userApiKey: string | null = null

/**
 * Sets the user's API key manually.
 */
export function setUserApiKey(key: string): void {
  userApiKey = key
}

const abortController: AbortController | null = null

const CANCEL_MESSAGE = '-------------- You cancelled AI response ----------------'

export function cancelChatMessage(chatId?: string): void {
  if (chatId) {
    const run = activeRuns.get(chatId)
    if (run) {
      run.abortController.abort()
    }
  } else {
    if (abortController) {
      abortController.abort()
    }
    for (const run of activeRuns.values()) {
      run.abortController.abort()
    }
  }
}

/**
 * Generates a short title for the chat session based on the first message.
 * ALWAYS matches the language of the user's first message and uses gemma-4-26b-a4b-it.
 */
async function generateChatTitle(apiKey: string, firstMessage: string): Promise<string> {
  try {
    const ai = new GoogleGenAI({ apiKey })

    const prompt = `You are a conversation titler. Analyze the user's first message below and generate an extremely short (maximum 5 words) title for this conversation.
IMPORTANT: The title MUST be written in the EXACT same language as the user's message. DEFINITELY match the user's language (e.g., if the user writes in Portuguese, the title must be in Portuguese; if in Spanish, in Spanish; if in English, in English, etc.).
Respond ONLY with the title. Do not include any quotes, markdown headers, punctuation, or preamble.

User message: "${firstMessage}"`

    const result = await ai.models.generateContent({
      model: 'gemma-4-26b-a4b-it',
      contents: prompt,
      config: {
        temperature: TITLE_GENERATION_TEMPERATURE,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH, includeThoughts: false }
      }
    })
    const fullTitle = (result.text || '').trim()
    return fullTitle || 'New Conversation'
  } catch (error) {
    console.error('Failed to generate chat title:', error)
    return 'Nova Conversa'
  }
}

interface AttachedFile {
  name: string
  mimeType: string
  data: string
}

export async function handleChatMessage(
  event: IpcMainEvent,
  data:
    | string
    | {
        message: string
        thinkMode?: boolean
        chatId?: string
        screenshot?: string
        quote?: string
        attachedFile?: AttachedFile
        appMode?: string
      }
): Promise<void> {
  const message = typeof data === 'string' ? data : data.message
  const thinkMode = typeof data === 'object' ? !!data.thinkMode : false
  const chatId = typeof data === 'object' && data.chatId ? data.chatId : currentSessionId
  const screenshot = typeof data === 'object' ? data.screenshot : undefined
  const quote = typeof data === 'object' ? data.quote : undefined
  const attachedFile = typeof data === 'object' ? data.attachedFile : undefined
  const appMode = typeof data === 'object' ? data.appMode : undefined

  // Priority: User key > Environment key
  const apiKey = userApiKey || process.env.GEMINI_API_KEY

  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_api_key_here') {
    // If there is no key, we send a specific error message so that the front-end
    // can trigger the API Key modal if necessary.
    event.sender.send('chat-reply-error', { error: 'API_KEY_MISSING', chatId })
    return
  }

  // Retrieve or initialize history for this run
  let runHistory: Content[] = []
  if (chatId === currentSessionId && chatHistory.length > 0) {
    runHistory = chatHistory
  } else {
    currentSessionId = chatId
    const session = loadChatSession(chatId)
    if (session) {
      const cleanMessages = session.messages.filter((msg) => {
        if (msg.role === 'system') {
          const text = msg.parts?.[0]?.text || ''
          return !text.includes('# Identity') && !text.includes('Understood. I am Prism')
        }
        return true
      })
      runHistory = [
        {
          role: 'system',
          parts: [{ text: getSystemToolsPrompt(currentModelKey, 'main') }]
        },
        {
          role: 'system',
          parts: [
            {
              text: 'Understood. I am Prism, your automation AI. I will use <tool_call> to interact with the system when necessary, staying focused on your initial goal.'
            }
          ]
        },
        ...cleanMessages
      ]
    } else {
      runHistory = [
        {
          role: 'system',
          parts: [{ text: getSystemToolsPrompt(currentModelKey, 'main') }]
        },
        {
          role: 'system',
          parts: [
            {
              text: 'Understood. I am Prism, your automation AI. I will use <tool_call> to interact with the system when necessary, staying focused on your initial goal.'
            }
          ]
        }
      ]
    }
    chatHistory = runHistory
  }

  // A session is considered "new" for title generation if it only has the initial system/model messages
  const isFirstUserMessage = runHistory.length <= 2

  // Intercept manual subagent delegation
  if (message.startsWith('[MANUAL_SUBAGENTS]')) {
    // Prevent duplicate concurrent runs for the same chatId
    if (activeRuns.has(chatId)) {
      console.log(`Chat ${chatId} is already running. Ignoring duplicate message.`)
      return
    }

    const userParts: NonNullable<Content['parts']> = [{ text: 'Delegated Subagents Swarm' }]
    runHistory.push({ role: 'user', parts: userParts })

    if (isFirstUserMessage && apiKey) {
      saveChatSession(chatId, runHistory, 'Subagent Swarm')
      event.sender.send('chat-session-created', { id: chatId })
      event.sender.send('chat-title-received', { id: chatId, title: 'Subagent Swarm' })
    } else {
      saveChatSession(chatId, runHistory)
    }

    event.sender.send('chat-reply-start', { chatId })

    const runAbortController = new AbortController()
    activeRuns.set(chatId, {
      chatId,
      chatHistory: runHistory,
      abortController: runAbortController,
      modelKey: currentModelKey
    })

    try {
      const payloadStr = message.substring('[MANUAL_SUBAGENTS]'.length)
      const { model, prompts } = JSON.parse(payloadStr)

      // Temporarily set the subagent model key based on the user's choice in the modal
      if (model) {
        setSubagentModel(model)
      }

      // Construct arguments for runSubagents
      const subagentArgs: ToolArgs = {
        quantity: String(prompts.length)
      }
      prompts.forEach((p: string, idx: number) => {
        subagentArgs[`prompt:${idx + 1}`] = p
      })

      // Send tool-start event so the UI displays the subagent panel
      event.sender.send('chat-tool-start', {
        name: 'run_subagents',
        args: subagentArgs,
        timestamp: Date.now(),
        chatId
      })

      // Run subagents swarm
      const report = await runSubagents(
        subagentArgs,
        event,
        apiKey,
        runAbortController.signal,
        chatId
      )

      // Send tool-end event to close the execution UI
      event.sender.send('chat-tool-end', {
        name: 'run_subagents',
        result: report,
        chatId
      })

      const cleanResponse = report.replace(/<subagent_chat>[\s\S]*?<\/subagent_chat>/gi, '').trim()

      runHistory.push({ role: 'model', parts: [{ text: report }] })
      saveChatSession(chatId, runHistory)

      event.sender.send('chat-reply-end', {
        thoughts: '',
        finalResponse: cleanResponse,
        rawText: report,
        usedFallback: false,
        isThinking: false,
        chatId
      })
    } catch (error) {
      if (
        runAbortController.signal.aborted ||
        (error instanceof Error &&
          (error.name === 'AbortError' || error.name === 'GoogleGenerativeAIAbortError'))
      ) {
        event.sender.send('chat-reply-error', { error: CANCEL_MESSAGE, chatId })
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error)
        event.sender.send('chat-reply-error', { error: errorMessage, chatId })
      }
    } finally {
      activeRuns.delete(chatId)
    }
    return
  }

  // Prevent duplicate concurrent runs for the same chatId
  if (activeRuns.has(chatId)) {
    console.log(`Chat ${chatId} is already running. Ignoring duplicate message.`)
    return
  }

  // Load config to check for customizable slash workflows
  const config = loadConfig()
  const firstUserMsg = runHistory.find((m) => m.role === 'user')
  const firstMsgText = firstUserMsg ? getMessageText(firstUserMsg).trim() : message.trim()
  const matchedWorkflow = config.workflows?.find((w) =>
    firstMsgText.toLowerCase().startsWith(w.command.toLowerCase())
  )

  const basePrompt = getSystemToolsPrompt(currentModelKey, 'main', matchedWorkflow?.toolConstraints)
  let fullPrompt = basePrompt
  if (matchedWorkflow) {
    fullPrompt += `\n\n# Active Workflow: ${matchedWorkflow.name}\n${matchedWorkflow.systemInstruction}`
  }

  if (runHistory.length > 0 && runHistory[0].role === 'system') {
    runHistory[0].parts = [{ text: fullPrompt }]
  }

  // Add the user's real question to the manual history
  const userParts: NonNullable<Content['parts']> = []
  let userText = message
  if (appMode === 'youtube') {
    userText =
      `<youtube_app_context>\n<instruction>You are running in YouTube App Mode. The user wants to find and play a video. Use web_search to find a suitable YouTube video link and then use open_browser_link to open it for the user.</instruction>\n</youtube_app_context>\n\n` +
      userText
  }

  if (quote) {
    userParts.push({
      text: `<quote_context>\n<passage>${quote}</passage>\n<instruction>Focus the response on the context of the quoted passage above, ensuring traceability and semantic accuracy.</instruction>\n</quote_context>\n\n${userText}`
    })
  } else {
    userParts.push({ text: userText })
  }
  if (screenshot && (!attachedFile || !attachedFile.mimeType.startsWith('image/'))) {
    userParts.push({
      inlineData: {
        mimeType: 'image/png',
        data: screenshot
      }
    })
  }
  if (attachedFile) {
    userParts.push({
      inlineData: {
        mimeType: attachedFile.mimeType,
        data: attachedFile.data
      }
    })
  }
  runHistory.push({ role: 'user', parts: userParts })

  // If it's the first message, prepare the UI and start title generation
  if (isFirstUserMessage && apiKey) {
    // Save session with EMPTY title to trigger loading state in sidebar if refreshed from disk
    saveChatSession(chatId, runHistory, '')
    event.sender.send('chat-session-created', { id: chatId })

    generateChatTitle(apiKey, message).then((finalTitle) => {
      event.sender.send('chat-title-received', { id: chatId, title: finalTitle })
      saveChatSession(chatId, runHistory, finalTitle)
    })
  } else {
    // Regular save for existing sessions
    saveChatSession(chatId, runHistory)
  }

  let usedFallback = false
  let success = false
  const triedModelKeys = new Set<string>()

  // Notify the start of the response ONLY ONCE
  event.sender.send('chat-reply-start', { chatId })

  // Create abort controller for this request session
  const runAbortController = new AbortController()
  activeRuns.set(chatId, {
    chatId,
    chatHistory: runHistory,
    abortController: runAbortController,
    modelKey: currentModelKey
  })

  try {
    while (!success) {
      // Check if aborted before starting/restarting
      if (runAbortController.signal.aborted) {
        event.sender.send('chat-reply-error', { error: CANCEL_MESSAGE, chatId })
        success = true
        return
      }

      triedModelKeys.add(currentModelKey)

      try {
        const config = {
          ...(MODEL_CONFIGS[currentModelKey] ||
            MODEL_CONFIGS['prism-5'] ||
            MODEL_CONFIGS['prism-4'])
        }

        // Dynamic Thinking Config
        if (thinkMode) {
          config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH, includeThoughts: true }
        } else {
          const defaultInclude =
            MODEL_CONFIGS[currentModelKey]?.thinkingConfig?.includeThoughts ?? true
          config.thinkingConfig = {
            thinkingLevel: ThinkingLevel.MINIMAL,
            includeThoughts: defaultInclude
          }
        }

        const ai = new GoogleGenAI({ apiKey })

        let accumulatedThoughts = ''
        let accumulatedFinalResponse = ''
        let iterationCount = 0
        const MAX_ITERATIONS = 10

        while (iterationCount < MAX_ITERATIONS) {
          iterationCount++

          // Check if aborted before each AI call
          if (runAbortController.signal.aborted) throw new Error('AbortError')

          console.log(
            `[Main Chat] Starting generateContentStream for model: ${config.apiModel}, thinkMode: ${thinkMode}`
          )
          // Call generateContentStream (actual streaming)
          const responseStream = await ai.models.generateContentStream({
            model: config.apiModel,
            contents: normalizeContentsForGemini(runHistory),
            config: {
              temperature: AGENT_TEMPERATURE,
              thinkingConfig: getStreamingThinkingConfig(config),
              abortSignal: runAbortController.signal
            }
          })

          let currentThoughts = ''
          let currentFinalResponse = ''
          let chunkCount = 0

          for await (const chunk of responseStream) {
            if (runAbortController.signal.aborted) throw new Error('AbortError')
            chunkCount++

            const parts = chunk.candidates?.[0]?.content?.parts || []
            console.log(
              `[Main Chat] Chunk #${chunkCount} received. Candidate parts length: ${parts.length}`
            )
            for (const part of parts) {
              if (part && typeof part === 'object' && 'thought' in part && part.thought) {
                currentThoughts += part.text || ''
                console.log(`[Main Chat] Thought part: "${part.text || ''}"`)
              } else if (part.text) {
                currentFinalResponse += part.text
                console.log(`[Main Chat] Text part: "${part.text}"`)
              }
            }

            const countOccurrences = (str: string, subStr: string): number =>
              str.split(subStr).length - 1

            const isWritingToolCall =
              countOccurrences(currentFinalResponse, '<tool_call>') >
                countOccurrences(currentFinalResponse, '</tool_call>') ||
              countOccurrences(currentFinalResponse, '<mini_app>') >
                countOccurrences(currentFinalResponse, '</mini_app>')

            let toolType: 'task' | 'search' | 'mini-app' | undefined = undefined
            if (isWritingToolCall) {
              const openMiniApp =
                countOccurrences(currentFinalResponse, '<mini_app>') >
                countOccurrences(currentFinalResponse, '</mini_app>')
              if (openMiniApp) {
                toolType = 'mini-app'
              } else {
                const lastOpenIdx = currentFinalResponse.lastIndexOf('<tool_call>')
                const currentToolSegment = currentFinalResponse.substring(lastOpenIdx)
                const isSearch =
                  currentToolSegment.includes('<name>web_search</name>') ||
                  currentToolSegment.includes('<name>search_chat_history</name>') ||
                  currentToolSegment.includes('<name>saw_link_from_url</name>') ||
                  currentToolSegment.includes('"type": "web_search"') ||
                  currentToolSegment.includes('"type": "saw_link_from_url"') ||
                  currentToolSegment.includes("'type': 'web_search'") ||
                  currentToolSegment.includes("'type': 'saw_link_from_url'") ||
                  currentToolSegment.includes('"search_chat_memory"') ||
                  currentToolSegment.includes("'search_chat_memory'")
                toolType = isSearch ? 'search' : 'task'
              }
            }

            const fullResponse = accumulatedFinalResponse + currentFinalResponse
            const fullThoughts = accumulatedThoughts + currentThoughts
            const isThinking = currentThoughts.length > 0 && currentFinalResponse.length === 0

            console.log(
              `[Main Chat] Sending chat-reply-chunk: thoughts length: ${fullThoughts.trim().length}, response length: ${fullResponse.trim().length}, isThinking: ${isThinking}`
            )
            event.sender.send('chat-reply-chunk', {
              thoughts: fullThoughts.trim(),
              finalResponse: fullResponse.trim(),
              rawText: fullThoughts + fullResponse,
              usedFallback: usedFallback,
              isThinking,
              isWritingToolCall,
              toolType,
              chatId: chatId
            })
          }

          console.log(`[Main Chat] Stream generation completed. Total chunks: ${chunkCount}`)
          // Add the AI response (whether text or Tool Call) to history
          const fullAiResponse = currentFinalResponse
          if (fullAiResponse.trim()) {
            runHistory.push({ role: 'model', parts: [{ text: fullAiResponse }] })
            saveChatSession(chatId, runHistory)
          }

          accumulatedThoughts += currentThoughts
          const needsSeparator = accumulatedFinalResponse.length > 0 && currentFinalResponse.trim().length > 0
          accumulatedFinalResponse += needsSeparator ? '\n\n' + currentFinalResponse : currentFinalResponse

          const toolMatches = extractToolCalls(fullAiResponse)

          if (toolMatches.length > 0) {
            const toolPromises = toolMatches.map(async (toolContent) => {
              const validation = validateToolCall(toolContent)
              let isMalformed = validation.isMalformed
              let actualName = isMalformed ? 'malformed_tool_call' : validation.name!

              if (
                !isMalformed &&
                matchedWorkflow?.toolConstraints &&
                matchedWorkflow.toolConstraints.length > 0
              ) {
                if (!matchedWorkflow.toolConstraints.includes(actualName)) {
                  isMalformed = true
                  validation.isMalformed = true
                  validation.errorType = 'invalid_tool'
                  validation.errorMessage = `Error: The tool "${actualName}" is not allowed under the active workflow constraints. Allowed tools for this workflow are: ${matchedWorkflow.toolConstraints.join(', ')}.`
                  actualName = 'malformed_tool_call'
                }
              }

              let toolArgs = validation.args

              if (isMalformed) {
                toolArgs = {
                  rawContent: toolContent,
                  originalName: validation.name || 'None',
                  errorType: validation.errorType,
                  errorMessage: validation.errorMessage
                }
              }

              event.sender.send('chat-tool-start', {
                name: actualName,
                args: toolArgs,
                timestamp: Date.now(),
                chatId
              })

              let toolResult = ''
              if (isMalformed) {
                toolResult = `Error: AI stopped due to a malformed Tool Call.
Detailed Error: ${validation.errorMessage}

Your generated segment was:
<tool_call>
${toolContent.trim()}
</tool_call>

Every tool call MUST strictly conform to the expected format. Please review the error above, correct the tool call format, and try again.`
                // Slight delay to feel like execution time
                await new Promise((resolve) => setTimeout(resolve, 500))
              } else {
                try {
                  // Check if aborted before running tool
                  const signal = runAbortController.signal
                  if (signal?.aborted) throw new Error('AbortError')
                  toolResult = await toolFunctions[actualName](
                    toolArgs,
                    event,
                    apiKey,
                    signal,
                    chatId
                  )
                } catch (err) {
                  if (
                    runAbortController.signal.aborted ||
                    (err instanceof Error &&
                      (err.name === 'AbortError' || err.name === 'GoogleGenerativeAIAbortError'))
                  ) {
                    toolResult = 'Cancelled by user.'
                    event.sender.send('chat-tool-end', {
                      name: actualName,
                      result: toolResult,
                      chatId
                    })
                    throw new Error('AbortError')
                  }
                  toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`
                }
              }

              event.sender.send('chat-tool-end', { name: actualName, result: toolResult, chatId })
              return `\n[RESULT FOR ${actualName}]:\n${toolResult}\n`
            })

            const results = await Promise.all(toolPromises)
            const allToolResults = results.join('')

            if (allToolResults) {
              const systemFeedback = `[SYSTEM: TOOL RESULTS]${allToolResults}\nAnalyze these results and proceed. If the goal is achieved, finalize. If more steps are needed, use another tool.`
              const parts: NonNullable<Content['parts']> = [{ text: systemFeedback }]
              const screenshotBase64 = chatId ? lastScreenshots.get(chatId) : undefined
              if (screenshotBase64) {
                lastScreenshots.delete(chatId)
                parts.push({
                  inlineData: {
                    mimeType: 'image/png',
                    data: screenshotBase64
                  }
                })
              }
              runHistory.push({ role: 'system', parts })
              saveChatSession(chatId, runHistory)
              continue
            }
          }

          // If no tool call or the loop ended, send the end of the response
          event.sender.send('chat-reply-end', {
            thoughts: accumulatedThoughts.trim(),
            finalResponse: accumulatedFinalResponse.trim(),
            rawText: accumulatedThoughts + accumulatedFinalResponse,
            usedFallback: usedFallback,
            isThinking: false,
            chatId: chatId
          })

          // Save session after AI response
          saveChatSession(chatId, runHistory)

          // Auto-minimize logic: if simple task (<= 100 chars excluding tools)
          const cleanResponse = removeToolCalls(accumulatedFinalResponse).trim()
          if (cleanResponse.length <= 100) {
            event.sender.send('auto-minimize-trigger')
          }

          success = true
          return // Exit function after success
        }

        // If exiting the iteration loop without success (e.g. reached MAX_ITERATIONS)
        success = true
      } catch (error) {
        // Robust check for user-initiated abort
        if (
          runAbortController.signal.aborted ||
          (error instanceof Error &&
            (error.name === 'AbortError' || error.name === 'GoogleGenerativeAIAbortError'))
        ) {
          console.log('Chat request aborted by user')
          event.sender.send('chat-reply-error', { error: CANCEL_MESSAGE, chatId })
          success = true
          return
        }

        console.error('Gemini API Error:', error)

        // Fallback Logic
        const currentIndex = MODEL_FALLBACK_ORDER.indexOf(currentModelKey)
        let nextModelKey: string | null = null

        if (currentIndex !== -1) {
          // Look for the next model in a circular fashion that hasn't been tried yet
          for (let i = 1; i <= MODEL_FALLBACK_ORDER.length; i++) {
            const nextIdx = (currentIndex + i) % MODEL_FALLBACK_ORDER.length
            const candidate = MODEL_FALLBACK_ORDER[nextIdx]
            if (!triedModelKeys.has(candidate)) {
              nextModelKey = candidate
              break
            }
          }
        } else {
          // If the current model is not in MODEL_FALLBACK_ORDER (e.g. prism-5 or prism-4),
          // we can fallback to the first model of MODEL_FALLBACK_ORDER that hasn't been tried yet.
          for (const candidate of MODEL_FALLBACK_ORDER) {
            if (!triedModelKeys.has(candidate)) {
              nextModelKey = candidate
              break
            }
          }
        }

        if (nextModelKey) {
          const oldModelKey = currentModelKey
          currentModelKey = nextModelKey
          usedFallback = true

          const run = activeRuns.get(chatId)
          if (run) {
            run.modelKey = currentModelKey
          }

          const friendlyName = getModelFriendlyName(currentModelKey)
          const fallbackInstruction = `[SYSTEM: FALLBACK] An API error occurred with the previous model. You have been activated as ${friendlyName} to continue. Please analyze the history above and proceed with the task from where it left off. Do NOT mention or inform the user about this technical model switch in your response; simply continue the work from where the previous model left off.`

          runHistory.push({ role: 'system', parts: [{ text: fallbackInstruction }] })
          saveChatSession(chatId, runHistory)

          // Notify the UI about the model change (optional, but good to keep in sync)
          event.sender.send('model-changed', currentModelKey)

          // Send fallback activation event to renderer
          event.sender.send('chat-fallback-activated', {
            chatId,
            previousModel: getModelFriendlyName(oldModelKey),
            newModel: friendlyName
          })

          console.log(`Fallback activated: New model ${currentModelKey}`)
          continue // Try again with the new model (success remains false)
        } else {
          const errorMessage = error instanceof Error ? error.message : String(error)
          event.sender.send('chat-reply-error', { error: errorMessage, chatId })
          success = true // End the loop anyway
        }
      }
    }
  } finally {
    activeRuns.delete(chatId)
  }
}

/**
 * Handles chat messages sent from the Quick Launcher mini-chat.
 */
export async function handleLauncherChatMessage(
  event: IpcMainEvent,
  data: string | { message: string; thinkMode?: boolean; screenshot?: string; appMode?: string }
): Promise<void> {
  const message = typeof data === 'string' ? data : data.message
  const thinkMode =
    typeof data === 'object' ? (data.thinkMode !== undefined ? !!data.thinkMode : true) : true
  const screenshot = typeof data === 'object' ? data.screenshot : undefined
  const appMode = typeof data === 'object' ? data.appMode : undefined

  const apiKey = userApiKey || process.env.GEMINI_API_KEY
  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_api_key_here') {
    event.sender.send('launcher-reply-error', { error: 'API_KEY_MISSING' })
    return
  }

  // Cancel any active run for the launcher
  if (launcherAbortController) {
    launcherAbortController.abort()
  }

  const runAbortController = new AbortController()
  launcherAbortController = runAbortController

  const launcherModelKey = 'prism-6-super-fast' // Always uses Prism 6 Super-Fast by default for launcher chat

  if (launcherChatHistory.length === 0) {
    launcherChatHistory = [
      {
        role: 'system',
        parts: [{ text: getSystemToolsPrompt(launcherModelKey, 'launcher') }]
      },
      {
        role: 'system',
        parts: [
          {
            text: 'Understood. I am Prism Launcher Chat. I will use only standard markdown for replies, and I will use only the web_search, saw_link_from_url, or open_main_app tools when necessary.'
          }
        ]
      }
    ]
  }

  let userText = message
  if (appMode === 'youtube') {
    userText =
      `<youtube_app_context>\n<instruction>You are running in YouTube App Mode. The user wants to find and play a video. Use web_search to find a suitable YouTube video link and then use open_browser_link to open it for the user.</instruction>\n</youtube_app_context>\n\n` +
      userText
  }

  const userParts: NonNullable<Content['parts']> = [{ text: userText }]
  if (screenshot) {
    userParts.push({
      inlineData: {
        mimeType: 'image/png',
        data: screenshot
      }
    })
  }
  launcherChatHistory.push({ role: 'user', parts: userParts })

  let success = false
  event.sender.send('launcher-reply-start')

  try {
    while (!success) {
      if (runAbortController.signal.aborted) {
        event.sender.send('launcher-reply-error', { error: 'Cancelled by user.' })
        success = true
        return
      }

      try {
        const config = {
          ...(MODEL_CONFIGS[launcherModelKey] || MODEL_CONFIGS['prism-4'])
        }

        // Set Think Mode with ThinkingLevel.HIGH by default
        if (thinkMode) {
          config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH, includeThoughts: true }
        } else {
          config.thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: false }
        }

        const ai = new GoogleGenAI({ apiKey })

        let accumulatedThoughts = ''
        let accumulatedFinalResponse = ''
        let iterationCount = 0
        const MAX_ITERATIONS = 10

        while (iterationCount < MAX_ITERATIONS) {
          iterationCount++

          if (runAbortController.signal.aborted) throw new Error('AbortError')

          // Call generateContentStream (actual streaming)
          const responseStream = await ai.models.generateContentStream({
            model: config.apiModel,
            contents: normalizeContentsForGemini(launcherChatHistory),
            config: {
              temperature: 0.7,
              thinkingConfig: config.thinkingConfig,
              abortSignal: runAbortController.signal
            }
          })

          let currentThoughts = ''
          let currentFinalResponse = ''

          for await (const chunk of responseStream) {
            if (runAbortController.signal.aborted) throw new Error('AbortError')

            const parts = chunk.candidates?.[0]?.content?.parts || []
            for (const part of parts) {
              if (part && typeof part === 'object' && 'thought' in part && part.thought) {
                currentThoughts += part.text || ''
              } else if (part.text) {
                currentFinalResponse += part.text
              }
            }

            const countOccurrences = (str: string, subStr: string): number =>
              str.split(subStr).length - 1

            const isWritingToolCall =
              countOccurrences(currentFinalResponse, '<tool_call>') >
                countOccurrences(currentFinalResponse, '</tool_call>') ||
              countOccurrences(currentFinalResponse, '<mini_app>') >
                countOccurrences(currentFinalResponse, '</mini_app>')

            let toolType: 'task' | 'search' | 'mini-app' | undefined = undefined
            if (isWritingToolCall) {
              const openMiniApp =
                countOccurrences(currentFinalResponse, '<mini_app>') >
                countOccurrences(currentFinalResponse, '</mini_app>')
              if (openMiniApp) {
                toolType = 'mini-app'
              } else {
                const lastOpenIdx = currentFinalResponse.lastIndexOf('<tool_call>')
                const currentToolSegment = currentFinalResponse.substring(lastOpenIdx)
                const isSearch =
                  currentToolSegment.includes('<name>web_search</name>') ||
                  currentToolSegment.includes('<name>search_chat_history</name>') ||
                  currentToolSegment.includes('<name>saw_link_from_url</name>') ||
                  currentToolSegment.includes('"type": "web_search"') ||
                  currentToolSegment.includes('"type": "saw_link_from_url"') ||
                  currentToolSegment.includes("'type': 'web_search'") ||
                  currentToolSegment.includes("'type': 'saw_link_from_url'") ||
                  currentToolSegment.includes('"search_chat_memory"') ||
                  currentToolSegment.includes("'search_chat_memory'")
                toolType = isSearch ? 'search' : 'task'
              }
            }

            const fullResponse = accumulatedFinalResponse + currentFinalResponse
            const fullThoughts = accumulatedThoughts + currentThoughts
            const isThinking = currentThoughts.length > 0 && currentFinalResponse.length === 0

            event.sender.send('launcher-reply-chunk', {
              thoughts: fullThoughts.trim(),
              finalResponse: fullResponse.trim(),
              isThinking,
              isWritingToolCall,
              toolType
            })
          }

          const fullAiResponse = currentFinalResponse
          if (fullAiResponse.trim()) {
            launcherChatHistory.push({ role: 'model', parts: [{ text: fullAiResponse }] })
          }

          accumulatedThoughts += currentThoughts
          accumulatedFinalResponse += currentFinalResponse

          const toolMatches = extractToolCalls(fullAiResponse)

          if (toolMatches.length > 0) {
            let openMainAppCalled = false

            const toolPromises = toolMatches.map(async (toolContent) => {
              const { name, args: toolArgs } = parseToolCall(toolContent)

              if (name && toolFunctions[name]) {
                event.sender.send('launcher-tool-start', {
                  name,
                  args: toolArgs,
                  timestamp: Date.now()
                })

                let toolResult = ''
                try {
                  const signal = runAbortController.signal
                  if (signal?.aborted) throw new Error('AbortError')

                  if (name === 'open_main_app') {
                    if (toolArgs.thinkMode === undefined) {
                      toolArgs.thinkMode = thinkMode ? 'true' : 'false'
                    }
                    if (toolArgs.searchEnabled === undefined) {
                      toolArgs.searchEnabled = message.startsWith('[FORCE_SEARCH]')
                        ? 'true'
                        : 'false'
                    }
                    openMainAppCalled = true
                  }

                  toolResult = await toolFunctions[name](toolArgs, event, apiKey, signal)
                } catch (err) {
                  if (
                    runAbortController.signal.aborted ||
                    (err instanceof Error &&
                      (err.name === 'AbortError' || err.name === 'GoogleGenerativeAIAbortError'))
                  ) {
                    toolResult = 'Cancelled by user.'
                    event.sender.send('launcher-tool-end', { name, result: toolResult })
                    throw new Error('AbortError')
                  }
                  toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`
                }

                event.sender.send('launcher-tool-end', { name, result: toolResult })
                return `\n[RESULT FOR ${name}]:\n${toolResult}\n`
              }
              return ''
            })

            const results = await Promise.all(toolPromises)
            const allToolResults = results.join('')

            if (openMainAppCalled) {
              success = true
              launcherChatHistory = []
              event.sender.send('launcher-reply-end', { thoughts: '', finalResponse: '' })
              return
            }

            if (allToolResults) {
              const systemFeedback = `[SYSTEM: TOOL RESULTS]${allToolResults}\nAnalyze these results and proceed. If the goal is achieved, finalize. If more steps are needed, use another tool.`
              const parts: NonNullable<Content['parts']> = [{ text: systemFeedback }]
              const screenshotBase64 = lastScreenshots.get('launcher')
              if (screenshotBase64) {
                lastScreenshots.delete('launcher')
                parts.push({
                  inlineData: {
                    mimeType: 'image/png',
                    data: screenshotBase64
                  }
                })
              }
              launcherChatHistory.push({ role: 'system', parts })
              continue
            }
          }

          event.sender.send('launcher-reply-end', {
            thoughts: accumulatedThoughts.trim(),
            finalResponse: accumulatedFinalResponse.trim()
          })

          success = true
          return
        }

        success = true
      } catch (error) {
        if (
          runAbortController.signal.aborted ||
          (error instanceof Error &&
            (error.name === 'AbortError' || error.name === 'GoogleGenerativeAIAbortError'))
        ) {
          event.sender.send('launcher-reply-error', { error: 'Cancelled by user.' })
          success = true
          return
        }

        const errorMessage = error instanceof Error ? error.message : String(error)
        event.sender.send('launcher-reply-error', { error: errorMessage })
        success = true
      }
    }
  } finally {
    if (launcherAbortController === runAbortController) {
      launcherAbortController = null
    }
  }
}

export function clearLauncherChat(): void {
  launcherChatHistory = []
  if (launcherAbortController) {
    launcherAbortController.abort()
    launcherAbortController = null
  }
}

interface WavConversionOptions {
  numChannels: number
  sampleRate: number
  bitsPerSample: number
}

function parseMimeType(mimeType: string): WavConversionOptions {
  const [fileType, ...params] = mimeType.split(';').map((s) => s.trim())
  const [, format] = fileType.split('/')

  const options: Partial<WavConversionOptions> = {
    numChannels: 1
  }

  if (format && format.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10)
    if (!isNaN(bits)) {
      options.bitsPerSample = bits
    }
  }

  for (const param of params) {
    const [key, value] = param.split('=').map((s) => s.trim())
    if (key === 'rate') {
      options.sampleRate = parseInt(value, 10)
    }
  }

  return options as WavConversionOptions
}

function createWavHeader(dataLength: number, options: WavConversionOptions): Buffer {
  const { numChannels, sampleRate, bitsPerSample } = options

  // http://soundfile.sapp.org/doc/WaveFormat
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8
  const blockAlign = (numChannels * bitsPerSample) / 8
  const buffer = Buffer.alloc(44)

  buffer.write('RIFF', 0) // ChunkID
  buffer.writeUInt32LE(36 + dataLength, 4) // ChunkSize
  buffer.write('WAVE', 8) // Format
  buffer.write('fmt ', 12) // Subchunk1ID
  buffer.writeUInt32LE(16, 16) // Subchunk1Size (PCM)
  buffer.writeUInt16LE(1, 20) // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22) // NumChannels
  buffer.writeUInt32LE(sampleRate, 24) // SampleRate
  buffer.writeUInt32LE(byteRate, 28) // ByteRate
  buffer.writeUInt16LE(blockAlign, 32) // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34) // BitsPerSample
  buffer.write('data', 36) // Subchunk2ID
  buffer.writeUInt32LE(dataLength, 40) // Subchunk2Size

  return buffer
}

// TODO: Review manual PCM to WAV conversion logic (obsolete pattern / unusual block).
// Constructing WAV headers manually by byte writing could be fragile if audio formats or parameters
// change in the Gemini TTS API response. Consider using standard audio decoding libraries in the future.
function convertToWav(rawData: string, mimeType: string): Buffer {
  const options = parseMimeType(mimeType)
  const buffer = Buffer.from(rawData, 'base64')
  const wavHeader = createWavHeader(buffer.length, options)

  return Buffer.concat([wavHeader, buffer])
}

export async function generateTts(text: string): Promise<string> {
  const apiKey = userApiKey || process.env.GEMINI_API_KEY
  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_api_key_here') {
    throw new Error('API_KEY_MISSING')
  }

  const ai = new GoogleGenAI({ apiKey })

  const appConfig = loadConfig()
  const voiceName = appConfig.ttsVoice || 'Aoede'

  const model = 'gemini-2.5-flash-preview-tts'
  const config = {
    temperature: 1.3,
    responseModalities: ['audio'],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName
        }
      }
    }
  }

  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: `Read the following transcript based on the audio profile and director's note.

# Audio Profile
A helpful and professional personal assistant, but human to have some language addictions, like "hmm", "ehh", "ahmm", etc.

# Director's note
Style: Empathetic. Pace: Natural. Accent: Neutral.

## Scene:
A quiet, professional remote workspace.

## Sample Context:
Steady, efficient, and unhurried. Tone is empathetic, crisp, and reassuring.

## Transcript:
${text}`
        }
      ]
    }
  ]

  const response = await ai.models.generateContentStream({
    model,
    config,
    contents
  })

  const audioBuffers: Buffer[] = []
  let lastMimeType = ''

  for await (const chunk of response) {
    if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
      continue
    }

    const inlineData = chunk.candidates[0].content.parts[0].inlineData
    if (inlineData) {
      lastMimeType = inlineData.mimeType || ''
      const chunkBuffer = Buffer.from(inlineData.data || '', 'base64')
      audioBuffers.push(chunkBuffer)
    }
  }

  if (audioBuffers.length === 0) {
    throw new Error('No audio data generated.')
  }

  const rawAudioBuffer = Buffer.concat(audioBuffers)

  // Convert combined raw PCM data to WAV
  const finalWavBuffer = convertToWav(
    rawAudioBuffer.toString('base64'),
    lastMimeType || 'audio/pcm;rate=24000'
  )

  // Return as Base64 Data URI
  return `data:audio/wav;base64,${finalWavBuffer.toString('base64')}`
}

let aiSearchAbortController: AbortController | null = null

/**
 * Handles chat messages sent from the AI Search Modal.
 */
export async function handleAiSearchChatMessage(
  event: IpcMainEvent,
  data: string | { message: string }
): Promise<void> {
  const message = typeof data === 'string' ? data : data.message

  const apiKey = userApiKey || process.env.GEMINI_API_KEY
  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_api_key_here') {
    event.sender.send('ai-search-reply-error', { error: 'API_KEY_MISSING' })
    return
  }

  // Cancel any active AI search run
  if (aiSearchAbortController) {
    aiSearchAbortController.abort()
  }

  const runAbortController = new AbortController()
  aiSearchAbortController = runAbortController

  const modelKey = 'prism-6-super-fast' // gemini-3.1-flash-lite
  console.log(
    `[AI SEARCH DEBUG MAIN] Starting AI Search. modelKey: ${modelKey}, message: "${message}"`
  )

  const systemPrompt = `You are the Chat Search AI for the Prism application.
Your goal is to find chats from the user's history matching their description.
You are equipped with the tool "search_chat_memory" which searches all past conversations for matching context or keywords, returning structured metadata (IDs, filenames, titles, snippets).

CRITICAL INTERACTION PROTOCOL:
- You do NOT have native function calling enabled in this session.
- You must call tools ONLY by outputting the XML block <tool_call>JSON</tool_call> in your text response. 
- Do NOT attempt to use native function/tool calling.
- Do NOT output any JSON block outside of the <tool_call>...</tool_call> XML tags.

CRITICAL OUTPUT RULES:
- You do NOT inhabit conventional chats. You inhabit an isolated environment.
- You MUST NEVER send conversational text outputs (before, after, or during) when sending tool calls like \`search_chat_memory\` or \`not_found_chat_history\`.
- Your response must consist ONLY of the tool call XML block, until you finally find the matching chats.
- You may perform more than one search if the first search doesn't return the requested chats.
- ONLY when you find the matching chats, you should send friendly messages describing what you found and presenting the chats using \`render_chat_history\`.
- If you do not find any chat matching the user's request after searching, you MUST send the \`not_found_chat_history\` tool call as your ONLY output. Do NOT include any preceding or trailing conversational text.

Guidelines:
1. First, call \`search_chat_memory\` with relevant keywords to retrieve matching content.
Example of calling search_chat_memory:
<tool_call>
{
  "type": "search_chat_memory",
  "query": "words to search"
}
</tool_call>

2. Based on the returned context, locate the chat sessions that match.
3. Present your findings to the user. For each matching chat session, you MUST output a \`render_chat_history\` tool call so the UI can render it.
The query for \`render_chat_history\` MUST be the filename (e.g. "chat_23956810394.json") or the chat session ID (e.g. "23956810394").
Example of rendering chat history:
I found two conversations that match your request. Here is the first:
<tool_call>
{
  "type": "render_chat_history",
  "query": "chat_23956810394.json"
}
</tool_call>

4. If no conversations match, call \`not_found_chat_history\` as your ONLY output:
<tool_call>
{
  "type": "not_found_chat_history"
}
</tool_call>

Available tools:
- search_chat_memory (args: { query: string })
- render_chat_history (args: { query: string })
- not_found_chat_history (no args)
`

  const searchHistory: Content[] = [
    {
      role: 'system',
      parts: [{ text: systemPrompt }]
    },
    {
      role: 'user',
      parts: [{ text: message }]
    }
  ]

  let success = false
  event.sender.send('ai-search-reply-start')

  try {
    while (!success) {
      if (runAbortController.signal.aborted) {
        console.log('[AI SEARCH DEBUG MAIN] Search aborted before main loop')
        event.sender.send('ai-search-reply-error', { error: 'Cancelled by user.' })
        success = true
        return
      }

      try {
        let currentModel = modelKey
        let isFallback = false

        const config = {
          ...MODEL_CONFIGS[currentModel]
        }

        config.thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL, includeThoughts: true }

        const ai = new GoogleGenAI({ apiKey })

        let accumulatedThoughts = ''
        let accumulatedFinalResponse = ''
        let iterationCount = 0
        const MAX_ITERATIONS = 5

        while (iterationCount < MAX_ITERATIONS) {
          iterationCount++
          console.log(
            `[AI SEARCH DEBUG MAIN] Iteration ${iterationCount} starting... (Model: ${currentModel})`
          )

          if (runAbortController.signal.aborted) throw new Error('AbortError')

          let result
          try {
            result = await ai.models.generateContent({
              model: MODEL_CONFIGS[currentModel].apiModel,
              contents: normalizeContentsForGemini(searchHistory),
              config: {
                temperature: 0.3,
                thinkingConfig: config.thinkingConfig,
                abortSignal: runAbortController.signal
              }
            })
          } catch (error: any) {
            const errorMsg = error?.message || String(error)
            const isRateLimit =
              errorMsg.includes('429') ||
              errorMsg.includes('Quota') ||
              errorMsg.includes('Rate limit') ||
              errorMsg.includes('high traffic') ||
              errorMsg.includes('503')

            if (isRateLimit && !isFallback) {
              console.log('[AI SEARCH] Rate limit hit. Falling back to Prism 6 Dragon.')
              currentModel = 'prism-6-dragon' // gemma-4-26b-a4b-it
              isFallback = true
              iterationCount-- // Retry this iteration
              continue
            }
            throw error
          }

          let currentThoughts = ''
          let currentFinalResponse = ''

          const parts = result.candidates?.[0]?.content?.parts || []
          for (const part of parts) {
            if (part && typeof part === 'object' && 'thought' in part && part.thought) {
              currentThoughts += part.text || ''
            } else if (part.text) {
              currentFinalResponse += part.text
            }
          }

          // Send final response directly without self-made streaming (Search AI does not need streaming)
          event.sender.send('ai-search-reply-chunk', {
            thoughts: currentThoughts.trim(),
            finalResponse: currentFinalResponse.trim(),
            isThinking: false,
            isWritingToolCall: false
          })

          console.log(
            `[AI SEARCH DEBUG MAIN] Generation completed. Response length: ${currentFinalResponse.length}`
          )

          const fullAiResponse = currentFinalResponse
          if (fullAiResponse.trim()) {
            searchHistory.push({ role: 'model', parts: [{ text: fullAiResponse }] })
          }

          accumulatedThoughts += currentThoughts
          accumulatedFinalResponse += currentFinalResponse

          const toolMatches = extractToolCalls(fullAiResponse)

          if (toolMatches.length > 0) {
            console.log(`[AI SEARCH DEBUG MAIN] Found ${toolMatches.length} tool calls to execute.`)
            let hasRenderedChat = false
            let hasNotFoundChat = false

            const toolPromises = toolMatches.map(async (toolContent) => {
              const validation = validateToolCall(toolContent)
              const isMalformed = validation.isMalformed
              const actualName = isMalformed ? 'malformed_tool_call' : validation.name!
              const toolArgs = validation.args

              if (actualName === 'render_chat_history') {
                hasRenderedChat = true
              }
              if (actualName === 'not_found_chat_history') {
                hasNotFoundChat = true
              }

              console.log(
                `[AI SEARCH DEBUG MAIN] Executing tool: ${actualName} with args:`,
                toolArgs
              )

              event.sender.send('ai-search-tool-start', {
                name: actualName,
                args: toolArgs,
                timestamp: Date.now()
              })

              let toolResult = ''
              if (isMalformed) {
                toolResult = `Error: Malformed Tool Call: ${validation.errorMessage}`
              } else {
                try {
                  const signal = runAbortController.signal
                  if (signal?.aborted) throw new Error('AbortError')
                  toolResult = await toolFunctions[actualName](toolArgs, event, apiKey, signal)
                } catch (err) {
                  if (
                    runAbortController.signal.aborted ||
                    (err instanceof Error &&
                      (err.name === 'AbortError' || err.name === 'GoogleGenerativeAIAbortError'))
                  ) {
                    toolResult = 'Cancelled by user.'
                    event.sender.send('ai-search-tool-end', {
                      name: actualName,
                      result: toolResult
                    })
                    throw new Error('AbortError')
                  }
                  toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`
                }
              }

              console.log(
                `[AI SEARCH DEBUG MAIN] Tool ${actualName} finished. Result length: ${toolResult.length}`
              )
              event.sender.send('ai-search-tool-end', { name: actualName, result: toolResult })
              return `\n[RESULT FOR ${actualName}]:\n${toolResult}\n`
            })

            const results = await Promise.all(toolPromises)
            const allToolResults = results.join('')

            if (hasRenderedChat || hasNotFoundChat) {
              console.log(
                `[AI SEARCH DEBUG MAIN] ${hasRenderedChat ? 'render_chat_history' : 'not_found_chat_history'} executed. Finishing AI Search loop.`
              )
              event.sender.send('ai-search-reply-end', {
                thoughts: currentThoughts.trim(),
                finalResponse: currentFinalResponse.trim()
              })
              success = true
              return
            }

            if (allToolResults) {
              const systemFeedback = `[SYSTEM: TOOL RESULTS]${allToolResults}\nAnalyze these results and proceed.`
              searchHistory.push({ role: 'system', parts: [{ text: systemFeedback }] })
              continue
            }
          }

          console.log(
            `[AI SEARCH DEBUG MAIN] AI Search completed. thoughts: ${accumulatedThoughts.length} chars, response: ${accumulatedFinalResponse.length} chars`
          )
          event.sender.send('ai-search-reply-end', {
            thoughts: currentThoughts.trim(),
            finalResponse: currentFinalResponse.trim()
          })

          success = true
          return
        }

        success = true
      } catch (error) {
        if (
          runAbortController.signal.aborted ||
          (error instanceof Error &&
            (error.name === 'AbortError' || error.name === 'GoogleGenerativeAIAbortError'))
        ) {
          event.sender.send('ai-search-reply-error', { error: 'Cancelled by user.' })
          success = true
          return
        }

        console.error('AI Search Error in iteration:', error)
        event.sender.send('ai-search-reply-error', {
          error: error instanceof Error ? error.message : String(error)
        })
        success = true
      }
    }
  } catch (err) {
    console.error('Outer AI Search Error:', err)
    event.sender.send('ai-search-reply-error', {
      error: err instanceof Error ? err.message : String(err)
    })
  } finally {
    if (aiSearchAbortController === runAbortController) {
      aiSearchAbortController = null
    }
  }
}

export function cancelAiSearch(): void {
  if (aiSearchAbortController) {
    aiSearchAbortController.abort()
  }
}

/**
 * Transcribes audio using Gemini models with fallback.
 * Cleans up speech errors and formats as Markdown.
 */
export async function transcribeAudio(audioBase64: string): Promise<string> {
  console.log('[MAIN TRANSCRIPTION] Received audio data length:', audioBase64.length)
  const config = await loadConfig()
  const apiKey = config.userGeminiKey || process.env.GOOGLE_API_KEY
  if (!apiKey) {
    throw new Error('API Key missing. Please set your Gemini API key in settings.')
  }

  const ai = new GoogleGenAI({ apiKey })
  // Fallback order: Gemini 3.1 Flash-Lite -> Gemini 3 Flash Preview -> Gemini 3.5 Flash
  const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.5-flash']

  const systemPrompt = `You are an audio transcription specialist assistant in "brainstorming mode." Your task is to transcribe and clean up the user's audio.
  Remove filler words ('uh', 'hm', 'like'), stutters, and correct errors (e.g., "This is... no, that is" becomes "That is").
    - Format the output using Markdown for better readability:
    - Use bold for emphasis.
    - Use lists for complex points or items.
    - Use \`filename\` to cite files if mentioned.
    - Use line breaks for new topics.
    - Use numbering for examples or lists.
    - Among many others.
  Ensure the output is clean, professional, and perfectly captures the user's intent.
  Produce ONLY the transcribed and formatted text, without introductions or explanations.`

  let lastError: any = null

  for (const modelName of modelsToTry) {
    try {
      console.log(`[TRANSCRIPTION] Attempting with model: ${modelName}`)
      const result = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { data: audioBase64, mimeType: 'audio/webm' } },
              { text: systemPrompt }
            ]
          }
        ],
        config: {
          temperature: 0.4
        }
      })

      const text = (result.text || '').trim()
      if (text) {
        console.log(`[TRANSCRIPTION] Success with model: ${modelName}`)
        return text
      }
    } catch (err) {
      console.error(`[TRANSCRIPTION] Failed with model ${modelName}:`, err)
      lastError = err
      continue
    }
  }

  throw lastError || new Error('All transcription models failed.')
}
