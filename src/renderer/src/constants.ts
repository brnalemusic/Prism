export interface Model {
  id: string
  name: string
  description: string
}

export const MODELS: Model[] = [
  {
    id: 'prism-5',
    name: 'Prism 5',
    description: 'Flagship intelligence for complex work and fast execution.'
  },
  {
    id: 'prism-4.3',
    name: 'Prism 4.3',
    description: 'Deep reasoning for heavier tasks and careful planning.'
  },
  {
    id: 'prism-4.2',
    name: 'Prism 4.2',
    description: 'Advanced intelligence for cutting edge automation.'
  },
  {
    id: 'prism-4.1',
    name: 'Prism 4.1',
    description: 'Fast intelligence for responsive everyday assistance.'
  },
  {
    id: 'prism-4',
    name: 'Prism 4',
    description: 'Lightweight assistant for simple daily tasks.'
  }
]
