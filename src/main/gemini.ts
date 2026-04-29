import { GoogleGenerativeAI, Content } from '@google/generative-ai'
import * as dotenv from 'dotenv'
import { IpcMainEvent, ipcMain } from 'electron'
import { Agent, setGlobalDispatcher } from 'undici'
import {
  getSystemToolsPrompt,
  getSubagentSystemPrompt,
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
  computerReplaceInFile,
  computerListDirectory,
  computerReadFile
} from './systemTools'
import { saveChatSession, loadChatSession, searchChatHistory } from './history'

// Load environment variables from .env
dotenv.config({ path: require('path').join(__dirname, '../../.env') })

// Configuração de Keep-Alive para melhor latência (3.5 minutos)
const networkAgent = new Agent({
  keepAliveTimeout: 210000,
  keepAliveMaxTimeout: 210000
})
setGlobalDispatcher(networkAgent)

// Modelo selecionado atualmente
let currentModelKey = 'prism-3'

interface ModelConfig {
  apiModel: string
  thinkingConfig?: {
    thinkingBudget?: number
    thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'
    includeThoughts?: boolean
  }
}

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'prism-2': {
    apiModel: 'gemini-2.5-flash-lite',
    thinkingConfig: { thinkingBudget: 0, includeThoughts: true }
  },
  'prism-2.5': {
    apiModel: 'gemini-3.1-flash-lite-preview',
    thinkingConfig: { thinkingLevel: 'MINIMAL', includeThoughts: true }
  },
  'prism-3': {
    apiModel: 'gemma-4-26b-a4b-it',
    thinkingConfig: { thinkingLevel: 'MINIMAL', includeThoughts: true }
  },
  'prism-3.1': {
    apiModel: 'gemma-4-31b-it',
    thinkingConfig: { thinkingLevel: 'MINIMAL', includeThoughts: false }
  }
}

// Fallback order of models (from highest to lowest)
const MODEL_FALLBACK_ORDER = ['prism-3.1', 'prism-3', 'prism-2.5', 'prism-2']

/**
 * Returns the friendly name of the model based on the key.
 */
function getModelFriendlyName(modelKey: string): string {
  const names: Record<string, string> = {
    'prism-2': 'Prism 2',
    'prism-2.5': 'Prism 2.5',
    'prism-3': 'Prism 3',
    'prism-3.1': 'Prism 3.1'
  }
  return names[modelKey] || 'Prism AI'
}

// Persistent history in memory for the current session
let chatHistory: Content[] = []
let currentSessionId: string = Date.now().toString()

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
  quantity?: string
}

const toolFunctions: Record<
  string,
  (args: ToolArgs, event: IpcMainEvent, apiKey: string, signal?: AbortSignal) => Promise<string>
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
  computer_use_replace_in_file: (args, _event, _apiKey, signal) =>
    computerReplaceInFile(args.path || '', args.oldText || '', args.newText || '', signal),
  computer_use_list_directory: (args, _event, _apiKey, signal) =>
    computerListDirectory(args.path || '', signal),
  computer_use_read_file: (args, _event, _apiKey, signal) =>
    computerReadFile(args.path || '', signal),
  run_subagents: (args, event, apiKey, signal) => runSubagents(args, event, apiKey, signal),
  search_chat_history: (args) => searchChatHistory(args.query || ''),
  // Group Chat tools (handled internally within runSubagents)
  send_group_message: async () => 'Error: send_group_message can only be used by sub-agents.',
  read_group_messages: async () => 'Error: read_group_messages can only be used by sub-agents.',
  wait_for_updates: async () => 'Error: wait_for_updates can only be used by sub-agents.',
  agent_message: async () => 'Error: agent_message is deprecated. Use send_group_message.',
  agent_wait: async () => 'Error: agent_wait is deprecated. Use wait_for_updates.'
}

interface GroupMessage {
  sender: number
  content: string
  timestamp: number
  status: 'working' | 'done' | 'error'
  readBy: number[]
}

/**
 * Runs multiple sub-agents in parallel to perform specific tasks.
 */
async function runSubagents(
  args: ToolArgs,
  event: IpcMainEvent,
  apiKey: string,
  parentSignal?: AbortSignal
): Promise<string> {
  const quantity = parseInt(args.quantity || '1')
  const prompts: string[] = []
  for (let i = 1; i <= 20; i++) {
    const p = args[`prompt:${i}`]
    if (p) prompts.push(p)
  }

  if (prompts.length === 0) return 'Error: No prompts provided for agents.'

  const blackboard: GroupMessage[] = []
  const waiters: (() => void)[] = []
  const subagentChatLog: any[] = []

  const notifyWaiters = () => {
    while (waiters.length > 0) {
      const resolve = waiters.shift()
      if (resolve) resolve()
    }
  }

  // Listener for external messages (from UI/User)
  const externalMessageListener = (_event: any, data: any) => {
    if (data && data.agentIndex === -1) {
      blackboard.push({
        sender: -1,
        content: data.content,
        timestamp: Date.now(),
        status: 'working',
        readBy: []
      })
      subagentChatLog.push(data)
    }
    notifyWaiters()
  }
  ipcMain.on('subagent-message-broadcast', externalMessageListener)

  const agentPromises = prompts.slice(0, quantity).map(async (prompt, index) => {
    try {
      if (parentSignal?.aborted) throw new Error('AbortError')

      // Small delay to ensure ToolStart event is processed by the frontend before sub-events
      await new Promise(r => setTimeout(r, 100))

      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({
        model: MODEL_CONFIGS['prism-3.1'].apiModel,
        generationConfig: {
          thinkingConfig: {
            thinkingLevel: 'HIGH',
            includeThoughts: false
          }
        }
      } as any)

      const subAgentSystemPrompt = getSubagentSystemPrompt('prism-3.1', index, quantity)

      // Notify UI about agent check-in
      const checkInData = {
        agentIndex: index,
        content: 'Checking in. Joined Group Chat.',
        status: 'working',
        timestamp: Date.now()
      }
      if (parentSignal?.aborted) throw new Error('AbortError')
      event.sender.send('subagent-message', checkInData)
      ipcMain.emit('subagent-message-broadcast', null, checkInData)
      subagentChatLog.push(checkInData)

      const history: Content[] = [
        { role: 'user', parts: [{ text: subAgentSystemPrompt }] },
        { role: 'model', parts: [{ text: `Agent #${index} checking in. Joined Group Chat. Awaiting initial task...` }] },
        { role: 'user', parts: [{ text: `[YOUR ASSIGNED TASK]: ${prompt}\n\nInitiate your work now.` }] }
      ]

      let iteration = 0
      const MAX_AGENT_ITERATIONS = 15
      let finalOutput = ''
      let isAgentFinished = false
      let readCursor = 0

      while (iteration < MAX_AGENT_ITERATIONS && !isAgentFinished) {
        iteration++

        if (parentSignal?.aborted) throw new Error('AbortError')

        // 1. Context Injection: Check for unread messages
        const unreadMessages = blackboard.slice(readCursor).filter((m) => m.sender !== index)
        readCursor = blackboard.length

        if (unreadMessages.length > 0) {
          let teamUpdate = '[UNREAD MESSAGES]:\n'
          for (const msg of unreadMessages) {
            const senderName = msg.sender === -1 ? 'User' : `Agent #${msg.sender}`
            teamUpdate += `[FROM ${senderName} (${msg.status})]: "${msg.content}"\n`
          }
          history.push({ role: 'user', parts: [{ text: teamUpdate }] })
        }

        if (parentSignal?.aborted) throw new Error('AbortError')
        event.sender.send('chat-tool-update', {
          toolCallName: 'run_subagents',
          update: { agentIndex: index, phase: 'thinking' }
        })

        const result = await model.generateContent({ contents: history }, { signal: parentSignal })
        const responseText = result.response.text()

        // Add to history
        history.push({ role: 'model', parts: [{ text: responseText }] })
        finalOutput = responseText

        const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi
        const toolMatches = Array.from(responseText.matchAll(toolCallRegex))

        if (toolMatches.length > 0) {
          let allResults = ''
          for (const match of toolMatches) {
            const content = match[1]
            const name = content.match(/<name>(.*?)<\/name>/i)?.[1]?.trim()

            const subArgs: ToolArgs = {}
            const dynamicArgRegex = /<([^>]+)>([\s\S]*?)<\/\1>/gi
            let argMatch
            while ((argMatch = dynamicArgRegex.exec(content)) !== null) {
              const tag = argMatch[1].trim()
              if (tag !== 'name') subArgs[tag] = argMatch[2].trim()
            }

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

              // Broadcast message to UI
              const messageData = {
                agentIndex: index,
                content: msgContent,
                status,
                timestamp: Date.now()
              }
              if (parentSignal?.aborted) throw new Error('AbortError')
              event.sender.send('subagent-message', messageData)
              ipcMain.emit('subagent-message-broadcast', null, messageData)
              subagentChatLog.push(messageData)

              if (parentSignal?.aborted) throw new Error('AbortError')
              event.sender.send('chat-tool-update', {
                toolCallName: 'run_subagents',
                update: {
                  agentIndex: index,
                  phase: 'tool_use',
                  command: `POST TO GROUP (${status}): "${msgContent}"`
                }
              })

              if (status !== 'working') isAgentFinished = true
              allResults += `\n[SYSTEM]: Message broadcasted. Status set to ${status}.\n`
              continue
            }

            if (name === 'read_group_messages') {
              const since = parseInt(subArgs.sinceTimestamp || '0')
              const limit = parseInt(subArgs.limit || '10')
              const filtered = blackboard.filter((m) => m.timestamp > since).slice(-limit)

              allResults += `\n[GROUP CHAT HISTORY]:\n${filtered
                .map((m) => {
                  const senderName = m.sender === -1 ? 'User' : `Agent #${m.sender}`
                  return `${senderName} (${m.status}): ${m.content}`
                })
                .join('\n')}\n`
              continue
            }

            if (name === 'wait_for_updates') {
              const timeout = Math.min(parseInt(subArgs.timeoutSeconds || '180'), 180)

              // Check if there are already unread messages to avoid race condition
              const hasUnread = blackboard.slice(readCursor).some(m => m.sender !== index)
              if (hasUnread) {
                allResults += `\n[SYSTEM]: Resuming immediately as new messages were found.\n`
                continue
              }

              if (parentSignal?.aborted) throw new Error('AbortError')
              event.sender.send('chat-tool-update', {
                toolCallName: 'run_subagents',
                update: {
                  agentIndex: index,
                  phase: 'tool_use',
                  command: `WAITING FOR UPDATES...`
                }
              })

              await Promise.race([
                new Promise<void>((r) => waiters.push(r)),
                new Promise<void>((r) => setTimeout(r, timeout * 1000)),
                new Promise<void>((_, reject) => {
                  if (parentSignal?.aborted) reject(new Error('AbortError'))
                  parentSignal?.addEventListener('abort', () => reject(new Error('AbortError')))
                })
              ])

              allResults += `\n[SYSTEM]: Resuming after update or timeout.\n`
              continue
            }

            if (name && toolFunctions[name]) {
              if (parentSignal?.aborted) throw new Error('AbortError')

              event.sender.send('chat-tool-update', {
                toolCallName: 'run_subagents',
                update: {
                  agentIndex: index,
                  phase: 'tool_use',
                  command: `${name} (${JSON.stringify(subArgs)})`
                }
              })

              const toolResult = await toolFunctions[name](subArgs, event, apiKey, parentSignal)
              allResults += `\n[RESULT FOR ${name}]:\n${toolResult}\n`

              if (parentSignal?.aborted) throw new Error('AbortError')

              event.sender.send('chat-tool-update', {
                toolCallName: 'run_subagents',
                update: {
                  agentIndex: index,
                  phase: 'tool_use',
                  command: `${name}`,
                  output: toolResult.substring(0, 100) + (toolResult.length > 100 ? '...' : '')
                }
              })
            }
          }

          history.push({ role: 'user', parts: [{ text: `[SYSTEM: TOOL RESULTS]${allResults}\nProceed.` }] })
          continue
        }

        break // No tool calls, agent finished normally
      }

      if (parentSignal?.aborted) throw new Error('AbortError')
      event.sender.send('chat-tool-update', {
        toolCallName: 'run_subagents',
        update: { agentIndex: index, phase: 'done', output: 'Task completed.' }
      })

      // Clean final output from thoughts
      const cleanedOutput = finalOutput.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim()
      return `[AGENT #${index} FINAL REPORT]:\n${cleanedOutput}`
    } catch (err) {
      if (parentSignal?.aborted || (err instanceof Error && (err.name === 'AbortError' || err.name === 'GoogleGenerativeAIAbortError'))) {
        throw new Error('AbortError')
      }

      event.sender.send('chat-tool-update', {
        toolCallName: 'run_subagents',
        update: { agentIndex: index, phase: 'error', output: String(err) }
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
  currentSessionId = Date.now().toString()
  chatHistory = [
    { role: 'user', parts: [{ text: getSystemToolsPrompt(currentModelKey) }] },
    {
      role: 'model',
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
      { role: 'user', parts: [{ text: getSystemToolsPrompt(currentModelKey) }] },
      {
        role: 'model',
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

// API Key provided by the user manually
let userApiKey: string | null = null

/**
 * Sets the user's API key manually.
 */
export function setUserApiKey(key: string): void {
  userApiKey = key
}

let abortController: AbortController | null = null

const CANCEL_MESSAGE = '-------------- You cancelled AI response ----------------'

export function cancelChatMessage(): void {
  if (abortController) {
    abortController.abort()
  }
}

/**
 * Generates a short title for the chat session based on the first message.
 */
async function generateChatTitle(
  apiKey: string,
  firstMessage: string
): Promise<string> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: 'gemma-3-27b-it'
    })

    const prompt = `Crie um título curtíssimo (máximo 5 palavras) para esta conversa baseada na mensagem: "${firstMessage}". Responda APENAS o título, sem aspas. O título DEVE estar no mesmo idioma do pedido do usuário.`

    const result = await model.generateContent(prompt)
    const fullTitle = result.response.text().trim()
    return fullTitle || 'Nova Conversa'
  } catch (error) {
    console.error('Failed to generate chat title:', error)
    return 'Nova Conversa'
  }
}

export async function handleChatMessage(
  event: IpcMainEvent,
  data: string | { message: string; thinkMode?: boolean }
): Promise<void> {
  const message = typeof data === 'string' ? data : data.message
  const thinkMode = typeof data === 'object' ? !!data.thinkMode : false

  // Priority: User key > Environment key
  const apiKey = userApiKey || process.env.GEMINI_API_KEY
  
  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_api_key_here') {
    // If there is no key, we send a specific error message so that the front-end
    // can trigger the API Key modal if necessary.
    event.sender.send('chat-reply-error', 'API_KEY_MISSING')
    return
  }

  // Initialize history if empty
  if (chatHistory.length === 0) {
    initGemini()
  }

  // A session is considered "new" for title generation if it only has the initial system/model messages
  const isFirstUserMessage = chatHistory.length <= 2
  
  // Detect if it is the /youtube command
  const isYoutube = message.startsWith('/youtube')
  const basePrompt = getSystemToolsPrompt(currentModelKey)
  
  if (isYoutube) {
    const youtubeInstructions = `----------- IMPORTANT: USER USED A SLASH COMMAND, DO WHAT I WILL SAY -------------
The user wants to search and play something on YouTube. Use web_search to find the most relevant YouTube video or album link, and then use open_browser_link to open the link found.
---------- FINISHED SLASH COMMAND REQUIREMENT ---------

`
    if (chatHistory.length > 0 && chatHistory[0].role === 'user') {
      chatHistory[0].parts[0].text = youtubeInstructions + basePrompt
    }
  } else {
    // Ensure the prompt returns to normal if not /youtube
    if (chatHistory.length > 0 && chatHistory[0].role === 'user') {
      chatHistory[0].parts[0].text = basePrompt
    }
  }

  // Add the user's real question to the manual history
  chatHistory.push({ role: 'user', parts: [{ text: message }] })

  // If it's the first message, prepare the UI and start title generation
  if (isFirstUserMessage && apiKey) {
    // Save session with EMPTY title to trigger loading state in sidebar if refreshed from disk
    saveChatSession(currentSessionId, chatHistory, '')
    event.sender.send('chat-session-created', { id: currentSessionId })
    
    generateChatTitle(apiKey, message).then((finalTitle) => {
      event.sender.send('chat-title-received', { id: currentSessionId, title: finalTitle })
      saveChatSession(currentSessionId, chatHistory, finalTitle)
    })
  } else {
    // Regular save for existing sessions
    saveChatSession(currentSessionId, chatHistory)
  }

  let usedFallback = false
  let success = false

  // Notify the start of the response ONLY ONCE
  event.sender.send('chat-reply-start')

  // Create abort controller for this request session
  abortController = new AbortController()

  while (!success) {
    // Check if aborted before starting/restarting
    if (abortController?.signal.aborted) {
      event.sender.send('chat-reply-error', CANCEL_MESSAGE)
      abortController = null
      return
    }

    try {
      const config = { ...(MODEL_CONFIGS[currentModelKey] || MODEL_CONFIGS['prism-3']) }
      
      // Dynamic Thinking Config
      if (thinkMode) {
        if (currentModelKey === 'prism-2') {
          config.thinkingConfig = { thinkingBudget: -1, includeThoughts: true }
        } else {
          config.thinkingConfig = { thinkingLevel: 'HIGH', includeThoughts: true }
        }
      } else {
        if (currentModelKey === 'prism-2') {
          config.thinkingConfig = { thinkingBudget: 0, includeThoughts: true }
        } else {
          const defaultInclude = MODEL_CONFIGS[currentModelKey]?.thinkingConfig?.includeThoughts ?? true
          config.thinkingConfig = { thinkingLevel: 'MINIMAL', includeThoughts: defaultInclude }
        }
      }

      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({
        model: config.apiModel,
        generationConfig: {
          thinkingConfig: config.thinkingConfig
        }
      } as any) // Type cast since thinkingConfig might not be in the official types yet

      let accumulatedThoughts = ''
      let accumulatedFinalResponse = ''
      let iterationCount = 0
      const MAX_ITERATIONS = 10

      while (iterationCount < MAX_ITERATIONS) {
        iterationCount++
        
        // Check if aborted before each AI call
        if (abortController?.signal.aborted) throw new Error('AbortError')

        // We send ALL content of the history manually at each iteration
        const result = await model.generateContentStream({ 
          contents: chatHistory 
        }, { signal: abortController?.signal })

        let currentThoughts = ''
        let currentFinalResponse = ''
        let isThinking = false

        for await (const chunk of result.stream) {
          // Check if aborted during stream processing
          if (abortController?.signal.aborted) throw new Error('AbortError')

          const parts = chunk.candidates?.[0]?.content?.parts || []
          for (const part of parts) {
            // Check for thought property in a type-safe way
            if (part && typeof part === 'object' && 'thought' in part && part.thought) {
              currentThoughts += part.text
              isThinking = true
            } else if (part.text) {
              currentFinalResponse += part.text
              isThinking = false
            }
          }

          if (currentThoughts || currentFinalResponse) {
            const fullResponse = accumulatedFinalResponse + currentFinalResponse
            const isWritingToolCall =
              fullResponse.includes('<tool_call>') && !fullResponse.includes('</tool_call>')
            let toolType: 'task' | 'search' | undefined = undefined

            if (isWritingToolCall) {
              const isSearch = 
                fullResponse.includes('<name>web_search</name>') || 
                fullResponse.includes('<name>search_chat_history</name>')
              toolType = isSearch ? 'search' : 'task'
            }

            event.sender.send('chat-reply-chunk', {
              thoughts: (accumulatedThoughts + currentThoughts).trim(),
              finalResponse: fullResponse.trim(),
              rawText: accumulatedThoughts + currentThoughts + fullResponse,
              usedFallback: usedFallback,
              isThinking: isThinking,
              isWritingToolCall: isWritingToolCall,
              toolType: toolType
            })
          }
        }

        // Add the AI response (whether text or Tool Call) to history
        const fullAiResponse = currentThoughts + currentFinalResponse
        chatHistory.push({ role: 'model', parts: [{ text: fullAiResponse }] })

        accumulatedThoughts += currentThoughts
        accumulatedFinalResponse += currentFinalResponse

        // Search for all <tool_call> tags in the response
        const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi
        const toolMatches = Array.from(fullAiResponse.matchAll(toolCallRegex))

        if (toolMatches.length > 0) {
          let allToolResults = ''

          for (const match of toolMatches) {
            const toolContent = match[1]
            const nameMatch = toolContent.match(/<name>(.*?)<\/name>/i)
            const name = nameMatch ? nameMatch[1].trim() : null

            if (name && toolFunctions[name]) {
              const toolArgs: ToolArgs = {}

              // Extract all potential arguments dynamically
              const dynamicArgRegex = /<([^>]+)>([\s\S]*?)<\/\1>/gi
              let argMatch
              while ((argMatch = dynamicArgRegex.exec(toolContent)) !== null) {
                const tag = argMatch[1].trim()
                if (tag !== 'name') {
                  toolArgs[tag] = argMatch[2].trim()
                }
              }

              event.sender.send('chat-tool-start', { name, args: toolArgs, timestamp: Date.now() })

              let toolResult = ''
              try {
                // Check if aborted before running tool
                const signal = abortController?.signal
                if (signal?.aborted) throw new Error('AbortError')
                toolResult = await toolFunctions[name](toolArgs, event, apiKey, signal)
              } catch (err) {
                if (abortController?.signal.aborted || (err instanceof Error && (err.name === 'AbortError' || err.name === 'GoogleGenerativeAIAbortError'))) {
                  toolResult = 'Cancelled by user.'
                  event.sender.send('chat-tool-end', { name, result: toolResult })
                  throw new Error('AbortError')
                }
                toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`
              }

              event.sender.send('chat-tool-end', { name, result: toolResult })
              allToolResults += `\n[RESULT FOR ${name}]:\n${toolResult}\n`
            }
          }

          if (allToolResults) {
            const systemFeedback = `[SYSTEM: TOOL RESULTS]${allToolResults}\nAnalyze these results and proceed. If the goal is achieved, finalize. If more steps are needed, use another tool.`
            chatHistory.push({ role: 'user', parts: [{ text: systemFeedback }] })
            continue
          }
        }

        // If no tool call or the loop ended, send the end of the response
        event.sender.send('chat-reply-end', {
          thoughts: accumulatedThoughts.trim(),
          finalResponse: accumulatedFinalResponse.trim(),
          rawText: accumulatedThoughts + accumulatedFinalResponse,
          usedFallback: usedFallback,
          isThinking: false
        })

        // Save session after AI response
        saveChatSession(currentSessionId, chatHistory)

        // Auto-minimize logic: if simple task (<= 100 chars excluding tools)
        const cleanResponse = accumulatedFinalResponse.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim()
        if (cleanResponse.length <= 100) {
          event.sender.send('auto-minimize-trigger')
        }

        success = true
        abortController = null
        return // Exit function after success
      }
      
      // If exiting the iteration loop without success (e.g. reached MAX_ITERATIONS)
      success = true
      abortController = null
    } catch (error) {
      // Robust check for user-initiated abort
      if (abortController?.signal.aborted || (error instanceof Error && (error.name === 'AbortError' || error.name === 'GoogleGenerativeAIAbortError'))) {
        console.log('Chat request aborted by user')
        event.sender.send('chat-reply-error', CANCEL_MESSAGE)
        success = true
        abortController = null
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

        chatHistory.push({ role: 'user', parts: [{ text: fallbackInstruction }] })

        // Notify the UI about the model change (optional, but good to keep in sync)
        event.sender.send('model-changed', currentModelKey)
        
        console.log(`Fallback activated: New model ${currentModelKey}`)
        continue // Try again with the new model (success remains false)
      } else {
        // All models failed
        const errorMessage = error instanceof Error ? error.message : String(error)
        event.sender.send('chat-reply-error', errorMessage)
        success = true // End the loop anyway
        abortController = null
      }
    }
  }
}
