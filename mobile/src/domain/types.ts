import type { ThemeKey } from '../theme/themes'

/** Protocols Prism Mobile can speak directly from the device. */
export type ProviderProtocol = 'gemini' | 'openai' | 'anthropic'

export interface ProviderModel {
  id: string
  label: string
}

export interface ProviderProfile {
  id: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  models: ProviderModel[]
  createdAt: number
}

export interface ProviderDraft {
  id?: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  models: ProviderModel[]
  /** Omit to keep the stored key untouched; empty string clears it. */
  apiKey?: string
}

export interface MobileSettings {
  providers: ProviderProfile[]
  defaultProviderId: string | null
  defaultModelId: string | null
  theme: ThemeKey
  onboardingComplete: boolean
}

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'streaming' | 'complete' | 'error' | 'stopped'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: number
  status: MessageStatus
  providerId?: string
  modelId?: string
  error?: string
  durationMs?: number
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  providerId: string
  modelId: string
  messageCount: number
  /** Last assistant/user line, used as the list subtitle. */
  preview: string
}

export interface ChatTurn {
  role: MessageRole
  content: string
}
