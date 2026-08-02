export interface TrustedProviderMeta {
  baseUrl: string
  name: string
  completionType: 'chat_completions' | 'responses' | 'anthropic_messages'
}

export const TRUSTED_PROVIDERS: TrustedProviderMeta[] = [
  {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    name: 'Google AI Studio',
    completionType: 'chat_completions'
  },
  {
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    name: 'NVIDIA NIM',
    completionType: 'chat_completions'
  },
  {
    baseUrl: 'https://api.openai.com/v1',
    name: 'OpenAI GPT',
    completionType: 'chat_completions'
  },
  {
    baseUrl: 'https://api.anthropic.com/v1',
    name: 'Anthropic Claude',
    completionType: 'anthropic_messages'
  },
  {
    baseUrl: 'https://openrouter.ai/api/v1',
    name: 'OpenRouter',
    completionType: 'chat_completions'
  },
  {
    baseUrl: 'https://api.groq.com/openai/v1',
    name: 'GroqCloud',
    completionType: 'chat_completions'
  },
  {
    baseUrl: 'https://api.cerebras.ai/v1',
    name: 'Cerebras AI',
    completionType: 'chat_completions'
  }
]

export const TRUSTED_MODELS_LIST: string[] = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4-mini',
  'claude-haiku-4-5-20251001',
  'claude-haiku-4.5',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-4.8',
  'claude-fable-5',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'gemma-4-31b-it',
  'llama-4-maverick-17b-128e-instruct',
  'minimax-m3',
  'nemotron-3-ultra-550b-a55b',
  'gpt-oss-120b',
  'qwen3.5-397b-a17b',
  'qwen3.6-27b',
  'step-3.7-flash',
  'glm-5.2',
  'gemini-3-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-pro',
  'kimi-k3',
  'free',
  'openrouter/free',
  'hy3',
  'grok-4.5',
  'llama-3.3-70b-versatile'
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
    const withProto = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`
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

