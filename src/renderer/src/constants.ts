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
  { id: 'gemma-4-26b-a4b-it', name: 'Gemma 4 26B A4B IT', category: 'gemini' },
  { id: 'gemma-4-31b-it', name: 'Gemma 4 31B IT', category: 'gemini' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', category: 'gemini' },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', category: 'gemini' },
  { id: 'z-ai/glm-5.1', name: 'GLM-5.1', category: 'nvidia-nim' },
  { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B', category: 'nvidia-nim' },
  { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6', category: 'nvidia-nim' },
  { id: 'meta/llama-3.2-90b-vision-instruct', name: 'Llama 3.2 Vision', category: 'nvidia-nim' },
  { id: 'minimaxai/minimax-m2.7', name: 'MiniMax M2.7', category: 'nvidia-nim' },
  { id: 'minimaxai/minimax-m3', name: 'MiniMax M3', category: 'nvidia-nim' },
  { id: 'mistralai/mistral-large-3-675b-instruct-2512', name: 'Mistral Large 3', category: 'nvidia-nim' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b', name: 'Nemotron 3 Ultra', category: 'nvidia-nim' },
  { id: 'microsoft/phi-4-multimodal-instruct', name: 'Phi 4', category: 'nvidia-nim' },
  { id: 'stepfun-ai/step-3.5-flash', name: 'Step 3.5 Flash', category: 'nvidia-nim' },
  { id: 'stepfun-ai/step-3.7-flash', name: 'Step 3.7 Flash', category: 'nvidia-nim' }
]
