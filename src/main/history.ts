import { app } from 'electron'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { SessionMode, WorkspaceKind, ArtifactItem, TodoState } from '../shared/types'
import type { OpenAiMessage } from './ai/types'
import { ToolImageAttachment, ToolImageReference, imageAttachments } from './toolAttachments'
import {
  dedupeImageAttachments,
  imageAttachmentDigest,
  isImageAssetId,
  parseImageAssetReference
} from './imageAssets'
import { detectImageMimeType, isStrictBase64 } from './ai/imageGenerationCore'

export interface ChatSession {
  id: string
  title: string
  lastUpdated: number
  messages: OpenAiMessage[]
  sessionMode?: SessionMode
  /** Workspace discriminator. Older Harness records are migrated on read. */
  workspace?: WorkspaceKind
  disciplinePath?: string
  model?: string
  artifacts?: ArtifactItem[]
  todo?: TodoState | null
  isDiscord?: boolean
  disabledSkills?: string[]
}

export function getSessionWorkspace(session: Pick<ChatSession, 'workspace' | 'sessionMode'>): WorkspaceKind {
  return session.workspace === 'harness' || session.sessionMode === 'harness' ? 'harness' : 'chat'
}

function migrateLegacyWorkspace(filePath: string, session: ChatSession): WorkspaceKind {
  const workspace = getSessionWorkspace(session)
  if (session.workspace !== workspace) {
    session.workspace = workspace
    try {
      fs.writeFileSync(filePath, JSON.stringify(session, null, 2))
    } catch (error) {
      console.warn('[History] Failed to persist workspace migration.', error)
    }
  }
  return workspace
}

const CHATS_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'),
  'PrismDesktop',
  'chats'
)

/**
 * Ensures the chats directory exists.
 */
function ensureChatsDir(): void {
  if (!fs.existsSync(CHATS_DIR)) {
    fs.mkdirSync(CHATS_DIR, { recursive: true })
  }
}

/**
 * Sanitizes a session ID to prevent path traversal.
 */
function sanitizeId(id: string): string {
  // Only allow alphanumeric characters and hyphens
  return id.replace(/[^a-zA-Z0-9-]/g, '')
}

/**
 * Safely extracts text from content parts, combining all text components.
 * Optionally filters out technical blocks like tool calls and system results.
 */
export function getMessageText(content?: OpenAiMessage, clean = false): string {
  if (!content) return ''

  let text = ''
  if (typeof content.content === 'string') {
    text = content.content
  } else if (Array.isArray(content.content)) {
    text = content.content.map((part) => part.text || '').join(' ')
  } else if (content.parts) {
    text = content.parts.map((part) => part.text || '').join(' ')
  }
  text = text.trim()

  if (clean && text) {
    // Remove tool calls
    text = text.replace(/\[PRISM_EXECUTE_TOOL\][\s\S]*?\[\/PRISM_EXECUTE_TOOL\]/gi, '')
    // Remove mini apps
    text = text.replace(/<mini_app>[\s\S]*?<\/mini_app>/gi, '')
    // Remove system results / tool results
    text = text.replace(/\[SYSTEM: TOOL RESULTS\][\s\S]*?(?=\n\n|$)/gi, '')
    // Remove other system-like markers
    text = text.replace(/\[SYSTEM:[\s\S]*?\]/gi, '')

    return text.replace(/\s+/g, ' ').trim()
  }

  return text
}

/**
 * Lists all available chat sessions.
 */
export function listChatSessions(workspace: WorkspaceKind = 'chat'): Omit<ChatSession, 'messages'>[] {
  ensureChatsDir()
  try {
    const files = fs.readdirSync(CHATS_DIR)
    const sessions = files
      .filter((file) => file.endsWith('.json'))
      .map<Omit<ChatSession, 'messages'> | null>((file) => {
        const filePath = path.join(CHATS_DIR, file)
        const data = fs.readFileSync(filePath, 'utf-8')
        const session: ChatSession = JSON.parse(data)
        const sessionWorkspace = migrateLegacyWorkspace(filePath, session)
        if (sessionWorkspace !== workspace) return null
        const effectiveDisciplinePath =
          session.sessionMode === 'discipline' || session.sessionMode === 'harness'
            ? session.disciplinePath || ''
            : ''
        return {
          id: session.id,
          title: session.title,
          lastUpdated: session.lastUpdated,
          sessionMode: session.sessionMode,
          workspace: sessionWorkspace,
          disciplinePath: effectiveDisciplinePath,
          model: session.model,
          isDiscord: session.isDiscord,
          disabledSkills: session.disabledSkills
        } as Omit<ChatSession, 'messages'>
      })
      .filter((session): session is Omit<ChatSession, 'messages'> => session !== null)
      .sort((a, b) => b.lastUpdated - a.lastUpdated)
    return sessions
  } catch (error) {
    console.error('Failed to list chat sessions:', error)
    return []
  }
}

/**
 * Loads a specific chat session by ID.
 */
export function loadChatSession(id: string, expectedWorkspace?: WorkspaceKind): ChatSession | null {
  ensureChatsDir()
  const cleanId = sanitizeId(id)
  if (!cleanId) return null
  const filePath = path.join(CHATS_DIR, `chat_${cleanId}.json`)
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8')
      const session: ChatSession = JSON.parse(data)
      const workspace = migrateLegacyWorkspace(filePath, session)
      if (expectedWorkspace && workspace !== expectedWorkspace) return null
      const persistedMessages = sanitizeMessagesForSaving(cleanId, session.messages)
      if (JSON.stringify(persistedMessages) !== JSON.stringify(session.messages)) {
        session.messages = persistedMessages
        fs.writeFileSync(filePath, JSON.stringify(session, null, 2))
      }
      if (
        session.sessionMode !== 'discipline' &&
        session.sessionMode !== 'harness' &&
        session.disciplinePath
      ) {
        session.disciplinePath = ''
      }
      return session
    }
    return null
  } catch (error) {
    console.error(`Failed to load chat session ${id}:`, error)
    return null
  }
}

/**
 * Sanitizes search_chat_memory tool outputs in history messages before saving,
 * replacing their content with "[RESULTS OMITTED]".
 */
const IMAGE_ASSETS_DIR = path.join(CHATS_DIR, 'attachments')
const MAX_PERSISTED_IMAGE_BYTES = 10 * 1024 * 1024
const DATA_IMAGE_URL_PATTERN = /data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)/g

function imageExtension(mimeType: ToolImageReference['mimeType']): 'jpg' | 'png' | 'webp' {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  return 'jpg'
}

function imageMimeType(value: string): ToolImageReference['mimeType'] | null {
  const normalized = value.toLowerCase() === 'image/jpg' ? 'image/jpeg' : value.toLowerCase()
  return normalized === 'image/jpeg' || normalized === 'image/png' || normalized === 'image/webp'
    ? normalized
    : null
}

function attachmentDirectory(cleanChatId: string): string {
  return path.join(IMAGE_ASSETS_DIR, cleanChatId)
}

function embeddedImageAttachments(content: OpenAiMessage['content']): ToolImageAttachment[] {
  const attachments: ToolImageAttachment[] = []
  const collectDataUrl = (value: string): void => {
    for (const match of value.matchAll(DATA_IMAGE_URL_PATTERN)) {
      const mimeType = imageMimeType(match[1])
      const data = match[2].replace(/\s/g, '')
      if (mimeType && data) attachments.push({ kind: 'image', mimeType, data })
    }
  }
  if (typeof content === 'string') {
    collectDataUrl(content)
  } else if (Array.isArray(content)) {
    for (const part of content) {
      const url = part?.image_url?.url
      if (typeof url === 'string') collectDataUrl(url)
    }
  }
  return dedupeImageAttachments(attachments)
}

function persistImageAttachments(
  cleanChatId: string,
  attachments: ToolImageAttachment[]
): ToolImageReference[] {
  if (attachments.length === 0) return []

  const directory = attachmentDirectory(cleanChatId)
  fs.mkdirSync(directory, { recursive: true })
  const references: ToolImageReference[] = []
  for (const attachment of dedupeImageAttachments(attachments)) {
    if (!isStrictBase64(attachment.data)) {
      console.warn('[History] Skipped image asset with invalid base64 data.')
      continue
    }
    const buffer = Buffer.from(attachment.data, 'base64')
    if (buffer.length === 0 || buffer.length > MAX_PERSISTED_IMAGE_BYTES) {
      console.warn('[History] Skipped invalid image asset.', {
        byteLength: buffer.length,
        maximumByteLength: MAX_PERSISTED_IMAGE_BYTES
      })
      continue
    }
    const detectedMimeType = detectImageMimeType(buffer)
    if (detectedMimeType !== attachment.mimeType) {
      console.warn('[History] Skipped image asset with mismatched or unsupported bytes.', {
        declaredMimeType: attachment.mimeType,
        detectedMimeType
      })
      continue
    }

    const id =
      attachment.assetId && isImageAssetId(attachment.assetId)
        ? attachment.assetId.toLowerCase()
        : randomUUID()
    const filePath = path.join(directory, `${id}.${imageExtension(attachment.mimeType)}`)
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, buffer, { mode: 0o600 })
    references.push({
      kind: 'image',
      id,
      mimeType: attachment.mimeType,
      ...(attachment.name ? { name: path.basename(attachment.name).slice(0, 160) } : {}),
      sha256: imageAttachmentDigest(attachment),
      ...(attachment.width ? { width: attachment.width } : {}),
      ...(attachment.height ? { height: attachment.height } : {}),
      byteLength: buffer.length
    })
  }
  return references
}

function redactEmbeddedImageData(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(DATA_IMAGE_URL_PATTERN, '[Image omitted from saved history]')
  }
  if (Array.isArray(value)) return value.map(redactEmbeddedImageData)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        redactEmbeddedImageData(child)
      ])
    )
  }
  return value
}

function stripEmbeddedImages(content: OpenAiMessage['content']): OpenAiMessage['content'] {
  if (!Array.isArray(content)) {
    return redactEmbeddedImageData(content) as OpenAiMessage['content']
  }
  return content
    .filter(
      (part) => !(part?.type === 'image_url' && part.image_url?.url?.startsWith('data:image/'))
    )
    .map((part) => redactEmbeddedImageData(part) as (typeof content)[number])
}

/**
 * Moves images into per-chat files and keeps compact references in the JSON history.
 */
export function prepareHistoryMessage(chatId: string, message: OpenAiMessage): OpenAiMessage {
  const isToolImage = message.role === 'tool'
  const isUserImage = message.role === 'user'
  if (!isToolImage && !isUserImage) return message

  const cleanChatId = sanitizeId(chatId)
  const existingReferences = isToolImage
    ? message.tool_attachment_refs || []
    : message.image_attachment_refs || []
  const inMemoryAttachments = isToolImage
    ? imageAttachments(message.tool_attachments)
    : imageAttachments(message.image_attachments)
  const attachments =
    existingReferences.length > 0
      ? []
      : [...inMemoryAttachments, ...embeddedImageAttachments(message.content)]
  const references = cleanChatId
    ? existingReferences.length > 0
      ? existingReferences
      : persistImageAttachments(cleanChatId, attachments)
    : []
  const persisted = { ...message }
  delete persisted.tool_attachments
  delete persisted.tool_attachment_refs
  delete persisted.image_attachments
  delete persisted.image_attachment_refs
  delete persisted.tool_metadata
  return {
    ...persisted,
    content: stripEmbeddedImages(message.content),
    ...(references.length > 0
      ? isToolImage
        ? { tool_attachment_refs: references }
        : { image_attachment_refs: references }
      : {}),
    ...(message.tool_metadata
      ? {
          tool_metadata: redactEmbeddedImageData(message.tool_metadata) as NonNullable<
            OpenAiMessage['tool_metadata']
          >
        }
      : {})
  }
}

export function hydrateHistoryToolAttachments(
  chatId: string,
  messages: OpenAiMessage[]
): OpenAiMessage[] {
  const cleanChatId = sanitizeId(chatId)
  if (!cleanChatId) return messages
  const directory = attachmentDirectory(cleanChatId)

  return messages.map((message) => {
    const references =
      message.role === 'tool'
        ? message.tool_attachment_refs || []
        : message.role === 'user'
          ? message.image_attachment_refs || []
          : []
    if (references.length === 0) return message
    const attachments: ToolImageAttachment[] = []
    for (const reference of references) {
      if (!isImageAssetId(reference.id)) continue
      const filePath = path.join(directory, `${reference.id}.${imageExtension(reference.mimeType)}`)
      try {
        const data = fs.readFileSync(filePath).toString('base64')
        if (!data) continue
        attachments.push({
          kind: 'image',
          assetId: reference.id,
          ...(reference.name ? { name: reference.name } : {}),
          mimeType: reference.mimeType,
          data,
          ...(reference.width ? { width: reference.width } : {}),
          ...(reference.height ? { height: reference.height } : {}),
          ...(reference.byteLength ? { byteLength: reference.byteLength } : {})
        })
      } catch (error) {
        console.warn('[History] Failed to hydrate image asset.', {
          attachmentId: reference.id,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
    if (attachments.length === 0) return message
    return message.role === 'tool'
      ? { ...message, tool_attachments: attachments }
      : { ...message, image_attachments: attachments }
  })
}

export function loadChatImageAsset(
  chatId: string,
  referenceValue: string
): ToolImageAttachment | null {
  const assetId = parseImageAssetReference(referenceValue)
  const cleanChatId = sanitizeId(chatId)
  if (!assetId || !cleanChatId) return null
  const session = loadChatSession(cleanChatId)
  if (!session) return null
  const reference = session.messages
    .flatMap((message) => [
      ...(message.image_attachment_refs || []),
      ...(message.tool_attachment_refs || [])
    ])
    .find(
      (candidate) =>
        typeof candidate?.id === 'string' &&
        isImageAssetId(candidate.id) &&
        candidate.id.toLowerCase() === assetId
    )
  if (!reference) return null

  const directory = attachmentDirectory(cleanChatId)
  const filePath = path.resolve(directory, `${reference.id}.${imageExtension(reference.mimeType)}`)
  const resolvedDirectory = path.resolve(directory)
  if (!filePath.startsWith(`${resolvedDirectory}${path.sep}`) || !fs.existsSync(filePath)) {
    return null
  }
  try {
    const bytes = fs.readFileSync(filePath)
    if (bytes.length === 0 || bytes.length > MAX_PERSISTED_IMAGE_BYTES) return null
    return {
      kind: 'image',
      assetId: reference.id,
      ...(reference.name ? { name: reference.name } : {}),
      mimeType: reference.mimeType,
      data: bytes.toString('base64'),
      ...(reference.width ? { width: reference.width } : {}),
      ...(reference.height ? { height: reference.height } : {}),
      byteLength: bytes.length
    }
  } catch {
    return null
  }
}

export function updateToolResultInHistory(
  chatId: string,
  callId: string,
  content: string,
  attachments: ToolImageAttachment[] | undefined,
  validatedArguments: Record<string, unknown>,
  result: NonNullable<OpenAiMessage['tool_metadata']>['result']
): boolean {
  const session = loadChatSession(chatId)
  if (!session) return false
  const messageIndex = session.messages.findIndex(
    (message) => message.role === 'tool' && message.tool_call_id === callId
  )
  if (messageIndex === -1) return false

  const previous = session.messages[messageIndex]
  const previousReferences = previous.tool_attachment_refs || []
  const replacement: OpenAiMessage = {
    ...previous,
    content,
    ...(attachments?.length ? { tool_attachments: attachments } : {}),
    tool_metadata: {
      originalArguments: previous.tool_metadata?.originalArguments ?? validatedArguments,
      validatedArguments,
      result
    }
  }
  delete replacement.tool_attachment_refs
  if (!attachments?.length) delete replacement.tool_attachments
  session.messages[messageIndex] = replacement
  const saved = saveChatSession(
    chatId,
    session.messages,
    session.title,
    session.sessionMode,
    session.disciplinePath,
    session.model,
    session.isDiscord,
    session.disabledSkills
  )
  if (saved && previousReferences.length > 0) {
    const directory = attachmentDirectory(sanitizeId(chatId))
    for (const reference of previousReferences) {
      if (!/^[a-f0-9-]{36}$/i.test(reference.id)) continue
      const oldPath = path.resolve(
        directory,
        `${reference.id}.${imageExtension(reference.mimeType)}`
      )
      const resolvedDirectory = path.resolve(directory)
      if (!oldPath.startsWith(`${resolvedDirectory}${path.sep}`)) continue
      try {
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
      } catch (error) {
        console.warn('[History] Failed to clean replaced image attachment.', {
          attachmentId: reference.id,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }
  return saved
}

function sanitizeMessagesForSaving(
  cleanChatId: string,
  messages: OpenAiMessage[]
): OpenAiMessage[] {
  return messages.map((message) => {
    const m = prepareHistoryMessage(cleanChatId, message)
    if (!m.parts) return m
    const sanitizedParts = m.parts.map((p) => {
      if (typeof p.text === 'string') {
        const sanitizedText = p.text.replace(
          /\[RESULT FOR search_chat_memory\]:\r?\n([\s\S]*?)(?=\r?\n\[RESULT FOR |\r?\nAnalyze these results|\r?\n\[SYSTEM: TOOL RESULTS\]|$)/g,
          '[RESULT FOR search_chat_memory]:\n[RESULTS OMITTED]\n'
        )
        return { ...p, text: sanitizedText }
      }
      return p
    })
    return { ...m, parts: sanitizedParts }
  })
}

/**
 * Saves or updates a chat session.
 */
export function saveChatSession(
  id: string,
  messages: OpenAiMessage[],
  title?: string,
  sessionMode?: SessionMode,
  disciplinePath?: string,
  model?: string,
  isDiscord?: boolean,
  disabledSkills?: string[]
): boolean {
  ensureChatsDir()
  const cleanId = sanitizeId(id)
  if (!cleanId) return false
  const filePath = path.join(CHATS_DIR, `chat_${cleanId}.json`)

  try {
    let sessionTitle = title
    let existingMode = sessionMode
    let existingPath = disciplinePath
    let existingModel = model
    let existingDisabledSkills = disabledSkills
    let existingWorkspace: WorkspaceKind | undefined

    // If title or modes not provided, try to keep the existing ones from the file
    if (
      sessionTitle === undefined ||
      existingMode === undefined ||
      existingPath === undefined ||
      existingModel === undefined ||
      existingDisabledSkills === undefined
    ) {
      if (fs.existsSync(filePath)) {
        try {
          const existingData = JSON.parse(fs.readFileSync(filePath, 'utf-8'))

          if (sessionTitle === undefined) {
            if (existingData.title) {
              sessionTitle = existingData.title
            }
          }

          if (existingMode === undefined) {
            existingMode = existingData.sessionMode
          }
          existingWorkspace = getSessionWorkspace(existingData as ChatSession)
          if (existingPath === undefined) {
            existingPath = existingData.disciplinePath
          }
          if (existingModel === undefined) {
            existingModel = existingData.model
          }
          if (isDiscord === undefined) {
            isDiscord = existingData.isDiscord
          }
          if (existingDisabledSkills === undefined) {
            existingDisabledSkills = existingData.disabledSkills
          }
        } catch {
          /* ignore parse errors */
        }
      }

      if (!sessionTitle && messages.length > 0) {
        // Fallback title generation from first REAL user message
        const firstRealUserMsg = messages.find(
          (m) => m.role === 'user' && m.parts?.some((p) => typeof p.text === 'string')
        )
        const text = getMessageText(firstRealUserMsg)
        if (text) {
          sessionTitle = text.substring(0, 40) + (text.length > 40 ? '...' : '')
        }
      }
    }

    if (existingMode !== 'discipline' && existingMode !== 'harness') {
      existingPath = ''
    }

    const filteredMessages = messages.filter((msg) => {
      if (msg.role === 'system') {
        const text = msg.parts?.[0]?.text || ''
        return !text.includes('# Identity') && !text.includes('Understood. I am Prism')
      }
      return true
    })

    const messagesToSave = sanitizeMessagesForSaving(cleanId, filteredMessages)

    let existingArtifacts: ArtifactItem[] | undefined = undefined
    let existingTodo: TodoState | null | undefined = undefined
    if (fs.existsSync(filePath)) {
      try {
        const existingData = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        existingArtifacts = existingData.artifacts
        existingTodo = existingData.todo
      } catch {
        /* ignore parse errors */
      }
    }

    const session: ChatSession = {
      id,
      title: sessionTitle !== undefined ? sessionTitle : 'New Conversation',
      lastUpdated: Date.now(),
      messages: messagesToSave,
      sessionMode: existingMode,
      workspace:
        existingMode === 'harness' || (existingMode === undefined && existingWorkspace === 'harness')
          ? 'harness'
          : 'chat',
      disciplinePath: existingPath,
      model: existingModel,
      artifacts: existingArtifacts,
      todo: existingTodo,
      isDiscord,
      disabledSkills: existingDisabledSkills
    }

    fs.writeFileSync(filePath, JSON.stringify(session, null, 2))
    return true
  } catch (error) {
    console.error(`Failed to save chat session ${id}:`, error)
    return false
  }
}

/**
 * Saves or updates a chat session todo state.
 */
export function saveChatTodo(id: string, todo: TodoState): boolean {
  ensureChatsDir()
  const cleanId = sanitizeId(id)
  if (!cleanId) return false
  const filePath = path.join(CHATS_DIR, `chat_${cleanId}.json`)
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8')
      const session: ChatSession = JSON.parse(data)
      session.todo = todo
      session.lastUpdated = Date.now()
      fs.writeFileSync(filePath, JSON.stringify(session, null, 2))
      return true
    }
    return false
  } catch (error) {
    console.error(`Failed to save chat todo ${id}:`, error)
    return false
  }
}

/**
 * Gets all artifacts stored in a chat session.
 */
export function getChatArtifacts(id: string): ArtifactItem[] {
  const session = loadChatSession(id)
  return session?.artifacts || []
}

/**
 * Saves or updates an artifact in a chat session.
 */
export function saveChatArtifact(id: string, artifact: ArtifactItem): ChatSession | null {
  ensureChatsDir()
  const cleanId = sanitizeId(id)
  if (!cleanId) return null
  const filePath = path.join(CHATS_DIR, `chat_${cleanId}.json`)
  try {
    let session: ChatSession
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8')
      session = JSON.parse(data)
    } else {
      session = {
        id,
        title: 'New Conversation',
        lastUpdated: Date.now(),
        messages: []
      }
    }
    const artifacts = session.artifacts || []
    const existingIndex = artifacts.findIndex(
      (a) => a.id === artifact.id || a.path === artifact.path
    )
    if (existingIndex >= 0) {
      artifacts[existingIndex] = artifact
    } else {
      artifacts.push(artifact)
    }
    session.artifacts = artifacts
    session.lastUpdated = Date.now()
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2))
    return session
  } catch (err) {
    console.error(`Failed to save artifact for session ${id}:`, err)
    return null
  }
}

/**
 * Updates only the title of a chat session.
 */
export function updateChatSessionTitle(id: string, title: string): boolean {
  ensureChatsDir()
  const cleanId = sanitizeId(id)
  if (!cleanId) return false
  const filePath = path.join(CHATS_DIR, `chat_${cleanId}.json`)
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      data.title = title
      data.lastUpdated = Date.now()
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
      return true
    }
    return false
  } catch (error) {
    console.error(`Failed to update chat session title ${id}:`, error)
    return false
  }
}

/** Updates the pinned model without changing messages or the session workspace. */
export function updateChatSessionModel(
  id: string,
  model: string,
  expectedWorkspace?: WorkspaceKind
): boolean {
  const cleanModel = model.trim()
  const cleanId = sanitizeId(id)
  if (!cleanId || !cleanModel) return false
  const session = loadChatSession(cleanId, expectedWorkspace)
  if (!session) return false
  const filePath = path.join(CHATS_DIR, `chat_${cleanId}.json`)
  try {
    session.model = cleanModel
    session.lastUpdated = Date.now()
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2))
    return true
  } catch (error) {
    console.error(`Failed to update chat session model ${id}:`, error)
    return false
  }
}

/**
 * Deletes a chat session.
 */
export function deleteChatSession(id: string): boolean {
  ensureChatsDir()
  const cleanId = sanitizeId(id)
  if (!cleanId) return false
  const filePath = path.join(CHATS_DIR, `chat_${cleanId}.json`)
  const directory = attachmentDirectory(cleanId)
  const attachmentsRoot = path.resolve(IMAGE_ASSETS_DIR)
  const resolvedDirectory = path.resolve(directory)
  try {
    const sessionDeleted = fs.existsSync(filePath)
    if (sessionDeleted) {
      fs.unlinkSync(filePath)
    }

    if (resolvedDirectory.startsWith(`${attachmentsRoot}${path.sep}`) && fs.existsSync(directory)) {
      fs.rmSync(directory, { recursive: true, force: true })
    }

    return sessionDeleted
  } catch (error) {
    console.error(`Failed to delete chat session ${id}:`, error)
    return false
  }
}

/**
 * Searches across all chat sessions for a specific query.
 * Returns pairs of interaction (User message + AI response).
 */
export async function searchChatHistory(query: string): Promise<string> {
  ensureChatsDir()
  const files = fs.readdirSync(CHATS_DIR).filter((f) => f.endsWith('.json'))

  // Split query by commas or spaces and filter out empty strings
  const keywords = query
    .toLowerCase()
    .split(/[,\s]+/)
    .filter((k) => k.length > 0)

  if (keywords.length === 0) {
    return JSON.stringify({ error: 'Please provide at least one keyword to search.' })
  }

  const matchedSessions: { score: number; session: ChatSession }[] = []

  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(CHATS_DIR, file), 'utf-8')
      const session: ChatSession = JSON.parse(data)
      let score = 0

      // Check title
      const titleLower = session.title.toLowerCase()
      for (const kw of keywords) {
        if (titleLower.includes(kw)) {
          score += 5
        }
      }

      for (let i = 0; i < session.messages.length; i++) {
        const msg = session.messages[i]

        // Read User, Model, and Assistant messages
        if (msg.role !== 'user' && msg.role !== 'model' && msg.role !== 'assistant') {
          continue
        }

        const text = getMessageText(msg, true)

        if (text) {
          const lowerText = text.toLowerCase()

          // Calculate score: how many unique keywords match?
          let matchCount = 0
          for (const kw of keywords) {
            if (lowerText.includes(kw)) {
              matchCount++
            }
          }

          if (matchCount > 0) {
            score += matchCount
          }
        }
      }

      if (score > 0) {
        matchedSessions.push({ score, session })
      }
    } catch (e) {
      console.error(`Error searching file ${file}:`, e)
    }
  }

  if (matchedSessions.length === 0) {
    return JSON.stringify([])
  }

  // Sort by score (descending), then by date (newest first)
  matchedSessions.sort((a, b) => b.score - a.score || b.session.lastUpdated - a.session.lastUpdated)

  // LIMIT results to top 15 and truncate message history for each to avoid token overflow
  const results = matchedSessions.slice(0, 15).map((m) => {
    const s = m.session
    // Find a few relevant snippets from messages that match keywords
    const snippets: string[] = []
    for (const msg of s.messages) {
      if (msg.role === 'system') continue
      const text = getMessageText(msg)
      const lowerText = text.toLowerCase()
      if (keywords.some((kw) => lowerText.includes(kw))) {
        const matchingKeyword = keywords.find((kw) => lowerText.includes(kw))
        const idx = matchingKeyword ? lowerText.indexOf(matchingKeyword) : 0
        const start = Math.max(0, idx - 80)
        const end = Math.min(text.length, idx + 120)
        const role = (msg.role || 'user').toUpperCase()
        snippets.push(`[${role}]: ...${text.substring(start, end).replace(/\n/g, ' ')}...`)
      }
      if (snippets.length >= 2) break
    }

    return {
      id: s.id,
      title: s.title,
      lastUpdated: new Date(s.lastUpdated).toISOString(),
      relevanceScore: m.score,
      matchingSnippets: snippets,
      totalMessages: s.messages.length,
      // We explicitly OMIT the full 'messages' array here to save tokens
      instruction: 'To see the full history of this chat, use the render_chat_history tool.'
    }
  })

  return JSON.stringify(results, null, 2)
}

// Levenshtein distance helper
function getLevenshteinDistance(a: string, b: string): number {
  const tmp: number[][] = []
  for (let i = 0; i <= a.length; i++) {
    tmp[i] = [i]
  }
  for (let j = 0; j <= b.length; j++) {
    tmp[0][j] = j
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1, // deletion
        tmp[i][j - 1] + 1, // insertion
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      )
    }
  }
  return tmp[a.length][b.length]
}

/**
 * Builds vocabulary and returns a spelling suggestion if the user made a typo.
 */
export function getSpellingSuggestion(query: string): string | undefined {
  ensureChatsDir()
  const files = fs.readdirSync(CHATS_DIR).filter((f) => f.endsWith('.json'))
  const vocab = new Map<string, number>()

  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(CHATS_DIR, file), 'utf-8')
      const session: ChatSession = JSON.parse(data)
      const texts = [session.title]
      for (const msg of session.messages) {
        if (msg.role !== 'system') {
          texts.push(getMessageText(msg))
        }
      }

      for (const text of texts) {
        if (!text) continue
        const words = text.toLowerCase().match(/[a-zA-Z0-9áéíóúâêîôûãõçñ]+/g)
        if (words) {
          for (const w of words) {
            if (w.length >= 3) {
              vocab.set(w, (vocab.get(w) || 0) + 1)
            }
          }
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  const queryWords = query.toLowerCase().split(/\s+/)
  let corrected = false
  const correctedWords: string[] = []

  for (const word of queryWords) {
    if (word.length < 3 || vocab.has(word)) {
      correctedWords.push(word)
      continue
    }

    let closestWord = word
    let minDistance = Infinity
    let maxFreq = 0

    for (const [vocabWord, freq] of vocab.entries()) {
      const dist = getLevenshteinDistance(word, vocabWord)
      const maxAllowedDist = word.length <= 4 ? 1 : 2
      if (dist <= maxAllowedDist) {
        if (dist < minDistance) {
          minDistance = dist
          closestWord = vocabWord
          maxFreq = freq
        } else if (dist === minDistance && freq > maxFreq) {
          closestWord = vocabWord
          maxFreq = freq
        }
      }
    }

    if (closestWord !== word) {
      corrected = true
      correctedWords.push(closestWord)
    } else {
      correctedWords.push(word)
    }
  }

  return corrected ? correctedWords.join(' ') : undefined
}

export interface SearchMatch {
  role: 'user' | 'model' | 'system'
  text: string
  snippet: string
}

export interface ChatSearchResult {
  id: string
  title: string
  lastUpdated: number
  matchedTitle: boolean
  messageMatches: SearchMatch[]
}

/**
 * Searches offline through all chat session files.
 */
export function searchChatsOffline(query: string, workspace: WorkspaceKind = 'chat'): {
  results: ChatSearchResult[]
  didYouMean?: string
} {
  ensureChatsDir()
  const files = fs.readdirSync(CHATS_DIR).filter((f) => f.endsWith('.json'))
  const results: ChatSearchResult[] = []

  const cleanQuery = query.trim().toLowerCase()
  if (!cleanQuery) {
    return { results: [] }
  }

  const allKeywords = cleanQuery.split(/\s+/).filter((k) => k.length > 0)
  const stopWords = new Set([
    'uma',
    'vez',
    'que',
    'de',
    'do',
    'da',
    'em',
    'no',
    'na',
    'os',
    'as',
    'um',
    'e',
    'ou',
    'com',
    'por',
    'me',
    'my',
    'the',
    'a',
    'an',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'is',
    'it'
  ])
  const significantKeywords = allKeywords.filter((k) => k.length > 2 && !stopWords.has(k))
  const searchKeywords = significantKeywords.length > 0 ? significantKeywords : allKeywords

  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(CHATS_DIR, file), 'utf-8')
      const session: ChatSession = JSON.parse(data)
      if (getSessionWorkspace(session) !== workspace) continue

      const titleLower = session.title.toLowerCase()
      const matchedTitle =
        titleLower.includes(cleanQuery) ||
        allKeywords.every((kw) => titleLower.includes(kw)) ||
        searchKeywords.some((kw) => titleLower.includes(kw))

      const messageMatches: SearchMatch[] = []

      for (const msg of session.messages) {
        if (msg.role !== 'user' && msg.role !== 'model' && msg.role !== 'assistant') continue
        const text = getMessageText(msg, true)
        if (!text) continue

        const textLower = text.toLowerCase()
        const isExactMatch = cleanQuery.length > 3 && textLower.includes(cleanQuery)
        const isAllMatch =
          allKeywords.length > 0 && allKeywords.every((kw) => textLower.includes(kw))
        const isSignificantMatch =
          searchKeywords.length > 0 && searchKeywords.some((kw) => textLower.includes(kw))

        if (isExactMatch || isAllMatch || isSignificantMatch) {
          let firstIndex = Infinity
          for (const kw of searchKeywords) {
            const idx = textLower.indexOf(kw)
            if (idx !== -1 && idx < firstIndex) {
              firstIndex = idx
            }
          }

          let snippet = ''
          if (firstIndex !== Infinity) {
            const start = Math.max(0, firstIndex - 60)
            const end = Math.min(text.length, firstIndex + searchKeywords[0].length + 60)
            snippet =
              (start > 0 ? '...' : '') +
              text.substring(start, end).replace(/\n/g, ' ') +
              (end < text.length ? '...' : '')
          } else {
            snippet = text.substring(0, 100).replace(/\n/g, ' ') + (text.length > 100 ? '...' : '')
          }

          const normalizedRole: 'user' | 'model' = msg.role === 'user' ? 'user' : 'model'

          messageMatches.push({
            role: normalizedRole,
            text: text,
            snippet: snippet
          })
        }
      }

      if (matchedTitle || messageMatches.length > 0) {
        results.push({
          id: session.id,
          title: session.title,
          lastUpdated: session.lastUpdated,
          matchedTitle,
          messageMatches
        })
      }
    } catch (e) {
      console.error(`Failed to search chat session file ${file}:`, e)
    }
  }

  results.sort((a, b) => {
    const scoreA = (a.matchedTitle ? 10 : 0) + a.messageMatches.length
    const scoreB = (b.matchedTitle ? 10 : 0) + b.messageMatches.length
    return scoreB - scoreA || b.lastUpdated - a.lastUpdated
  })

  const didYouMean = getSpellingSuggestion(query)

  return {
    results,
    didYouMean: didYouMean && didYouMean !== query.toLowerCase() ? didYouMean : undefined
  }
}

/**
 * Custom structured search across all chat files.
 * Designed specifically for the AI search assistant.
 */
export async function searchChatMemory(query: string): Promise<string> {
  ensureChatsDir()
  const files = fs.readdirSync(CHATS_DIR).filter((f) => f.endsWith('.json'))
  const keywords = query
    .toLowerCase()
    .split(/[,\s]+/)
    .filter((k) => k.length > 0)

  if (keywords.length === 0) {
    return JSON.stringify({ error: 'Please provide at least one keyword to search.' })
  }

  const matchedSessions: { score: number; session: ChatSession }[] = []

  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(CHATS_DIR, file), 'utf-8')
      const session: ChatSession = JSON.parse(data)
      let score = 0

      // Check title
      const titleLower = session.title.toLowerCase()
      for (const kw of keywords) {
        if (titleLower.includes(kw)) {
          score += 5
        }
      }

      // Check messages
      for (const msg of session.messages) {
        if (msg.role !== 'user' && msg.role !== 'model' && msg.role !== 'assistant') continue
        const text = getMessageText(msg, true)
        if (!text) continue
        const textLower = text.toLowerCase()
        for (const kw of keywords) {
          if (textLower.includes(kw)) {
            score++
          }
        }
      }

      if (score > 0) {
        matchedSessions.push({ score, session })
      }
    } catch (e) {
      console.error(e)
    }
  }

  if (matchedSessions.length === 0) {
    return JSON.stringify([])
  }

  // Sort by score (descending), then by date (newest first)
  matchedSessions.sort((a, b) => b.score - a.score || b.session.lastUpdated - a.session.lastUpdated)

  // LIMIT results to top 15 and truncate message history for each to avoid token overflow
  const results = matchedSessions.slice(0, 15).map((m) => {
    const s = m.session
    // Find a few relevant snippets from messages that match keywords
    const snippets: string[] = []
    for (const msg of s.messages) {
      if (msg.role === 'system') continue
      const text = getMessageText(msg)
      const lowerText = text.toLowerCase()
      if (keywords.some((kw) => lowerText.includes(kw))) {
        const matchingKeyword = keywords.find((kw) => lowerText.includes(kw))
        const idx = matchingKeyword ? lowerText.indexOf(matchingKeyword) : 0
        const start = Math.max(0, idx - 80)
        const end = Math.min(text.length, idx + 120)
        const role = (msg.role || 'user').toUpperCase()
        snippets.push(`[${role}]: ...${text.substring(start, end).replace(/\n/g, ' ')}...`)
      }
      if (snippets.length >= 2) break
    }

    return {
      id: s.id,
      title: s.title,
      lastUpdated: new Date(s.lastUpdated).toISOString(),
      relevanceScore: m.score,
      matchingSnippets: snippets,
      totalMessages: s.messages.length,
      // We explicitly OMIT the full 'messages' array here to save tokens
      instruction: 'To see the full history of this chat, use the render_chat_history tool.'
    }
  })

  return JSON.stringify(results, null, 2)
}
