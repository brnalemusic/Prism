import type { ProviderProfile } from '../domain/types'

export function findProvider(
  providers: ProviderProfile[],
  providerId?: string | null
): ProviderProfile | undefined {
  return providers.find((provider) => provider.id === providerId) ?? providers[0]
}

export function modelLabel(
  providers: ProviderProfile[],
  providerId?: string | null,
  modelId?: string | null
): string {
  const provider = findProvider(providers, providerId)
  if (!provider) return 'No model'
  const model = provider.models.find((candidate) => candidate.id === modelId)
  return model?.label ?? modelId ?? provider.models[0]?.label ?? 'No model'
}

export function providerLabel(providers: ProviderProfile[], providerId?: string | null): string {
  return findProvider(providers, providerId)?.name ?? 'No provider'
}

export function defaultTarget(
  providers: ProviderProfile[],
  defaultProviderId: string | null,
  defaultModelId: string | null
): { providerId: string; modelId: string } | null {
  const provider = findProvider(providers, defaultProviderId)
  if (!provider) return null
  const modelId =
    provider.models.find((model) => model.id === defaultModelId)?.id ?? provider.models[0]?.id ?? ''
  if (!modelId) return null
  return { providerId: provider.id, modelId }
}
