import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowClockwise,
  ArrowsOutSimple,
  DownloadSimple,
  WarningCircle
} from '@phosphor-icons/react'
import type { ToolImageAttachment } from '../../../shared/types'
import type { ToolCallItem } from '../types/tab'
import { deriveImageGenerationLifecycle } from '../imageGenerationState'
import { FluidGenerationPlaceholder } from './FluidGenerationPlaceholder'
import { GeneratedImageViewer } from './GeneratedImageViewer'

interface GeneratedImageCardProps {
  toolCall: ToolCallItem
  chatId: string
}

interface ParsedToolError {
  message: string
  retryable: boolean
}

function parseToolError(result?: string): ParsedToolError | null {
  if (!result) return null
  try {
    const parsed = JSON.parse(result)
    if (parsed?.ok === false && parsed.error) {
      return {
        message:
          typeof parsed.error.message === 'string'
            ? parsed.error.message
            : "Couldn't generate image",
        retryable: parsed.error.retryable === true
      }
    }
  } catch {
    if (/^Error(?:\s|:)/i.test(result)) return { message: result, retryable: true }
  }
  return null
}

function requestedAspectRatio(size: unknown): number {
  if (typeof size !== 'string') return 1
  const match = size.match(/^(\d+)x(\d+)$/)
  if (!match) return 1
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? width / height : 1
}

function requestedCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? Math.min(4, Math.max(1, value)) : 1
}

function imageDataUrl(attachment: ToolImageAttachment): string {
  return `data:${attachment.mimeType};base64,${attachment.data}`
}

export function GeneratedImageCard({
  toolCall,
  chatId
}: GeneratedImageCardProps): React.JSX.Element {
  const prompt = typeof toolCall.args.prompt === 'string' ? toolCall.args.prompt.trim() : ''
  const expectedCount = requestedCount(toolCall.args.n)
  const aspectRatio = requestedAspectRatio(toolCall.args.size)
  const maximumInlineWidth =
    expectedCount > 1 ? 540 : aspectRatio < 0.85 ? 340 : aspectRatio > 1.25 ? 480 : 410
  const attachments = useMemo(
    () =>
      (toolCall.attachments || []).filter(
        (attachment): attachment is ToolImageAttachment => attachment.kind === 'image'
      ),
    [toolCall.attachments]
  )
  const attachmentSignature = attachments
    .map(
      (attachment) =>
        `${attachment.mimeType}:${attachment.byteLength || attachment.data.length}:${attachment.data.slice(0, 24)}:${attachment.data.slice(-24)}`
    )
    .join('|')
  const [decodeState, setDecodeState] = useState<{
    signature: string
    status: 'completed' | 'error'
  }>({ signature: '', status: 'completed' })
  const [viewerAttachment, setViewerAttachment] = useState<ToolImageAttachment | null>(null)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (attachments.length === 0) return
    let active = true
    Promise.all(
      attachments.map(
        (attachment) =>
          new Promise<void>((resolve, reject) => {
            const image = new window.Image()
            image.onload = () => resolve()
            image.onerror = () => reject(new Error('decode'))
            image.src = imageDataUrl(attachment)
            if (typeof image.decode === 'function')
              image
                .decode()
                .then(resolve)
                .catch(() => {})
          })
      )
    )
      .then(() => {
        if (active) setDecodeState({ signature: attachmentSignature, status: 'completed' })
      })
      .catch(() => {
        if (active) setDecodeState({ signature: attachmentSignature, status: 'error' })
      })
    return () => {
      active = false
    }
  }, [attachmentSignature, attachments])

  const handleDownload = useCallback(async (attachment: ToolImageAttachment): Promise<void> => {
    try {
      setActionError('')
      const result = await window.api.saveGeneratedImage({ ...attachment })
      if (!result.saved && result.error) setActionError(result.error)
    } catch {
      setActionError('Could not open the image save dialog.')
    }
  }, [])

  const handleRetry = async (): Promise<void> => {
    if (!toolCall.id) return
    try {
      setActionError('')
      const result = await window.api.retryImageGeneration({
        chatId,
        callId: toolCall.id
      })
      if (!result.started) setActionError(result.error || 'Could not retry image generation.')
    } catch {
      setActionError('Could not retry image generation.')
    }
  }

  const parsedError = parseToolError(toolCall.result)
  const decoded =
    attachments.length > 0 &&
    decodeState.signature === attachmentSignature &&
    decodeState.status === 'completed'
  const decodeFailed =
    attachments.length > 0 &&
    decodeState.signature === attachmentSignature &&
    decodeState.status === 'error'
  const lifecycle = deriveImageGenerationLifecycle({
    toolStatus: toolCall.status,
    attachmentCount: attachments.length,
    decoded,
    decodeFailed
  })
  const isGenerating = lifecycle === 'generating'
  const isCancelled = lifecycle === 'cancelled'
  const isLoadingImage = lifecycle === 'loading-image'
  const hasCompletedImages = lifecycle === 'completed'
  const showError = lifecycle === 'error'
  const retryable = decodeFailed || parsedError?.retryable === true
  const surfaces: Array<ToolImageAttachment | null> = hasCompletedImages
    ? Array.from(
        { length: Math.max(expectedCount, attachments.length) },
        (_, index) => attachments[index] || null
      )
    : Array.from({ length: expectedCount }, () => null)

  return (
    <div
      className="generated-image-card"
      style={{ maxWidth: maximumInlineWidth }}
      aria-label="AI generated image result"
    >
      <div
        className={`generated-image-grid ${expectedCount > 1 || attachments.length > 1 ? 'is-gallery' : ''}`}
      >
        {surfaces.map((entry, index) => {
          const attachment = entry
          return (
            <div
              key={attachment ? `${attachmentSignature}-${index}` : `placeholder-${index}`}
              className="generated-image-surface"
              style={{ aspectRatio }}
            >
              {(isGenerating || isLoadingImage) && <FluidGenerationPlaceholder />}
              {isCancelled && <FluidGenerationPlaceholder cancelled />}
              {showError && (
                <div className="generated-image-error" role="alert">
                  <WarningCircle size={23} weight="duotone" />
                  <strong>Couldn&apos;t generate image</strong>
                  <span>
                    {decodeFailed
                      ? 'The generated image could not be decoded.'
                      : parsedError?.message || 'The provider could not complete the request.'}
                  </span>
                  {retryable && toolCall.id && (
                    <button type="button" onClick={handleRetry} aria-label="Retry image generation">
                      <ArrowClockwise size={15} />
                      Retry
                    </button>
                  )}
                </div>
              )}
              {attachment && hasCompletedImages && (
                <>
                  <button
                    type="button"
                    className="generated-image-open"
                    onClick={() => setViewerAttachment(attachment)}
                    aria-label={`Open generated image fullscreen${prompt ? `: ${prompt}` : ''}`}
                  >
                    <img
                      src={imageDataUrl(attachment)}
                      alt={prompt ? `Generated image: ${prompt}` : 'AI-generated image'}
                      width={attachment.width}
                      height={attachment.height}
                      draggable={false}
                    />
                  </button>
                  <div className="generated-image-actions">
                    <button
                      type="button"
                      onClick={() => setViewerAttachment(attachment)}
                      aria-label="Open generated image fullscreen"
                      title="Open fullscreen"
                    >
                      <ArrowsOutSimple size={17} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownload(attachment)}
                      aria-label="Download generated image"
                      title="Download image"
                    >
                      <DownloadSimple size={17} />
                    </button>
                  </div>
                </>
              )}
              {!attachment && hasCompletedImages && (
                <div className="generated-image-error" role="status">
                  <WarningCircle size={23} weight="duotone" />
                  <strong>Image unavailable</strong>
                  <span>The provider returned fewer images than requested.</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {actionError && <span className="generated-image-action-error">{actionError}</span>}

      {viewerAttachment && (
        <GeneratedImageViewer
          attachment={viewerAttachment}
          alt={prompt ? `Generated image: ${prompt}` : 'AI-generated image'}
          onClose={() => setViewerAttachment(null)}
          onDownload={(attachment) => void handleDownload(attachment)}
        />
      )}
    </div>
  )
}
