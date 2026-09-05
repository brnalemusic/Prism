import http from 'node:http'
import { shell } from 'electron'
import { puter } from '@heyputer/puter.js'
import { ProviderConfig, ProviderModel } from '../../shared/types'
import { isModelTrusted } from './trustedRegistry'
import { asDataUrl, imageAttachments } from '../toolAttachments'
import { shouldForwardImageToolAttachments } from './imageGenerationCore'
import type { StreamCallbacks, StreamResult } from './openaiClient'
import type { OpenAiMessage, OpenAiToolDefinition, OpenAiToolCall } from './types'

export interface PuterUser {
  username?: string
  email?: string
  [key: string]: unknown
}

export interface PuterLoginResult {
  success: boolean
  token?: string
  username?: string
  user?: PuterUser
  error?: string
}

export interface PuterImageRequest {
  authToken: string
  prompt: string
  model: string
  provider?: string
  quality?: string
  ratio?: { w: number; h: number }
  inputImage?: string
  inputImageMimeType?: string
}

function isPuterChatImageModel(request: PuterImageRequest): boolean {
  return (
    request.provider?.trim().toLowerCase() === 'openrouter' &&
    /(?:^|[/:\s])gpt-\d+(?:\.\d+)?-image(?:[-\s]|$)/i.test(request.model)
  )
}

function normalizePuterModelId(modelId: string): string {
  return modelId.replace(/^openrouter:/i, '')
}

let activeAuthServer: http.Server | null = null
let activeAuthReject: ((reason?: Error) => void) | null = null

/**
 * Fetches models using the official native Puter.js SDK (puter.ai.listModels()).
 * Falls back gracefully to the HTTP endpoint to guarantee 100% reliability in production builds.
 */
export async function fetchPuterModelsViaSDK(authToken?: string): Promise<{
  success: boolean
  models: ProviderModel[]
  error?: string
}> {
  try {
    if (authToken && authToken.trim()) {
      try {
        puter.setAuthToken(authToken.trim())
      } catch (authErr) {
        console.warn('[Puter.js SDK] Warning setting auth token on SDK instance:', authErr)
      }
    }

    const rawList = await puter.ai.listModels()
    if (!Array.isArray(rawList)) {
      console.warn('[Puter.js SDK] SDK returned non-array models, falling back to endpoint')
      return await fetchPuterModels(authToken)
    }

    const models: ProviderModel[] = []
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue
      const id =
        typeof (item as Record<string, unknown>).id === 'string' &&
        ((item as Record<string, unknown>).id as string).trim()
          ? ((item as Record<string, unknown>).id as string).trim()
          : typeof (item as Record<string, unknown>).puterId === 'string' &&
              ((item as Record<string, unknown>).puterId as string).trim()
            ? ((item as Record<string, unknown>).puterId as string).trim()
            : ''
      if (!id) continue

      const rawName = (item as Record<string, unknown>).name
      const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : id
      const rawProvider = (item as Record<string, unknown>).provider
      const provider =
        typeof rawProvider === 'string' && rawProvider.trim() ? rawProvider.trim() : undefined
      const trusted = isModelTrusted(id)
      models.push({
        id,
        name,
        ...(provider ? { provider } : {}),
        isTrusted: trusted,
        enabled: trusted
      })
    }

    if (models.length === 0) {
      console.warn('[Puter.js SDK] SDK returned 0 models, falling back to endpoint')
      return await fetchPuterModels(authToken)
    }

    return {
      success: true,
      models
    }
  } catch (error: unknown) {
    console.warn('[Puter.js SDK] Failed to fetch models via SDK, falling back to endpoint:', error)
    return await fetchPuterModels(authToken)
  }
}

/**
 * Fetches models directly from Puter.js AI endpoints.
 */
export async function fetchPuterModels(authToken?: string): Promise<{
  success: boolean
  models: ProviderModel[]
  error?: string
}> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (authToken && authToken.trim()) {
      headers['Authorization'] = `Bearer ${authToken.trim()}`
    }

    const response = await fetch('https://api.puter.com/puterai/chat/models/details', {
      method: 'GET',
      headers
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return {
        success: false,
        models: [],
        error: `HTTP ${response.status}: ${errText || response.statusText}`
      }
    }

    const data: unknown = await response.json()
    let rawList: Array<Record<string, unknown>> = []

    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>
      if (Array.isArray(record.models)) {
        rawList = record.models
      } else if (Array.isArray(record.data)) {
        rawList = record.data
      }
    } else if (Array.isArray(data)) {
      rawList = data
    }

    const models: ProviderModel[] = []
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue
      const id =
        typeof item.id === 'string'
          ? item.id
          : typeof item.puterId === 'string'
            ? item.puterId
            : ''
      if (!id) continue

      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id
      const provider =
        typeof item.provider === 'string' && item.provider.trim() ? item.provider.trim() : undefined
      const trusted = isModelTrusted(id)
      models.push({
        id,
        name,
        ...(provider ? { provider } : {}),
        isTrusted: trusted,
        enabled: trusted
      })
    }

    return {
      success: true,
      models
    }
  } catch (error: unknown) {
    return {
      success: false,
      models: [],
      error: error instanceof Error ? error.message : 'Failed to fetch models from Puter'
    }
  }
}

/**
 * Retrieves the authenticated Puter user profile using the user account token.
 */
export async function getPuterUser(authToken: string): Promise<PuterUser | null> {
  if (!authToken || !authToken.trim()) return null

  try {
    const response = await fetch('https://api.puter.com/whoami', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${authToken.trim()}`
      }
    })

    if (!response.ok) return null

    const data: unknown = await response.json()
    if (!data || typeof data !== 'object') return null

    const record = data as Record<string, unknown>
    const username =
      typeof record.username === 'string'
        ? record.username
        : typeof (record.user as Record<string, unknown>)?.username === 'string'
          ? ((record.user as Record<string, unknown>).username as string)
          : undefined

    return {
      username,
      ...record
    }
  } catch {
    return null
  }
}

/**
 * Generates an image through the official Puter.js User-Pays SDK.
 * This intentionally does not call OpenAI-compatible image endpoints.
 */
export async function generatePuterImage(request: PuterImageRequest): Promise<string> {
  const authToken = request.authToken.trim()
  if (!authToken) throw new Error('Puter account session is missing. Please reconnect your account.')

  puter.setAuthToken(authToken)
  const provider = request.provider?.trim()

  // Puter's OpenRouter GPT image models are chat models that return images in
  // message.images; they are not handled by the txt2img driver.
  if (isPuterChatImageModel(request)) {
    const options = {
      model: normalizePuterModelId(request.model),
      ...(provider ? { provider } : {})
    }
    const response = request.inputImage
      ? await puter.ai.chat(request.prompt, request.inputImage, options)
      : await puter.ai.chat(request.prompt, options)
    const source = response.message?.images?.find(
      (image) => typeof image?.image_url?.url === 'string' && image.image_url.url.trim()
    )?.image_url?.url
    if (source) return source.trim()

    const content =
      typeof response.message?.content === 'string' ? ` ${response.message.content.slice(0, 300)}` : ''
    throw new Error(`Puter chat returned no generated image.${content}`)
  }

  const image = await puter.ai.txt2img({
    prompt: request.prompt,
    model: normalizePuterModelId(request.model),
    // Puter.js uses `driver` to select the native image driver. The model
    // catalog calls this value `provider`, so forward both fields.
    ...(provider ? { driver: provider, provider } : {}),
    ...(request.quality ? { quality: request.quality } : {}),
    ...(request.ratio ? { ratio: request.ratio } : {}),
    ...(request.inputImage ? { input_image: request.inputImage } : {}),
    ...(request.inputImageMimeType
      ? { input_image_mime_type: request.inputImageMimeType }
      : {})
  })
  const src = image && typeof image.src === 'string' ? image.src.trim() : ''
  if (!src) throw new Error('Puter.js returned an image without a source URL.')
  return src
}

/**
 * Cancels any active browser login flow.
 */
export function cancelPuterLoginFlow(): boolean {
  if (activeAuthServer) {
    try {
      activeAuthServer.close()
    } catch {
      // Ignore close errors
    }
    activeAuthServer = null
  }

  if (activeAuthReject) {
    activeAuthReject(new Error('Login cancelled by user'))
    activeAuthReject = null
  }

  return true
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Prism — Puter Connected</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: #090a0f;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: rgba(22, 27, 34, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      padding: 40px 32px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(16px);
    }
    .icon-badge {
      width: 68px;
      height: 68px;
      margin: 0 auto 20px;
      border-radius: 50%;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 25px -5px rgba(16, 185, 129, 0.4);
    }
    .icon-badge svg {
      width: 36px;
      height: 36px;
      stroke: #ffffff;
      stroke-width: 3;
      fill: none;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }
    p {
      font-size: 14px;
      color: #94a3b8;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .status-box {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 12px 16px;
      font-size: 13px;
      color: #cbd5e1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .footer {
      margin-top: 24px;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-badge">
      <svg viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <h1>Authentication Successful</h1>
    <p>Your Puter account is now connected to Prism. You can close this tab and return to the application.</p>
    <div class="status-box">
      <span>Connected to Puter.js</span>
    </div>
    <div class="footer">
      Prism — Autonomous AI Development Environment
    </div>
  </div>
</body>
</html>`

/**
 * Starts the browser login flow for Puter.js:
 * 1. Launches a local ephemeral HTTP server on 127.0.0.1.
 * 2. Opens the user's default browser to https://puter.com/?action=authme&redirectURL=...
 * 3. Captures the returned auth token and closes the server.
 * 4. Verifies the user session and returns the token and username.
 */
export function startPuterLoginFlow(guiOrigin: string = 'https://puter.com'): Promise<PuterLoginResult> {
  // Cancel any existing login flow before starting a new one
  cancelPuterLoginFlow()

  return new Promise((resolve) => {
    let timeoutId: NodeJS.Timeout | null = null

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (activeAuthServer) {
        try {
          activeAuthServer.close()
        } catch {
          // ignore
        }
        activeAuthServer = null
      }
      activeAuthReject = null
    }

    activeAuthReject = (err) => {
      cleanup()
      resolve({
        success: false,
        error: err?.message || 'Login was cancelled'
      })
    }

    // Set a 5-minute timeout for the authentication flow
    timeoutId = setTimeout(() => {
      cleanup()
      resolve({
        success: false,
        error: 'Authentication timed out. Please try again.'
      })
    }, 5 * 60 * 1000)

    const server = http.createServer(async (req, res) => {
      try {
        const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1/')
        const token = parsedUrl.searchParams.get('token')

        if (token) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(SUCCESS_HTML)

          cleanup()

          let username: string | undefined
          let userObj: PuterUser | undefined
          try {
            const user = await getPuterUser(token)
            if (user) {
              username = user.username
              userObj = user
            }
          } catch {
            // User info retrieval is optional
          }

          resolve({
            success: true,
            token,
            username,
            user: userObj
          })
          return
        }

        // If no token was provided in the query string
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Missing token in authentication response')
      } catch (err: unknown) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Internal server error')
        cleanup()
        resolve({
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error during authentication'
        })
      }
    })

    activeAuthServer = server

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        cleanup()
        resolve({
          success: false,
          error: 'Failed to bind local authentication listener'
        })
        return
      }

      const port = address.port
      const redirectUrl = `http://127.0.0.1:${port}`
      const authUrl = `${guiOrigin}/?action=authme&redirectURL=${encodeURIComponent(redirectUrl)}`

      // Open user's default browser
      shell.openExternal(authUrl).catch((openErr) => {
        cleanup()
        resolve({
          success: false,
          error: `Could not open default browser: ${openErr instanceof Error ? openErr.message : String(openErr)}`
        })
      })
    })

    server.on('error', (err) => {
      cleanup()
      resolve({
        success: false,
        error: `Authentication server error: ${err.message}`
      })
    })
  })
}

/**
 * Sanitizes messages specifically for Puter.js driver protocol.
 * Puter.js SDK and downstream model drivers require `content` to be a string or array of parts (never null),
 * and requires tool responses to have valid `tool_call_id` and string `content`.
 */
export function sanitizePuterMessages(messages: OpenAiMessage[]): OpenAiMessage[] {
  return messages.flatMap((m) => {
    let cleanContent: OpenAiMessage['content'] = m.content
    if (cleanContent === undefined || cleanContent === null) {
      cleanContent = ''
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

    if (m.tool_call_id) {
      cleanMsg.tool_call_id = m.tool_call_id
    }

    const attachments = imageAttachments(m.tool_attachments)
    if (m.role === 'tool' && attachments.length > 0) {
      // The generation tool already reports success and opaque image references
      // in its text result. Sending its output back as vision input breaks Puter
      // chat models that can generate images but cannot inspect them.
      if (!shouldForwardImageToolAttachments(m.name)) return [cleanMsg]
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

/**
 * Streams chat completions directly using Puter.js native driver protocol:
 * POST https://api.puter.com/drivers/call
 * interface: 'puter-chat-completion', driver: 'ai-chat', method: 'complete'
 *
 * This consumes user credits via Puter User-Pays model and supports streaming & tool calling.
 */
export async function streamPuterCompletion(
  provider: ProviderConfig,
  modelId: string,
  messages: OpenAiMessage[],
  tools: OpenAiToolDefinition[],
  signal: AbortSignal,
  callbacks: StreamCallbacks,
  reasoningLevel?: string
): Promise<StreamResult> {
  const authToken = provider.puterAuthToken?.trim() || provider.apiKey?.trim() || ''
  const endpoint = 'https://api.puter.com/drivers/call'

  const formattedMessages = sanitizePuterMessages(messages)

  const driverArgs: Record<string, unknown> = {
    messages: formattedMessages,
    model: normalizePuterModelId(modelId),
    stream: true
  }

  const hasImageInput = formattedMessages.some(
    (message) =>
      message.role === 'user' &&
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'image_url')
  )
  if (hasImageInput) {
    // The public Puter chat overload sets this flag when an image is passed as
    // its media argument. Prism sends normalized messages directly through the
    // driver, so preserve the same signal for vision-capable models.
    driverArgs.vision = true
  }

  if (tools && tools.length > 0) {
    driverArgs.tools = tools
  }

  if (reasoningLevel && reasoningLevel !== 'off') {
    driverArgs.reasoning_effort = reasoningLevel
  }

  const payload = {
    interface: 'puter-chat-completion',
    driver: 'ai-chat',
    test_mode: false,
    method: 'complete',
    args: driverArgs,
    auth_token: authToken
  }

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain;actually=json'
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  console.log(
    `[Main Chat] Calling ${modelId} with [Puter.js Native Driver] (${messages.length} messages, ${tools?.length || 0} tools, reasoningLevel: ${reasoningLevel || 'off'})`
  )

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    console.error(`[AI Client] Puter.js Error ${response.status}: ${errorText}`)
    throw new Error(`Puter.js Error ${response.status}: ${errorText || response.statusText}`)
  }

  if (!response.body) {
    throw new Error('No response body received from Puter.js stream endpoint')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  let fullText = ''
  let fullReasoning = ''
  let finishReason = 'stop'
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

        if (trimmed === 'data: [DONE]' || trimmed === '[DONE]') {
          break
        }

        let jsonStr = trimmed
        if (jsonStr.startsWith('data: ')) {
          jsonStr = jsonStr.slice(6).trim()
        }

        try {
          const parsed = JSON.parse(jsonStr)

          // 1. Error handling
          if (parsed.error) {
            const errMsg =
              typeof parsed.error === 'string'
                ? parsed.error
                : parsed.error.message || JSON.stringify(parsed.error)
            throw new Error(`Puter.js Stream Error: ${errMsg}`)
          }

          // 2. Puter Native Chunk format (NDJSON): { type: "text", text: "..." } or { type: "reasoning", reasoning: "..." }
          if (parsed.type === 'text' && typeof parsed.text === 'string') {
            fullText += parsed.text
            callbacks.onTextDelta(parsed.text)
          } else if (parsed.type === 'reasoning' && typeof parsed.reasoning === 'string') {
            fullReasoning += parsed.reasoning
            callbacks.onReasoningDelta(parsed.reasoning)
          } else if (parsed.type === 'tool_use' || parsed.tool_use) {
            // Puter Native tool_use chunk: { type: "tool_use", id: "...", name: "...", input: {...} }
            const tu = parsed.tool_use || parsed
            const hasRealId = Boolean(tu.id || parsed.id || parsed.function?.id)
            const explicitId = tu.id || parsed.id || parsed.function?.id || ''
            const name =
              tu.name ||
              parsed.name ||
              parsed.function?.name ||
              tu.function?.name ||
              ''
            const rawArgs =
              tu.input ??
              tu.arguments ??
              parsed.input ??
              parsed.arguments ??
              parsed.function?.arguments ??
              tu.function?.arguments

            const argsStr =
              typeof rawArgs === 'string'
                ? rawArgs
                : rawArgs !== undefined && rawArgs !== null
                  ? JSON.stringify(rawArgs)
                  : ''

            const rawIndex =
              typeof tu.index === 'number'
                ? tu.index
                : typeof parsed.index === 'number'
                  ? parsed.index
                  : undefined

            let existingIdx = typeof rawIndex === 'number' ? rawIndex : -1
            if (existingIdx === -1 && explicitId) {
              for (const [idx, item] of toolCallsMap.entries()) {
                if (item.id === explicitId) {
                  existingIdx = idx
                  break
                }
              }
            }

            if (existingIdx === -1) {
              existingIdx = toolCallsMap.size
              const callId = explicitId || `call_${Date.now()}_${existingIdx}`
              const entry = { id: callId, name, args: argsStr }
              toolCallsMap.set(existingIdx, entry)
              callbacks.onToolCallDelta({
                index: existingIdx,
                id: callId,
                name,
                argsDelta: argsStr
              })
            } else {
              const existing = toolCallsMap.get(existingIdx)!
              if (explicitId && (!existing.id || !hasRealId)) existing.id = explicitId
              if (name && !existing.name) existing.name = name
              if (argsStr) {
                existing.args = existing.args ? existing.args + argsStr : argsStr
              }
              callbacks.onToolCallDelta({
                index: existingIdx,
                id: existing.id,
                name: existing.name,
                argsDelta: argsStr
              })
            }
          } else {
            // 3. Fallback: Choice / Delta format (if upstream driver returns standard OpenAI/Delta objects)
            const choice = parsed.choices?.[0] || (parsed.delta ? parsed : null)
            const delta = choice?.delta || choice?.message || parsed.delta || parsed.message
            if (delta) {
              if (choice?.finish_reason) {
                finishReason = choice.finish_reason
              }

              const reasoningChunk =
                delta.reasoning_content ||
                delta.reasoning ||
                delta.thinking ||
                delta.thought ||
                ''
              if (reasoningChunk) {
                fullReasoning += reasoningChunk
                callbacks.onReasoningDelta(reasoningChunk)
              }

              const textChunk = delta.content || ''
              if (textChunk) {
                fullText += textChunk
                callbacks.onTextDelta(textChunk)
              }

              const toolCallsList = Array.isArray(delta.tool_calls)
                ? delta.tool_calls
                : Array.isArray(parsed.tool_calls)
                  ? parsed.tool_calls
                  : null

              if (toolCallsList) {
                for (const tcDelta of toolCallsList) {
                  const idx = tcDelta.index ?? toolCallsMap.size
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
                  const tcName = tcDelta.function?.name || tcDelta.name
                  if (tcName && !existing.name) existing.name = tcName

                  const rawTcArgs = tcDelta.function?.arguments ?? tcDelta.arguments ?? tcDelta.input
                  const argsChunk =
                    typeof rawTcArgs === 'string'
                      ? rawTcArgs
                      : rawTcArgs !== undefined && rawTcArgs !== null
                        ? JSON.stringify(rawTcArgs)
                        : ''

                  if (argsChunk) existing.args += argsChunk
                  callbacks.onToolCallDelta({
                    index: idx,
                    id: existing.id,
                    name: existing.name,
                    argsDelta: argsChunk
                  })
                }
              }
            } else if (
              parsed.text &&
              typeof parsed.text === 'string'
            ) {
              fullText += parsed.text
              callbacks.onTextDelta(parsed.text)
            }
          }
        } catch (parseErr: unknown) {
          if (
            parseErr instanceof Error &&
            parseErr.message.startsWith('Puter.js Stream Error:')
          ) {
            throw parseErr
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  const toolCalls = Array.from(toolCallsMap.values())
    .filter((tc) => Boolean(tc.name && tc.name.trim()))
    .map((tc) => ({
      id: tc.id,
      name: tc.name,
      args: tc.args || '{}',
      thoughtSignature: tc.thoughtSignature
    }))

  return {
    text: fullText,
    reasoning: fullReasoning,
    toolCalls,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : finishReason
  }
}
