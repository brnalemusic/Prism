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
    agentIndex: number
    phase: 'thinking' | 'tool_use' | 'done' | 'error'
    command?: string
    output?: string
  }
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
