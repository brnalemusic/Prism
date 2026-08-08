export interface ToolImageAttachment {
  kind: 'image'
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  data: string
  width?: number
  height?: number
  byteLength?: number
}

export type ToolAttachment = ToolImageAttachment

export interface ToolImageReference {
  kind: 'image'
  id: string
  mimeType: ToolImageAttachment['mimeType']
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

export function imageAttachments(
  attachments?: ToolAttachment[]
): ToolImageAttachment[] {
  return (attachments || []).filter(
    (attachment): attachment is ToolImageAttachment => attachment.kind === 'image'
  )
}
