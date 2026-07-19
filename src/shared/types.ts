export interface SubagentMessage {
  agentIndex: number
  content: string
  status: 'working' | 'done' | 'error'
  timestamp: number
  senderRole: 'user' | 'agent' | 'master'
  senderName: string
  chatId?: string
}

export interface MiniAppData {
  id: string
  title: string
  html: string
  css: string
  js: string
}

export interface ToolUpdate {
  toolCallName: string
  update: {
    agentIndex?: number
    phase?: 'thinking' | 'tool_use' | 'done' | 'error'
    command?: string
    output?: string
    // New: continuous web_search progress
    searchTitle?: string
  }
}

export type DownloadProgressStatus =
  | 'starting'
  | 'downloading'
  | 'saving'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface DownloadProgress {
  id: string
  filename: string
  url?: string
  targetPath?: string
  receivedBytes: number
  totalBytes?: number
  percent?: number
  status: DownloadProgressStatus
  error?: string
  startedAt: number
  updatedAt: number
}

export interface ToolCall {
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'writing' | 'running' | 'cooldown' | 'done' | 'error' | 'cancelled'
  subagentMessages?: SubagentMessage[]
  agentUpdates?: Record<
    number,
    {
      phase: 'thinking' | 'tool_use' | 'done' | 'error'
      command?: string
      output?: string
    }
  >
  terminalOutput?: string
}

export interface ApplicationInfo {
  name: string
  version?: string
  path: string
}

export interface FileSearchResult {
  name: string
  path: string
  relativePath: string
}

export interface AttachedFile {
  name: string
  mimeType: string
  data: string
}

export type SessionMode = 'conversation' | 'execution' | 'discipline'

export interface TodoTask {
  id: string
  title: string
  status: 'pending' | 'working' | 'done'
}

export interface TodoState {
  tasks: TodoTask[]
  createdAt: number
  active: boolean
  chatId?: string
}

