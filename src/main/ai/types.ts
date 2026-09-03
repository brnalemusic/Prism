import {
  ProviderConfig,
  ProviderModel,
  CompletionType,
  StreamToolCallDelta,
  TodoState,
  PrismThinkingLevel,
  HarnessContextSnapshot,
  HarnessExplorerContextSnapshot
} from '../../shared/types'
import type { ToolResultEnvelope } from '../toolRuntime'
import type { ToolAttachment, ToolImageReference } from '../toolAttachments'

export type {
  ProviderConfig,
  ProviderModel,
  CompletionType,
  StreamToolCallDelta,
  TodoState,
  PrismThinkingLevel
}

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
  role: 'system' | 'user' | 'assistant' | 'model' | 'tool'
  content?: string | null | Array<{ type: string; text?: string; image_url?: { url: string } }>
  parts?: GeminiPartData[]
  name?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
    thought_signature?: string
    thoughtSignature?: string
    extra_content?: {
      google?: { thought_signature?: string }
      thought_signature?: string
    }
  }>
  tool_call_id?: string
  tool_attachments?: ToolAttachment[]
  tool_attachment_refs?: ToolImageReference[]
  image_attachments?: ToolAttachment[]
  image_attachment_refs?: ToolImageReference[]
  tool_metadata?: {
    originalArguments: unknown
    validatedArguments: Record<string, unknown>
    result: ToolResultEnvelope
  }
  reasoning_content?: string
  thinking_duration?: number
  isSystemNotification?: boolean
  hidden?: boolean
  harness_context_snapshot?: HarnessContextSnapshot
  harness_explorer_context?: HarnessExplorerContextSnapshot
  visible_user_content?: string
  quote?: string
  provider_metadata?: {
    gemini?: {
      content: GeminiContentData
    }
  }
}

export type OpenAiToolCall = NonNullable<OpenAiMessage['tool_calls']>[number]

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
