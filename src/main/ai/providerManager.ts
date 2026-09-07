import { ProviderConfig, ProviderModel, CompletionType } from '../../shared/types'
import { loadConfig, saveConfig } from '../config'
import { isUserAuthenticated, isUserEmailVerifiedSync } from '../supabaseAuth'
import {
  isModelTrusted,
  normalizeBaseUrl,
  isGoogleHost,
  isAnthropicHost,
  isPuterHost
} from './trustedRegistry'
import { fetchPuterModels, fetchPuterModelsViaSDK } from './puterClient'
import {
  imageGenerationRouteFingerprint,
  resolveExactImageRouteFromProviders,
  type ImageGenerationOperation,
  type ImageGenerationCapabilityState
} from './imageGenerationCore'
import type { ImageGenerationAdapter } from '../../shared/types'
import type { ImageGenerationCapabilities } from '../../shared/types'

export interface FetchModelsResult {
  success: boolean
  models: ProviderModel[]
  error?: string
}

export function providerHasCompletionCredential(
  provider: Pick<ProviderConfig, 'completionType' | 'apiKey' | 'puterAuthToken'>
): boolean {
  return provider.completionType === 'puter_native'
    ? Boolean(provider.puterAuthToken?.trim())
    : Boolean(provider.apiKey?.trim())
}

function getModelId(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  if (typeof record.id === 'string') return record.id
  if (typeof record.name === 'string') return record.name
  return undefined
}

function getModelList(payload: unknown): string[] {
  let entries: unknown[] = []

  if (Array.isArray(payload)) {
    entries = payload
  } else if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.data)) entries = record.data
    else if (Array.isArray(record.models)) entries = record.models
  }

  return entries.map(getModelId).filter((id): id is string => Boolean(id))
}

export async function fetchModelsFromProvider(
  baseUrl: string,
  apiKey: string,
  completionType: CompletionType,
  puterAuthToken?: string
): Promise<FetchModelsResult> {
  const normUrl = normalizeBaseUrl(baseUrl)
  if (!normUrl) {
    return { success: false, models: [], error: 'Base URL is required' }
  }

  const isGoogle = isGoogleHost(normUrl)
  const isPuter = isPuterHost(normUrl)

  if (isPuter) {
    if (completionType === 'puter_native') {
      const puterSdkRes = await fetchPuterModelsViaSDK(puterAuthToken || undefined)
      if (puterSdkRes.success && puterSdkRes.models.length > 0) {
        return puterSdkRes
      }
      if (!puterSdkRes.success) {
        return puterSdkRes
      }
    } else {
      const puterRes = await fetchPuterModels(apiKey || undefined)
      if (puterRes.success && puterRes.models.length > 0) {
        return puterRes
      }
    }
  }

  const googleBaseUrl = normUrl.replace(/\/openai$/, '')

  if (isGoogle) {
    const baseModelsUrl = googleBaseUrl.replace(/\/+$/, '').replace(/\/models\/?$/i, '') + '/models'
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (apiKey?.trim()) {
      headers['x-goog-api-key'] = apiKey.trim()
    }

    try {
      const allModelIds: string[] = []
      let pageToken: string | undefined = undefined
      const maxPages = 10

      for (let page = 0; page < maxPages; page++) {
        const url = new URL(baseModelsUrl)
        url.searchParams.set('pageSize', '1000')
        if (pageToken) {
          url.searchParams.set('pageToken', pageToken)
        }

        const response = await fetch(url.toString(), {
          method: 'GET',
          headers
        })

        if (!response.ok) {
          const errText = await response.text().catch(() => '')
          return {
            success: false,
            models: [],
            error: `HTTP ${response.status}: ${errText || response.statusText}`
          }
        }

        const data: unknown = await response.json()
        const pageModels = getModelList(data)
        allModelIds.push(...pageModels)

        const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
        if (record && typeof record.nextPageToken === 'string' && record.nextPageToken.trim()) {
          pageToken = record.nextPageToken.trim()
        } else {
          break
        }
      }

      const uniqueModelIds = Array.from(
        new Set(
          allModelIds
            .map((id) => (id.startsWith('models/') ? id.slice(7) : id).trim())
            .filter((id) => id.length > 0)
        )
      )

      const models: ProviderModel[] = uniqueModelIds.map((id) => {
        const trusted = isModelTrusted(id)
        return {
          id,
          name: id,
          isTrusted: trusted,
          enabled: trusted
        }
      })

      return { success: true, models }
    } catch (error: unknown) {
      return {
        success: false,
        models: [],
        error: error instanceof Error ? error.message : 'Failed to connect to endpoint'
      }
    }
  }

  const endpoint = isPuter
    ? 'https://api.puter.com/puterai/chat/models/details'
    : `${normUrl}/models`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (completionType === 'anthropic_messages' || isAnthropicHost(normUrl)) {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return {
        success: false,
        models: [],
        error: `HTTP ${response.status}: ${errText || response.statusText}`
      }
    }

    const data: unknown = await response.json()
    let modelList = getModelList(data)

    modelList = modelList.map((id) => (id.startsWith('models/') ? id.slice(7) : id))

    const models: ProviderModel[] = modelList.map((id) => {
      const trusted = isModelTrusted(id)
      return {
        id,
        name: id,
        isTrusted: trusted,
        enabled: trusted // trusted models enabled by default, others disabled
      }
    })

    return { success: true, models }
  } catch (error: unknown) {
    return {
      success: false,
      models: [],
      error: error instanceof Error ? error.message : 'Failed to connect to endpoint'
    }
  }
}

export const PRISM_PROVIDER_ID = 'prism_provider'

export const PRISM_PROVIDER: ProviderConfig = {
  id: PRISM_PROVIDER_ID,
  name: 'Prism Cloud',
  baseUrl: 'https://jfqyqkkdmoqdpejzxdhd.supabase.co/functions/v1/prism-ai-proxy',
  apiKey: 'prism_account_auth',
  completionType: 'gemini_native',
  isTrusted: true,
  isOfficial: true,
  models: [
    { id: 'prism-ai/arcadia-1.0-mini', name: 'Arcadia-1.0 Mini', enabled: true, isTrusted: true },
    { id: 'prism-ai/arcadia-1.0-flash', name: 'Arcadia-1.0 Flash', enabled: true, isTrusted: true },
    { id: 'prism-ai/arcadia-1.0-pro', name: 'Arcadia-1.0 Pro', enabled: true, isTrusted: true },
    { id: 'prism-ai/arcadia-1.1-flash', name: 'Arcadia-1.1 Flash', enabled: true, isTrusted: true }
  ]
}

export function getAllProviders(): ProviderConfig[] {
  const config = loadConfig()
  const rawProviders = Array.isArray(config.providers) ? config.providers : []
  const providers: ProviderConfig[] = rawProviders
    .filter((p) => p && p.id !== PRISM_PROVIDER_ID)
    .map((p) => ({
      id: p?.id || `provider_${Math.random()}`,
      name: p?.name || 'Unnamed Provider',
      baseUrl: p?.baseUrl || '',
      apiKey: p?.apiKey || '',
      puterAuthToken: p?.puterAuthToken || '',
      completionType: isGoogleHost(p?.baseUrl || '')
        ? 'gemini_native'
        : p?.completionType || 'chat_completions',
      isTrusted: !!p?.isTrusted,
      isOfficial: !!p?.isOfficial,
      models: Array.isArray(p?.models) ? p.models : []
    }))

  // Prism Cloud is ONLY accessible to users with a VERIFIED email address
  if (isUserAuthenticated() && isUserEmailVerifiedSync()) {
    providers.unshift(PRISM_PROVIDER)
  }
  return providers
}

export function getActiveModels(): Array<{
  providerId: string
  providerName: string
  isProviderTrusted: boolean
  model: ProviderModel
  fullKey: string // format: providerId:modelId
  completionType: CompletionType
}> {
  const providers = getAllProviders()
  const result: Array<{
    providerId: string
    providerName: string
    isProviderTrusted: boolean
    model: ProviderModel
    fullKey: string
    completionType: CompletionType
  }> = []

  for (const p of providers) {
    const modelsList = Array.isArray(p.models) ? p.models : []
    for (const m of modelsList) {
      if (m && m.enabled) {
        result.push({
          providerId: p.id,
          providerName: p.name,
          isProviderTrusted: p.isTrusted,
          model: m,
          fullKey: `${p.id}:${m.id}`,
          completionType: p.completionType
        })
      }
    }
  }

  return result
}

export function resolveExactProviderAndModel(fullKey?: string): {
  provider: ProviderConfig | null
  model: ProviderModel | null
} {
  return resolveExactImageRouteFromProviders(getAllProviders(), fullKey)
}

export function resolveProviderAndModel(fullKey?: string): {
  provider: ProviderConfig | null
  model: ProviderModel | null
} {
  const providers = getAllProviders()
  if (!providers.length) return { provider: null, model: null }

  if (fullKey) {
    // 1. Exact match with providerId:modelId
    if (fullKey.includes(':')) {
      const [pid, ...mParts] = fullKey.split(':')
      const mid = mParts.join(':')
      const provider = providers.find((p) => p.id === pid)
      if (provider) {
        const model = provider.models.find((m) => m.id === mid)
        if (model) return { provider, model }
      }
    }

    // 2. Direct bare model ID match: check custom BYOK providers FIRST
    for (const p of providers.filter((p) => p.id !== PRISM_PROVIDER_ID)) {
      const m = p.models.find((mod) => mod.enabled && (mod.id === fullKey || mod.name === fullKey))
      if (m) return { provider: p, model: m }
    }

    // 3. Fallback check for Prism Cloud bare model ID match
    for (const p of providers.filter((p) => p.id === PRISM_PROVIDER_ID)) {
      const m = p.models.find((mod) => mod.enabled && (mod.id === fullKey || mod.name === fullKey))
      if (m) return { provider: p, model: m }
    }
  }

  // 4. Default fallback: Prefer enabled model in custom BYOK providers first
  for (const p of providers.filter((p) => p.id !== PRISM_PROVIDER_ID)) {
    const m = p.models.find((mod) => mod.enabled)
    if (m) return { provider: p, model: m }
  }

  // 5. Fallback to enabled model in Prism Cloud
  for (const p of providers.filter((p) => p.id === PRISM_PROVIDER_ID)) {
    const m = p.models.find((mod) => mod.enabled)
    if (m) return { provider: p, model: m }
  }

  // Final fallback: return first model of first provider
  const p = providers[0]
  if (p && p.models.length) {
    return { provider: p, model: p.models[0] }
  }

  return { provider: p || null, model: null }
}

export function saveProviders(providers: ProviderConfig[]): boolean {
  const config = loadConfig()
  const previous = Array.isArray(config.providers) ? config.providers : []
  config.providers = (providers || [])
    .filter((p) => p && p.id !== PRISM_PROVIDER_ID)
    .map((provider) => {
      const oldProvider = previous.find((candidate) => candidate?.id === provider.id)
      const oldFingerprintByModel = new Map(
        oldProvider
          ? oldProvider.models.map((model) => [
              model.id,
              imageGenerationRouteFingerprint(oldProvider, model)
            ])
          : []
      )
      return {
        ...provider,
        models: (provider.models || []).map((model) => {
          const oldFingerprint = oldFingerprintByModel.get(model.id)
          const nextFingerprint = imageGenerationRouteFingerprint(provider, model)
          if (oldFingerprint && oldFingerprint !== nextFingerprint) {
            return { ...model, imageGeneration: undefined }
          }
          return model
        })
      }
    })
  config.userGeminiKey = ''
  config.userNvidiaNimKey = ''
  config.userOpenaiKey = ''
  return saveConfig(config)
}

export function saveImageGenerationCapability(
  routeKey: string,
  operation: ImageGenerationOperation,
  state: ImageGenerationCapabilityState,
  resolvedAdapter?: ImageGenerationAdapter
): boolean {
  const config = loadConfig()
  const providers = Array.isArray(config.providers) ? config.providers : []
  const { provider, model } = resolveExactImageRouteFromProviders(providers, routeKey)
  if (!provider || !model) return false
  const nextState = {
    ...state,
    routeFingerprint: imageGenerationRouteFingerprint(provider, model),
    ...(resolvedAdapter ? { adapter: resolvedAdapter } : {})
  }
  const updatedProviders = providers.map((candidate) => {
    if (candidate.id !== provider.id) return candidate
    return {
      ...candidate,
      models: candidate.models.map((candidateModel) => {
        if (candidateModel.id !== model.id) return candidateModel
        const current: Partial<ImageGenerationCapabilities> = candidateModel.imageGeneration || {}
        return {
          ...candidateModel,
          imageGeneration: {
            ...current,
            mode: 'automatic' as const,
            generate: current.generate || { status: 'unknown' as const },
            edit: current.edit || { status: 'unknown' as const },
            ...(resolvedAdapter ? { resolvedAdapter } : {}),
            [operation]: nextState
          }
        }
      })
    }
  })
  return saveConfig({ providers: updatedProviders }, config)
}

export function deleteProvider(providerId: string): boolean {
  const config = loadConfig()
  const currentProviders = Array.isArray(config.providers) ? config.providers : []
  return saveProviders(currentProviders.filter((provider) => provider?.id !== providerId))
}
