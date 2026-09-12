export type ArcadiaAccessTier = 'free' | 'paid'

export interface ArcadiaModelDefinition {
  id: string
  name: string
  accessTier: ArcadiaAccessTier
}

export const ARCADIA_MODELS: readonly ArcadiaModelDefinition[] = [
  { id: 'prism-ai/arcadia-1-1-mini', name: 'Arcadia 1.1 Mini', accessTier: 'free' },
  { id: 'prism-ai/arcadia-1-1-small', name: 'Arcadia 1.1 Small', accessTier: 'free' },
  {
    id: 'prism-ai/arcadia-1-1-flash-09-11',
    name: 'Arcadia 1.1 Flash (09/11)',
    accessTier: 'free'
  },
  { id: 'prism-ai/arcadia-1-1-pro', name: 'Arcadia 1.1 Pro', accessTier: 'paid' },
  { id: 'prism-ai/arcadia-1-2-flash-small', name: 'Arcadia 1.2 Flash S', accessTier: 'paid' },
  { id: 'prism-ai/arcadia-1-2-flash-giga', name: 'Arcadia 1.2 Flash G', accessTier: 'paid' },
  {
    id: 'prism-ai/arcadia-bot-0-8-experimental',
    name: 'Arcadia Bot 0.8',
    accessTier: 'paid'
  }
]

export const DEFAULT_ARCADIA_MODEL_ID = ARCADIA_MODELS[0].id
export const DEFAULT_ARCADIA_MODEL_KEY = `prism_provider:${DEFAULT_ARCADIA_MODEL_ID}`

export const ARCADIA_MODEL_IDS = new Set(ARCADIA_MODELS.map((model) => model.id))
export const PAID_ARCADIA_MODEL_IDS = new Set(
  ARCADIA_MODELS.filter((model) => model.accessTier === 'paid').map((model) => model.id)
)

export function normalizeArcadiaModelId(modelKey: string): string {
  return modelKey.replace(/^prism_provider:/, '').replace(/^models\//, '')
}

export function getArcadiaModel(modelKey: string): ArcadiaModelDefinition | undefined {
  const modelId = normalizeArcadiaModelId(modelKey)
  return ARCADIA_MODELS.find((model) => model.id === modelId)
}

export function isArcadiaModel(modelKey: string): boolean {
  return ARCADIA_MODEL_IDS.has(normalizeArcadiaModelId(modelKey))
}

export function isPaidArcadiaModel(modelKey: string): boolean {
  return PAID_ARCADIA_MODEL_IDS.has(normalizeArcadiaModelId(modelKey))
}
