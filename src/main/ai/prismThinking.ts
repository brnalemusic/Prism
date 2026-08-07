import { ProviderConfig } from '../../shared/types'
import { PrismThinkingLevel } from './types'

const prismThinkingLevels = new Set<PrismThinkingLevel>(['minimal', 'low', 'medium', 'high'])

const prismCloudThinkingCapabilities = new Map<string, ReadonlySet<PrismThinkingLevel>>([
  ['gemini-3.1-flash-lite', prismThinkingLevels],
  ['gemini-3-flash-preview', prismThinkingLevels]
])

export function isPrismCloudProvider(provider: ProviderConfig): boolean {
  return provider.id === 'prism_provider'
}

export function normalizePrismThinkingLevel(
  provider: ProviderConfig,
  modelId: string,
  requestedLevel?: string
): PrismThinkingLevel | undefined {
  if (!isPrismCloudProvider(provider)) return undefined

  const cleanModelId = modelId.replace(/^models\//, '')
  const supportedLevels = prismCloudThinkingCapabilities.get(cleanModelId)
  if (!supportedLevels) return undefined

  if (requestedLevel && supportedLevels.has(requestedLevel as PrismThinkingLevel)) {
    return requestedLevel as PrismThinkingLevel
  }

  return 'minimal'
}
