import React, { useState, useEffect } from 'react'
import { ProviderConfig } from '../../../shared/types'
import { ApiProviderWizardModal } from './ApiProviderWizardModal'
import {
  Plus,
  PencilSimple,
  Trash,
  CheckCircle,
  Warning,
  Key,
  Globe,
  Stack,
  ShieldCheck,
  LockKey
} from '@phosphor-icons/react'

export const ApiManagerSettings: React.FC = () => {
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false)
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [renderError, setRenderError] = useState<string | null>(null)

  const loadProviders = async () => {
    setIsLoading(true)
    setRenderError(null)
    try {
      if (window.api && typeof window.api.getProviders === 'function') {
        const data = await window.api.getProviders()
        setProviders(Array.isArray(data) ? data : [])
      } else {
        setProviders([])
      }
    } catch (e) {
      console.error('Failed to load providers:', e)
      setRenderError('Could not load providers. Please refresh or try again.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadProviders()

    const removeListener =
      window.api && typeof window.api.onConfigChanged === 'function'
        ? window.api.onConfigChanged(() => {
            loadProviders()
          })
        : undefined

    return () => {
      if (removeListener) removeListener()
    }
  }, [])

  const handleSaveProvider = async (provider: ProviderConfig) => {
    try {
      let updated: ProviderConfig[] = []
      const exists = providers.some((p) => p && p.id === provider.id)
      if (exists) {
        updated = providers.map((p) => (p && p.id === provider.id ? provider : p))
      } else {
        updated = [...providers, provider]
      }

      setProviders(updated)
      if (window.api && typeof window.api.saveProviders === 'function') {
        await window.api.saveProviders(updated)
      }
    } catch (e) {
      console.error('Failed to save provider:', e)
    } finally {
      setIsWizardOpen(false)
      setEditingProvider(null)
    }
  }

  const handleDeleteProvider = async (id: string) => {
    try {
      if (window.api && typeof window.api.deleteProvider === 'function') {
        await window.api.deleteProvider(id)
      } else if (window.api && typeof window.api.saveProviders === 'function') {
        const updated = providers.filter((p) => p && p.id !== id)
        await window.api.saveProviders(updated)
      }
      await loadProviders()
    } catch (e) {
      console.error('Failed to delete provider:', e)
    }
  }

  const handleClearAllProviders = async () => {
    try {
      if (window.api && typeof window.api.saveProviders === 'function') {
        await window.api.saveProviders([])
      }
      await loadProviders()
    } catch (e) {
      console.error('Failed to clear all providers:', e)
    }
  }

  if (renderError) {
    return (
      <div className="p-6 border border-rose-500/20 bg-rose-500/10 rounded-2xl text-center space-y-3">
        <Warning className="w-8 h-8 text-rose-400 mx-auto" />
        <h3 className="text-sm font-semibold text-white">Error Loading API Settings</h3>
        <p className="text-xs text-white/60">{renderError}</p>
        <button
          onClick={loadProviders}
          className="px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded-xl text-xs font-semibold transition-all"
        >
          Retry Loading
        </button>
      </div>
    )
  }

  const hasCustomProviders = providers.some((p) => p && p.id !== 'prism_provider')

  return (
    <div className="space-y-6 animate-soft-pop">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-text-primary tracking-tight">
            API Keys & Providers Manager
          </h2>
          <p className="text-xs text-text-secondary/70 mt-0.5">
            Configure custom OpenAI-compatible endpoints, API keys, and active models.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasCustomProviders && (
            <button
              onClick={handleClearAllProviders}
              className="px-3.5 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] shrink-0"
              title="Delete all custom API keys and providers"
            >
              <Trash size={15} weight="bold" /> Delete All Keys
            </button>
          )}
          <button
            onClick={() => {
              setEditingProvider(null)
              setIsWizardOpen(true)
            }}
            className="px-4 py-2.5 bg-text-primary hover:bg-white text-black font-semibold rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98] shrink-0"
          >
            <Plus size={16} weight="bold" /> Add Provider
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-text-muted text-xs">Loading providers...</div>
      ) : providers.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--surface)] p-8 text-center">
          <div className="w-10 h-10 rounded-2xl bg-accent-primary/10 text-accent-primary flex items-center justify-center mx-auto border border-accent-primary/20">
            <Key size={20} weight="bold" />
          </div>
          <h3 className="text-sm font-semibold text-text-primary">No API Providers Configured</h3>
          <p className="text-xs text-text-secondary/70 max-w-sm mx-auto leading-relaxed">
            Add your first OpenAI Compatible, Anthropic, or custom AI provider to start using Prism.
          </p>
          <button
            onClick={() => {
              setEditingProvider(null)
              setIsWizardOpen(true)
            }}
            className="px-4 py-2.5 bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25 border border-accent-primary/30 rounded-xl text-xs font-semibold transition-all inline-flex items-center gap-2 active:scale-[0.98]"
          >
            <Plus size={16} weight="bold" /> Configure First Provider
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5">
          {providers.map((p, idx) => {
            if (!p) return null
            const modelsList = Array.isArray(p.models) ? p.models : []
            const enabledCount = modelsList.filter((m) => m && m.enabled).length
            const isPrismCloud = p.isOfficial || p.id === 'prism_provider'
            const completionLabel =
              isPrismCloud && (p.completionType === 'gemini_native' || !p.completionType)
                ? 'Arcadia Native'
                : (p.completionType || 'chat_completions').replace(/_/g, ' ')
            const cardKey = p.id || `prov_${idx}`

            return (
              <div
                key={cardKey}
                className="space-y-3.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--border-strong)] sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-text-primary truncate">
                        {p.name || 'Unnamed Provider'}
                      </h3>
                      {p.isOfficial || p.id === 'prism_provider' ? (
                        <span
                          title="Official Prism System Provider"
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30 shrink-0"
                        >
                          <ShieldCheck size={12} weight="fill" /> Official
                        </span>
                      ) : p.isTrusted ? (
                        <span
                          title="This provider is trusted by Prism."
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-status-success/15 text-status-success border border-status-success/30 cursor-help shrink-0"
                        >
                          <CheckCircle size={12} weight="fill" /> Trusted
                        </span>
                      ) : (
                        <span
                          title="This provider is not trusted by Prism."
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-status-warning/15 text-status-warning border border-status-warning/30 cursor-help shrink-0"
                        >
                          <Warning size={12} weight="fill" /> Untrusted
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-secondary/70 font-mono flex items-center gap-1.5 truncate">
                      <Globe size={14} className="text-text-muted shrink-0" />
                      <span className="truncate">
                        {p.isOfficial || p.id === 'prism_provider'
                          ? 'Official System Endpoint'
                          : p.baseUrl || 'No base URL'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {p.isOfficial || p.id === 'prism_provider' ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 select-none">
                        <LockKey size={14} weight="bold" /> Read-Only
                      </span>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingProvider(p)
                            setIsWizardOpen(true)
                          }}
                          className="p-2 text-text-secondary hover:text-text-primary rounded-xl hover:bg-white/[0.08] transition-colors"
                          title="Edit Provider"
                        >
                          <PencilSimple size={16} weight="bold" />
                        </button>
                        <button
                          onClick={() => handleDeleteProvider(p.id)}
                          className="p-2 text-status-error/70 hover:text-status-error rounded-xl hover:bg-status-error/10 transition-colors"
                          title="Delete Provider"
                        >
                          <Trash size={16} weight="bold" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-text-secondary/80 pt-2.5 border-t border-white/[0.04]">
                  <span className="flex items-center gap-1.5">
                    <Stack size={14} className="text-accent-secondary" />
                    <strong className="text-text-primary font-medium">
                      {enabledCount}
                    </strong> of {modelsList.length} Models Active
                  </span>
                  <span className="capitalize text-text-muted text-[11px] font-medium">
                    {completionLabel}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {isWizardOpen && (
        <ApiProviderWizardModal
          initialProvider={editingProvider}
          onClose={() => {
            setIsWizardOpen(false)
            setEditingProvider(null)
          }}
          onSave={handleSaveProvider}
        />
      )}
    </div>
  )
}
