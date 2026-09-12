import { ARCADIA_MODELS } from '../../shared/arcadiaCatalog'

export interface Model {
  id: string
  name: string
  category: string
}

export const MODEL_CATEGORIES: Record<string, string> = {
  arcadia: 'Prism AI (Arcadia)',
  'nvidia-nim': 'NVIDIA NIM',
  'openai-compatible': 'OpenAI Compatible'
}

export const MODELS: Model[] = [
  ...ARCADIA_MODELS.map((model) => ({ ...model, category: 'arcadia' })),
  { id: 'deepseek-ai/deepseek-v4-flash', name: 'Deepseek V4 Flash', category: 'nvidia-nim' },
  { id: 'deepseek-ai/deepseek-v4-pro', name: 'Deepseek V4 Pro', category: 'nvidia-nim' },
  { id: 'z-ai/glm-5.2', name: 'GLM-5.2', category: 'nvidia-nim' },
  { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B', category: 'nvidia-nim' },
  { id: 'minimaxai/minimax-m3', name: 'MiniMax M3', category: 'nvidia-nim' },
  { id: 'stepfun-ai/step-3.7-flash', name: 'Step 3.7 Flash', category: 'nvidia-nim' }
]

export interface ThinkingLevelOption {
  id: import('../../shared/types').PrismThinkingLevel
  name: string
}

export function isPrismCloudModel(modelId: string): boolean {
  return modelId.startsWith('prism_provider:') && ARCADIA_MODELS.some((model) => model.id === modelId.slice('prism_provider:'.length).replace(/^models\//, ''))
}

export const isPrismCloudGeminiModel = isPrismCloudModel

/**
 * Returns available thinking levels for a given model.
 * Thinking levels are supported for Prism Cloud Arcadia models.
 */
export function getThinkingLevelsForModel(modelId: string): ThinkingLevelOption[] {
  if (isPrismCloudModel(modelId)) {
    return [
      { id: 'minimal', name: 'Minimal' },
      { id: 'low', name: 'Low' },
      { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High' }
    ]
  }

  return []
}

export function getDefaultThinkingLevelForModel(modelId: string): string {
  return isPrismCloudModel(modelId) ? 'minimal' : 'off'
}
