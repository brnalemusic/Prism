import { ProviderConfig, ProviderModel, CompletionType } from '../../shared/types'
import { loadConfig, saveConfig } from '../config'
import { isUserAuthenticated } from '../supabaseAuth'
import {
  isModelTrusted,
  normalizeBaseUrl,
  isGoogleHost,
  isAnthropicHost
} from './trustedRegistry'

export interface FetchModelsResult {
  success: boolean
  models: ProviderModel[]
  error?: string
}

export async function fetchModelsFromProvider(
  baseUrl: string,
  apiKey: string,
  completionType: CompletionType
): Promise<FetchModelsResult> {
  const normUrl = normalizeBaseUrl(baseUrl)
  if (!normUrl) {
    return { success: false, models: [], error: 'Base URL is required' }
  }

  const isGoogle = isGoogleHost(normUrl)
  const endpoint = isGoogle ? `${normUrl}/openai/models` : `${normUrl}/models`

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

    const data = (await response.json()) as any
    let modelList: string[] = []

    if (Array.isArray(data.data)) {
      modelList = data.data.map((m: any) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean)
    } else if (Array.isArray(data.models)) {
      modelList = data.models.map((m: any) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean)
    } else if (Array.isArray(data)) {
      modelList = data.map((m: any) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean)
    }

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
  } catch (error: any) {
    return { success: false, models: [], error: error.message || 'Failed to connect to endpoint' }
  }
}

export const PRISM_PROVIDER_ID = 'prism_provider'

export const PRISM_PROVIDER: ProviderConfig = {
  id: PRISM_PROVIDER_ID,
  name: 'Prism Provider',
  baseUrl: 'https://jfqyqkkdmoqdpejzxdhd.supabase.co/functions/v1/prism-ai-proxy',
  apiKey: 'prism_account_auth',
  completionType: 'chat_completions',
  isTrusted: true,
  isOfficial: true,
  models: [
    { id: 'gemini-3.1-flash-lite', name: 'gemini-3.1-flash-lite', enabled: true, isTrusted: true },
    { id: 'gemini-3-flash', name: 'gemini-3-flash', enabled: true, isTrusted: true }
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
      completionType: p?.completionType || 'chat_completions',
      isTrusted: !!p?.isTrusted,
      isOfficial: !!p?.isOfficial,
      models: Array.isArray(p?.models) ? p.models : []
    }))

  if (isUserAuthenticated()) {
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
}> {
  const providers = getAllProviders()
  const result: Array<{
    providerId: string
    providerName: string
    isProviderTrusted: boolean
    model: ProviderModel
    fullKey: string
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
          fullKey: `${p.id}:${m.id}`
        })
      }
    }
  }

  return result
}

export function resolveProviderAndModel(fullKey?: string): {
  provider: ProviderConfig | null
  model: ProviderModel | null
} {
  const providers = getAllProviders()
  if (!providers.length) return { provider: null, model: null }

  if (fullKey) {
    // Check if fullKey is in providerId:modelId format
    if (fullKey.includes(':')) {
      const [pid, ...mParts] = fullKey.split(':')
      const mid = mParts.join(':')
      const provider = providers.find((p) => p.id === pid)
      if (provider) {
        const model = provider.models.find((m) => m.id === mid)
        if (model) return { provider, model }
      }
    }

    // Direct model ID match across enabled models
    for (const p of providers) {
      const m = p.models.find((mod) => mod.enabled && (mod.id === fullKey || mod.name === fullKey))
      if (m) return { provider: p, model: m }
    }
  }

  // Fallback: Return first enabled model in any provider
  for (const p of providers) {
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
  config.providers = (providers || []).filter((p) => p && p.id !== PRISM_PROVIDER_ID)
  config.userGeminiKey = ''
  config.userNvidiaNimKey = ''
  config.userOpenaiKey = ''
  return saveConfig(config)
}

export function deleteProvider(providerId: string): boolean {
  const config = loadConfig()
  const currentProviders = Array.isArray(config.providers) ? config.providers : []

  const target = currentProviders.find((p) => p && p.id === providerId)
  const targetName = target?.name?.toLowerCase() || ''
  const targetBaseUrl = target?.baseUrl?.toLowerCase() || ''

  const updatedProviders = currentProviders.filter((p) => {
    if (!p) return false
    if (p.id === providerId) return false

    // Supreme deletion: match target by ID, name, or endpoint (especially Google AI Studio / Gemini)
    if (
      providerId === 'google-gemini' ||
      targetName.includes('google') ||
      targetBaseUrl.includes('googleapis')
    ) {
      if (
        p.id === 'google-gemini' ||
        p.name?.toLowerCase().includes('google') ||
        p.baseUrl?.toLowerCase().includes('googleapis')
      ) {
        return false
      }
    }

    if (
      providerId === 'openai' ||
      targetName.includes('openai') ||
      targetBaseUrl.includes('api.openai.com')
    ) {
      if (
        p.id === 'openai' ||
        p.name?.toLowerCase().includes('openai') ||
        p.baseUrl?.toLowerCase().includes('api.openai.com')
      ) {
        return false
      }
    }

    if (
      providerId === 'nvidia-nim' ||
      targetName.includes('nvidia') ||
      targetBaseUrl.includes('nvidia.com')
    ) {
      if (
        p.id === 'nvidia-nim' ||
        p.name?.toLowerCase().includes('nvidia') ||
        p.baseUrl?.toLowerCase().includes('nvidia.com')
      ) {
        return false
      }
    }

    return true
  })

  return saveProviders(updatedProviders)
}
