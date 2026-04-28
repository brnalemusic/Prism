export interface Model {
  id: string
  name: string
  description: string
}

export const MODELS: Model[] = [
  {
    id: 'prism-2',
    name: 'Prism 2',
    description: 'Ultra-fast. For simple daily tasks.'
  },
  {
    id: 'prism-2.5',
    name: 'Prism 2.5',
    description: 'Extremely fast for medium automation.'
  },
  {
    id: 'prism-3',
    name: 'Prism 3',
    description: 'Real automation agent for fast complex tasks.'
  },
  {
    id: 'prism-3.1',
    name: 'Prism 3.1',
    description: 'Improved engine. For extreme complexity.'
  }
]
