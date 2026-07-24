import { ProviderConfig, ProviderModel, CompletionType } from '../../shared/types'
import { loadConfig, saveConfig } from '../config'
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

export function getAllProviders(): ProviderConfig[] {
  const config = loadConfig()
  const rawProviders = Array.isArray(config.providers) ? config.providers : []
  return rawProviders.map((p) => ({
    id: p?.id || `provider_${Math.random()}`,
    name: p?.name || 'Unnamed Provider',
    baseUrl: p?.baseUrl || '',
    apiKey: p?.apiKey || '',
    completionType: p?.completionType || 'chat_completions',
    isTrusted: !!p?.isTrusted,
    models: Array.isArray(p?.models) ? p.models : []
  }))
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
  config.providers = providers
  return saveConfig(config)
}
