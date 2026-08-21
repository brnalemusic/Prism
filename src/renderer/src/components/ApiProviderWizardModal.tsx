import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { ProviderConfig, ProviderModel, CompletionType } from '../../../shared/types'
import {
  CheckCircle,
  Warning,
  MagnifyingGlass,
  Check,
  X,
  ArrowRight,
  ArrowLeft,
  SignIn,
  User,
  Key,
  SpinnerGap,
  ArrowSquareOut,
  Sparkle
} from '@phosphor-icons/react'

const TRUSTED_PROVIDERS_META: Array<{
  baseUrl: string
  name: string
  completionType: CompletionType
}> = [
  {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    name: 'Google AI Studio',
    completionType: 'gemini_native'
  },
  {
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    name: 'NVIDIA NIM',
    completionType: 'chat_completions'
  },
  { baseUrl: 'https://api.openai.com/v1', name: 'OpenAI GPT', completionType: 'chat_completions' },
  {
    baseUrl: 'https://api.anthropic.com/v1',
    name: 'Anthropic Claude',
    completionType: 'anthropic_messages'
  },
  {
    baseUrl: 'https://openrouter.ai/api/v1',
    name: 'OpenRouter',
    completionType: 'chat_completions'
  },
  {
    baseUrl: 'https://api.groq.com/openai/v1',
    name: 'GroqCloud',
    completionType: 'chat_completions'
  },
  {
    baseUrl: 'https://api.cerebras.ai/v1',
    name: 'Cerebras AI',
    completionType: 'chat_completions'
  },
  {
    baseUrl: 'https://api.puter.com/puterai/openai/v1',
    name: 'Puter.js',
    completionType: 'chat_completions'
  }
]

function normalizeUrl(url: string): string {
  let cleaned = (url || '').trim()
  while (cleaned.endsWith('/')) {
    cleaned = cleaned.slice(0, -1)
  }
  return cleaned
}

function findTrusted(url: string): (typeof TRUSTED_PROVIDERS_META)[number] | undefined {
  const norm = normalizeUrl(url)
  return TRUSTED_PROVIDERS_META.find((p) => normalizeUrl(p.baseUrl) === norm)
}

interface ApiProviderWizardModalProps {
  initialProvider?: ProviderConfig | null
  onClose: () => void
  onSave: (provider: ProviderConfig) => void
}

export const ApiProviderWizardModal: React.FC<ApiProviderWizardModalProps> = ({
  initialProvider,
  onClose,
  onSave
}) => {
  const [step, setStep] = useState<number>(1)
  const [baseUrl, setBaseUrl] = useState<string>(initialProvider?.baseUrl || '')
  const [apiKey, setApiKey] = useState<string>(initialProvider?.apiKey || '')
  const [name, setName] = useState<string>(initialProvider?.name || '')
  const [completionType, setCompletionType] = useState<CompletionType>(
    initialProvider?.completionType || 'chat_completions'
  )
  const [models, setModels] = useState<ProviderModel[]>(initialProvider?.models || [])
  const [isFetchingModels, setIsFetchingModels] = useState<boolean>(false)
  const [fetchError, setFetchError] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')

  const trustedMeta = findTrusted(baseUrl)
  const isTrusted = !!trustedMeta
  const isPuter = Boolean(
    trustedMeta?.name === 'Puter.js' ||
      (baseUrl &&
        (baseUrl.toLowerCase().includes('puter.com') ||
          baseUrl.toLowerCase().includes('api.puter')))
  )

  const [authMode, setAuthMode] = useState<'account' | 'key'>('account')
  const [isLoggingInPuter, setIsLoggingInPuter] = useState<boolean>(false)
  const [puterLoginError, setPuterLoginError] = useState<string>('')
  const [puterUsername, setPuterUsername] = useState<string>('')

  const handlePuterBrowserLogin = async (): Promise<void> => {
    setIsLoggingInPuter(true)
    setPuterLoginError('')
    try {
      const res = await window.api.loginWithPuter()
      if (res && res.success && res.token) {
        setApiKey(res.token)
        if (res.username) {
          setPuterUsername(res.username)
        }
        setIsLoggingInPuter(false)
        setStep(5)
        // Automatically fetch models using native Puter.js
        setIsFetchingModels(true)
        setFetchError('')
        try {
          const fetchRes = await window.api.fetchProviderModels({
            baseUrl,
            apiKey: res.token,
            completionType
          })
          if (fetchRes && fetchRes.success && fetchRes.models) {
            setModels(fetchRes.models)
          } else {
            setFetchError(fetchRes?.error || 'Failed to fetch models from Puter.js')
          }
        } catch (fetchErr: unknown) {
          setFetchError(
            fetchErr instanceof Error ? fetchErr.message : 'Error connecting to Puter.js'
          )
        } finally {
          setIsFetchingModels(false)
        }
      } else {
        setPuterLoginError(res?.error || 'Puter login was not completed')
        setIsLoggingInPuter(false)
      }
    } catch (err: unknown) {
      setPuterLoginError(err instanceof Error ? err.message : 'Failed to connect to Puter')
      setIsLoggingInPuter(false)
    }
  }

  const handleCancelPuterLogin = async (): Promise<void> => {
    try {
      await window.api.cancelPuterLogin()
    } catch {
      // ignore
    }
    setIsLoggingInPuter(false)
  }

  const handleClose = (): void => {
    if (isLoggingInPuter) {
      window.api.cancelPuterLogin?.()
    }
    onClose()
  }

  const handleNextFromUrl = (): void => {
    if (!baseUrl.trim()) return
    if (trustedMeta) {
      setName(trustedMeta.name)
      if (!initialProvider) setCompletionType(trustedMeta.completionType)
    }
    setStep(2)
  }

  const handleNextFromKey = (): void => {
    if (isPuter && authMode === 'account') {
      if (!apiKey.trim()) {
        handlePuterBrowserLogin()
        return
      }
      setStep(5)
      return
    }

    if (!apiKey.trim()) return
    if (isTrusted) {
      // Skip name step if provider is trusted and name is immutable
      setStep(4)
    } else {
      setStep(3)
    }
  }

  const handleFetchModels = async (): Promise<void> => {
    setIsFetchingModels(true)
    setFetchError('')
    try {
      const res = await window.api.fetchProviderModels({ baseUrl, apiKey, completionType })
      if (res.success && res.models) {
        setModels(res.models)
      } else {
        setFetchError(res.error || 'Failed to fetch models from provider')
      }
    } catch (error: unknown) {
      setFetchError(error instanceof Error ? error.message : 'Error connecting to provider')
    } finally {
      setIsFetchingModels(false)
    }
  }

  const handleToggleModel = (id: string): void => {
    setModels((prev) => (prev || []).map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m)))
  }

  const handleSave = (): void => {
    const provider: ProviderConfig = {
      id: initialProvider?.id || `provider_${Date.now()}`,
      name: isTrusted ? trustedMeta!.name : name.trim() || 'Custom Provider',
      baseUrl: normalizeUrl(baseUrl),
      apiKey: apiKey.trim(),
      completionType,
      isTrusted,
      models
    }
    onSave(provider)
  }

  const filteredModels = (models || []).filter(
    (m) =>
      m &&
      m.id &&
      (m.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.name && m.name.toLowerCase().includes(searchQuery.toLowerCase())))
  )

  const stepList = isTrusted
    ? [
        { id: 1, label: 'Base URL' },
        { id: 2, label: 'API Key' },
        { id: 4, label: 'Type' },
        { id: 5, label: 'Models' }
      ]
    : [
        { id: 1, label: 'Base URL' },
        { id: 2, label: 'API Key' },
        { id: 3, label: 'Name' },
        { id: 4, label: 'Type' },
        { id: 5, label: 'Models' }
      ]

  return createPortal(
    <div className="prism-modal-backdrop fixed inset-0 z-[9999] flex flex-col overflow-y-auto p-4 sm:p-6 animate-soft-pop">
      <div className="prism-modal-panel m-auto flex max-h-[calc(100vh-32px)] w-full max-w-xl flex-col overflow-hidden">
        {/* Header — ALWAYS FIXED AND VISIBLE WITH SHRINK-0 */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <h3 className="text-base font-bold text-text-primary truncate">
              {initialProvider ? 'Edit API Provider' : 'Add API Provider'}
            </h3>
            {isTrusted ? (
              <span
                title="This provider is trusted by Prism."
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-status-success/15 text-status-success border border-status-success/30 cursor-help shrink-0"
              >
                <CheckCircle size={12} weight="fill" />
                Trusted Provider
              </span>
            ) : baseUrl ? (
              <span
                title="This provider is not trusted by Prism."
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-status-warning/15 text-status-warning border border-status-warning/30 cursor-help shrink-0"
              >
                <Warning size={12} weight="fill" />
                Untrusted Provider
              </span>
            ) : null}
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-text-muted hover:text-text-primary rounded-xl hover:bg-white/[0.08] transition-colors shrink-0"
            title="Close modal"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Steps Indicator — ALWAYS FIXED AND VISIBLE WITH SHRINK-0 */}
        <div className="shrink-0 flex items-center px-4 sm:px-6 py-3 bg-black/25 border-b border-white/[0.05] overflow-x-auto gap-1.5 scrollbar-none">
          {stepList.map((s, idx) => {
            const isActive = step === s.id
            const isDone = step > s.id

            return (
              <React.Fragment key={s.id}>
                {idx > 0 && <span className="text-text-muted/40 text-xs px-0.5">&rarr;</span>}
                <span
                  className={`px-2.5 py-1 rounded-lg text-xs transition-all whitespace-nowrap ${
                    isActive
                      ? 'bg-text-primary text-black font-bold shadow-sm'
                      : isDone
                        ? 'bg-white/[0.08] text-text-primary font-medium'
                        : 'text-text-muted font-medium'
                  }`}
                >
                  {s.label}
                </span>
              </React.Fragment>
            )
          })}
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-5">
          {step === 1 && (
            <div className="space-y-3.5">
              <label className="block text-xs font-semibold text-text-primary">
                Provider Base URL
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.1] rounded-xl text-text-primary placeholder-text-muted focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all text-xs sm:text-sm font-mono"
                autoFocus
              />
              {isTrusted && (
                <div className="p-3 rounded-xl bg-status-success/15 border border-status-success/30 text-status-success text-xs flex items-center gap-2">
                  <CheckCircle size={16} weight="fill" className="shrink-0" />
                  <span>
                    Recognized trusted endpoint for{' '}
                    <strong className="font-bold text-text-primary">{trustedMeta?.name}</strong>.
                    Provider name is locked.
                  </span>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {isPuter ? (
                <>
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-text-primary">
                      Authentication Method for Puter.js
                    </label>
                  </div>

                  {/* Tab switch between Account and Manual Key */}
                  <div className="flex p-1 bg-white/[0.04] border border-white/[0.08] rounded-xl gap-1">
                    <button
                      type="button"
                      onClick={() => setAuthMode('account')}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                        authMode === 'account'
                          ? 'bg-text-primary text-black font-semibold shadow-sm'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <User size={14} weight={authMode === 'account' ? 'fill' : 'regular'} />
                      <span>Puter Account (Native)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthMode('key')}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                        authMode === 'key'
                          ? 'bg-text-primary text-black font-semibold shadow-sm'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <Key size={14} weight={authMode === 'key' ? 'fill' : 'regular'} />
                      <span>Manual API Key</span>
                    </button>
                  </div>

                  {authMode === 'account' ? (
                    <div className="space-y-3.5 pt-1">
                      <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] space-y-3">
                        <div className="flex items-start gap-3">
                          <div className="p-2 rounded-xl bg-text-primary/10 text-text-primary border border-text-primary/20 shrink-0">
                            <Sparkle size={18} weight="fill" />
                          </div>
                          <div className="space-y-1 min-w-0">
                            <h4 className="text-xs font-bold text-text-primary">
                              Puter.js Native Account Login
                            </h4>
                            <p className="text-[11px] text-text-secondary/80 leading-relaxed">
                              Connect your Puter account directly in your default browser. Prism will securely receive the authentication session and discover available models automatically.
                            </p>
                          </div>
                        </div>

                        {isLoggingInPuter ? (
                          <div className="p-3.5 rounded-xl bg-text-primary/5 border border-text-primary/20 space-y-2.5">
                            <div className="flex items-center gap-2 text-xs font-medium text-text-primary">
                              <SpinnerGap size={16} className="animate-spin text-text-primary shrink-0" />
                              <span>Browser opened. Waiting for login confirmation in your default browser...</span>
                            </div>
                            <button
                              type="button"
                              onClick={handleCancelPuterLogin}
                              className="px-3 py-1.5 bg-white/[0.08] hover:bg-white/[0.15] text-text-secondary text-xs rounded-lg font-medium transition-all"
                            >
                              Cancel Login
                            </button>
                          </div>
                        ) : apiKey ? (
                          <div className="p-3 rounded-xl bg-status-success/15 border border-status-success/30 text-status-success text-xs flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <CheckCircle size={16} weight="fill" className="shrink-0" />
                              <span className="truncate">
                                Account connected successfully! {puterUsername ? `(@${puterUsername})` : ''}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={handlePuterBrowserLogin}
                              className="px-2.5 py-1 bg-status-success/20 hover:bg-status-success/30 text-status-success rounded-lg text-[11px] font-semibold transition-all shrink-0"
                            >
                              Reconnect
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={handlePuterBrowserLogin}
                            className="w-full py-3 px-4 bg-text-primary hover:bg-white text-black font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98]"
                          >
                            <SignIn size={16} weight="bold" />
                            <span>Sign In with Puter Account (Browser)</span>
                            <ArrowSquareOut size={14} weight="bold" className="opacity-70" />
                          </button>
                        )}

                        {puterLoginError && (
                          <div className="p-3 bg-status-error/10 border border-status-error/20 text-status-error text-xs rounded-xl">
                            {puterLoginError}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3.5 pt-1">
                      <label className="block text-xs font-semibold text-text-primary">
                        Puter API Key / Token
                      </label>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="Enter Puter token or API key..."
                        className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.1] rounded-xl text-text-primary placeholder-text-muted focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all text-xs sm:text-sm font-mono"
                        autoFocus
                      />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <label className="block text-xs font-semibold text-text-primary">
                    API Key for {isTrusted ? trustedMeta?.name : baseUrl}
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.1] rounded-xl text-text-primary placeholder-text-muted focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all text-xs sm:text-sm font-mono"
                    autoFocus
                  />
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3.5">
              <label className="block text-xs font-semibold text-text-primary">Provider Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Custom Provider Name"
                className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.1] rounded-xl text-text-primary placeholder-text-muted focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all text-xs sm:text-sm"
                autoFocus
              />
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3.5">
              <label className="block text-xs font-semibold text-text-primary">
                Completion Type
              </label>
              <div className="grid grid-cols-1 gap-2.5">
                {[
                  {
                    type: 'chat_completions',
                    label: 'Chat Completions (/chat/completions)',
                    desc: 'Standard OpenAI format, supported by 95%+ of providers.'
                  },
                  {
                    type: 'responses',
                    label: 'Responses API (/responses)',
                    desc: 'OpenAI Responses API format.'
                  },
                  {
                    type: 'anthropic_messages',
                    label: 'Anthropic Messages (/v1/messages)',
                    desc: 'Anthropic Claude API format.'
                  },
                  {
                    type: 'gemini_native',
                    label: 'Gemini Native (GenerateContent)',
                    desc: 'Native Google Gemini API format.'
                  }
                ].map((item) => (
                  <div
                    key={item.type}
                    onClick={() => setCompletionType(item.type as CompletionType)}
                    className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${
                      completionType === item.type
                        ? 'bg-white/[0.08] border-white/30 text-text-primary font-semibold'
                        : 'bg-white/[0.03] border-white/[0.08] text-text-secondary hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="text-xs font-bold text-text-primary">{item.label}</div>
                    <div className="text-[11px] text-text-secondary/70 mt-0.5">{item.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-text-primary">Active Models</h4>
                  <p className="text-[11px] text-text-muted">
                    Discovered {models.length} models from endpoint.
                  </p>
                </div>
                <button
                  onClick={handleFetchModels}
                  disabled={isFetchingModels}
                  className="px-3.5 py-2 bg-text-primary/10 text-text-primary hover:bg-text-primary/20 border border-text-primary/20 rounded-xl text-xs font-semibold transition-all shrink-0 active:scale-[0.98]"
                >
                  {isFetchingModels ? 'Fetching...' : 'Fetch /models'}
                </button>
              </div>

              {fetchError && (
                <div className="p-3 bg-status-error/10 border border-status-error/20 text-status-error text-xs rounded-xl">
                  {fetchError}
                </div>
              )}

              {models.length > 0 && (
                <div className="relative">
                  <MagnifyingGlass
                    size={16}
                    className="absolute left-3.5 top-3.5 text-text-muted"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search model name or ID..."
                    className="w-full pl-10 pr-4 py-2.5 bg-white/[0.04] border border-white/[0.1] rounded-xl text-text-primary text-xs placeholder-text-muted focus:outline-none focus:border-white/30"
                  />
                </div>
              )}

              <div className="max-h-56 sm:max-h-64 overflow-y-auto space-y-2 pr-1">
                {filteredModels.length === 0 ? (
                  <div className="text-center py-8 text-text-muted text-xs border border-dashed border-white/[0.1] rounded-2xl">
                    {models.length === 0
                      ? 'Click "Fetch /models" to discover endpoint models.'
                      : 'No models match your search.'}
                  </div>
                ) : (
                  filteredModels.map((m) => (
                    <div
                      key={m.id}
                      onClick={() => handleToggleModel(m.id)}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                        m.enabled
                          ? 'bg-white/[0.08] border-white/20 text-text-primary'
                          : 'bg-white/[0.03] border-white/[0.05] text-text-muted hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${m.enabled ? 'bg-text-primary border-text-primary text-black' : 'border-white/20'}`}
                        >
                          {m.enabled && <Check size={12} weight="bold" />}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-mono font-semibold text-text-primary truncate">
                            {m.id}
                          </div>
                          {m.isTrusted && (
                            <span className="text-[10px] text-status-success font-medium">
                              Trusted by Prism (Enabled by Default)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions — ALWAYS FIXED AND VISIBLE WITH SHRINK-0 */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-white/[0.08] bg-white/[0.02]">
          {step > 1 ? (
            <button
              onClick={() => setStep((prev) => (isTrusted && prev === 4 ? 2 : prev - 1))}
              className="px-4 py-2 bg-white/[0.05] hover:bg-white/[0.1] text-text-secondary rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 active:scale-[0.98]"
            >
              <ArrowLeft size={14} weight="bold" /> Back
            </button>
          ) : (
            <div />
          )}

          {step < 5 ? (
            <button
              onClick={() => {
                if (step === 1) handleNextFromUrl()
                else if (step === 2) handleNextFromKey()
                else setStep((prev) => prev + 1)
              }}
              className="px-5 py-2 bg-text-primary hover:bg-white text-black font-semibold rounded-xl text-xs transition-all flex items-center gap-1.5 shadow-md active:scale-[0.98]"
            >
              Next <ArrowRight size={14} weight="bold" />
            </button>
          ) : (
            <button
              onClick={handleSave}
              className="px-6 py-2.5 bg-status-success hover:opacity-90 text-black font-bold rounded-xl text-xs transition-all flex items-center gap-1.5 shadow-md active:scale-[0.98]"
            >
              <Check size={16} weight="bold" /> Save Provider
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
