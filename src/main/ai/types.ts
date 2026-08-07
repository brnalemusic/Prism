import { ProviderConfig, ProviderModel, CompletionType, StreamToolCallDelta, TodoState, PrismThinkingLevel } from '../../shared/types'

export type { ProviderConfig, ProviderModel, CompletionType, StreamToolCallDelta, TodoState, PrismThinkingLevel }

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

export interface GeminiFunctionCallData {
  id?: string
  name?: string
  args?: Record<string, unknown>
}

export interface GeminiFunctionResponseData {
  id?: string
  name?: string
  response?: Record<string, unknown>
}

export interface GeminiPartData {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: GeminiFunctionCallData
  functionResponse?: GeminiFunctionResponseData
  inlineData?: { mimeType?: string; data?: string }
}

export interface GeminiContentData {
  role?: 'user' | 'model'
  parts?: GeminiPartData[]
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
  provider_metadata?: {
    gemini?: {
      content: GeminiContentData
    }
  }
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
