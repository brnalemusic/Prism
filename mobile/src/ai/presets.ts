import type { ProviderModel, ProviderProtocol } from '../domain/types'

export interface ProviderPreset {
  key: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  models: ProviderModel[]
  tagline: string
  keyHint: string
  consoleUrl: string
}

/**
 * Curated starting points for the phone. Every field stays editable, so
 * self-hosted gateways (Ollama, LM Studio, LiteLLM) fit the "Custom" preset.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'google',
    name: 'Google AI Studio',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
      { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' }
    ],
    tagline: 'Long context and image understanding',
    keyHint: 'AIza…',
    consoleUrl: 'https://aistudio.google.com/apikey'
  },
  {
    key: 'openai',
    name: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' }
    ],
    tagline: 'OpenAI hosted models',
    keyHint: 'sk-…',
    consoleUrl: 'https://platform.openai.com/api-keys'
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'google/gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' }
    ],
    tagline: 'One key, many model families',
    keyHint: 'sk-or-…',
    consoleUrl: 'https://openrouter.ai/keys'
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: [
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }
    ],
    tagline: 'Claude messages API',
    keyHint: 'sk-ant-…',
    consoleUrl: 'https://console.anthropic.com/settings/keys'
  },
  {
    key: 'groq',
    name: 'GroqCloud',
    protocol: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [{ id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' }],
    tagline: 'Low-latency open models',
    keyHint: 'gsk_…',
    consoleUrl: 'https://console.groq.com/keys'
  },
  {
    key: 'nvidia',
    name: 'NVIDIA NIM',
    protocol: 'openai',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    models: [{ id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct' }],
    tagline: 'Accelerated NVIDIA endpoints',
    keyHint: 'nvapi-…',
    consoleUrl: 'https://build.nvidia.com'
  },
  {
    key: 'custom',
    name: 'Custom endpoint',
    protocol: 'openai',
    baseUrl: '',
    models: [],
    tagline: 'Ollama, LM Studio, vLLM or any OpenAI-compatible gateway',
    keyHint: 'Optional for local servers',
    consoleUrl: ''
  }
]

export function getProviderPreset(key: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.key === key)
}

export const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  gemini: 'Gemini native',
  openai: 'OpenAI compatible',
  anthropic: 'Anthropic messages'
}
