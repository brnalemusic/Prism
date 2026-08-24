import { IpcMainEvent } from 'electron'
import * as os from 'os'
import { SessionMode, AttachedFile } from '../../shared/types'
import type { ToolImageAttachment } from '../toolAttachments'
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
import { unlockBrowserToolsForSession } from '../skillsManager'
import { normalizePrismThinkingLevel } from './prismThinking'
import { createTerminalNotificationMessage, runToolOrchestration } from './toolOrchestrator'
import { markConnectionActive } from '../connection'
import {
  getPendingProcessNotifications,
  onTerminalNotificationPending
} from '../terminalProcessManager'
import { hasConfiguredImageGenerationRoute } from './imageGeneration'
import { isStrictBase64 } from './imageGenerationCore'
import { asDataUrl, imageAttachments } from '../toolAttachments'
import { dedupeImageAttachments, formatImageAssetReference, isImageAssetId } from '../imageAssets'

export const activeRuns = new Map<string, ActiveRun>()
export const lastScreenshots = new Map<string, string>()
const deletedActiveChats = new Set<string>()
const currentSessionId = ''

let currentSelectedChatModel = ''
let currentSessionMode: SessionMode = 'execution'
let currentDisciplinePath = ''

const SUPPORTED_CHAT_IMAGE_MIME_TYPES = new Set<ToolImageAttachment['mimeType']>([
  'image/jpeg',
  'image/png',
  'image/webp'
])

function normalizeChatImage(
  value: string,
  declaredMimeType: string,
  name?: string
): ToolImageAttachment | null {
  let mimeType =
    declaredMimeType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : declaredMimeType.toLowerCase()
  let data = value.trim()
  const dataUrl = data.match(/^data:([^;,]+);base64,(.+)$/s)
  if (dataUrl) {
    mimeType = dataUrl[1].toLowerCase()
    data = dataUrl[2]
  }
  if (!SUPPORTED_CHAT_IMAGE_MIME_TYPES.has(mimeType as ToolImageAttachment['mimeType'])) {
    return null
  }
  data = data.replace(/\s/g, '')
  if (!isStrictBase64(data)) return null
  return {
    kind: 'image',
    mimeType: mimeType as ToolImageAttachment['mimeType'],
    data,
    ...(name ? { name } : {})
  }
}

function collectIncomingImages(
  screenshot?: string,
  attachedFile?: AttachedFile
): ToolImageAttachment[] {
  const candidates: ToolImageAttachment[] = []
  if (attachedFile?.mimeType.startsWith('image/')) {
    const attachment = normalizeChatImage(
      attachedFile.data,
      attachedFile.mimeType,
      attachedFile.name
    )
    if (attachment) candidates.push(attachment)
  }
  if (screenshot) {
    const attachment = normalizeChatImage(screenshot, 'image/png', 'Screenshot.png')
    if (attachment) candidates.push(attachment)
  }
  return dedupeImageAttachments(candidates)
}

export function setChatModel(modelKey: string): void {
  currentSelectedChatModel = modelKey
}

export function markActiveChatDeleted(chatId: string): void {
  if (activeRuns.has(chatId)) deletedActiveChats.add(chatId)
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
  const definitions = getOpenAiToolDefinitions(chatId, disabledSkills).filter(
    (definition) =>
      definition.function.name !== 'generate_image' ||
      (_target === 'main' && hasConfiguredImageGenerationRoute())
  )
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
  deletedActiveChats.delete(chatId)
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
  const userText = rawUserText.replace(/^\[FORCE_SEARCH\]\s*/i, '')

  const userMessage: OpenAiMessage = {
    role: 'user',
    content: userText,
    quote: quote || undefined
  }

  const incomingImages = collectIncomingImages(screenshot, attachedFile)
  if (attachedFile?.mimeType.startsWith('image/') && incomingImages.length === 0) {
    safeSend(event.sender, 'chat-reply-error', {
      error: 'Unsupported or invalid image. Please use a valid PNG, JPEG, or WebP file.',
      chatId
    })
    return
  }
  if (incomingImages.length > 0) userMessage.image_attachments = incomingImages

  const persistedUserMessage = prepareHistoryMessage(chatId, userMessage)
  const hydratedUserMessage = hydrateHistoryToolAttachments(chatId, [persistedUserMessage])[0]
  historyMessages.push(hydratedUserMessage)

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

    const appMode = typeof data === 'object' ? data.appMode : undefined
    const isYoutubeMode =
      appMode === 'youtube' ||
      /^Search YouTube for:/i.test(firstMsgText) ||
      /^\/youtube\b/i.test(firstMsgText)

    if (isYoutubeMode) {
      unlockBrowserToolsForSession(chatId)
    }

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
    if (!hasConfiguredImageGenerationRoute()) {
      fullPrompt +=
        '\n\n# Image Generation Availability\nNative image generation is unavailable because no valid Image Generation Model is configured in Settings > Intelligence Routing. If the user requests an image, explain that configuration is required; do not pretend to have generated one.'
    }
    if (matchedWorkflow) {
      fullPrompt += `\n\n# Active Workflow: ${matchedWorkflow.name}\n${matchedWorkflow.systemInstruction}`
    }
    if (isForceSearch && !isYoutubeMode) {
      fullPrompt += `\n\n# Web Search Requirement\nThe user has explicitly enabled Web Search for this prompt. You MUST use the 'web_search' tool to search the internet for current up-to-date information before returning your response.`
    }
    if (isYoutubeMode) {
      fullPrompt += `\n\n# YouTube Video Search Protocol (Active YouTube App Mode)
You are acting as the specialized YouTube Assistant. The user wants to find YouTube videos.
STRICT EXECUTION PROTOCOL:
1. SEARCH VIA GOOGLE QUERY: You MUST search using the 'web_search' tool with the exact query format:
   \`site:youtube.com <SEARCH_QUERY>\`
   (e.g., web_search({ query: "site:youtube.com Thinking Space II verified" })).
   This uses Google search to instantly and reliably locate the official YouTube video URLs (https://www.youtube.com/watch?v=...), channel names, video titles, and snippets.
2. OUTPUT FORMAT (MANDATORY STYLED CARD BLOCK): You MUST format your final response by wrapping the title, description, and buttons in an HTML card container block, followed by the suggestion chip below it:

<div style="border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; padding: 18px 20px; background: rgba(255, 255, 255, 0.03); margin: 12px 0;">
  <div style="font-size: 16px; font-weight: bold; color: #ffffff; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
    🎬 <span>[Video Title / Clean Name]</span>
  </div>
  <div style="font-size: 14px; color: rgba(255, 255, 255, 0.75); line-height: 1.5; margin-bottom: 16px;">
    [Customized description of what was found based on the user request].
  </div>
  <div style="display: flex; gap: 10px; flex-wrap: wrap;">
    <a href="https://www.youtube.com/watch?v=..." target="_blank" style="display: inline-flex; align-items: center; justify-content: center; background-color: #ff0000; color: #ffffff; padding: 8px 18px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 13.5px;">[Primary Action/Watch Label]</a>
    <a href="https://www.youtube.com/watch?v=..." target="_blank" style="display: inline-flex; align-items: center; justify-content: center; background-color: #272727; color: #ffffff; padding: 8px 18px; border-radius: 8px; font-weight: 600; text-decoration: none; font-size: 13.5px;">[Alternative Label]</a>
  </div>
</div>

<prism-suggestion send="Open the YouTube video that you've found for me.">Open the video</prism-suggestion>

STRICT BUTTON RULES:
- Maximum 3 buttons total inside the flex container (1 primary in bold red #ff0000, up to 2 alternatives in dark charcoal #272727).
- All buttons MUST be clickable <a> links with real href="https://www.youtube.com/watch?v=..." and target="_blank".
- The <prism-suggestion> chip MUST be outside/below the card container.
3. OPENING THE FOUND VIDEO: If the user sends "Open the YouTube video that you've found for me." or asks to open/play the video, immediately call 'open_browser_link' with the target video URL to open it in their browser.`
    }

    setCurrentSessionIdForTodo(chatId)

    const getToolsForSessionMode = (): OpenAiToolDefinition[] => {
      let tools =
        currentSessionMode === 'conversation'
          ? []
          : getNativeToolsForOpenAi(
              'main',
              matchedWorkflow?.toolConstraints,
              chatId,
              disabledSkills
            )
      if (isYoutubeMode) {
        const allTools = getNativeToolsForOpenAi('main', undefined, chatId, disabledSkills)
        const youtubeTools = allTools.filter((t) =>
          [
            'web_search',
            'open_browser_link',
            'open_browser',
            'browser_navigate',
            'browser_snapshot',
            'detailed_dom_page',
            'browser_click',
            'browser_type',
            'browser_press',
            'browser_scroll',
            'browser_back',
            'web_script'
          ].includes(t.function.name)
        )
        const existingNames = new Set(tools.map((t) => t.function.name))
        for (const tool of youtubeTools) {
          if (!existingNames.has(tool.function.name)) {
            tools.push(tool)
          }
        }
      } else if (isForceSearch) {
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
          attachments: call.attachments,
          chatId
        }),
      onHistoryMessage: (historyMessage) => {
        if (deletedActiveChats.has(chatId)) return
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
    deletedActiveChats.delete(chatId)
    setImmediate(() => void wakeUpChatFromPendingTerminalNotifications(chatId))
  }
}

function imageReferenceContext(message: OpenAiMessage): string {
  const references = [
    ...(message.image_attachment_refs || []),
    ...(message.tool_attachment_refs || [])
  ]
  if (references.length === 0) return ''
  const lines = references
    .filter((reference) => isImageAssetId(reference.id))
    .map((reference) => {
      const label = reference.name ? ` (${reference.name})` : ''
      const dimensions =
        reference.width && reference.height ? `, ${reference.width}x${reference.height}` : ''
      return `- ${formatImageAssetReference(reference.id)}${label}${dimensions}`
    })
  if (lines.length === 0) return ''
  return `[Prism image assets available to tools]\n${lines.join('\n')}`
}

function appendImageReferenceContext(content: string, context: string): string {
  if (!context || content.includes(context)) return content
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return JSON.stringify({ ...parsed, image_references: context.split('\n').slice(1) })
    }
  } catch {
    // Plain text tool and user content is annotated below.
  }
  return content ? `${content}\n\n${context}` : context
}

function convertHistoryToOpenAi(history: OpenAiMessage[]): OpenAiMessage[] {
  const seenImages = new Set<string>()
  return history
    .filter((m) => m.role !== 'system')
    .map((m) => {
      const referenceContext = imageReferenceContext(m)
      if (m.role === 'tool') {
        const content = appendImageReferenceContext(
          typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          referenceContext
        )
        return {
          role: 'tool',
          tool_call_id: m.tool_call_id || `call_${Date.now()}`,
          name: m.name,
          content,
          tool_attachments: dedupeImageAttachments(imageAttachments(m.tool_attachments), seenImages)
        }
      }
      let content =
        m.content ?? (m.parts ? m.parts.map((part) => part.text || '').join('\n') : null)
      if (m.role === 'user' && m.quote) {
        if (typeof content === 'string' && !content.startsWith('> ')) {
          content = `> ${m.quote}\n\n${content}`
        } else if (Array.isArray(content)) {
          content = content.map((part) => {
            if (
              part &&
              typeof part === 'object' &&
              part.type === 'text' &&
              typeof part.text === 'string' &&
              !part.text.startsWith('> ')
            ) {
              return { ...part, text: `> ${m.quote}\n\n${part.text}` }
            }
            return part
          })
        }
      }

      if (m.role === 'user') {
        const textParts = Array.isArray(content)
          ? content.filter((part) => part.type === 'text')
          : [{ type: 'text', text: String(content || '') }]
        const annotatedText = appendImageReferenceContext(
          textParts.map((part) => part.text || '').join('\n'),
          referenceContext
        )
        const attachments = dedupeImageAttachments(
          imageAttachments(m.image_attachments),
          seenImages
        )
        content =
          attachments.length > 0
            ? [
                { type: 'text', text: annotatedText },
                ...attachments.map((attachment) => ({
                  type: 'image_url',
                  image_url: { url: asDataUrl(attachment) }
                }))
              ]
            : annotatedText
      }

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

async function wakeUpChatFromPendingTerminalNotifications(chatId: string): Promise<void> {
  if (!chatId || activeRuns.has(chatId)) return

  const chatSession = loadChatSession(chatId)
  if (!chatSession || !chatSession.messages || chatSession.messages.length === 0) return

  const selectedModel = chatSession.model || currentSelectedChatModel
  const { provider, model } = resolveProviderAndModel(selectedModel)
  if (!provider || !provider.apiKey || !model) return

  const pendingNotifications = getPendingProcessNotifications(chatId)
  if (pendingNotifications.length === 0) return
  const historyMessages = hydrateHistoryToolAttachments(chatId, chatSession.messages)
  for (const notification of pendingNotifications) {
    historyMessages.push(
      prepareHistoryMessage(chatId, createTerminalNotificationMessage(notification))
    )
  }
  saveChatSession(
    chatId,
    historyMessages,
    undefined,
    chatSession.sessionMode,
    chatSession.disciplinePath,
    chatSession.model
  )

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

    const imageAvailabilityInstruction = hasConfiguredImageGenerationRoute()
      ? ''
      : '\n\n# Image Generation Availability\nNative image generation is unavailable because no valid Image Generation Model is configured in Settings > Intelligence Routing. If the user requests an image, explain that configuration is required; do not pretend to have generated one.'

    const openAiTools =
      chatSession.sessionMode === 'conversation'
        ? []
        : getNativeToolsForOpenAi('main', undefined, chatId, disabledSkills)

    const messagesForApi: OpenAiMessage[] = [
      { role: 'system', content: `${systemPrompt}${imageAvailabilityInstruction}` },
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
          attachments: call.attachments,
          chatId
        }),
      onHistoryMessage: (historyMessage) => {
        if (deletedActiveChats.has(chatId)) return
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
    deletedActiveChats.delete(chatId)
    setImmediate(() => void wakeUpChatFromPendingTerminalNotifications(chatId))
  }
}

// Wake an idle chat immediately; active chats drain the queue between tool rounds.
onTerminalNotificationPending((chatId) => {
  if (!activeRuns.has(chatId)) {
    void wakeUpChatFromPendingTerminalNotifications(chatId)
  }
})
