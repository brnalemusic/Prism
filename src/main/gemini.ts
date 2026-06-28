import { GoogleGenAI, Content, ThinkingLevel } from '@google/genai'
import { OpenAI } from 'openai'
import * as dotenv from 'dotenv'
import { IpcMainEvent, ipcMain, BrowserWindow } from 'electron'
import { SessionMode } from '../shared/types'
import * as path from 'path'
import { Agent, setGlobalDispatcher, fetch as undiciFetch } from 'undici'
import {
  getSystemToolsPrompt,
  getSubagentSystemPrompt,
  runTerminalCommand,
  openApplication,
  setActiveCwd,
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
import { searchApps } from './appScanner'
import type { WebSearchEntry } from './systemTools'
import {
  saveChatSession as saveChatSessionRaw,
  loadChatSession,
  searchChatHistory,
  searchChatMemory,
  getMessageText
} from './history'
import { loadConfig, saveConfig, SlashWorkflow, AppConfig } from './config'
import { toolsManifest } from './toolsManifest'
import { markConnectionActive } from './connection'

// Load environment variables from .env
dotenv.config({ path: path.join(__dirname, '../../.env') })

// Keep-Alive configuration for better latency (3.5 minutes)
const networkAgent = new Agent({
  keepAliveTimeout: 210000,
  keepAliveMaxTimeout: 210000
})
setGlobalDispatcher(networkAgent)
globalThis.fetch = undiciFetch as unknown as typeof globalThis.fetch

// Dynamic model provider detection helper
export function getModelProvider(modelKey: string): 'gemini' | 'nvidia-nim' | 'openai-compatible' {
  const config = loadConfig()
  if (config.openaiModelId && modelKey === config.openaiModelId) {
    return 'openai-compatible'
  }

  const geminiModels = ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it']
  if (geminiModels.includes(modelKey)) {
    return 'gemini'
  }

  const nimModels = [
    'openai/gpt-oss-120b',
    'mistralai/mistral-large-3-675b-instruct-2512',
    'nvidia/nemotron-3-ultra-550b-a55b',
    'stepfun-ai/step-3.5-flash',
    'stepfun-ai/step-3.7-flash',
    'deepseek-ai/deepseek-v4-flash',
    'deepseek-ai/deepseek-v4-pro',
    'z-ai/glm-5.1',
    'minimaxai/minimax-m2.7',
    'minimaxai/minimax-m3'
  ]
  if (nimModels.includes(modelKey)) {
    return 'nvidia-nim'
  }

  return 'gemini'
}

export function getProviderApiKey(provider: 'gemini' | 'nvidia-nim' | 'openai-compatible'): string {
  const config = loadConfig()
  if (provider === 'gemini') {
    return config.userGeminiKey || process.env.GEMINI_API_KEY || ''
  } else if (provider === 'nvidia-nim') {
    return config.userNvidiaNimKey || process.env.NVIDIA_API_KEY || ''
  } else {
    return config.userOpenaiKey || process.env.OPENAI_API_KEY || ''
  }
}

function obfuscateTags(text: string): string {
  return text
}

// Convert history to OpenAI format
function convertHistoryToOpenAiFormat(history: Content[]) {
  const messages: any[] = []
  for (const msg of history) {
    const role = msg.role === 'model' ? 'assistant' : msg.role

    const parts = msg.parts || []
    const textParts = parts.filter((p) => p.text)
    const mediaParts = parts.filter((p) => p.inlineData)

    if (mediaParts.length > 0) {
      const contentArray: any[] = []
      if (textParts.length > 0) {
        contentArray.push({
          type: 'text',
          text: obfuscateTags(textParts.map((p) => p.text).join('\n\n'))
        })
      }
      for (const media of mediaParts) {
        if (media.inlineData) {
          contentArray.push({
            type: 'image_url',
            image_url: {
              url: `data:${media.inlineData.mimeType};base64,${media.inlineData.data}`
            }
          })
        }
      }
      messages.push({ role, content: contentArray })
    } else {
      const text = textParts.map((p) => p.text).join('\n\n')
      messages.push({ role, content: obfuscateTags(text) })
    }
  }
  return messages
}

function convertHistoryToGeminiFormat(history: Content[]) {
  let systemInstruction = ''
  const contents: Content[] = []

  for (const msg of history) {
    if (msg.role === 'system') {
      const txt = msg.parts?.map((p) => p.text || '').join('\n') || ''
      if (systemInstruction) {
        systemInstruction += '\n' + txt
      } else {
        systemInstruction = txt
      }
    } else {
      const role = msg.role === 'model' || msg.role === 'assistant' ? 'model' : 'user'
      const parts = msg.parts || []
      contents.push({
        role,
        parts: parts.map((p) => {
          if (p.text) {
            return { text: p.text }
          }
          if (p.inlineData) {
            return { inlineData: p.inlineData }
          }
          return p
        })
      })
    }
  }

  return { contents, systemInstruction }
}

interface StreamChunk {
  thought: string
  text: string
}

async function* generateAiStream(
  provider: 'gemini' | 'nvidia-nim' | 'openai-compatible',
  apiKey: string,
  modelName: string,
  history: Content[],
  signal?: AbortSignal,
  temperature = 0.7
): AsyncGenerator<StreamChunk> {
  const fs = require('fs')
  const debugFilePath = 'c:/Users/Breno/Documents/Code/Prism/raw_stream_debug.txt'
  try {
    fs.writeFileSync(debugFilePath, `--- START STREAM (model: ${modelName}, provider: ${provider}) ---\n`)
  } catch (err) {
    console.error('Failed to init stream debug file:', err)
  }

  if (provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey })
    const { contents, systemInstruction } = convertHistoryToGeminiFormat(ensureHistoryFitsLimit(history))
    
    const responseStream = await ai.models.generateContentStream({
      model: modelName,
      contents,
      config: {
        systemInstruction,
        temperature,
      }
    })

    for await (const chunk of responseStream) {
      if (signal?.aborted) throw new Error('AbortError')

      let thought = ''
      let text = ''

      const candidate = chunk.candidates?.[0]
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.thought) {
            thought += part.text || ''
          } else if (part.text) {
            text += part.text
          }
        }
      }

      if (thought || text) {
        try {
          fs.appendFileSync(debugFilePath, JSON.stringify({ thought, text }) + '\n')
        } catch (err) { /* ignore */ }
        
        yield { thought, text }
      }
    }
  } else {
    let baseURL: string
    if (provider === 'nvidia-nim') {
      baseURL = 'https://integrate.api.nvidia.com/v1'
    } else {
      const configBaseUrl = (loadConfig().openaiBaseUrl || '').replace(/\/+$/, '')
      baseURL = configBaseUrl
    }

    const openai = new OpenAI({ apiKey, baseURL })
    const messages = convertHistoryToOpenAiFormat(ensureHistoryFitsLimit(history))

    const responseStream = await openai.chat.completions.create({
      model: modelName,
      messages,
      temperature,
      stream: true
    }, { signal })

    const accumulatedToolCalls = new Map<number, {
      id?: string
      name?: string
      arguments: string
      emittedPrefix: boolean
    }>()

    for await (const chunk of responseStream) {
      if (signal?.aborted) throw new Error('AbortError')

      const choice = chunk.choices?.[0]
      if (!choice) continue

      const delta = choice.delta || {}
      const thought = (delta as any).reasoning_content || ''
      const text = delta.content || ''
      const toolCalls = delta.tool_calls || []

      for (const tc of toolCalls) {
        const idx = tc.index
        if (idx !== undefined) {
          if (!accumulatedToolCalls.has(idx)) {
            accumulatedToolCalls.set(idx, { arguments: '', emittedPrefix: false })
          }
          const acc = accumulatedToolCalls.get(idx)!
          if (tc.id) acc.id = tc.id
          if (tc.function?.name) acc.name = tc.function.name
          
          let textToYield = ''
          if (acc.name && !acc.emittedPrefix) {
            acc.emittedPrefix = true
            textToYield += `[PRISM_EXECUTE_TOOL]{"type":${JSON.stringify(acc.name)}`
          }
          
          if (tc.function?.arguments) {
            const incomingArgs = tc.function.arguments
            acc.arguments += incomingArgs
            
            if (acc.emittedPrefix) {
              let chunkToEmit = incomingArgs
              const cleanedIncoming = incomingArgs.trimStart()
              if (acc.arguments.length === incomingArgs.length && cleanedIncoming.startsWith('{')) {
                chunkToEmit = ',' + cleanedIncoming.slice(1)
              }
              textToYield += chunkToEmit
            }
          }
          
          if (textToYield) {
            try {
              fs.appendFileSync(debugFilePath, JSON.stringify({ thought: '', text: textToYield }) + '\n')
            } catch (err) { /* ignore */ }
            yield { thought: '', text: textToYield }
          }
        }
      }

      if (thought || text) {
        try {
          fs.appendFileSync(debugFilePath, JSON.stringify({ thought, text }) + '\n')
        } catch (err) { /* ignore */ }

        yield { thought, text }
      }
    }

    // Close any open tool call XML tags at the end of the stream
    for (const [, acc] of accumulatedToolCalls.entries()) {
      if (acc.emittedPrefix) {
        let closing = ''
        const trimmedArgs = acc.arguments.trim()
        if (!trimmedArgs.endsWith('}')) {
          closing += '}'
        }
        closing += '[/PRISM_EXECUTE_TOOL]\n'
        try {
          fs.appendFileSync(debugFilePath, JSON.stringify({ thought: '', text: closing }) + '\n')
        } catch (err) { /* ignore */ }
        yield { thought: '', text: closing }
      }
    }
  }
}

async function generateAiContent(
  provider: 'gemini' | 'nvidia-nim' | 'openai-compatible',
  apiKey: string,
  modelName: string,
  history: Content[],
  signal?: AbortSignal,
  temperature = 0.7
): Promise<string> {
  if (provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey })
    const { contents, systemInstruction } = convertHistoryToGeminiFormat(ensureHistoryFitsLimit(history))
    const response = await ai.models.generateContent({
      model: modelName,
      contents,
      config: {
        systemInstruction,
        temperature,
      }
    })
    return response.text || ''
  } else {
    let baseURL: string
    if (provider === 'nvidia-nim') {
      baseURL = 'https://integrate.api.nvidia.com/v1'
    } else {
      const configBaseUrl = (loadConfig().openaiBaseUrl || '').replace(/\/+$/, '')
      baseURL = configBaseUrl
    }

    const openai = new OpenAI({ apiKey, baseURL })
    const messages = convertHistoryToOpenAiFormat(ensureHistoryFitsLimit(history))

    const response = await openai.chat.completions.create({
      model: modelName,
      messages,
      temperature,
      stream: false
    }, { signal })

    return response.choices?.[0]?.message?.content || ''
  }
}
async function getOpenaiCompatibleSearchModel(config: AppConfig): Promise<string> {
  const openaiKey = config.userOpenaiKey || process.env.OPENAI_API_KEY
  if (!openaiKey || !config.openaiBaseUrl) {
    return config.openaiModelId || ''
  }
  try {
    const baseURL = config.openaiBaseUrl.replace(/\/+$/, '')
    const response = await fetch(`${baseURL}/models`, {
      headers: { 'Authorization': `Bearer ${openaiKey}` }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    const models = data.data || []

    const lightKeywords = ['flash', 'fast', 'lite', 'mini', 'quick', 'speed', 'rapid']
    const lightModels = models.filter((m: any) => {
      const idLower = (m.id || '').toLowerCase()
      return lightKeywords.some((keyword) => idLower.includes(keyword))
    })

    if (lightModels.length > 0) {
      const randomIdx = Math.floor(Math.random() * lightModels.length)
      return lightModels[randomIdx].id
    }

    if (models.length > 0) {
      const randomIdx = Math.floor(Math.random() * models.length)
      return models[randomIdx].id
    }
  } catch (error) {
    console.error('Failed to route OpenAI Compatible models, falling back to configured model:', error)
  }
  return config.openaiModelId || ''
}

// Modelo selecionado atualmente
let currentModelKey = 'gemini-3.1-flash-lite'

interface ModelConfig {
  apiModel: string
  thinkingConfig?: {
    thinkingBudget?: number
    thinkingLevel?: ThinkingLevel
    includeThoughts?: boolean
  }
}

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'gemini-3.1-flash-lite': { apiModel: 'gemini-3.1-flash-lite' },
  'gemini-3.5-flash': { apiModel: 'gemini-3.5-flash' },
  'gemma-4-26b-a4b-it': { apiModel: 'gemma-4-26b-a4b-it' },
  'gemma-4-31b-it': { apiModel: 'gemma-4-31b-it' },
  'openai/gpt-oss-120b': { apiModel: 'openai/gpt-oss-120b' },
  'mistralai/mistral-large-3-675b-instruct-2512': { apiModel: 'mistralai/mistral-large-3-675b-instruct-2512' },
  'nvidia/nemotron-3-ultra-550b-a55b': { apiModel: 'nvidia/nemotron-3-ultra-550b-a55b' },
  'stepfun-ai/step-3.5-flash': { apiModel: 'stepfun-ai/step-3.5-flash' },
  'stepfun-ai/step-3.7-flash': { apiModel: 'stepfun-ai/step-3.7-flash' },
  'deepseek-ai/deepseek-v4-flash': { apiModel: 'deepseek-ai/deepseek-v4-flash' },
  'deepseek-ai/deepseek-v4-pro': { apiModel: 'deepseek-ai/deepseek-v4-pro' },
  'z-ai/glm-5.1': { apiModel: 'z-ai/glm-5.1' },
  'minimaxai/minimax-m2.7': { apiModel: 'minimaxai/minimax-m2.7' },
  'minimaxai/minimax-m3': { apiModel: 'minimaxai/minimax-m3' }
}

const AGENT_TEMPERATURE = 0.7
const TITLE_GENERATION_TEMPERATURE = 1.4
const DEFAULT_SUBAGENT_MODEL_KEY = 'gemma-4-26b-a4b-it'
let currentSubagentModelKey = DEFAULT_SUBAGENT_MODEL_KEY

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
const OBJECT_TOOL_ARG_TAGS = new Set(['searches', 'toolConstraints'])

function parseToolCall(toolContent: string): { name: string | null; args: ToolArgs } {
  let trimmed = toolContent.trim()

  // Strip markdown code blocks if present
  if (trimmed.startsWith('```')) {
    trimmed = trimmed
      .replace(/^```[a-z]*\n/i, '')
      .replace(/\n```$/i, '')
      .trim()
  }

  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed)
      const name = (obj.type || obj.name || null) as string | null
      const args: ToolArgs = {}
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'type') continue
        if (key === 'name' && value === name) continue

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

  // Custom validation for computer_use_read_file
  if (toolName === 'computer_use_read_file') {
    const startLineNum = Number(args.startLine)
    if (isNaN(startLineNum) || !Number.isInteger(startLineNum) || startLineNum <= 0) {
      return {
        type: 'invalid_args',
        message: `Argument "startLine" for "computer_use_read_file" must be a positive integer. Passed: "${args.startLine}".`
      }
    }
    if (args.offset !== undefined && args.offset !== null && args.offset !== '') {
      const offsetNum = Number(args.offset)
      if (isNaN(offsetNum) || !Number.isInteger(offsetNum) || offsetNum <= 0) {
        return {
          type: 'invalid_args',
          message: `Argument "offset" for "computer_use_read_file" must be a positive integer. Passed: "${args.offset}".`
        }
      }
      if (offsetNum > 200) {
        return {
          type: 'invalid_args',
          message: `Argument "offset" for "computer_use_read_file" cannot exceed 200. Passed: "${args.offset}".`
        }
      }
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

  if (!trimmed.startsWith('{')) {
    let errorMsg =
      'Every tool call MUST be a valid JSON object. XML and other non-JSON formats are not supported. ' +
      'Please rewrite your tool call as a valid JSON object inside the [PRISM_EXECUTE_TOOL]...[/PRISM_EXECUTE_TOOL] tags.'

    if (trimmed.startsWith('<') && (trimmed.includes('</') || trimmed.includes('>'))) {
      errorMsg =
        'XML tool call format is deprecated and not supported. All tool calls MUST strictly be valid JSON objects inside the [PRISM_EXECUTE_TOOL]...[/PRISM_EXECUTE_TOOL] tags (e.g., {"type": "web_search", "query": "..."}). Please rewrite it.'
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
       if (key === 'type') continue
       if (key === 'name' && value === name) continue

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
    const startIdx = text.indexOf('[PRISM_EXECUTE_TOOL]', currentIndex)
    if (startIdx === -1) break

    const contentStart = startIdx + 20 // '[PRISM_EXECUTE_TOOL]'.length
    let endIdx = -1
    let searchIndex = contentStart

    while (true) {
      const nextCdata = text.indexOf('<![CDATA[', searchIndex)
      const nextEnd = text.indexOf('[/PRISM_EXECUTE_TOOL]', searchIndex)

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
      currentIndex = endIdx + 21 // '[/PRISM_EXECUTE_TOOL]'.length
    } else {
      currentIndex = startIdx + 20
    }
  }

  return toolCalls
}

function removeToolCalls(text: string): string {
  let result = text
  let currentIndex = 0
  while (true) {
    const startIdx = result.indexOf('[PRISM_EXECUTE_TOOL]', currentIndex)
    if (startIdx === -1) break

    let searchIndex = startIdx + 20
    let endIdx = -1
    while (true) {
      const nextCdata = result.indexOf('<![CDATA[', searchIndex)
      const nextEnd = result.indexOf('[/PRISM_EXECUTE_TOOL]', searchIndex)

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
      result = result.substring(0, startIdx) + result.substring(endIdx + 21)
    } else {
      currentIndex = startIdx + 20
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



async function generateSubagentResponse(
  history: Content[],
  signal?: AbortSignal
): Promise<string> {
  const config = loadConfig()
  const subModel = config.subagentModel || 'gemma-4-26b-a4b-it'
  const provider = getModelProvider(subModel)
  const apiKey = getProviderApiKey(provider)
  if (!apiKey) {
    throw new Error(`API key for subagent model provider "${provider}" is missing.`)
  }
  return generateAiContent(provider, apiKey, subModel, history, signal, AGENT_TEMPERATURE)
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
  search_installed_applications: (args) => Promise.resolve(JSON.stringify(searchApps(args.query || ''), null, 2)),
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
    computerReadFile(
      args.path || '',
      args.startLine ? parseInt(args.startLine, 10) : 1,
      args.offset ? parseInt(args.offset, 10) : undefined,
      signal
    ),
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
      if (args.newChatShortcut !== undefined && args.newChatShortcut !== '') {
        config.newChatShortcut = args.newChatShortcut
        changed.push(`newChatShortcut: "${args.newChatShortcut}"`)
      }
      if (args.dictationShortcut !== undefined && args.dictationShortcut !== '') {
        config.dictationShortcut = args.dictationShortcut
        changed.push(`dictationShortcut: "${args.dictationShortcut}"`)
      }
      if (args.webSearchShortcut !== undefined && args.webSearchShortcut !== '') {
        config.webSearchShortcut = args.webSearchShortcut
        changed.push(`webSearchShortcut: "${args.webSearchShortcut}"`)
      }
      if (args.youtubeModeShortcut !== undefined && args.youtubeModeShortcut !== '') {
        config.youtubeModeShortcut = args.youtubeModeShortcut
        changed.push(`youtubeModeShortcut: "${args.youtubeModeShortcut}"`)
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
  },
  list_workflows: async () => {
    try {
      const config = loadConfig()
      const workflows = config.workflows || []
      if (workflows.length === 0) {
        return 'No custom workflows configured.'
      }
      return JSON.stringify(workflows, null, 2)
    } catch (err) {
      return `Error listing workflows: ${err instanceof Error ? err.message : String(err)}`
    }
  },
  save_workflow: async (args) => {
    try {
      const config = loadConfig()
      const wList = config.workflows || []

      const command = (args.command || '').trim()
      const name = (args.name || '').trim()
      const description = (args.description || '').trim()
      const systemInstruction = (args.systemInstruction || '').trim()
      
      // Handle tool constraints. It can be a comma-separated string or an array if passed via OBJECT_TOOL_ARG_TAGS
      let toolConstraints: string[] = []
      if (args.toolConstraints) {
        if (Array.isArray(args.toolConstraints)) {
          toolConstraints = args.toolConstraints
        } else if (typeof args.toolConstraints === 'string') {
          try {
            // Check if it's a JSON array string
            const parsed = JSON.parse(args.toolConstraints)
            if (Array.isArray(parsed)) {
              toolConstraints = parsed.map(t => String(t).trim())
            } else {
              toolConstraints = args.toolConstraints.split(',').map(t => t.trim()).filter(Boolean)
            }
          } catch {
            toolConstraints = args.toolConstraints.split(',').map(t => t.trim()).filter(Boolean)
          }
        }
      }

      if (!command.startsWith('/')) {
        return 'Error: Workflow command must start with a slash (/) (e.g., "/coder")'
      }
      if (command.includes(' ')) {
        return 'Error: Workflow command cannot contain spaces'
      }
      if (command.length <= 1) {
        return 'Error: Workflow command is too short'
      }
      if (!name) {
        return 'Error: Workflow name is required'
      }
      if (!systemInstruction) {
        return 'Error: Workflow systemInstruction (System Instruction) is required'
      }

      // Check if editing or creating
      const id = args.id ? String(args.id).trim() : ''
      let targetId = id
      let existingIndex = -1

      if (id) {
        existingIndex = wList.findIndex(w => w.id === id)
      } else {
        // Fallback to match by command
        existingIndex = wList.findIndex(w => w.command.toLowerCase() === command.toLowerCase())
        if (existingIndex !== -1) {
          targetId = wList[existingIndex].id
        } else {
          targetId = Math.random().toString(36).substring(2, 9)
        }
      }

      // Check duplicate command for other workflows
      const isDuplicate = wList.some(
        (w) => w.command.toLowerCase() === command.toLowerCase() && w.id !== targetId
      )
      if (isDuplicate) {
        return `Error: A workflow with command "${command}" already exists.`
      }

      // Validate toolConstraints exist in manifest
      if (toolConstraints.length > 0) {
        const validToolNames = new Set(toolsManifest.map(t => t.name))
        const invalidTools = toolConstraints.filter(t => !validToolNames.has(t))
        if (invalidTools.length > 0) {
          return `Error: The following tool constraints are invalid or unrecognized: ${invalidTools.join(', ')}. Available tools are: ${Array.from(validToolNames).join(', ')}`
        }
      }

      const updatedWorkflow: SlashWorkflow = {
        id: targetId,
        command,
        name,
        description,
        systemInstruction,
        toolConstraints
      }

      let updatedWorkflows: SlashWorkflow[] = []
      if (existingIndex !== -1) {
        updatedWorkflows = [...wList]
        updatedWorkflows[existingIndex] = updatedWorkflow
      } else {
        updatedWorkflows = [...wList, updatedWorkflow]
      }

      const updatedConfig = { ...config, workflows: updatedWorkflows }
      const success = saveConfig(updatedConfig)
      if (success) {
        // Emit to main process so it updates currentConfig and notifications
        ipcMain.emit('update-config-from-tools', null, updatedConfig)
        return `Successfully saved workflow "${name}" (${command}).`
      } else {
        return 'Error: Failed to save the configuration containing the updated workflow.'
      }
    } catch (err) {
      return `Error saving workflow: ${err instanceof Error ? err.message : String(err)}`
    }
  },
  delete_workflow: async (args) => {
    try {
      const config = loadConfig()
      const wList = config.workflows || []
      const identifier = (args.command || args.id || '').trim().toLowerCase()

      if (!identifier) {
        return 'Error: Please specify "command" or "id" of the workflow to delete.'
      }

      const index = wList.findIndex(
        w => w.id.toLowerCase() === identifier || w.command.toLowerCase() === identifier
      )

      if (index === -1) {
        return `Error: No workflow found matching "${identifier}".`
      }

      const removedWorkflow = wList[index]
      const updatedWorkflows = wList.filter((_, i) => i !== index)
      const updatedConfig = { ...config, workflows: updatedWorkflows }

      const success = saveConfig(updatedConfig)
      if (success) {
        ipcMain.emit('update-config-from-tools', null, updatedConfig)
        return `Successfully deleted workflow "${removedWorkflow.name}" (${removedWorkflow.command}).`
      } else {
        return 'Error: Failed to save the configuration after deleting the workflow.'
      }
    } catch (err) {
      return `Error deleting workflow: ${err instanceof Error ? err.message : String(err)}`
    }
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
          text: 'Understood. I am Prism, your automation AI. I will use [PRISM_EXECUTE_TOOL] to interact with the system when necessary, staying focused on your initial goal.'
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
    
    currentSessionMode = session.sessionMode || 'execution'
    currentDisciplinePath = session.disciplinePath || ''

    // Set CWD for the system tools
    const os = require('os')
    if (currentSessionMode === 'discipline' && currentDisciplinePath) {
      setActiveCwd(currentDisciplinePath)
    } else if (currentSessionMode === 'execution') {
      setActiveCwd(os.homedir())
    } else {
      setActiveCwd(process.cwd())
    }

    const cleanMessages = session.messages.filter((msg) => {
      if (msg.role === 'system') {
        const text = msg.parts?.[0]?.text || ''
        return !text.includes('# Identity') && !text.includes('Understood. I am Prism')
      }
      return true
    })

    // Prepend system messages to the history loaded from disk
    chatHistory = [
      { role: 'system', parts: [{ text: getSystemToolsPrompt(currentModelKey, 'main', undefined, currentSessionMode, currentDisciplinePath) }] },
      {
        role: 'system',
        parts: [
          {
            text: 'Understood. I am Prism, your automation AI. I will use [PRISM_EXECUTE_TOOL] to interact with the system when necessary, staying focused on your initial goal.'
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
  currentSubagentModelKey = modelKey
  return true
}

export function getChatModel(id: string): string | undefined {
  const session = loadChatSession(id)
  return session?.model
}

let currentSessionMode: SessionMode = 'execution'
let currentDisciplinePath: string = ''

export function setSessionMode(mode: SessionMode, disciplinePath?: string): void {
  currentSessionMode = mode
  if (mode === 'discipline') {
    if (disciplinePath !== undefined) {
      currentDisciplinePath = disciplinePath
    }
  } else {
    currentDisciplinePath = ''
  }
}

export function getSessionMode(): { mode: SessionMode; disciplinePath?: string } {
  return {
    mode: currentSessionMode,
    disciplinePath: currentDisciplinePath
  }
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

async function generateChatTitle(provider: 'gemini' | 'nvidia-nim' | 'openai-compatible', apiKey: string, firstMessage: string): Promise<string> {
  try {
    const searchModel = provider === 'nvidia-nim' ? 'openai/gpt-oss-120b' : provider === 'openai-compatible' ? (loadConfig().openaiModelId || '') : 'gemini-3.1-flash-lite'

    const prompt = `You are a conversation titler. Analyze the user's first message below and generate an extremely short (maximum 5 words) title for this conversation.
IMPORTANT: The title MUST be written in the EXACT same language as the user's message. DEFINITELY match the user's language (e.g., if the user writes in Portuguese, the title must be in Portuguese; if in Spanish, in Spanish; if in English, in English, etc.).
Respond ONLY with the title. Do not include any quotes, markdown headers, punctuation, or preamble.

User message: "${firstMessage}"`

    const history: Content[] = [
      { role: 'user', parts: [{ text: prompt }] }
    ]

    const result = await generateAiContent(provider, apiKey, searchModel, history, undefined, TITLE_GENERATION_TEMPERATURE)
    const fullTitle = (result || '').trim()
    return fullTitle || 'New Conversation'
  } catch (error) {
    console.error('Failed to generate chat title:', error)
    return 'New Conversation'
  }
}

function saveChatSession(id: string, messages: Content[], title?: string): boolean {
  return saveChatSessionRaw(id, messages, title, currentSessionMode, currentDisciplinePath, currentModelKey)
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
        sessionMode?: SessionMode
        disciplinePath?: string
      }
): Promise<void> {
  const message = typeof data === 'string' ? data : data.message
  const chatId = typeof data === 'object' && data.chatId ? data.chatId : currentSessionId
  const screenshot = typeof data === 'object' ? data.screenshot : undefined
  const quote = typeof data === 'object' ? data.quote : undefined
  const attachedFile = typeof data === 'object' ? data.attachedFile : undefined
  const appMode = typeof data === 'object' ? data.appMode : undefined

  let sessionMode = typeof data === 'object' ? data.sessionMode : undefined
  let disciplinePath = typeof data === 'object' ? data.disciplinePath : undefined

  const provider = getModelProvider(currentModelKey)
  const apiKey = getProviderApiKey(provider)

  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_api_key_here') {
    // If there is no key, we send a specific error message so that the front-end
    // can trigger the API Key modal if necessary.
    event.sender.send('chat-reply-error', { error: 'API_KEY_ERROR:401:API Key Missing', chatId })
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
      if (!sessionMode) sessionMode = session.sessionMode
      if (!disciplinePath) disciplinePath = session.disciplinePath
    }

    if (sessionMode) {
      currentSessionMode = sessionMode
    }
    if (currentSessionMode === 'discipline') {
      if (disciplinePath !== undefined) {
        currentDisciplinePath = disciplinePath
      }
    } else {
      currentDisciplinePath = ''
    }

    // Set CWD for the system tools
    const os = require('os')
    if (currentSessionMode === 'discipline' && currentDisciplinePath) {
      setActiveCwd(currentDisciplinePath)
    } else if (currentSessionMode === 'execution') {
      setActiveCwd(os.homedir())
    } else {
      setActiveCwd(process.cwd())
    }

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
          parts: [{ text: getSystemToolsPrompt(currentModelKey, 'main', undefined, currentSessionMode, currentDisciplinePath) }]
        },
        {
          role: 'system',
          parts: [
            {
              text: 'Understood. I am Prism, your automation AI. I will use [PRISM_EXECUTE_TOOL] to interact with the system when necessary, staying focused on your initial goal.'
            }
          ]
        },
        ...cleanMessages
      ]
    } else {
      runHistory = [
        {
          role: 'system',
          parts: [{ text: getSystemToolsPrompt(currentModelKey, 'main', undefined, currentSessionMode, currentDisciplinePath) }]
        },
        {
          role: 'system',
          parts: [
            {
              text: 'Understood. I am Prism, your automation AI. I will use [PRISM_EXECUTE_TOOL] to interact with the system when necessary, staying focused on your initial goal.'
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
        const httpMatch = errorMessage.match(/(\d{3})\s+(.*)/)
        const code = httpMatch ? httpMatch[1] : '500'
        const title = httpMatch ? httpMatch[2].trim() : 'Internal Server Error'
        event.sender.send('chat-reply-error', {
          error: `API_KEY_ERROR:${code}:${title}`,
          chatId
        })
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

  const basePrompt = getSystemToolsPrompt(
    currentModelKey,
    'main',
    matchedWorkflow?.toolConstraints,
    currentSessionMode,
    currentDisciplinePath
  )
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
    saveChatSession(chatId, runHistory, '')
    event.sender.send('chat-session-created', { id: chatId })

    generateChatTitle(provider, apiKey, message).then((finalTitle) => {
      event.sender.send('chat-title-received', { id: chatId, title: finalTitle })
      saveChatSession(chatId, runHistory, finalTitle)
    })
  } else {
    // Regular save for existing sessions
    saveChatSession(chatId, runHistory)
  }

  let success = false

  // Notify the start of the response ONLY ONCE
  event.sender.send('chat-reply-start', { chatId })

  // The user is actively chatting — reset the 2h keep-alive window so the
  // connection to Gemini stays warm and subsequent messages have low latency.
  markConnectionActive()

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

      try {
        const modelConfig = MODEL_CONFIGS[currentModelKey] || { apiModel: currentModelKey }
        const currentProvider = getModelProvider(currentModelKey)
        const currentApiKey = getProviderApiKey(currentProvider)

        let accumulatedThoughts = ''
        let accumulatedFinalResponse = ''
        let iterationCount = 0
        const MAX_ITERATIONS = 10

        while (iterationCount < MAX_ITERATIONS) {
          iterationCount++

          if (runAbortController.signal.aborted) throw new Error('AbortError')

          console.log(
            `[Main Chat] Starting generateAiStream for model: ${modelConfig.apiModel}, provider: ${currentProvider}`
          )

          let currentThoughts = ''
          let currentFinalResponse = ''
          let chunkCount = 0

          const stream = generateAiStream(
            currentProvider,
            currentApiKey,
            modelConfig.apiModel,
            runHistory,
            runAbortController.signal,
            AGENT_TEMPERATURE
          )

          let lastIpcTime = 0
          const IPC_THROTTLE_MS = 50

          for await (const chunk of stream) {
            if (runAbortController.signal.aborted) throw new Error('AbortError')
            chunkCount++

            if (chunk.thought) {
              currentThoughts += chunk.thought
            }
            if (chunk.text) {
              currentFinalResponse += chunk.text
            }

            const now = Date.now()
            const shouldSendIpc = now - lastIpcTime >= IPC_THROTTLE_MS || chunkCount === 1

            if (shouldSendIpc) {
              lastIpcTime = now

              const countOccurrences = (str: string, subStr: string): number =>
                str.split(subStr).length - 1

              const isWritingToolCall =
                countOccurrences(currentFinalResponse, '[PRISM_EXECUTE_TOOL]') >
                  countOccurrences(currentFinalResponse, '[/PRISM_EXECUTE_TOOL]') ||
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
                  const lastOpenIdx = currentFinalResponse.lastIndexOf('[PRISM_EXECUTE_TOOL]')
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
                isThinking,
                isWritingToolCall,
                toolType,
                chatId: chatId
              })
            }
          }

          // Send final chunk to ensure the last generated tokens are fully delivered
          const finalCountOccurrences = (str: string, subStr: string): number =>
            str.split(subStr).length - 1

          const isWritingToolCallFinal =
            finalCountOccurrences(currentFinalResponse, '[PRISM_EXECUTE_TOOL]') >
              finalCountOccurrences(currentFinalResponse, '[/PRISM_EXECUTE_TOOL]') ||
            finalCountOccurrences(currentFinalResponse, '<mini_app>') >
              finalCountOccurrences(currentFinalResponse, '</mini_app>')

          let toolTypeFinal: 'task' | 'search' | 'mini-app' | undefined = undefined
          if (isWritingToolCallFinal) {
            const openMiniApp =
              finalCountOccurrences(currentFinalResponse, '<mini_app>') >
              finalCountOccurrences(currentFinalResponse, '</mini_app>')
            if (openMiniApp) {
              toolTypeFinal = 'mini-app'
            } else {
              const lastOpenIdx = currentFinalResponse.lastIndexOf('[PRISM_EXECUTE_TOOL]')
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
              toolTypeFinal = isSearch ? 'search' : 'task'
            }
          }

          const finalResponseString = accumulatedFinalResponse + currentFinalResponse
          const finalThoughtsString = accumulatedThoughts + currentThoughts
          const isThinkingFinal = currentThoughts.length > 0 && currentFinalResponse.length === 0

          console.log(
            `[Main Chat] Sending final chat-reply-chunk: thoughts length: ${finalThoughtsString.trim().length}, response length: ${finalResponseString.trim().length}`
          )
          event.sender.send('chat-reply-chunk', {
            thoughts: finalThoughtsString.trim(),
            finalResponse: finalResponseString.trim(),
            rawText: finalThoughtsString + finalResponseString,
            isThinking: isThinkingFinal,
            isWritingToolCall: isWritingToolCallFinal,
            toolType: toolTypeFinal,
            chatId: chatId
          })

          console.log(`[Main Chat] Stream generation completed. Total chunks: ${chunkCount}`)
          // Add the AI response (whether text or Tool Call) to history
          const fullAiResponse = currentFinalResponse
          if (fullAiResponse.trim()) {
            runHistory.push({ role: 'model', parts: [{ text: fullAiResponse }] })
            saveChatSession(chatId, runHistory)
          }

          const needsThoughtSeparator = accumulatedThoughts.length > 0 && currentThoughts.length > 0
          accumulatedThoughts += needsThoughtSeparator ? '\n\n' + currentThoughts : currentThoughts
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

              if (currentSessionMode === 'conversation') {
                isMalformed = true
                validation.isMalformed = true
                validation.errorType = 'invalid_tool'
                validation.errorMessage = 'Tools are disabled in Conversation Mode.'
                actualName = 'malformed_tool_call'
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
                if (currentSessionMode === 'conversation') {
                  toolResult = `Error: Tool execution is disabled in Conversation Mode. You cannot run tools (attempted: "${validation.name || 'unknown'}"). Please answer the user's question without calling any tools.`
                } else {
                  toolResult = `Error: AI stopped due to a malformed Tool Call.
Detailed Error: ${validation.errorMessage}

Your generated segment was:
[PRISM_EXECUTE_TOOL]
${toolContent.trim()}
[/PRISM_EXECUTE_TOOL]

Every tool call MUST strictly conform to the expected format. Please review the error above, correct the tool call format, and try again.`
                }
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

        const errorMessage = error instanceof Error ? error.message : String(error)
        const httpMatch = errorMessage.match(/(\d{3})\s+(.*)/)
        const code = httpMatch ? httpMatch[1] : '500'
        const title = httpMatch ? httpMatch[2].trim() : 'Internal Server Error'
        event.sender.send('chat-reply-error', {
          error: `API_KEY_ERROR:${code}:${title}`,
          chatId
        })
        success = true
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
  data: string | { message: string; screenshot?: string; appMode?: string }
): Promise<void> {
  const message = typeof data === 'string' ? data : data.message
  const thinkMode = false
  const screenshot = typeof data === 'object' ? data.screenshot : undefined
  const appMode = typeof data === 'object' ? data.appMode : undefined

  const modelProvider = getModelProvider(currentModelKey)
  const apiKey = getProviderApiKey(modelProvider)
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

  let launcherModelKey = 'stepfun-ai/step-3.5-flash'

  const launcherConfig = loadConfig()
  if (modelProvider === 'gemini' || (!launcherConfig.userNvidiaNimKey && !process.env.NVIDIA_API_KEY)) {
    if (getModelProvider(currentModelKey) === 'gemini' || (!launcherConfig.userNvidiaNimKey && !process.env.NVIDIA_API_KEY && (launcherConfig.userGeminiKey || process.env.GEMINI_API_KEY))) {
      launcherModelKey = 'gemini-3.1-flash-lite'
    }
  }

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

  // Launcher chat is also a user-initiated message — keep the connection warm.
  markConnectionActive()

  try {
    while (!success) {
      if (runAbortController.signal.aborted) {
        event.sender.send('launcher-reply-error', { error: 'Cancelled by user.' })
        success = true
        return
      }

      try {
        const launcherProvider = getModelProvider(launcherModelKey)
        const launcherApiKey = getProviderApiKey(launcherProvider)

        let accumulatedThoughts = ''
        let accumulatedFinalResponse = ''
        let iterationCount = 0
        const MAX_ITERATIONS = 10

        while (iterationCount < MAX_ITERATIONS) {
          iterationCount++

          if (runAbortController.signal.aborted) throw new Error('AbortError')

          const responseStream = generateAiStream(
            launcherProvider,
            launcherApiKey,
            launcherModelKey,
            launcherChatHistory,
            runAbortController.signal,
            0.7
          )

          let currentThoughts = ''
          let currentFinalResponse = ''
          let lastIpcTime = 0
          const IPC_THROTTLE_MS = 50

          for await (const chunk of responseStream) {
            if (runAbortController.signal.aborted) throw new Error('AbortError')

            if (chunk.thought) {
              currentThoughts += chunk.thought
            }
            if (chunk.text) {
              currentFinalResponse += chunk.text
            }

            const now = Date.now()
            const shouldSendIpc = now - lastIpcTime >= IPC_THROTTLE_MS

            if (shouldSendIpc) {
              lastIpcTime = now

              const countOccurrences = (str: string, subStr: string): number =>
                str.split(subStr).length - 1

              const isWritingToolCall =
                countOccurrences(currentFinalResponse, '[PRISM_EXECUTE_TOOL]') >
                  countOccurrences(currentFinalResponse, '[/PRISM_EXECUTE_TOOL]') ||
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
                  const lastOpenIdx = currentFinalResponse.lastIndexOf('[PRISM_EXECUTE_TOOL]')
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
          }

          // Send final chunk to ensure the last generated tokens are fully delivered
          const finalCountOccurrences = (str: string, subStr: string): number =>
            str.split(subStr).length - 1

          const isWritingToolCallFinal =
            finalCountOccurrences(currentFinalResponse, '[PRISM_EXECUTE_TOOL]') >
              finalCountOccurrences(currentFinalResponse, '[/PRISM_EXECUTE_TOOL]') ||
            finalCountOccurrences(currentFinalResponse, '<mini_app>') >
              finalCountOccurrences(currentFinalResponse, '</mini_app>')

          let toolTypeFinal: 'task' | 'search' | 'mini-app' | undefined = undefined
          if (isWritingToolCallFinal) {
            const openMiniApp =
              finalCountOccurrences(currentFinalResponse, '<mini_app>') >
              finalCountOccurrences(currentFinalResponse, '</mini_app>')
            if (openMiniApp) {
              toolTypeFinal = 'mini-app'
            } else {
              const lastOpenIdx = currentFinalResponse.lastIndexOf('[PRISM_EXECUTE_TOOL]')
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
              toolTypeFinal = isSearch ? 'search' : 'task'
            }
          }

          const finalResponseString = accumulatedFinalResponse + currentFinalResponse
          const finalThoughtsString = accumulatedThoughts + currentThoughts
          const isThinkingFinal = currentThoughts.length > 0 && currentFinalResponse.length === 0

          event.sender.send('launcher-reply-chunk', {
            thoughts: finalThoughtsString.trim(),
            finalResponse: finalResponseString.trim(),
            isThinking: isThinkingFinal,
            isWritingToolCall: isWritingToolCallFinal,
            toolType: toolTypeFinal
          })

          const fullAiResponse = currentFinalResponse
          if (fullAiResponse.trim()) {
            launcherChatHistory.push({ role: 'model', parts: [{ text: fullAiResponse }] })
          }

          const needsThoughtSeparator = accumulatedThoughts.length > 0 && currentThoughts.length > 0
          accumulatedThoughts += needsThoughtSeparator ? '\n\n' + currentThoughts : currentThoughts
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
              event.sender.send('launcher-reply-end', {
                thoughts: accumulatedThoughts.trim(),
                finalResponse: accumulatedFinalResponse.trim() || 'Opening the main application with instructions...'
              })
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

  const config = loadConfig()
  let provider = getModelProvider(currentModelKey)
  let searchModel = 'gemini-3.1-flash-lite'
  let searchApiKey = getProviderApiKey(provider)

  if (!searchApiKey) {
    if (config.userNvidiaNimKey || process.env.NVIDIA_API_KEY) {
      provider = 'nvidia-nim'
      searchModel = 'openai/gpt-oss-120b'
      searchApiKey = config.userNvidiaNimKey || process.env.NVIDIA_API_KEY || ''
    } else if (config.userGeminiKey || process.env.GEMINI_API_KEY) {
      provider = 'gemini'
      searchModel = 'gemini-3.1-flash-lite'
      searchApiKey = config.userGeminiKey || process.env.GEMINI_API_KEY || ''
    } else if (config.userOpenaiKey || process.env.OPENAI_API_KEY) {
      provider = 'openai-compatible'
      searchApiKey = config.userOpenaiKey || process.env.OPENAI_API_KEY || ''
    }
  }

  if (provider === 'openai-compatible' && searchApiKey) {
    searchModel = await getOpenaiCompatibleSearchModel(config)
  } else if (provider === 'nvidia-nim') {
    searchModel = 'openai/gpt-oss-120b'
  }

  if (!searchApiKey || searchApiKey.trim() === '' || searchApiKey === 'your_api_key_here') {
    event.sender.send('ai-search-reply-error', { error: 'API_KEY_MISSING' })
    return
  }

  // Cancel any active AI search run
  if (aiSearchAbortController) {
    aiSearchAbortController.abort()
  }

  const runAbortController = new AbortController()
  aiSearchAbortController = runAbortController

  console.log(
    `[AI SEARCH DEBUG MAIN] Starting AI Search. provider: ${provider}, model: ${searchModel}, message: "${message}"`
  )
  const systemPrompt = `You are the Chat Search AI for Prism. Find chats matching the user's description.
Use the tool "search_chat_memory" to search past conversations.

CRITICAL RULES:
- You must call tools ONLY by outputting [PRISM_EXECUTE_TOOL]JSON[/PRISM_EXECUTE_TOOL] in your response. No native function calling.
- Do NOT output any JSON block outside of the [PRISM_EXECUTE_TOOL]...[/PRISM_EXECUTE_TOOL] tags.
- Output ONLY the tool call block (no conversational text) when searching or if nothing is found.
- If you find matching chats, call "render_chat_history" (query must be the filename e.g. "chat_123.json" or session ID). You can then output friendly text along with it.
- If no chats match, output "not_found_chat_history" as your ONLY response.

Example search:
[PRISM_EXECUTE_TOOL]{"type": "search_chat_memory", "query": "keywords"}[/PRISM_EXECUTE_TOOL]

Example render:
I found the conversation:
[PRISM_EXECUTE_TOOL]{"type": "render_chat_history", "query": "chat_123.json"}[/PRISM_EXECUTE_TOOL]

Example not found:
[PRISM_EXECUTE_TOOL]{"type": "not_found_chat_history"}[/PRISM_EXECUTE_TOOL]

Available tools:
- search_chat_memory (query: string)
- render_chat_history (query: string)
- not_found_chat_history (no args)`

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
        let accumulatedThoughts = ''
        let accumulatedFinalResponse = ''
        let iterationCount = 0
        const MAX_ITERATIONS = 5

        while (iterationCount < MAX_ITERATIONS) {
          iterationCount++
          console.log(
            `[AI SEARCH DEBUG MAIN] Iteration ${iterationCount} starting... (Model: ${searchModel})`
          )

          if (runAbortController.signal.aborted) throw new Error('AbortError')

          let responseText = ''
          try {
            responseText = await generateAiContent(
              provider,
              searchApiKey,
              searchModel,
              searchHistory,
              runAbortController.signal,
              0.3
            )
          } catch (error: any) {
            throw error
          }

          let currentThoughts = ''
          let currentFinalResponse = responseText

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
                  toolResult = await toolFunctions[actualName](toolArgs, event, searchApiKey, signal)
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
  const provider = getModelProvider(currentModelKey)

  if (provider === 'openai-compatible') {
    throw new Error('Voice dictation is not supported with OpenAI Compatible provider.')
  }

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

  if (provider === 'nvidia-nim') {
    const apiKey = config.userNvidiaNimKey || process.env.NVIDIA_API_KEY
    if (!apiKey) {
      throw new Error('API Key missing. Please set your NVIDIA NIM API key in settings.')
    }
    const openai = new OpenAI({
      apiKey,
      baseURL: 'https://integrate.api.nvidia.com/v1',
      dangerouslyAllowBrowser: true
    })
    const buffer = Buffer.from(audioBase64, 'base64')
    const file = await OpenAI.toFile(buffer, 'audio.webm', { type: 'audio/webm' })
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'openai/whisper-large-v3'
    })
    return transcription.text
  } else {
    const apiKey = config.userGeminiKey || process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error('API Key missing. Please set your Gemini API key in settings.')
    }
    const ai = new GoogleGenAI({ apiKey })
    const result = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
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
    return (result.text || '').trim()
  }
}
