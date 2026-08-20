import { ProviderConfig, StreamToolCallDelta } from '../../shared/types'
import {
  executeValidatedTool,
  ToolExecutionContext,
  ToolLoopGuard,
  ToolResultEnvelope
} from '../toolRuntime'
import { streamOpenAiCompletion, StreamResult } from './openaiClient'
import { OpenAiMessage, OpenAiToolDefinition } from './types'
import { ToolAttachment } from '../toolAttachments'

export interface OrchestratorStreamState {
  round: number
  finalizing: boolean
  accumulatedText: string
  accumulatedReasoning: string
  currentText: string
  currentReasoning: string
  streamingToolCalls: Array<{
    index: number
    id?: string
    name: string
    arguments: string
  }>
}

export type OrchestratorStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool'; delta: StreamToolCallDelta }

export interface ExecutedToolCall {
  callId: string
  name: string
  args: Record<string, unknown>
  envelope: ToolResultEnvelope
  modelContent: string
  attachments?: ToolAttachment[]
  round: number
}

export interface ToolOrchestrationResult {
  accumulatedText: string
  accumulatedReasoning: string
  rounds: number
  loopLimitReached: boolean
  executedTools: ExecutedToolCall[]
}

export interface BackgroundProcessNotification {
  runId: string
  command: string
  status: string
  exitCode: number | null
  output: string
}

export interface ToolOrchestratorOptions {
  provider: ProviderConfig
  modelId: string
  messages: OpenAiMessage[]
  tools: OpenAiToolDefinition[]
  getToolsForRound?: () => OpenAiToolDefinition[]
  getPendingNotifications?: () => BackgroundProcessNotification[]
  signal: AbortSignal
  reasoningLevel?: string
  maxRounds?: number
  finalInstruction?: string
  createToolContext?: (call: {
    callId: string
    name: string
    round: number
  }) => ToolExecutionContext
  decorateAssistantMessage?: (
    message: OpenAiMessage,
    result: StreamResult,
    state: OrchestratorStreamState
  ) => OpenAiMessage
  onStreamEvent?: (event: OrchestratorStreamEvent, state: OrchestratorStreamState) => void
  onHistoryMessage?: (message: OpenAiMessage) => void
  onToolResult?: (call: ExecutedToolCall) => void
}

function joinOutput(current: string, next: string): string {
  if (!next) return current
  return current ? `${current}\n\n${next}` : next
}

function abortIfNeeded(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('Request cancelled')
  error.name = 'AbortError'
  throw error
}

function createAssistantMessage(result: StreamResult): OpenAiMessage {
  const message: OpenAiMessage = {
    role: 'assistant',
    content: result.text || (result.toolCalls.length > 0 ? null : '')
  }
  if (result.reasoning) message.reasoning_content = result.reasoning
  if (result.nativeContent) {
    message.provider_metadata = { gemini: { content: result.nativeContent } }
  }
  if (result.toolCalls.length > 0) {
    message.tool_calls = result.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.args },
      ...(call.thoughtSignature
        ? {
            thought_signature: call.thoughtSignature,
            extra_content: { google: { thought_signature: call.thoughtSignature } }
          }
        : {})
    }))
  }
  return message
}

function withFinalInstruction(messages: OpenAiMessage[], instruction: string): OpenAiMessage[] {
  const output = messages.map((message) => ({ ...message }))
  const systemMessage = output.find((message) => message.role === 'system')
  if (systemMessage && typeof systemMessage.content === 'string') {
    systemMessage.content = `${systemMessage.content}\n\n${instruction}`
  } else {
    output.unshift({ role: 'system', content: instruction })
  }
  return output
}

export async function runToolOrchestration(
  options: ToolOrchestratorOptions
): Promise<ToolOrchestrationResult> {
  const maxRounds = options.maxRounds ?? 100
  const loopGuard = new ToolLoopGuard()
  const executedTools: ExecutedToolCall[] = []
  let accumulatedText = ''
  let accumulatedReasoning = ''

  const streamRound = async (
    round: number,
    finalizing: boolean,
    messages: OpenAiMessage[],
    tools: OpenAiToolDefinition[]
  ): Promise<{ result: StreamResult; state: OrchestratorStreamState }> => {
    let currentText = ''
    let currentReasoning = ''
    const streamingToolCalls: OrchestratorStreamState['streamingToolCalls'] = []
    const state = (): OrchestratorStreamState => ({
      round,
      finalizing,
      accumulatedText,
      accumulatedReasoning,
      currentText,
      currentReasoning,
      streamingToolCalls: streamingToolCalls.map((call) => ({ ...call }))
    })

    const result = await streamOpenAiCompletion(
      options.provider,
      options.modelId,
      messages,
      tools,
      options.signal,
      {
        onTextDelta: (delta) => {
          currentText += delta
          options.onStreamEvent?.({ type: 'text', delta }, state())
        },
        onReasoningDelta: (delta) => {
          currentReasoning += delta
          options.onStreamEvent?.({ type: 'reasoning', delta }, state())
        },
        onToolCallDelta: (delta) => {
          let current = streamingToolCalls.find((call) => call.index === delta.index)
          if (!current) {
            current = { index: delta.index, id: delta.id, name: '', arguments: '' }
            streamingToolCalls.push(current)
          }
          if (delta.id) current.id = delta.id
          if (delta.name) current.name = delta.name
          if (delta.argsDelta) current.arguments += delta.argsDelta
          options.onStreamEvent?.({ type: 'tool', delta }, state())
        }
      },
      options.reasoningLevel
    )

    currentText = result.text || currentText
    currentReasoning = result.reasoning || currentReasoning
    return { result, state: state() }
  }

  const finalize = async (
    round: number,
    instruction: string,
    loopLimitReached: boolean
  ): Promise<ToolOrchestrationResult> => {
    const finalRound = await streamRound(
      round + 1,
      true,
      withFinalInstruction(options.messages, instruction),
      []
    )
    accumulatedText = joinOutput(accumulatedText, finalRound.result.text)
    accumulatedReasoning = joinOutput(accumulatedReasoning, finalRound.result.reasoning)
    const finalBaseMessage = createAssistantMessage(finalRound.result)
    const finalMessage = options.decorateAssistantMessage
      ? options.decorateAssistantMessage(finalBaseMessage, finalRound.result, finalRound.state)
      : finalBaseMessage
    options.messages.push(finalMessage)
    options.onHistoryMessage?.(finalMessage)

    return {
      accumulatedText,
      accumulatedReasoning,
      rounds: round,
      loopLimitReached,
      executedTools
    }
  }

  for (let round = 1; round <= maxRounds; round++) {
    abortIfNeeded(options.signal)

    if (options.getPendingNotifications) {
      const pending = options.getPendingNotifications()
      for (const notif of pending) {
        const notifMsg: OpenAiMessage = {
          role: 'user',
          content: `[SYSTEM NOTIFICATION: Background terminal command (Run ID: ${notif.runId}, Command: "${notif.command}") finished with status "${notif.status}" (Exit Code: ${notif.exitCode ?? 'N/A'}). Output:\n${notif.output}]`,
          isSystemNotification: true,
          hidden: true
        }
        options.messages.push(notifMsg)
        options.onHistoryMessage?.(notifMsg)
      }
    }

    const currentTools = options.getToolsForRound ? options.getToolsForRound() : options.tools
    const streamed = await streamRound(round, false, options.messages, currentTools)
    accumulatedText = joinOutput(accumulatedText, streamed.result.text)
    accumulatedReasoning = joinOutput(accumulatedReasoning, streamed.result.reasoning)

    const baseAssistantMessage = createAssistantMessage(streamed.result)
    const assistantMessage = options.decorateAssistantMessage
      ? options.decorateAssistantMessage(baseAssistantMessage, streamed.result, streamed.state)
      : baseAssistantMessage
    options.messages.push(assistantMessage)
    options.onHistoryMessage?.(assistantMessage)

    if (streamed.result.toolCalls.length === 0) {
      return {
        accumulatedText,
        accumulatedReasoning,
        rounds: round,
        loopLimitReached: false,
        executedTools
      }
    }

    let nonRetryableFailure: string | null = null
    for (const toolCall of streamed.result.toolCalls) {
      abortIfNeeded(options.signal)
      const callId = toolCall.id
      const context = options.createToolContext?.({
        callId,
        name: toolCall.name,
        round
      }) || { signal: options.signal }
      const execution = await executeValidatedTool(
        toolCall.name,
        toolCall.args,
        { ...context, signal: options.signal },
        loopGuard
      )
      const executed: ExecutedToolCall = {
        callId,
        name: toolCall.name,
        args: execution.args,
        envelope: execution.envelope,
        modelContent: execution.modelContent,
        ...(execution.attachments ? { attachments: execution.attachments } : {}),
        round
      }
      executedTools.push(executed)
      options.onToolResult?.(executed)

      const toolMessage: OpenAiMessage = {
        role: 'tool',
        tool_call_id: callId,
        name: toolCall.name,
        content: execution.modelContent,
        ...(execution.attachments ? { tool_attachments: execution.attachments } : {}),
        tool_metadata: {
          originalArguments: toolCall.args,
          validatedArguments: execution.args,
          result: execution.envelope
        }
      }
      options.messages.push(toolMessage)
      options.onHistoryMessage?.(toolMessage)

      if (!execution.envelope.ok && !execution.envelope.error.retryable) {
        nonRetryableFailure = execution.envelope.error.message
      }
    }

    if (nonRetryableFailure) {
      return finalize(
        round,
        `# Tool execution stopped\nA tool returned a non-retryable error: ${nonRetryableFailure}\n` +
          'Do not call more tools. Explain the result and any safe next step to the user.',
        false
      )
    }
  }

  abortIfNeeded(options.signal)
  const finalInstruction =
    options.finalInstruction ||
    `The maximum of ${maxRounds} tool rounds has been reached. Do not call more tools. ` +
      'Explain what was completed, what remains, and the last tool result.'
  return finalize(maxRounds, finalInstruction, true)
}
