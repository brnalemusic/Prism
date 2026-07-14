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
  { id: 'gemini-3-flash', name: 'Gemini 3 Flash', category: 'gemini' },
  { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', category: 'gemini' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', category: 'gemini' },
  { id: 'z-ai/glm-5.2', name: 'GLM-5.2', category: 'nvidia-nim' },
  { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B', category: 'nvidia-nim' },
  { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6', category: 'nvidia-nim' },
  { id: 'minimaxai/minimax-m3', name: 'MiniMax M3', category: 'nvidia-nim' },
  { id: 'stepfun-ai/step-3.7-flash', name: 'Step 3.7 Flash', category: 'nvidia-nim' }
]

export interface ThinkingLevelOption {
  id: string
  name: string
}

/**
 * Returns available thinking levels for a given model.
 * Based on official NVIDIA NIM API documentation.
 *
 * DeepSeek V4: reasoning_effort accepts none, high, max
 * GPT-OSS: reasoning_effort accepts low, medium, high (no off/none)
 * Kimi K2.6: chat_template_kwargs {"thinking": true/false}
 * MiniMax M3: chat_template_kwargs {"thinking_mode": "enabled"/"disabled"/"adaptive"}
 * GLM-5.2, Step 3.7: no reasoning parameters exposed via NIM API
 */
export function getThinkingLevelsForModel(modelId: string): ThinkingLevelOption[] {
  // Gemini models use thinkingBudget (mapped from levels)
  const geminiModels = ['gemini-3-flash', 'gemini-3.1-pro', 'gemini-3.5-flash']
  if (geminiModels.includes(modelId)) {
    return [
      { id: 'off', name: 'Off' },
      { id: 'low', name: 'Low' },
      { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High' },
      { id: 'max', name: 'Max' }
    ]
  }

  // DeepSeek V4 Flash/Pro: reasoning_effort accepts none, high, max
  if (modelId === 'deepseek-ai/deepseek-v4-flash' || modelId === 'deepseek-ai/deepseek-v4-pro') {
    return [
      { id: 'off', name: 'Off' },
      { id: 'high', name: 'High' },
      { id: 'max', name: 'Max' }
    ]
  }

  // GPT-OSS 120B: reasoning_effort accepts low, medium, high (NO "off"/"none")
  // The API does not support disabling reasoning, so no Off option
  if (modelId === 'openai/gpt-oss-120b') {
    return [
      { id: 'low', name: 'Low' },
      { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High' }
    ]
  }

  // Kimi K2.6: chat_template_kwargs {"thinking": true/false}
  if (modelId === 'moonshotai/kimi-k2.6') {
    return [
      { id: 'off', name: 'Off' },
      { id: 'on', name: 'On' }
    ]
  }

  // MiniMax M3: chat_template_kwargs {"thinking_mode": "enabled"/"disabled"/"adaptive"}
  if (modelId === 'minimaxai/minimax-m3') {
    return [
      { id: 'off', name: 'Off' },
      { id: 'enabled', name: 'Enabled' },
      { id: 'adaptive', name: 'Adaptive' }
    ]
  }

  // GLM-5.2, Step 3.7 Flash: no reasoning parameters in NIM API
  return []
}
