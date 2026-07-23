import { ProviderConfig, StreamToolCallDelta } from '../../shared/types'
import { normalizeBaseUrl } from './trustedRegistry'
import { OpenAiMessage, OpenAiToolDefinition } from './types'

export interface StreamCallbacks {
  onTextDelta: (text: string) => void
  onReasoningDelta: (reasoning: string) => void
  onToolCallDelta: (delta: StreamToolCallDelta) => void
}

export interface StreamResult {
  text: string
  reasoning: string
  toolCalls: Array<{
    id: string
    name: string
    args: string
    thoughtSignature?: string
  }>
  finishReason: string
}

export function sanitizeOpenAiMessages(messages: OpenAiMessage[]): OpenAiMessage[] {
  return messages.map((m) => {
    const cleanMsg: OpenAiMessage = {
      role: m.role,
      content: m.content
    }
    if (m.name) cleanMsg.name = m.name
    if (m.tool_calls) cleanMsg.tool_calls = m.tool_calls
    if (m.tool_call_id) cleanMsg.tool_call_id = m.tool_call_id
    return cleanMsg
  })
}

export async function streamOpenAiCompletion(
  provider: ProviderConfig,
  modelId: string,
  messages: OpenAiMessage[],
  tools: OpenAiToolDefinition[],
  signal: AbortSignal,
  callbacks: StreamCallbacks
): Promise<StreamResult> {
  const normUrl = normalizeBaseUrl(provider.baseUrl)
  const completionType = provider.completionType || 'chat_completions'

  if (completionType === 'responses') {
    return streamOpenAiResponses(provider, normUrl, modelId, messages, tools, signal, callbacks)
  }

  if (completionType === 'anthropic_messages') {
    return streamAnthropicMessages(provider, normUrl, modelId, messages, tools, signal, callbacks)
  }

  // Google AI Studio OpenAI-compatible endpoints live under the /openai/ sub-path.
  // Native Gemini endpoints (e.g. /models) use x-goog-api-key, but the OpenAI-compat
  // bridge at /v1beta/openai/... requires Authorization: Bearer like any OpenAI provider.
  const isGoogleAiStudio = normUrl.includes('generativelanguage.googleapis.com')
  let endpoint: string
  if (isGoogleAiStudio) {
    endpoint = `${normUrl}/openai/chat/completions`
  } else {
    endpoint = `${normUrl}/chat/completions`
  }

  console.log(`[Main Chat] Calling ${modelId} with [${provider.name || provider.baseUrl}] (${messages.length} messages, ${tools?.length || 0} tools)`)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (provider.apiKey) {
    headers['Authorization'] = `Bearer ${provider.apiKey}`
  }

  const bodyPayload: any = {
    model: modelId,
    messages: sanitizeOpenAiMessages(messages),
    stream: true
  }

  if (tools && tools.length > 0) {
    bodyPayload.tools = tools
    bodyPayload.tool_choice = 'auto'
  }


  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyPayload),
    signal
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    console.error(`[AI Client] API Error ${response.status} (${response.statusText}) from ${endpoint}`)
    console.error(`[AI Client] Response body: ${errorText}`)
    console.error(`[AI Client] Request model: ${modelId}, messages count: ${messages.length}, tools count: ${tools?.length || 0}`)
    throw new Error(`API Error ${response.status} (${response.statusText}): ${errorText}`)
  }

  if (!response.body) {
    throw new Error('No response body received from stream endpoint')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  let fullText = ''
  let fullReasoning = ''
  let finishReason = ''
  const toolCallsMap = new Map<number, { id: string; name: string; args: string; thoughtSignature?: string }>()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue

        if (trimmed === 'data: [DONE]') {
          break
        }

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6)
          try {
            const parsed = JSON.parse(jsonStr)
            const choice = parsed.choices?.[0] || parsed
            const delta = choice?.delta || parsed.delta || choice?.message || {}

            if (choice?.finish_reason) {
              finishReason = choice.finish_reason
            }

            // Reasoning stream
            const reasoningChunk = delta.reasoning_content || delta.reasoning || delta.thinking || ''
            if (reasoningChunk) {
              fullReasoning += reasoningChunk
              callbacks.onReasoningDelta(reasoningChunk)
            }

            // Content text stream
            const textChunk = delta.content || ''
            if (textChunk) {
              fullText += textChunk
              callbacks.onTextDelta(textChunk)
            }

            // Native Tool calls streaming
            if (Array.isArray(delta.tool_calls)) {
              for (const tcDelta of delta.tool_calls) {
                const idx = tcDelta.index ?? 0
                let existing = toolCallsMap.get(idx)
                if (!existing) {
                  existing = {
                    id: tcDelta.id || `call_${Date.now()}_${idx}`,
                    name: tcDelta.function?.name || '',
                    args: ''
                  }
                  toolCallsMap.set(idx, existing)
                }

                if (tcDelta.id && !existing.id) {
                  existing.id = tcDelta.id
                }
                if (tcDelta.function?.name && !existing.name) {
                  existing.name = tcDelta.function.name
                }
                // thought_signature is required by Gemini thinking models for multi-turn
                // tool use. In the OpenAI-compat SSE format it is nested at:
                //   extra_content.google.thought_signature
                // Also check the top-level field in case the API changes in the future.
                const sig =
                  tcDelta.extra_content?.google?.thought_signature ||
                  tcDelta.thought_signature
                if (sig) {
                  existing.thoughtSignature = sig
                }

                const argsChunk = tcDelta.function?.arguments || ''
                if (argsChunk) {
                  existing.args += argsChunk
                }

                callbacks.onToolCallDelta({
                  index: idx,
                  id: existing.id,
                  name: existing.name,
                  argsDelta: argsChunk
                })
              }
            }
          } catch {
            // Ignore non-JSON SSE lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  const toolCalls = Array.from(toolCallsMap.values()).filter((tc) => tc.name)

  return {
    text: fullText,
    reasoning: fullReasoning,
    toolCalls,
    finishReason
  }
}

async function streamAnthropicMessages(
  provider: ProviderConfig,
  normUrl: string,
  modelId: string,
  messages: OpenAiMessage[],
  tools: OpenAiToolDefinition[],
  signal: AbortSignal,
  callbacks: StreamCallbacks
): Promise<StreamResult> {
  const endpoint = normUrl.endsWith('/messages') ? normUrl : `${normUrl}/messages`

  const systemMessage = messages.find((m) => m.role === 'system')?.content || ''
  const anthropicMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      let content = m.content || ''
      if (Array.isArray(content)) {
        content = content.map((c) => c.text || '').join('\n')
      }
      return {
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content
      }
    })

  const bodyPayload: any = {
    model: modelId,
    system: typeof systemMessage === 'string' ? systemMessage : '',
    messages: anthropicMessages,
    max_tokens: 4096,
    stream: true
  }

  if (tools && tools.length > 0) {
    bodyPayload.tools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters
    }))
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': provider.apiKey || '',
    'anthropic-version': '2023-06-01'
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyPayload),
    signal
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Anthropic API Error ${response.status}: ${errText}`)
  }

  if (!response.body) throw new Error('No body received')

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  let fullText = ''
  let fullReasoning = ''
  let finishReason = ''
  const toolCallsMap = new Map<number, { id: string; name: string; args: string }>()
  let currentBlockIndex = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue

        const jsonStr = trimmed.slice(6)
        try {
          const parsed = JSON.parse(jsonStr)
          const eventType = parsed.type

          if (eventType === 'content_block_start') {
            currentBlockIndex = parsed.index ?? 0
            if (parsed.content_block?.type === 'tool_use') {
              toolCallsMap.set(currentBlockIndex, {
                id: parsed.content_block.id || `call_${Date.now()}_${currentBlockIndex}`,
                name: parsed.content_block.name || '',
                args: ''
              })
            }
          } else if (eventType === 'content_block_delta') {
            const idx = parsed.index ?? currentBlockIndex
            const delta = parsed.delta || {}

            if (delta.type === 'text_delta' && delta.text) {
              fullText += delta.text
              callbacks.onTextDelta(delta.text)
            } else if (delta.type === 'input_json_delta' && delta.partial_json) {
              const existing = toolCallsMap.get(idx)
              if (existing) {
                existing.args += delta.partial_json
                callbacks.onToolCallDelta({
                  index: idx,
                  id: existing.id,
                  name: existing.name,
                  argsDelta: delta.partial_json
                })
              }
            } else if (delta.thinking) {
              fullReasoning += delta.thinking
              callbacks.onReasoningDelta(delta.thinking)
            }
          } else if (eventType === 'message_delta') {
            if (parsed.delta?.stop_reason) {
              finishReason = parsed.delta.stop_reason
            }
          }
        } catch {
          // ignore parsing error
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  const toolCalls = Array.from(toolCallsMap.values()).filter((tc) => tc.name)

  return {
    text: fullText,
    reasoning: fullReasoning,
    toolCalls,
    finishReason
  }
}

async function streamOpenAiResponses(
  provider: ProviderConfig,
  normUrl: string,
  modelId: string,
  messages: OpenAiMessage[],
  tools: OpenAiToolDefinition[],
  signal: AbortSignal,
  callbacks: StreamCallbacks
): Promise<StreamResult> {
  const endpoint = normUrl.endsWith('/responses') ? normUrl : `${normUrl}/responses`

  console.log(`[Main Chat - Responses API] Calling ${modelId} with [${provider.name || provider.baseUrl}] (${messages.length} input items, ${tools?.length || 0} tools)`)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (provider.apiKey) {
    headers['Authorization'] = `Bearer ${provider.apiKey}`
  }

  // Responses API schema: uses "input" instead of "messages"
  const bodyPayload: any = {
    model: modelId,
    input: sanitizeOpenAiMessages(messages),
    stream: true
  }

  // Responses API schema: tools are flat objects with type: "function"
  if (tools && tools.length > 0) {
    bodyPayload.tools = tools.map((t) => ({
      type: 'function',
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters
    }))
    bodyPayload.tool_choice = 'auto'
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyPayload),
    signal
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    console.error(`[AI Client] Responses API Error ${response.status} (${response.statusText}) from ${endpoint}`)
    console.error(`[AI Client] Response body: ${errorText}`)
    throw new Error(`Responses API Error ${response.status} (${response.statusText}): ${errorText}`)
  }

  if (!response.body) {
    throw new Error('No response body received from responses stream endpoint')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  let fullText = ''
  let fullReasoning = ''
  let finishReason = ''
  const toolCallsMap = new Map<number, { id: string; name: string; args: string }>()
  let currentToolIdx = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue

        if (trimmed === 'data: [DONE]') {
          break
        }

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6)
          try {
            const parsed = JSON.parse(jsonStr)

            const choice = parsed.choices?.[0] || parsed
            const delta = choice?.delta || parsed.delta || choice?.message || {}

            if (choice?.finish_reason) {
              finishReason = choice.finish_reason
            }
            if (parsed.status === 'completed' || parsed.type === 'response.completed') {
              finishReason = 'stop'
            }

            // Reasoning stream
            const reasoningChunk = delta.reasoning_content || delta.reasoning || delta.thinking || parsed.reasoning || ''
            if (reasoningChunk) {
              fullReasoning += reasoningChunk
              callbacks.onReasoningDelta(reasoningChunk)
            }

            // Content text stream
            const textChunk =
              delta.content ||
              (parsed.type === 'response.text.delta' ? parsed.delta : '') ||
              (typeof parsed.delta === 'string' ? parsed.delta : '') ||
              (typeof parsed.text === 'string' ? parsed.text : '') ||
              ''
            if (typeof textChunk === 'string' && textChunk) {
              fullText += textChunk
              callbacks.onTextDelta(textChunk)
            }

            // Responses API output_item / function call events
            if (parsed.type === 'response.output_item.added' && parsed.item?.type === 'function_call') {
              const idx = currentToolIdx++
              toolCallsMap.set(idx, {
                id: parsed.item.call_id || parsed.item.id || `call_${Date.now()}_${idx}`,
                name: parsed.item.name || '',
                args: parsed.item.arguments || ''
              })
            } else if (parsed.type === 'response.function_call_arguments.delta') {
              const callId = parsed.call_id || parsed.item_id
              let foundKey: number | undefined
              for (const [k, v] of toolCallsMap.entries()) {
                if (v.id === callId) {
                  foundKey = k
                  break
                }
              }
              if (foundKey !== undefined) {
                const existing = toolCallsMap.get(foundKey)!
                const argDelta = parsed.delta || ''
                existing.args += argDelta
                callbacks.onToolCallDelta({
                  index: foundKey,
                  id: existing.id,
                  name: existing.name,
                  argsDelta: argDelta
                })
              }
            } else if (Array.isArray(delta.tool_calls)) {
              for (const tcDelta of delta.tool_calls) {
                const idx = tcDelta.index ?? 0
                let existing = toolCallsMap.get(idx)
                if (!existing) {
                  existing = {
                    id: tcDelta.id || `call_${Date.now()}_${idx}`,
                    name: tcDelta.function?.name || tcDelta.name || '',
                    args: ''
                  }
                  toolCallsMap.set(idx, existing)
                }

                if (tcDelta.id && !existing.id) existing.id = tcDelta.id
                if ((tcDelta.function?.name || tcDelta.name) && !existing.name) {
                  existing.name = tcDelta.function?.name || tcDelta.name
                }

                const argsChunk = tcDelta.function?.arguments || tcDelta.arguments || ''
                if (argsChunk) {
                  existing.args += argsChunk
                }

                callbacks.onToolCallDelta({
                  index: idx,
                  id: existing.id,
                  name: existing.name,
                  argsDelta: argsChunk
                })
              }
            }
          } catch {
            // Ignore non-JSON SSE lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  const toolCalls = Array.from(toolCallsMap.values()).filter((tc) => tc.name)

  return {
    text: fullText,
    reasoning: fullReasoning,
    toolCalls,
    finishReason
  }
}
