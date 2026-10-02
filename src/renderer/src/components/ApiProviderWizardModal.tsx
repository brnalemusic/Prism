import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ProviderConfig, ProviderModel, CompletionType, TrustedProviderPreset } from '../../../shared/types'
import {
  Check,
  CheckCircle,
  Key,
  MagnifyingGlass,
  Plus,
  SignIn,
  SpinnerGap,
  User,
  Warning,
  X
} from '@phosphor-icons/react'

interface ApiProviderWizardModalProps {
  initialProvider?: ProviderConfig | null
  onClose: () => void
  onSave: (provider: ProviderConfig) => Promise<boolean>
}

type EditorSection = 'connection' | 'models' | 'identity'

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(normalizeUrl(value))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isPuterUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'puter.com' || host.endsWith('.puter.com')
  } catch {
    return false
  }
}

export const ApiProviderWizardModal: React.FC<ApiProviderWizardModalProps> = ({
  initialProvider,
  onClose,
  onSave
}) => {
  const [presets, setPresets] = useState<TrustedProviderPreset[]>([])
  const [selectedPreset, setSelectedPreset] = useState<TrustedProviderPreset | null>(null)
  const [isCustom, setIsCustom] = useState(initialProvider ? !initialProvider.isTrusted : false)
  const [section, setSection] = useState<EditorSection>('connection')
  const [baseUrl, setBaseUrl] = useState(initialProvider?.baseUrl || '')
  const [name, setName] = useState(initialProvider?.name || '')
  const [apiKey, setApiKey] = useState(initialProvider?.apiKey || '')
  const [puterAuthToken, setPuterAuthToken] = useState(initialProvider?.puterAuthToken || '')
  const [completionType, setCompletionType] = useState<CompletionType>(
    initialProvider?.completionType || 'chat_completions'
  )
  const [models, setModels] = useState<ProviderModel[]>(initialProvider?.models || [])
  const [authMode, setAuthMode] = useState<'account' | 'key'>(
    initialProvider?.completionType === 'puter_native' || !initialProvider?.apiKey ? 'account' : 'key'
  )
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [isLoggingInPuter, setIsLoggingInPuter] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    void window.api.getTrustedProviderPresets().then((items) => {
      if (!mounted) return
      setPresets(items)
      if (initialProvider) {
        setSelectedPreset(
          items.find((item) => normalizeUrl(item.baseUrl) === normalizeUrl(initialProvider.baseUrl)) || null
        )
      }
    })
    return () => {
      mounted = false
    }
  }, [initialProvider])

  const isPuter = isPuterUrl(baseUrl)
  const isTrusted = Boolean(selectedPreset) && !isCustom
  const hasCredential = isPuter && authMode === 'account' ? Boolean(puterAuthToken.trim()) : Boolean(apiKey.trim())
  const filteredModels = useMemo(
    () =>
      models.filter((model) => {
        const search = searchQuery.toLowerCase()
        return model.id.toLowerCase().includes(search) || model.name?.toLowerCase().includes(search)
      }),
    [models, searchQuery]
  )
  const enabledCount = models.filter((model) => model.enabled).length

  const selectPreset = (preset: TrustedProviderPreset): void => {
    setSelectedPreset(preset)
    setIsCustom(false)
    setBaseUrl(preset.baseUrl)
    setName(preset.name)
    setCompletionType(preset.completionType)
    setAuthMode(preset.completionType === 'puter_native' ? 'account' : 'key')
    setError('')
  }

  const selectCustom = (): void => {
    setSelectedPreset(null)
    setIsCustom(true)
    setBaseUrl('')
    setName('')
    setCompletionType('chat_completions')
    setModels([])
    setError('')
  }

  const fetchModels = async (): Promise<void> => {
    if (!hasCredential) {
      setError('Enter a credential or complete Puter account login before discovering models.')
      setSection('connection')
      return
    }
    setIsFetchingModels(true)
    setError('')
    try {
      const result = await window.api.fetchProviderModels({
        baseUrl: normalizeUrl(baseUrl),
        apiKey: isPuter && authMode === 'account' ? '' : apiKey.trim(),
        puterAuthToken: isPuter && authMode === 'account' ? puterAuthToken.trim() : undefined,
        completionType
      })
      if (!result.success) {
        setError(result.error || 'Could not discover models. You can retry later or save without discovery.')
        return
      }
      const existing = new Map(models.map((model) => [model.id, model]))
      setModels(
        result.models.map((model) => ({
          ...model,
          enabled: existing.get(model.id)?.enabled ?? model.enabled,
          imageGeneration: existing.get(model.id)?.imageGeneration || model.imageGeneration
        }))
      )
    } catch (fetchError: unknown) {
      setError(fetchError instanceof Error ? fetchError.message : 'Could not discover models.')
    } finally {
      setIsFetchingModels(false)
    }
  }

  const loginWithPuter = async (): Promise<void> => {
    setIsLoggingInPuter(true)
    setError('')
    try {
      const result = await window.api.loginWithPuter()
      if (!result.success || !result.token) {
        setError(result.error || 'Puter login was not completed.')
        return
      }
      setPuterAuthToken(result.token)
      setApiKey('')
      setCompletionType('puter_native')
    } catch (loginError: unknown) {
      setError(loginError instanceof Error ? loginError.message : 'Could not start Puter login.')
    } finally {
      setIsLoggingInPuter(false)
    }
  }

  const close = (): void => {
    if (isLoggingInPuter) void window.api.cancelPuterLogin()
    onClose()
  }

  const save = async (): Promise<void> => {
    const normalizedBaseUrl = normalizeUrl(baseUrl)
    if (!isValidHttpUrl(normalizedBaseUrl)) {
      setError('Enter a valid HTTP(S) base URL.')
      setSection('connection')
      return
    }
    if (!hasCredential) {
      setError('A credential is required, except after completing Puter account login.')
      setSection('connection')
      return
    }
    if (isCustom && !name.trim()) {
      setError('A provider name is required for a custom endpoint.')
      setSection('identity')
      return
    }

    const provider: ProviderConfig = {
      id: initialProvider?.id || `provider_${Date.now()}`,
      name: isTrusted ? selectedPreset!.name : name.trim(),
      baseUrl: normalizedBaseUrl,
      apiKey: isPuter && authMode === 'account' ? '' : apiKey.trim(),
      ...(isPuter && authMode === 'account' ? { puterAuthToken: puterAuthToken.trim() } : {}),
      completionType,
      isTrusted,
      models
    }
    setIsSaving(true)
    setError('')
    try {
      const saved = await onSave(provider)
      if (!saved) setError('Could not save this provider. Please try again.')
    } catch {
      setError('Could not save this provider. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const sections: Array<{ id: EditorSection; label: string; complete: boolean }> = [
    { id: 'connection', label: 'Connection', complete: isValidHttpUrl(baseUrl) && hasCredential },
    { id: 'models', label: 'Models', complete: models.length > 0 },
    ...(isCustom ? [{ id: 'identity' as EditorSection, label: 'Identity & protocol', complete: Boolean(name.trim()) }] : [])
  ]

  if (!initialProvider && !selectedPreset && !isCustom) {
    return createPortal(
      <div className="prism-modal-backdrop fixed inset-0 z-[9999] flex overflow-y-auto p-4 sm:p-6 animate-soft-pop">
        <div className="prism-modal-panel m-auto w-full max-w-3xl overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-6 py-4">
            <div><h3 className="text-base font-bold text-text-primary">Choose a Provider</h3><p className="mt-1 text-xs text-text-secondary">Select a verified preset or configure your own endpoint.</p></div>
            <button onClick={close} className="p-1.5 text-text-muted hover:text-text-primary" title="Close modal"><X size={18} weight="bold" /></button>
          </div>
          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
            {presets.map((preset) => <button key={preset.id} onClick={() => selectPreset(preset)} className="rounded-2xl border border-white/[0.1] bg-white/[0.03] p-4 text-left transition-colors hover:border-status-success/50 hover:bg-status-success/10"><div className="flex items-center gap-2 text-sm font-bold text-text-primary"><CheckCircle size={17} weight="fill" className="text-status-success" />{preset.name}</div><div className="mt-2 truncate font-mono text-[10px] text-text-muted">{preset.baseUrl}</div><div className="mt-2 text-[11px] text-text-secondary">{preset.completionType.replace(/_/g, ' ')}</div></button>)}
            <button onClick={selectCustom} className="rounded-2xl border border-dashed border-white/20 bg-white/[0.02] p-4 text-left transition-colors hover:border-accent-primary hover:bg-accent-primary/10"><div className="flex items-center gap-2 text-sm font-bold text-text-primary"><Plus size={17} />Custom endpoint</div><p className="mt-2 text-[11px] text-text-secondary">Configure any HTTP(S) provider, including local endpoints.</p></button>
          </div>
        </div>
      </div>, document.body)
  }

  return createPortal(
    <div className="prism-modal-backdrop fixed inset-0 z-[9999] flex flex-col overflow-y-auto p-4 sm:p-6 animate-soft-pop">
      <div className="prism-modal-panel m-auto flex max-h-[calc(100vh-32px)] w-full max-w-2xl flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-6 py-4"><div><h3 className="text-base font-bold text-text-primary">{initialProvider ? 'Edit API Provider' : 'Configure API Provider'}</h3><p className="mt-0.5 text-xs text-text-secondary">{isTrusted ? selectedPreset?.name : 'Custom endpoint'}</p></div><button onClick={close} className="p-1.5 text-text-muted hover:text-text-primary" title="Close modal"><X size={18} weight="bold" /></button></div>
        <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-white/[0.06] bg-black/20 px-4 py-3">
          {sections.map((item) => <button key={item.id} onClick={() => setSection(item.id)} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold ${section === item.id ? 'bg-text-primary text-black' : 'bg-white/[0.05] text-text-secondary hover:text-text-primary'}`}>{item.complete ? <CheckCircle size={14} weight="fill" className={section === item.id ? 'text-black' : 'text-status-success'} /> : <Warning size={14} className="text-status-warning" />}{item.label}</button>)}
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5 sm:p-6">
          {error && <div className="rounded-xl border border-status-error/20 bg-status-error/10 p-3 text-xs text-status-error">{error}</div>}
          {section === 'connection' && <div className="space-y-4">
            <div>{isTrusted ? <div className="rounded-xl border border-status-success/30 bg-status-success/10 p-3 text-xs text-status-success">Verified endpoint: <strong>{baseUrl}</strong></div> : <><label className="text-xs font-semibold text-text-primary">Base URL</label><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 font-mono text-xs text-text-primary outline-none focus:border-white/30" /></>}</div>
            {isPuter ? <div className="space-y-3"><div className="flex rounded-xl border border-white/[0.08] bg-white/[0.03] p-1"><button onClick={() => { setAuthMode('account'); setCompletionType('puter_native') }} className={`flex-1 rounded-lg py-2 text-xs font-semibold ${authMode === 'account' ? 'bg-text-primary text-black' : 'text-text-secondary'}`}><User size={14} className="mr-1 inline" />Puter Account</button><button onClick={() => { setAuthMode('key'); setCompletionType('chat_completions') }} className={`flex-1 rounded-lg py-2 text-xs font-semibold ${authMode === 'key' ? 'bg-text-primary text-black' : 'text-text-secondary'}`}><Key size={14} className="mr-1 inline" />Manual API Key</button></div>{authMode === 'account' ? <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"><p className="mb-3 text-xs text-text-secondary">Connect your Puter account in the browser. The native session is stored securely.</p><button onClick={() => void loginWithPuter()} disabled={isLoggingInPuter} className="rounded-xl bg-text-primary px-4 py-2 text-xs font-bold text-black disabled:opacity-60">{isLoggingInPuter ? <SpinnerGap size={14} className="mr-1 inline animate-spin" /> : <SignIn size={14} className="mr-1 inline" />}{puterAuthToken ? 'Reconnect Puter Account' : 'Sign In with Puter'}</button>{puterAuthToken && <span className="ml-3 text-xs text-status-success">Account connected</span>}</div> : <CredentialInput value={apiKey} onChange={setApiKey} />}</div> : <CredentialInput value={apiKey} onChange={setApiKey} />}
            <button onClick={() => void fetchModels()} disabled={isFetchingModels || !hasCredential} className="rounded-xl border border-text-primary/20 bg-text-primary/10 px-4 py-2 text-xs font-bold text-text-primary disabled:opacity-50">{isFetchingModels ? 'Discovering models...' : 'Discover models'}</button>
          </div>}
          {section === 'identity' && <div className="space-y-4"><div><label className="text-xs font-semibold text-text-primary">Provider Name</label><input value={name} onChange={(event) => setName(event.target.value)} placeholder="My Provider" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-text-primary outline-none focus:border-white/30" /></div><ProtocolSelector completionType={completionType} onChange={setCompletionType} /></div>}
          {section === 'models' && <div className="space-y-4"><div className="flex items-center justify-between"><div><h4 className="text-sm font-bold text-text-primary">Models</h4><p className="text-[11px] text-text-muted">{models.length ? `${enabledCount} of ${models.length} enabled` : 'Discovery is optional. You can save and add models later.'}</p></div><button onClick={() => void fetchModels()} disabled={isFetchingModels || !hasCredential} className="rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-xs font-semibold text-text-primary disabled:opacity-50">{isFetchingModels ? 'Discovering...' : 'Discover models'}</button></div>{models.length > 0 && <><div className="relative"><MagnifyingGlass size={15} className="absolute left-3 top-2.5 text-text-muted" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Filter models" className="w-full rounded-xl border border-white/[0.1] bg-white/[0.04] py-2 pl-9 pr-3 text-xs text-text-primary outline-none" /></div><div className="flex gap-2"><button onClick={() => setModels((items) => items.map((item) => ({ ...item, enabled: true })))} className="text-xs text-text-secondary hover:text-text-primary">Enable all</button><button onClick={() => setModels((items) => items.map((item) => ({ ...item, enabled: false })))} className="text-xs text-text-secondary hover:text-text-primary">Disable all</button></div></>}<div className="space-y-2">{filteredModels.map((model) => <button key={model.id} onClick={() => setModels((items) => items.map((item) => item.id === model.id ? { ...item, enabled: !item.enabled } : item))} className={`flex w-full items-center justify-between rounded-xl border p-3 text-left ${model.enabled ? 'border-white/20 bg-white/[0.08]' : 'border-white/[0.06] bg-white/[0.03]'}`}><span className="truncate font-mono text-xs text-text-primary">{model.id}</span>{model.enabled && <Check size={16} weight="bold" className="text-status-success" />}</button>)}{models.length === 0 && <div className="rounded-xl border border-dashed border-white/[0.1] p-8 text-center text-xs text-text-muted">No models discovered yet.</div>}</div></div>}
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-white/[0.08] bg-white/[0.02] px-6 py-4"><span className="text-[11px] text-text-muted">{models.length === 0 ? 'No models are active. You can discover them later.' : `${enabledCount} models active`}</span><button onClick={() => void save()} disabled={isSaving} className="rounded-xl bg-status-success px-5 py-2.5 text-xs font-bold text-black disabled:opacity-60">{isSaving ? 'Saving...' : 'Save Provider'}</button></div>
      </div>
    </div>, document.body)
}

const CredentialInput: React.FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => <div><label className="text-xs font-semibold text-text-primary">API Key</label><input type="password" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Enter API key" className="mt-2 w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 font-mono text-xs text-text-primary outline-none focus:border-white/30" /></div>

const ProtocolSelector: React.FC<{ completionType: CompletionType; onChange: (type: CompletionType) => void }> = ({ completionType, onChange }) => <div><label className="text-xs font-semibold text-text-primary">Completion Protocol</label><select value={completionType} onChange={(event) => onChange(event.target.value as CompletionType)} className="mt-2 w-full rounded-xl border border-white/[0.1] bg-[var(--surface)] px-3 py-3 text-xs text-text-primary outline-none"><option value="chat_completions">Chat Completions</option><option value="responses">Responses API</option><option value="anthropic_messages">Anthropic Messages</option><option value="gemini_native">Gemini Native</option><option value="puter_native">Puter.js Native</option></select></div>
