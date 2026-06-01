import { useEffect, useState } from 'react'
import { Robot as Bot, Check, FloppyDisk as Save, X } from '@phosphor-icons/react'
import { MODELS } from '../constants'
import type { AppConfig } from '../../../main/config'
import clsx from 'clsx'

const FALLBACK_CONFIG: AppConfig = {
  launcherShortcut: 'CommandOrControl+Space',
  modelSelectionShortcut: 'CommandOrControl+M',
  screenshotShortcut: 'Ctrl+Alt+Space',
  defaultModel: 'prism-6-super-fast',
  subagentModel: 'prism-6-dragon',
  minimizeToTray: false,
  autoLaunch: false,
  userGeminiKey: '',
  ttsVoice: 'Aoede',
  theme: 'marine'
}

export function SubagentModelSettings(): React.JSX.Element {
  const [config, setConfig] = useState<AppConfig>(FALLBACK_CONFIG)
  const [selectedModel, setSelectedModel] = useState('prism-6-dragon')
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let mounted = true

    window.api.getConfig().then((savedConfig) => {
      if (!mounted || !savedConfig) return
      const nextConfig = { ...FALLBACK_CONFIG, ...savedConfig }
      setConfig(nextConfig)
      setSelectedModel(nextConfig.subagentModel || FALLBACK_CONFIG.subagentModel)
    })

    const removeConfigListener = window.api.onConfigChanged((nextConfig) => {
      const normalizedConfig = { ...FALLBACK_CONFIG, ...nextConfig }
      setConfig(normalizedConfig)
      setSelectedModel(normalizedConfig.subagentModel || FALLBACK_CONFIG.subagentModel)
    })

    return () => {
      mounted = false
      removeConfigListener()
    }
  }, [])

  const handleSave = async (): Promise<void> => {
    setIsSaving(true)
    const nextConfig = { ...config, subagentModel: selectedModel }
    const success = await window.api.saveConfig(nextConfig)
    setIsSaving(false)

    if (success) {
      setConfig(nextConfig)
      setMessage('Saved')
      setTimeout(() => window.api.closeSubagentSettingsWindow(), 450)
    } else {
      setMessage('Save failed')
    }

    setTimeout(() => setMessage(''), 1800)
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background-main text-text-primary font-sans">
      <div className="drag-region flex h-14 shrink-0 items-center justify-between border-b border-white/[0.055] bg-background-main/[0.72] px-4 backdrop-blur-2xl">
        <div className="no-drag-region flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[16px] border border-accent-primary/20 bg-accent-primary/[0.08] text-accent-primary">
            <Bot size={16} />
          </div>
          <div>
            <h1 className="text-xs font-semibold leading-tight">Subagent Models</h1>
            <p className="text-[11px] text-text-secondary/60 leading-tight">
              Current orchestration engine
            </p>
          </div>
        </div>

        <button
          onClick={() => window.api.closeSubagentSettingsWindow()}
          className="no-drag-region rounded-xl p-2 text-text-secondary transition-colors hover:bg-status-error/[0.12] hover:text-status-error"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {MODELS.map((model) => {
            const isSelected = selectedModel === model.id
            return (
              <button
                key={model.id}
                onClick={() => setSelectedModel(model.id)}
                className={clsx(
                  'flex w-full items-start gap-3 rounded-[20px] border p-4 text-left transition-all duration-200 active:scale-[0.98]',
                  model.id === 'prism-5'
                    ? [
                        'prism-5-model-option prism-5-settings-option',
                        isSelected && 'prism-5-model-option-active'
                      ]
                    : isSelected
                      ? 'border-accent-primary/30 bg-accent-primary/[0.09]'
                      : 'border-white/[0.08] bg-white/[0.035] hover:bg-white/[0.055]'
                )}
              >
                <span
                  className={clsx(
                    'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
                    model.id === 'prism-5'
                      ? ['prism-5-dot', isSelected ? 'opacity-100' : 'opacity-70']
                      : isSelected
                        ? 'bg-accent-primary'
                        : 'bg-white/[0.18]'
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={clsx(
                      'block text-sm font-semibold',
                      model.id === 'prism-5' ? 'prism-5-title-gradient' : 'text-text-primary'
                    )}
                  >
                    {model.name}
                  </span>
                  <span className="mt-1 block text-xs leading-snug text-text-secondary/70">
                    {model.description}
                  </span>
                </span>
                {isSelected && <Check size={16} className="mt-0.5 shrink-0 text-accent-primary" />}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-white/[0.055] bg-background-main/[0.72] p-4 backdrop-blur-2xl">
        <span className="text-xs font-semibold text-text-secondary/70">{message}</span>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 rounded-[18px] bg-text-primary px-5 py-2.5 text-sm font-semibold text-black transition-all hover:bg-white disabled:opacity-50"
        >
          <Save size={16} />
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
