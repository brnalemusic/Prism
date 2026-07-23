export * from './types'
export * from './trustedRegistry'
export * from './providerManager'
export * from './openaiClient'
export * from './chatHandler'
export * from './launcherHandler'
export * from './searchHandler'
export * from './sttHandler'
export * from './ttsHandler'

import { resolveProviderAndModel, getAllProviders } from './providerManager'

export function initGemini(): boolean {
  // Initialization check for active providers
  const providers = getAllProviders()
  return providers.some((p) => p.apiKey && p.models.some((m) => m.enabled))
}

export function loadChatIntoHistory(_id: string): any[] {
  return []
}

export function setGeminiModel(modelKey: string): boolean {
  const { model } = resolveProviderAndModel(modelKey)
  return !!model
}

export function setUserApiKey(_key: string): void {
  // No-op for legacy setUserApiKey
}
