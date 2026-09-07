import type { TrustedProviderPreset } from '../../shared/types'

export interface TrustedProviderMeta extends TrustedProviderPreset {}

export const TRUSTED_PROVIDERS: TrustedProviderMeta[] = [
  {
    id: 'google-ai-studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    name: 'Google AI Studio',
    completionType: 'gemini_native'
  },
  {
    id: 'nvidia-nim',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    name: 'NVIDIA NIM',
    completionType: 'chat_completions'
  },
  {
    id: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    name: 'OpenAI GPT',
    completionType: 'chat_completions'
  },
  {
    id: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    name: 'Anthropic Claude',
    completionType: 'anthropic_messages'
  },
  {
    id: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    name: 'OpenRouter',
    completionType: 'chat_completions'
  },
  {
    id: 'groqcloud',
    baseUrl: 'https://api.groq.com/openai/v1',
    name: 'GroqCloud',
    completionType: 'chat_completions'
  },
  {
    id: 'cerebras-ai',
    baseUrl: 'https://api.cerebras.ai/v1',
    name: 'Cerebras AI',
    completionType: 'chat_completions'
  },
  {
    id: 'puter-js',
    baseUrl: 'https://api.puter.com/puterai/openai/v1',
    name: 'Puter.js',
    completionType: 'puter_native'
  }
]

export const TRUSTED_MODELS_LIST: string[] = [
  'arcadia-1.0-mini',
  'arcadia-1-0-mini',
  'arcadia-1.0-flash',
  'arcadia-1-0-flash',
  'arcadia-1.0-pro',
  'arcadia-1-0-pro',
  'gpt-6-astra',
  'gpt-5.6-sol',
  'gpt-5-6-sol',
  'gpt-5.6-terra',
  'gpt-5-6-terra',
  'gpt-5.6-luna',
  'gpt-5-6-luna',
  'claude-sonnet-5',
  'claude-opus-5',
  'claude-fable-5.1',
  'claude-fable-5-1',
  'claude-haiku-4.5',
  'claude-haiku-4-5',
  'claude-haiku-4.5-20251001',
  'claude-haiku-4-5-20251001',
  'qwen3.8-max-0902',
  'qwen3-8-max-0902',
  'qwen-3.8-max-0902',
  'qwen-3-8-max-0902',
  'qwen3.8-flash',
  'qwen3-8-flash',
  'qwen-3.8-flash',
  'qwen-3-8-flash',
  'qwen3.8-27b',
  'qwen3-8-27b',
  'qwen-3.8-27b',
  'qwen-3-8-27b',
  'qwen3.8-2.4t-a95b',
  'qwen3-8-2.4t-a95b',
  'qwen-3.8-2.4t-a95b',
  'qwen-3-8-2.4t-a95b',
  'kimi-k3',
  'kimi-k-3',
  'muse-spark-1.3',
  'muse-spark-1-3',
  'muse-spark-1.3-contribuitor',
  'muse-spark-1-3-contribuitor',
  'gemini-3.8-flash',
  'gemini-3-8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3-5-flash-lite',
  'gemini-3.1-pro',
  'gemini-3-1-pro',
  'gemini-pro-agent',
  'gemini-3.1-flash-live-preview',
  'gemini-3-1-flash-live-preview',
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it',
  'deepseek-v4-flash-0731',
  'deepseek-4-flash-0731',
  'deepseek-v4-pro-0813',
  'deepseek-4-pro-0813',
  'deepseek-v4-flash-vision-exp',
  'deepseek-4-flash-vision-exp',
  'glm-5.3',
  'glm-5-3',
  'glm-5.3-flash',
  'glm-5-3-flash',
  'solar-pro4',
  'solar-pro-4',
  'free'
]

export function normalizeBaseUrl(url: string): string {
  if (!url) return ''
  let cleaned = url.trim()
  if (cleaned.endsWith('/')) {
    cleaned = cleaned.slice(0, -1)
  }
  return cleaned
}

export function findTrustedProvider(baseUrl: string): TrustedProviderMeta | undefined {
  const norm = normalizeBaseUrl(baseUrl)
  return TRUSTED_PROVIDERS.find((p) => normalizeBaseUrl(p.baseUrl) === norm)
}

export function isBaseUrlTrusted(baseUrl: string): boolean {
  return !!findTrustedProvider(baseUrl)
}

export function extractModelBaseName(modelId: string): string {
  if (!modelId) return ''
  const parts = modelId.split('/')
  return parts[parts.length - 1].toLowerCase().trim()
}

export function isModelTrusted(modelId: string): boolean {
  if (!modelId) return false
  const lowerFull = modelId.toLowerCase().trim()
  const baseName = extractModelBaseName(modelId)

  return TRUSTED_MODELS_LIST.some((tm) => {
    const tmLower = tm.toLowerCase().trim()
    return lowerFull === tmLower || baseName === tmLower || lowerFull.endsWith('/' + tmLower)
  })
}

export function getHostname(urlStr: string): string {
  if (!urlStr) return ''
  try {
    const raw = urlStr.trim()
    const withProto =
      raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`
    const parsed = new URL(withProto)
    return parsed.hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function isGoogleHost(urlStr: string): boolean {
  const host = getHostname(urlStr)
  return host === 'generativelanguage.googleapis.com' || host.endsWith('.googleapis.com')
}

export function isAnthropicHost(urlStr: string): boolean {
  const host = getHostname(urlStr)
  return host === 'api.anthropic.com' || host === 'anthropic.com' || host.endsWith('.anthropic.com')
}

export function isPuterHost(urlStr: string): boolean {
  const host = getHostname(urlStr)
  return host === 'api.puter.com' || host === 'puter.com' || host.endsWith('.puter.com')
}
