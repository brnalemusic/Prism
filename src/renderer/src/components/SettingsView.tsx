import { useState, useEffect } from 'react'
import {
  Save,
  Settings as SettingsIcon,
  Keyboard,
  Bot,
  RotateCcw,
  Monitor,
  Key,
  Shield,
  Info
} from 'lucide-react'
import { MODELS } from '../constants'
import { ShortcutRecorder } from './ShortcutRecorder'
import clsx from 'clsx'

interface Config {
  launcherShortcut: string
  modelSelectionShortcut: string
  screenshotShortcut: string
  defaultModel: string
  subagentModel: string
  minimizeToTray: boolean
  autoLaunch: boolean
  quickLauncherMode: 'simple' | 'advanced'
  userGeminiKey: string
  username?: string
  appVersion?: string
}

export function SettingsView(): React.JSX.Element {
  const [config, setConfig] = useState<Config>({
    launcherShortcut: 'CommandOrControl+Space',
    modelSelectionShortcut: 'CommandOrControl+M',
    screenshotShortcut: 'Ctrl+Alt+Space',
    defaultModel: 'prism-5',
    subagentModel: 'prism-4.2',
    minimizeToTray: false,
    autoLaunch: false,
    quickLauncherMode: 'simple',
    userGeminiKey: '',
    appVersion: ''
  })
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState({ text: '', type: '' })

  useEffect(() => {
    async function load(): Promise<void> {
      const savedConfig = await window.api.getConfig()
      if (savedConfig) {
        setConfig({
          ...savedConfig,
          autoLaunch: savedConfig.autoLaunch ?? false,
          quickLauncherMode: savedConfig.quickLauncherMode ?? 'simple',
          userGeminiKey: savedConfig.userGeminiKey || '',
          screenshotShortcut: savedConfig.screenshotShortcut || 'Ctrl+Alt+Space',
          appVersion: savedConfig.appVersion || ''
        })
      }
    }
    load()
  }, [])

  const handleSave = async (): Promise<void> => {
    setIsSaving(true)
    const success = await window.api.saveConfig(config)
    setIsSaving(false)

    if (success) {
      setMessage({ text: 'Settings saved successfully!', type: 'success' })
    } else {
      setMessage({ text: 'Error saving settings.', type: 'error' })
    }

    setTimeout(() => setMessage({ text: '', type: '' }), 3000)
  }

  const handleReset = (): void => {
    setConfig({
      launcherShortcut: 'CommandOrControl+Space',
      modelSelectionShortcut: 'CommandOrControl+M',
      screenshotShortcut: 'Ctrl+Alt+Space',
      defaultModel: 'prism-5',
      subagentModel: 'prism-4.2',
      minimizeToTray: false,
      autoLaunch: false,
      quickLauncherMode: 'simple',
      userGeminiKey: '',
      appVersion: config.appVersion
    })
  }

  return (
    <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full py-10 px-8 overflow-y-auto animate-soft-pop">
      <div className="flex items-center gap-4 mb-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-[20px] border border-white/10 bg-white/[0.055] text-accent-primary">
          <SettingsIcon size={28} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">System Preferences</h1>
          <p className="text-text-secondary/70 text-sm">Tune Prism for your workflow.</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Shortcuts */}
        <section className="premium-panel-soft rounded-[28px] p-6">
          <div className="flex items-center gap-3 mb-6">
            <Keyboard size={20} className="text-accent-primary" />
            <h2 className="text-lg font-semibold text-text-primary">Keyboard Shortcuts</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-text-secondary/70">
                Open Quick Launcher
              </label>
              <ShortcutRecorder
                value={config.launcherShortcut}
                onChange={(newShortcut) => setConfig({ ...config, launcherShortcut: newShortcut })}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-text-secondary/70">
                Model Selection (In Launcher)
              </label>
              <ShortcutRecorder
                value={config.modelSelectionShortcut}
                onChange={(newShortcut) =>
                  setConfig({ ...config, modelSelectionShortcut: newShortcut })
                }
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-text-secondary/70">
                Screenshot & Ask (Global)
              </label>
              <ShortcutRecorder
                value={config.screenshotShortcut}
                onChange={(newShortcut) =>
                  setConfig({ ...config, screenshotShortcut: newShortcut })
                }
              />
            </div>
          </div>
        </section>

        {/* Default Model */}
        <section className="premium-panel-soft rounded-[28px] p-6">
          <div className="flex items-center gap-3 mb-6">
            <Bot size={20} className="text-accent-secondary" />
            <h2 className="text-lg font-semibold text-text-primary">Default Intelligence</h2>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-text-secondary/70">
                Model at Startup
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {MODELS.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => setConfig({ ...config, defaultModel: model.id })}
                    className={clsx(
                      'relative flex flex-col items-start rounded-[20px] border p-4 text-left transition-all duration-200 active:scale-[0.98]',
                      model.id === 'prism-5'
                        ? [
                            'prism-5-model-option prism-5-settings-option',
                            config.defaultModel === model.id && 'prism-5-model-option-active'
                          ]
                        : config.defaultModel === model.id
                          ? 'border-accent-primary/30 bg-accent-primary/[0.09]'
                          : 'border-white/[0.08] bg-white/[0.035] hover:bg-white/[0.055]'
                    )}
                  >
                    <span
                      className={clsx(
                        'mb-1 text-sm font-semibold',
                        model.id === 'prism-5' && 'prism-5-title-gradient',
                        config.defaultModel === model.id && model.id !== 'prism-5'
                          ? 'text-accent-primary'
                          : config.defaultModel !== model.id &&
                              model.id !== 'prism-5' &&
                              'text-text-primary'
                      )}
                    >
                      {model.name}
                    </span>
                    <span className="text-xs text-text-secondary/70 leading-tight">
                      {model.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Subagent Model */}
        <section className="premium-panel-soft rounded-[28px] p-6">
          <div className="mb-6 flex items-center gap-3">
            <Bot size={20} className="text-accent-primary" />
            <h2 className="text-lg font-semibold text-text-primary">Subagent Intelligence</h2>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-text-secondary/70">
              Model for Orchestration
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {MODELS.map((model) => (
                <button
                  key={model.id}
                  onClick={() => setConfig({ ...config, subagentModel: model.id })}
                  className={clsx(
                    'relative flex flex-col items-start rounded-[20px] border p-4 text-left transition-all duration-200 active:scale-[0.98]',
                    model.id === 'prism-5'
                      ? [
                          'prism-5-model-option prism-5-settings-option',
                          config.subagentModel === model.id && 'prism-5-model-option-active'
                        ]
                      : config.subagentModel === model.id
                        ? 'border-accent-primary/30 bg-accent-primary/[0.09]'
                        : 'border-white/[0.08] bg-white/[0.035] hover:bg-white/[0.055]'
                  )}
                >
                  <span
                    className={clsx(
                      'mb-1 text-sm font-semibold',
                      model.id === 'prism-5' && 'prism-5-title-gradient',
                      config.subagentModel === model.id && model.id !== 'prism-5'
                        ? 'text-accent-primary'
                        : config.subagentModel !== model.id &&
                            model.id !== 'prism-5' &&
                            'text-text-primary'
                    )}
                  >
                    {model.name}
                  </span>
                  <span className="text-xs text-text-secondary/70 leading-tight">
                    {model.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* API Key */}
        <section className="premium-panel-soft rounded-[28px] p-6">
          <div className="flex items-center gap-3 mb-6">
            <Key size={20} className="text-accent-primary" />
            <h2 className="text-lg font-semibold text-text-primary">API Key (Gemini)</h2>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-text-secondary/70">
                Your Gemini API Key
              </label>
              <div className="relative group">
                <input
                  type="password"
                  value={config.userGeminiKey || ''}
                  onChange={(e) => setConfig({ ...config, userGeminiKey: e.target.value })}
                  placeholder="If left blank, Prism will use the default key (if available)"
                  className="w-full rounded-[18px] border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-text-primary placeholder:text-text-muted transition-all focus:border-accent-primary/40 focus:outline-none"
                />
                <div className="mt-3 flex items-start gap-2 rounded-[18px] border border-accent-primary/10 bg-accent-primary/[0.045] p-3">
                  <div className="text-accent-secondary shrink-0 mt-0.5">
                    <Shield size={14} />
                  </div>
                  <p className="text-[11px] text-text-secondary/70 leading-normal">
                    Your key is saved locally in an encrypted format. Prism does not collect or
                    share your API keys.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Behavior */}
        <section className="premium-panel-soft rounded-[28px] p-6">
          <div className="flex items-center gap-3 mb-6">
            <Monitor size={20} className="text-accent-primary" />
            <h2 className="text-lg font-semibold text-text-primary">System Behavior</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-[20px] border border-white/[0.08] bg-white/[0.035] p-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold text-text-primary">Quick Search AI Mode</span>
                <span className="text-xs text-text-secondary/70 leading-tight">
                  Simple (integrated floating Prism 4 AI) or Advanced (opens the in-app chat
                  directly).
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfig({ ...config, quickLauncherMode: 'simple' })}
                  className={clsx(
                    'rounded-xl px-4 py-2 text-xs font-semibold border transition-all duration-200 active:scale-[0.98]',
                    config.quickLauncherMode === 'simple'
                      ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                      : 'border-white/10 bg-white/[0.03] text-text-secondary hover:bg-white/[0.06]'
                  )}
                >
                  Simple
                </button>
                <button
                  onClick={() => setConfig({ ...config, quickLauncherMode: 'advanced' })}
                  className={clsx(
                    'rounded-xl px-4 py-2 text-xs font-semibold border transition-all duration-200 active:scale-[0.98]',
                    config.quickLauncherMode === 'advanced'
                      ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                      : 'border-white/10 bg-white/[0.03] text-text-secondary hover:bg-white/[0.06]'
                  )}
                >
                  Advanced
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-[20px] border border-white/[0.08] bg-white/[0.035] p-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold text-text-primary">Minimize to Tray</span>
                <span className="text-xs text-text-secondary/70 leading-tight">
                  When clicking close, Prism will continue running in the system tray.
                </span>
              </div>
              <button
                onClick={() => setConfig({ ...config, minimizeToTray: !config.minimizeToTray })}
                role="switch"
                aria-checked={config.minimizeToTray}
                className={clsx(
                  'relative flex h-7 w-12 items-center rounded-full px-1 transition-all duration-200 hover:opacity-90',
                  config.minimizeToTray ? 'bg-accent-primary' : 'bg-white/[0.12]'
                )}
              >
                <div
                  className={clsx(
                    'h-5 w-5 rounded-full bg-white shadow-md transition-all duration-200',
                    config.minimizeToTray ? 'translate-x-5' : 'translate-x-0'
                  )}
                />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-[20px] border border-white/[0.08] bg-white/[0.035] p-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold text-text-primary">Start on Login</span>
                <span className="text-xs text-text-secondary/70 leading-tight">
                  Automatically start Prism when you sign in to your computer.
                </span>
              </div>
              <button
                onClick={() => setConfig({ ...config, autoLaunch: !config.autoLaunch })}
                role="switch"
                aria-checked={config.autoLaunch}
                className={clsx(
                  'relative flex h-7 w-12 items-center rounded-full px-1 transition-all duration-200 hover:opacity-90',
                  config.autoLaunch ? 'bg-accent-primary' : 'bg-white/[0.12]'
                )}
              >
                <div
                  className={clsx(
                    'h-5 w-5 rounded-full bg-white shadow-md transition-all duration-200',
                    config.autoLaunch ? 'translate-x-5' : 'translate-x-0'
                  )}
                />
              </button>
            </div>
          </div>
        </section>

        {/* About Prism */}
        <section className="premium-panel-soft rounded-[28px] p-6">
          <div className="flex items-center gap-3 mb-6">
            <Info size={20} className="text-accent-primary" />
            <h2 className="text-lg font-semibold text-text-primary">About Prism</h2>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-[20px] border border-white/[0.08] bg-white/[0.035] p-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold text-text-primary">Prism Version</span>
                <span className="text-xs text-text-secondary/70 leading-tight">
                  The current version of Prism desktop installed on your system.
                </span>
              </div>
              <span className="text-xs font-semibold bg-accent-primary/10 border border-accent-primary/20 text-accent-primary rounded-xl px-3 py-1.5">
                v{config.appVersion || '0.11.0'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex flex-col items-center justify-center rounded-[20px] border border-white/[0.08] bg-white/[0.02] p-4 text-center">
                <span className="text-xs text-text-secondary/60">Electron</span>
                <span className="text-sm font-semibold text-text-primary mt-1">
                  v{window.electron?.process?.versions?.electron || '39.8.9'}
                </span>
              </div>
              <div className="flex flex-col items-center justify-center rounded-[20px] border border-white/[0.08] bg-white/[0.02] p-4 text-center">
                <span className="text-xs text-text-secondary/60">Chromium</span>
                <span className="text-sm font-semibold text-text-primary mt-1">
                  v{window.electron?.process?.versions?.chrome || '132.0'}
                </span>
              </div>
              <div className="flex flex-col items-center justify-center rounded-[20px] border border-white/[0.08] bg-white/[0.02] p-4 text-center">
                <span className="text-xs text-text-secondary/60">Node.js</span>
                <span className="text-sm font-semibold text-text-primary mt-1">
                  v{window.electron?.process?.versions?.node || '22.11.0'}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Action Footer */}
        <div className="flex items-center justify-between border-t border-white/[0.055] pt-6">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 rounded-[16px] px-4 py-2 text-xs font-semibold text-text-secondary/70 transition-colors hover:bg-white/[0.04] hover:text-text-primary"
          >
            <RotateCcw size={14} />
            Restore Defaults
          </button>

          <div className="flex items-center gap-4">
            {message.text && (
              <span
                className={clsx(
                  'text-xs font-semibold animate-soft-pop',
                  message.type === 'success' ? 'text-status-success' : 'text-status-error'
                )}
              >
                {message.text}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-[18px] bg-text-primary px-6 py-2.5 text-sm font-semibold text-black transition-all hover:bg-white disabled:opacity-50"
            >
              <Save size={18} />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
