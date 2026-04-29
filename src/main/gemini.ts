import { GoogleGenerativeAI, Content } from '@google/generative-ai'
import * as dotenv from 'dotenv'
import { IpcMainEvent } from 'electron'
import { Agent, setGlobalDispatcher } from 'undici'
import {
  getSystemToolsPrompt,
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

// Load environment variables from .env
dotenv.config({ path: require('path').join(__dirname, '../../.env') })

// Configuração de Keep-Alive para melhor latência
const networkAgent = new Agent({
  keepAliveTimeout: 60000,
  keepAliveMaxTimeout: 60000
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
  // These tools are handled internally within runSubagents
  agent_message: async () => 'Error: agent_message can only be used by sub-agents.',
  agent_wait: async () => 'Error: agent_wait can only be used by sub-agents.'
}

interface BlackboardMessage {
  sender: number
  recipient: number | 'all'
  content: string
  timestamp: number
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

  const blackboard: BlackboardMessage[] = []

  const agentPromises = prompts.slice(0, quantity).map(async (prompt, index) => {
    try {
      if (parentSignal?.aborted) throw new Error('AbortError')

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

      const otherAgents = Array.from({ length: quantity }, (_, i) => i).filter(i => i !== index)
      const identityPrompt = `\n\n[IDENTITY]: Agent #${index}. Team: ${otherAgents.map(i => `Agent #${i}`).join(', ')}.
[RADIO BUS]: Use agent_message(to, content) & agent_wait(target, sec) for real-time sync.
[RULES]:
1. PLAN: agent_message strategy before tool use.
2. SYNC: Keep team updated on actions.
3. EXIT: Message "all" to check for needs + agent_wait(any, 60) before finishing. End only if ALL CLEAR.`

      const subAgentSystemPrompt = getSystemToolsPrompt('prism-3.1') + 
        '\n\n[MODE]: Autonomous unit.' + identityPrompt + 
        '\n\n[OUTPUT]: Thoughts private. FINAL RESPONSE is mission report. Team must finish together.'
      
      const history: Content[] = [
        { role: 'user', parts: [{ text: subAgentSystemPrompt }] },
        { role: 'model', parts: [{ text: `Agent #${index} checking in. Radio link established. Awaiting initial task...` }] },
        { role: 'user', parts: [{ text: `[YOUR ASSIGNED TASK]: ${prompt}\n\nInitiate team planning phase now.` }] }
      ]

      let iteration = 0
      const MAX_AGENT_ITERATIONS = 12
      let finalOutput = ''

      while (iteration < MAX_AGENT_ITERATIONS) {
        iteration++
        
        if (parentSignal?.aborted) throw new Error('AbortError')

        // 1. Context Injection: Check for unread messages
        const unreadMessages = blackboard.filter(m => 
          (m.recipient === index || m.recipient === 'all') && 
          !m.readBy.includes(index)
        )

        if (unreadMessages.length > 0) {
          let teamUpdate = '[INCOMING RADIO LOG]:\n'
          for (const msg of unreadMessages) {
            teamUpdate += `[FROM Agent #${msg.sender}]: "${msg.content}"\n`
            msg.readBy.push(index)
          }
          teamUpdate += '\nRespond to your team or proceed with your task based on this information.'
          history.push({ role: 'user', parts: [{ text: teamUpdate }] })
        }

        event.sender.send('chat-tool-update', {
          toolCallName: 'run_subagents',
          update: { agentIndex: index, phase: 'thinking' }
        })

        const result = await model.generateContent({ contents: history }, { signal: parentSignal })
        const responseText = result.response.text()
        
        // Add to history
        history.push({ role: 'model', parts: [{ text: responseText }] })
        
        // Extract final text (filtered from thoughts later)
        finalOutput = responseText

        const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi
        const toolMatches = Array.from(responseText.matchAll(toolCallRegex))

        if (toolMatches.length > 0) {
          let allResults = ''
          for (const match of toolMatches) {
            const content = match[1]
            const name = content.match(/<name>(.*?)<\/name>/i)?.[1]?.trim()
            
            if (name === 'run_subagents') {
              allResults += '\n[ERROR]: Sub-agents are forbidden from using run_subagents tool.\n'
              continue
            }

            const subArgs: ToolArgs = {}
            const dynamicArgRegex = /<([^>]+)>([\s\S]*?)<\/\1>/gi
            let argMatch
            while ((argMatch = dynamicArgRegex.exec(content)) !== null) {
              const tag = argMatch[1].trim()
              if (tag !== 'name') subArgs[tag] = argMatch[2].trim()
            }

            if (name === 'agent_message') {
              const recipient = subArgs.recipient === 'all' ? 'all' : parseInt(subArgs.recipient || '-1')
              const msgContent = subArgs.content || ''
              
              blackboard.push({
                sender: index,
                recipient: recipient as any,
                content: msgContent,
                timestamp: Date.now(),
                readBy: []
              })

              const isListening = recipient === 'all' ? true : blackboard.some(m => m.readBy.includes(recipient as number)) // simplistic check

              event.sender.send('chat-tool-update', {
                toolCallName: 'run_subagents',
                update: { 
                  agentIndex: index, 
                  phase: 'tool_use', 
                  command: `MESSAGE TO ${recipient}: "${msgContent}"` 
                }
              })
              
              allResults += `\n[SYSTEM]: Message sent to ${recipient}. Status: ${isListening ? 'Delivered' : 'Pending'}.\n`
              continue
            }

            if (name === 'agent_wait') {
              const target = subArgs.targetAgent === 'any' ? 'any' : parseInt(subArgs.targetAgent || '-1')
              const timeout = Math.min(parseInt(subArgs.timeoutSeconds || '240'), 240)
              
              event.sender.send('chat-tool-update', {
                toolCallName: 'run_subagents',
                update: { 
                  agentIndex: index, 
                  phase: 'tool_use', 
                  command: `WAITING FOR ${target}...` 
                }
              })

              const startTime = Date.now()
              let receivedMessage: BlackboardMessage | undefined = undefined

              while (Date.now() - startTime < timeout * 1000) {
                if (parentSignal?.aborted) throw new Error('AbortError')

                receivedMessage = blackboard.find(m => 
                  (target === 'any' || m.sender === target) && 
                  (m.recipient === index || m.recipient === 'all') &&
                  !m.readBy.includes(index)
                )

                if (receivedMessage) break
                await new Promise(r => setTimeout(r, 1000))
              }

              if (receivedMessage) {
                receivedMessage.readBy.push(index)
                allResults += `\n[MESSAGE_RECEIVED] from Agent #${receivedMessage.sender}: "${receivedMessage.content}"\n`
                event.sender.send('chat-tool-update', {
                  toolCallName: 'run_subagents',
                  update: { 
                    agentIndex: index, 
                    phase: 'tool_use', 
                    command: `RECEIVED FROM #${receivedMessage.sender}` 
                  }
                })
              } else {
                allResults += `\n[SYSTEM: WAIT_TIMEOUT] No message received within ${timeout}s.\n`
              }
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
        
        break // No tool calls, agent finished
      }

      event.sender.send('chat-tool-update', {
        toolCallName: 'run_subagents',
        update: { agentIndex: index, phase: 'done', output: 'Task completed.' }
      })

      // Clean final output from thoughts
      const cleanedOutput = finalOutput.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim()
      return `[AGENT #${index} FINAL REPORT]:\n${cleanedOutput}`
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err

      event.sender.send('chat-tool-update', {
        toolCallName: 'run_subagents',
        update: { agentIndex: index, phase: 'error', output: String(err) }
      })
      return `[AGENT #${index} ERROR]:\n${err instanceof Error ? err.message : String(err)}`
    }
  })

  try {
    const results = await Promise.all(agentPromises)
    return results.join('\n\n' + '='.repeat(30) + '\n\n')
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return 'Sub-agents execution was cancelled by user.'
    }
    throw err
  }
}

/**
 * Initializes or clears the history with system instructions.
 */
export function initGemini(): boolean {
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
              toolType = fullResponse.includes('<name>web_search</name>') ? 'search' : 'task'
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

              event.sender.send('chat-tool-start', { name, args: toolArgs })

              let toolResult = ''
              try {
                // Check if aborted before running tool
                const signal = abortController?.signal
                if (signal?.aborted) throw new Error('AbortError')
                toolResult = await toolFunctions[name](toolArgs, event, apiKey, signal)
              } catch (err) {
                if (err instanceof Error && err.name === 'AbortError') throw err
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
      if (abortController?.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
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
