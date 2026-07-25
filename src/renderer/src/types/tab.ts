import type { SessionMode } from '../../../shared/types'

export interface AttachedFile {
  name: string
  mimeType: string
  data: string
}

export interface StreamingToolCall {
  index: number
  id?: string
  name: string
  arguments: string
  isComplete: boolean
  thoughtSignature?: string
  thought_signature?: string
}

export interface ToolCallItem {
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'writing' | 'running' | 'done' | 'error' | 'cancelled'
  addedLines?: number
  removedLines?: number
  readLines?: { start: number; end: number }[]
  searchUpdates?: string[]
}

export interface Message {
  role: 'user' | 'ai' | 'separator'
  content: string
  thoughts?: string
  isStreaming?: boolean
  isThinking?: boolean
  thinkingStartTime?: number
  thinkingDuration?: number
  isError?: boolean
  toolCalls?: ToolCallItem[]
  streamingToolCalls?: StreamingToolCall[]
  isWritingToolCall?: boolean
  toolType?: 'task' | 'search' | 'mini-app'
  isConnecting?: boolean
  screenshot?: string
  file?: AttachedFile
  separatorType?: 'error' | 'cancel'
}

export interface TabSession {
  id: string
  chatId?: string
  title: string
  messages: Message[]
  inputText: string
  attachedFile: AttachedFile | null
  sessionMode: SessionMode
  disciplinePath: string
  isProcessing: boolean
  isTodoOpen: boolean
  selectedModel: string
  isSearchEnabled: boolean
  isTitleStreaming?: boolean
  /** 'chat' (default) or 'browser' for the AI browser session viewer tab */
  tabType?: 'chat' | 'browser'
  /** For browser tabs: the id of the chat tab that opened this browser session */
  browserSourceTabId?: string
}
