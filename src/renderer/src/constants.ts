export interface Model {
  id: string
  name: string
  description: string
}

export const MODELS: Model[] = [
  {
    id: 'prism-6-super-fast',
    name: 'Prism 6 Super-Fast',
    description:
      'An ultra-fast model focused on extremely low latency for simple coding tasks and everyday computer use.'
  },
  {
    id: 'prism-6-fast-old',
    name: 'Prism 6 Fast-Old',
    description:
      'An older model focused on speed for the simplest day-to-day tasks, emphasizing automation and orchestration.'
  },
  {
    id: 'prism-6-fast',
    name: 'Prism 6 Fast',
    description:
      'An extremely decent model for complex tasks involving automation, orchestration, and raw code, focused on low latency.'
  },
  {
    id: 'prism-6-dragon',
    name: 'Prism 6 Dragon',
    description:
      'Our most capable model for conducting in-depth research, massive agent orchestration, and information gathering.'
  },
  {
    id: 'prism-6-dense',
    name: 'Prism 6 Dense',
    description:
      'The most capable model for debugging immense code, with extremely dense information and very complex mathematics.'
  }
]
