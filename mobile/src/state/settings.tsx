import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { MobileSettings, ProviderDraft, ProviderProfile } from '../domain/types'
import { createId } from '../lib/id'
import { readApiKey, saveApiKey, deleteApiKey } from '../storage/secrets'
import { readJson, writeJson } from '../storage/preferences'
import {
  DEFAULT_THEME,
  THEMES,
  isThemeKey,
  type ThemeKey,
  type ThemePalette
} from '../theme/themes'

const SETTINGS_KEY = 'prism.mobile.settings.v1'

const DEFAULT_SETTINGS: MobileSettings = {
  providers: [],
  defaultProviderId: null,
  defaultModelId: null,
  theme: DEFAULT_THEME,
  onboardingComplete: false
}

interface SettingsContextValue {
  ready: boolean
  providers: ProviderProfile[]
  theme: ThemePalette
  themeKey: ThemeKey
  defaultProviderId: string | null
  defaultModelId: string | null
  onboardingComplete: boolean
  setThemeKey: (key: ThemeKey) => void
  completeOnboarding: () => void
  saveProvider: (draft: ProviderDraft) => Promise<ProviderProfile>
  removeProvider: (providerId: string) => Promise<void>
  setDefaultModel: (providerId: string | null, modelId: string | null) => void
  resolveProvider: (providerId?: string | null) => ProviderProfile | undefined
  loadApiKey: (providerId: string) => Promise<string>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function sanitizeSettings(value: unknown): MobileSettings {
  if (!value || typeof value !== 'object') return DEFAULT_SETTINGS
  const record = value as Partial<MobileSettings> & { providers?: unknown }
  const providers = Array.isArray(record.providers)
    ? record.providers.filter((provider): provider is ProviderProfile => {
        if (!provider || typeof provider !== 'object') return false
        const candidate = provider as Partial<ProviderProfile>
        return (
          typeof candidate.id === 'string' &&
          typeof candidate.name === 'string' &&
          typeof candidate.baseUrl === 'string' &&
          (candidate.protocol === 'gemini' ||
            candidate.protocol === 'openai' ||
            candidate.protocol === 'anthropic') &&
          Array.isArray(candidate.models)
        )
      })
    : []
  const defaultProviderId =
    typeof record.defaultProviderId === 'string' &&
    providers.some((provider) => provider.id === record.defaultProviderId)
      ? record.defaultProviderId
      : (providers[0]?.id ?? null)

  return {
    providers,
    defaultProviderId,
    defaultModelId: typeof record.defaultModelId === 'string' ? record.defaultModelId : null,
    theme: isThemeKey(record.theme) ? record.theme : DEFAULT_THEME,
    onboardingComplete: record.onboardingComplete === true
  }
}

export function SettingsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<MobileSettings>(DEFAULT_SETTINGS)
  const [ready, setReady] = useState(false)
  const settingsRef = useRef(settings)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const stored = await readJson<unknown>(SETTINGS_KEY, null)
      if (cancelled) return
      const next = sanitizeSettings(stored)
      settingsRef.current = next
      setSettings(next)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const commit = useCallback((updater: (current: MobileSettings) => MobileSettings) => {
    const next = updater(settingsRef.current)
    settingsRef.current = next
    setSettings(next)
    void writeJson(SETTINGS_KEY, next)
  }, [])

  const setThemeKey = useCallback(
    (key: ThemeKey) => {
      commit((current) => ({ ...current, theme: key }))
    },
    [commit]
  )

  const completeOnboarding = useCallback(() => {
    commit((current) => ({ ...current, onboardingComplete: true }))
  }, [commit])

  const saveProvider = useCallback(
    async (draft: ProviderDraft): Promise<ProviderProfile> => {
      const id = draft.id ?? createId('prov')
      if (draft.apiKey !== undefined) {
        await saveApiKey(id, draft.apiKey)
      }
      const models = draft.models
        .map((model) => ({ id: model.id.trim(), label: (model.label || model.id).trim() }))
        .filter((model) => model.id.length > 0)
      const existing = settingsRef.current.providers.find((provider) => provider.id === id)
      const profile: ProviderProfile = {
        id,
        name: draft.name.trim(),
        protocol: draft.protocol,
        baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
        models,
        createdAt: existing?.createdAt ?? Date.now()
      }

      commit((current) => {
        const providers = existing
          ? current.providers.map((provider) => (provider.id === id ? profile : provider))
          : [...current.providers, profile]
        const isFirst = !existing && current.providers.length === 0
        return {
          ...current,
          providers,
          defaultProviderId: isFirst ? id : current.defaultProviderId,
          defaultModelId: isFirst ? (models[0]?.id ?? null) : current.defaultModelId
        }
      })
      return profile
    },
    [commit]
  )

  const removeProvider = useCallback(
    async (providerId: string) => {
      await deleteApiKey(providerId)
      commit((current) => {
        const providers = current.providers.filter((provider) => provider.id !== providerId)
        const removedDefault = current.defaultProviderId === providerId
        return {
          ...current,
          providers,
          defaultProviderId: removedDefault
            ? (providers[0]?.id ?? null)
            : current.defaultProviderId,
          defaultModelId: removedDefault
            ? (providers[0]?.models[0]?.id ?? null)
            : current.defaultModelId
        }
      })
    },
    [commit]
  )

  const setDefaultModel = useCallback(
    (providerId: string | null, modelId: string | null) => {
      commit((current) => ({ ...current, defaultProviderId: providerId, defaultModelId: modelId }))
    },
    [commit]
  )

  const resolveProvider = useCallback(
    (providerId?: string | null) =>
      settings.providers.find((provider) => provider.id === providerId) ?? settings.providers[0],
    [settings.providers]
  )

  const loadApiKey = useCallback((providerId: string) => readApiKey(providerId), [])

  const value = useMemo<SettingsContextValue>(
    () => ({
      ready,
      providers: settings.providers,
      theme: THEMES[settings.theme],
      themeKey: settings.theme,
      defaultProviderId: settings.defaultProviderId,
      defaultModelId: settings.defaultModelId,
      onboardingComplete: settings.onboardingComplete,
      setThemeKey,
      completeOnboarding,
      saveProvider,
      removeProvider,
      setDefaultModel,
      resolveProvider,
      loadApiKey
    }),
    [
      ready,
      settings,
      setThemeKey,
      completeOnboarding,
      saveProvider,
      removeProvider,
      setDefaultModel,
      resolveProvider,
      loadApiKey
    ]
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used inside SettingsProvider')
  return context
}

export function useTheme(): ThemePalette {
  return useSettings().theme
}
