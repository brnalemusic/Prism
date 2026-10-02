import type { ToolAttachment, ToolImageAttachment } from '../shared/types'

export type { ToolAttachment, ToolImageAttachment } from '../shared/types'

export interface ToolImageReference {
  kind: 'image'
  id: string
  mimeType: ToolImageAttachment['mimeType']
  name?: string
  sha256?: string
  width?: number
  height?: number
  byteLength?: number
}

export interface SystemToolResult {
  output: string
  attachments?: ToolAttachment[]
}

export type SystemToolOutput = string | SystemToolResult

export function asDataUrl(attachment: ToolImageAttachment): string {
  return `data:${attachment.mimeType};base64,${attachment.data}`
}

export function imageAssetReference(
  attachment: Pick<ToolImageAttachment, 'assetId'>
): string | null {
  return attachment.assetId ? `prism-image://asset/${attachment.assetId}` : null
}

export function imageAttachments(attachments?: ToolAttachment[]): ToolImageAttachment[] {
  return (attachments || []).filter(
    (attachment): attachment is ToolImageAttachment => attachment.kind === 'image'
  )
}
