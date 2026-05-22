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
  status: 'writing' | 'running' | 'cooldown' | 'done' | 'error'
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
