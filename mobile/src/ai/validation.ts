import type { ProviderDraft } from '../domain/types'
import { isLoopbackHost, normalizeBaseUrl } from './request'

export interface ProviderDraftErrors {
  name?: string
  baseUrl?: string
  models?: string
  apiKey?: string
}

export function providerNeedsKey(protocol: ProviderDraft['protocol'], baseUrl: string): boolean {
  if (protocol === 'gemini') return true
  if (!baseUrl.trim()) return true
  return !isLoopbackHost(baseUrl)
}

export function validateProviderDraft(
  draft: ProviderDraft,
  options: { hasStoredKey: boolean }
): ProviderDraftErrors {
  const errors: ProviderDraftErrors = {}

  if (!draft.name.trim()) errors.name = 'Give this provider a name.'

  try {
    normalizeBaseUrl(draft.baseUrl)
  } catch (error) {
    errors.baseUrl = error instanceof Error ? error.message : 'Enter a valid base URL.'
  }

  const models = draft.models.filter((model) => model.id.trim().length > 0)
  if (models.length === 0) errors.models = 'Add at least one model id.'

  const incomingKey = draft.apiKey?.trim() ?? ''
  if (
    !errors.baseUrl &&
    providerNeedsKey(draft.protocol, draft.baseUrl) &&
    !incomingKey &&
    !options.hasStoredKey
  ) {
    errors.apiKey = 'Paste the API key for this provider.'
  }

  return errors
}

export function parseModelList(raw: string): { id: string; label: string }[] {
  const seen = new Set<string>()
  const models: { id: string; label: string }[] = []
  for (const entry of raw.split(/[\n,]/)) {
    const id = entry.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    models.push({ id, label: id })
  }
  return models
}

export function formatModelList(models: { id: string }[]): string {
  return models.map((model) => model.id).join('\n')
}
