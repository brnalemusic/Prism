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
  MagnifyingGlassPlus as ZoomIcon,
  TerminalWindow,
  Check,
  Warning,
  Lightning,
  Plus,
  Trash,
  Pencil,
  Globe,
  Microphone,
  ChatTeardropText,
  Camera,
  YoutubeLogo,
  X
} from '@phosphor-icons/react'
import { ShortcutRecorder } from './ShortcutRecorder'
import clsx from 'clsx'
import type { AppConfig, SlashWorkflow } from '../../../main/config'

type Config = AppConfig

import { ApiManagerSettings } from './ApiManagerSettings'
import { ModelSelector } from './ModelSelector'
import { DocumentShredderGame } from './DocumentShredderGame'

type SectionId =
  | 'shortcuts'
  | 'providers'
  | 'intelligence'
  | 'runtime'
  | 'appearance'
  | 'voice'
  | 'workflows'
  | 'system'
  | 'about'

interface NavSection {
  id: SectionId
  label: string
  icon: React.ReactNode
}

const STATIC_TOOLS = [
  {
    name: 'execute_terminal_command',
    label: 'Guarded Terminal',
    desc: 'Execute commands in the selected terminal'
  },
  { name: 'web_search', label: 'Web Search', desc: 'Search DuckDuckGo for live info' },
  { name: 'saw_link_from_url', label: 'Read URL Page', desc: 'Fetch website text contents' },
  {
    name: 'open_browser_link',
    label: 'Open Browser Link',
    desc: 'Open links in the system browser'
  },
  { name: 'open_application', label: 'Open App', desc: 'Start a program using its path' },
  {
    name: 'search_installed_applications',
    label: 'Search Apps',
    desc: 'Search installed desktop applications by name'
  },
  {
    name: 'search_chat_history',
    label: 'Search History',
    desc: 'Search keywords in prior conversations'
  },
  {
    name: 'run_subagents',
    label: 'Run Subagents Swarm',
    desc: 'Delegate sub-tasks to nested agents'
  },
  {
    name: 'computer_use_see_screen',
    label: 'See Screen',
    desc: 'Take screenshot of screen or specific app'
  },
  { name: 'computer_use_read_file', label: 'Read File', desc: 'Read file contents' },
  { name: 'computer_use_create_file', label: 'Create File', desc: 'Create a new file with text' },
  { name: 'computer_use_save_file', label: 'Save File', desc: 'Overwrite file contents' },
  {
    name: 'computer_use_edit_file',
    label: 'Edit File',
    desc: 'Edit specific lines of code in a file'
  },
  {
    name: 'computer_use_list_directory',
    label: 'List Directory',
    desc: 'List contents of folder'
  },
  { name: 'computer_use_remove_file', label: 'Remove File', desc: 'Delete a file' }
]

function formatToolName(name: string): string {
  let formatted = name
  if (formatted.startsWith('computer_use_')) {
    formatted = formatted.substring('computer_use_'.length)
  }
  return formatted
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function SettingsView({ onClose }: { onClose?: () => void }): React.JSX.Element {
  const [config, setConfig] = useState<Config>({
    providers: [],
    launcherShortcut: 'CommandOrControl+Space',
    modelSelectionShortcut: 'CommandOrControl+M',
    screenshotShortcut: 'Ctrl+Alt+Space',
    newChatShortcut: 'CommandOrControl+N',
    dictationShortcut: 'CommandOrControl+D',
    webSearchShortcut: 'CommandOrControl+S',
    youtubeModeShortcut: 'CommandOrControl+Y',
    minimizeToTray: false,
    autoLaunch: false,
    quickLauncherMode: 'simple',
    appVersion: '',
    ttsVoice: 'Aoede',
    theme: 'marine',
    zoomFactor: 1.0,
    terminalShell: 'powershell.exe',
    workflows: [],
    sessionMode: 'execution',
    disciplinePath: ''
  })
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState({ text: '', type: '' })
  const [availableTerminals, setAvailableTerminals] = useState<
    Array<{ id: string; name: string; path: string }>
  >([])
  const [activeSection, setActiveSection] = useState<SectionId>('shortcuts')
  const contentRef = useRef<HTMLDivElement>(null)

  const [editingWorkflow, setEditingWorkflow] = useState<SlashWorkflow | null>(null)
  const [isAddingWorkflow, setIsAddingWorkflow] = useState(false)
  const [formCommand, setFormCommand] = useState('')
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPrompt, setFormPrompt] = useState('')
  const [formTools, setFormTools] = useState<string[]>([])
  const [formError, setFormError] = useState('')

  const [availableTools, setAvailableTools] = useState<
    Array<{ name: string; label: string; desc: string }>
  >(STATIC_TOOLS)

  // --- Easter Egg State ---
  const [easterEggClicks, setEasterEggClicks] = useState(0)
  const [lastClickTimestamp, setLastClickTimestamp] = useState(0)
  const [isEasterEggOpen, setIsEasterEggOpen] = useState(false)

  const handleVersionClick = (): void => {
    const now = Date.now()
    if (now - lastClickTimestamp > 3000) {
      setEasterEggClicks(1)
    } else {
      const newCount = easterEggClicks + 1
      if (newCount >= 10) {
        setEasterEggClicks(0)
        setIsEasterEggOpen(true)
      } else {
        setEasterEggClicks(newCount)
      }
    }
    setLastClickTimestamp(now)
  }

  useEffect(() => {
    async function fetchTools(): Promise<void> {
      try {
        if (window.api && window.api.getToolDefinitions) {
          const tools = await window.api.getToolDefinitions()
          if (tools) {
            const formatted = tools.map((t: any) => {
              const staticTool = STATIC_TOOLS.find((st) => st.name === t.name)
              return {
                name: t.name,
                label: staticTool ? staticTool.label : formatToolName(t.name),
                desc: staticTool ? staticTool.desc : t.description
              }
            })
            setAvailableTools(formatted)
          }
        }
      } catch (err) {
        console.error('Failed to fetch tool definitions:', err)
      }
    }
    fetchTools()
  }, [])

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
          providers: savedConfig.providers || [],
          autoLaunch: savedConfig.autoLaunch ?? false,
          quickLauncherMode: savedConfig.quickLauncherMode ?? 'simple',
          screenshotShortcut: savedConfig.screenshotShortcut || 'Ctrl+Alt+Space',
          newChatShortcut: savedConfig.newChatShortcut || 'CommandOrControl+N',
          dictationShortcut: savedConfig.dictationShortcut || 'CommandOrControl+D',
          webSearchShortcut: savedConfig.webSearchShortcut || 'CommandOrControl+S',
          youtubeModeShortcut: savedConfig.youtubeModeShortcut || 'CommandOrControl+Y',
          appVersion: savedConfig.appVersion || '',
          ttsVoice: savedConfig.ttsVoice || 'Aoede',
          theme: savedConfig.theme || 'marine',
          zoomFactor: savedConfig.zoomFactor ?? 1.0,
          terminalShell: savedConfig.terminalShell || 'powershell.exe',
          workflows: savedConfig.workflows || [],
          rgbThemeExpiry: savedConfig.rgbThemeExpiry,
          sessionMode: savedConfig.sessionMode || 'execution',
          disciplinePath: savedConfig.disciplinePath || ''
        })
      }
    }
    load()

    const removeConfigListener = window.api.onConfigChanged((cfg) => {
      if (cfg) {
        setConfig((prev) => ({
          ...prev,
          ...cfg,
          providers: cfg.providers || prev.providers || [],
          autoLaunch: cfg.autoLaunch ?? false,
          quickLauncherMode: cfg.quickLauncherMode ?? 'simple',
          screenshotShortcut: cfg.screenshotShortcut || 'Ctrl+Alt+Space',
          newChatShortcut: cfg.newChatShortcut || prev.newChatShortcut || 'CommandOrControl+N',
          dictationShortcut: cfg.dictationShortcut || prev.dictationShortcut || 'CommandOrControl+D',
          webSearchShortcut: cfg.webSearchShortcut || prev.webSearchShortcut || 'CommandOrControl+S',
          youtubeModeShortcut: cfg.youtubeModeShortcut || prev.youtubeModeShortcut || 'CommandOrControl+Y',
          appVersion: cfg.appVersion || '',
          ttsVoice: cfg.ttsVoice || 'Aoede',
          theme: cfg.theme || 'marine',
          zoomFactor: cfg.zoomFactor ?? prev.zoomFactor ?? 1.0,
          terminalShell: cfg.terminalShell ?? prev.terminalShell ?? 'powershell.exe',
          workflows: cfg.workflows || prev.workflows || [],
          rgbThemeExpiry: cfg.rgbThemeExpiry ?? prev.rgbThemeExpiry,
          sessionMode: cfg.sessionMode || prev.sessionMode || 'execution',
          disciplinePath: cfg.disciplinePath ?? prev.disciplinePath ?? ''
        }))
      }
    })
    return () => removeConfigListener()
  }, [])



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
      providers: config.providers || [],
      launcherShortcut: 'CommandOrControl+Space',
      modelSelectionShortcut: 'CommandOrControl+M',
      screenshotShortcut: 'Ctrl+Alt+Space',
      newChatShortcut: 'CommandOrControl+N',
      dictationShortcut: 'CommandOrControl+D',
      webSearchShortcut: 'CommandOrControl+S',
      youtubeModeShortcut: 'CommandOrControl+Y',
      minimizeToTray: false,
      autoLaunch: false,
      quickLauncherMode: 'simple',
      appVersion: config.appVersion,
      ttsVoice: 'Aoede',
      theme: 'marine',
      zoomFactor: 1.0,
      terminalShell: 'powershell.exe',
      workflows: config.workflows,
      sessionMode: 'execution',
      disciplinePath: ''
    })
  }

  const handleSectionChange = (id: SectionId): void => {
    setActiveSection(id)
    if (contentRef.current) {
      contentRef.current.scrollTop = 0
    }
  }

  const sections: NavSection[] = [
    { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={18} weight="bold" /> },
    { id: 'providers', label: 'BYOK', icon: <Key size={18} weight="bold" /> },
    { id: 'intelligence', label: 'Intelligence', icon: <Bot size={18} weight="bold" /> },
    { id: 'runtime', label: 'AI Runtime', icon: <Shield size={18} weight="bold" /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette size={18} weight="bold" /> },
    { id: 'voice', label: 'Voice', icon: <Volume2 size={18} weight="bold" /> },
    { id: 'workflows', label: 'Workflows', icon: <Lightning size={18} weight="bold" /> },
    { id: 'system', label: 'System', icon: <Monitor size={18} weight="bold" /> },
    { id: 'about', label: 'About', icon: <Info size={18} weight="bold" /> }
  ]

  // ─── Section renderers ──────────────────────────────────

  const renderShortcuts = (): React.JSX.Element => (
    <div className="space-y-6 animate-soft-pop">
      <SectionHeader
        title="Keyboard Shortcuts"
        subtitle="Configure global hotkeys and local interface hotkeys to control Prism."
      />

      {/* Global Hotkeys Section */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-text-secondary/40 uppercase tracking-wider">
          Global System Hotkeys
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Quick Launcher Card */}
          <div className="flex flex-col justify-between p-4 rounded-[20px] border border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.035] hover:border-white/[0.1] transition-all">
            <div className="flex items-start gap-3 mb-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary">
                <Keyboard size={16} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-text-primary">Open Quick Launcher</span>
                <span className="text-[10px] text-text-secondary/55 leading-normal mt-0.5">
                  Toggle the launcher search bar from anywhere
                </span>
              </div>
            </div>
            <ShortcutRecorder
              value={config.launcherShortcut}
              onChange={(v) => setConfig({ ...config, launcherShortcut: v })}
            />
          </div>

          {/* Screenshot & Ask Card */}
          <div className="flex flex-col justify-between p-4 rounded-[20px] border border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.035] hover:border-white/[0.1] transition-all">
            <div className="flex items-start gap-3 mb-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary">
                <Camera size={16} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-text-primary">Screenshot &amp; Ask</span>
                <span className="text-[10px] text-text-secondary/55 leading-normal mt-0.5">
                  Capture a screen region to analyze with AI
                </span>
              </div>
            </div>
            <ShortcutRecorder
              value={config.screenshotShortcut}
              onChange={(v) => setConfig({ ...config, screenshotShortcut: v })}
            />
          </div>
        </div>
      </div>

      <div className="h-px bg-white/[0.04]" />

      {/* Local Hotkeys Section */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-text-secondary/40 uppercase tracking-wider">
          Interface &amp; Chat Hotkeys
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Start New Chat Card */}
          <div className="flex flex-col justify-between p-4 rounded-[20px] border border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.035] hover:border-white/[0.1] transition-all">
            <div className="flex items-start gap-3 mb-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary">
                <ChatTeardropText size={16} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-text-primary">Start New Chat</span>
                <span className="text-[10px] text-text-secondary/55 leading-normal mt-0.5">
                  Clear the current conversation thread instantly
                </span>
              </div>
            </div>
            <ShortcutRecorder
              value={config.newChatShortcut}
              onChange={(v) => setConfig({ ...config, newChatShortcut: v })}
            />
          </div>

          {/* Model Selection Card */}
          <div className="flex flex-col justify-between p-4 rounded-[20px] border border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.035] hover:border-white/[0.1] transition-all">
            <div className="flex items-start gap-3 mb-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary">
                <Bot size={16} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-text-primary">Model Picker Toggle</span>
                <span className="text-[10px] text-text-secondary/55 leading-normal mt-0.5">
                  Quickly select a different Gemini model in search bar
                </span>
              </div>
            </div>
            <ShortcutRecorder
              value={config.modelSelectionShortcut}
              onChange={(v) => setConfig({ ...config, modelSelectionShortcut: v })}
            />
          </div>

          {/* Toggle Web Search Card */}
          <div className="flex flex-col justify-between p-4 rounded-[20px] border border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.035] hover:border-white/[0.1] transition-all">
            <div className="flex items-start gap-3 mb-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary">
                <Globe size={16} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-text-primary">Toggle Web Search</span>
                <span className="text-[10px] text-text-secondary/55 leading-normal mt-0.5">
                  Enable or disable web search mode in input bar
                </span>
              </div>
            </div>
            <ShortcutRecorder
              value={config.webSearchShortcut}
              onChange={(v) => setConfig({ ...config, webSearchShortcut: v })}
            />
          </div>



          {/* Voice Dictation Card */}
          <div className="flex flex-col justify-between p-4 rounded-[20px] border border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.035] hover:border-white/[0.1] transition-all">
            <div className="flex items-start gap-3 mb-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary">
                <Microphone size={16} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-text-primary">Voice Dictation</span>
                <span className="text-[10px] text-text-secondary/55 leading-normal mt-0.5">
                  Start or stop speech-to-text recording
                </span>
              </div>
            </div>
            <ShortcutRecorder
              value={config.dictationShortcut}
              onChange={(v) => setConfig({ ...config, dictationShortcut: v })}
            />
          </div>

          {/* YouTube Mode Card */}
          <div className="flex flex-col justify-between p-4 rounded-[20px] border border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.035] hover:border-white/[0.1] transition-all">
            <div className="flex items-start gap-3 mb-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary">
                <YoutubeLogo size={16} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-text-primary">YouTube Mode Toggle</span>
                <span className="text-[10px] text-text-secondary/55 leading-normal mt-0.5">
                  Open YouTube video query assistant panel
                </span>
              </div>
            </div>
            <ShortcutRecorder
              value={config.youtubeModeShortcut}
              onChange={(v) => setConfig({ ...config, youtubeModeShortcut: v })}
            />
          </div>
        </div>
      </div>
    </div>
  )

  const renderIntelligence = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader
        title="Feature Intelligence Model Assignments"
        subtitle="Assign specific AI models for Dictation (STT), Quick Launcher, Search, and Subagents."
      />

      <div className="space-y-6">
        {/* Speech-To-Text Dictator Model */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-[20px] border border-white/[0.08] bg-white/[0.035]">
          <div>
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Microphone size={16} className="text-accent-primary" />
              Dictator (Speech-To-Text / Audio) Model
            </h3>
            <p className="text-xs text-text-secondary/60 mt-1">
              Used for audio transcription when recording voice input.
            </p>
          </div>
          <ModelSelector
            selectedModel={(config as any).sttModel || ''}
            onModelChange={(m) => setConfig({ ...config, sttModel: m } as any)}
          />
        </div>

        {/* Quick Launcher Model */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-[20px] border border-white/[0.08] bg-white/[0.035]">
          <div>
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Lightning size={16} className="text-amber-400" />
              Quick Launcher Assistant Model
            </h3>
            <p className="text-xs text-text-secondary/60 mt-1">
              Used when asking fast questions in the Quick Launcher bar.
            </p>
          </div>
          <ModelSelector
            selectedModel={(config as any).quickLauncherModel || ''}
            onModelChange={(m) => setConfig({ ...config, quickLauncherModel: m } as any)}
          />
        </div>

        {/* Conversation Search Model */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-[20px] border border-white/[0.08] bg-white/[0.035]">
          <div>
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Globe size={16} className="text-emerald-400" />
              Conversation Search Model
            </h3>
            <p className="text-xs text-text-secondary/60 mt-1">
              Used for searching and synthesizing past conversation history.
            </p>
          </div>
          <ModelSelector
            selectedModel={(config as any).searchModel || ''}
            onModelChange={(m) => setConfig({ ...config, searchModel: m } as any)}
          />
        </div>

        {/* Subagent Orchestration Model */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-[20px] border border-white/[0.08] bg-white/[0.035]">
          <div>
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <Bot size={16} className="text-purple-400" />
              Subagents Swarm Model
            </h3>
            <p className="text-xs text-text-secondary/60 mt-1">
              Used by delegated worker subagents during swarm tasks.
            </p>
          </div>
          <ModelSelector
            selectedModel={config.subagentModel || ''}
            onModelChange={(m) => setConfig({ ...config, subagentModel: m })}
          />
        </div>
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

  const renderRuntime = (): React.JSX.Element => (
    <div className="space-y-6 animate-soft-pop">
      <SectionHeader
        title="AI Runtime"
        subtitle="Choose the host terminal Prism uses for guarded AI commands."
      />

      <div className="space-y-4">
        <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.035] p-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              <TerminalWindow size={16} className="text-accent-primary" />
              Local Command Sandbox
            </h3>
            <p className="text-xs text-text-secondary/60 mt-1 leading-normal">
              Prism runs AI terminal commands in the selected system terminal, then blocks dangerous
              system-level operations before execution.
            </p>
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold text-text-secondary/70">
            Terminal CLI Shell
          </span>
          <select
            value={config.terminalShell || 'powershell.exe'}
            onChange={(e) => setConfig({ ...config, terminalShell: e.target.value })}
            className="w-full rounded-[16px] border border-white/[0.08] bg-white/[0.035] px-3 py-2.5 text-xs text-text-primary focus:border-accent-primary/40 focus:outline-none"
          >
            {availableTerminals.map((term) => (
              <option key={term.path} value={term.path} className="bg-[#13151a] text-text-primary">
                {term.name} ({term.path})
              </option>
            ))}
          </select>
          {availableTerminals.length === 0 && (
            <span className="text-[10px] text-text-secondary/50 leading-normal">
              Checking installed terminals...
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5 mt-4">
          <span className="text-[11px] font-semibold text-text-secondary/70">
            Default Session Mode
          </span>
          <select
            value={config.sessionMode || 'execution'}
            onChange={(e) => setConfig({ ...config, sessionMode: e.target.value as any })}
            className="w-full rounded-[16px] border border-white/[0.08] bg-white/[0.035] px-3 py-2.5 text-xs text-text-primary focus:border-accent-primary/40 focus:outline-none"
          >
            <option value="conversation" className="bg-[#13151a] text-text-primary">
              Conversation Mode (Chat only, no tools)
            </option>
            <option value="execution" className="bg-[#13151a] text-text-primary">
              Execution Mode (Operate in USERPROFILE)
            </option>
            <option value="discipline" className="bg-[#13151a] text-text-primary">
              Discipline Mode (Operate inside a project folder)
            </option>
          </select>
        </label>

        {config.sessionMode === 'discipline' && (
          <div className="flex flex-col gap-1.5 mt-4 animate-fade-in">
            <span className="text-[11px] font-semibold text-text-secondary/70">
              Default Discipline Folder
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={config.disciplinePath || ''}
                placeholder="No folder selected"
                className="flex-grow rounded-[16px] border border-white/[0.08] bg-white/[0.035] px-3 py-2.5 text-xs text-text-primary focus:outline-none truncate"
              />
              <button
                type="button"
                onClick={async () => {
                  const selected = await window.api.selectFolder()
                  if (selected) {
                    setConfig({ ...config, disciplinePath: selected })
                  }
                }}
                className="rounded-[16px] bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 px-4 py-2.5 text-xs font-semibold text-text-primary transition-all active:scale-[0.98] cursor-pointer"
              >
                Browse
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  const renderSystem = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader title="System" subtitle="Behavior preferences and API authentication." />

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

      <div className="h-px bg-white/[0.04]" />

      <div className="flex items-start gap-2 rounded-[18px] border border-accent-primary/10 bg-accent-primary/[0.045] p-3">
        <div className="text-accent-secondary shrink-0 mt-0.5">
          <Shield size={14} />
        </div>
        <p className="text-[11px] text-text-secondary/70 leading-normal">
          Your keys are saved locally in an encrypted format. Prism does not collect or share your
          API keys.
        </p>
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
        <span
          onClick={handleVersionClick}
          className="text-xs font-semibold bg-accent-primary/10 border border-accent-primary/20 text-accent-primary rounded-xl px-3 py-1.5 shrink-0 select-none cursor-default"
        >
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



  const handleEditWorkflow = (w: SlashWorkflow): void => {
    setEditingWorkflow(w)
    setFormCommand(w.command)
    setFormName(w.name)
    setFormDescription(w.description || '')
    setFormPrompt(w.systemInstruction)
    setFormTools(w.toolConstraints || [])
    setFormError('')
    setIsAddingWorkflow(false)
  }

  const handleAddWorkflowClick = (): void => {
    setIsAddingWorkflow(true)
    setEditingWorkflow(null)
    setFormCommand('/')
    setFormName('')
    setFormDescription('')
    setFormPrompt('')
    setFormTools([])
    setFormError('')
  }

  const handleSaveWorkflowForm = (): void => {
    if (!formCommand.startsWith('/')) {
      setFormError('Command must start with a slash (/)')
      return
    }
    if (formCommand.includes(' ')) {
      setFormError('Command cannot contain spaces')
      return
    }
    if (formCommand.length <= 1) {
      setFormError('Command is too short')
      return
    }
    if (!formName.trim()) {
      setFormError('Name is required')
      return
    }
    if (!formPrompt.trim()) {
      setFormError('System Instruction is required')
      return
    }

    const wList = config.workflows || []

    // Check duplicate
    const isDuplicate = wList.some(
      (w) =>
        w.command.toLowerCase() === formCommand.toLowerCase() &&
        w.id !== (editingWorkflow?.id || '')
    )
    if (isDuplicate) {
      setFormError(`Workflow with command "${formCommand}" already exists`)
      return
    }

    const targetWorkflow: SlashWorkflow = {
      id: editingWorkflow?.id || Math.random().toString(36).substring(2, 9),
      command: formCommand.trim(),
      name: formName.trim(),
      description: formDescription.trim(),
      systemInstruction: formPrompt,
      toolConstraints: formTools
    }

    let updatedWorkflows: SlashWorkflow[] = []
    if (isAddingWorkflow) {
      updatedWorkflows = [...wList, targetWorkflow]
    } else {
      updatedWorkflows = wList.map((w) => (w.id === editingWorkflow?.id ? targetWorkflow : w))
    }

    const updatedConfig = { ...config, workflows: updatedWorkflows }
    setConfig(updatedConfig)

    // Auto persist to disk
    window.api.saveConfig(updatedConfig)

    setEditingWorkflow(null)
    setIsAddingWorkflow(false)
  }

  const handleDeleteWorkflow = (id: string): void => {
    const updatedWorkflows = (config.workflows || []).filter((w) => w.id !== id)
    const updatedConfig = { ...config, workflows: updatedWorkflows }
    setConfig(updatedConfig)
    window.api.saveConfig(updatedConfig)
  }

  const renderWorkflows = (): React.JSX.Element => {
    if (isAddingWorkflow || editingWorkflow) {
      return (
        <div className="space-y-6 animate-soft-pop">
          <div className="flex items-center justify-between">
            <SectionHeader
              title={isAddingWorkflow ? 'Add Custom Workflow' : 'Edit Custom Workflow'}
              subtitle="Configure your dynamic Gems-style prompt profile and tool constraints."
            />
            <button
              onClick={() => {
                setEditingWorkflow(null)
                setIsAddingWorkflow(false)
              }}
              className="rounded-xl px-4 py-2 text-xs font-semibold border border-white/10 bg-white/[0.03] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-all active:scale-[0.98] cursor-pointer"
            >
              Back to List
            </button>
          </div>

          {formError && (
            <div className="flex items-center gap-2 rounded-xl border border-status-error/15 bg-status-error/[0.08] p-3 text-xs text-status-error font-semibold">
              <Warning size={14} />
              <span>{formError}</span>
            </div>
          )}

          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-text-secondary/70">
                  Trigger Command
                </label>
                <input
                  type="text"
                  value={formCommand}
                  onChange={(e) => setFormCommand(e.target.value)}
                  placeholder="e.g. /summarize"
                  disabled={!isAddingWorkflow}
                  className="rounded-[18px] border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-text-primary placeholder:text-text-muted transition-all focus:border-accent-primary/40 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className="text-[10px] text-text-secondary/40 leading-normal">
                  Must start with a slash (/) and cannot contain spaces. Cannot be modified after
                  creation.
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-text-secondary/70">
                  Workflow Name
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Summarizer"
                  className="rounded-[18px] border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-text-primary placeholder:text-text-muted transition-all focus:border-accent-primary/40 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-text-secondary/70">
                Brief Description
              </label>
              <input
                type="text"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="e.g. Summarize text and check for spelling errors"
                className="w-full rounded-[18px] border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-text-primary placeholder:text-text-muted transition-all focus:border-accent-primary/40 focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-text-secondary/70">
                System Instructions
              </label>
              <textarea
                value={formPrompt}
                onChange={(e) => setFormPrompt(e.target.value)}
                rows={6}
                placeholder="Write system instructions that explain to the model what role it should take, what it should do with the input, and how it should format the output."
                className="w-full rounded-[18px] border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-text-primary placeholder:text-text-muted transition-all focus:border-accent-primary/40 focus:outline-none resize-none font-medium leading-relaxed"
              />
            </div>

            <div className="space-y-3">
              <label className="text-xs font-semibold text-text-secondary/70 block">
                Allowed Tools (Mechanical Constraints)
              </label>
              <span className="text-[10px] text-text-secondary/40 leading-normal block -mt-2 mb-2">
                Check the tools the AI is allowed to use during this workflow. Unchecked tools will
                be completely hidden from the AI prompt, and blocked during runtime. Leave all
                unchecked to allow default conversational behavior without tools.
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar border border-white/[0.06] rounded-[20px] bg-white/[0.015] p-3">
                {availableTools.map((tool) => {
                  const isChecked = formTools.includes(tool.name)
                  return (
                    <button
                      key={tool.name}
                      type="button"
                      onClick={() => {
                        if (isChecked) {
                          setFormTools(formTools.filter((t) => t !== tool.name))
                        } else {
                          setFormTools([...formTools, tool.name])
                        }
                      }}
                      className={clsx(
                        'flex items-start gap-3 rounded-[16px] border p-3 text-left transition-all duration-150 active:scale-[0.98] cursor-pointer',
                        isChecked
                          ? 'border-accent-primary/30 bg-accent-primary/[0.07] text-text-primary'
                          : 'border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.045] text-text-secondary'
                      )}
                    >
                      <div className="flex items-center h-5 shrink-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          readOnly
                          className="w-3.5 h-3.5 rounded border-white/20 bg-transparent text-accent-primary focus:ring-0 focus:ring-offset-0 cursor-pointer pointer-events-none accent-accent-primary"
                        />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-text-primary leading-tight">
                          {tool.label}
                        </span>
                        <span className="text-[9px] text-text-secondary/60 leading-tight mt-0.5">
                          {tool.desc}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={handleSaveWorkflowForm}
                className="flex items-center gap-2 rounded-2xl bg-text-primary px-6 py-2.5 text-sm font-semibold text-black hover:bg-white transition-all active:scale-[0.98] cursor-pointer"
              >
                <Save size={16} />
                Save Workflow
              </button>
            </div>
          </div>
        </div>
      )
    }

    const wList = config.workflows || []

    return (
      <div className="space-y-6 animate-soft-pop">
        <div className="flex items-center justify-between">
          <SectionHeader
            title="Slash Workflows"
            subtitle="Create and customize prompt profiles triggered by typing slash commands in the message box."
          />
          <button
            onClick={handleAddWorkflowClick}
            className="flex items-center gap-1.5 rounded-2xl bg-accent-primary px-4 py-2.5 text-xs font-semibold text-black hover:bg-accent-primary/95 transition-all active:scale-[0.98] cursor-pointer"
          >
            <Plus size={14} weight="bold" />
            Add Workflow
          </button>
        </div>

        {wList.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-white/[0.08] bg-white/[0.015] p-10 text-center select-none">
            <Lightning size={36} className="text-text-secondary/40 mb-3 animate-pulse" />
            <span className="text-sm font-semibold text-text-secondary/70">
              No Workflows Configured
            </span>
            <span className="text-xs text-text-secondary/40 mt-1 max-w-sm">
              Click the &quot;Add Workflow&quot; button above to create your first customizable
              Gems-style prompt profile!
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            {wList.map((w) => (
              <div
                key={w.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between rounded-[20px] border border-white/[0.08] bg-white/[0.035] p-4 gap-4 transition-all duration-200 hover:border-white/[0.12]"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary">
                    <Lightning size={20} weight="fill" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-text-primary">{w.name}</span>
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-accent-primary/15 text-accent-primary border border-accent-primary/20">
                        {w.command}
                      </span>
                      {w.toolConstraints && w.toolConstraints.length > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-accent-secondary/15 text-accent-secondary border border-accent-secondary/20 font-mono">
                          {w.toolConstraints.length} tools
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-text-secondary/70 mt-1">{w.description}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 sm:self-center self-end">
                  <button
                    onClick={() => handleEditWorkflow(w)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/5 bg-white/[0.02] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-all active:scale-[0.96] cursor-pointer"
                    title="Edit Workflow"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDeleteWorkflow(w.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-status-error/10 bg-status-error/[0.02] text-status-error hover:bg-status-error/[0.08] transition-all active:scale-[0.96] cursor-pointer"
                    title="Delete Workflow"
                  >
                    <Trash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderActiveSection = (): React.JSX.Element => {
    switch (activeSection) {
      case 'shortcuts':
        return renderShortcuts()
      case 'providers':
        return <ApiManagerSettings />
      case 'intelligence':
        return renderIntelligence()
      case 'runtime':
        return renderRuntime()
      case 'appearance':
        return renderAppearance()
      case 'voice':
        return renderVoice()
      case 'workflows':
        return renderWorkflows()
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

          {onClose && (
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-text-secondary hover:bg-white/[0.05] hover:text-text-primary transition-all duration-200 active:scale-95 cursor-pointer"
              title="Close settings"
            >
              <X size={18} weight="bold" />
            </button>
          )}
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

      {/* ─── Easter Egg Fruit Ninja Game Modal Overlay ─── */}
      {isEasterEggOpen && <DocumentShredderGame onClose={() => setIsEasterEggOpen(false)} />}
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
