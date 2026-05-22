import { GoogleGenAI, Content, ThinkingLevel } from '@google/genai'
import * as dotenv from 'dotenv'
import { IpcMainEvent, ipcMain } from 'electron'
import * as path from 'path'
import { Agent, setGlobalDispatcher, fetch as undiciFetch } from 'undici'
import {
  getSystemToolsPrompt,
  getSubagentSystemPrompt,
  getMasterAgentSystemPrompt,
  runTerminalCommand,
  listApplications,
  openApplication,
  openBrowserLink,
  webSearch,
  sawLinkFromUrl,
  computerCreateFile,
  computerCreateDirectory,
  computerRemoveFile,
  computerRemoveDirectory,
  computerSaveFile,
  computerAppendToFile,
  computerReplaceInFile,
  computerCopyFile,
  computerMoveFile,
  computerGetFileInfo,
  computerListDirectory,
  computerReadFile
} from './systemTools'
import { saveChatSession, loadChatSession, searchChatHistory } from './history'

// Load environment variables from .env
dotenv.config({ path: path.join(__dirname, '../../.env') })

// Configuração de Keep-Alive para melhor latência (3.5 minutos)
const networkAgent = new Agent({
  keepAliveTimeout: 210000,
  keepAliveMaxTimeout: 210000
})
setGlobalDispatcher(networkAgent)
globalThis.fetch = undiciFetch as unknown as typeof globalThis.fetch

// Modelo selecionado atualmente
let currentModelKey = 'prism-5'

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
  }
}

// Fallback order of models (from highest to lowest)
const MODEL_FALLBACK_ORDER = ['prism-5', 'prism-4.3', 'prism-4.2', 'prism-4.1', 'prism-4']

const AGENT_TEMPERATURE = 0.7
const TITLE_GENERATION_TEMPERATURE = 1.4
const DEFAULT_SUBAGENT_MODEL_KEY = 'prism-4.2'
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
    'prism-5': 'Prism 5'
  }
  return names[modelKey] || 'Prism AI'
}

// Persistent history in memory for the current session
let chatHistory: Content[] = []
let currentSessionId: string = Date.now().toString()

export interface ActiveRun {
  chatId: string
  chatHistory: Content[]
  abortController: AbortController
  modelKey: string
}

export const activeRuns = new Map<string, ActiveRun>()

export interface StructuredChatResponse {
  thoughts: string
  finalResponse: string
  rawText: string
  usedFallback: boolean
  isThinking?: boolean
  isWritingToolCall?: boolean
  toolType?: 'task' | 'search'
}

interface ToolArgs extends Record<string, string | undefined> {
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
}

const RAW_TOOL_ARG_TAGS = new Set(['command', 'content', 'oldText', 'newText'])

function unwrapCdata(value: string): string {
  const trimmed = value.trim()
  const cdataMatch = trimmed.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/)
  return cdataMatch ? cdataMatch[1] : value
}

function normalizeToolArg(tag: string, value: string): string {
  const unwrapped = unwrapCdata(value)
  return RAW_TOOL_ARG_TAGS.has(tag) ? unwrapped : unwrapped.trim()
}

function parseToolArgsLegacy(toolContent: string): ToolArgs {
  const args: ToolArgs = {}
  let currentIndex = 0

  while (true) {
    const startMatch = toolContent.substring(currentIndex).match(/<([a-zA-Z0-9_:-]+)>/)
    if (!startMatch || startMatch.index === undefined) break

    const tag = startMatch[1]
    const tagStart = currentIndex + startMatch.index
    const contentStart = tagStart + startMatch[0].length
    const closeTag = `</${tag}>`

    let endIdx = -1
    let searchIndex = contentStart

    while (true) {
      const nextCdata = toolContent.indexOf('<![CDATA[', searchIndex)
      const nextEnd = toolContent.indexOf(closeTag, searchIndex)

      if (nextEnd === -1) break

      if (nextCdata !== -1 && nextCdata < nextEnd) {
        const cdataEnd = toolContent.indexOf(']]>', nextCdata + 9)
        searchIndex = cdataEnd !== -1 ? cdataEnd + 3 : nextCdata + 9
      } else {
        endIdx = nextEnd
        break
      }
    }

    if (endIdx !== -1) {
      const rawValue = toolContent.substring(contentStart, endIdx)
      if (tag !== 'name') {
        args[tag] = normalizeToolArg(tag, rawValue)
      }
      currentIndex = endIdx + closeTag.length
    } else {
      currentIndex = contentStart
    }
  }
  return args
}

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
          let val = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
          if (!RAW_TOOL_ARG_TAGS.has(key)) {
            val = val.trim()
          }
          args[key] = val
        }
      }
      return { name, args }
    } catch (e) {
      console.warn('Tool call looks like JSON but failed to parse. Falling back to XML.', e)
    }
  }

  // Legacy XML format fallback
  const nameMatch = toolContent.match(/<name>(.*?)<\/name>/i)
  const name = nameMatch ? nameMatch[1].trim() : null
  const args = parseToolArgsLegacy(toolContent)
  return { name, args }
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

function normalizeContentsForGemini(contents: Content[]): Content[] {
  const normalized: Content[] = []

  for (const content of contents) {
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
  execute_terminal_command: (args, _event, _apiKey, signal) =>
    runTerminalCommand(args.command || '', signal),
  list_installed_applications: () => listApplications(),
  open_application: (args) => openApplication(args.appPath || ''),
  open_browser_link: (args) => openBrowserLink(args.url || ''),
  web_search: (args, _event, _apiKey, signal) => webSearch(args.query || '', signal),
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
    computerReplaceInFile(args.path || '', args.oldText || '', args.newText || '', signal),
  computer_use_replace_in_file: (args, _event, _apiKey, signal) =>
    computerReplaceInFile(args.path || '', args.oldText || '', args.newText || '', signal),
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
  run_subagents: (args, event, apiKey, signal, chatId) =>
    runSubagents(args, event, apiKey, signal, chatId),
  search_chat_history: (args) => searchChatHistory(args.query || ''),
  // Group Chat tools (handled internally within runSubagents)
  send_group_message: async () => 'Error: send_group_message can only be used by sub-agents.',
  read_group_messages: async () => 'Error: read_group_messages can only be used by sub-agents.',
  wait_for_updates: async () => 'Error: wait_for_updates can only be used by sub-agents.',
  agent_message: async () => 'Error: agent_message is deprecated. Use send_group_message.',
  agent_wait: async () => 'Error: agent_wait is deprecated. Use wait_for_updates.'
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
  if (sender === HUMAN_USER_SENDER || sender === USER_AGENT_INDEX) return 'User (human operator)'
  if (sender === 'master') return 'Master'
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

  // Extract the parent task/goal from the main chat history
  const parentTask =
    chatHistory
      .slice()
      .reverse()
      .find((m) => m.role === 'user')?.parts?.[0]?.text || 'No overall task specified'

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

  // Promise for the Master Coordinator Agent
  const masterPromise = async (): Promise<string> => {
    try {
      if (parentSignal?.aborted) throw new Error('AbortError')

      // Small delay to let the UI register ToolStart
      await new Promise((r) => setTimeout(r, 50))

      const ai = new GoogleGenAI({ apiKey })

      const masterSystemPrompt = getMasterAgentSystemPrompt(subagentModelKey, quantity)

      // Notify UI about master check-in
      const checkInData: SubagentChatLogEntry = {
        agentIndex: 'master',
        content: 'Master Coordinator online. Swarm synchronized.',
        status: 'working',
        timestamp: Date.now(),
        chatId
      }
      if (parentSignal?.aborted) throw new Error('AbortError')
      ipcMain.emit('subagent-message-broadcast', null, checkInData)
      subagentChatLog.push(checkInData)

      const history: Content[] = [
        { role: 'user', parts: [{ text: masterSystemPrompt }] },
        {
          role: 'model',
          parts: [
            { text: `Master Coordinator active. Swarm synchronized. Awaiting subagent progress...` }
          ]
        },
        {
          role: 'user',
          parts: [
            {
              text: `[OVERALL GOAL]: ${parentTask}\n\n[SUBAGENTS ASSIGNED]:\n${prompts
                .slice(0, quantity)
                .map((p, idx) => `- Agent #${idx}: ${p}`)
                .join(
                  '\n'
                )}\n\nStart coordination now. Remember that communication via send_group_message is absolutely mandatory.`
            }
          ]
        }
      ]

      let iteration = 0
      const MAX_AGENT_ITERATIONS = 15
      let finalOutput = ''
      let isMasterFinished = false
      let readCursor = 0

      while (iteration < MAX_AGENT_ITERATIONS && !isMasterFinished && !swarmCompleted) {
        iteration++

        if (parentSignal?.aborted) throw new Error('AbortError')

        // Context Injection: Check for unread messages
        const unreadMessages = blackboard.slice(readCursor).filter((m) => m.sender !== 'master')
        readCursor = blackboard.length

        if (unreadMessages.length > 0) {
          let teamUpdate = '[UNREAD TEAM MESSAGES]:\n'
          for (const msg of unreadMessages) {
            const senderName = getGroupSenderName(msg.sender)
            teamUpdate += `[FROM ${senderName} (${msg.status})]: "${msg.content}"\n`
          }
          history.push({ role: 'user', parts: [{ text: teamUpdate }] })
        }

        // Inject swarm status snapshot
        let activeAgentsList = `[SWARM STATUS SNAPSHOT]:\n- Master Coordinator (You): ${isMasterFinished ? 'done' : 'working'}\n`
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
          update: { agentIndex: 'master', phase: 'thinking' },
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
                sender: 'master',
                content: msgContent,
                timestamp: Date.now(),
                status,
                readBy: ['master']
              })
              notifyWaiters()

              const messageData = {
                agentIndex: 'master',
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
                  agentIndex: 'master',
                  phase: 'tool_use',
                  command: `POST TO GROUP (${status}): "${msgContent}"`
                },
                chatId
              })

              if (status !== 'working') {
                isMasterFinished = true
                swarmCompleted = true
                notifyWaiters() // wake up any waiting subagents to terminate
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
              const hasUnread = blackboard.slice(readCursor).some((m) => m.sender !== 'master')
              if (hasUnread || swarmCompleted) {
                return `\n[SYSTEM]: Resuming immediately.\n`
              }

              if (parentSignal?.aborted) throw new Error('AbortError')
              event.sender.send('chat-tool-update', {
                toolCallName: 'run_subagents',
                update: {
                  agentIndex: 'master',
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
                  agentIndex: 'master',
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
                  agentIndex: 'master',
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
          history.push({
            role: 'user',
            parts: [{ text: `[SYSTEM: TOOL RESULTS]${allResults}\nProceed.` }]
          })
          continue
        }

        break
      }

      if (parentSignal?.aborted) throw new Error('AbortError')
      event.sender.send('chat-tool-update', {
        toolCallName: 'run_subagents',
        update: { agentIndex: 'master', phase: 'done', output: 'Coordination completed.' },
        chatId
      })

      const cleanedOutput = finalOutput.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim()
      return `[MASTER COORDINATOR FINAL REPORT]:\n${cleanedOutput}`
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
        update: { agentIndex: 'master', phase: 'error', output: String(err) },
        chatId
      })
      return `[MASTER COORDINATOR ERROR]:\n${err instanceof Error ? err.message : String(err)}`
    }
  }

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

              if (status !== 'working') isAgentFinished = true
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
          history.push({
            role: 'user',
            parts: [{ text: `[SYSTEM: TOOL RESULTS]${allResults}\nProceed.` }]
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
    const results = await Promise.all([masterPromise, ...agentPromises])
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
  const session = loadChatSession(id)
  if (session) {
    currentSessionId = session.id
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
      ...session.messages
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
        temperature: TITLE_GENERATION_TEMPERATURE
      }
    })
    const fullTitle = (result.text || '').trim()
    return fullTitle || 'Nova Conversa'
  } catch (error) {
    console.error('Failed to generate chat title:', error)
    return 'Nova Conversa'
  }
}

export async function handleChatMessage(
  event: IpcMainEvent,
  data: string | { message: string; thinkMode?: boolean; chatId?: string; extendedSearch?: boolean }
): Promise<void> {
  const message = typeof data === 'string' ? data : data.message
  const thinkMode = typeof data === 'object' ? !!data.thinkMode : false
  const chatId = typeof data === 'object' && data.chatId ? data.chatId : currentSessionId
  const extendedSearch = typeof data === 'object' ? !!data.extendedSearch : false

  // Priority: User key > Environment key
  const apiKey = userApiKey || process.env.GEMINI_API_KEY

  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_api_key_here') {
    // If there is no key, we send a specific error message so that the front-end
    // can trigger the API Key modal if necessary.
    event.sender.send('chat-reply-error', { error: 'API_KEY_MISSING', chatId })
    return
  }

  // Prevent duplicate concurrent runs for the same chatId
  if (activeRuns.has(chatId)) {
    console.log(`Chat ${chatId} is already running. Ignoring duplicate message.`)
    return
  }

  // Retrieve or initialize history for this run
  let runHistory: Content[] = []
  if (chatId === currentSessionId && chatHistory.length > 0) {
    runHistory = chatHistory
  } else {
    const session = loadChatSession(chatId)
    if (session) {
      runHistory = [
        {
          role: 'system',
          parts: [{ text: getSystemToolsPrompt(currentModelKey, 'main', extendedSearch) }]
        },
        {
          role: 'system',
          parts: [
            {
              text: 'Understood. I am Prism, your automation AI. I will use <tool_call> to interact with the system when necessary, staying focused on your initial goal.'
            }
          ]
        },
        ...session.messages
      ]
    } else {
      runHistory = [
        {
          role: 'system',
          parts: [{ text: getSystemToolsPrompt(currentModelKey, 'main', extendedSearch) }]
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
  }

  // A session is considered "new" for title generation if it only has the initial system/model messages
  const isFirstUserMessage = runHistory.length <= 2

  // Detect if it is the video command
  const isYoutube = message.startsWith('/youtube')
  const basePrompt = getSystemToolsPrompt(currentModelKey, 'main', extendedSearch)

  if (isYoutube) {
    const youtubeInstructions = `----------- IMPORTANT: USER USED A SLASH COMMAND, DO WHAT I WILL SAY -------------
The user wants to search and play a video. Use web_search to find the most relevant video or album link, and then use open_browser_link to open the link found.
---------- FINISHED SLASH COMMAND REQUIREMENT ---------

`
    if (runHistory.length > 0 && runHistory[0].role === 'system') {
      runHistory[0].parts = [{ text: youtubeInstructions + basePrompt }]
    }
  } else {
    // Ensure the prompt returns to normal if not /youtube
    if (runHistory.length > 0 && runHistory[0].role === 'system') {
      runHistory[0].parts = [{ text: basePrompt }]
    }
  }

  // Add the user's real question to the manual history
  runHistory.push({ role: 'user', parts: [{ text: message }] })

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
        const MAX_ITERATIONS = extendedSearch ? 35 : 10

        while (iterationCount < MAX_ITERATIONS) {
          iterationCount++

          // Check if aborted before each AI call
          if (runAbortController.signal.aborted) throw new Error('AbortError')

          // We send ALL content of the history manually at each iteration
          const result = await ai.models.generateContentStream({
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
          let isThinking = false

          for await (const chunk of result) {
            // Check if aborted during stream processing
            if (runAbortController.signal.aborted) throw new Error('AbortError')

            const parts = chunk.candidates?.[0]?.content?.parts || []
            for (const part of parts) {
              // Check for thought property in a type-safe way
              if (part && typeof part === 'object' && 'thought' in part && part.thought) {
                currentThoughts += part.text || ''
                isThinking = true
              } else if (part.text) {
                currentFinalResponse += part.text
                isThinking = false
              }
            }

            if (currentThoughts || currentFinalResponse) {
              const fullResponse = accumulatedFinalResponse + currentFinalResponse
              const isWritingToolCall =
                (fullResponse.includes('<tool_call>') && !fullResponse.includes('</tool_call>')) ||
                (fullResponse.includes('<mini_app>') && !fullResponse.includes('</mini_app>'))

              let toolType: 'task' | 'search' | 'mini-app' | undefined = undefined

              if (isWritingToolCall) {
                if (fullResponse.includes('<mini_app>')) {
                  toolType = 'mini-app'
                } else {
                  const isSearch =
                    fullResponse.includes('<name>web_search</name>') ||
                    fullResponse.includes('<name>search_chat_history</name>')
                  toolType = isSearch ? 'search' : 'task'
                }
              }

              event.sender.send('chat-reply-chunk', {
                thoughts: (accumulatedThoughts + currentThoughts).trim(),
                finalResponse: fullResponse.trim(),
                rawText: accumulatedThoughts + currentThoughts + fullResponse,
                usedFallback: usedFallback,
                isThinking: isThinking,
                isWritingToolCall: isWritingToolCall,
                toolType: toolType,
                chatId: chatId
              })
            }
          }

          // Add the AI response (whether text or Tool Call) to history
          const fullAiResponse = currentFinalResponse
          if (fullAiResponse.trim()) {
            runHistory.push({ role: 'model', parts: [{ text: fullAiResponse }] })
            saveChatSession(chatId, runHistory)
          }

          accumulatedThoughts += currentThoughts
          accumulatedFinalResponse += currentFinalResponse

          const toolMatches = extractToolCalls(fullAiResponse)

          if (toolMatches.length > 0) {
            const toolPromises = toolMatches.map(async (toolContent) => {
              const { name, args: toolArgs } = parseToolCall(toolContent)

              if (name && toolFunctions[name]) {
                event.sender.send('chat-tool-start', {
                  name,
                  args: toolArgs,
                  timestamp: Date.now(),
                  chatId
                })

                let toolResult = ''
                try {
                  // Check if aborted before running tool
                  const signal = runAbortController.signal
                  if (signal?.aborted) throw new Error('AbortError')
                  toolResult = await toolFunctions[name](toolArgs, event, apiKey, signal, chatId)
                } catch (err) {
                  if (
                    runAbortController.signal.aborted ||
                    (err instanceof Error &&
                      (err.name === 'AbortError' || err.name === 'GoogleGenerativeAIAbortError'))
                  ) {
                    toolResult = 'Cancelled by user.'
                    event.sender.send('chat-tool-end', { name, result: toolResult, chatId })
                    throw new Error('AbortError')
                  }
                  toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`
                }

                event.sender.send('chat-tool-end', { name, result: toolResult, chatId })
                return `\n[RESULT FOR ${name}]:\n${toolResult}\n`
              }
              return ''
            })

            const results = await Promise.all(toolPromises)
            const allToolResults = results.join('')

            if (allToolResults) {
              const systemFeedback = `[SYSTEM: TOOL RESULTS]${allToolResults}\nAnalyze these results and proceed. If the goal is achieved, finalize. If more steps are needed, use another tool.`
              runHistory.push({ role: 'system', parts: [{ text: systemFeedback }] })
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
        if (currentIndex !== -1 && currentIndex < MODEL_FALLBACK_ORDER.length - 1) {
          // Try the next model
          currentModelKey = MODEL_FALLBACK_ORDER[currentIndex + 1]
          usedFallback = true

          const friendlyName = getModelFriendlyName(currentModelKey)
          const fallbackInstruction = `[SYSTEM: FALLBACK] An API error occurred with the previous model. You have been activated as ${friendlyName} to continue. Please analyze the history above and proceed with the task from where it left off. Briefly inform the user that a technical model switch occurred to ensure completion of the request.`

          runHistory.push({ role: 'system', parts: [{ text: fallbackInstruction }] })
          saveChatSession(chatId, runHistory)

          // Notify the UI about the model change (optional, but good to keep in sync)
          event.sender.send('model-changed', currentModelKey)

          console.log(`Fallback activated: New model ${currentModelKey}`)
          continue // Try again with the new model (success remains false)
        } else {
          // All models failed
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
