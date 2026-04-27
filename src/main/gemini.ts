import { GoogleGenerativeAI, Content } from '@google/generative-ai'
import * as dotenv from 'dotenv'
import { IpcMainEvent } from 'electron'
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

// Modelo selecionado atualmente
let currentModelKey = 'gemini-3.1-flash-lite-preview'

// Ordem de fallback dos modelos (do maior para o menor)
const MODEL_FALLBACK_ORDER = [
  'gemma-4-31b-it',     // Prism 2 Think
  'gemma-4-26b-a4b-it', // Prism 1.5 Think
  'gemini-3.1-flash-lite-preview', // Prism 1.5 Fast
  'gemma-3-27b-it',     // Prism 1.1 Fast
  'gemma-3-12b-it'      // Prism 1.1 Fast Mini
]

/**
 * Returns the friendly name of the model based on the key.
 */
function getModelFriendlyName(modelKey: string): string {
  const names: Record<string, string> = {
    'gemma-4-31b-it': 'Prism 2 Think',
    'gemma-4-26b-a4b-it': 'Prism 1.5 Think',
    'gemini-3.1-flash-lite-preview': 'Prism 1.5 Fast',
    'gemma-3-27b-it': 'Prism 1.1 Fast',
    'gemma-3-12b-it': 'Prism 1.1 Fast Mini'
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

interface ToolArgs {
  command?: string
  appPath?: string
  url?: string
  query?: string
  path?: string
  content?: string
  oldText?: string
  newText?: string
}

const toolFunctions: Record<string, (args: ToolArgs) => Promise<string>> = {
  execute_terminal_command: (args) => runTerminalCommand(args.command || ''),
  list_installed_applications: () => listApplications(),
  open_application: (args) => openApplication(args.appPath || ''),
  open_browser_link: (args) => openBrowserLink(args.url || ''),
  web_search: (args) => webSearch(args.query || ''),
  saw_link_from_url: (args) => sawLinkFromUrl(args.url || ''),
  computer_use_create_file: (args) => computerCreateFile(args.path || '', args.content || ''),
  computer_use_create_directory: (args) => computerCreateDirectory(args.path || ''),
  computer_use_remove_file: (args) => computerRemoveFile(args.path || ''),
  computer_use_remove_directory: (args) => computerRemoveDirectory(args.path || ''),
  computer_use_save_file: (args) => computerSaveFile(args.path || '', args.content || ''),
  computer_use_replace_in_file: (args) =>
    computerReplaceInFile(args.path || '', args.oldText || '', args.newText || ''),
  computer_use_list_directory: (args) => computerListDirectory(args.path || ''),
  computer_use_read_file: (args) => computerReadFile(args.path || '')
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

export async function handleChatMessage(event: IpcMainEvent, message: string): Promise<void> {
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
      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({ model: currentModelKey })

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

              // Extract all potential arguments
              const argTags = [
                'command',
                'appPath',
                'url',
                'query',
                'path',
                'content',
                'oldText',
                'newText'
              ]
              for (const tag of argTags) {
                const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i')
                const m = toolContent.match(regex)
                if (m) toolArgs[tag] = m[1].trim()
              }

              event.sender.send('chat-tool-start', { name, args: toolArgs })

              let toolResult = ''
              try {
                // Check if aborted before running tool
                if (abortController?.signal.aborted) throw new Error('AbortError')
                toolResult = await toolFunctions[name](toolArgs)
              } catch (err) {
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
