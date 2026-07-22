import { IpcMainEvent } from 'electron'
import * as os from 'os'
import { SessionMode, AttachedFile, StreamToolCallDelta } from '../../shared/types'
import { toolsManifest } from '../toolsManifest'
import { executeSystemTool, getSystemToolsPrompt, setActiveCwd } from '../systemTools'
import { saveChatSession, loadChatSession, updateChatSessionTitle } from '../history'
import { resolveProviderAndModel } from './providerManager'
import { streamOpenAiCompletion } from './openaiClient'
import { ActiveRun, OpenAiMessage, OpenAiToolDefinition } from './types'

export const activeRuns = new Map<string, ActiveRun>()
export const lastScreenshots = new Map<string, string>()
export let currentSessionId = ''

let currentSelectedChatModel = ''
let currentSessionMode: SessionMode = 'execution'
let currentDisciplinePath = ''

export function setChatModel(modelKey: string): void {
  currentSelectedChatModel = modelKey
}

export function getChatModel(_id?: string): string {
  return currentSelectedChatModel
}

export function setSessionMode(mode: SessionMode, disciplinePath?: string): void {
  currentSessionMode = mode
  if (disciplinePath !== undefined) {
    currentDisciplinePath = disciplinePath
  }
}

export function getSessionMode(): { mode: SessionMode; disciplinePath?: string } {
  return { mode: currentSessionMode, disciplinePath: currentDisciplinePath }
}

export function cancelChatMessage(chatId?: string): void {
  if (chatId) {
    const run = activeRuns.get(chatId)
    if (run) {
      run.abortController.abort()
      activeRuns.delete(chatId)
    }
  } else {
    for (const [id, run] of activeRuns.entries()) {
      run.abortController.abort()
      activeRuns.delete(id)
    }
  }
}

export function getNativeToolsForOpenAi(target: 'main' | 'subagent' | 'launcher' = 'main'): OpenAiToolDefinition[] {
  return toolsManifest
    .filter((t) => !t.target || t.target === 'both' || t.target === target)
    .map((t) => {
      const properties: Record<string, any> = {}
      for (const [key, desc] of Object.entries(t.parameters || {})) {
        properties[key] = { type: 'string', description: desc }
      }
      return {
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties
          }
        }
      }
    })
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

  let sessionMode = typeof data === 'object' ? data.sessionMode : undefined
  let disciplinePath = typeof data === 'object' ? data.disciplinePath : undefined

  if (typeof data === 'object' && data.modelKey) {
    currentSelectedChatModel = data.modelKey
  }

  const { provider, model } = resolveProviderAndModel(currentSelectedChatModel)

  if (!provider || !provider.apiKey || !model) {
    event.sender.send('chat-reply-error', { error: 'API_KEY_ERROR:401:API Key or Active Model Missing', chatId })
    return
  }

  if (activeRuns.has(chatId)) {
    console.log(`Chat ${chatId} is already running. Ignoring duplicate.`)
    return
  }

  // Session mode setup
  if (sessionMode) {
    currentSessionMode = sessionMode
  }
  if (currentSessionMode === 'discipline' && disciplinePath) {
    currentDisciplinePath = disciplinePath
    setActiveCwd(disciplinePath)
  } else if (currentSessionMode === 'execution') {
    setActiveCwd(os.homedir())
  } else {
    setActiveCwd(process.cwd())
  }

  // Load chat session from disk if existing
  const session = loadChatSession(chatId)
  let historyMessages: any[] = session ? session.messages : []

  // Check if first message
  const isFirstMessage = historyMessages.length === 0

  // Construct current user content
  let userText = message
  if (quote) {
    userText = `> ${quote}\n\n${userText}`
  }

  const userMessage: OpenAiMessage = {
    role: 'user',
    content: userText
  }

  if (screenshot || attachedFile) {
    const parts: any[] = [{ type: 'text', text: userText }]
    if (screenshot) {
      parts.push({
        type: 'image_url',
        image_url: { url: screenshot.startsWith('data:') ? screenshot : `data:image/png;base64,${screenshot}` }
      })
    }
    if (attachedFile && attachedFile.mimeType.startsWith('image/')) {
      parts.push({
        type: 'image_url',
        image_url: { url: attachedFile.data.startsWith('data:') ? attachedFile.data : `data:${attachedFile.mimeType};base64,${attachedFile.data}` }
      })
    }
    userMessage.content = parts
  }

  historyMessages.push(userMessage)

  // Save session
  if (isFirstMessage) {
    saveChatSession(chatId, historyMessages, 'New Conversation')
    event.sender.send('chat-session-created', { id: chatId })
    // Background title generator
    generateTitleInBackground(event, provider, model.id, message, chatId)
  } else {
    saveChatSession(chatId, historyMessages)
  }

  event.sender.send('chat-reply-start', { chatId })

  const abortController = new AbortController()
  activeRuns.set(chatId, {
    chatId,
    abortController,
    streamedText: '',
    status: 'running'
  })

  try {
    const systemPrompt = getSystemToolsPrompt(model.id, 'main', undefined, currentSessionMode, currentDisciplinePath)
    const openAiTools = getNativeToolsForOpenAi('main')

    let maxLoops = 10
    let loopCount = 0

    while (loopCount < maxLoops) {
      loopCount++

      const messagesForApi: OpenAiMessage[] = [
        { role: 'system', content: systemPrompt },
        ...convertHistoryToOpenAi(historyMessages)
      ]

      let currentReplyText = ''
      let currentReasoningText = ''

      const parseThoughtAndContent = (rawText: string, extraReasoning: string) => {
        let thoughts = extraReasoning || ''
        let content = rawText

        const thinkMatch = rawText.match(/<think>([\s\S]*?)(?:<\/think>|$)/i)
        if (thinkMatch) {
          const embeddedThought = thinkMatch[1]
          thoughts = thoughts ? `${thoughts}\n${embeddedThought}` : embeddedThought
          content = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*/gi, '')
        }

        return { thoughts, content }
      }

      let chunkCount = 0

      const streamResult = await streamOpenAiCompletion(
        provider,
        model.id,
        messagesForApi,
        openAiTools,
        abortController.signal,
        {
          onTextDelta: (text) => {
            currentReplyText += text
            chunkCount++
            const { thoughts, content } = parseThoughtAndContent(currentReplyText, currentReasoningText)
            event.sender.send('chat-reply-chunk', {
              chatId,
              thoughts,
              finalResponse: content,
              isThinking: !!thoughts && !content,
              isWritingToolCall: false
            })
          },
          onReasoningDelta: (reasoning) => {
            currentReasoningText += reasoning
            chunkCount++
            const { thoughts, content } = parseThoughtAndContent(currentReplyText, currentReasoningText)
            event.sender.send('chat-reply-chunk', {
              chatId,
              thoughts,
              finalResponse: content,
              isThinking: true,
              isWritingToolCall: false
            })
          },
          onToolCallDelta: (delta: StreamToolCallDelta) => {
            // Real-time tool streaming to UI!
            event.sender.send('chat-tool-call-delta', {
              chatId,
              ...delta
            })
          }
        }
      )

      console.log(`[Main Chat] Stream generation completed. Total chunks: ${chunkCount}`)

      currentReplyText = streamResult.text || currentReplyText
      currentReasoningText = streamResult.reasoning || currentReasoningText

      const assistantMessage: OpenAiMessage = {
        role: 'assistant',
        content: currentReplyText || null
      }

      if (streamResult.toolCalls.length > 0) {
        assistantMessage.tool_calls = streamResult.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.args
          },
          // Gemini thinking models require thought_signature to be echoed back on the
          // next turn via extra_content.google.thought_signature in the OpenAI-compat API.
          // Also spread top-level thought_signature for any future API changes.
          ...(tc.thoughtSignature
            ? {
                thought_signature: tc.thoughtSignature,
                extra_content: { google: { thought_signature: tc.thoughtSignature } }
              }
            : {})
        }))
      }

      historyMessages.push(assistantMessage)
      saveChatSession(chatId, historyMessages)

      // Execute tool calls if any returned
      if (streamResult.toolCalls.length > 0) {
        for (const tc of streamResult.toolCalls) {
          let parsedArgs: Record<string, any> = {}
          try {
            parsedArgs = JSON.parse(tc.args || '{}')
          } catch {
            parsedArgs = { raw: tc.args }
          }

          event.sender.send('chat-tool-start', {
            name: tc.name,
            args: parsedArgs,
            timestamp: Date.now(),
            chatId
          })

          let toolOutput = ''
          try {
            toolOutput = await executeSystemTool(tc.name, parsedArgs, event, provider.apiKey, abortController.signal, chatId)
          } catch (err: any) {
            toolOutput = `Error executing tool ${tc.name}: ${err.message}`
          }

          event.sender.send('chat-tool-end', {
            name: tc.name,
            result: toolOutput,
            chatId
          })

          historyMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.name,
            content: toolOutput
          })

          saveChatSession(chatId, historyMessages)
        }
        // Continue loop to let model process tool outputs
        continue
      }

      // Check text for tag-based tool calls [PRISM_EXECUTE_TOOL]
      const tagMatch = currentReplyText.match(/\[PRISM_EXECUTE_TOOL\]([\s\S]*?)\[\/PRISM_EXECUTE_TOOL\]/)
      if (tagMatch) {
        try {
          const toolData = JSON.parse(tagMatch[1])
          const toolName = toolData.type || toolData.name
          delete toolData.type
          delete toolData.name

          event.sender.send('chat-tool-start', {
            name: toolName,
            args: toolData,
            timestamp: Date.now(),
            chatId
          })

          const toolOutput = await executeSystemTool(toolName, toolData, event, provider.apiKey, abortController.signal, chatId)

          event.sender.send('chat-tool-end', {
            name: toolName,
            result: toolOutput,
            chatId
          })

          historyMessages.push({
            role: 'user',
            content: `Tool Execution Result for ${toolName}:\n${toolOutput}`
          })
          saveChatSession(chatId, historyMessages)
          continue
        } catch {
          // If tag parsing fails, break
        }
      }

      // No tool calls, finish
      const { thoughts: finalThoughts, content: finalContent } = parseThoughtAndContent(currentReplyText, currentReasoningText)
      event.sender.send('chat-reply-end', {
        thoughts: finalThoughts,
        finalResponse: finalContent,
        rawText: currentReplyText,
        isThinking: false,
        chatId
      })
      break
    }
  } catch (error: any) {
    if (abortController.signal.aborted || error.name === 'AbortError') {
      event.sender.send('chat-reply-error', { error: 'Message cancelled by user', chatId })
    } else {
      console.error('Error in handleChatMessage:', error)
      event.sender.send('chat-reply-error', { error: error.message || String(error), chatId })
    }
  } finally {
    activeRuns.delete(chatId)
  }
}

function convertHistoryToOpenAi(history: any[]): OpenAiMessage[] {
  return history
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.tool_call_id || `call_${Date.now()}`,
          name: m.name,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }
      }
      return {
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.content || (m.parts ? m.parts.map((p: any) => p.text || '').join('\n') : ''),
        tool_calls: m.tool_calls
      }
    })
}

async function generateTitleInBackground(
  event: IpcMainEvent,
  provider: any,
  modelId: string,
  firstMessage: string,
  chatId: string
): Promise<void> {
  try {
    console.log(`[Title Generator] Generating title for chat ${chatId} using model ${modelId} via provider ${provider.name || provider.baseUrl}...`)
    const prompt = `Summarize this user query into a concise 3-5 word title in English. Do not use quotes or punctuation. Query: "${firstMessage}"`
    const abortController = new AbortController()

    const res = await streamOpenAiCompletion(
      provider,
      modelId,
      [{ role: 'user', content: prompt }],
      [],
      abortController.signal,
      { onTextDelta: () => {}, onReasoningDelta: () => {}, onToolCallDelta: () => {} }
    )

    let title = res.text.replace(/["']/g, '').trim()
    if (!title || title.length > 50) title = 'New Conversation'

    console.log(`[Title Generator] Generated title for chat ${chatId}: "${title}"`)
    updateChatSessionTitle(chatId, title)
    event.sender.send('chat-title-received', { id: chatId, title })
  } catch {
    updateChatSessionTitle(chatId, 'New Conversation')
    event.sender.send('chat-title-received', { id: chatId, title: 'New Conversation' })
  }
}
