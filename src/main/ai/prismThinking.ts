import { ProviderConfig } from '../../shared/types'
import { PrismThinkingLevel } from './types'

const prismThinkingLevels = new Set<PrismThinkingLevel>(['minimal', 'low', 'medium', 'high'])

const prismCloudThinkingCapabilities = new Map<string, ReadonlySet<PrismThinkingLevel>>([
  ['prism-ai/arcadia-1.0-mini', prismThinkingLevels],
  ['prism-ai/arcadia-1.0-flash', prismThinkingLevels],
  ['prism-ai/arcadia-1.0-pro', prismThinkingLevels],
  ['prism-ai/arcadia-1.1-flash', prismThinkingLevels],
  ['arcadia-1.0-mini', prismThinkingLevels],
  ['arcadia-1.0-flash', prismThinkingLevels],
  ['arcadia-1.0-pro', prismThinkingLevels],
  ['arcadia-1.1-flash', prismThinkingLevels]
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
