import { IpcMainEvent } from 'electron'
import * as os from 'os'
import * as path from 'path'
import {
  SessionMode,
  AttachedFile,
  HarnessApprovalItem,
  HarnessToolName,
  HarnessContextSnapshot,
  EffectiveHarnessSettings,
  HarnessExplorerSelection,
  HarnessPhase
} from '../../shared/types'
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
import { appendTurnRecallBlock, getActiveMemoryService } from '../memoryStore'
import { safeSend, broadcastIpc } from '../safeSend'
import { getOpenAiToolDefinitions } from '../toolRuntime'
import { unlockBrowserToolsForSession } from '../skillsManager'
import { normalizePrismThinkingLevel } from './prismThinking'
import {
  createTerminalNotificationMessage,
  runToolOrchestration,
  type ToolOrchestratorOptions
} from './toolOrchestrator'
import { markConnectionActive } from '../connection'
import {
  getPendingProcessNotifications,
  onTerminalNotificationPending
} from '../terminalProcessManager'
import { hasConfiguredImageGenerationRoute } from './imageGeneration'
import { isStrictBase64 } from './imageGenerationCore'
import { asDataUrl, imageAttachments } from '../toolAttachments'
import { dedupeImageAttachments, formatImageAssetReference, isImageAssetId } from '../imageAssets'
import { checkHarnessProjectFolder, getEffectiveHarnessSettings } from '../harnessProject'
import { getHarnessSystemPrompt } from '../harnessPrompt'
import {
  executeHarnessTool,
  getHarnessOpenAiToolDefinitions,
  getHarnessToolLabel,
  harnessToolRequiresExternalApproval,
  previewHarnessTool
} from '../harnessTools'
import { getHarnessToolNamesForPhase, isReadOnlyHarnessPlanCommand } from '../harnessPlan'
import { requestHarnessApproval, cancelHarnessApprovalsForChat } from '../harnessApproval'
import type { ToolResultEnvelope } from '../toolRuntime'
import { resolveRequestModelKey, resolveRunWorkspace } from './sessionRuntime'
import { readHarnessExplorerContext } from '../harnessExplorer'

export const activeRuns = new Map<string, ActiveRun>()
export const lastScreenshots = new Map<string, string>()
const deletedActiveChats = new Set<string>()
const activePlanHandoffs = new Map<string, AbortController>()
const currentSessionId = ''

let currentSelectedChatModel = ''
let currentSessionMode: SessionMode = 'execution'
let currentDisciplinePath = ''

function isSameProjectPath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left)
  const resolvedRight = path.resolve(right)
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight
}

function harnessSystemPromptLabel(modelId: string): string {
  const cleanId = modelId
    .replace(/^prism_provider:/, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
  return `@${cleanId}/harness-system-prompt`
}

function parseThoughtAndContent(
  rawText: string,
  extraReasoning: string
): { thoughts: string; content: string } {
  let thoughts = extraReasoning || ''
  let content = rawText
  const thinkMatch = rawText.match(/<think>([\s\S]*?)(?:<\/think>|$)/i)
  if (thinkMatch) {
    thoughts = thoughts ? `${thoughts}\n${thinkMatch[1]}` : thinkMatch[1]
    content = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*/gi, '')
  }
  return { thoughts, content }
}

function createHarnessBeforeToolBatch(
  chatId: string,
  projectPath: string,
  settings: EffectiveHarnessSettings,
  signal: AbortSignal
): NonNullable<ToolOrchestratorOptions['beforeToolBatch']> {
  return async (calls) => {
    const callsRequiringApproval = calls.filter(
      (call) => call.name !== 'to_ask' && call.name !== 'plan'
    )
    if (callsRequiringApproval.length === 0) return true
    const needsApproval =
      settings.defaultPermissionMode === 'ask' ||
      (settings.defaultPermissionMode === 'yolo' && !settings.yoloAcknowledged) ||
      (settings.defaultPermissionMode === 'independent' &&
        callsRequiringApproval.some((call) =>
          harnessToolRequiresExternalApproval(call.name, call.args)
        ))
    if (!needsApproval) return true
    const items: HarnessApprovalItem[] = await Promise.all(
      callsRequiringApproval.map(async (call) => {
        try {
          return await previewHarnessTool(call.callId, call.name, call.args, projectPath)
        } catch (error) {
          return {
            callId: call.callId,
            name: call.name as HarnessToolName,
            label: getHarnessToolLabel(call.name),
            args:
              call.args && typeof call.args === 'object' && !Array.isArray(call.args)
                ? (call.args as Record<string, unknown>)
                : {},
            preview: `Unable to prepare preview: ${error instanceof Error ? error.message : String(error)}`,
            destructive: true
          }
        }
      })
    )
    return requestHarnessApproval(chatId, projectPath, items, signal)
  }
}

function createHarnessToolExecutor(
  projectPath: string,
  settings: EffectiveHarnessSettings,
  phase: HarnessPhase
): NonNullable<ToolOrchestratorOptions['executeTool']> {
  return async (name, args, context, loopGuard) => {
    if (phase === 'plan') {
      const allowed = new Set([
        'read', 'list', 'find', 'grep', 'to_ask', 'plan',
        'exec_command', 'read_terminal_output', 'web_search'
      ])
      let planError: string | null = allowed.has(name)
        ? null
        : `The ${name} tool is unavailable in Plan mode.`
      if (!planError && name === 'exec_command') {
        let command = ''
        try {
          const parsed = typeof args === 'string' ? JSON.parse(args) : args
          command =
            parsed && typeof parsed === 'object' && typeof parsed.cmd === 'string'
              ? parsed.cmd
              : ''
        } catch {
          command = ''
        }
        if (!isReadOnlyHarnessPlanCommand(command)) {
          planError = 'Plan mode only allows terminal commands that are provably read-only.'
        }
      }
      if (planError) {
        const envelope: ToolResultEnvelope = {
          ok: false,
          error: { code: 'EXECUTION_FAILED', message: planError, retryable: false }
        }
        return { args: {}, envelope, modelContent: JSON.stringify(envelope) }
      }
    }
    const repeatedError = loopGuard.register(name, args)
    if (repeatedError) {
      const envelope: ToolResultEnvelope = { ok: false, error: repeatedError }
      return { args: {}, envelope, modelContent: JSON.stringify(envelope) }
    }
    return executeHarnessTool(name, args, {
      ...context,
      projectRoot: projectPath,
      settings
    })
  }
}

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
    cancelHarnessApprovalsForChat(chatId)
    const run = activeRuns.get(chatId)
    if (run) {
      run.abortController.abort()
      activeRuns.delete(chatId)
    }
  } else {
    for (const [id, run] of activeRuns.entries()) {
      cancelHarnessApprovalsForChat(id)
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

export interface ChatMessagePayload {
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
  explorerContext?: HarnessExplorerSelection[]
  harnessPhase?: HarnessPhase
}

/** Dedicated entrypoint: the Harness never travels through the Chat IPC channel. */
export async function handleHarnessMessage(
  event: IpcMainEvent,
  data: Omit<ChatMessagePayload, 'sessionMode' | 'disciplinePath' | 'appMode'> & {
    projectPath: string
  }
): Promise<void> {
  return handleChatMessage(
    event,
    {
      ...data,
      sessionMode: 'harness',
      disciplinePath: data.projectPath,
      appMode: undefined,
      disabledSkills: []
    },
    'harness'
  )
}

export async function prepareHarnessPlanHandoff(data: {
  chatId: string
  projectPath: string
  modelKey: string
  plan: string
}): Promise<{ context: string }> {
  const session = loadChatSession(data.chatId, 'harness')
  if (!session || !session.disciplinePath) {
    throw new Error('The source Harness session could not be loaded.')
  }
  if (!isSameProjectPath(session.disciplinePath, data.projectPath)) {
    throw new Error('The handoff must remain in the source Harness project.')
  }
  const publishedPlans = session.messages.flatMap((message) =>
    (message.tool_calls || [])
      .filter((call) => call.function.name === 'plan')
      .map((call) => {
        try {
          const args = JSON.parse(call.function.arguments) as { markdown?: unknown }
          return typeof args.markdown === 'string' ? args.markdown.trim() : ''
        } catch {
          return ''
        }
      })
  )
  if (!data.plan.trim() || !publishedPlans.includes(data.plan.trim())) {
    throw new Error('The selected implementation plan is not part of the source session.')
  }
  const { provider, model } = resolveProviderAndModel(data.modelKey || session.model)
  if (!provider || !model || !provider.apiKey) {
    throw new Error('The source Harness model is unavailable.')
  }

  activePlanHandoffs.get(data.chatId)?.abort()
  const controller = new AbortController()
  activePlanHandoffs.set(data.chatId, controller)
  try {
    const history = hydrateHistoryToolAttachments(data.chatId, session.messages)
    const messages: OpenAiMessage[] = [
      {
        role: 'system',
        content:
          'You are preparing a precise implementation handoff for another coding agent. Use the complete source conversation to close gaps, preserve decisions and constraints, summarize repository discoveries, identify likely files and risks, and state validation expectations. Do not repeat the implementation plan verbatim. Return only the complementary handoff context in concise Markdown.'
      },
      ...convertHistoryToOpenAi(history),
      {
        role: 'user',
        content: `Prepare the final complementary context for this approved implementation plan:\n\n${data.plan}`
      }
    ]
    const result = await streamOpenAiCompletion(
      provider,
      model.id,
      messages,
      [],
      controller.signal,
      {
        onTextDelta: () => {},
        onReasoningDelta: () => {},
        onToolCallDelta: () => {}
      }
    )
    const context = result.text.trim()
    if (!context) throw new Error('The model returned an empty implementation context.')
    return { context }
  } finally {
    if (activePlanHandoffs.get(data.chatId) === controller) {
      activePlanHandoffs.delete(data.chatId)
    }
  }
}

export function cancelHarnessPlanHandoff(chatId: string): void {
  activePlanHandoffs.get(chatId)?.abort()
  activePlanHandoffs.delete(chatId)
}

export async function handleChatMessage(
  event: IpcMainEvent,
  data: string | ChatMessagePayload,
  workspace: 'chat' | 'harness' = 'chat'
): Promise<void> {
  const message = typeof data === 'string' ? data : data.message
  const chatId = typeof data === 'object' && data.chatId ? data.chatId : currentSessionId
  deletedActiveChats.delete(chatId)
  const screenshot = typeof data === 'object' ? data.screenshot : undefined
  const quote = typeof data === 'object' ? data.quote : undefined
  const attachedFile = typeof data === 'object' ? data.attachedFile : undefined
  const explorerContext =
    workspace === 'harness' && typeof data === 'object' && Array.isArray(data.explorerContext)
      ? data.explorerContext
      : []

  const sessionMode = typeof data === 'object' ? data.sessionMode : undefined
  const disciplinePath = typeof data === 'object' ? data.disciplinePath : undefined

  if (workspace === 'chat' && sessionMode === 'harness') {
    safeSend(event.sender, 'chat-reply-error', {
      error: 'Harness requests must be sent from the Harness workspace.',
      chatId,
      workspace
    })
    return
  }

  if (activeRuns.has(chatId)) {
    console.log(`Chat ${chatId} is already running. Ignoring duplicate.`)
    return
  }

  const session = loadChatSession(chatId, workspace)
  const requestHarnessPhase: HarnessPhase =
    workspace === 'harness' &&
    typeof data === 'object' &&
    (data.harnessPhase === 'plan' || data.harnessPhase === 'build')
      ? data.harnessPhase
      : workspace === 'harness' && session?.harnessPhase === 'plan'
        ? 'plan'
        : 'build'
  const payloadModelKey =
    typeof data === 'object' && typeof data.modelKey === 'string' ? data.modelKey.trim() : ''
  const requestModelKey = resolveRequestModelKey(
    workspace,
    payloadModelKey,
    session?.model,
    currentSelectedChatModel
  )

  // Harness selections are scoped to their tab/session. Only Chat may update the
  // legacy global selection used by regular conversations and one-shot commands.
  if (workspace === 'chat' && payloadModelKey) {
    currentSelectedChatModel = payloadModelKey
  }

  const { provider, model } = resolveProviderAndModel(requestModelKey)

  if (!requestModelKey || !provider || !provider.apiKey || !model) {
    safeSend(event.sender, 'chat-reply-error', {
      error: 'API_KEY_ERROR:401:API Key or Active Model Missing',
      chatId,
      workspace
    })
    return
  }

  markConnectionActive()

  const config = loadConfig()

  // Request-local mode avoids one workspace mutating another workspace's runtime.
  const configuredChatMode = config.sessionMode === 'harness' ? 'execution' : config.sessionMode
  const requestMode: SessionMode =
    workspace === 'harness'
      ? 'harness'
      : sessionMode || session?.sessionMode || configuredChatMode || currentSessionMode
  if (workspace === 'chat' && requestMode === 'harness') {
    safeSend(event.sender, 'chat-reply-error', {
      error: 'This conversation belongs to the Harness workspace.',
      chatId,
      workspace
    })
    return
  }
  if (workspace === 'chat') currentSessionMode = requestMode

  if (requestMode === 'discipline' || requestMode === 'harness') {
    const selectedProjectPath =
      disciplinePath ||
      (session?.sessionMode === requestMode ? session.disciplinePath : undefined) ||
      (requestMode === 'harness' ? config.harness.lastProjectPath : undefined)
    if (!selectedProjectPath) {
      safeSend(event.sender, 'chat-reply-error', {
        error: 'Select or create a Harness project before sending a message.',
        chatId,
        workspace
      })
      return
    }
    if (workspace === 'chat') {
      currentDisciplinePath = selectedProjectPath
      setActiveCwd(selectedProjectPath)
    }
  } else {
    if (workspace === 'chat') {
      currentDisciplinePath = ''
      if (requestMode === 'execution') {
        setActiveCwd(os.homedir())
      } else {
        setActiveCwd(process.cwd())
      }
    }
  }
  const requestSessionMode = requestMode
  const requestDisciplinePath =
    requestMode === 'discipline' || requestMode === 'harness'
      ? disciplinePath || session?.disciplinePath || config.harness.lastProjectPath || ''
      : ''

  // Load chat session from disk if existing
  const historyMessages: OpenAiMessage[] = session
    ? hydrateHistoryToolAttachments(chatId, session.messages)
    : []
  const persistedHarnessSnapshot = historyMessages.find(
    (historyMessage) => historyMessage.role === 'system' && historyMessage.harness_context_snapshot
  )?.harness_context_snapshot
  if (
    requestSessionMode === 'harness' &&
    persistedHarnessSnapshot &&
    !isSameProjectPath(persistedHarnessSnapshot.projectPath, requestDisciplinePath)
  ) {
    safeSend(event.sender, 'chat-reply-error', {
      error:
        'This Harness conversation is locked to its original project. Start a new conversation to use another project.',
      chatId,
      workspace
    })
    return
  }
  const harnessSettings =
    requestSessionMode === 'harness' ? getEffectiveHarnessSettings(requestDisciplinePath) : null
  if (requestSessionMode === 'harness') {
    if (!harnessSettings) {
      safeSend(event.sender, 'chat-reply-error', {
        error: 'The selected Harness project is not registered. Reopen it from the project picker.',
        chatId,
        workspace
      })
      return
    }
    const folderHealth = await checkHarnessProjectFolder(requestDisciplinePath)
    if (!folderHealth.exists || !folderHealth.isDirectory) {
      safeSend(event.sender, 'chat-reply-error', {
        error: `The project directory "${requestDisciplinePath}" does not exist on disk. Please recreate the folder or select another project.`,
        chatId,
        workspace
      })
      return
    }
  }

  // Check if first message
  const isFirstMessage = historyMessages.length === 0

  // Construct current user content
  const rawUserText = message
  const isForceSearch = rawUserText.startsWith('[FORCE_SEARCH]')
  const userText = rawUserText.replace(/^\[FORCE_SEARCH\]\s*/i, '')

  const userMessage: OpenAiMessage = {
    role: 'user',
    content: userText,
    quote: quote || undefined
  }

  if (harnessSettings && explorerContext.length > 0) {
    const resolvedContext = await readHarnessExplorerContext(
      harnessSettings.project.rootPath,
      explorerContext,
      harnessSettings.maxContextCharacters
    )
    userMessage.harness_explorer_context = resolvedContext.snapshot
    userMessage.visible_user_content = userText
    userMessage.content = `${userText}\n\n${resolvedContext.block}`
    if (resolvedContext.snapshot.warnings.length > 0) {
      safeSend(event.sender, 'harness-prompt-warning', {
        chatId,
        warnings: resolvedContext.snapshot.warnings,
        repoInstructionsLoaded: false
      })
    }
  }

  const incomingImages = collectIncomingImages(screenshot, attachedFile)
  if (attachedFile?.mimeType.startsWith('image/') && incomingImages.length === 0) {
    safeSend(event.sender, 'chat-reply-error', {
      error: 'Unsupported or invalid image. Please use a valid PNG, JPEG, or WebP file.',
      chatId,
      workspace
    })
    return
  }
  if (incomingImages.length > 0) userMessage.image_attachments = incomingImages

  const persistedUserMessage = prepareHistoryMessage(chatId, userMessage)
  const hydratedUserMessage = hydrateHistoryToolAttachments(chatId, [persistedUserMessage])[0]
  historyMessages.push(hydratedUserMessage)

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
      requestSessionMode,
      requestDisciplinePath,
      requestModelKey,
      false,
      disabledSkills,
      requestHarnessPhase
    )
    broadcastIpc('chat-session-created', { id: chatId })
  } else {
    saveChatSession(
      chatId,
      historyMessages,
      undefined,
      requestSessionMode,
      requestDisciplinePath,
      requestModelKey,
      undefined,
      disabledSkills,
      requestHarnessPhase
    )
  }

  broadcastIpc('chat-reply-start', { chatId, workspace })

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
    const cleanSelectedKey = requestModelKey.startsWith('prism_provider:')
      ? requestModelKey.replace('prism_provider:', '')
      : requestModelKey

    const configLevel =
      config.modelReasoningLevels?.[requestModelKey] ||
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
    let harnessSystemPrompt: string | null = null
    if (harnessSettings) {
      const contextMessages = historyMessages.filter(
        (historyMessage) =>
          historyMessage.role === 'system' && historyMessage.harness_context_snapshot
      )
      const existingSnapshot = contextMessages[contextMessages.length - 1]?.harness_context_snapshot
      const harnessPrompt = await getHarnessSystemPrompt(
        harnessSettings,
        harnessSystemPromptLabel(model.id),
        requestHarnessPhase
      )
      const needsContextInjection =
        !existingSnapshot || existingSnapshot.fingerprint !== harnessPrompt.fingerprint
      if (needsContextInjection) {
        const snapshot: HarnessContextSnapshot = {
          version: 1,
          createdAt: Date.now(),
          projectPath: harnessSettings.project.rootPath,
          modelId: model.id,
          fingerprint: harnessPrompt.fingerprint,
          entries: harnessPrompt.entries,
          warnings: harnessPrompt.warnings
        }
        const contextMessage: OpenAiMessage = {
          role: 'system',
          content: harnessPrompt.prompt,
          hidden: true,
          harness_context_snapshot: snapshot
        }
        // Initial context precedes the first user message. Refreshes are placed
        // immediately before the next user turn so the visible timeline matches
        // the prompt that will be used for that turn.
        if (existingSnapshot) {
          historyMessages.splice(Math.max(0, historyMessages.length - 1), 0, contextMessage)
        } else {
          historyMessages.unshift(contextMessage)
        }
        saveChatSession(
          chatId,
          historyMessages,
          undefined,
          requestSessionMode,
          requestDisciplinePath,
          requestModelKey,
          undefined,
          disabledSkills,
          requestHarnessPhase
        )
        broadcastIpc('harness-context-injection', { chatId, snapshot })
        if (harnessPrompt.warnings.length) {
          broadcastIpc('harness-prompt-warning', {
            chatId,
            warnings: harnessPrompt.warnings,
            repoInstructionsLoaded: harnessPrompt.repoInstructionsLoaded
          })
        }
      }
      harnessSystemPrompt = harnessPrompt.prompt
    }
    if (isFirstMessage) {
      // Start title generation only after a Harness context snapshot has been persisted.
      generateTitleInBackground(event, provider, model.id, message, chatId)
    }
    const systemPrompt = harnessSystemPrompt
      ? harnessSystemPrompt
      : getSystemToolsPrompt(
          model.id,
          'main',
          matchedWorkflow?.toolConstraints,
          requestSessionMode,
          requestDisciplinePath,
          model.name,
          isPrismCloud,
          disabledSkills
        )
    let fullPrompt = systemPrompt
    if (requestSessionMode !== 'harness' && !hasConfiguredImageGenerationRoute()) {
      fullPrompt +=
        '\n\n# Image Generation Availability\nNative image generation is unavailable because no valid Image Generation Model is configured in Settings > Intelligence Routing. If the user requests an image, explain that configuration is required; do not pretend to have generated one.'
    }
    if (requestSessionMode !== 'harness' && matchedWorkflow) {
      fullPrompt += `\n\n# Active Workflow: ${matchedWorkflow.name}\n${matchedWorkflow.systemInstruction}`
    }
    if (requestSessionMode !== 'harness' && isForceSearch && !isYoutubeMode) {
      fullPrompt += `\n\n# Web Search Requirement\nThe user has explicitly enabled Web Search for this prompt. You MUST use the 'web_search' tool to search the internet for current up-to-date information before returning your response. Set resultCount from 1 to 10; use 2–4 in most cases and 5–8 only for specific needs.`
    }
    if (requestSessionMode !== 'harness' && isYoutubeMode) {
      fullPrompt += `\n\n# YouTube Video Search Protocol (Active YouTube App Mode)
You are acting as the specialized YouTube Assistant. The user wants to find YouTube videos.
STRICT EXECUTION PROTOCOL:
1. SEARCH VIA GOOGLE QUERY: You MUST search using the 'web_search' tool with the exact query format:
   \`site:youtube.com <SEARCH_QUERY>\`
   (e.g., web_search({ query: "site:youtube.com Thinking Space II verified", resultCount: 3 })).
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

    // Long-term memory recall (M2): relevant facts ride this turn's prompt.
    // Never injected into Harness prompts; pinned facts already ride the
    // static core-profile block, so they are excluded here (no duplication).
    if (requestSessionMode !== 'harness') {
      fullPrompt = appendTurnRecallBlock(fullPrompt, userText)
    }

    setCurrentSessionIdForTodo(chatId)

    const getToolsForSessionMode = (): OpenAiToolDefinition[] => {
      if (requestSessionMode === 'harness' && harnessSettings) {
        return getHarnessOpenAiToolDefinitions(
          getHarnessToolNamesForPhase(harnessSettings.enabledTools, requestHarnessPhase)
        )
      }
      const tools =
        requestSessionMode === 'conversation'
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
          ['web_search', 'web_fetch', 'open_browser_link'].includes(t.function.name)
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

    const orchestration = await runToolOrchestration({
      provider,
      modelId: model.id,
      messages: messagesForApi,
      tools: openAiTools,
      getToolsForRound: () => getToolsForSessionMode(),
      getPendingNotifications: () => getPendingProcessNotifications(chatId),
      terminalInputToolName: harnessSettings ? 'write_stdin' : 'send_terminal_input',
      signal: abortController.signal,
      reasoningLevel,
      maxRounds: harnessSettings?.defaultMaxRounds,
      beforeToolBatch: harnessSettings
        ? createHarnessBeforeToolBatch(
            chatId,
            requestDisciplinePath,
            harnessSettings,
            abortController.signal
          )
        : undefined,
      executeTool: harnessSettings
        ? createHarnessToolExecutor(requestDisciplinePath, harnessSettings, requestHarnessPhase)
        : undefined,
      onStreamEvent: (streamEvent, state) => {
        const timing = thinkingTimes.get(state.round) || {}
        if (streamEvent.type === 'reasoning' && !timing.startedAt) timing.startedAt = Date.now()
        if (streamEvent.type !== 'reasoning' && timing.startedAt && !timing.endedAt) {
          timing.endedAt = Date.now()
        }
        thinkingTimes.set(state.round, timing)

        if (streamEvent.type === 'tool') {
          broadcastIpc('chat-tool-call-delta', { chatId, workspace, ...streamEvent.delta })
          return
        }
        const roundParsed = parseThoughtAndContent(
          state.currentText,
          harnessSettings?.showThinking === false ? '' : state.currentReasoning
        )
        const combinedText = state.accumulatedText
          ? `${state.accumulatedText}\n\n${state.currentText}`
          : state.currentText
        const combinedReasoning = state.accumulatedReasoning
          ? `${state.accumulatedReasoning}\n\n${state.currentReasoning}`
          : state.currentReasoning
        const parsed = parseThoughtAndContent(
          combinedText,
          harnessSettings?.showThinking === false ? '' : combinedReasoning
        )
        broadcastIpc('chat-reply-chunk', {
          chatId,
          workspace,
          thoughts: parsed.thoughts,
          finalResponse: parsed.content,
          isThinking: streamEvent.type === 'reasoning',
          isWritingToolCall: state.streamingToolCalls.length > 0,
          harnessRound: state.round,
          harnessRoundContent: roundParsed.content,
          harnessRoundThoughts: roundParsed.thoughts
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
      createToolContext: ({ callId, name, round }) => ({
        event,
        apiKey: provider.apiKey,
        signal: abortController.signal,
        chatId,
        disabledSkills,
        provider,
        modelId: model.id,
        onStart: (args) =>
          broadcastIpc('chat-tool-start', {
            callId,
            name,
            args,
            timestamp: Date.now(),
            chatId,
            workspace,
            round
          })
      }),
      onToolResult: (call) =>
        broadcastIpc('chat-tool-end', {
          callId: call.callId,
          name: call.name,
          result: call.modelContent,
          attachments: call.attachments,
          chatId,
          workspace,
          round: call.round
        }),
      onHistoryMessage: (historyMessage) => {
        if (deletedActiveChats.has(chatId)) return
        historyMessages.push(prepareHistoryMessage(chatId, historyMessage))
        saveChatSession(
          chatId,
          historyMessages,
          undefined,
          requestSessionMode,
          requestDisciplinePath,
          requestModelKey,
          undefined,
          undefined,
          requestHarnessPhase
        )
      },
      finalInstruction:
        `# Tool loop limit reached\nThe maximum of ${harnessSettings?.defaultMaxRounds || 100} tool rounds has been reached. ` +
        'Do not call more tools. Explain what was completed, what remains, and the last tool result.'
    })

    const finalOutput = parseThoughtAndContent(
      orchestration.accumulatedText,
      harnessSettings?.showThinking === false ? '' : orchestration.accumulatedReasoning
    )
    const finalRoundOutput = parseThoughtAndContent(
      orchestration.lastRoundText,
      harnessSettings?.showThinking === false ? '' : orchestration.lastRoundReasoning
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
      workspace,
      harnessRoundContent: finalRoundOutput.content,
      harnessRoundThoughts: finalRoundOutput.thoughts,
      ...(orchestration.loopLimitReached ? { loopLimitReached: true } : {})
    })
    // Post-turn extraction trigger (M2): only after a real assistant
    // completion (never on error paths); Harness turns stay excluded.
    if (requestSessionMode !== 'harness' && workspace === 'chat') {
      try {
        getActiveMemoryService()?.observeCompletedTurn(chatId)
      } catch (err) {
        console.error('[Memory] observeCompletedTurn failed:', err)
      }
    }
  } catch (error: unknown) {
    const caughtError = error instanceof Error ? error : new Error(String(error))
    if (abortController.signal.aborted || caughtError.name === 'AbortError') {
      broadcastIpc('chat-reply-error', { error: 'Message cancelled by user', chatId, workspace })
    } else {
      console.error(`[Main Chat] Error in handleChatMessage for chat ${chatId}:`, caughtError)
      console.error(`[Main Chat] Error name: ${caughtError.name}, message: ${caughtError.message}`)
      if (caughtError.stack) console.error(`[Main Chat] Stack: ${caughtError.stack}`)
      broadcastIpc('chat-reply-error', { error: caughtError.message, chatId, workspace })
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
          ...(m.name === 'generate_image'
            ? {}
            : {
                tool_attachments: dedupeImageAttachments(
                  imageAttachments(m.tool_attachments),
                  seenImages
                )
              })
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

  const workspace = resolveRunWorkspace(chatSession.workspace, chatSession.sessionMode)
  const selectedModel = resolveRequestModelKey(
    workspace,
    undefined,
    chatSession.model,
    currentSelectedChatModel
  )
  const { provider, model } = resolveProviderAndModel(selectedModel)
  if (!selectedModel || !provider || !provider.apiKey || !model) {
    broadcastIpc('chat-reply-error', {
      error: 'API_KEY_ERROR:401:API Key or Active Model Missing',
      chatId,
      workspace
    })
    return
  }

  const config = loadConfig()
  const projectPath = chatSession.disciplinePath || ''
  const harnessSettings =
    workspace === 'harness' && projectPath ? getEffectiveHarnessSettings(projectPath) : null
  if (workspace === 'harness' && !harnessSettings) {
    broadcastIpc('chat-reply-error', {
      error: 'The Harness project for this conversation is no longer registered.',
      chatId,
      workspace
    })
    return
  }

  const pendingNotifications = getPendingProcessNotifications(chatId)
  if (pendingNotifications.length === 0) return
  const historyMessages = hydrateHistoryToolAttachments(chatId, chatSession.messages)
  let harnessPrompt: Awaited<ReturnType<typeof getHarnessSystemPrompt>> | null = null
  if (harnessSettings) {
    harnessPrompt = await getHarnessSystemPrompt(harnessSettings, harnessSystemPromptLabel(model.id))
    const previousSnapshot = [...historyMessages]
      .reverse()
      .find((message) => message.role === 'system' && message.harness_context_snapshot)
      ?.harness_context_snapshot
    if (!previousSnapshot || previousSnapshot.fingerprint !== harnessPrompt.fingerprint) {
      const snapshot: HarnessContextSnapshot = {
        version: 1,
        createdAt: Date.now(),
        projectPath,
        modelId: model.id,
        fingerprint: harnessPrompt.fingerprint,
        entries: harnessPrompt.entries,
        warnings: harnessPrompt.warnings
      }
      historyMessages.push({
        role: 'system',
        content: harnessPrompt.prompt,
        hidden: true,
        harness_context_snapshot: snapshot
      })
      broadcastIpc('harness-context-injection', { chatId, snapshot })
      if (harnessPrompt.warnings.length > 0) {
        broadcastIpc('harness-prompt-warning', {
          chatId,
          warnings: harnessPrompt.warnings,
          repoInstructionsLoaded: harnessPrompt.repoInstructionsLoaded
        })
      }
    }
  }

  const terminalInputToolName = harnessSettings ? 'write_stdin' : 'send_terminal_input'
  for (const notification of pendingNotifications) {
    historyMessages.push(
      prepareHistoryMessage(
        chatId,
        createTerminalNotificationMessage(notification, terminalInputToolName)
      )
    )
  }
  saveChatSession(
    chatId,
    historyMessages,
    undefined,
    chatSession.sessionMode,
    chatSession.disciplinePath,
    selectedModel,
    chatSession.isDiscord,
    workspace === 'harness' ? [] : chatSession.disabledSkills
  )

  markConnectionActive()

  broadcastIpc('chat-reply-start', { chatId, workspace })

  const abortController = new AbortController()
  activeRuns.set(chatId, {
    chatId,
    abortController,
    streamedText: '',
    status: 'running'
  })

  try {
    const disabledSkills = workspace === 'harness' ? [] : chatSession.disabledSkills || config.disabledSkills || []
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

    const systemPrompt = harnessPrompt
      ? harnessPrompt.prompt
      : getSystemToolsPrompt(
          model.id,
          'main',
          undefined,
          chatSession.sessionMode,
          chatSession.disciplinePath,
          model.name,
          isPrismCloud,
          disabledSkills
        )

    const imageAvailabilityInstruction =
      workspace === 'harness' || hasConfiguredImageGenerationRoute()
      ? ''
      : '\n\n# Image Generation Availability\nNative image generation is unavailable because no valid Image Generation Model is configured in Settings > Intelligence Routing. If the user requests an image, explain that configuration is required; do not pretend to have generated one.'

    const getToolsForRound = (): OpenAiToolDefinition[] =>
      harnessSettings
        ? getHarnessOpenAiToolDefinitions(harnessSettings.enabledTools)
        : chatSession.sessionMode === 'conversation'
        ? []
        : getNativeToolsForOpenAi('main', undefined, chatId, disabledSkills)
    const openAiTools = getToolsForRound()

    const messagesForApi: OpenAiMessage[] = [
      { role: 'system', content: `${systemPrompt}${imageAvailabilityInstruction}` },
      ...convertHistoryToOpenAi(historyMessages)
    ]

    const turnStartTime = Date.now()
    const thinkingTimes = new Map<number, { startedAt?: number; endedAt?: number }>()
    let totalThinkingDuration = 0

    const orchestration = await runToolOrchestration({
      provider,
      modelId: model.id,
      messages: messagesForApi,
      tools: openAiTools,
      getToolsForRound,
      getPendingNotifications: () => getPendingProcessNotifications(chatId),
      terminalInputToolName,
      signal: abortController.signal,
      reasoningLevel,
      maxRounds: harnessSettings?.defaultMaxRounds,
      beforeToolBatch: harnessSettings
        ? createHarnessBeforeToolBatch(chatId, projectPath, harnessSettings, abortController.signal)
        : undefined,
      executeTool: harnessSettings
        ? createHarnessToolExecutor(
            projectPath,
            harnessSettings,
            chatSession.harnessPhase === 'plan' ? 'plan' : 'build'
          )
        : undefined,
      onStreamEvent: (streamEvent, state) => {
        const timing = thinkingTimes.get(state.round) || {}
        if (streamEvent.type === 'reasoning' && !timing.startedAt) timing.startedAt = Date.now()
        if (streamEvent.type !== 'reasoning' && timing.startedAt && !timing.endedAt) {
          timing.endedAt = Date.now()
        }
        thinkingTimes.set(state.round, timing)

        if (streamEvent.type === 'tool') {
          broadcastIpc('chat-tool-call-delta', { chatId, workspace, ...streamEvent.delta })
          return
        }
        const roundParsed = parseThoughtAndContent(
          state.currentText,
          harnessSettings?.showThinking === false ? '' : state.currentReasoning
        )
        const combinedText = state.accumulatedText
          ? `${state.accumulatedText}\n\n${state.currentText}`
          : state.currentText
        const combinedReasoning = state.accumulatedReasoning
          ? `${state.accumulatedReasoning}\n\n${state.currentReasoning}`
          : state.currentReasoning
        const parsed = parseThoughtAndContent(
          combinedText,
          harnessSettings?.showThinking === false ? '' : combinedReasoning
        )
        broadcastIpc('chat-reply-chunk', {
          chatId,
          workspace,
          thoughts: parsed.thoughts,
          finalResponse: parsed.content,
          isThinking: streamEvent.type === 'reasoning',
          isWritingToolCall: state.streamingToolCalls.length > 0,
          ...(harnessSettings
            ? {
                harnessRound: state.round,
                harnessRoundContent: roundParsed.content,
                harnessRoundThoughts: roundParsed.thoughts
              }
            : {})
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
      createToolContext: ({ callId, name, round }) => ({
        apiKey: provider.apiKey,
        signal: abortController.signal,
        chatId,
        disabledSkills,
        provider,
        modelId: model.id,
        onStart: (args) =>
          broadcastIpc('chat-tool-start', {
            callId,
            name,
            args,
            timestamp: Date.now(),
            chatId,
            workspace,
            round
          })
      }),
      onToolResult: (call) =>
        broadcastIpc('chat-tool-end', {
          callId: call.callId,
          name: call.name,
          result: call.modelContent,
          attachments: call.attachments,
          chatId,
          workspace,
          round: call.round
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
        `# Tool loop limit reached\nThe maximum of ${harnessSettings?.defaultMaxRounds || 100} tool rounds has been reached. ` +
        'Do not call more tools. Explain what was completed, what remains, and the last tool result.'
    })

    const finalOutput = parseThoughtAndContent(
      orchestration.accumulatedText,
      harnessSettings?.showThinking === false ? '' : orchestration.accumulatedReasoning
    )
    const finalRoundOutput = parseThoughtAndContent(
      orchestration.lastRoundText,
      harnessSettings?.showThinking === false ? '' : orchestration.lastRoundReasoning
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
      workspace,
      ...(harnessSettings
        ? {
            harnessRoundContent: finalRoundOutput.content,
            harnessRoundThoughts: finalRoundOutput.thoughts
          }
        : {}),
      ...(orchestration.loopLimitReached ? { loopLimitReached: true } : {})
    })
  } catch (error: unknown) {
    const caughtError = error instanceof Error ? error : new Error(String(error))
    if (abortController.signal.aborted || caughtError.name === 'AbortError') {
      broadcastIpc('chat-reply-error', { error: 'Message cancelled by user', chatId, workspace })
    } else {
      console.error(`[Background Wakeup] Error in chat ${chatId}:`, caughtError)
      broadcastIpc('chat-reply-error', { error: caughtError.message, chatId, workspace })
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
