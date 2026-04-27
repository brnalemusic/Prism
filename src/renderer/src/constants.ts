export interface Model {
  id: string
  name: string
  description: string
}

export const MODELS: Model[] = [
  {
    id: 'gemma-3-12b-it',
    name: 'Prism 1.1 Fast Mini',
    description: 'Fast execution with Prism Compute logic'
  },
  {
    id: 'gemma-3-27b-it',
    name: 'Prism 1.1 Fast',
    description: 'Quick & efficient for daily tasks'
  },
  {
    id: 'gemini-3.1-flash-lite-preview',
    name: 'Prism 1.5 Fast',
    description: 'Prism Compute Execution'
  },
  {
    id: 'gemma-4-26b-a4b-it',
    name: 'Prism 1.5 Think',
    description: 'Balanced reasoning & precision'
  },
  {
    id: 'gemma-4-31b-it',
    name: 'Prism 2 Think',
    description: 'Advanced logic for complex problems'
  }
]
