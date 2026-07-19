import { GoogleGenAI, Content, ThinkingLevel } from '@google/genai'
import { OpenAI } from 'openai'
import * as dotenv from 'dotenv'
import { IpcMainEvent, ipcMain, BrowserWindow } from 'electron'
import { SessionMode, TodoState } from '../shared/types'
import * as path from 'path'
import { Agent, setGlobalDispatcher, fetch as undiciFetch, FormData as undiciFormData } from 'undici'
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
import {
  saveChatSession as saveChatSessionRaw,
  loadChatSession,
  searchChatHistory,
  searchChatMemory,
  getMessageText,
  updateChatSessionTitle
} from './history'
import { loadConfig, saveConfig, SlashWorkflow, AppConfig } from './config'
import { toolsManifest } from './toolsManifest'
import { markConnectionActive } from './connection'
import {
  normalizeToolCalls,
  completeIncompleteToolCalls,
  parseToolCallsFromText,
  parseToolResultsFromText,
  extractToolCalls,
  removeToolCalls,
  parseToolCall,
  validateToolCall,
  validateSchemaArgs,
  findClosestTool,
  type ToolArgs,
  RAW_TOOL_ARG_TAGS,
  OBJECT_TOOL_ARG_TAGS
} from './toolUtils'

// Load environment variables from .env
dotenv.config({ path: path.join(__dirname, '../../.env') })


// Capture the original fetch (native Electron fetch) before overriding it,
// so that clients like OpenAI can use it to respect system proxy and avoid keep-alive issues.
const originalFetch = globalThis.fetch

// Keep-Alive configuration for better latency (3.5 minutes)
const networkAgent = new Agent({
  keepAliveTimeout: 210000,
  keepAliveMaxTimeout: 210000
})
setGlobalDispatcher(networkAgent)
globalThis.fetch = undiciFetch as unknown as typeof globalThis.fetch
globalThis.FormData = undiciFormData as unknown as typeof globalThis.FormData
function joinResponseSegments(accumulated: string, current: string): string {
  if (!accumulated) return current
  if (!current) return accumulated

  const endsWithOneNewline = accumulated.endsWith('\n')
  const endsWithTwoNewlines = accumulated.endsWith('\n\n')
  const startsWithOneNewline = current.startsWith('\n')
  const startsWithTwoNewlines = current.startsWith('\n\n')

  if (endsWithTwoNewlines || startsWithTwoNewlines) {
    return accumulated + current
  }
  if (endsWithOneNewline && startsWithOneNewline) {
    return accumulated + current
  }
  if (endsWithOneNewline || startsWithOneNewline) {
    return accumulated + '\n' + current
  }
  return accumulated + '\n\n' + current
}

// Dynamic model provider detection helper
export function getModelProvider(modelKey: string): 'gemini' | 'nvidia-nim' | 'openai-compatible' {
  const config = loadConfig()
  if (config.openaiModelId && modelKey === config.openaiModelId) {
    return 'openai-compatible'
  }

  const geminiModels = ['gemini-3.1-flash-lite', 'gemini-3-flash', 'gemini-3.1-pro', 'gemini-3.5-flash']
  if (geminiModels.includes(modelKey)) {
    return 'gemini'
  }

  const nimModels = [
    'deepseek-ai/deepseek-v4-flash',
    'deepseek-ai/deepseek-v4-pro',
    'minimaxai/minimax-m3',
    'openai/gpt-oss-120b',
    'stepfun-ai/step-3.5-flash',
    'stepfun-ai/step-3.7-flash',
    'z-ai/glm-5.2'
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

function getGeminiTools(
  target: 'main' | 'subagent' | 'both' | 'launcher' | 'title',
  allowedTools?: string[]
) {
  if (target === 'title') return undefined

  const filtered = toolsManifest.filter((t) => {
    if (allowedTools && allowedTools.length > 0) {
      if (!allowedTools.includes(t.name)) return false
    }
    if (target === 'launcher') {
      return (
        t.name === 'web_search' ||
        t.name === 'saw_link_from_url' ||
        t.name === 'open_main_app' ||
        t.name === 'open_browser_link' ||
        t.name === 'open_application'
      )
    }
    return !t.target || t.target === 'both' || t.target === target
  })

  if (filtered.length === 0) return undefined

  const functionDeclarations = filtered.map((t) => {
    const properties: Record<string, any> = {}
    const required: string[] = []

    if (t.name === 'web_search') {
      properties['searches'] = {
        type: 'ARRAY',
        description: t.parameters['searches'] || 'Array of search objects.',
        items: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Concise action phrase shown to user.' },
            query: { type: 'STRING', description: 'Actual search keywords.' }
          },
          required: ['title', 'query']
        }
      }
      required.push('searches')
    } else if (t.name === 'to_ask') {
      properties['session_id'] = { type: 'STRING', description: 'Unique UUID.' }
      properties['questions'] = {
        type: 'ARRAY',
        description: 'JSON array of question objects.',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING' },
            type: { type: 'STRING' },
            title: { type: 'STRING' },
            prompt: { type: 'STRING' }
          },
          required: ['id', 'type', 'title']
        }
      }
      required.push('session_id', 'questions')
    } else if (t.name === 'run_subagents') {
      properties['quantity'] = { type: 'STRING', description: 'Number of agents.' }
      required.push('quantity')
      for (let i = 1; i <= 20; i++) {
        properties[`prompt:${i}`] = { type: 'STRING', description: `Prompt for agent ${i}.` }
      }
    } else if (t.name === 'computer_use_read_file') {
      properties['path'] = {
        type: 'STRING',
        description: 'Absolute file path.'
      }
      properties['startLine'] = {
        type: 'INTEGER',
        description: 'Starting line number (1-based index) to read from.'
      }
      properties['limit'] = {
        type: 'INTEGER',
        description:
          'Number of lines to read starting from startLine. Defaults to 200. Max 200.'
      }
      required.push('path', 'startLine')
    } else if (t.name === 'computer_edit_file') {
      for (const [paramName, paramDesc] of Object.entries(t.parameters)) {
        if (paramName.includes(':')) continue
        const isOptional = paramDesc.toLowerCase().includes('optional')
        const isNumeric =
          paramName === 'startLine' || paramName === 'endLine'
        properties[paramName] = {
          type: isNumeric ? 'INTEGER' : 'STRING',
          description: paramDesc
        }
        if (!isOptional) {
          required.push(paramName)
        }
      }
    } else {
      for (const [paramName, paramDesc] of Object.entries(t.parameters)) {
        if (paramName.includes(':')) continue
        const isOptional = paramDesc.toLowerCase().includes('optional')
        properties[paramName] = {
          type: 'STRING',
          description: paramDesc
        }
        if (!isOptional) {
          required.push(paramName)
        }
      }
    }

    return {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'OBJECT',
        properties,
        ...(required.length > 0 ? { required } : {})
      }
    }
  })

  return [{ functionDeclarations }] as any
}

function getOpenAiTools(
  target: 'main' | 'subagent' | 'both' | 'launcher' | 'title',
  allowedTools?: string[]
) {
  if (target === 'title') return undefined

  const filtered = toolsManifest.filter((t) => {
    if (allowedTools && allowedTools.length > 0) {
      if (!allowedTools.includes(t.name)) return false
    }
    if (target === 'launcher') {
      return (
        t.name === 'web_search' ||
        t.name === 'saw_link_from_url' ||
        t.name === 'open_main_app' ||
        t.name === 'open_browser_link' ||
        t.name === 'open_application'
      )
    }
    return !t.target || t.target === 'both' || t.target === target
  })

  if (filtered.length === 0) return undefined

  return filtered.map((t) => {
    const properties: Record<string, any> = {}
    const required: string[] = []

    if (t.name === 'web_search') {
      properties['searches'] = {
        type: 'array',
        description: t.parameters['searches'] || 'Array of search objects.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Concise action phrase shown to user.' },
            query: { type: 'string', description: 'Actual search keywords.' }
          },
          required: ['title', 'query']
        }
      }
      required.push('searches')
    } else if (t.name === 'to_ask') {
      properties['session_id'] = { type: 'string', description: 'Unique UUID.' }
      properties['questions'] = {
        type: 'array',
        description: 'JSON array of question objects.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            title: { type: 'string' },
            prompt: { type: 'string' }
          },
          required: ['id', 'type', 'title']
        }
      }
      required.push('session_id', 'questions')
    } else if (t.name === 'run_subagents') {
      properties['quantity'] = { type: 'string', description: 'Number of agents.' }
      required.push('quantity')
      for (let i = 1; i <= 20; i++) {
        properties[`prompt:${i}`] = { type: 'string', description: `Prompt for agent ${i}.` }
      }
    } else {
      for (const [paramName, paramDesc] of Object.entries(t.parameters)) {
        if (paramName.includes(':')) continue
        const isOptional = paramDesc.toLowerCase().includes('optional')
        properties[paramName] = {
          type: 'string',
          description: paramDesc
        }
        if (!isOptional) {
          required.push(paramName)
        }
      }
    }

    return {
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties,
          ...(required.length > 0 ? { required } : {})
        }
      }
    }
  }) as any
}

// Convert history to OpenAI format
function convertHistoryToOpenAiFormat(history: Content[], provider?: 'gemini' | 'nvidia-nim' | 'openai-compatible') {
  const messages: any[] = []
  let seenNonSystem = false
  const outstandingCalls = new Map<string, string[]>()

  for (const msg of history) {
    let role = msg.role === 'model' || msg.role === 'assistant' ? 'assistant' : msg.role

    if (role === 'system') {
      const txt = msg.parts?.map((p) => p.text || '').join('\n') || ''
      if (txt.includes('[RESULT FOR ')) {
        const results = parseToolResultsFromText(txt)
        if (results.length > 0) {
          for (const r of results) {
            const list = outstandingCalls.get(r.name) || []
            const callId = list.shift() || `call_${r.name}_${Date.now()}`
            messages.push({
              role: 'tool',
              tool_call_id: callId,
              content: r.result
            })
          }
          continue
        }
      }
      if (seenNonSystem && provider === 'nvidia-nim') {
        role = 'user'
      }
    } else if (role !== 'tool') {
      seenNonSystem = true
    }

    const parts = msg.parts || []
    const textParts = parts.filter((p) => p.text)
    const mediaParts = parts.filter((p) => p.inlineData)
    const functionResponseParts = parts.filter((p: any) => p.functionResponse)
    const functionCallParts = parts.filter((p: any) => p.functionCall)

    // Handle user turns with native functionResponse parts (from Gemini native tool calls)
    if (role === 'user' && functionResponseParts.length > 0) {
      for (const frp of functionResponseParts) {
        const fr = (frp as any).functionResponse
        const list = outstandingCalls.get(fr.name) || []
        const callId = list.shift() || `call_${fr.name}_${Date.now()}`
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: typeof fr.response?.result === 'string' ? fr.response.result : JSON.stringify(fr.response)
        })
      }
      continue
    }

    if (role === 'assistant') {
      // Handle native functionCall parts (from Gemini native tool calls)
      if (functionCallParts.length > 0) {
        const cleanText = textParts.map((p) => p.text).join('\n\n').trim()
        const formattedToolCalls = functionCallParts.map((fcp: any, index: number) => {
          const fc = fcp.functionCall
          const callId = `call_${fc.name}_${Date.now()}_${index}`
          if (!outstandingCalls.has(fc.name)) {
            outstandingCalls.set(fc.name, [])
          }
          outstandingCalls.get(fc.name)!.push(callId)
          return {
            id: callId,
            type: 'function',
            function: {
              name: fc.name,
              arguments: JSON.stringify(fc.args || {})
            }
          }
        })
        messages.push({
          role: 'assistant',
          content: cleanText || null,
          tool_calls: formattedToolCalls
        })
        continue
      }

      // Legacy: handle text-based tool calls
      const fullText = textParts.map((p) => p.text).join('\n\n')
      const toolCalls = parseToolCallsFromText(fullText)
      
      if (toolCalls.length > 0) {
        const cleanText = removeToolCalls(fullText).trim()
        const formattedToolCalls = toolCalls.map((tc, index) => {
          const callId = `call_${tc.type}_${Date.now()}_${index}`
          if (!outstandingCalls.has(tc.type)) {
            outstandingCalls.set(tc.type, [])
          }
          outstandingCalls.get(tc.type)!.push(callId)

          const { type, ...args } = tc
          return {
            id: callId,
            type: 'function',
            function: {
              name: type,
              arguments: JSON.stringify(args)
            }
          }
        })

        messages.push({
          role: 'assistant',
          content: cleanText || null,
          tool_calls: formattedToolCalls
        })
        continue
      }
    }

    if (mediaParts.length > 0) {
      const contentArray: any[] = []
      if (textParts.length > 0) {
        contentArray.push({
          type: 'text',
          text: textParts.map((p) => p.text).join('\n\n')
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
      messages.push({ role, content: text })
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
      if (txt.includes('[RESULT FOR ')) {
        const results = parseToolResultsFromText(txt)
        if (results.length > 0) {
          contents.push({
            role: 'user',
            parts: results.map((r) => ({
              functionResponse: {
                name: r.name,
                response: { result: r.result }
              }
            }))
          })
          continue
        }
      }
      if (systemInstruction) {
        systemInstruction += '\n' + txt
      } else {
        systemInstruction = txt
      }
    } else {
      const role = msg.role === 'model' || msg.role === 'assistant' ? 'model' : 'user'
      const parts = msg.parts || []
      
      const newParts: any[] = []
      for (const p of parts) {
        const thoughtSig = (p as any).thoughtSignature || (p as any).thought_signature
        const sigObj = thoughtSig ? { thoughtSignature: thoughtSig, thought_signature: thoughtSig } : {}
        if (p.text) {
          const toolCalls = parseToolCallsFromText(p.text)
          if (toolCalls.length > 0) {
            const cleanText = removeToolCalls(p.text).trim()
            if (cleanText) {
              newParts.push({ text: cleanText, ...sigObj })
            }
            for (const tc of toolCalls) {
              const { type, ...args } = tc
              newParts.push({
                functionCall: {
                  name: type,
                  args
                },
                ...sigObj
              })
            }
          } else {
            newParts.push({ text: p.text, ...sigObj })
          }
        } else if (p.inlineData) {
          newParts.push({ inlineData: p.inlineData, ...sigObj })
        } else {
          newParts.push({
            ...p,
            ...sigObj
          })
        }
      }

      contents.push({
        role,
        parts: newParts
      })
    }
  }

  // ── Validate turn ordering for Gemini API ──────────────────────────────────
  // Gemini requires:
  //   1. First content turn must be 'user'
  //   2. A model turn with functionCall must be preceded by a user turn (text or functionResponse)
  //   3. A user turn with functionResponse must follow a model turn with functionCall
  //   4. No consecutive same-role turns (merge them if they occur)
  //
  // ensureHistoryFitsLimit can drop messages from the front, potentially leaving
  // a model(functionCall) turn without a preceding user turn.

  // Step 1: Remove leading model turns (orphaned — no preceding user turn)
  while (contents.length > 0 && (contents[0] as any).role === 'model') {
    contents.shift()
    // Also remove the following user(functionResponse) if it exists — it's orphaned too
    if (contents.length > 0 && (contents[0] as any).role === 'user') {
      const onlyFunctionResponse = (contents[0].parts || []).every(
        (p: any) => p.functionResponse
      )
      if (onlyFunctionResponse) {
        contents.shift()
      }
    }
  }

  // Step 2: Remove leading user(functionResponse) turns that have no preceding functionCall
  while (contents.length > 0 && (contents[0] as any).role === 'user') {
    const onlyFunctionResponse = (contents[0].parts || []).every(
      (p: any) => p.functionResponse
    )
    if (!onlyFunctionResponse) break
    contents.shift()
  }

  // Step 3: Merge consecutive same-role turns into one turn
  const merged: Content[] = []
  for (const content of contents) {
    if (merged.length > 0 && (merged[merged.length - 1] as any).role === (content as any).role) {
      const prev = merged[merged.length - 1]
      prev.parts = [...(prev.parts || []), ...(content.parts || [])]
    } else {
      merged.push({ role: (content as any).role, parts: [...(content.parts || [])] })
    }
  }

  return { contents: merged, systemInstruction }
}

/** Delta emitted during streaming for a single native tool call. */
export interface StreamToolCallDelta {
  index: number
  id?: string
  name?: string
  argumentsDelta?: string
  /** Set to true when the tool call is fully received from the API. */
  isComplete?: boolean
  thoughtSignature?: string
  thought_signature?: string
}


interface StreamChunk {
  thought: string
  text: string
  /** Structured native tool call deltas (replaces text-based [PRISM_EXECUTE_TOOL] for new chats). */
  toolCalls?: StreamToolCallDelta[]
  title?: string
  thoughtSignature?: string
  thought_signature?: string
}

async function* generateAiStream(
  provider: 'gemini' | 'nvidia-nim' | 'openai-compatible',
  apiKey: string,
  modelName: string,
  history: Content[],
  signal?: AbortSignal,
  temperature = 0.7,
  target: 'main' | 'subagent' | 'both' | 'launcher' = 'main',
  allowedTools?: string[]
): AsyncGenerator<StreamChunk> {
  const fs = require('fs')
  const debugFilePath = 'c:/Users/Breno/Documents/Code/Prism/raw_stream_debug.txt'
  if (modelName === 'stepfun-ai/step-3.5-flash') {
    modelName = 'stepfun-ai/step-3.7-flash'
  }

  const localController = new AbortController()
  if (signal) {
    if (signal.aborted) {
      localController.abort()
    } else {
      signal.addEventListener('abort', () => localController.abort())
    }
  }

  let timeoutTimer: NodeJS.Timeout | undefined = undefined
  let hasTimedOut: 'first' | 'chunk' | null = null

  const startFirstTimeout = () => {
    clearTimeout(timeoutTimer)
    timeoutTimer = setTimeout(() => {
      hasTimedOut = 'first'
      localController.abort()
    }, 15000)
  }

  const startChunkTimeout = () => {
    clearTimeout(timeoutTimer)
    timeoutTimer = setTimeout(() => {
      hasTimedOut = 'chunk'
      localController.abort()
    }, 30000)
  }

  const clearTimer = () => {
    clearTimeout(timeoutTimer)
  }

  try {
    try {
      fs.writeFileSync(debugFilePath, `--- START STREAM (model: ${modelName}, provider: ${provider}) ---\n`)
    } catch (err) {
      console.error('Failed to init stream debug file:', err)
    }

    const appConfig = loadConfig()
    const reasoningLevels = appConfig.modelReasoningLevels || {}
    const reasoningLevel = reasoningLevels[modelName] || 'off'
    startFirstTimeout()

    if (provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey })
      const { contents, systemInstruction } = convertHistoryToGeminiFormat(ensureHistoryFitsLimit(history))
      
      const configObj: any = {
        systemInstruction,
        temperature,
        abortSignal: localController.signal,
        tools: getGeminiTools(target, allowedTools)
      }

      const supportsReasoning = modelName !== 'gemini-3.1-flash-lite' && modelName.startsWith('gemini-')
      if (supportsReasoning && reasoningLevel !== 'off') {
        let budget = 0
        if (reasoningLevel === 'low') budget = 1024
        else if (reasoningLevel === 'medium') budget = 2048
        else if (reasoningLevel === 'high') budget = 4096
        else if (reasoningLevel === 'max') budget = -1

        configObj.thinkingConfig = {
          thinkingBudget: budget,
          includeThoughts: true
        }
        if (budget !== 0) {
          delete configObj.temperature
        }
      }

      const responseStream = await ai.models.generateContentStream({
        model: modelName,
        contents,
        config: configObj
      })

      let geminiToolCallCounter = 0

      try {
        for await (const chunk of responseStream) {
          if (localController.signal.aborted) throw new Error('AbortError')
          startChunkTimeout()

          let thought = ''
          let text = ''
          const chunkToolCalls: StreamToolCallDelta[] = []

          let textThoughtSignature: string | undefined = undefined
          const candidate = chunk.candidates?.[0]
          if (candidate?.content?.parts) {
            for (const part of candidate.content.parts) {
              const sig = part.thoughtSignature || (part as any).thought_signature
              if (part.thought) {
                thought += part.text || ''
                if (sig && !textThoughtSignature) {
                  textThoughtSignature = sig
                }
              } else if (part.text) {
                text += part.text
                if (sig) {
                  textThoughtSignature = sig
                }
              } else if (part.functionCall) {
                const fcName = part.functionCall.name || ''
                const fcArgs = part.functionCall.args || {}
                chunkToolCalls.push({
                  index: geminiToolCallCounter++,
                  name: fcName,
                  argumentsDelta: JSON.stringify(fcArgs),
                  isComplete: true,
                  thoughtSignature: sig,
                  thought_signature: sig
                })
              }
            }
          }

          if (thought || text || chunkToolCalls.length > 0) {
            try {
              fs.appendFileSync(debugFilePath, JSON.stringify({ thought, text, toolCalls: chunkToolCalls }) + '\n')
            } catch (err) { /* ignore */ }
            yield {
              thought,
              text,
              toolCalls: chunkToolCalls.length > 0 ? chunkToolCalls : undefined,
              thoughtSignature: textThoughtSignature,
              thought_signature: textThoughtSignature
            }
          }
        }
      } finally {
        // Ensure the stream is properly closed to free server-side connections
      }
    } else {
      let baseURL: string
      if (provider === 'nvidia-nim') {
        baseURL = 'https://integrate.api.nvidia.com/v1'
      } else {
        const configBaseUrl = (loadConfig().openaiBaseUrl || '').replace(/\/+$/, '')
        baseURL = configBaseUrl
      }

      const openai = new OpenAI({
        apiKey,
        baseURL,
        timeout: 120000,
        maxRetries: 2,
        fetch: originalFetch
      })
      const messages = convertHistoryToOpenAiFormat(ensureHistoryFitsLimit(history), provider)
      const nimTools = getOpenAiTools(target, allowedTools)
      const requestConfig: any = {
        model: modelName,
        messages,
        temperature,
        stream: true,
        tools: nimTools || undefined
      }
      applyReasoningConfig(requestConfig, modelName, reasoningLevel)
      if (provider === 'nvidia-nim') {
        requestConfig.stream_options = { ...requestConfig.stream_options, include_usage: true }
      }
      if (reasoningLevel !== 'off' && modelName.includes('deepseek')) {
        requestConfig.stream_options = { ...requestConfig.stream_options, include_reasoning: true }
      }

      const responseStream = (await openai.chat.completions.create(requestConfig, { signal: localController.signal })) as any

      const accumulatedToolCalls = new Map<number, {
        id?: string
        name?: string
        arguments: string
      }>()

      try {
        for await (const chunk of responseStream) {
          if (localController.signal.aborted) throw new Error('AbortError')
          startChunkTimeout()

          const choice = chunk.choices?.[0]
          if (!choice) continue

          const delta = choice.delta || {}
          const thought = (delta as any).reasoning_content || ''
          const text = delta.content || ''
          const toolCalls = delta.tool_calls || []

          const chunkToolCalls: StreamToolCallDelta[] = []

          for (const tc of toolCalls) {
            const idx = tc.index
            if (idx !== undefined) {
              if (!accumulatedToolCalls.has(idx)) {
                accumulatedToolCalls.set(idx, { arguments: '' })
              }
              const acc = accumulatedToolCalls.get(idx)!
              if (tc.id) acc.id = tc.id
              if (tc.function?.name) acc.name = tc.function.name
              if (tc.function?.arguments) {
                acc.arguments += tc.function.arguments
              }

              chunkToolCalls.push({
                index: idx,
                id: tc.id,
                name: tc.function?.name,
                argumentsDelta: tc.function?.arguments
              })
            }
          }

          if (thought || text || chunkToolCalls.length > 0) {
            try {
              fs.appendFileSync(debugFilePath, JSON.stringify({ thought, text, toolCalls: chunkToolCalls }) + '\n')
            } catch (err) { /* ignore */ }
            yield {
              thought,
              text,
              toolCalls: chunkToolCalls.length > 0 ? chunkToolCalls : undefined
            }
          }
        }
      } finally {
        // Ensure the stream is properly closed to free server-side connections
      }

      for (const [idx, acc] of accumulatedToolCalls.entries()) {
        if (acc.name) {
          let parsedArgs = {}
          try {
            parsedArgs = JSON.parse(acc.arguments || '{}')
          } catch (e) {
            try {
              const repaired = completeIncompleteToolCalls(`[PRISM_EXECUTE_TOOL]${acc.arguments}[/PRISM_EXECUTE_TOOL]`)
              const jsonText = repaired.replace('[PRISM_EXECUTE_TOOL]', '').replace('[/PRISM_EXECUTE_TOOL]', '')
              parsedArgs = JSON.parse(jsonText)
            } catch (e2) { /* ignore */ }
          }
          try {
            fs.appendFileSync(debugFilePath, JSON.stringify({ toolCallComplete: { index: idx, name: acc.name, args: parsedArgs } }) + '\n')
          } catch (err) { /* ignore */ }
          yield {
            thought: '',
            text: '',
            toolCalls: [{
              index: idx,
              id: acc.id,
              name: acc.name,
              argumentsDelta: JSON.stringify(parsedArgs),
              isComplete: true
            }]
          }
        }
      }
    }
  } catch (err) {
    clearTimer()
    if (hasTimedOut === 'first') {
      throw new Error('TIMEOUT_ERROR_FIRST')
    } else if (hasTimedOut === 'chunk') {
      throw new Error('TIMEOUT_ERROR_CHUNK')
    }
    throw err
  } finally {
    clearTimer()
  }
}

async function generateAiContent(
  provider: 'gemini' | 'nvidia-nim' | 'openai-compatible',
  apiKey: string,
  modelName: string,
  history: Content[],
  signal?: AbortSignal,
  temperature = 0.7,
  target: 'main' | 'subagent' | 'both' | 'launcher' | 'title' = 'main',
  allowedTools?: string[]
): Promise<{ text: string; thoughtSignature?: string }> {
  if (modelName === 'stepfun-ai/step-3.5-flash') {
    modelName = 'stepfun-ai/step-3.7-flash'
  }

  const localController = new AbortController()
  if (signal) {
    if (signal.aborted) {
      localController.abort()
    } else {
      signal.addEventListener('abort', () => localController.abort())
    }
  }

  let hasTimedOut = false
  const timeoutTimer = setTimeout(() => {
    hasTimedOut = true
    localController.abort()
  }, 15000)

  try {
    const appConfig = loadConfig()
    const reasoningLevels = appConfig.modelReasoningLevels || {}
    const reasoningLevel = reasoningLevels[modelName] || 'off'

    if (provider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey })
      const { contents, systemInstruction } = convertHistoryToGeminiFormat(ensureHistoryFitsLimit(history))
      
      const configObj: any = {
        systemInstruction,
        temperature,
        abortSignal: localController.signal,
        tools: getGeminiTools(target, allowedTools)
      }

      const supportsReasoning = modelName !== 'gemini-3.1-flash-lite' && modelName.startsWith('gemini-')
      if (supportsReasoning) {
        let budget = 0
        if (reasoningLevel === 'low') budget = 1024
        else if (reasoningLevel === 'medium') budget = 2048
        else if (reasoningLevel === 'high') budget = 4096
        else if (reasoningLevel === 'max') budget = -1

        configObj.thinkingConfig = {
          thinkingBudget: budget,
          includeThoughts: true
        }
        if (budget !== 0) {
          delete configObj.temperature
        }
      }

      const response = await ai.models.generateContent({
        model: modelName,
        contents,
        config: configObj
      })

      let resultText = response.text || ''
      let thoughts = ''
      let firstThoughtSignature: string | undefined = undefined
      const candidate = response.candidates?.[0]
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          const sig = part.thoughtSignature || (part as any).thought_signature
          if (sig && !firstThoughtSignature) {
            firstThoughtSignature = sig
          }
          if (part.thought) {
            thoughts += part.text || ''
          } else if (part.functionCall) {
            const name = part.functionCall.name
            const args = part.functionCall.args || {}
            resultText += `[PRISM_EXECUTE_TOOL]${JSON.stringify({ type: name, ...args })}[/PRISM_EXECUTE_TOOL]\n`
          }
        }
      }
      let finalText = ''
      if (thoughts) {
        finalText = `<thought>${thoughts}</thought>\n${normalizeToolCalls(resultText)}`
      } else {
        finalText = normalizeToolCalls(resultText)
      }
      return { text: finalText, thoughtSignature: firstThoughtSignature }
    } else {
      let baseURL: string
      if (provider === 'nvidia-nim') {
        baseURL = 'https://integrate.api.nvidia.com/v1'
      } else {
        const configBaseUrl = (loadConfig().openaiBaseUrl || '').replace(/\/+$/, '')
        baseURL = configBaseUrl
      }

      const openai = new OpenAI({ apiKey, baseURL, fetch: originalFetch })
      const messages = convertHistoryToOpenAiFormat(ensureHistoryFitsLimit(history), provider)
      const nimTools = getOpenAiTools(target, allowedTools)
      const requestConfig: any = {
        model: modelName,
        messages,
        temperature,
        stream: false,
        tools: nimTools || undefined
      }

      applyReasoningConfig(requestConfig, modelName, reasoningLevel)

      const response = await openai.chat.completions.create(requestConfig, { signal: localController.signal })

      const message = response.choices?.[0]?.message
      let resultText = message?.content || ''
      const reasoningContent = (message as any)?.reasoning_content
      if (reasoningContent) {
        resultText = `<thought>${reasoningContent}</thought>\n${resultText}`
      }
      const toolCalls = message?.tool_calls
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls as any[]) {
          const name = tc.function.name
          let args = {}
          try {
            args = JSON.parse(tc.function.arguments || '{}')
          } catch (e) { /* ignore */ }
          resultText += `[PRISM_EXECUTE_TOOL]${JSON.stringify({ type: name, ...args })}[/PRISM_EXECUTE_TOOL]\n`
        }
      }
      return { text: normalizeToolCalls(resultText) }
    }
  } catch (err) {
    clearTimeout(timeoutTimer)
    if (hasTimedOut) {
      throw new Error('TIMEOUT_ERROR_FIRST')
    }
    throw err
  } finally {
    clearTimeout(timeoutTimer)
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

// Currently selected model
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
  'deepseek-ai/deepseek-v4-flash': { apiModel: 'deepseek-ai/deepseek-v4-flash' },
  'deepseek-ai/deepseek-v4-pro': { apiModel: 'deepseek-ai/deepseek-v4-pro' },
  'gemini-3.1-flash-lite': { apiModel: 'gemini-3.1-flash-lite' },
  'gemini-3-flash': { apiModel: 'gemini-3-flash' },
  'gemini-3.1-pro': { apiModel: 'gemini-3.1-pro' },
  'gemini-3.5-flash': { apiModel: 'gemini-3.5-flash' },
  'z-ai/glm-5.2': { apiModel: 'z-ai/glm-5.2' },
  'openai/gpt-oss-120b': { apiModel: 'openai/gpt-oss-120b' },
  'minimaxai/minimax-m3': { apiModel: 'minimaxai/minimax-m3' },
  'stepfun-ai/step-3.7-flash': { apiModel: 'stepfun-ai/step-3.7-flash' }
}

const AGENT_TEMPERATURE = 0.7
const DEFAULT_SUBAGENT_MODEL_KEY = 'gemini-3.1-flash-lite'
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

/** Accumulated state for a streaming tool call, derived from deltas. */
export interface StreamingToolCall {
  index: number
  id?: string
  name: string
  arguments: string
  isComplete: boolean
  thoughtSignature?: string
  thought_signature?: string
}

export interface StructuredChatResponse {
  thoughts: string
  finalResponse: string
  rawText: string
  isThinking?: boolean
  isWritingToolCall?: boolean
  toolType?: 'task' | 'search'
  /** Real-time structured tool calls being composed by the AI. */
  streamingToolCalls?: StreamingToolCall[]
}

/**
 * Applies model-specific reasoning/thinking configuration to a request config.
 * Shared between generateAiStream and generateAiContent to eliminate duplication.
 */
function applyReasoningConfig(
  requestConfig: any,
  modelName: string,
  reasoningLevel: string
): void {
  const isDeepSeek = modelName.includes('deepseek')
  const isGptOss = modelName.includes('gpt-oss')
  const isMiniMax = modelName.includes('minimax')

  if (isDeepSeek) {
    // DeepSeek: reasoning_effort accepts none, high, max
    if (reasoningLevel !== 'off') {
      requestConfig.reasoning_effort = reasoningLevel === 'max' ? 'max' : 'high'
      delete requestConfig.temperature
    } else {
      requestConfig.reasoning_effort = 'none'
    }
  } else if (isGptOss) {
    // GPT-OSS: reasoning_effort accepts low, medium, high (no "off"/"none")
    // The API always has reasoning enabled; user picks the intensity
    if (reasoningLevel && reasoningLevel !== 'off') {
      const effort = reasoningLevel === 'low' ? 'low' : reasoningLevel === 'high' ? 'high' : 'medium'
      requestConfig.reasoning_effort = effort
      delete requestConfig.temperature
    }
  } else if (isMiniMax) {
    // MiniMax M3: uses chat_template_kwargs for thinking_mode
    if (reasoningLevel !== 'off') {
      const mode = reasoningLevel === 'adaptive' ? 'adaptive' : 'enabled'
      requestConfig.chat_template_kwargs = { thinking_mode: mode }
      delete requestConfig.temperature
    } else {
      requestConfig.chat_template_kwargs = { thinking_mode: 'disabled' }
    }
  }
}

// RAW_TOOL_ARG_TAGS, OBJECT_TOOL_ARG_TAGS now imported from ./toolUtils

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
        // Also truncate native functionResponse results
        const fr = (part as any).functionResponse
        if (fr?.response?.result && typeof fr.response.result === 'string') {
          const MAX_TOOL_RESULT = 5000
          if (fr.response.result.length > MAX_TOOL_RESULT) {
            return {
              ...part,
              functionResponse: {
                ...fr,
                response: {
                  result: fr.response.result.substring(0, MAX_TOOL_RESULT) + '\n\n... [TOOL RESULTS TRUNCATED]'
                }
              }
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
      // Also count native functionResponse result sizes
      const fr = (part as any).functionResponse
      if (fr?.response?.result && typeof fr.response.result === 'string') {
        msgSize += fr.response.result.length
      }
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
): Promise<{ text: string; thoughtSignature?: string }> {
  const config = loadConfig()
  const subModel = config.subagentModel || 'gemma-4-26b-a4b-it'
  const provider = getModelProvider(subModel)
  const apiKey = getProviderApiKey(provider)
  if (!apiKey) {
    throw new Error(`API key for subagent model provider "${provider}" is missing.`)
  }
  return generateAiContent(provider, apiKey, subModel, history, signal, AGENT_TEMPERATURE, 'subagent')
}

const activeQuestionnaireResolvers = new Map<string, (result: string) => void>()
export const sessionTodos = new Map<string, TodoState>()

export function getTodoForChat(chatId: string): TodoState | null {
  return sessionTodos.get(chatId) || null
}

function buildTodoReminder(chatId?: string): string {
  const todo = sessionTodos.get(chatId || currentSessionId)
  if (!todo || !todo.active) return ''
  const pendingCount = todo.tasks.filter((t) => t.status !== 'done').length
  if (pendingCount === 0) return ''

  const statusIcon = (s: string) => {
    if (s === 'done') return '[DONE]'
    if (s === 'working') return '[WORKING]'
    return '[PENDING]'
  }

  const taskLines = todo.tasks
    .map((t) => `- ${statusIcon(t.status)} ${t.title}`)
    .join('\n')

  return `\n\n# Active Todo List\nYou have ${pendingCount} pending tasks:\n${taskLines}\n\nIMPORTANT: Use \`edit_todo\` to update task status as you work. Set to "working" when you start a task and "done" when you complete it. You MUST complete ALL tasks in the todo list before responding to the user. Do NOT proceed without finishing all tasks.`
}

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
  execute_terminal_command: (args, event, apiKey, signal, chatId) =>
    runTerminalCommand(args.command || '', apiKey, signal, event, chatId),
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
      args.limit ? parseInt(args.limit, 10) : undefined,
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
  },
  create_todo: async (args, _event) => {
    const tasksInput = args.tasks
    let taskTitles: string[] = []
    if (typeof tasksInput === 'string') {
      try {
        const parsed = JSON.parse(tasksInput)
        if (Array.isArray(parsed)) taskTitles = parsed.map(String)
      } catch {
        taskTitles = tasksInput.split(',').map((s: string) => s.trim()).filter(Boolean)
      }
    } else if (Array.isArray(tasksInput)) {
      taskTitles = tasksInput.map(String)
    }

    if (taskTitles.length < 2) {
      return 'Error: create_todo requires at least 2 tasks. Please define a more detailed plan with at least 2 steps.'
    }
    if (taskTitles.length > 30) {
      taskTitles = taskTitles.slice(0, 30)
    }

    const todo: TodoState = {
      tasks: taskTitles.map((title, i) => ({
        id: `task-${i}`,
        title,
        status: 'pending' as const
      })),
      createdAt: Date.now(),
      active: true,
      chatId: currentSessionId
    }
    sessionTodos.set(currentSessionId, todo)

    try {
      const wins = BrowserWindow.getAllWindows()
      for (const win of wins) {
        if (!win.webContents.getURL().includes('#launcher') && !win.webContents.getURL().includes('#subagents')) {
          win.webContents.send('chat-todo-update', todo)
        }
      }
    } catch {}

    return `Todo list created with ${taskTitles.length} tasks. Use edit_todo to update each task's status as you work through them: set to "working" when starting a task and "done" when completing it. All tasks must be completed before finishing.`
  },
  edit_todo: async (args, _event) => {
    const todo = sessionTodos.get(currentSessionId)
    if (!todo || !todo.active) {
      return 'Error: No active todo list. Create one first with create_todo.'
    }

    const taskId = (args.id || '').toString().trim()
    const newStatus = (args.status || '').toString().trim() as 'working' | 'done'

    if (!taskId) return 'Error: Task ID is required (e.g. "task-0", "task-1").'
    if (newStatus !== 'working' && newStatus !== 'done') {
      return 'Error: Status must be "working" or "done".'
    }

    const taskIndex = todo.tasks.findIndex((t) => t.id === taskId)
    if (taskIndex === -1) {
      return `Error: Task "${taskId}" not found. Available tasks: ${todo.tasks.map((t) => `${t.id} (${t.title})`).join(', ')}`
    }

    if (todo.tasks[taskIndex].status === 'done' && newStatus === 'done') {
      return `Task "${taskId}" (${todo.tasks[taskIndex].title}) is already marked as done.`
    }

    todo.tasks[taskIndex] = {
      ...todo.tasks[taskIndex],
      status: newStatus
    }

    const allDone = todo.tasks.every((t) => t.status === 'done')
    if (allDone) {
      todo.active = false
    }

    try {
      const wins = BrowserWindow.getAllWindows()
      for (const win of wins) {
        if (!win.webContents.getURL().includes('#launcher') && !win.webContents.getURL().includes('#subagents')) {
          win.webContents.send('chat-todo-update', todo)
        }
      }
      if (allDone) {
        for (const win of wins) {
          if (!win.webContents.getURL().includes('#launcher') && !win.webContents.getURL().includes('#subagents')) {
            win.webContents.send('chat-todo-complete', { chatId: currentSessionId })
          }
        }
      }
    } catch {}

    if (allDone) {
      sessionTodos.delete(currentSessionId)
      return `All tasks completed! The todo list has been concluded.`
    }

    return `Task "${todo.tasks[taskIndex].title}" updated to "${newStatus}". ${todo.tasks.filter((t) => t.status === 'done').length}/${todo.tasks.length} tasks completed. Continue with the remaining tasks.`
  },
  create_mini_app: async () => {
    return Promise.resolve('Mini App created successfully.')
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

        const res = await generateSubagentResponse(
          history,
          parentSignal
        )
        const responseText = res.text
        const thoughtSignature = res.thoughtSignature

        history.push({
          role: 'model',
          parts: [{
            text: responseText,
            thoughtSignature,
            thought_signature: thoughtSignature
          } as any]
        })
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
        modelKey?: string
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

  if (typeof data === 'object' && data.modelKey) {
    currentModelKey = data.modelKey
  }

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

  // Generates a short title for the chat session asynchronously.
  async function generateChatTitleAsync(
    chatId: string,
    firstMessage: string,
    modelKey: string,
    apiKey: string,
    event: IpcMainEvent
  ) {
    const titleAbortController = new AbortController()
    const timeoutId = setTimeout(() => {
      titleAbortController.abort()
      console.warn(`[Title Generator] Generation timed out after 20 seconds for chat ${chatId}`)
    }, 20000)

    try {
      const provider = getModelProvider(modelKey)
      const modelConfig = MODEL_CONFIGS[modelKey] || { apiModel: modelKey }
      const titleModel = modelConfig.apiModel

      const prompt = `Create an extremely short (maximum 5 words) title for this conversation based on this message: "${firstMessage}". Respond ONLY with the title text, with no quotes or punctuation. The title MUST match the language of the user's message.`

      const titleHistory: Content[] = [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ]

      console.log(`[Title Generator] Generating title for chat ${chatId} using model ${titleModel} via provider ${provider}...`)

      const res = await generateAiContent(
          provider,
          apiKey,
          titleModel,
          titleHistory,
          titleAbortController.signal,
          0.7,
          'title'
        )

        clearTimeout(timeoutId)

        const result = res.text
        let finalTitle = (result || '').trim()
      finalTitle = finalTitle.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim()
      finalTitle = finalTitle.replace(/^["']|["']$/g, '').trim()

      if (!finalTitle || finalTitle.toLowerCase() === 'new conversation') {
        finalTitle = 'New Conversation'
      }

      console.log(`[Title Generator] Generated title for chat ${chatId}: "${finalTitle}"`)

      updateChatSessionTitle(chatId, finalTitle)
      event.sender.send('chat-title-received', { id: chatId, title: finalTitle })
    } catch (error) {
      clearTimeout(timeoutId)
      console.error('Failed to generate chat title in background:', error)
    }
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
    const todoReminder = buildTodoReminder()
    runHistory[0].parts = [{ text: fullPrompt + todoReminder }]
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
    generateChatTitleAsync(chatId, message, currentModelKey, apiKey, event)
  } else {
    // Regular save for existing sessions
    saveChatSession(chatId, runHistory)
  }

  let finalTitle = ''
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

          // Update system prompt with current todo status each iteration
          if (runHistory.length > 0 && runHistory[0].role === 'system') {
            const baseText = String((runHistory[0].parts?.[0] as any)?.text || fullPrompt)
            const todoReminder = buildTodoReminder()
            const cleanBase = baseText.replace(/\n\n# Active Todo List[\s\S]*?(?=\n\n#|$)/, '')
            runHistory[0].parts = [{ text: cleanBase.trim() + todoReminder }]
          }

          console.log(
            `[Main Chat] Starting generateAiStream for model: ${modelConfig.apiModel}, provider: ${currentProvider}`
          )

          let currentThoughts = ''
          let currentFinalResponse = ''
          let chunkCount = 0

          // Accumulator for structured native tool calls
          const currentStreamingToolCalls: StreamingToolCall[] = []

          const stream = generateAiStream(
            currentProvider,
            currentApiKey,
            modelConfig.apiModel,
            runHistory,
            runAbortController.signal,
            AGENT_TEMPERATURE,
            'main',
            matchedWorkflow?.toolConstraints
          )

          let lastIpcTime = 0
          const IPC_THROTTLE_MS = 50

          let accumulatedTextThoughtSignature: string | undefined = undefined

          for await (const chunk of stream) {
            if (runAbortController.signal.aborted) throw new Error('AbortError')
            chunkCount++

            if (chunk.thought) {
              currentThoughts += chunk.thought
            }
            if (chunk.text) {
              currentFinalResponse += chunk.text
            }
            if (chunk.title) {
              finalTitle = chunk.title
              event.sender.send('chat-title-received', { id: chatId, title: finalTitle })
            }
            if (chunk.thoughtSignature || chunk.thought_signature) {
              accumulatedTextThoughtSignature = chunk.thoughtSignature || chunk.thought_signature
            }

            // Accumulate structured tool call deltas
            if (chunk.toolCalls) {
              for (const tcDelta of chunk.toolCalls) {
                let existing = currentStreamingToolCalls.find(tc => tc.index === tcDelta.index)
                if (!existing) {
                  existing = { index: tcDelta.index, name: '', arguments: '', isComplete: false }
                  currentStreamingToolCalls.push(existing)
                }
                if (tcDelta.id) existing.id = tcDelta.id
                if (tcDelta.name) existing.name = tcDelta.name
                if (tcDelta.isComplete) {
                  if (tcDelta.argumentsDelta !== undefined) {
                    existing.arguments = tcDelta.argumentsDelta
                  }
                  existing.isComplete = true
                } else if (tcDelta.argumentsDelta) {
                  existing.arguments += tcDelta.argumentsDelta
                }
                if (tcDelta.thoughtSignature || tcDelta.thought_signature) {
                  existing.thoughtSignature = tcDelta.thoughtSignature || tcDelta.thought_signature
                  existing.thought_signature = tcDelta.thoughtSignature || tcDelta.thought_signature
                }
              }
            }

            const now = Date.now()
            const shouldSendIpc = now - lastIpcTime >= IPC_THROTTLE_MS || chunkCount === 1

            if (shouldSendIpc) {
              lastIpcTime = now

              // Detect tool call writing from BOTH structured tool calls and legacy text markers
              const hasStructuredToolCalls = currentStreamingToolCalls.length > 0

              const countOccurrences = (str: string, subStr: string): number =>
                str.split(subStr).length - 1

              const hasLegacyToolCall =
                countOccurrences(currentFinalResponse, '[PRISM_EXECUTE_TOOL]') >
                  countOccurrences(currentFinalResponse, '[/PRISM_EXECUTE_TOOL]')

              const hasMiniApp =
                countOccurrences(currentFinalResponse, '<mini_app>') >
                  countOccurrences(currentFinalResponse, '</mini_app>')

              const isWritingToolCall = hasStructuredToolCalls || hasLegacyToolCall || hasMiniApp

              let toolType: 'task' | 'search' | 'mini-app' | undefined = undefined
              if (isWritingToolCall) {
                if (hasMiniApp) {
                  toolType = 'mini-app'
                } else if (hasStructuredToolCalls) {
                  // Determine tool type from structured data
                  const lastTc = currentStreamingToolCalls[currentStreamingToolCalls.length - 1]
                  const searchTools = ['web_search', 'search_chat_history', 'saw_link_from_url', 'search_chat_memory']
                  if (lastTc?.name === 'create_mini_app') {
                    toolType = 'mini-app'
                  } else {
                    toolType = searchTools.includes(lastTc?.name) ? 'search' : 'task'
                  }
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

              const fullResponse = joinResponseSegments(accumulatedFinalResponse, currentFinalResponse)
              const fullThoughts = accumulatedThoughts + currentThoughts
              const isThinking = currentThoughts.length > 0 && !isWritingToolCall

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
                streamingToolCalls: currentStreamingToolCalls.length > 0 ? currentStreamingToolCalls : undefined,
                chatId: chatId
              })
            }
          }

          // Send final chunk to ensure the last generated tokens are fully delivered
          const hasStructuredToolCallsFinal = currentStreamingToolCalls.length > 0

          const finalCountOccurrences = (str: string, subStr: string): number =>
            str.split(subStr).length - 1

          const hasLegacyToolCallFinal =
            finalCountOccurrences(currentFinalResponse, '[PRISM_EXECUTE_TOOL]') >
              finalCountOccurrences(currentFinalResponse, '[/PRISM_EXECUTE_TOOL]')

          const hasMiniAppFinal =
            finalCountOccurrences(currentFinalResponse, '<mini_app>') >
              finalCountOccurrences(currentFinalResponse, '</mini_app>')

          const isWritingToolCallFinal = hasStructuredToolCallsFinal || hasLegacyToolCallFinal || hasMiniAppFinal

          let toolTypeFinal: 'task' | 'search' | 'mini-app' | undefined = undefined
          if (isWritingToolCallFinal) {
            if (hasMiniAppFinal) {
              toolTypeFinal = 'mini-app'
            } else if (hasStructuredToolCallsFinal) {
              const lastTc = currentStreamingToolCalls[currentStreamingToolCalls.length - 1]
              const searchTools = ['web_search', 'search_chat_history', 'saw_link_from_url', 'search_chat_memory']
              if (lastTc?.name === 'create_mini_app') {
                toolTypeFinal = 'mini-app'
              } else {
                toolTypeFinal = searchTools.includes(lastTc?.name) ? 'search' : 'task'
              }
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

          const finalResponseString = joinResponseSegments(accumulatedFinalResponse, currentFinalResponse)
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
            streamingToolCalls: currentStreamingToolCalls.length > 0 ? currentStreamingToolCalls : undefined,
            chatId: chatId
          })

          console.log(`[Main Chat] Stream generation completed. Total chunks: ${chunkCount}`)

          // Save the AI response to history.
          // Use structured functionCall parts for native tool calls, legacy text for old-style.
          const fullAiResponse = currentFinalResponse
          const completedStructuredToolCalls = currentStreamingToolCalls.filter(tc => tc.isComplete && tc.name)

          if (fullAiResponse.trim() || completedStructuredToolCalls.length > 0) {
            const historyParts: NonNullable<Content['parts']> = []
            if (fullAiResponse.trim()) {
              historyParts.push({
                text: fullAiResponse,
                thoughtSignature: accumulatedTextThoughtSignature,
                thought_signature: accumulatedTextThoughtSignature
              } as any)
            }
            for (const tc of completedStructuredToolCalls) {
              let args: Record<string, any> = {}
              try { args = JSON.parse(tc.arguments) } catch { /* ignore */ }
              historyParts.push({
                functionCall: { name: tc.name, args },
                thoughtSignature: tc.thoughtSignature,
                thought_signature: tc.thought_signature || tc.thoughtSignature
              } as any)
            }
            if (historyParts.length > 0) {
              runHistory.push({ role: 'model', parts: historyParts })
              saveChatSession(chatId, runHistory, finalTitle || undefined)
            }
          }

          const needsThoughtSeparator = accumulatedThoughts.length > 0 && currentThoughts.length > 0
          accumulatedThoughts += needsThoughtSeparator ? '\n\n' + currentThoughts : currentThoughts
          accumulatedFinalResponse = joinResponseSegments(accumulatedFinalResponse, currentFinalResponse)

          // Move tool calls from thoughts to response (some models like GPT-OSS do CoT tool calls)
          const thoughtToolPattern = /\[PRISM_EXECUTE_TOOL\]([\s\S]*?)\[\/PRISM_EXECUTE_TOOL\]/g
          let thoughtMatch
          while ((thoughtMatch = thoughtToolPattern.exec(currentThoughts)) !== null) {
            currentFinalResponse += thoughtMatch[0] + '\n'
          }
          currentThoughts = currentThoughts.replace(thoughtToolPattern, '').trim()

          // Determine which tool calls to execute:
          // 1. Structured native tool calls (from API function calling) — preferred
          // 2. Legacy text-based [PRISM_EXECUTE_TOOL] parsing — fallback for old-style models

          let hasToolCallsToExecute = false

          if (completedStructuredToolCalls.length > 0) {
            // Execute structured tool calls
            hasToolCallsToExecute = true
            const toolPromises = completedStructuredToolCalls.map(async (tc) => {
              let parsedArgs: Record<string, any> = {}
              try { parsedArgs = JSON.parse(tc.arguments) } catch { /* ignore */ }

              // Validate using the structured data
              const name = parsedArgs.type || tc.name
              delete parsedArgs.type

              let isMalformed = false
              let actualName = name
              let errorMessage = ''
              let errorType = ''

              if (!toolFunctions[name]) {
                isMalformed = true
                const suggestion = findClosestTool(name, Object.keys(toolFunctions))
                actualName = 'malformed_tool_call'
                errorType = 'invalid_tool'
                errorMessage = `The tool name "${name}" is not recognized. Did you mean "${suggestion}"? Available tools are: ${Object.keys(toolFunctions).join(', ')}.`
              }

              // Check workflow constraints
              if (
                !isMalformed &&
                matchedWorkflow?.toolConstraints &&
                matchedWorkflow.toolConstraints.length > 0
              ) {
                if (!matchedWorkflow.toolConstraints.includes(actualName)) {
                  isMalformed = true
                  errorType = 'invalid_tool'
                  errorMessage = `Error: The tool "${actualName}" is not allowed under the active workflow constraints. Allowed tools for this workflow are: ${matchedWorkflow.toolConstraints.join(', ')}.`
                  actualName = 'malformed_tool_call'
                }
              }

              if (currentSessionMode === 'conversation') {
                isMalformed = true
                errorType = 'invalid_tool'
                errorMessage = 'Tools are disabled in Conversation Mode.'
                actualName = 'malformed_tool_call'
              }

              // Build validated tool args
              let toolArgs: ToolArgs = {}
              if (!isMalformed) {
                for (const [key, value] of Object.entries(parsedArgs)) {
                  if (OBJECT_TOOL_ARG_TAGS.has(key) && typeof value === 'object' && value !== null) {
                    toolArgs[key] = value as unknown as string
                    continue
                  }
                  let val = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
                  if (!RAW_TOOL_ARG_TAGS.has(key)) {
                    val = val.trim()
                  }
                  toolArgs[key] = val
                }

                // Validate schema args
                const schemaError = validateSchemaArgs(actualName, toolArgs, toolsManifest)
                if (schemaError) {
                  isMalformed = true
                  errorType = schemaError.type
                  errorMessage = schemaError.message
                  actualName = 'malformed_tool_call'
                }
              }

              if (isMalformed) {
                toolArgs = {
                  rawContent: tc.arguments,
                  originalName: name || 'None',
                  errorType,
                  errorMessage
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
                  toolResult = `Error: Tool execution is disabled in Conversation Mode. You cannot run tools (attempted: "${name || 'unknown'}"). Please answer the user's question without calling any tools.`
                } else {
                  toolResult = `Error: AI stopped due to a malformed Tool Call.\nDetailed Error: ${errorMessage}\n\nYour generated tool call was: ${tc.name}(${tc.arguments})\n\nPlease review the error above, correct the tool call, and try again.`
                }
                await new Promise((resolve) => setTimeout(resolve, 500))
              } else {
                try {
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

              // Return both the text result and the original function call name for native functionResponse
              return {
                // Use tc.name (the original functionCall name from the API) for the functionResponse
                functionCallName: tc.name,
                actualName,
                result: toolResult,
                thoughtSignature: tc.thoughtSignature || tc.thought_signature
              }
            })

            const toolResults = await Promise.all(toolPromises)

            if (toolResults.length > 0) {
              // For Gemini provider: use native functionResponse parts to properly match functionCall/functionResponse
              // This preserves thought_signature which Gemini 3.1+ models require
              if (currentProvider === 'gemini') {
                const functionResponseParts: any[] = toolResults.map((tr) => {
                  const part: any = {
                    functionResponse: {
                      name: tr.functionCallName,
                      response: { result: tr.result }
                    }
                  }
                  // Preserve thought_signature for Gemini 3.1+ models
                  if (tr.thoughtSignature) {
                    part.thoughtSignature = tr.thoughtSignature
                    part.thought_signature = tr.thoughtSignature
                  }
                  return part
                })
                // Include screenshot if available (alongside functionResponse parts)
                const screenshotBase64 = chatId ? lastScreenshots.get(chatId) : undefined
                if (screenshotBase64) {
                  lastScreenshots.delete(chatId)
                  functionResponseParts.push({
                    inlineData: {
                      mimeType: 'image/png',
                      data: screenshotBase64
                    }
                  })
                }
                runHistory.push({ role: 'user', parts: functionResponseParts })
              } else {
                // For non-Gemini providers: use text-based format (converted by convertHistoryToOpenAiFormat)
                const allToolResultsText = toolResults.map(
                  (tr) => `\n[RESULT FOR ${tr.actualName}]:\n${tr.result}\n`
                ).join('')
                const systemFeedback = `[SYSTEM: TOOL RESULTS]${allToolResultsText}\nAnalyze these results and proceed. If the goal is achieved, finalize. If more steps are needed, use another tool.`
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
              }
              saveChatSession(chatId, runHistory, finalTitle || undefined)
              continue
            }
          }

          // Legacy fallback: extract tool calls from text-based [PRISM_EXECUTE_TOOL] markers
          if (!hasToolCallsToExecute) {
            const toolMatches = extractToolCalls(fullAiResponse)

            if (toolMatches.length > 0) {
              hasToolCallsToExecute = true
              const toolPromises = toolMatches.map(async (toolContent) => {
                const validation = validateToolCall(toolContent, Object.keys(toolFunctions), toolsManifest)
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
                    toolResult = `Error: AI stopped due to a malformed Tool Call.\nDetailed Error: ${validation.errorMessage}\n\nYour generated segment was:\n[PRISM_EXECUTE_TOOL]\n${toolContent.trim()}\n[/PRISM_EXECUTE_TOOL]\n\nEvery tool call MUST strictly conform to the expected format. Please review the error above, correct the tool call format, and try again.`
                  }
                  await new Promise((resolve) => setTimeout(resolve, 500))
                } else {
                  try {
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
                saveChatSession(chatId, runHistory, finalTitle || undefined)
                continue
              }
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
          saveChatSession(chatId, runHistory, finalTitle || undefined)

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
        if (error instanceof Error && error.message === 'TIMEOUT_ERROR_FIRST') {
          console.log('Chat request timed out waiting for first response')
          event.sender.send('chat-reply-error', { error: 'TIMEOUT_ERROR_FIRST', chatId })
          success = true
          return
        }
        if (error instanceof Error && error.message === 'TIMEOUT_ERROR_CHUNK') {
          console.log('Chat request timed out waiting for next chunk')
          event.sender.send('chat-reply-error', { error: 'TIMEOUT_ERROR_CHUNK', chatId })
          success = true
          return
        }

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

  let launcherModelKey = 'stepfun-ai/step-3.7-flash'

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
            0.7,
            'launcher'
          )

          let currentThoughts = ''
          let currentFinalResponse = ''
          let lastIpcTime = 0
          const IPC_THROTTLE_MS = 50

          // Accumulator for structured native tool calls
          const currentStreamingToolCalls: StreamingToolCall[] = []

          let accumulatedTextThoughtSignature: string | undefined = undefined

          for await (const chunk of responseStream) {
            if (runAbortController.signal.aborted) throw new Error('AbortError')

            if (chunk.thought) {
              currentThoughts += chunk.thought
            }
            if (chunk.text) {
              currentFinalResponse += chunk.text
            }
            if (chunk.thoughtSignature || chunk.thought_signature) {
              accumulatedTextThoughtSignature = chunk.thoughtSignature || chunk.thought_signature
            }

            // Accumulate structured tool call deltas
            if (chunk.toolCalls) {
              for (const tcDelta of chunk.toolCalls) {
                let existing = currentStreamingToolCalls.find(tc => tc.index === tcDelta.index)
                if (!existing) {
                  existing = { index: tcDelta.index, name: '', arguments: '', isComplete: false }
                  currentStreamingToolCalls.push(existing)
                }
                if (tcDelta.id) existing.id = tcDelta.id
                if (tcDelta.name) existing.name = tcDelta.name
                if (tcDelta.isComplete) {
                  if (tcDelta.argumentsDelta !== undefined) {
                    existing.arguments = tcDelta.argumentsDelta
                  }
                  existing.isComplete = true
                } else if (tcDelta.argumentsDelta) {
                  existing.arguments += tcDelta.argumentsDelta
                }
                if (tcDelta.thoughtSignature || tcDelta.thought_signature) {
                  existing.thoughtSignature = tcDelta.thoughtSignature || tcDelta.thought_signature
                  existing.thought_signature = tcDelta.thoughtSignature || tcDelta.thought_signature
                }
              }
            }

            const now = Date.now()
            const shouldSendIpc = now - lastIpcTime >= IPC_THROTTLE_MS

            if (shouldSendIpc) {
              lastIpcTime = now

              const hasStructuredToolCalls = currentStreamingToolCalls.length > 0

              const countOccurrences = (str: string, subStr: string): number =>
                str.split(subStr).length - 1

              const hasLegacyToolCall =
                countOccurrences(currentFinalResponse, '[PRISM_EXECUTE_TOOL]') >
                  countOccurrences(currentFinalResponse, '[/PRISM_EXECUTE_TOOL]')

              const hasMiniApp =
                countOccurrences(currentFinalResponse, '<mini_app>') >
                  countOccurrences(currentFinalResponse, '</mini_app>')

              const isWritingToolCall = hasStructuredToolCalls || hasLegacyToolCall || hasMiniApp

              let toolType: 'task' | 'search' | 'mini-app' | undefined = undefined
              if (isWritingToolCall) {
                if (hasMiniApp) {
                  toolType = 'mini-app'
                } else if (hasStructuredToolCalls) {
                  const lastTc = currentStreamingToolCalls[currentStreamingToolCalls.length - 1]
                  const searchTools = ['web_search', 'search_chat_history', 'saw_link_from_url', 'search_chat_memory']
                  if (lastTc?.name === 'create_mini_app') {
                    toolType = 'mini-app'
                  } else {
                    toolType = searchTools.includes(lastTc?.name) ? 'search' : 'task'
                  }
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

              const fullResponse = joinResponseSegments(accumulatedFinalResponse, currentFinalResponse)
              const fullThoughts = accumulatedThoughts + currentThoughts
              const isThinking = currentThoughts.length > 0 && !isWritingToolCall

              event.sender.send('launcher-reply-chunk', {
                thoughts: fullThoughts.trim(),
                finalResponse: fullResponse.trim(),
                isThinking,
                isWritingToolCall,
                toolType,
                streamingToolCalls: currentStreamingToolCalls.length > 0 ? currentStreamingToolCalls : undefined
              })
            }
          }

          // Send final chunk
          const hasStructuredToolCallsFinal = currentStreamingToolCalls.length > 0
          const finalCountOccurrences = (str: string, subStr: string): number =>
            str.split(subStr).length - 1

          const hasLegacyToolCallFinal =
            finalCountOccurrences(currentFinalResponse, '[PRISM_EXECUTE_TOOL]') >
              finalCountOccurrences(currentFinalResponse, '[/PRISM_EXECUTE_TOOL]')

          const hasMiniAppFinal =
            finalCountOccurrences(currentFinalResponse, '<mini_app>') >
              finalCountOccurrences(currentFinalResponse, '</mini_app>')

          const isWritingToolCallFinal = hasStructuredToolCallsFinal || hasLegacyToolCallFinal || hasMiniAppFinal

          let toolTypeFinal: 'task' | 'search' | 'mini-app' | undefined = undefined
          if (isWritingToolCallFinal) {
            if (hasMiniAppFinal) {
              toolTypeFinal = 'mini-app'
            } else if (hasStructuredToolCallsFinal) {
              const lastTc = currentStreamingToolCalls[currentStreamingToolCalls.length - 1]
              const searchTools = ['web_search', 'search_chat_history', 'saw_link_from_url', 'search_chat_memory']
              if (lastTc?.name === 'create_mini_app') {
                toolTypeFinal = 'mini-app'
              } else {
                toolTypeFinal = searchTools.includes(lastTc?.name) ? 'search' : 'task'
              }
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

          const finalResponseString = joinResponseSegments(accumulatedFinalResponse, currentFinalResponse)
          const finalThoughtsString = accumulatedThoughts + currentThoughts
          const isThinkingFinal = currentThoughts.length > 0 && currentFinalResponse.length === 0

          event.sender.send('launcher-reply-chunk', {
            thoughts: finalThoughtsString.trim(),
            finalResponse: finalResponseString.trim(),
            isThinking: isThinkingFinal,
            isWritingToolCall: isWritingToolCallFinal,
            toolType: toolTypeFinal,
            streamingToolCalls: currentStreamingToolCalls.length > 0 ? currentStreamingToolCalls : undefined
          })

          const fullAiResponse = currentFinalResponse
          const completedStructuredToolCalls = currentStreamingToolCalls.filter(tc => tc.isComplete && tc.name)

          if (fullAiResponse.trim() || completedStructuredToolCalls.length > 0) {
            const historyParts: NonNullable<Content['parts']> = []
            if (fullAiResponse.trim()) {
              historyParts.push({
                text: fullAiResponse,
                thoughtSignature: accumulatedTextThoughtSignature,
                thought_signature: accumulatedTextThoughtSignature
              } as any)
            }
            for (const tc of completedStructuredToolCalls) {
              let args: Record<string, any> = {}
              try { args = JSON.parse(tc.arguments) } catch { /* ignore */ }
              historyParts.push({
                functionCall: { name: tc.name, args },
                thoughtSignature: tc.thoughtSignature,
                thought_signature: tc.thought_signature || tc.thoughtSignature
              } as any)
            }
            if (historyParts.length > 0) {
              launcherChatHistory.push({ role: 'model', parts: historyParts })
            }
          }

          const needsThoughtSeparator = accumulatedThoughts.length > 0 && currentThoughts.length > 0
          accumulatedThoughts += needsThoughtSeparator ? '\n\n' + currentThoughts : currentThoughts
          accumulatedFinalResponse = joinResponseSegments(accumulatedFinalResponse, currentFinalResponse)

          // Move tool calls from thoughts to response (some models like GPT-OSS do CoT tool calls)
          const thoughtToolPatternLauncher = /\[PRISM_EXECUTE_TOOL\]([\s\S]*?)\[\/PRISM_EXECUTE_TOOL\]/g
          let thoughtMatchLauncher
          while ((thoughtMatchLauncher = thoughtToolPatternLauncher.exec(currentThoughts)) !== null) {
            currentFinalResponse += thoughtMatchLauncher[0] + '\n'
          }
          currentThoughts = currentThoughts.replace(thoughtToolPatternLauncher, '').trim()

          // Determine which tool calls to execute
          let hasLauncherToolCalls = false

          if (completedStructuredToolCalls.length > 0) {
            hasLauncherToolCalls = true
            let openMainAppCalled = false

            const toolPromises = completedStructuredToolCalls.map(async (tc) => {
              let parsedArgs: Record<string, any> = {}
              try { parsedArgs = JSON.parse(tc.arguments) } catch { /* ignore */ }

              const name = parsedArgs.type || tc.name
              delete parsedArgs.type

              if (name && toolFunctions[name]) {
                const toolArgs: ToolArgs = {}
                for (const [key, value] of Object.entries(parsedArgs)) {
                  toolArgs[key] = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
                }

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
                return { result: `\n[RESULT FOR ${name}]:\n${toolResult}\n`, openMainAppCalled }
              }
              return { result: '', openMainAppCalled: false }
            })

            const resultsWithFlags = await Promise.all(toolPromises)
            openMainAppCalled = resultsWithFlags.some(r => r.openMainAppCalled)
            const allToolResults = resultsWithFlags.map(r => r.result).join('')

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

          // Legacy fallback for text-based tool calls
          if (!hasLauncherToolCalls) {
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
          let thoughtSignature: string | undefined = undefined
          try {
            const res = await generateAiContent(
              provider,
              searchApiKey,
              searchModel,
              searchHistory,
              runAbortController.signal,
              0.3,
              'main',
              ['search_chat_memory', 'render_chat_history', 'not_found_chat_history']
            )
            responseText = res.text
            thoughtSignature = res.thoughtSignature
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
            searchHistory.push({
              role: 'model',
              parts: [{
                text: fullAiResponse,
                thoughtSignature,
                thought_signature: thoughtSignature
              } as any]
            })
          }

          accumulatedThoughts += currentThoughts
          accumulatedFinalResponse += currentFinalResponse

          // Move tool calls from thoughts to response (some models like GPT-OSS do CoT tool calls)
          const thoughtToolPatternSearch = /\[PRISM_EXECUTE_TOOL\]([\s\S]*?)\[\/PRISM_EXECUTE_TOOL\]/g
          let thoughtMatchSearch
          while ((thoughtMatchSearch = thoughtToolPatternSearch.exec(currentThoughts)) !== null) {
            currentFinalResponse += thoughtMatchSearch[0] + '\n'
          }
          currentThoughts = currentThoughts.replace(thoughtToolPatternSearch, '').trim()

          const toolMatches = extractToolCalls(fullAiResponse)

          if (toolMatches.length > 0) {
            console.log(`[AI SEARCH DEBUG MAIN] Found ${toolMatches.length} tool calls to execute.`)
            let hasRenderedChat = false
            let hasNotFoundChat = false

            const toolPromises = toolMatches.map(async (toolContent) => {
              const validation = validateToolCall(toolContent, Object.keys(toolFunctions), toolsManifest)
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
