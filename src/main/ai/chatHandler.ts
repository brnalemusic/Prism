import { IpcMainEvent } from 'electron'
import * as os from 'os'
import { SessionMode, AttachedFile, StreamToolCallDelta } from '../../shared/types'
import { getSystemToolsPrompt, setActiveCwd, setCurrentSessionIdForTodo } from '../systemTools'
import { loadConfig } from '../config'
import { saveChatSession, loadChatSession, updateChatSessionTitle } from '../history'
import { resolveProviderAndModel } from './providerManager'
import { streamOpenAiCompletion } from './openaiClient'
import { ActiveRun, OpenAiMessage, OpenAiToolDefinition } from './types'
import { safeSend } from '../safeSend'
import { executeValidatedTool, getOpenAiToolDefinitions, ToolLoopGuard } from '../toolRuntime'
import { normalizePrismThinkingLevel } from './geminiClient'

export const activeRuns = new Map<string, ActiveRun>()
export const lastScreenshots = new Map<string, string>()
export let currentSessionId = ''

let currentSelectedChatModel = ''
let currentSessionMode: SessionMode = 'execution'
let currentDisciplinePath = ''

export function setChatModel(modelKey: string): void {
  currentSelectedChatModel = modelKey
}

export function getChatModel(id?: string): string {
  if (id) {
    const session = loadChatSession(id)
    if (session?.model) {
      return session.model
    }
  }
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

export function getNativeToolsForOpenAi(_target: 'main' | 'launcher' = 'main'): OpenAiToolDefinition[] {
  return getOpenAiToolDefinitions()
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
        reasoningLevel?: string
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
    safeSend(event.sender, 'chat-reply-error', { error: 'API_KEY_ERROR:401:API Key or Active Model Missing', chatId })
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
  if (currentSessionMode === 'discipline') {
    if (disciplinePath) {
      currentDisciplinePath = disciplinePath
      setActiveCwd(disciplinePath)
    }
  } else {
    currentDisciplinePath = ''
    if (currentSessionMode === 'execution') {
      setActiveCwd(os.homedir())
    } else {
      setActiveCwd(process.cwd())
    }
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
    saveChatSession(
      chatId,
      historyMessages,
      'New Conversation',
      currentSessionMode,
      currentDisciplinePath,
      currentSelectedChatModel
    )
    safeSend(event.sender, 'chat-session-created', { id: chatId })
    // Background title generator
    generateTitleInBackground(event, provider, model.id, message, chatId)
  } else {
    saveChatSession(
      chatId,
      historyMessages,
      undefined,
      currentSessionMode,
      currentDisciplinePath,
      currentSelectedChatModel
    )
  }

  safeSend(event.sender, 'chat-reply-start', { chatId })

  const abortController = new AbortController()
  activeRuns.set(chatId, {
    chatId,
    abortController,
    streamedText: '',
    status: 'running'
  })

  try {
    // Workflow matching: check if the user's message starts with a slash command
    const config = loadConfig()
    const cleanModelId = model.id.startsWith('prism_provider:')
      ? model.id.replace('prism_provider:', '')
      : model.id
    const cleanSelectedKey = currentSelectedChatModel.startsWith('prism_provider:')
      ? currentSelectedChatModel.replace('prism_provider:', '')
      : currentSelectedChatModel

    const configLevel =
      config.modelReasoningLevels?.[currentSelectedChatModel] ||
      config.modelReasoningLevels?.[cleanSelectedKey] ||
      config.modelReasoningLevels?.[model.id] ||
      config.modelReasoningLevels?.[cleanModelId]

    const dataLevel = typeof data === 'object' ? data.reasoningLevel : undefined
    const reasoningLevel = normalizePrismThinkingLevel(provider, dataLevel || configLevel)

    const firstMsgText = userText.trim()
    const matchedWorkflow = config.workflows?.find((w) =>
      firstMsgText.toLowerCase().startsWith(w.command.toLowerCase())
    )

    const systemPrompt = getSystemToolsPrompt(
      model.id,
      'main',
      matchedWorkflow?.toolConstraints,
      currentSessionMode,
      currentDisciplinePath
    )
    let fullPrompt = systemPrompt
    if (matchedWorkflow) {
      fullPrompt += `\n\n# Active Workflow: ${matchedWorkflow.name}\n${matchedWorkflow.systemInstruction}`
    }

    setCurrentSessionIdForTodo(chatId)

    const openAiTools = getNativeToolsForOpenAi('main')

    let maxLoops = 100
    let loopCount = 0
    const toolLoopGuard = new ToolLoopGuard()
    let accumulatedReplyText = ''
    let accumulatedReasoningText = ''
    let accumulatedThinkingDuration = 0
    let replyEnded = false

    while (loopCount < maxLoops) {
      loopCount++

      const messagesForApi: OpenAiMessage[] = [
        { role: 'system', content: fullPrompt },
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
      let thinkingStart: number | null = null
      let thinkingEnd: number | null = null

      const streamResult = await streamOpenAiCompletion(
        provider,
        model.id,
        messagesForApi,
        openAiTools,
        abortController.signal,
        {
          onTextDelta: (text) => {
            if (thinkingStart && !thinkingEnd) {
              thinkingEnd = Date.now()
            }
            currentReplyText += text
            chunkCount++
            const combinedText = accumulatedReplyText ? accumulatedReplyText + '\n\n' + currentReplyText : currentReplyText
            const combinedReasoning = accumulatedReasoningText ? accumulatedReasoningText + '\n\n' + currentReasoningText : currentReasoningText
            const { thoughts, content } = parseThoughtAndContent(combinedText, combinedReasoning)
            safeSend(event.sender, 'chat-reply-chunk', {
              chatId,
              thoughts,
              finalResponse: content,
              isThinking: !!thoughts && !content,
              isWritingToolCall: false
            })
          },
          onReasoningDelta: (reasoning) => {
            if (!thinkingStart) {
              thinkingStart = Date.now()
            }
            currentReasoningText += reasoning
            chunkCount++
            const combinedText = accumulatedReplyText ? accumulatedReplyText + '\n\n' + currentReplyText : currentReplyText
            const combinedReasoning = accumulatedReasoningText ? accumulatedReasoningText + '\n\n' + currentReasoningText : currentReasoningText
            const { thoughts, content } = parseThoughtAndContent(combinedText, combinedReasoning)
            safeSend(event.sender, 'chat-reply-chunk', {
              chatId,
              thoughts,
              finalResponse: content,
              isThinking: true,
              isWritingToolCall: false
            })
          },
          onToolCallDelta: (delta: StreamToolCallDelta) => {
            if (thinkingStart && !thinkingEnd) {
              thinkingEnd = Date.now()
            }
            // Real-time tool streaming to UI!
            safeSend(event.sender, 'chat-tool-call-delta', {
              chatId,
              ...delta
            })
          }
        },
        reasoningLevel
      )

      console.log(`[Main Chat] Stream generation completed. Total chunks: ${chunkCount}`)

      if (thinkingStart && !thinkingEnd) {
        thinkingEnd = Date.now()
      }
      const iterThinkingDuration = thinkingStart
        ? Math.max(1, Math.round(((thinkingEnd || Date.now()) - thinkingStart) / 1000))
        : undefined

      if (iterThinkingDuration !== undefined) {
        accumulatedThinkingDuration += iterThinkingDuration
      }

      const turnThinkingDuration = accumulatedThinkingDuration > 0 ? accumulatedThinkingDuration : iterThinkingDuration

      currentReplyText = streamResult.text || currentReplyText
      currentReasoningText = streamResult.reasoning || currentReasoningText

      // Accumulate text across tool-call loop iterations so the UI preserves
      // text that was streamed before the tool call.
      const { thoughts: iterThoughts, content: iterContent } = parseThoughtAndContent(currentReplyText, currentReasoningText)
      if (iterContent) {
        accumulatedReplyText = accumulatedReplyText ? accumulatedReplyText + '\n\n' + iterContent : iterContent
      }
      if (iterThoughts) {
        accumulatedReasoningText = accumulatedReasoningText ? accumulatedReasoningText + '\n\n' + iterThoughts : iterThoughts
      }

      const assistantMessage: OpenAiMessage & { reasoning_content?: string; thinking_duration?: number } = {
        role: 'assistant',
        content: streamResult.toolCalls.length > 0 ? (iterContent || '') : (accumulatedReplyText || iterContent || ''),
        ...(accumulatedReasoningText || iterThoughts ? { reasoning_content: accumulatedReasoningText || iterThoughts } : {}),
        ...(turnThinkingDuration !== undefined ? { thinking_duration: turnThinkingDuration } : {})
      }

      if (streamResult.nativeContent) {
        assistantMessage.provider_metadata = {
          gemini: { content: streamResult.nativeContent }
        }
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
      saveChatSession(
        chatId,
        historyMessages,
        undefined,
        currentSessionMode,
        currentDisciplinePath,
        currentSelectedChatModel
      )

      // Execute tool calls if any returned
      if (streamResult.toolCalls.length > 0) {
        for (const tc of streamResult.toolCalls) {
          const execution = await executeValidatedTool(
            tc.name,
            tc.args || '{}',
            {
              event,
              apiKey: provider.apiKey,
              signal: abortController.signal,
              chatId,
              onStart: (args) =>
                safeSend(event.sender, 'chat-tool-start', {
                  callId: tc.id,
                  name: tc.name,
                  args,
                  timestamp: Date.now(),
                  chatId
                })
            },
            toolLoopGuard
          )

          const toolOutput = execution.modelContent

          safeSend(event.sender, 'chat-tool-end', {
            callId: tc.id,
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

          saveChatSession(
            chatId,
            historyMessages,
            undefined,
            currentSessionMode,
            currentDisciplinePath,
            currentSelectedChatModel
          )
        }
        // Continue loop to let model process tool outputs
        continue
      }

      // No tool calls, finish
      safeSend(event.sender, 'chat-reply-end', {
        thoughts: accumulatedReasoningText,
        finalResponse: accumulatedReplyText,
        rawText: accumulatedReplyText,
        isThinking: false,
        thinkingDuration: turnThinkingDuration,
        chatId
      })
      replyEnded = true
      break
    }

    if (!replyEnded && !abortController.signal.aborted) {
      let finalText = ''
      let finalReasoning = ''
      const finalResult = await streamOpenAiCompletion(
        provider,
        model.id,
        [
          {
            role: 'system',
            content:
              `${fullPrompt}\n\n# Tool loop limit reached\n` +
              'The maximum of 100 tool rounds has been reached. Do not call more tools. ' +
              'Explain what was completed, what remains, and the last tool result.'
          },
          ...convertHistoryToOpenAi(historyMessages)
        ],
        [],
        abortController.signal,
        {
          onTextDelta: (text) => {
            finalText += text
            safeSend(event.sender, 'chat-reply-chunk', {
              chatId,
              thoughts: accumulatedReasoningText + finalReasoning,
              finalResponse: accumulatedReplyText
                ? `${accumulatedReplyText}\n\n${finalText}`
                : finalText,
              isThinking: false,
              isWritingToolCall: false
            })
          },
          onReasoningDelta: (reasoning) => {
            finalReasoning += reasoning
          },
          onToolCallDelta: () => {}
        },
        reasoningLevel
      )
      finalText = finalResult.text || finalText
      finalReasoning = finalResult.reasoning || finalReasoning
      if (finalText) {
        accumulatedReplyText = accumulatedReplyText
          ? `${accumulatedReplyText}\n\n${finalText}`
          : finalText
      }
      if (finalReasoning) {
        accumulatedReasoningText = accumulatedReasoningText
          ? `${accumulatedReasoningText}\n\n${finalReasoning}`
          : finalReasoning
      }
      const finalAssistantMessage: OpenAiMessage = {
        role: 'assistant',
        content: finalText,
        ...(finalResult.nativeContent
          ? { provider_metadata: { gemini: { content: finalResult.nativeContent } } }
          : {})
      }
      historyMessages.push(finalAssistantMessage)
      saveChatSession(
        chatId,
        historyMessages,
        undefined,
        currentSessionMode,
        currentDisciplinePath,
        currentSelectedChatModel
      )
      safeSend(event.sender, 'chat-reply-end', {
        thoughts: accumulatedReasoningText,
        finalResponse: accumulatedReplyText,
        rawText: accumulatedReplyText,
        isThinking: false,
        chatId,
        loopLimitReached: true
      })
    }
  } catch (error: any) {
    if (abortController.signal.aborted || error.name === 'AbortError') {
      safeSend(event.sender, 'chat-reply-error', { error: 'Message cancelled by user', chatId })
    } else {
      console.error(`[Main Chat] Error in handleChatMessage for chat ${chatId}:`, error)
      console.error(`[Main Chat] Error name: ${error.name}, message: ${error.message}`)
      if (error.stack) console.error(`[Main Chat] Stack: ${error.stack}`)
      safeSend(event.sender, 'chat-reply-error', { error: error.message || String(error), chatId })
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
      const content = m.content ?? (m.parts ? m.parts.map((p: any) => p.text || '').join('\n') : null)
      return {
        role: m.role === 'model' ? 'assistant' : m.role,
        content: content || '',
        tool_calls: m.tool_calls,
        provider_metadata: m.provider_metadata
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
    const prompt = `Summarize query into concise 3-5 word title in same language. No quotes or punctuation: "${firstMessage}"`
    const abortController = new AbortController()

    const res = await streamOpenAiCompletion(
      provider,
      modelId,
      [{ role: 'user', content: prompt }],
      [],
      abortController.signal,
      { onTextDelta: () => {}, onReasoningDelta: () => {}, onToolCallDelta: () => {} },
      undefined, // no reasoning level for title generation
      { skipUsageIncrement: true }
    )

    let title = res.text.replace(/["']/g, '').trim()
    if (!title || title.length > 50) title = 'New Conversation'

    console.log(`[Title Generator] Generated title for chat ${chatId}: "${title}"`)
    updateChatSessionTitle(chatId, title)
    safeSend(event.sender, 'chat-title-received', { id: chatId, title })
  } catch {
    updateChatSessionTitle(chatId, 'New Conversation')
    safeSend(event.sender, 'chat-title-received', { id: chatId, title: 'New Conversation' })
  }
}
