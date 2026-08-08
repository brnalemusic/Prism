import { ProviderConfig, StreamToolCallDelta } from '../../shared/types'
import { normalizeBaseUrl, isGoogleHost } from './trustedRegistry'
import { OpenAiMessage, OpenAiToolDefinition } from './types'
import { asDataUrl, imageAttachments } from '../toolAttachments'

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
  nativeContent?: import('./types').GeminiContentData
}

type OpenAiToolCall = NonNullable<OpenAiMessage['tool_calls']>[number]

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id?: string; content: string | AnthropicContentBlock[] }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string }
    }

interface AnthropicMessagePayload {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export function sanitizeOpenAiMessages(messages: OpenAiMessage[]): OpenAiMessage[] {
  return messages.flatMap((m) => {
    let cleanContent: OpenAiMessage['content'] = m.content
    if (cleanContent === undefined || cleanContent === null) {
      cleanContent = m.tool_calls && m.tool_calls.length > 0 ? null : ''
    } else if (
      typeof cleanContent === 'string' &&
      cleanContent.trim() === '' &&
      m.tool_calls &&
      m.tool_calls.length > 0
    ) {
      cleanContent = null
    }

    const cleanMsg: OpenAiMessage = {
      role: m.role === 'model' ? 'assistant' : m.role,
      content: cleanContent
    }
    if (m.name) cleanMsg.name = m.name
    if (m.tool_calls && m.tool_calls.length > 0) {
      cleanMsg.tool_calls = m.tool_calls.map((tc) => {
        const thoughtSig =
          tc.thought_signature ||
          tc.extra_content?.google?.thought_signature ||
          tc.thoughtSignature ||
          tc.extra_content?.thought_signature

        const cleanTc: OpenAiToolCall = {
          id: tc.id || `call_${Date.now()}`,
          type: 'function',
          function: {
            name: tc.function?.name || '',
            arguments:
              typeof tc.function?.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function?.arguments || {})
          }
        }

        if (thoughtSig) {
          cleanTc.thought_signature = thoughtSig
          cleanTc.extra_content = tc.extra_content || { google: { thought_signature: thoughtSig } }
        } else if (tc.extra_content) {
          cleanTc.extra_content = tc.extra_content
        }

        return cleanTc
      })
    }
    if (m.tool_call_id) cleanMsg.tool_call_id = m.tool_call_id
    const attachments = imageAttachments(m.tool_attachments)
    if (m.role === 'tool' && attachments.length > 0) {
      // Chat Completions only accepts text in a tool message. The visual result is
      // supplied in a following user message, after the required tool response.
      return [
        cleanMsg,
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `The tool "${m.name || 'unknown_tool'}" returned the attached image. ` +
                'Inspect it and continue the original task. Do not call the same screenshot tool again unless a new screen state is required.'
            },
            ...attachments.map((attachment) => ({
              type: 'image_url',
              image_url: { url: asDataUrl(attachment) }
            }))
          ]
        }
      ]
    }
    return [cleanMsg]
  })
}

export async function streamOpenAiCompletion(
  provider: ProviderConfig,
  modelId: string,
  messages: OpenAiMessage[],
  tools: OpenAiToolDefinition[],
  signal: AbortSignal,
  callbacks: StreamCallbacks,
  reasoningLevel?: string,
  options?: { skipUsageIncrement?: boolean }
): Promise<StreamResult> {
  const normUrl = normalizeBaseUrl(provider.baseUrl)
  const completionType = provider.completionType || 'chat_completions'
  const visualAttachments = messages.flatMap((message) => imageAttachments(message.tool_attachments))
  if (visualAttachments.length > 0) {
    console.info('[AI Client] Sending visual tool attachment.', {
      provider: provider.name || provider.baseUrl,
      completionType,
      attachments: visualAttachments.map((attachment) => ({
        mimeType: attachment.mimeType,
        width: attachment.width,
        height: attachment.height,
        byteLength: attachment.byteLength
      }))
    })
  }

  if (
    completionType === 'gemini_native' ||
    provider.id === 'prism_provider' ||
    provider.baseUrl.includes('prism-ai-proxy') ||
    isGoogleHost(normUrl)
  ) {
    const { streamGeminiCompletion } = await import('./geminiClient')
    return streamGeminiCompletion(
      provider,
      modelId,
      messages,
      tools,
      signal,
      callbacks,
      reasoningLevel,
      options
    )
  }

  if (completionType === 'responses') {
    return streamOpenAiResponses(provider, normUrl, modelId, messages, tools, signal, callbacks)
  }

  if (completionType === 'anthropic_messages') {
    return streamAnthropicMessages(provider, normUrl, modelId, messages, tools, signal, callbacks)
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  const endpoint = `${normUrl}/chat/completions`

  if (provider.apiKey) {
    headers['Authorization'] = `Bearer ${provider.apiKey}`
  }

  console.log(
    `[Main Chat] Calling ${modelId} with [${provider.name || provider.baseUrl}] (${messages.length} messages, ${tools?.length || 0} tools, reasoningLevel: ${reasoningLevel || 'off'})`
  )

  const bodyPayload: {
    model: string
    messages: OpenAiMessage[]
    stream: boolean
    tools?: OpenAiToolDefinition[]
    tool_choice?: 'auto'
  } = {
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
    let detail = errorText
    try {
      const parsed = JSON.parse(errorText)
      if (parsed.error) {
        const rawErr =
          typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error)
        // Unwrap nested provider error messages (e.g. "Provider API Error 400: ..."
        // that contain a JSON blob with the original upstream error)
        const providerMsgMatch = rawErr.match(/Provider API Error \d+:\s*(.+)/)
        if (providerMsgMatch) {
          const innerMsg = providerMsgMatch[1].trim()
          // Check for known error conditions and give friendly messages
          if (innerMsg.toLowerCase().includes('all api keys exhausted')) {
            detail =
              'Prism Cloud servers are temporarily overloaded. Please try again in a few minutes or use your own API key.'
          } else {
            // Try to extract the innermost message from nested JSON
            try {
              const innerParsed = JSON.parse(innerMsg)
              const innerError = innerParsed?.[0]?.error || innerParsed?.error
              if (innerError?.message) {
                detail = innerError.message
              } else {
                detail = innerMsg
              }
            } catch {
              detail = innerMsg
            }
          }
        } else {
          detail = rawErr
        }
      }
    } catch {
      // Preserve the raw upstream error when it is not JSON.
    }

    // Handle server overload (503) — all API keys exhausted on the server side
    if (response.status === 503) {
      try {
        const parsed = JSON.parse(errorText)
        if (parsed?.serverOverloaded) {
          detail =
            'Prism Cloud servers are temporarily overloaded. Please try again in a few minutes or use your own API key.'
        }
      } catch {
        // The generic status text remains the fallback for non-JSON responses.
      }
    }

    console.error(
      `[AI Client] API Error ${response.status} (${response.statusText}) from ${endpoint}: ${detail}`
    )
    throw new Error(`API Error ${response.status}: ${detail}`)
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
  const toolCallsMap = new Map<
    number,
    { id: string; name: string; args: string; thoughtSignature?: string }
  >()

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
            const reasoningChunk =
              delta.reasoning_content ||
              delta.reasoning ||
              delta.thinking ||
              delta.thought ||
              delta.extra_content?.google?.thought ||
              choice.reasoning_content ||
              parsed.reasoning ||
              ''
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
                  tcDelta.thought_signature ||
                  tcDelta.extra_fields?.thought_signature ||
                  tcDelta.function?.thought_signature ||
                  delta.extra_content?.google?.thought_signature ||
                  delta.thought_signature ||
                  choice?.extra_content?.google?.thought_signature ||
                  choice?.thought_signature ||
                  parsed?.extra_content?.google?.thought_signature ||
                  parsed?.thought_signature
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
  const anthropicMessages: AnthropicMessagePayload[] = []
  for (const message of messages.filter((entry) => entry.role !== 'system')) {
    if (message.role === 'assistant' || message.role === 'model') {
      const blocks: AnthropicContentBlock[] = []
      if (typeof message.content === 'string' && message.content) {
        blocks.push({ type: 'text', text: message.content })
      }
      for (const toolCall of message.tool_calls || []) {
        let input: Record<string, unknown> = {}
        try {
          input = JSON.parse(toolCall.function.arguments || '{}')
        } catch {
          // The runtime validator will return malformed arguments to the model.
        }
        blocks.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input
        })
      }
      anthropicMessages.push({ role: 'assistant', content: blocks.length ? blocks : '' })
      continue
    }

    if (message.role === 'tool') {
      const attachments = imageAttachments(message.tool_attachments)
      let toolContent: string | AnthropicContentBlock[] =
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content)

      if (attachments.length > 0) {
        toolContent = [
          {
            type: 'text',
            text: typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
          },
          ...attachments.map((attachment) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: attachment.mimeType, data: attachment.data }
          }))
        ]
      }

      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: message.tool_call_id,
        content: toolContent
      }
      const previous = anthropicMessages.at(-1)
      if (
        previous?.role === 'user' &&
        Array.isArray(previous.content) &&
        previous.content.every((entry) => entry.type === 'tool_result')
      ) {
        previous.content.push(block)
      } else {
        anthropicMessages.push({ role: 'user', content: [block] })
      }
      continue
    }

    if (Array.isArray(message.content)) {
      const blocks: AnthropicContentBlock[] = []
      for (const entry of message.content) {
        if (entry.type === 'text' && entry.text) {
          blocks.push({ type: 'text', text: entry.text })
          continue
        }
        const dataUrl = entry.image_url?.url?.match(/^data:([^;,]+);base64,(.+)$/s)
        if (dataUrl) {
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: dataUrl[1], data: dataUrl[2] }
          })
        }
      }
      anthropicMessages.push({ role: 'user', content: blocks })
    } else {
      anthropicMessages.push({ role: 'user', content: message.content || '' })
    }
  }

  const bodyPayload: {
    model: string
    system: string
    messages: AnthropicMessagePayload[]
    max_tokens: number
    stream: boolean
    tools?: Array<{
      name: string
      description: string
      input_schema?: Record<string, unknown>
    }>
  } = {
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
              const initialInput = parsed.content_block.input || {}
              toolCallsMap.set(currentBlockIndex, {
                id: parsed.content_block.id || `call_${Date.now()}_${currentBlockIndex}`,
                name: parsed.content_block.name || '',
                args: Object.keys(initialInput).length > 0 ? JSON.stringify(initialInput) : ''
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
  for (const toolCall of toolCalls) {
    if (!toolCall.args) toolCall.args = '{}'
  }

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

  console.log(
    `[Main Chat - Responses API] Calling ${modelId} with [${provider.name || provider.baseUrl}] (${messages.length} input items, ${tools?.length || 0} tools)`
  )

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (provider.apiKey) {
    headers['Authorization'] = `Bearer ${provider.apiKey}`
  }

  const responsesInput: Array<Record<string, unknown>> = []
  for (const message of messages) {
    if (message.role === 'tool') {
      const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
      responsesInput.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: [
          { type: 'input_text', text },
          ...imageAttachments(message.tool_attachments).map((attachment) => ({
            type: 'input_image',
            image_url: asDataUrl(attachment),
            detail: 'auto'
          }))
        ]
      })
      continue
    }
    if ((message.role === 'assistant' || message.role === 'model') && message.tool_calls?.length) {
      if (message.content) {
        responsesInput.push({ role: 'assistant', content: message.content })
      }
      for (const toolCall of message.tool_calls) {
        responsesInput.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments
        })
      }
      continue
    }
    responsesInput.push({
      role: message.role === 'model' ? 'assistant' : message.role,
      content: toResponsesMessageContent(message.content)
    })
  }

  // Responses API schema uses typed input items instead of Chat Completions messages.
  const bodyPayload: {
    model: string
    input: Array<Record<string, unknown>>
    stream: boolean
    tools?: Array<{
      type: 'function'
      name: string
      description: string
      parameters?: Record<string, unknown>
    }>
    tool_choice?: 'auto'
  } = {
    model: modelId,
    input: responsesInput,
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
    console.error(
      `[AI Client] Responses API Error ${response.status} (${response.statusText}) from ${endpoint}`
    )
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
  const toolCallsMap = new Map<
    number,
    { id: string; name: string; args: string; thoughtSignature?: string }
  >()
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
            const reasoningChunk =
              delta.reasoning_content || delta.reasoning || delta.thinking || parsed.reasoning || ''
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
            if (
              parsed.type === 'response.output_item.added' &&
              parsed.item?.type === 'function_call'
            ) {
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
            } else if (parsed.type === 'response.function_call_arguments.done') {
              const callId = parsed.call_id || parsed.item_id
              for (const existing of toolCallsMap.values()) {
                if (existing.id === callId && typeof parsed.arguments === 'string') {
                  existing.args = parsed.arguments
                }
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

                const sig =
                  tcDelta.extra_content?.google?.thought_signature ||
                  tcDelta.thought_signature ||
                  tcDelta.extra_fields?.thought_signature ||
                  tcDelta.function?.thought_signature ||
                  delta.extra_content?.google?.thought_signature ||
                  delta.thought_signature ||
                  choice?.extra_content?.google?.thought_signature ||
                  choice?.thought_signature ||
                  parsed?.extra_content?.google?.thought_signature ||
                  parsed?.thought_signature
                if (sig) {
                  existing.thoughtSignature = sig
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

function toResponsesMessageContent(
  content: OpenAiMessage['content']
): string | Array<Record<string, unknown>> {
  if (!Array.isArray(content)) return content || ''
  const blocks: Array<Record<string, unknown>> = []
  for (const part of content) {
    if (part.type === 'text' && part.text) {
      blocks.push({ type: 'input_text', text: part.text })
      continue
    }
    if (part.type === 'image_url' && part.image_url?.url) {
      blocks.push({ type: 'input_image', image_url: part.image_url.url, detail: 'auto' })
    }
  }
  return blocks
}
