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
dotenv.config()

// Modelo selecionado atualmente
let currentModelKey = 'gemma-4-26b-a4b-it'

// Ordem de fallback dos modelos (do maior para o menor)
const MODEL_FALLBACK_ORDER = [
  'gemma-4-31b-it',     // Prism 1.5 Think
  'gemma-4-26b-a4b-it', // Prism 1.1 Think
  'gemma-3-27b-it',     // Prism 1.1 Fast
  'gemma-3-12b-it'      // Prism 1.1 Think Mini
]

/**
 * Retorna o nome amigável do modelo com base na chave.
 */
function getModelFriendlyName(modelKey: string): string {
  const names: Record<string, string> = {
    'gemma-4-31b-it': 'Prism 1.5 Think',
    'gemma-4-26b-a4b-it': 'Prism 1.1 Think',
    'gemma-3-27b-it': 'Prism 1.1 Fast',
    'gemma-3-12b-it': 'Prism 1.1 Think Mini'
  }
  return names[modelKey] || 'Prism AI'
}

// Histórico persistente em memória para a sessão atual
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
 * Inicializa ou limpa o histórico com as instruções de sistema.
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
 * Altera o modelo atual. O histórico NÃO é reiniciado.
 */
export function setGeminiModel(modelKey: string): boolean {
  currentModelKey = modelKey
  // initGemini() foi removido para manter o histórico entre trocas
  return true
}

// API Key fornecida pelo usuário manualmente
let userApiKey: string | null = null

/**
 * Define a chave de API do usuário manualmente.
 */
export function setUserApiKey(key: string): void {
  userApiKey = key
}

export async function handleChatMessage(event: IpcMainEvent, message: string): Promise<void> {
  // Prioridade: Chave do usuário > Chave do ambiente
  const apiKey = userApiKey || process.env.GEMINI_API_KEY
  
  if (!apiKey || apiKey.trim() === '' || apiKey === 'your_api_key_here') {
    event.sender.send('chat-reply-error', 'Error: Gemini API Key missing.')
    return
  }

  // Inicializa o histórico se estiver vazio
  if (chatHistory.length === 0) {
    initGemini()
  }

  // Adiciona a pergunta real do usuário ao histórico manual
  chatHistory.push({ role: 'user', parts: [{ text: message }] })

  let usedFallback = false
  let success = false

  // Notifica o início da resposta APENAS UMA VEZ
  event.sender.send('chat-reply-start')

  while (!success) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({ model: currentModelKey })

      let accumulatedThoughts = ''
      let accumulatedFinalResponse = ''
      let iterationCount = 0
      const MAX_ITERATIONS = 10

      while (iterationCount < MAX_ITERATIONS) {
        iterationCount++
        // Enviamos TODO o conteúdo do histórico manualmente a cada iteração
        const result = await model.generateContentStream({ contents: chatHistory })

        let currentThoughts = ''
        let currentFinalResponse = ''
        let isThinking = false

        for await (const chunk of result.stream) {
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

        // Adiciona a resposta da IA (seja texto ou Tool Call) ao histórico
        const fullAiResponse = currentThoughts + currentFinalResponse
        chatHistory.push({ role: 'model', parts: [{ text: fullAiResponse }] })

        accumulatedThoughts += currentThoughts
        accumulatedFinalResponse += currentFinalResponse

        // Busca por todas as tags <tool_call> na resposta
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
        return // Exit function after success
      }
      
      // Se sair do loop de iterações sem sucesso (ex: atingiu MAX_ITERATIONS)
      success = true
    } catch (error) {
      console.error('Gemini API Error:', error)

      // Fallback Logic
      const currentIndex = MODEL_FALLBACK_ORDER.indexOf(currentModelKey)
      if (currentIndex !== -1 && currentIndex < MODEL_FALLBACK_ORDER.length - 1) {
        // Tenta o próximo modelo
        currentModelKey = MODEL_FALLBACK_ORDER[currentIndex + 1]
        usedFallback = true

        const friendlyName = getModelFriendlyName(currentModelKey)
        const fallbackInstruction = `[SYSTEM: FALLBACK] Ocorreu um erro na API com o modelo anterior. Você foi ativado como ${friendlyName} para dar continuidade. Por favor, analise o histórico acima e prossiga com a tarefa de onde ela parou. Informe ao usuário brevemente que houve uma troca de modelo técnica para garantir a conclusão do pedido.`

        chatHistory.push({ role: 'user', parts: [{ text: fallbackInstruction }] })

        // Notifica a UI sobre a mudança de modelo (opcional, mas bom manter sincronizado)
        event.sender.send('model-changed', currentModelKey)
        
        console.log(`Fallback ativado: Novo modelo ${currentModelKey}`)
        continue // Tenta novamente com o novo modelo (success continua false)
      } else {
        // Todos os modelos falharam
        const errorMessage = error instanceof Error ? error.message : String(error)
        event.sender.send('chat-reply-error', errorMessage)
        success = true // Encerra o loop de qualquer forma
      }
    }
  }
}
