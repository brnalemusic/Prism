export type ImageGenerationLifecycle =
  | 'idle'
  | 'generating'
  | 'loading-image'
  | 'completed'
  | 'error'
  | 'cancelled'

export interface ImageGenerationLifecycleInput {
  toolStatus: string
  attachmentCount: number
  decoded: boolean
  decodeFailed: boolean
}

export function deriveImageGenerationLifecycle({
  toolStatus,
  attachmentCount,
  decoded,
  decodeFailed
}: ImageGenerationLifecycleInput): ImageGenerationLifecycle {
  if (toolStatus === 'cancelled') return 'cancelled'
  if (toolStatus === 'error' || decodeFailed) return 'error'
  if (toolStatus === 'writing' || toolStatus === 'running') return 'generating'
  if (toolStatus === 'done' && attachmentCount > 0) {
    return decoded ? 'completed' : 'loading-image'
  }
  if (toolStatus === 'done') return 'error'
  return 'idle'
}
