export interface Model {
  id: string
  name: string
  category: string
}

export const MODEL_CATEGORIES: Record<string, string> = {
  gemini: 'Gemini',
  'nvidia-nim': 'NVIDIA NIM',
  'openai-compatible': 'OpenAI Compatible'
}

export const MODELS: Model[] = [
  { id: 'deepseek-ai/deepseek-v4-flash', name: 'Deepseek V4 Flash', category: 'nvidia-nim' },
  { id: 'deepseek-ai/deepseek-v4-pro', name: 'Deepseek V4 Pro', category: 'nvidia-nim' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', category: 'gemini' },
  { id: 'models/gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', category: 'gemini' },
  { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', category: 'gemini' },
  { id: 'z-ai/glm-5.2', name: 'GLM-5.2', category: 'nvidia-nim' },
  { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B', category: 'nvidia-nim' },
  { id: 'minimaxai/minimax-m3', name: 'MiniMax M3', category: 'nvidia-nim' },
  { id: 'stepfun-ai/step-3.7-flash', name: 'Step 3.7 Flash', category: 'nvidia-nim' }
]

export interface ThinkingLevelOption {
  id: string
  name: string
}

export function isPrismCloudGeminiModel(modelId: string): boolean {
  if (!modelId) return false
  const cleanId = modelId.startsWith('prism_provider:') ? modelId.replace('prism_provider:', '') : modelId
  return (
    cleanId === 'gemini-3.1-flash-lite' ||
    cleanId === 'models/gemini-3-flash-preview' ||
    cleanId === 'gemini-3-flash-preview'
  )
}

/**
 * Returns available thinking levels for a given model.
 * Thinking levels are supported strictly for Prism Cloud Gemini 3 / 3.1 models.
 */
export function getThinkingLevelsForModel(modelId: string): ThinkingLevelOption[] {
  if (isPrismCloudGeminiModel(modelId)) {
    return [
      { id: 'off', name: 'Off' },
      { id: 'low', name: 'Low' },
      { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High' }
    ]
  }

  return []
}

