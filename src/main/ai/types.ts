import { ProviderConfig, ProviderModel, CompletionType, StreamToolCallDelta, TodoState } from '../../shared/types'

export type { ProviderConfig, ProviderModel, CompletionType, StreamToolCallDelta, TodoState }

export interface ActiveRun {
  chatId: string
  abortController: AbortController
  streamedText: string
  streamedReasoning?: string
  status: 'running' | 'idle' | 'cancelled' | 'error'
}

export interface StructuredChatResponse {
  text: string
  reasoning?: string
}

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null | Array<{ type: string; text?: string; image_url?: { url: string } }>
  name?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
    thought_signature?: string
    extra_content?: { google?: { thought_signature?: string } }
  }>
  tool_call_id?: string
}

export interface OpenAiToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters?: Record<string, unknown>
  }
}

export interface StreamingToolCall {
  index: number
  id?: string
  name: string
  arguments: string
  isComplete: boolean
}
