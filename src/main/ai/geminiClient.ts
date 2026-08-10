import { Content, FunctionDeclaration, GoogleGenAI, Part, ThinkingLevel } from '@google/genai'
import { getAuthAccessToken } from '../supabaseAuth'
import { schemaForGemini } from '../toolRuntime'
import type { JsonSchema } from '../toolsManifest'
import { ProviderConfig } from '../../shared/types'
import {
  GeminiContentData,
  GeminiPartData,
  OpenAiMessage,
  OpenAiToolDefinition,
  PrismThinkingLevel
} from './types'
import type { StreamCallbacks, StreamResult } from './openaiClient'
import { isPrismCloudProvider, normalizePrismThinkingLevel } from './prismThinking'
import { initializePrismCloudTransport } from '../connection'
import { asDataUrl, imageAttachments } from '../toolAttachments'

const thinkingLevelMap: Record<PrismThinkingLevel, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH
}

function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = url.match(/^data:([^;,]+);base64,(.+)$/s)
  return match ? { mimeType: match[1], data: match[2] } : null
}

function messageTextParts(message: OpenAiMessage): Part[] {
  if (typeof message.content === 'string') return message.content ? [{ text: message.content }] : []
  if (!Array.isArray(message.content)) return []
  const parts: Part[] = []
  for (const entry of message.content) {
    if (entry.type === 'text' && entry.text) parts.push({ text: entry.text })
    const dataUrl = entry.image_url?.url ? parseDataUrl(entry.image_url.url) : null
    if (dataUrl) parts.push({ inlineData: dataUrl })
  }
  return parts
}

function parseFunctionResponse(content: OpenAiMessage['content']): Record<string, unknown> {
  if (typeof content !== 'string') return { output: content ?? '' }
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (typeof parsed.output === 'string') {
        try {
          const innerParsed = JSON.parse(parsed.output)
          if (innerParsed && typeof innerParsed === 'object') {
            return { ...parsed, output: innerParsed }
          }
        } catch {
          // Output is plain text
        }
      }
      return parsed as Record<string, unknown>
    }
  } catch {
    // Non-JSON tool results are wrapped as plain output.
  }
  return { output: content }
}

export function convertMessagesToGemini(messages: OpenAiMessage[]): {
  systemInstruction?: string
  contents: Content[]
} {
  const systemInstruction = messages
    .filter((message) => message.role === 'system' && typeof message.content === 'string')
    .map((message) => message.content as string)
    .join('\n\n')

  const contents: Content[] = []
  for (const message of messages) {
    if (message.role === 'system') continue

    if (message.role === 'assistant' || message.role === 'model') {
      const nativeContent = message.provider_metadata?.gemini?.content
      if (nativeContent?.parts?.length) {
        contents.push(nativeContent as Content)
        continue
      }
      const parts = messageTextParts(message)
      for (const toolCall of message.tool_calls || []) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(toolCall.function.arguments || '{}')
        } catch {
          // Invalid legacy arguments are validated after the model retries the call.
        }
        parts.push({
          functionCall: { id: toolCall.id, name: toolCall.function.name, args },
          ...(toolCall.thought_signature ? { thoughtSignature: toolCall.thought_signature } : {})
        })
      }
      if (parts.length) contents.push({ role: 'model', parts })
      continue
    }

    if (message.role === 'tool') {
      const responsePart: Part = {
        functionResponse: {
          id: message.tool_call_id,
          name: message.name || 'unknown_tool',
          response: parseFunctionResponse(message.content)
        }
      }
      const toolParts: Part[] = [responsePart]

      for (const attachment of imageAttachments(message.tool_attachments)) {
        const dataUrl = parseDataUrl(asDataUrl(attachment))
        if (dataUrl) {
          toolParts.push({ inlineData: dataUrl })
        }
      }

      const previous = contents.at(-1)
      if (
        previous?.role === 'user' &&
        previous.parts?.every((part) => Boolean(part.functionResponse || part.inlineData))
      ) {
        previous.parts.push(...toolParts)
      } else {
        contents.push({ role: 'user', parts: toolParts })
      }
      continue
    }

    const parts = messageTextParts(message)
    if (parts.length) contents.push({ role: 'user', parts })
  }
  return { systemInstruction: systemInstruction || undefined, contents }
}

function appendTextPart(nativeParts: GeminiPartData[], part: Part, text: string): void {
  const previous = nativeParts.at(-1)
  const canAppend =
    previous &&
    !previous.functionCall &&
    !previous.functionResponse &&
    Boolean(previous.thought) === Boolean(part.thought) &&
    (!previous.thoughtSignature ||
      !part.thoughtSignature ||
      previous.thoughtSignature === part.thoughtSignature)
  if (canAppend) {
    previous.text = (previous.text || '') + text
    if (!previous.thoughtSignature && part.thoughtSignature) {
      previous.thoughtSignature = part.thoughtSignature
    }
  } else {
    nativeParts.push({
      text,
      ...(part.thought ? { thought: true } : {}),
      ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {})
    })
  }
}

export async function streamGeminiCompletion(
  provider: ProviderConfig,
  modelId: string,
  messages: OpenAiMessage[],
  tools: OpenAiToolDefinition[],
  signal: AbortSignal,
  callbacks: StreamCallbacks,
  reasoningLevel?: string,
  options?: { skipUsageIncrement?: boolean }
): Promise<StreamResult> {
  console.log(
    `[Main Chat] Calling ${modelId} with [${provider.name || provider.baseUrl}] (${messages.length} messages, ${tools?.length || 0} tools, reasoningLevel: ${reasoningLevel || 'off'})`
  )
  const prismCloud = isPrismCloudProvider(provider)
  const headers: Record<string, string> = {}
  let apiKey = provider.apiKey
  let httpOptions:
    | { baseUrl?: string; apiVersion?: string; headers?: Record<string, string> }
    | undefined

  if (prismCloud) {
    initializePrismCloudTransport()
    const token = await getAuthAccessToken()
    if (!token) throw new Error('Please log in to your Prism account to access Prism Cloud models.')
    headers.Authorization = `Bearer ${token}`
    if (options?.skipUsageIncrement) headers['X-Prism-Skip-Increment'] = 'true'
    apiKey = 'prism-cloud-proxy'
    httpOptions = { baseUrl: provider.baseUrl, apiVersion: '', headers }
  }

  const client = new GoogleGenAI({
    apiKey,
    apiVersion: prismCloud ? '' : 'v1beta',
    ...(httpOptions ? { httpOptions } : {})
  })
  const { systemInstruction, contents } = convertMessagesToGemini(messages)
  const thinkingLevel = normalizePrismThinkingLevel(provider, modelId, reasoningLevel)
  // `tools` is already filtered for this request's chat session. Rebuilding the list
  // from the global manifest here would lose skill-unlocked tools because their
  // availability is session-scoped.
  const functionDeclarations = tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: schemaForGemini((tool.function.parameters || {}) as unknown as JsonSchema)
  })) as FunctionDeclaration[]

  const stream = await client.models.generateContentStream({
    model: modelId,
    contents,
    config: {
      abortSignal: signal,
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(functionDeclarations.length > 0 ? { tools: [{ functionDeclarations }] } : {}),
      ...(thinkingLevel
        ? {
            thinkingConfig: {
              thinkingLevel: thinkingLevelMap[thinkingLevel],
              includeThoughts: true
            }
          }
        : {})
    }
  })

  let text = ''
  let reasoning = ''
  let finishReason = ''
  const nativeParts: GeminiPartData[] = []
  const toolCalls: StreamResult['toolCalls'] = []
  const seenCalls = new Set<string>()

  for await (const chunk of stream) {
    const candidate = chunk.candidates?.[0]
    if (candidate?.finishReason) finishReason = String(candidate.finishReason)
    for (const part of candidate?.content?.parts || []) {
      if (part.text) {
        appendTextPart(nativeParts, part, part.text)
        if (part.thought) {
          reasoning += part.text
          callbacks.onReasoningDelta(part.text)
        } else {
          text += part.text
          callbacks.onTextDelta(part.text)
        }
      }
      if (part.functionCall?.name) {
        const index = toolCalls.length
        const id = part.functionCall.id || `call_${Date.now()}_${index}`
        const callKey = `${id}:${part.functionCall.name}`
        if (seenCalls.has(callKey)) continue
        seenCalls.add(callKey)
        const args = part.functionCall.args || {}
        nativeParts.push({
          functionCall: { id, name: part.functionCall.name, args },
          ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {})
        })
        const serializedArgs = JSON.stringify(args)
        toolCalls.push({
          id,
          name: part.functionCall.name,
          args: serializedArgs,
          thoughtSignature: part.thoughtSignature
        })
        callbacks.onToolCallDelta({
          index,
          id,
          name: part.functionCall.name,
          argsDelta: serializedArgs
        })
      }
    }
  }

  const nativeContent: GeminiContentData | undefined = nativeParts.length
    ? { role: 'model', parts: nativeParts }
    : undefined

  return { text, reasoning, toolCalls, finishReason, nativeContent }
}
