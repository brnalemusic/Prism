export interface Model {
  id: string
  name: string
  description: string
}

export const MODELS: Model[] = [
  {
    id: 'gemma-3-12b-it',
    name: 'Prism 1.1 Think Mini',
    description: 'Fast execution with Prism Compute logic'
  },
  {
    id: 'gemma-3-27b-it',
    name: 'Prism 1.1 Fast',
    description: 'Quick & efficient for daily tasks'
  },
  {
    id: 'gemma-4-26b-a4b-it',
    name: 'Prism 1.1 Think',
    description: 'Balanced reasoning & precision'
  },
  {
    id: 'gemma-4-31b-it',
    name: 'Prism 1.5 Think',
    description: 'Advanced logic for complex problems'
  }
]
