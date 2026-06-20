export interface Model {
  id: string
  name: string
  description: string
  shortDescription: string
}

export const MODELS: Model[] = [
  {
    id: 'prism-6-super-fast',
    name: 'Prism 6 Super-Fast',
    description: 'Ultra-fast model for everyday tasks with low latency.',
    shortDescription: 'Ultra-fast for simple tasks.'
  },
  {
    id: 'prism-6-fast-old',
    name: 'Prism 6 Fast-Old',
    description: 'Older speed-focused model for simple automation tasks.',
    shortDescription: 'Older model for simple automation.'
  },
  {
    id: 'prism-6-fast',
    name: 'Prism 6 Fast',
    description: 'Decent model for complex automation and raw coding.',
    shortDescription: 'Decent for complex coding tasks.'
  },
  {
    id: 'prism-6-dragon',
    name: 'Prism 6 Dragon',
    description: 'Capable model for research and complex agent orchestration.',
    shortDescription: 'Best for research and orchestration.'
  },
  {
    id: 'prism-6-dense',
    name: 'Prism 6 Dense',
    description: 'Advanced model for deep debugging and complex mathematics.',
    shortDescription: 'Best for debugging and math.'
  }
]
