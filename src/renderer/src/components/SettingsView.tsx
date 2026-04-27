import { useState, useEffect } from 'react'
import { Save, Settings as SettingsIcon, Keyboard, Bot, RotateCcw, Monitor, Key, Shield } from 'lucide-react'
import { MODELS } from '../constants'
import { ShortcutRecorder } from './ShortcutRecorder'
import clsx from 'clsx'

export function SettingsView(): React.JSX.Element {
  const [config, setConfig] = useState({
    launcherShortcut: 'CommandOrControl+Space',
    modelSelectionShortcut: 'CommandOrControl+M',
    defaultModel: 'gemini-3.1-flash-lite-preview',
    minimizeToTray: false
  })
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState({ text: '', type: '' })

  useEffect(() => {
    async function load(): Promise<void> {
      const savedConfig = await window.api.getConfig()
      if (savedConfig) {
        setConfig(savedConfig)
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
      defaultModel: 'gemini-3.1-flash-lite-preview',
      minimizeToTray: false
    })
  }

  return (
    <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full py-12 px-8 overflow-y-auto animate-in fade-in duration-500">
      <div className="flex items-center gap-4 mb-10">
        <div className="w-12 h-12 rounded-2xl bg-accent-primary/20 flex items-center justify-center text-accent-primary">
          <SettingsIcon size={28} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">
            System Preferences
          </h1>
          <p className="text-text-secondary/60 text-sm">Personalize your experience with Prism.</p>
        </div>
      </div>

      <div className="space-y-8">
        {/* Shortcuts */}
        <section className="bg-background-secondary/30 rounded-2xl border border-surface/50 p-6 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-6">
            <Keyboard size={20} className="text-accent-primary" />
            <h2 className="text-lg font-semibold text-text-primary">Keyboard Shortcuts</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-xs uppercase tracking-widest font-black text-text-secondary/50">
                Open Quick Launcher
              </label>
              <ShortcutRecorder
                value={config.launcherShortcut}
                onChange={(newShortcut) => setConfig({ ...config, launcherShortcut: newShortcut })}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs uppercase tracking-widest font-black text-text-secondary/50">
                Model Selection (In Launcher)
              </label>
              <ShortcutRecorder
                value={config.modelSelectionShortcut}
                onChange={(newShortcut) =>
                  setConfig({ ...config, modelSelectionShortcut: newShortcut })
                }
              />
            </div>
          </div>
        </section>

        {/* Default Model */}
        <section className="bg-background-secondary/30 rounded-2xl border border-surface/50 p-6 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-6">
            <Bot size={20} className="text-accent-secondary" />
            <h2 className="text-lg font-semibold text-text-primary">Default Intelligence</h2>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs uppercase tracking-widest font-black text-text-secondary/50">
                Model at Startup
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {MODELS.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => setConfig({ ...config, defaultModel: model.id })}
                    className={clsx(
                      'flex flex-col items-start p-4 rounded-xl border transition-all text-left',
                      config.defaultModel === model.id
                        ? 'bg-accent-primary/10 border-accent-primary/40 shadow-[0_0_15px_-5px_rgba(108,99,255,0.2)]'
                        : 'bg-surface/20 border-surface/50 hover:bg-surface/40 hover:border-surface'
                    )}
                  >
                    <span
                      className={clsx(
                        'text-sm font-bold mb-1',
                        config.defaultModel === model.id
                          ? 'text-accent-primary'
                          : 'text-text-primary'
                      )}
                    >
                      {model.name}
                    </span>
                    <span className="text-[10px] text-text-secondary/60 leading-tight">
                      {model.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* API Key */}
        <section className="bg-background-secondary/30 rounded-2xl border border-surface/50 p-6 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-6">
            <Key size={20} className="text-accent-primary" />
            <h2 className="text-lg font-semibold text-text-primary">API Key (Gemini)</h2>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs uppercase tracking-widest font-black text-text-secondary/50">
                Your Gemini API Key
              </label>
              <div className="relative group">
                <input
                  type="password"
                  value={(config as any).userGeminiKey || ''}
                  onChange={(e) => setConfig({ ...config, userGeminiKey: e.target.value } as any)}
                  placeholder="If left blank, Prism will use the default key (if available)"
                  className="w-full bg-surface/20 border border-surface/50 rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary/50 transition-all"
                />
                <div className="mt-3 flex items-start gap-2 p-3 bg-accent-primary/5 border border-accent-primary/10 rounded-lg">
                  <div className="text-accent-secondary shrink-0 mt-0.5">
                    <Shield size={14} />
                  </div>
                  <p className="text-[10px] text-text-secondary/60 leading-normal">
                    Your key is saved locally in an encrypted format. Prism does not collect or share your API keys.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Behavior */}
        <section className="bg-background-secondary/30 rounded-2xl border border-surface/50 p-6 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-6">
            <Monitor size={20} className="text-accent-primary" />
            <h2 className="text-lg font-semibold text-text-primary">System Behavior</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl bg-surface/20 border border-surface/50">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold text-text-primary">
                  Minimize to Tray
                </span>
                <span className="text-[10px] text-text-secondary/60 leading-tight">
                  When clicking close, Prism will continue running in the system tray.
                </span>
              </div>
              <button
                onClick={() => setConfig({ ...config, minimizeToTray: !config.minimizeToTray })}
                className={clsx(
                  'w-12 h-6 rounded-full transition-all relative flex items-center px-1',
                  config.minimizeToTray ? 'bg-accent-primary' : 'bg-surface/60'
                )}
              >
                <div
                  className={clsx(
                    'w-4 h-4 rounded-full bg-white transition-all shadow-md',
                    config.minimizeToTray ? 'translate-x-6' : 'translate-x-0'
                  )}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Action Footer */}
        <div className="flex items-center justify-between pt-6 border-t border-surface/10">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-text-secondary/60 hover:text-text-primary transition-colors"
          >
            <RotateCcw size={14} />
            Restore Defaults
          </button>

          <div className="flex items-center gap-4">
            {message.text && (
              <span
                className={clsx(
                  'text-xs font-bold animate-in fade-in slide-in-from-right-2 duration-300',
                  message.type === 'success' ? 'text-status-success' : 'text-status-error'
                )}
              >
                {message.text}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-6 py-2.5 bg-accent-primary text-white rounded-xl font-bold text-sm hover:bg-accent-primary/90 transition-all shadow-lg shadow-accent-primary/20 disabled:opacity-50"
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
