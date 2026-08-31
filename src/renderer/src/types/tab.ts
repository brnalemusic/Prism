import type {
  SessionMode,
  WorkspaceKind,
  ArtifactItem,
  ToolAttachment,
  HarnessContextSnapshot,
  HarnessExplorerSelection
} from '../../../shared/types'

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
  id?: string
  name: string
  args: Record<string, unknown>
  result?: string
  attachments?: ToolAttachment[]
  status: 'writing' | 'running' | 'cooldown' | 'done' | 'error' | 'cancelled'
  addedLines?: number
  removedLines?: number
  readLines?: { start: number; end: number }[]
  searchUpdates?: string[]
  terminalOutput?: string
  runId?: string
  startedAt?: number
  finishedAt?: number
  round?: number
}

export interface HarnessRoundItem {
  round: number
  content: string
  thoughts?: string
  toolCalls?: ToolCallItem[]
  streamingToolCalls?: StreamingToolCall[]
}

export interface Message {
  role: 'user' | 'ai' | 'separator' | 'context'
  content: string
  thoughts?: string
  isStreaming?: boolean
  isThinking?: boolean
  thinkingStartTime?: number
  thinkingDuration?: number
  workStartTime?: number
  workedDuration?: number
  isError?: boolean
  toolCalls?: ToolCallItem[]
  streamingToolCalls?: StreamingToolCall[]
  isWritingToolCall?: boolean
  toolType?: 'task' | 'search' | 'mini-app'
  isConnecting?: boolean
  screenshot?: string
  file?: AttachedFile
  quote?: string
  separatorType?: 'error' | 'cancel'
  contextSnapshot?: HarnessContextSnapshot
  harnessRound?: number
  harnessRounds?: HarnessRoundItem[]
}

export interface TabSession {
  id: string
  chatId?: string
  title: string
  messages: Message[]
  inputText: string
  quotedText?: string | null
  attachedFile: AttachedFile | null
  sessionMode: SessionMode
  workspace?: WorkspaceKind
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
  artifacts?: ArtifactItem[]
  selectedArtifactId?: string | null
  disabledSkills?: string[]
  harnessContextSnapshot?: HarnessContextSnapshot
  harnessExplorerContext?: HarnessExplorerSelection[]
}
