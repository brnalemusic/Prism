import { useState, useEffect, useRef } from 'react'
import {
  FloppyDisk as Save,
  Keyboard,
  Robot as Bot,
  ArrowsCounterClockwise as RotateCcw,
  Monitor,
  Key,
  Shield,
  Info,
  SpeakerHigh as Volume2,
  Palette,
  Lock,
  MagnifyingGlassPlus as ZoomIcon,
  TerminalWindow,
  Check,
  Warning
} from '@phosphor-icons/react'
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
  ttsVoice: string
  theme: 'marine' | 'vertez' | 'akoustik' | 'terno' | 'ursula' | 'rgb'
  rgbThemeExpiry?: number
  isRgbUnlocked?: boolean
  zoomFactor: number
  terminalShell?: string
}

type SectionId = 'shortcuts' | 'intelligence' | 'appearance' | 'voice' | 'system' | 'about'

interface NavSection {
  id: SectionId
  label: string
  icon: React.ReactNode
}

export function SettingsView(): React.JSX.Element {
  const [config, setConfig] = useState<Config>({
    launcherShortcut: 'CommandOrControl+Space',
    modelSelectionShortcut: 'CommandOrControl+M',
    screenshotShortcut: 'Ctrl+Alt+Space',
    defaultModel: 'prism-6-super-fast',
    subagentModel: 'prism-6-dragon',
    minimizeToTray: false,
    autoLaunch: false,
    quickLauncherMode: 'simple',
    userGeminiKey: '',
    appVersion: '',
    ttsVoice: 'Aoede',
    theme: 'marine',
    isRgbUnlocked: false,
    zoomFactor: 1.0,
    terminalShell: 'powershell.exe'
  })
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState({ text: '', type: '' })
  const [isRgbActive, setIsRgbActive] = useState(false)
  const [availableTerminals, setAvailableTerminals] = useState<
    Array<{ id: string; name: string; path: string }>
  >([])
  const [activeSection, setActiveSection] = useState<SectionId>('shortcuts')
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function fetchTerminals(): Promise<void> {
      try {
        const terms = await window.api.getAvailableTerminals()
        if (terms) {
          setAvailableTerminals(terms)
        }
      } catch (err) {
        console.error('Failed to fetch terminals:', err)
      }
    }
    fetchTerminals()
  }, [])

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
          appVersion: savedConfig.appVersion || '',
          ttsVoice: savedConfig.ttsVoice || 'Aoede',
          theme: savedConfig.theme || 'marine',
          isRgbUnlocked: savedConfig.isRgbUnlocked ?? false,
          zoomFactor: savedConfig.zoomFactor ?? 1.0,
          terminalShell: savedConfig.terminalShell || 'powershell.exe'
        })
      }
    }
    load()

    const removeConfigListener = window.api.onConfigChanged((cfg) => {
      if (cfg) {
        setConfig((prev) => ({
          ...prev,
          ...cfg,
          autoLaunch: cfg.autoLaunch ?? false,
          quickLauncherMode: cfg.quickLauncherMode ?? 'simple',
          userGeminiKey: cfg.userGeminiKey || '',
          screenshotShortcut: cfg.screenshotShortcut || 'Ctrl+Alt+Space',
          appVersion: cfg.appVersion || '',
          ttsVoice: cfg.ttsVoice || 'Aoede',
          theme: cfg.theme || 'marine',
          isRgbUnlocked: cfg.isRgbUnlocked ?? prev.isRgbUnlocked ?? false,
          zoomFactor: cfg.zoomFactor ?? prev.zoomFactor ?? 1.0,
          terminalShell: cfg.terminalShell ?? prev.terminalShell ?? 'powershell.exe'
        }))
      }
    })
    return () => removeConfigListener()
  }, [])

  useEffect(() => {
    const updateRgbActive = () => {
      const active = !!(config.rgbThemeExpiry && config.rgbThemeExpiry > Date.now())
      setIsRgbActive(active)
      if (!active && config.theme === 'rgb') {
        setConfig((prev) => ({ ...prev, theme: 'marine' }))
      }
    }

    updateRgbActive()

    if (config.rgbThemeExpiry && config.rgbThemeExpiry > Date.now()) {
      const msLeft = config.rgbThemeExpiry - Date.now()
      const timer = setTimeout(() => {
        updateRgbActive()
      }, msLeft)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [config.rgbThemeExpiry, config.theme])

  const handleSave = async (): Promise<void> => {
    setIsSaving(true)
    const success = await window.api.saveConfig(config)
    setIsSaving(false)

    if (success) {
      setMessage({ text: 'Saved!', type: 'success' })
    } else {
      setMessage({ text: 'Error saving.', type: 'error' })
    }

    setTimeout(() => setMessage({ text: '', type: '' }), 3000)
  }

  const handleReset = (): void => {
    setConfig({
      launcherShortcut: 'CommandOrControl+Space',
      modelSelectionShortcut: 'CommandOrControl+M',
      screenshotShortcut: 'Ctrl+Alt+Space',
      defaultModel: 'prism-6-super-fast',
      subagentModel: 'prism-6-dragon',
      minimizeToTray: false,
      autoLaunch: false,
      quickLauncherMode: 'simple',
      userGeminiKey: '',
      appVersion: config.appVersion,
      ttsVoice: 'Aoede',
      theme: 'marine',
      isRgbUnlocked: config.isRgbUnlocked,
      zoomFactor: 1.0,
      terminalShell: 'powershell.exe'
    })
  }

  const handleSectionChange = (id: SectionId): void => {
    setActiveSection(id)
    if (contentRef.current) {
      contentRef.current.scrollTop = 0
    }
  }

  const sections: NavSection[] = [
    { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={18} /> },
    { id: 'intelligence', label: 'Intelligence', icon: <Bot size={18} /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette size={18} /> },
    { id: 'voice', label: 'Voice', icon: <Volume2 size={18} /> },
    { id: 'system', label: 'System', icon: <Monitor size={18} /> },
    { id: 'about', label: 'About', icon: <Info size={18} /> }
  ]

  // ─── Section renderers ──────────────────────────────────

  const renderShortcuts = (): React.JSX.Element => (
    <div className="space-y-6 animate-soft-pop">
      <SectionHeader title="Keyboard Shortcuts" subtitle="Global hotkeys to control Prism." />
      <div className="space-y-5">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-text-secondary/70">
            Open Quick Launcher
          </label>
          <ShortcutRecorder
            value={config.launcherShortcut}
            onChange={(v) => setConfig({ ...config, launcherShortcut: v })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-text-secondary/70">
            Model Selection (In Launcher)
          </label>
          <ShortcutRecorder
            value={config.modelSelectionShortcut}
            onChange={(v) => setConfig({ ...config, modelSelectionShortcut: v })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-text-secondary/70">
            Screenshot &amp; Ask (Global)
          </label>
          <ShortcutRecorder
            value={config.screenshotShortcut}
            onChange={(v) => setConfig({ ...config, screenshotShortcut: v })}
          />
        </div>
      </div>
    </div>
  )

  const renderModelGrid = (
    selectedModel: string,
    onSelect: (id: string) => void
  ): React.JSX.Element => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {MODELS.map((model) => (
        <button
          key={model.id}
          onClick={() => onSelect(model.id)}
          className={clsx(
            'relative flex flex-col items-start rounded-[20px] border p-4 text-left transition-all duration-200 active:scale-[0.98]',
            model.id === 'prism-5'
              ? [
                  'prism-5-model-option prism-5-settings-option',
                  selectedModel === model.id && 'prism-5-model-option-active'
                ]
              : selectedModel === model.id
                ? 'border-accent-primary/30 bg-accent-primary/[0.09]'
                : 'border-white/[0.08] bg-white/[0.035] hover:bg-white/[0.055]'
          )}
        >
          <span
            className={clsx(
              'mb-1 text-sm font-semibold',
              model.id === 'prism-5' && 'prism-5-title-gradient',
              selectedModel === model.id && model.id !== 'prism-5'
                ? 'text-accent-primary'
                : selectedModel !== model.id && model.id !== 'prism-5' && 'text-text-primary'
            )}
          >
            {model.name}
          </span>
          <span className="text-xs text-text-secondary/70 leading-tight">{model.description}</span>
        </button>
      ))}
    </div>
  )

  const renderIntelligence = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader
        title="Intelligence"
        subtitle="Choose which models power Prism's main chat and subagent orchestration."
      />

      {/* Default Model */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent-primary/10">
            <Bot size={12} className="text-accent-primary" />
          </span>
          Model at Startup
        </h3>
        {renderModelGrid(config.defaultModel, (id) => setConfig({ ...config, defaultModel: id }))}
      </div>

      <div className="h-px bg-white/[0.04]" />

      {/* Subagent Model */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent-secondary/10">
            <Bot size={12} className="text-accent-secondary" />
          </span>
          Subagent Orchestration
        </h3>
        {renderModelGrid(config.subagentModel, (id) => setConfig({ ...config, subagentModel: id }))}
      </div>
    </div>
  )

  const renderAppearance = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader title="Appearance" subtitle="Customize Prism's theme and interface scaling." />

      {/* Theme */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">Application Theme</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            {
              id: 'marine',
              name: 'Marine',
              desc: 'Matte blue accent with cool slate tones',
              colors: ['#13151a', '#8fb4ff', '#78e0c2']
            },
            {
              id: 'vertez',
              name: 'Vertez',
              desc: 'Flame orange-red accent with warm charcoal tones',
              colors: ['#161413', '#ff4e3a', '#ff9f1c']
            },
            {
              id: 'akoustik',
              name: 'Akoustik',
              desc: 'Moody purple accent with deep violet tones',
              colors: ['#12101a', '#b07aff', '#e88cff']
            },
            {
              id: 'terno',
              name: 'Terno',
              desc: 'AMOLED monochrome with elegant serif typography',
              colors: ['#000000', '#ffffff', '#888888']
            },
            {
              id: 'ursula',
              name: 'Ursula Tree',
              desc: 'Leaf green and baby green blend with classic serif font',
              colors: ['#0a110a', '#388e3c', '#c8e6c9']
            },
            ...(isRgbActive
              ? [
                  {
                    id: 'rgb',
                    name: 'RGB',
                    desc: 'Dynamic chroma shifting theme',
                    colors: ['#FF0000', '#007BFF', '#2D5A27']
                  }
                ]
              : [])
          ].map((themeOpt) => (
            <button
              key={themeOpt.id}
              onClick={() =>
                setConfig({
                  ...config,
                  theme: themeOpt.id as
                    | 'marine'
                    | 'vertez'
                    | 'akoustik'
                    | 'terno'
                    | 'ursula'
                    | 'rgb'
                })
              }
              className={clsx(
                'flex items-center gap-4 rounded-[20px] border p-4 text-left transition-all duration-200 active:scale-[0.98]',
                config.theme === themeOpt.id
                  ? 'border-accent-primary/30 bg-accent-primary/[0.09] text-accent-primary shadow-[0_0_15px_rgba(143,180,255,0.15)]'
                  : 'border-white/[0.08] bg-white/[0.035] text-text-primary hover:bg-white/[0.055]'
              )}
            >
              <div className="flex items-center gap-1.5 p-2 rounded-xl bg-black/30 border border-white/5 shrink-0">
                <span
                  className="w-3.5 h-3.5 rounded-full"
                  style={{ backgroundColor: themeOpt.colors[0] }}
                />
                <span
                  className="w-3.5 h-3.5 rounded-full"
                  style={{ backgroundColor: themeOpt.colors[1] }}
                />
                <span
                  className="w-3.5 h-3.5 rounded-full"
                  style={{ backgroundColor: themeOpt.colors[2] }}
                />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold mb-0.5">{themeOpt.name}</span>
                <span className="text-xs text-text-secondary/60 leading-tight">
                  {themeOpt.desc}
                </span>
              </div>
            </button>
          ))}

          {!isRgbActive && config.isRgbUnlocked && (
            <div className="flex items-center gap-4 rounded-[20px] border border-dashed border-white/[0.08] bg-white/[0.015] p-4 text-left select-none opacity-40">
              <div className="flex items-center justify-center p-2.5 rounded-xl bg-black/40 border border-white/5 shrink-0 text-text-muted">
                <Lock size={20} />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold mb-0.5 text-text-muted">???</span>
                <span className="text-xs text-text-secondary/40 leading-tight">
                  ???????????????
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="h-px bg-white/[0.04]" />

      {/* Interface Zoom */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <ZoomIcon size={16} className="text-accent-primary" />
          Interface Zoom
        </h3>
        <p className="text-xs text-text-secondary/60">
          Adjust the scaling of the application windows.
        </p>

        {/* Main zoom card */}
        <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.035] overflow-hidden">
          {/* Top: large value display + fine controls */}
          <div className="flex items-center gap-4 px-5 pt-5 pb-4">
            {/* Decrement */}
            <button
              onClick={() => {
                const val = Math.max(0.5, Math.round((config.zoomFactor - 0.05) * 100) / 100)
                setConfig({ ...config, zoomFactor: val })
              }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-lg font-light text-text-primary hover:bg-white/[0.08] hover:text-accent-primary active:scale-90 transition-all focus:outline-none select-none"
            >
              −
            </button>

            {/* Centered percentage display */}
            <div className="flex-1 flex flex-col items-center gap-1">
              <span
                className="text-4xl font-bold tabular-nums leading-none transition-all duration-150"
                style={{ color: 'var(--accent-primary)' }}
              >
                {Math.round(config.zoomFactor * 100)}
                <span className="text-lg font-semibold ml-0.5 opacity-70">%</span>
              </span>
              <span className="text-[10px] text-text-secondary/40 uppercase tracking-widest">
                zoom level
              </span>
            </div>

            {/* Increment */}
            <button
              onClick={() => {
                const val = Math.min(3.0, Math.round((config.zoomFactor + 0.05) * 100) / 100)
                setConfig({ ...config, zoomFactor: val })
              }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-lg font-light text-text-primary hover:bg-white/[0.08] hover:text-accent-primary active:scale-90 transition-all focus:outline-none select-none"
            >
              +
            </button>
          </div>

          {/* Slider */}
          <div className="px-5 pb-4">
            <div className="relative flex items-center h-6">
              {/* Track background */}
              <div className="absolute inset-y-0 left-0 right-0 flex items-center">
                <div className="w-full h-1.5 rounded-full bg-white/[0.07]" />
              </div>
              {/* Filled track */}
              <div
                className="absolute inset-y-0 left-0 flex items-center pointer-events-none"
                style={{ width: `${((config.zoomFactor - 0.5) / (3.0 - 0.5)) * 100}%` }}
              >
                <div
                  className="h-1.5 rounded-full w-full transition-all duration-75"
                  style={{ background: 'var(--accent-primary)', opacity: 0.7 }}
                />
              </div>
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.05"
                value={config.zoomFactor}
                onChange={(e) => setConfig({ ...config, zoomFactor: parseFloat(e.target.value) })}
                className="relative w-full appearance-none bg-transparent cursor-pointer focus:outline-none settings-zoom-slider"
              />
            </div>
          </div>

          {/* Preset chips */}
          <div className="flex items-center gap-2 px-5 pb-5 flex-wrap">
            {[50, 75, 100, 125, 150, 175, 200].map((preset) => {
              const val = preset / 100
              const isActive = Math.round(config.zoomFactor * 100) === preset
              return (
                <button
                  key={preset}
                  onClick={() => setConfig({ ...config, zoomFactor: val })}
                  className={clsx(
                    'rounded-lg px-3 py-1.5 text-xs font-semibold border transition-all duration-150 active:scale-95',
                    isActive
                      ? 'border-accent-primary/40 bg-accent-primary/[0.12] text-accent-primary'
                      : 'border-white/[0.07] bg-white/[0.025] text-text-secondary/60 hover:bg-white/[0.06] hover:text-text-primary hover:border-white/[0.15]'
                  )}
                >
                  {preset}%
                </button>
              )
            })}
            <button
              onClick={() => setConfig({ ...config, zoomFactor: 1.0 })}
              className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border border-white/[0.07] bg-white/[0.025] text-text-secondary/50 hover:bg-white/[0.06] hover:text-text-primary hover:border-white/[0.15] transition-all duration-150 active:scale-95"
            >
              <RotateCcw size={11} />
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  const renderVoice = (): React.JSX.Element => (
    <div className="space-y-6 animate-soft-pop">
      <SectionHeader title="Voice" subtitle="Choose a TTS voice profile for spoken responses." />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { name: 'Aoede', desc: 'Warm & Default' },
          { name: 'Puck', desc: 'Energetic male' },
          { name: 'Charon', desc: 'Deep voice' },
          { name: 'Kore', desc: 'Soft female' },
          { name: 'Fenrir', desc: 'Sharp male' }
        ].map((voice) => (
          <button
            key={voice.name}
            onClick={() => setConfig({ ...config, ttsVoice: voice.name })}
            className={clsx(
              'flex flex-col items-center justify-center rounded-[20px] border p-5 text-center transition-all duration-200 active:scale-[0.98]',
              config.ttsVoice === voice.name
                ? 'border-accent-primary/30 bg-accent-primary/[0.09] text-accent-primary shadow-[0_0_15px_rgba(143,180,255,0.15)]'
                : 'border-white/[0.08] bg-white/[0.035] text-text-primary hover:bg-white/[0.055]'
            )}
          >
            <span className="text-sm font-semibold mb-1">{voice.name}</span>
            <span className="text-[10px] text-text-secondary/60 leading-tight">{voice.desc}</span>
          </button>
        ))}
      </div>
    </div>
  )

  const renderSystem = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader
        title="System"
        subtitle="Behavior, terminal preferences, and API authentication."
      />

      {/* Behavior toggles */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">Behavior</h3>
        <div className="space-y-3">
          {/* Quick Launcher Mode */}
          <div className="flex items-center justify-between rounded-[20px] border border-white/[0.08] bg-white/[0.035] p-4 gap-4">
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-sm font-bold text-text-primary">Quick Search AI Mode</span>
              <span className="text-xs text-text-secondary/70 leading-tight">
                Simple (integrated floating Prism 6 AI) or Advanced (opens the in-app chat
                directly).
              </span>
            </div>
            <div className="flex gap-2 shrink-0">
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

          {/* Minimize to Tray */}
          <ToggleRow
            title="Minimize to Tray"
            description="When clicking close, Prism will continue running in the system tray."
            checked={config.minimizeToTray}
            onChange={() => setConfig({ ...config, minimizeToTray: !config.minimizeToTray })}
          />

          {/* Start on Login */}
          <ToggleRow
            title="Start on Login"
            description="Automatically start Prism when you sign in to your computer."
            checked={config.autoLaunch}
            onChange={() => setConfig({ ...config, autoLaunch: !config.autoLaunch })}
          />
        </div>
      </div>

      <div className="h-px bg-white/[0.04]" />

      {/* Terminal CLI Shell */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <TerminalWindow size={16} className="text-accent-primary" />
          Terminal CLI Shell
        </h3>
        <p className="text-xs text-text-secondary/60">
          Select which terminal environment Prism will use to run commands.
        </p>
        <div className="relative w-full">
          <select
            value={config.terminalShell || 'powershell.exe'}
            onChange={(e) => setConfig({ ...config, terminalShell: e.target.value })}
            className="w-full appearance-none rounded-[18px] border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-text-primary placeholder:text-text-muted transition-all focus:border-accent-primary/40 focus:outline-none cursor-pointer"
          >
            {availableTerminals.map((term) => (
              <option key={term.path} value={term.path} className="bg-[#13151a] text-text-primary">
                {term.name} ({term.path})
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-text-secondary/70">
            <svg
              className="fill-current h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
            >
              <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
            </svg>
          </div>
        </div>
      </div>

      <div className="h-px bg-white/[0.04]" />

      {/* API Key */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <Key size={16} className="text-accent-primary" />
          Gemini API Key
        </h3>
        <input
          type="password"
          value={config.userGeminiKey || ''}
          onChange={(e) => setConfig({ ...config, userGeminiKey: e.target.value })}
          placeholder="If left blank, Prism will use the default key (if available)"
          className="w-full rounded-[18px] border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-text-primary placeholder:text-text-muted transition-all focus:border-accent-primary/40 focus:outline-none"
        />
        <div className="flex items-start gap-2 rounded-[18px] border border-accent-primary/10 bg-accent-primary/[0.045] p-3">
          <div className="text-accent-secondary shrink-0 mt-0.5">
            <Shield size={14} />
          </div>
          <p className="text-[11px] text-text-secondary/70 leading-normal">
            Your key is saved locally in an encrypted format. Prism does not collect or share your
            API keys.
          </p>
        </div>
      </div>
    </div>
  )

  const renderAbout = (): React.JSX.Element => (
    <div className="space-y-6 animate-soft-pop">
      <SectionHeader title="About Prism" subtitle="Version information and runtime details." />

      <div className="flex items-center justify-between rounded-[20px] border border-white/[0.08] bg-white/[0.035] p-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-bold text-text-primary">Prism Version</span>
          <span className="text-xs text-text-secondary/70 leading-tight">
            The current version of Prism desktop installed on your system.
          </span>
        </div>
        <span className="text-xs font-semibold bg-accent-primary/10 border border-accent-primary/20 text-accent-primary rounded-xl px-3 py-1.5 shrink-0">
          {config.appVersion ? `v${config.appVersion}` : 'Loading...'}
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
  )

  const renderActiveSection = (): React.JSX.Element => {
    switch (activeSection) {
      case 'shortcuts':
        return renderShortcuts()
      case 'intelligence':
        return renderIntelligence()
      case 'appearance':
        return renderAppearance()
      case 'voice':
        return renderVoice()
      case 'system':
        return renderSystem()
      case 'about':
        return renderAbout()
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden animate-soft-pop">
      {/* ─── Sticky Header ─── */}
      <div className="shrink-0 flex items-center justify-between px-6 md:px-8 py-4 border-b border-white/[0.04] bg-background-main/80 backdrop-blur-md z-10">
        <h1 className="text-lg font-semibold text-text-primary">Settings</h1>

        <div className="flex items-center gap-3">
          {/* Status message */}
          {message.text && (
            <span
              className={clsx(
                'flex items-center gap-1.5 text-xs font-semibold animate-soft-pop',
                message.type === 'success' ? 'text-status-success' : 'text-status-error'
              )}
            >
              {message.type === 'success' ? (
                <Check size={14} weight="bold" />
              ) : (
                <Warning size={14} weight="bold" />
              )}
              {message.text}
            </span>
          )}

          {/* Reset button */}
          <button
            onClick={handleReset}
            className="hidden sm:flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-text-secondary/70 transition-colors hover:bg-white/[0.04] hover:text-text-primary"
            title="Restore default settings"
          >
            <RotateCcw size={14} />
            Reset
          </button>

          {/* Save button — always visible */}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 rounded-2xl bg-text-primary px-5 py-2 text-sm font-semibold text-black transition-all hover:bg-white disabled:opacity-50 active:scale-[0.97]"
          >
            <Save size={16} />
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* ─── Body: Nav + Content ─── */}
      <div className="flex-1 flex min-h-0 flex-col md:flex-row">
        {/* ─── Sidebar Nav (md+) ─── */}
        <nav className="hidden md:flex shrink-0 w-48 flex-col gap-1 p-4 border-r border-white/[0.04]">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => handleSectionChange(s.id)}
              className={clsx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 w-full text-left',
                activeSection === s.id
                  ? 'bg-white/[0.06] text-text-primary font-medium'
                  : 'text-text-secondary hover:bg-white/[0.03] hover:text-text-primary'
              )}
            >
              <span
                className={clsx(
                  'transition-colors duration-200',
                  activeSection === s.id ? 'text-accent-primary' : 'text-text-muted'
                )}
              >
                {s.icon}
              </span>
              {s.label}
            </button>
          ))}

          {/* Mobile-only reset at bottom */}
          <div className="mt-auto pt-4">
            <button
              onClick={handleReset}
              className="flex sm:hidden items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-text-secondary/70 transition-colors hover:bg-white/[0.04] hover:text-text-primary w-full"
            >
              <RotateCcw size={14} />
              Restore Defaults
            </button>
          </div>
        </nav>

        {/* ─── Horizontal Tabs (mobile < md) ─── */}
        <div className="md:hidden shrink-0 border-b border-white/[0.04] overflow-x-auto">
          <div className="flex gap-1 px-4 py-2 min-w-max">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => handleSectionChange(s.id)}
                className={clsx(
                  'flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all duration-200 whitespace-nowrap',
                  activeSection === s.id
                    ? 'bg-white/[0.06] text-text-primary'
                    : 'text-text-secondary hover:bg-white/[0.03] hover:text-text-primary'
                )}
              >
                <span
                  className={clsx(
                    'transition-colors duration-200',
                    activeSection === s.id ? 'text-accent-primary' : 'text-text-muted'
                  )}
                >
                  {s.icon}
                </span>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Content Panel ─── */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-6 md:p-8 lg:p-10">
          <div className="max-w-3xl">{renderActiveSection()}</div>
        </div>
      </div>
    </div>
  )
}

// ─── Reusable sub-components ────────────────────────────

function SectionHeader({
  title,
  subtitle
}: {
  title: string
  subtitle: string
}): React.JSX.Element {
  return (
    <div className="mb-2">
      <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
      <p className="text-sm text-text-secondary/60 mt-1">{subtitle}</p>
    </div>
  )
}

function ToggleRow({
  title,
  description,
  checked,
  onChange
}: {
  title: string
  description: string
  checked: boolean
  onChange: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-[20px] border border-white/[0.08] bg-white/[0.035] p-4 gap-4">
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-sm font-bold text-text-primary">{title}</span>
        <span className="text-xs text-text-secondary/70 leading-tight">{description}</span>
      </div>
      <button
        onClick={onChange}
        role="switch"
        aria-checked={checked}
        className={clsx(
          'relative flex h-7 w-12 items-center rounded-full px-1 transition-all duration-200 hover:opacity-90 shrink-0',
          checked ? 'bg-accent-primary' : 'bg-white/[0.12]'
        )}
      >
        <div
          className={clsx(
            'h-5 w-5 rounded-full bg-white shadow-md transition-all duration-200',
            checked ? 'translate-x-5' : 'translate-x-0'
          )}
        />
      </button>
    </div>
  )
}
