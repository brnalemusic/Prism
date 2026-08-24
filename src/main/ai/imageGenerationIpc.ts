import { app, dialog } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import type {
  RetryImageGenerationRequest,
  SaveGeneratedImageRequest,
  SaveGeneratedImageResult,
  ToolImageAttachment
} from '../../shared/types'
import { loadChatSession, updateToolResultInHistory } from '../history'
import { broadcastIpc } from '../safeSend'
import { executeValidatedTool } from '../toolRuntime'
import {
  canRetryImageGenerationResult,
  detectImageMimeType,
  IMAGE_GENERATION_MIME_TYPES,
  isStrictBase64,
  sanitizeGeneratedImageFilename,
  type ImageGenerationMimeType
} from './imageGenerationCore'

const MAX_SAVE_BYTES = 10 * 1024 * 1024
const retryControllers = new Map<string, Map<string, AbortController>>()

function registerRetry(chatId: string, callId: string): AbortController {
  let chatControllers = retryControllers.get(chatId)
  if (!chatControllers) {
    chatControllers = new Map()
    retryControllers.set(chatId, chatControllers)
  }
  chatControllers.get(callId)?.abort()
  const controller = new AbortController()
  chatControllers.set(callId, controller)
  return controller
}

function unregisterRetry(chatId: string, callId: string, controller: AbortController): void {
  const chatControllers = retryControllers.get(chatId)
  if (chatControllers?.get(callId) !== controller) return
  chatControllers.delete(callId)
  if (chatControllers.size === 0) retryControllers.delete(chatId)
}

export function cancelImageGenerationRetries(chatId?: string): void {
  if (chatId) {
    for (const controller of retryControllers.get(chatId)?.values() || []) controller.abort()
    retryControllers.delete(chatId)
    return
  }
  for (const controllers of retryControllers.values()) {
    for (const controller of controllers.values()) controller.abort()
  }
  retryControllers.clear()
}

export function startImageGenerationRetry(request: RetryImageGenerationRequest): {
  started: boolean
  error?: string
} {
  const chatId = typeof request?.chatId === 'string' ? request.chatId.trim() : ''
  const callId = typeof request?.callId === 'string' ? request.callId.trim() : ''
  if (!chatId || !callId) {
    return { started: false, error: 'Invalid image retry request.' }
  }
  const session = loadChatSession(chatId)
  const toolMessage = session?.messages.find(
    (message) =>
      message.role === 'tool' &&
      message.name === 'generate_image' &&
      message.tool_call_id === callId
  )
  const storedArgs = toolMessage?.tool_metadata?.validatedArguments
  const storedResult = toolMessage?.tool_metadata?.result
  if (!storedArgs || !canRetryImageGenerationResult(storedResult)) {
    return { started: false, error: 'This image generation cannot be retried safely.' }
  }
  const controller = registerRetry(chatId, callId)
  broadcastIpc('chat-tool-start', {
    callId,
    name: 'generate_image',
    args: storedArgs,
    timestamp: Date.now(),
    chatId
  })

  void executeValidatedTool('generate_image', storedArgs, {
    signal: controller.signal,
    chatId
  })
    .then((execution) => {
      updateToolResultInHistory(
        chatId,
        callId,
        execution.modelContent,
        execution.attachments as ToolImageAttachment[] | undefined,
        execution.args,
        execution.envelope
      )
      broadcastIpc('chat-tool-end', {
        callId,
        name: 'generate_image',
        result: execution.modelContent,
        attachments: execution.attachments,
        chatId
      })
    })
    .catch((error) => {
      const result = JSON.stringify({
        ok: false,
        error: {
          code: controller.signal.aborted ? 'IMAGE_CANCELLED' : 'IMAGE_PROVIDER',
          message: controller.signal.aborted
            ? 'Image generation was cancelled.'
            : 'Image generation failed unexpectedly.',
          details: error instanceof Error ? error.message.slice(0, 300) : undefined,
          retryable: !controller.signal.aborted
        }
      })
      broadcastIpc('chat-tool-end', { callId, name: 'generate_image', result, chatId })
    })
    .finally(() => unregisterRetry(chatId, callId, controller))

  return { started: true }
}

export async function saveGeneratedImage(
  request: SaveGeneratedImageRequest
): Promise<SaveGeneratedImageResult> {
  const mimeType = request?.mimeType?.toLowerCase() as ImageGenerationMimeType
  if (!IMAGE_GENERATION_MIME_TYPES.includes(mimeType) || !isStrictBase64(request?.data || '')) {
    return { saved: false, error: 'Invalid generated image data.' }
  }
  const bytes = Buffer.from(request.data.replace(/\s/g, ''), 'base64')
  if (
    bytes.length === 0 ||
    bytes.length > MAX_SAVE_BYTES ||
    detectImageMimeType(bytes) !== mimeType
  ) {
    return { saved: false, error: 'Invalid or oversized generated image.' }
  }

  const filename = sanitizeGeneratedImageFilename(request.suggestedName || '', mimeType)
  const result = await dialog.showSaveDialog({
    title: 'Save Generated Image',
    defaultPath: path.join(app.getPath('pictures'), filename),
    filters: [
      {
        name:
          mimeType === 'image/jpeg'
            ? 'JPEG image'
            : mimeType === 'image/webp'
              ? 'WebP image'
              : 'PNG image',
        extensions: [filename.split('.').pop() || 'png']
      }
    ]
  })
  if (result.canceled || !result.filePath) return { saved: false }
  try {
    await fs.writeFile(result.filePath, bytes, { flag: 'w', mode: 0o600 })
    return { saved: true, path: result.filePath }
  } catch (error) {
    return {
      saved: false,
      error: error instanceof Error ? error.message : 'Could not save the image.'
    }
  }
}
