import { createHash } from 'crypto'
import type { ToolImageAttachment } from './toolAttachments'

const IMAGE_ASSET_ID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const IMAGE_ASSET_REFERENCE_PATTERN = /^prism-image:\/\/asset\/([a-f0-9-]{36})$/i

export function isImageAssetId(value: string): boolean {
  return IMAGE_ASSET_ID_PATTERN.test(value)
}

export function formatImageAssetReference(assetId: string): string {
  if (!isImageAssetId(assetId)) throw new Error('Invalid Prism image asset ID.')
  return `prism-image://asset/${assetId}`
}

export function parseImageAssetReference(reference: string): string | null {
  const match = reference.trim().match(IMAGE_ASSET_REFERENCE_PATTERN)
  return match && isImageAssetId(match[1]) ? match[1].toLowerCase() : null
}

export function imageAttachmentDigest(attachment: Pick<ToolImageAttachment, 'data'>): string {
  return createHash('sha256')
    .update(Buffer.from(attachment.data.replace(/\s/g, ''), 'base64'))
    .digest('hex')
}

export function dedupeImageAttachments(
  attachments: ToolImageAttachment[],
  seenDigests = new Set<string>()
): ToolImageAttachment[] {
  return attachments.filter((attachment) => {
    const digest = imageAttachmentDigest(attachment)
    if (seenDigests.has(digest)) return false
    seenDigests.add(digest)
    return true
  })
}
