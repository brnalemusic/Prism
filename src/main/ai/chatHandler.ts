import { IpcMainEvent } from 'electron'
import * as os from 'os'
import { SessionMode, AttachedFile } from '../../shared/types'
import { getSystemToolsPrompt, setActiveCwd, setCurrentSessionIdForTodo } from '../systemTools'
import { loadConfig } from '../config'
import {
  hydrateHistoryToolAttachments,
  prepareHistoryMessage,
  saveChatSession,
  loadChatSession,
  updateChatSessionTitle
} from '../history'
import { resolveProviderAndModel, PRISM_PROVIDER_ID } from './providerManager'
import { streamOpenAiCompletion } from './openaiClient'
import { ActiveRun, OpenAiMessage, OpenAiToolDefinition } from './types'
import { safeSend, broadcastIpc } from '../safeSend'
import { getOpenAiToolDefinitions } from '../toolRuntime'
import { normalizePrismThinkingLevel } from './prismThinking'
import { runToolOrchestration } from './toolOrchestrator'
import { markConnectionActive } from '../connection'
import {
  getPendingProcessNotifications,
  onBackgroundProcessEnded,
  type TerminalProcessSession
} from '../terminalProcessManager'

export const activeRuns = new Map<string, ActiveRun>()
export const lastScreenshots = new Map<string, string>()
const currentSessionId = ''

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

export function getNativeToolsForOpenAi(
  _target: 'main' | 'launcher' = 'main',
  allowedTools?: string[],
  chatId?: string,
  disabledSkills?: string[]
): OpenAiToolDefinition[] {
  void _target
  const definitions = getOpenAiToolDefinitions(chatId, disabledSkills)
  if (allowedTools === undefined) return definitions
  const allowed = new Set(allowedTools)
  return definitions.filter((definition) => allowed.has(definition.function.name))
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
        disabledSkills?: string[]
      }
): Promise<void> {
  const message = typeof data === 'string' ? data : data.message
  const chatId = typeof data === 'object' && data.chatId ? data.chatId : currentSessionId
  const screenshot = typeof data === 'object' ? data.screenshot : undefined
  const quote = typeof data === 'object' ? data.quote : undefined
  const attachedFile = typeof data === 'object' ? data.attachedFile : undefined

  const sessionMode = typeof data === 'object' ? data.sessionMode : undefined
  const disciplinePath = typeof data === 'object' ? data.disciplinePath : undefined

  if (typeof data === 'object' && data.modelKey) {
    currentSelectedChatModel = data.modelKey
  }

  const { provider, model } = resolveProviderAndModel(currentSelectedChatModel)

  if (!provider || !provider.apiKey || !model) {
    safeSend(event.sender, 'chat-reply-error', {
      error: 'API_KEY_ERROR:401:API Key or Active Model Missing',
      chatId
    })
    return
  }

  markConnectionActive()

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
  const historyMessages: OpenAiMessage[] = session
    ? hydrateHistoryToolAttachments(chatId, session.messages)
    : []

  // Check if first message
  const isFirstMessage = historyMessages.length === 0

  // Construct current user content
  let rawUserText = message
  const isForceSearch = rawUserText.startsWith('[FORCE_SEARCH]')
  let userText = rawUserText.replace(/^\[FORCE_SEARCH\]\s*/i, '')

  if (quote) {
    userText = `> ${quote}\n\n${userText}`
  }

  const userMessage: OpenAiMessage = {
    role: 'user',
    content: userText
  }

  if (screenshot || attachedFile) {
    const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: 'text', text: userText }
    ]
    if (screenshot) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: screenshot.startsWith('data:') ? screenshot : `data:image/png;base64,${screenshot}`
        }
      })
    }
    if (attachedFile && attachedFile.mimeType.startsWith('image/')) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: attachedFile.data.startsWith('data:')
            ? attachedFile.data
            : `data:${attachedFile.mimeType};base64,${attachedFile.data}`
        }
      })
    }
    userMessage.content = parts
  }

  historyMessages.push(userMessage)

  const config = loadConfig()
  const disabledSkills =
    typeof data === 'object' && Array.isArray(data.disabledSkills)
      ? data.disabledSkills
      : session?.disabledSkills || config.disabledSkills || []

  // Save session
  if (isFirstMessage) {
    saveChatSession(
      chatId,
      historyMessages,
      'New Conversation',
      currentSessionMode,
      currentDisciplinePath,
      currentSelectedChatModel,
      false,
      disabledSkills
    )
    broadcastIpc('chat-session-created', { id: chatId })
    // Background title generator
    generateTitleInBackground(event, provider, model.id, message, chatId)
  } else {
    saveChatSession(
      chatId,
      historyMessages,
      undefined,
      currentSessionMode,
      currentDisciplinePath,
      currentSelectedChatModel,
      undefined,
      disabledSkills
    )
  }

  broadcastIpc('chat-reply-start', { chatId })

  const abortController = new AbortController()
  activeRuns.set(chatId, {
    chatId,
    abortController,
    streamedText: '',
    status: 'running'
  })

  try {
    // Workflow matching: check if the user's message starts with a slash command
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
    const reasoningLevel = normalizePrismThinkingLevel(provider, model.id, dataLevel || configLevel)

    const firstMsgText = userText.trim()
    const matchedWorkflow = config.workflows?.find((w) =>
      firstMsgText.toLowerCase().startsWith(w.command.toLowerCase())
    )

    const isPrismCloud = provider?.id === PRISM_PROVIDER_ID || provider?.name === 'Prism Cloud'
    const systemPrompt = getSystemToolsPrompt(
      model.id,
      'main',
      matchedWorkflow?.toolConstraints,
      currentSessionMode,
      currentDisciplinePath,
      model.name,
      isPrismCloud,
      disabledSkills
    )
    let fullPrompt = systemPrompt
    if (matchedWorkflow) {
      fullPrompt += `\n\n# Active Workflow: ${matchedWorkflow.name}\n${matchedWorkflow.systemInstruction}`
    }
    if (isForceSearch) {
      fullPrompt += `\n\n# Web Search Requirement\nThe user has explicitly enabled Web Search for this prompt. You MUST use the 'web_search' tool to search the internet for current up-to-date information before returning your response.`
    }

    setCurrentSessionIdForTodo(chatId)

    const getToolsForSessionMode = (): OpenAiToolDefinition[] => {
      let tools =
        currentSessionMode === 'conversation'
          ? []
          : getNativeToolsForOpenAi('main', matchedWorkflow?.toolConstraints, chatId, disabledSkills)
      if (isForceSearch) {
        const allTools = getNativeToolsForOpenAi('main', undefined, chatId, disabledSkills)
        const searchTools = allTools.filter((t) =>
          ['web_search', 'saw_link_from_url', 'open_browser_link'].includes(t.function.name)
        )
        const existingNames = new Set(tools.map((t) => t.function.name))
        for (const tool of searchTools) {
          if (!existingNames.has(tool.function.name)) {
            tools.push(tool)
          }
        }
      }
      return tools
    }

    const openAiTools = getToolsForSessionMode()
    const messagesForApi: OpenAiMessage[] = [
      { role: 'system', content: fullPrompt },
      ...convertHistoryToOpenAi(historyMessages)
    ]
    const turnStartTime = Date.now()
    const thinkingTimes = new Map<number, { startedAt?: number; endedAt?: number }>()
    let totalThinkingDuration = 0

    const parseThoughtAndContent = (
      rawText: string,
      extraReasoning: string
    ): { thoughts: string; content: string } => {
      let thoughts = extraReasoning || ''
      let content = rawText
      const thinkMatch = rawText.match(/<think>([\s\S]*?)(?:<\/think>|$)/i)
      if (thinkMatch) {
        thoughts = thoughts ? `${thoughts}\n${thinkMatch[1]}` : thinkMatch[1]
        content = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*/gi, '')
      }
      return { thoughts, content }
    }

    const orchestration = await runToolOrchestration({
      provider,
      modelId: model.id,
      messages: messagesForApi,
      tools: openAiTools,
      getToolsForRound: () => getToolsForSessionMode(),
      getPendingNotifications: () => getPendingProcessNotifications(chatId),
      signal: abortController.signal,
      reasoningLevel,
      onStreamEvent: (streamEvent, state) => {
        const timing = thinkingTimes.get(state.round) || {}
        if (streamEvent.type === 'reasoning' && !timing.startedAt) timing.startedAt = Date.now()
        if (streamEvent.type !== 'reasoning' && timing.startedAt && !timing.endedAt) {
          timing.endedAt = Date.now()
        }
        thinkingTimes.set(state.round, timing)

        if (streamEvent.type === 'tool') {
          broadcastIpc('chat-tool-call-delta', { chatId, ...streamEvent.delta })
          return
        }
        const combinedText = state.accumulatedText
          ? `${state.accumulatedText}\n\n${state.currentText}`
          : state.currentText
        const combinedReasoning = state.accumulatedReasoning
          ? `${state.accumulatedReasoning}\n\n${state.currentReasoning}`
          : state.currentReasoning
        const parsed = parseThoughtAndContent(combinedText, combinedReasoning)
        broadcastIpc('chat-reply-chunk', {
          chatId,
          thoughts: parsed.thoughts,
          finalResponse: parsed.content,
          isThinking: streamEvent.type === 'reasoning',
          isWritingToolCall: state.streamingToolCalls.length > 0
        })
      },
      decorateAssistantMessage: (assistantMessage, _result, state) => {
        const timing = thinkingTimes.get(state.round)
        if (timing?.startedAt) {
          const duration = Math.max(
            1,
            Math.round(((timing.endedAt || Date.now()) - timing.startedAt) / 1000)
          )
          assistantMessage.thinking_duration = duration
          totalThinkingDuration += duration
        }
        return assistantMessage
      },
      createToolContext: ({ callId, name }) => ({
        event,
        apiKey: provider.apiKey,
        signal: abortController.signal,
        chatId,
        disabledSkills,
        onStart: (args) =>
          broadcastIpc('chat-tool-start', {
            callId,
            name,
            args,
            timestamp: Date.now(),
            chatId
          })
      }),
      onToolResult: (call) =>
        broadcastIpc('chat-tool-end', {
          callId: call.callId,
          name: call.name,
          result: call.modelContent,
          chatId
        }),
      onHistoryMessage: (historyMessage) => {
        historyMessages.push(prepareHistoryMessage(chatId, historyMessage))
        saveChatSession(
          chatId,
          historyMessages,
          undefined,
          currentSessionMode,
          currentDisciplinePath,
          currentSelectedChatModel
        )
      },
      finalInstruction:
        '# Tool loop limit reached\nThe maximum of 100 tool rounds has been reached. ' +
        'Do not call more tools. Explain what was completed, what remains, and the last tool result.'
    })

    const finalOutput = parseThoughtAndContent(
      orchestration.accumulatedText,
      orchestration.accumulatedReasoning
    )
    const totalWorkedDuration = Math.max(1, Math.round((Date.now() - turnStartTime) / 1000))
    broadcastIpc('chat-reply-end', {
      thoughts: finalOutput.thoughts,
      finalResponse: finalOutput.content,
      rawText: finalOutput.content,
      isThinking: false,
      thinkingDuration: totalThinkingDuration || undefined,
      workedDuration: totalWorkedDuration || undefined,
      chatId,
      ...(orchestration.loopLimitReached ? { loopLimitReached: true } : {})
    })
  } catch (error: unknown) {
    const caughtError = error instanceof Error ? error : new Error(String(error))
    if (abortController.signal.aborted || caughtError.name === 'AbortError') {
      broadcastIpc('chat-reply-error', { error: 'Message cancelled by user', chatId })
    } else {
      console.error(`[Main Chat] Error in handleChatMessage for chat ${chatId}:`, caughtError)
      console.error(`[Main Chat] Error name: ${caughtError.name}, message: ${caughtError.message}`)
      if (caughtError.stack) console.error(`[Main Chat] Stack: ${caughtError.stack}`)
      broadcastIpc('chat-reply-error', { error: caughtError.message, chatId })
    }
  } finally {
    activeRuns.delete(chatId)
  }
}

function convertHistoryToOpenAi(history: OpenAiMessage[]): OpenAiMessage[] {
  return history
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.tool_call_id || `call_${Date.now()}`,
          name: m.name,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          tool_attachments: m.tool_attachments
        }
      }
      const content =
        m.content ?? (m.parts ? m.parts.map((part) => part.text || '').join('\n') : null)
      return {
        role: m.role === 'model' ? 'assistant' : m.role,
        content: content || '',
        tool_calls: m.tool_calls,
        provider_metadata: m.provider_metadata
      }
    })
}

async function generateTitleInBackground(
  _event: IpcMainEvent,
  provider: import('../../shared/types').ProviderConfig,
  modelId: string,
  firstMessage: string,
  chatId: string
): Promise<void> {
  try {
    console.log(
      `[Title Generator] Generating title for chat ${chatId} using model ${modelId} via provider ${provider.name || provider.baseUrl}...`
    )
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
    broadcastIpc('chat-title-received', { id: chatId, title })
  } catch {
    updateChatSessionTitle(chatId, 'New Conversation')
    broadcastIpc('chat-title-received', { id: chatId, title: 'New Conversation' })
  }
}

function stripAnsi(str: string): string {
  return str.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ''
  )
}

async function wakeUpChatFromBackground(session: TerminalProcessSession): Promise<void> {
  const chatId = session.chatId
  if (!chatId || activeRuns.has(chatId)) return

  const chatSession = loadChatSession(chatId)
  if (!chatSession || !chatSession.messages || chatSession.messages.length === 0) return

  session.notified = true

  const cleanOutput = stripAnsi(session.outputBuffer).trim()
  const notifMsg: OpenAiMessage = {
    role: 'user',
    content: `[SYSTEM NOTIFICATION: Background terminal command (Run ID: ${session.runId}, Command: "${session.command}") finished with status "${session.status}" (Exit Code: ${session.exitCode ?? 'N/A'}). Output:\n${cleanOutput || '(No output produced).'}]`,
    isSystemNotification: true,
    hidden: true
  }

  const historyMessages = hydrateHistoryToolAttachments(chatId, chatSession.messages)
  historyMessages.push(prepareHistoryMessage(chatId, notifMsg))
  saveChatSession(
    chatId,
    historyMessages,
    undefined,
    chatSession.sessionMode,
    chatSession.disciplinePath,
    chatSession.model
  )

  const selectedModel = chatSession.model || currentSelectedChatModel
  const { provider, model } = resolveProviderAndModel(selectedModel)
  if (!provider || !provider.apiKey || !model) return

  markConnectionActive()

  broadcastIpc('chat-reply-start', { chatId })

  const abortController = new AbortController()
  activeRuns.set(chatId, {
    chatId,
    abortController,
    streamedText: '',
    status: 'running'
  })

  try {
    const config = loadConfig()
    const disabledSkills = chatSession.disabledSkills || config.disabledSkills || []
    const isPrismCloud = provider.id === PRISM_PROVIDER_ID || provider.name === 'Prism Cloud'

    const cleanModelId = model.id.startsWith('prism_provider:')
      ? model.id.replace('prism_provider:', '')
      : model.id
    const cleanSelectedKey = selectedModel.startsWith('prism_provider:')
      ? selectedModel.replace('prism_provider:', '')
      : selectedModel

    const configLevel =
      config.modelReasoningLevels?.[selectedModel] ||
      config.modelReasoningLevels?.[cleanSelectedKey] ||
      config.modelReasoningLevels?.[model.id] ||
      config.modelReasoningLevels?.[cleanModelId]

    const reasoningLevel = normalizePrismThinkingLevel(provider, model.id, configLevel)

    const systemPrompt = getSystemToolsPrompt(
      model.id,
      'main',
      undefined,
      chatSession.sessionMode,
      chatSession.disciplinePath,
      model.name,
      isPrismCloud,
      disabledSkills
    )

    const openAiTools =
      chatSession.sessionMode === 'conversation'
        ? []
        : getNativeToolsForOpenAi('main', undefined, chatId, disabledSkills)

    const messagesForApi: OpenAiMessage[] = [
      { role: 'system', content: systemPrompt },
      ...convertHistoryToOpenAi(historyMessages)
    ]

    const turnStartTime = Date.now()
    const thinkingTimes = new Map<number, { startedAt?: number; endedAt?: number }>()
    let totalThinkingDuration = 0

    const parseThoughtAndContent = (
      rawText: string,
      extraReasoning: string
    ): { thoughts: string; content: string } => {
      let thoughts = extraReasoning || ''
      let content = rawText
      const thinkMatch = rawText.match(/<think>([\s\S]*?)(?:<\/think>|$)/i)
      if (thinkMatch) {
        thoughts = thoughts ? `${thoughts}\n${thinkMatch[1]}` : thinkMatch[1]
        content = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*/gi, '')
      }
      return { thoughts, content }
    }

    const orchestration = await runToolOrchestration({
      provider,
      modelId: model.id,
      messages: messagesForApi,
      tools: openAiTools,
      getToolsForRound: () =>
        chatSession.sessionMode === 'conversation'
          ? []
          : getNativeToolsForOpenAi('main', undefined, chatId, disabledSkills),
      getPendingNotifications: () => getPendingProcessNotifications(chatId),
      signal: abortController.signal,
      reasoningLevel,
      onStreamEvent: (streamEvent, state) => {
        const timing = thinkingTimes.get(state.round) || {}
        if (streamEvent.type === 'reasoning' && !timing.startedAt) timing.startedAt = Date.now()
        if (streamEvent.type !== 'reasoning' && timing.startedAt && !timing.endedAt) {
          timing.endedAt = Date.now()
        }
        thinkingTimes.set(state.round, timing)

        if (streamEvent.type === 'tool') {
          broadcastIpc('chat-tool-call-delta', { chatId, ...streamEvent.delta })
          return
        }
        const combinedText = state.accumulatedText
          ? `${state.accumulatedText}\n\n${state.currentText}`
          : state.currentText
        const combinedReasoning = state.accumulatedReasoning
          ? `${state.accumulatedReasoning}\n\n${state.currentReasoning}`
          : state.currentReasoning
        const parsed = parseThoughtAndContent(combinedText, combinedReasoning)
        broadcastIpc('chat-reply-chunk', {
          chatId,
          thoughts: parsed.thoughts,
          finalResponse: parsed.content,
          isThinking: streamEvent.type === 'reasoning',
          isWritingToolCall: state.streamingToolCalls.length > 0
        })
      },
      decorateAssistantMessage: (assistantMessage, _result, state) => {
        const timing = thinkingTimes.get(state.round)
        if (timing?.startedAt) {
          const duration = Math.max(
            1,
            Math.round(((timing.endedAt || Date.now()) - timing.startedAt) / 1000)
          )
          assistantMessage.thinking_duration = duration
          totalThinkingDuration += duration
        }
        return assistantMessage
      },
      createToolContext: ({ callId, name }) => ({
        apiKey: provider.apiKey,
        signal: abortController.signal,
        chatId,
        disabledSkills,
        onStart: (args) =>
          broadcastIpc('chat-tool-start', {
            callId,
            name,
            args,
            timestamp: Date.now(),
            chatId
          })
      }),
      onToolResult: (call) =>
        broadcastIpc('chat-tool-end', {
          callId: call.callId,
          name: call.name,
          result: call.modelContent,
          chatId
        }),
      onHistoryMessage: (historyMessage) => {
        historyMessages.push(prepareHistoryMessage(chatId, historyMessage))
        saveChatSession(
          chatId,
          historyMessages,
          undefined,
          chatSession.sessionMode,
          chatSession.disciplinePath,
          selectedModel
        )
      },
      finalInstruction:
        '# Tool loop limit reached\nThe maximum of 100 tool rounds has been reached. ' +
        'Do not call more tools. Explain what was completed, what remains, and the last tool result.'
    })

    const finalOutput = parseThoughtAndContent(
      orchestration.accumulatedText,
      orchestration.accumulatedReasoning
    )
    const totalWorkedDuration = Math.max(1, Math.round((Date.now() - turnStartTime) / 1000))
    broadcastIpc('chat-reply-end', {
      thoughts: finalOutput.thoughts,
      finalResponse: finalOutput.content,
      rawText: finalOutput.content,
      isThinking: false,
      thinkingDuration: totalThinkingDuration || undefined,
      workedDuration: totalWorkedDuration || undefined,
      chatId,
      ...(orchestration.loopLimitReached ? { loopLimitReached: true } : {})
    })
  } catch (error: unknown) {
    const caughtError = error instanceof Error ? error : new Error(String(error))
    if (abortController.signal.aborted || caughtError.name === 'AbortError') {
      broadcastIpc('chat-reply-error', { error: 'Message cancelled by user', chatId })
    } else {
      console.error(`[Background Wakeup] Error in chat ${chatId}:`, caughtError)
      broadcastIpc('chat-reply-error', { error: caughtError.message, chatId })
    }
  } finally {
    activeRuns.delete(chatId)
  }
}

// Global listener for background terminal processes completion
onBackgroundProcessEnded((session) => {
  wakeUpChatFromBackground(session)
})
