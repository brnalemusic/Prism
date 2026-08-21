import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
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
  Certificate,
  Eye,
  EyeSlash,
  CircleNotch,
  Clock,
  CreditCard,
  Sparkle,
  CheckCircle,
  X,
  CaretDown,
  ArrowClockwise,
  FilePpt,
  FilePdf,
  MagnifyingGlass,
  Sliders,
  FolderOpen,
  Waveform
} from '@phosphor-icons/react'
import { ShortcutRecorder } from './ShortcutRecorder'
import { EnterpriseActivationModal } from './EnterpriseActivationModal'
import clsx from 'clsx'
import type { AppConfig, SlashWorkflow } from '../../../main/config'
import type { SessionMode } from '../../../shared/types'
import { ApiManagerSettings } from './ApiManagerSettings'
import { ModelSelector } from './ModelSelector'
import { QuantumPhysicsGame } from './QuantumPhysicsGame'

type Config = AppConfig

type SectionId =
  | 'appearance'
  | 'shortcuts'
  | 'system'
  | 'voice'
  | 'providers'
  | 'intelligence'
  | 'runtime'
  | 'skills'
  | 'workflows'
  | 'discord'
  | 'license'
  | 'about'

type SectionCategory = 'general' | 'ai' | 'integrations'

interface NavSection {
  id: SectionId
  label: string
  icon: React.ReactNode
  category: SectionCategory
  categoryLabel: string
  description: string
  keywords: string[]
}

function DiscordIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 199"
      width={size}
      height={size}
      fill="currentColor"
    >
      <path d="M216.856 16.597A208.502 208.502 0 0 0 164.042 0c-2.275 4.113-4.933 9.645-6.766 14.046-19.692-2.961-39.203-2.961-58.533 0-1.832-4.4-4.55-9.933-6.846-14.046a207.809 207.809 0 0 0-52.855 16.638C5.618 67.147-3.443 116.4 1.087 164.956c22.169 16.555 43.653 26.612 64.775 33.193A161.094 161.094 0 0 0 79.735 175.3a136.413 136.413 0 0 1-21.846-10.632 108.636 108.636 0 0 0 5.356-4.237c42.122 19.702 87.89 19.702 129.51 0a131.6 131.6 0 0 0 5.356 4.237 136.075 136.075 0 0 1-21.887 10.632 156.776 156.776 0 0 0 13.873 22.846c21.122-6.58 42.605-16.638 64.774-33.193 5.485-57.818-10.985-107.031-48.423-148.358zM85.474 135.04c-11.832 0-21.606-10.793-21.606-24.088 0-13.296 9.57-24.088 21.606-24.088 12.036 0 21.809 10.954 21.606 24.088 0 13.295-9.57 24.088-21.606 24.088zm85.05 0c-11.833 0-21.607-10.793-21.607-24.088 0-13.296 9.57-24.088 21.607-24.088 12.036 0 21.81 10.954 21.607 24.088 0 13.295-9.773 24.088-21.607 24.088z" />
    </svg>
  )
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

function useLicenseCountdown(expiresAt?: string): string {
  const [timeLeft, setTimeLeft] = useState('')

  useEffect(() => {
    if (!expiresAt) {
      setTimeLeft('')
      return
    }

    const update = () => {
      const now = Date.now()
      const expiry = new Date(expiresAt).getTime()
      const diff = expiry - now

      if (diff <= 0) {
        setTimeLeft('Expired')
        return
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24))
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)

      const pad = (n: number) => String(n).padStart(2, '0')

      if (days > 0) {
        setTimeLeft(`${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`)
      } else if (hours > 0) {
        setTimeLeft(`${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`)
      } else {
        setTimeLeft(`${pad(minutes)}m ${pad(seconds)}s`)
      }
    }

    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [expiresAt])

  return timeLeft
}

export function SettingsView({
  onClose,
  onOpenAuthModal,
  initialSection = 'appearance'
}: {
  onClose?: () => void
  onOpenAuthModal?: () => void
  initialSection?: SectionId
}): React.JSX.Element {
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
  const [activeSection, setActiveSection] = useState<SectionId>(initialSection)
  const [searchNavQuery, setSearchNavQuery] = useState('')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [showDiscordToken, setShowDiscordToken] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection)
      if (initialSection === 'license') {
        void loadSubscriptionPlans()
      }
    }
  }, [initialSection])

  // Workflow state
  const [editingWorkflow, setEditingWorkflow] = useState<SlashWorkflow | null>(null)
  const [isAddingWorkflow, setIsAddingWorkflow] = useState(false)
  const [formCommand, setFormCommand] = useState('')
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPrompt, setFormPrompt] = useState('')
  const [formTools, setFormTools] = useState<string[]>([])
  const [formError, setFormError] = useState('')
  const [toolSearchQuery, setToolSearchQuery] = useState('')

  const [availableTools, setAvailableTools] =
    useState<Array<{ name: string; label: string; desc: string }>>(STATIC_TOOLS)

  // Easter Egg State
  const [easterEggClicks, setEasterEggClicks] = useState(0)
  const [lastClickTimestamp, setLastClickTimestamp] = useState(0)
  const [isEasterEggOpen, setIsEasterEggOpen] = useState(false)

  // License State
  const [licenseInfo, setLicenseInfo] = useState<
    import('../../../shared/types').LicenseInfo | null
  >(null)
  const [inputLicenseKey, setInputLicenseKey] = useState('')
  const [showKeyText, setShowKeyText] = useState(false)
  const [activating, setActivating] = useState(false)
  const [activationStepMessage, setActivationStepMessage] = useState('Initializing verification...')
  const [licenseError, setLicenseError] = useState<string | null>(null)
  const [licenseSuccess, setLicenseSuccess] = useState<string | null>(null)
  const [isActivationModalOpen, setIsActivationModalOpen] = useState(false)
  const [stripeVerifying, setStripeVerifying] = useState(false)

  // Stripe & Auth State
  const [authUser, setAuthUser] = useState<import('../../../shared/types').UserProfile | null>(null)
  const [plans, setPlans] = useState<import('../../../shared/types').SubscriptionPlan[]>([])
  const [isLoadingPlans, setIsLoadingPlans] = useState(false)
  const [plansError, setPlansError] = useState<string | null>(null)
  const [checkoutLoadingPlanId, setCheckoutLoadingPlanId] = useState<string | null>(null)
  const [stripeCheckoutStage, setStripeCheckoutStage] = useState<'opening' | 'polling'>('opening')
  const [pendingSessionIds, setPendingSessionIds] = useState<Record<string, string>>({})

  const settingsPollRef = useRef<NodeJS.Timeout | null>(null)
  const isPaymentVerificationInFlightRef = useRef(false)

  const stopSettingsPolling = (): void => {
    if (settingsPollRef.current) {
      clearInterval(settingsPollRef.current)
      settingsPollRef.current = null
    }
    isPaymentVerificationInFlightRef.current = false
  }

  useEffect(() => {
    return () => {
      stopSettingsPolling()
    }
  }, [])

  const countdownText = useLicenseCountdown(licenseInfo?.expiresAt)

  useEffect(() => {
    window.api
      .getAuthUser()
      .then((u) => setAuthUser(u))
      .catch(() => setAuthUser(null))
  }, [])

  useEffect(() => {
    window.api
      .getLicenseInfo()
      .then((info) => setLicenseInfo(info))
      .catch(() => setLicenseInfo(null))
  }, [config?.licenseKey])

  const loadSubscriptionPlans = async (): Promise<void> => {
    setIsLoadingPlans(true)
    setPlansError(null)
    try {
      const fetchedPlans = await window.api.getSubscriptionPlans()
      setPlans(fetchedPlans)
    } catch (err) {
      console.error('Failed to load subscription plans:', err)
      setPlans([])
      setPlansError('Pricing could not be loaded. Check your connection and try again.')
    } finally {
      setIsLoadingPlans(false)
    }
  }

  const handleBuyPlan = async (
    plan: import('../../../shared/types').SubscriptionPlan
  ): Promise<void> => {
    setCheckoutLoadingPlanId(plan.id)
    setLicenseError(null)
    setStripeVerifying(true)
    setStripeCheckoutStage('opening')

    try {
      const email = authUser?.email || ''
      const company = authUser?.companyName || authUser?.fullName || 'Enterprise Licensee'
      const res = await window.api.createCheckoutSession(plan.id, email)

      if (res.success && res.checkoutUrl && res.sessionId) {
        const openResult = await window.api.openExternalUrl(res.checkoutUrl)
        if (!openResult.success) {
          setStripeVerifying(false)
          setLicenseError(openResult.error || 'Unable to open checkout in browser.')
          return
        }
        setPendingSessionIds((prev) => ({ ...prev, [plan.id]: res.sessionId! }))
        setStripeCheckoutStage('polling')

        stopSettingsPolling()
        settingsPollRef.current = setInterval(async () => {
          if (isPaymentVerificationInFlightRef.current) return
          isPaymentVerificationInFlightRef.current = true

          try {
            const verifyRes = await window.api.verifyAndActivatePayment(
              plan.id,
              res.sessionId!,
              email || 'customer@prism.app',
              company
            )

            if (verifyRes.success) {
              stopSettingsPolling()
              const info = await window.api.getLicenseInfo()
              if (info) setLicenseInfo(info)

              setTimeout(() => {
                setStripeVerifying(false)
                setIsActivationModalOpen(true)
              }, 1500)
            } else if (!verifyRes.pending) {
              stopSettingsPolling()
              setStripeVerifying(false)
              setLicenseError(verifyRes.error || 'Payment verification failed. Please try again.')
            }
          } catch (pollErr) {
            console.warn('[SettingsStripePolling] Payment verification failed:', pollErr)
            stopSettingsPolling()
            setStripeVerifying(false)
            setLicenseError('Unable to verify payment. Please try again.')
          } finally {
            isPaymentVerificationInFlightRef.current = false
          }
        }, 2000)
      } else {
        stopSettingsPolling()
        setStripeVerifying(false)
        setLicenseError(res.error || 'Failed to launch Stripe Checkout.')
      }
    } catch (err: any) {
      stopSettingsPolling()
      setStripeVerifying(false)
      setLicenseError(err?.message || 'Error initializing checkout.')
    } finally {
      setCheckoutLoadingPlanId(null)
    }
  }

  const handleVerifyAndActivate = async (
    plan: import('../../../shared/types').SubscriptionPlan
  ): Promise<void> => {
    const sessionId = pendingSessionIds[plan.id]
    if (!sessionId) {
      setLicenseError('No Stripe payment session found. Click "Buy via Stripe" first.')
      return
    }

    setStripeVerifying(true)
    setLicenseError(null)

    try {
      const email = authUser?.email || 'customer@prism.app'
      const company = authUser?.companyName || authUser?.fullName || 'Enterprise Licensee'

      const res = await window.api.verifyAndActivatePayment(plan.id, sessionId, email, company)

      if (res.success) {
        setPendingSessionIds((prev) => {
          const next = { ...prev }
          delete next[plan.id]
          return next
        })
        const info = await window.api.getLicenseInfo()
        if (info) {
          setLicenseInfo(info)
          setIsActivationModalOpen(true)
        }
      } else {
        setLicenseError(res.error || 'Payment verification failed.')
      }
    } catch (err: any) {
      setLicenseError(err?.message || 'Error confirming payment.')
    } finally {
      setStripeVerifying(false)
    }
  }

  const handleActivateLicense = async (): Promise<void> => {
    if (!inputLicenseKey.trim()) return
    setActivating(true)
    setLicenseError(null)
    setLicenseSuccess(null)

    try {
      setActivationStepMessage('Connecting to Prism Licensing Engine...')
      await new Promise((r) => setTimeout(r, 400))

      setActivationStepMessage('Verifying Cryptographic Ed25519 Signature...')
      await new Promise((r) => setTimeout(r, 500))

      setActivationStepMessage('Validating Enterprise License Entitlements...')
      const res = await window.api.activateLicense(inputLicenseKey)
      await new Promise((r) => setTimeout(r, 400))

      if (res.success && res.info) {
        setLicenseInfo(res.info)
        setLicenseSuccess(`Enterprise License activated for ${res.info.licensee}!`)
        setInputLicenseKey('')
        setIsActivationModalOpen(true)
      } else {
        setLicenseError(res.error || 'Invalid license key.')
      }
    } catch (err: any) {
      setLicenseError(err?.message || 'Failed to activate license key.')
    } finally {
      setActivating(false)
    }
  }

  const handleDeactivateLicense = async (): Promise<void> => {
    try {
      const ok = await window.api.deactivateLicense()
      if (ok) {
        setLicenseInfo(null)
        setLicenseSuccess('Enterprise License deactivated.')
      }
    } catch {
      setLicenseError('Failed to deactivate license.')
    }
  }

  const handleVersionClick = (): void => {
    const now = Date.now()
    if (now - lastClickTimestamp > 3000) {
      setEasterEggClicks(1)
    } else {
      const newCount = easterEggClicks + 1
      if (newCount >= 5) {
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
          dictationShortcut:
            cfg.dictationShortcut || prev.dictationShortcut || 'CommandOrControl+D',
          webSearchShortcut:
            cfg.webSearchShortcut || prev.webSearchShortcut || 'CommandOrControl+S',
          youtubeModeShortcut:
            cfg.youtubeModeShortcut || prev.youtubeModeShortcut || 'CommandOrControl+Y',
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
      setMessage({ text: 'Settings saved successfully', type: 'success' })
    } else {
      setMessage({ text: 'Failed to save settings', type: 'error' })
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
    setIsMobileMenuOpen(false)
    if (id === 'license') {
      void loadSubscriptionPlans()
    }
    if (contentRef.current) {
      contentRef.current.scrollTop = 0
    }
  }

  const sections: NavSection[] = [
    // General
    {
      id: 'appearance',
      label: 'Appearance',
      icon: <Palette size={17} weight="duotone" />,
      category: 'general',
      categoryLabel: 'General',
      description: 'Color theme accents and desktop window scaling.',
      keywords: ['theme', 'color', 'dark', 'light', 'zoom', 'scaling', 'ui', 'size']
    },
    {
      id: 'shortcuts',
      label: 'Shortcuts',
      icon: <Keyboard size={17} weight="duotone" />,
      category: 'general',
      categoryLabel: 'General',
      description: 'Global system hotkeys and in-app keyboard shortcuts.',
      keywords: ['hotkeys', 'keybinds', 'keys', 'launcher', 'screenshot', 'dictation', 'search']
    },
    {
      id: 'system',
      label: 'System & Tray',
      icon: <Monitor size={17} weight="duotone" />,
      category: 'general',
      categoryLabel: 'General',
      description: 'Startup behavior, system tray minimize, and quick search mode.',
      keywords: ['tray', 'minimize', 'startup', 'login', 'autostart', 'launcher mode', 'security']
    },
    {
      id: 'voice',
      label: 'Voice & TTS',
      icon: <Volume2 size={17} weight="duotone" />,
      category: 'general',
      categoryLabel: 'General',
      description: 'Text-to-speech voice profiles for spoken responses.',
      keywords: ['voice', 'speech', 'audio', 'tts', 'talk', 'sound', 'speaker']
    },

    // AI & Runtime
    {
      id: 'providers',
      label: 'BYOK Providers',
      icon: <Key size={17} weight="duotone" />,
      category: 'ai',
      categoryLabel: 'AI & Runtime',
      description: 'Custom API keys, OpenAI endpoints, and official providers.',
      keywords: ['api', 'keys', 'openai', 'gemini', 'anthropic', 'openrouter', 'groq', 'nvidia', 'providers']
    },
    {
      id: 'intelligence',
      label: 'Intelligence Routing',
      icon: <Bot size={17} weight="duotone" />,
      category: 'ai',
      categoryLabel: 'AI & Runtime',
      description: 'Assign dedicated models for Dictation, Quick Search, and Search.',
      keywords: ['models', 'dictator', 'stt', 'routing', 'quick launcher', 'search model', 'ai']
    },
    {
      id: 'runtime',
      label: 'AI Runtime & Sandbox',
      icon: <TerminalWindow size={17} weight="duotone" />,
      category: 'ai',
      categoryLabel: 'AI & Runtime',
      description: 'CLI shell selection, execution modes, and folder sandbox.',
      keywords: ['terminal', 'shell', 'powershell', 'bash', 'cmd', 'sandbox', 'session mode', 'discipline']
    },
    {
      id: 'skills',
      label: 'AI Execution Skills',
      icon: <Sparkle size={17} weight="duotone" />,
      category: 'ai',
      categoryLabel: 'AI & Runtime',
      description: 'Modular execution skills for PowerPoint, PDF, and Browser automation.',
      keywords: ['skills', 'pptx', 'powerpoint', 'pdf', 'browser', 'playwright', 'tools']
    },
    {
      id: 'workflows',
      label: 'Slash Workflows',
      icon: <Lightning size={17} weight="duotone" />,
      category: 'ai',
      categoryLabel: 'AI & Runtime',
      description: 'Custom prompt profiles triggered by typing slash commands.',
      keywords: ['workflows', 'slash', 'commands', 'gems', 'custom prompt', 'prompts', 'templates']
    },

    // Integrations & Info
    {
      id: 'discord',
      label: 'Discord Gateway',
      icon: <DiscordIcon size={17} />,
      category: 'integrations',
      categoryLabel: 'Integrations & Info',
      description: 'Connect Prism to Discord with text responses and Gemini Live voice.',
      keywords: ['discord', 'bot', 'gateway', 'realtime voice', 'live', 'token']
    },
    {
      id: 'license',
      label: 'Enterprise License',
      icon: <Certificate size={17} weight="duotone" />,
      category: 'integrations',
      categoryLabel: 'Integrations & Info',
      description: 'Commercial license status, Supabase plans, and key activation.',
      keywords: ['license', 'enterprise', 'stripe', 'subscription', 'plan', 'billing', 'activation']
    },
    {
      id: 'about',
      label: 'About Prism',
      icon: <Info size={17} weight="duotone" />,
      category: 'integrations',
      categoryLabel: 'Integrations & Info',
      description: 'Application version, runtime engine versions, and credits.',
      keywords: ['about', 'version', 'electron', 'chromium', 'node', 'credits', 'easter egg']
    }
  ]

  // Filter sections by search query
  const filteredSections = sections.filter((s) => {
    if (!searchNavQuery.trim()) return true
    const q = searchNavQuery.toLowerCase()
    return (
      s.label.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.keywords.some((k) => k.toLowerCase().includes(q)) ||
      s.categoryLabel.toLowerCase().includes(q)
    )
  })

  const activeNavSection = sections.find((s) => s.id === activeSection) || sections[0]

  // --- Skills helpers ---
  const isSkillEnabledInSettings = (skillKey: string): boolean => {
    const disabled = config.disabledSkills || []
    return !disabled.includes(skillKey)
  }

  const toggleSkillInSettings = (skillKey: string): void => {
    const currentDisabled = config.disabledSkills || []
    let newDisabled: string[]
    if (currentDisabled.includes(skillKey)) {
      newDisabled = currentDisabled.filter((k) => k !== skillKey)
    } else {
      newDisabled = [...currentDisabled, skillKey]
    }
    const updatedConfig = { ...config, disabledSkills: newDisabled }
    setConfig(updatedConfig)
    window.api.saveConfig({ disabledSkills: newDisabled })
  }

  // --- Workflows handlers ---
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
    window.api.saveConfig({ workflows: updatedWorkflows })

    setEditingWorkflow(null)
    setIsAddingWorkflow(false)
  }

  const handleDeleteWorkflow = (id: string): void => {
    const updatedWorkflows = (config.workflows || []).filter((w) => w.id !== id)
    const updatedConfig = { ...config, workflows: updatedWorkflows }
    setConfig(updatedConfig)
    window.api.saveConfig({ workflows: updatedWorkflows })
  }

  // ─────────────────────────────────────────────────────────────
  // Section Renderers
  // ─────────────────────────────────────────────────────────────

  const renderAppearance = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader
        title="Appearance & Scaling"
        subtitle="Personalize Prism's ambient accent colors and interface scaling factor."
      />

      {/* Theme selection */}
      <div className="space-y-3.5">
        <SettingsGroupLabel
          title="Color Theme"
          description="Chooses the vibrant glow accent and tonal surfaces while keeping deep OLED blacks."
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              { id: 'marine', label: 'Marine', accent: '#38bdf8', sidebar: '#030D15', tag: 'Default' },
              { id: 'fire', label: 'Fire', accent: '#ff3b2f', sidebar: '#150607' },
              { id: 'lava', label: 'Lava', accent: '#ff6b00', sidebar: '#160900' },
              { id: 'gold', label: 'Gold', accent: '#f5c518', sidebar: '#151100' },
              { id: 'forest', label: 'Forest', accent: '#22c55e', sidebar: '#04120A' },
              { id: 'indigo', label: 'Indigo', accent: '#6366f1', sidebar: '#070918' },
              { id: 'violet', label: 'Violet', accent: '#a855f7', sidebar: '#100718' },
              { id: 'white', label: 'White', accent: '#ffffff', sidebar: '#080808' }
            ] as Array<{
              id: 'marine' | 'fire' | 'lava' | 'gold' | 'forest' | 'indigo' | 'violet' | 'white'
              label: string
              accent: string
              sidebar: string
              tag?: string
            }>
          ).map(({ id, label, accent, sidebar, tag }) => {
            const isActive = (config.theme || 'marine') === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setConfig({ ...config, theme: id })
                  document.documentElement.setAttribute('data-theme', id)
                  window.api.saveConfig({ theme: id })
                }}
                className={clsx(
                  'group relative flex items-center gap-3.5 rounded-xl border p-3.5 text-left transition-all duration-200 cursor-pointer outline-none active:scale-[0.98]',
                  isActive
                    ? 'border-accent-primary/60 bg-accent-primary/[0.08] shadow-[0_0_20px_var(--accent-glow)] ring-1 ring-accent-primary/30'
                    : 'border-[var(--border-default)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)]'
                )}
              >
                <div
                  className="relative h-10 w-10 shrink-0 rounded-lg border border-white/10 flex items-center justify-center transition-transform group-hover:scale-105"
                  style={{ background: sidebar }}
                >
                  <span
                    className="h-4 w-4 rounded-full shadow-md"
                    style={{ background: accent }}
                  />
                  {isActive && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent-primary text-black">
                      <Check size={10} weight="bold" />
                    </span>
                  )}
                </div>

                <div className="flex flex-col min-w-0">
                  <span
                    className={clsx(
                      'text-xs font-semibold truncate',
                      isActive ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'
                    )}
                  >
                    {label}
                  </span>
                  <span className="text-[10px] text-text-muted font-mono mt-0.5">
                    {tag ? tag : accent}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="h-px bg-[var(--border-subtle)]" />

      {/* Interface Zoom */}
      <div className="space-y-4">
        <SettingsGroupLabel
          title="Interface Scaling"
          description="Adjust the visual scaling factor of all Prism application windows and UI components."
        />

        <div className="settings-card space-y-5">
          {/* Readout and fine adjustment */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
                <ZoomIcon size={20} weight="duotone" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-text-primary">Current Scale</span>
                <span className="text-[11px] text-text-muted">Default is 100% (1.0x)</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const val = Math.max(0.5, Math.round((config.zoomFactor - 0.05) * 100) / 100)
                  setConfig({ ...config, zoomFactor: val })
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-lowest)] text-sm font-semibold text-text-secondary hover:text-text-primary hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)] active:scale-95 transition-all cursor-pointer select-none"
                title="Decrease scale by 5%"
              >
                −
              </button>

              <span className="font-mono text-xl font-bold text-accent-primary min-w-[65px] text-center">
                {Math.round(config.zoomFactor * 100)}%
              </span>

              <button
                type="button"
                onClick={() => {
                  const val = Math.min(3.0, Math.round((config.zoomFactor + 0.05) * 100) / 100)
                  setConfig({ ...config, zoomFactor: val })
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-lowest)] text-sm font-semibold text-text-secondary hover:text-text-primary hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)] active:scale-95 transition-all cursor-pointer select-none"
                title="Increase scale by 5%"
              >
                +
              </button>
            </div>
          </div>

          {/* Interactive Range Slider */}
          <div className="space-y-1.5">
            <div className="relative flex items-center h-6">
              <div className="absolute inset-y-0 left-0 right-0 flex items-center">
                <div className="w-full h-1.5 rounded-full bg-[var(--surface-raised)] border border-[var(--border-subtle)]" />
              </div>
              <div
                className="absolute inset-y-0 left-0 flex items-center pointer-events-none"
                style={{ width: `${((config.zoomFactor - 0.5) / (3.0 - 0.5)) * 100}%` }}
              >
                <div
                  className="h-1.5 rounded-full w-full transition-all duration-75"
                  style={{ background: 'var(--accent-primary)', opacity: 0.8 }}
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

            <div className="flex justify-between text-[10px] text-text-muted font-mono px-0.5">
              <span>50%</span>
              <span>100% (Default)</span>
              <span>200%</span>
              <span>300%</span>
            </div>
          </div>

          {/* Presets chips */}
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-[var(--border-subtle)]">
            <span className="text-[11px] font-semibold text-text-muted mr-1 font-mono uppercase tracking-wider">
              Presets:
            </span>
            {[50, 75, 100, 125, 150, 175, 200].map((preset) => {
              const val = preset / 100
              const isActive = Math.round(config.zoomFactor * 100) === preset
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setConfig({ ...config, zoomFactor: val })}
                  className={clsx(
                    'rounded-lg px-2.5 py-1 text-xs font-semibold font-mono border transition-all active:scale-95 cursor-pointer',
                    isActive
                      ? 'border-accent-primary bg-accent-primary/15 text-accent-primary shadow-[0_0_10px_var(--accent-glow)]'
                      : 'border-[var(--border-default)] bg-[var(--surface-lowest)] text-text-secondary hover:bg-[var(--surface-raised)] hover:text-text-primary hover:border-[var(--border-strong)]'
                  )}
                >
                  {preset}%
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setConfig({ ...config, zoomFactor: 1.0 })}
              className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold border border-[var(--border-default)] bg-[var(--surface-lowest)] text-text-muted hover:text-text-primary hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)] transition-all active:scale-95 cursor-pointer"
            >
              <RotateCcw size={12} />
              Reset (100%)
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  const renderShortcuts = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader
        title="Keyboard Shortcuts"
        subtitle="Configure system-wide hotkeys and local interface hotkeys to control Prism."
      />

      {/* Global Hotkeys */}
      <div className="space-y-3.5">
        <SettingsGroupLabel
          title="Global System Hotkeys"
          description="Trigger Prism actions from anywhere on your computer, even when the app is minimized."
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ShortcutCard
            icon={<Keyboard size={18} weight="duotone" className="text-accent-primary" />}
            title="Open Quick Launcher"
            description="Toggle the floating search and prompt bar instantly."
            value={config.launcherShortcut}
            onChange={(v) => setConfig({ ...config, launcherShortcut: v })}
          />

          <ShortcutCard
            icon={<Camera size={18} weight="duotone" className="text-accent-primary" />}
            title="Screenshot & Ask"
            description="Capture a screen region to analyze with AI vision."
            value={config.screenshotShortcut}
            onChange={(v) => setConfig({ ...config, screenshotShortcut: v })}
          />
        </div>
      </div>

      <div className="h-px bg-[var(--border-subtle)]" />

      {/* Interface Hotkeys */}
      <div className="space-y-3.5">
        <SettingsGroupLabel
          title="In-App Interface Hotkeys"
          description="Quick navigation and interaction shortcuts while inside the Prism workspace."
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ShortcutCard
            icon={<ChatTeardropText size={18} weight="duotone" className="text-accent-primary" />}
            title="Start New Chat"
            description="Create a fresh conversation thread in one stroke."
            value={config.newChatShortcut}
            onChange={(v) => setConfig({ ...config, newChatShortcut: v })}
          />

          <ShortcutCard
            icon={<Bot size={18} weight="duotone" className="text-accent-primary" />}
            title="Model Picker Toggle"
            description="Open model switcher popover in the chat input."
            value={config.modelSelectionShortcut}
            onChange={(v) => setConfig({ ...config, modelSelectionShortcut: v })}
          />

          <ShortcutCard
            icon={<Globe size={18} weight="duotone" className="text-accent-primary" />}
            title="Toggle Web Search"
            description="Switch live DuckDuckGo web search on or off."
            value={config.webSearchShortcut}
            onChange={(v) => setConfig({ ...config, webSearchShortcut: v })}
          />

          <ShortcutCard
            icon={<Microphone size={18} weight="duotone" className="text-accent-primary" />}
            title="Voice Dictation"
            description="Start or stop speech-to-text recording mode."
            value={config.dictationShortcut}
            onChange={(v) => setConfig({ ...config, dictationShortcut: v })}
          />

          <ShortcutCard
            icon={<YoutubeLogo size={18} weight="duotone" className="text-accent-primary" />}
            title="YouTube Mode Toggle"
            description="Open video analyzer panel for any YouTube URL."
            value={config.youtubeModeShortcut}
            onChange={(v) => setConfig({ ...config, youtubeModeShortcut: v })}
          />
        </div>
      </div>
    </div>
  )

  const renderIntelligence = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader
        title="Intelligence Model Routing"
        subtitle="Assign specific AI models for Dictation (STT), Quick Launcher, and Search features."
      />

      <div className="space-y-4">
        {/* Dictator Model */}
        <div className="settings-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
              <Microphone size={20} weight="duotone" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold text-text-primary">
                Dictator (Speech-To-Text / Audio) Model
              </span>
              <span className="text-xs text-text-secondary/70 mt-0.5 leading-relaxed">
                Processes recorded audio when using the microphone dictation shortcut.
              </span>
            </div>
          </div>
          <div className="shrink-0">
            <ModelSelector
              selectedModel={(config as any).sttModel || ''}
              onModelChange={(m) => setConfig({ ...config, sttModel: m } as any)}
              align="right"
            />
          </div>
        </div>

        {/* Quick Launcher Model */}
        <div className="settings-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Lightning size={20} weight="duotone" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold text-text-primary">
                Quick Launcher Assistant Model
              </span>
              <span className="text-xs text-text-secondary/70 mt-0.5 leading-relaxed">
                Answers fast floating queries when invoking the global launcher bar.
              </span>
            </div>
          </div>
          <div className="shrink-0">
            <ModelSelector
              selectedModel={(config as any).quickLauncherModel || ''}
              onModelChange={(m) => setConfig({ ...config, quickLauncherModel: m } as any)}
              align="right"
            />
          </div>
        </div>

        {/* Conversation Search Model */}
        <div className="settings-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Globe size={20} weight="duotone" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold text-text-primary">
                Conversation Search Model
              </span>
              <span className="text-xs text-text-secondary/70 mt-0.5 leading-relaxed">
                Searches semantic history and synthesizes prior discussions across chats.
              </span>
            </div>
          </div>
          <div className="shrink-0">
            <ModelSelector
              selectedModel={(config as any).searchModel || ''}
              onModelChange={(m) => setConfig({ ...config, searchModel: m } as any)}
              align="right"
            />
          </div>
        </div>
      </div>
    </div>
  )

  const renderVoice = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader
        title="Voice & Text-To-Speech"
        subtitle="Choose a natural speech synthesis voice profile for spoken model responses."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {[
          { name: 'Aoede', desc: 'Warm, natural & balanced (Default)', tag: 'Recommended' },
          { name: 'Puck', desc: 'Energetic, expressive male voice', tag: 'Fast-paced' },
          { name: 'Charon', desc: 'Deep, resonant and authoritative', tag: 'Deep Tone' },
          { name: 'Kore', desc: 'Soft, calm and gentle female voice', tag: 'Calm' },
          { name: 'Fenrir', desc: 'Sharp, distinct and articulate', tag: 'Crisp' }
        ].map((voice) => {
          const isActive = config.ttsVoice === voice.name
          return (
            <button
              key={voice.name}
              type="button"
              onClick={() => setConfig({ ...config, ttsVoice: voice.name })}
              className={clsx(
                'group relative flex flex-col justify-between rounded-xl border p-4 text-left transition-all duration-200 cursor-pointer outline-none active:scale-[0.98]',
                isActive
                  ? 'border-accent-primary bg-accent-primary/[0.08] shadow-[0_0_20px_var(--accent-glow)] ring-1 ring-accent-primary/30'
                  : 'border-[var(--border-default)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)]'
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div
                  className={clsx(
                    'flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
                    isActive
                      ? 'border-accent-primary/30 bg-accent-primary/15 text-accent-primary'
                      : 'border-[var(--border-default)] bg-[var(--surface-lowest)] text-text-muted group-hover:text-text-primary'
                  )}
                >
                  <Waveform size={18} weight="duotone" />
                </div>
                {isActive && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-primary text-black">
                    <Check size={12} weight="bold" />
                  </span>
                )}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-text-primary">{voice.name}</span>
                  {voice.tag && (
                    <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--surface-lowest)] border border-[var(--border-default)] text-text-muted">
                      {voice.tag}
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-secondary/70 mt-1 leading-relaxed">{voice.desc}</p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )

  const renderRuntime = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader
        title="AI Runtime & Sandbox"
        subtitle="Configure the system terminal environment and workspace operation modes."
      />

      <div className="space-y-5">
        {/* Terminal Shell Selection */}
        <div className="settings-card space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
              <TerminalWindow size={18} weight="duotone" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold text-text-primary">
                Guarded Terminal CLI Shell
              </span>
              <span className="text-xs text-text-secondary/70 mt-0.5 leading-relaxed">
                Prism validates terminal commands against security policies before execution.
              </span>
            </div>
          </div>

          <div className="pt-2">
            <CustomSelect
              value={config.terminalShell || 'powershell.exe'}
              onChange={(val) => setConfig({ ...config, terminalShell: val })}
              options={
                availableTerminals.length > 0
                  ? availableTerminals.map((term) => ({
                      value: term.path,
                      label: `${term.name} (${term.path})`,
                      icon: <TerminalWindow size={16} className="text-accent-primary" />
                    }))
                  : [
                      {
                        value: 'powershell.exe',
                        label: 'PowerShell (powershell.exe)',
                        icon: <TerminalWindow size={16} className="text-accent-primary" />
                      },
                      {
                        value: 'cmd.exe',
                        label: 'Command Prompt (cmd.exe)',
                        icon: <TerminalWindow size={16} className="text-accent-primary" />
                      }
                    ]
              }
            />
          </div>
        </div>

        {/* Session Mode Selector */}
        <div className="settings-card space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
              <Sliders size={18} weight="duotone" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold text-text-primary">
                Default Workspace Session Mode
              </span>
              <span className="text-xs text-text-secondary/70 mt-0.5 leading-relaxed">
                Determines how much filesystem access and execution power the AI has in new tabs.
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                id: 'conversation' as SessionMode,
                title: 'Conversation',
                badge: 'Chat Only',
                desc: 'Standard AI conversation with all execution tools disabled.'
              },
              {
                id: 'execution' as SessionMode,
                title: 'Execution Mode',
                badge: 'USERPROFILE',
                desc: 'Full desktop tool execution operating in user profile.'
              },
              {
                id: 'discipline' as SessionMode,
                title: 'Discipline Mode',
                badge: 'Project Folder',
                desc: 'Restricts AI file creation and edits to a chosen directory.'
              }
            ].map((mode) => {
              const isActive = (config.sessionMode || 'execution') === mode.id
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setConfig({ ...config, sessionMode: mode.id })}
                  className={clsx(
                    'flex flex-col justify-between rounded-xl border p-4 text-left transition-all duration-200 cursor-pointer outline-none active:scale-[0.98]',
                    isActive
                      ? 'border-accent-primary bg-accent-primary/[0.08] shadow-[0_0_20px_var(--accent-glow)] ring-1 ring-accent-primary/30'
                      : 'border-[var(--border-default)] bg-[var(--surface-lowest)] hover:border-[var(--border-strong)] hover:bg-[var(--surface)]'
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-bold text-text-primary">{mode.title}</span>
                    <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-accent-primary">
                      {mode.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-secondary/70 leading-relaxed">{mode.desc}</p>
                </button>
              )
            })}
          </div>

          {config.sessionMode === 'discipline' && (
            <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)] animate-fade-in">
              <span className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                <FolderOpen size={15} className="text-accent-primary" />
                Discipline Working Directory
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={config.disciplinePath || ''}
                  placeholder="No project directory selected"
                  className="settings-text-input flex-1 font-mono text-xs truncate"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const selected = await window.api.selectFolder()
                    if (selected) {
                      setConfig({ ...config, disciplinePath: selected })
                    }
                  }}
                  className="settings-secondary-button shrink-0 cursor-pointer"
                >
                  <FolderOpen size={14} />
                  Browse Folder
                </button>
                {config.disciplinePath && (
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, disciplinePath: '' })}
                    className="p-2.5 text-text-muted hover:text-text-primary hover:bg-[var(--surface-raised)] border border-[var(--border-default)] rounded-lg transition-colors cursor-pointer"
                    title="Clear selected folder"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  const renderSkills = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader
        title="AI Execution Skills"
        subtitle="Enable or disable specialized modular execution capabilities for documents and browser automation."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* PowerPoint */}
        <SkillCard
          icon={<FilePpt size={22} weight="duotone" className="text-orange-400" />}
          title="PowerPoint (.pptx)"
          description="Enables the AI to generate polished 16:9 presentation slide decks with formatted layouts."
          enabled={isSkillEnabledInSettings('pptx')}
          onToggle={() => toggleSkillInSettings('pptx')}
        />

        {/* PDF */}
        <SkillCard
          icon={<FilePdf size={22} weight="duotone" className="text-rose-400" />}
          title="PDF Documents"
          description="Allows the AI to compile beautifully styled, printable A4 PDF reports and summaries."
          enabled={isSkillEnabledInSettings('pdf')}
          onToggle={() => toggleSkillInSettings('pdf')}
        />

        {/* Browser */}
        <SkillCard
          icon={<Globe size={22} weight="duotone" className="text-cyan-400" />}
          title="Browser Automation"
          description="Enables integrated Playwright headless browser navigation, element interactions, and page snapshots."
          enabled={isSkillEnabledInSettings('browser')}
          onToggle={() => toggleSkillInSettings('browser')}
        />
      </div>
    </div>
  )

  const renderWorkflows = (): React.JSX.Element => {
    if (isAddingWorkflow || editingWorkflow) {
      const filteredTools = availableTools.filter(
        (t) =>
          !toolSearchQuery.trim() ||
          t.label.toLowerCase().includes(toolSearchQuery.toLowerCase()) ||
          t.desc.toLowerCase().includes(toolSearchQuery.toLowerCase()) ||
          t.name.toLowerCase().includes(toolSearchQuery.toLowerCase())
      )

      return (
        <div className="space-y-6 animate-soft-pop">
          <div className="flex items-center justify-between">
            <SectionHeader
              title={isAddingWorkflow ? 'Create Custom Workflow' : 'Edit Custom Workflow'}
              subtitle="Configure your dynamic Gems-style prompt profile and tool constraints."
            />
            <button
              type="button"
              onClick={() => {
                setEditingWorkflow(null)
                setIsAddingWorkflow(false)
              }}
              className="settings-secondary-button cursor-pointer"
            >
              Back to List
            </button>
          </div>

          {formError && (
            <div className="flex items-center gap-2 rounded-xl border border-status-error/20 bg-status-error/10 p-3 text-xs text-status-error font-semibold">
              <Warning size={15} weight="fill" />
              <span>{formError}</span>
            </div>
          )}

          <div className="settings-card space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="settings-field-label">Trigger Command</label>
                <input
                  type="text"
                  value={formCommand}
                  onChange={(e) => setFormCommand(e.target.value)}
                  placeholder="e.g. /summarize"
                  disabled={!isAddingWorkflow}
                  className="settings-text-input font-mono text-xs disabled:opacity-50"
                />
                <span className="text-[10px] text-text-muted">
                  Must start with / and contain no spaces.
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="settings-field-label">Workflow Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Executive Summarizer"
                  className="settings-text-input text-xs font-semibold"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="settings-field-label">Brief Description</label>
              <input
                type="text"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="e.g. Summarize input texts and generate bulleted key points"
                className="settings-text-input text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <label className="settings-field-label">System Instructions / Prompt</label>
              <textarea
                value={formPrompt}
                onChange={(e) => setFormPrompt(e.target.value)}
                rows={6}
                placeholder="Write system instructions explaining what role the AI should assume, how it should process inputs, and format outputs..."
                className="settings-text-input text-xs resize-none font-sans leading-relaxed"
              />
            </div>

            {/* Allowed Tools */}
            <div className="space-y-3 pt-2 border-t border-[var(--border-subtle)]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="settings-field-label">Allowed Tools (Execution Constraints)</span>
                  <span className="text-[11px] text-text-muted">
                    Check tools allowed during this workflow. Leave all unchecked for pure chat.
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFormTools(availableTools.map((t) => t.name))}
                    className="text-[11px] font-semibold text-accent-primary hover:underline cursor-pointer"
                  >
                    Select All
                  </button>
                  <span className="text-text-muted">•</span>
                  <button
                    type="button"
                    onClick={() => setFormTools([])}
                    className="text-[11px] font-semibold text-text-muted hover:text-text-primary cursor-pointer"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {/* Tool search */}
              <div className="relative">
                <MagnifyingGlass size={13} className="absolute left-3 top-2.5 text-text-muted" />
                <input
                  type="text"
                  value={toolSearchQuery}
                  onChange={(e) => setToolSearchQuery(e.target.value)}
                  placeholder="Filter available tools..."
                  className="settings-text-input pl-8 py-1.5 text-xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                {filteredTools.map((tool) => {
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
                        'flex items-start gap-3 rounded-lg border p-3 text-left transition-all active:scale-[0.98] cursor-pointer',
                        isChecked
                          ? 'border-accent-primary/40 bg-accent-primary/[0.07] text-text-primary'
                          : 'border-[var(--border-default)] bg-[var(--surface-lowest)] hover:border-[var(--border-strong)] text-text-secondary'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        readOnly
                        className="mt-0.5 h-3.5 w-3.5 rounded border-white/20 bg-transparent text-accent-primary pointer-events-none accent-accent-primary shrink-0"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-semibold text-text-primary leading-tight">
                          {tool.label}
                        </span>
                        <span className="text-[10px] text-text-muted leading-tight mt-0.5 truncate">
                          {tool.desc}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="pt-3 flex justify-end">
              <button
                type="button"
                onClick={handleSaveWorkflowForm}
                className="settings-primary-button cursor-pointer"
              >
                <Save size={15} />
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
        <div className="flex items-center justify-between gap-4">
          <SectionHeader
            title="Slash Workflows"
            subtitle="Custom prompt profiles triggered by typing slash commands in the message box."
          />
          <button
            type="button"
            onClick={handleAddWorkflowClick}
            className="settings-primary-button shrink-0 cursor-pointer"
          >
            <Plus size={14} weight="bold" />
            Add Workflow
          </button>
        </div>

        {wList.length === 0 ? (
          <div className="settings-card flex flex-col items-center justify-center py-12 text-center border-dashed">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-primary/10 text-accent-primary border border-accent-primary/20 mb-3">
              <Lightning size={24} weight="duotone" />
            </div>
            <span className="text-sm font-semibold text-text-primary">No Slash Workflows Configured</span>
            <p className="text-xs text-text-secondary/70 mt-1 max-w-sm">
              Create customized Gems-style prompt profiles triggered with a quick slash command.
            </p>
            <button
              type="button"
              onClick={handleAddWorkflowClick}
              className="mt-4 settings-secondary-button cursor-pointer"
            >
              <Plus size={14} />
              Create First Workflow
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {wList.map((w) => (
              <div
                key={w.id}
                className="settings-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors hover:border-[var(--border-strong)]"
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
                    <Lightning size={20} weight="fill" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-text-primary">{w.name}</span>
                      <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent-primary/15 text-accent-primary border border-accent-primary/30">
                        {w.command}
                      </span>
                      {w.toolConstraints && w.toolConstraints.length > 0 && (
                        <span className="font-mono text-[9px] px-2 py-0.5 rounded-full bg-[var(--surface-lowest)] text-text-muted border border-[var(--border-default)]">
                          {w.toolConstraints.length} tools allowed
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-text-secondary/70 mt-1 leading-relaxed truncate">
                      {w.description || 'No description provided.'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => handleEditWorkflow(w)}
                    className="p-2 text-text-secondary hover:text-text-primary hover:bg-[var(--surface-raised)] rounded-lg transition-colors cursor-pointer"
                    title="Edit Workflow"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteWorkflow(w.id)}
                    className="p-2 text-status-error/70 hover:text-status-error hover:bg-status-error/10 rounded-lg transition-colors cursor-pointer"
                    title="Delete Workflow"
                  >
                    <Trash size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderSystem = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader
        title="System & Behavior"
        subtitle="Desktop environment preferences, startup lifecycle, and local data protection."
      />

      <div className="space-y-4">
        {/* Quick Search Mode */}
        <div className="settings-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-sm font-semibold text-text-primary">Quick Search AI Mode</span>
            <span className="text-xs text-text-secondary/70 leading-relaxed">
              Choose between the lightweight floating AI query bar or opening the full chat tab.
            </span>
          </div>

          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[var(--surface-lowest)] border border-[var(--border-default)] shrink-0">
            <button
              type="button"
              onClick={() => setConfig({ ...config, quickLauncherMode: 'simple' })}
              className={clsx(
                'rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer',
                config.quickLauncherMode === 'simple'
                  ? 'bg-accent-primary text-black font-bold shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              )}
            >
              Simple Floating
            </button>
            <button
              type="button"
              onClick={() => setConfig({ ...config, quickLauncherMode: 'advanced' })}
              className={clsx(
                'rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer',
                config.quickLauncherMode === 'advanced'
                  ? 'bg-accent-primary text-black font-bold shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              )}
            >
              Advanced Workspace
            </button>
          </div>
        </div>

        {/* Minimize to Tray */}
        <ToggleRow
          title="Minimize to System Tray"
          description="When closing the main window, Prism remains running in the background tray."
          checked={config.minimizeToTray}
          onChange={() => setConfig({ ...config, minimizeToTray: !config.minimizeToTray })}
        />

        {/* Start on Login */}
        <ToggleRow
          title="Launch on System Startup"
          description="Automatically launch Prism in the background when you log in to your computer."
          checked={config.autoLaunch}
          onChange={() => setConfig({ ...config, autoLaunch: !config.autoLaunch })}
        />
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-accent-primary/20 bg-accent-primary/[0.04] p-4">
        <div className="text-accent-primary shrink-0 mt-0.5">
          <Shield size={18} weight="duotone" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-bold text-text-primary">Encrypted Local Storage</span>
          <p className="text-xs text-text-secondary/70 mt-0.5 leading-relaxed">
            All user credentials, API keys, and custom configurations are stored encrypted locally on
            your machine using native OS keychains. Prism never transmits your API keys to third parties.
          </p>
        </div>
      </div>
    </div>
  )

  const renderDiscord = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader
        title="Discord Gateway"
        subtitle="Connect Prism to Discord to power bots, direct messages, and Gemini Live realtime voice sessions."
      />

      <section className="settings-card settings-discord-status">
        <div className="flex min-w-0 items-start gap-3.5">
          <div className="settings-icon-box">
            <DiscordIcon size={20} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text-primary">Gateway Service</h3>
              <span
                className={clsx(
                  'settings-status-badge',
                  config.discordGatewayEnabled
                    ? config.discordBotToken?.trim()
                      ? 'is-ready'
                      : 'is-warning'
                    : ''
                )}
              >
                {config.discordGatewayEnabled
                  ? config.discordBotToken?.trim()
                    ? 'Connected / Ready'
                    : 'Token Required'
                  : 'Disabled'}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary/70">
              Prism manages the Discord client lifecycle automatically after changes are saved.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={config.discordGatewayEnabled ?? false}
          aria-label="Enable Discord Gateway"
          onClick={() =>
            setConfig({ ...config, discordGatewayEnabled: !config.discordGatewayEnabled })
          }
          className={clsx('settings-switch', config.discordGatewayEnabled && 'is-enabled')}
        >
          <span />
        </button>
      </section>

      <section className="space-y-3">
        <SettingsGroupLabel
          title="Bot Credentials"
          description="Paste the secret bot token generated in your Discord Developer Portal application."
        />
        <div className="settings-card">
          <label className="settings-field-label" htmlFor="discord-bot-token">
            Bot Token
          </label>
          <div className="relative mt-2">
            <input
              id="discord-bot-token"
              type={showDiscordToken ? 'text' : 'password'}
              value={config.discordBotToken || ''}
              onChange={(e) => setConfig({ ...config, discordBotToken: e.target.value })}
              placeholder="Paste your Discord Bot Token"
              autoComplete="off"
              spellCheck={false}
              className="settings-text-input pr-11 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => setShowDiscordToken((value) => !value)}
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-[var(--surface-raised)] hover:text-text-primary cursor-pointer"
              title={showDiscordToken ? 'Hide Bot Token' : 'Show Bot Token'}
            >
              {showDiscordToken ? <EyeSlash size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            The token is saved encrypted on your device and hidden by default.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <SettingsGroupLabel
          title="Model Routing for Discord"
          description="Select independent models for Discord text messaging and Gemini Live voice calls."
        />
        <div className="settings-routing-grid">
          <div className="settings-card settings-model-card">
            <div>
              <span className="settings-field-label">Text Responses</span>
              <h3 className="mt-1 text-sm font-semibold text-text-primary">Gateway Text Model</h3>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary/70">
                Handles server text commands, mentions, and tool operations.
              </p>
            </div>
            <div className="settings-model-selector">
              <ModelSelector
                selectedModel={config.discordGatewayModel || ''}
                onModelChange={(model) => setConfig({ ...config, discordGatewayModel: model })}
                align="left"
              />
            </div>
          </div>

          <div className="settings-card settings-model-card">
            <div>
              <span className="settings-field-label">Realtime Voice</span>
              <h3 className="mt-1 text-sm font-semibold text-text-primary">Gemini Live Model</h3>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary/70">
                Powers audio calls initiated with the prism=join command.
              </p>
            </div>
            <div className="settings-model-selector">
              <ModelSelector
                selectedModel={config.discordGatewayVoiceModel || ''}
                onModelChange={(model) => setConfig({ ...config, discordGatewayVoiceModel: model })}
                align="left"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  )

  const renderLicense = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader
        title="Enterprise License & Plans"
        subtitle="Manage commercial licensing, live Supabase subscription tiers, and cryptographic key activations."
      />

      {licenseInfo?.isActivated ? (
        <div className="settings-card border-accent-primary/40 bg-accent-primary/[0.04]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-primary/15 text-accent-primary border border-accent-primary/30">
                <Certificate size={24} weight="duotone" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-text-primary">
                    {licenseInfo.licensee}
                  </span>
                  <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent-primary text-black uppercase">
                    {licenseInfo.type}
                  </span>
                </div>
                <span className="text-xs text-text-secondary mt-0.5">{licenseInfo.email}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {countdownText && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent-primary/10 border border-accent-primary/25 text-accent-primary text-xs font-mono font-bold">
                  <Clock size={14} className="animate-pulse" />
                  <span>{countdownText}</span>
                </div>
              )}
              <button
                type="button"
                onClick={handleDeactivateLicense}
                className="px-3.5 py-2 text-xs font-semibold text-status-error bg-status-error/10 hover:bg-status-error/20 border border-status-error/20 rounded-xl transition-all cursor-pointer"
              >
                Deactivate License
              </button>
            </div>
          </div>

          <div className="settings-license-facts mt-5">
            <div>
              <span className="text-[10px] font-mono uppercase text-text-muted font-semibold">License ID</span>
              <span className="text-xs font-mono font-semibold text-text-primary mt-1 block truncate">
                {licenseInfo.id}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase text-text-muted font-semibold">Authorized Seats</span>
              <span className="text-xs font-semibold text-text-primary mt-1 block">
                {licenseInfo.seats} Seat(s)
              </span>
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase text-text-muted font-semibold">Expiration Date</span>
              <span className="text-xs font-semibold text-text-primary mt-1 block">
                {new Date(licenseInfo.expiresAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Supabase Subscription Plans */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-bold text-text-primary">Commercial Plans</span>
                <p className="text-xs text-text-secondary/70 mt-0.5">
                  Choose a subscription plan fetched live from Supabase.
                </p>
              </div>
            </div>

            {isLoadingPlans ? (
              <div className="settings-card flex min-h-28 items-center justify-center py-8">
                <CircleNotch size={22} className="animate-spin text-accent-primary" />
                <span className="text-xs text-text-secondary ml-3">Loading live pricing...</span>
              </div>
            ) : plansError ? (
              <div className="settings-card flex flex-col items-center justify-center py-8 gap-3 text-center">
                <Warning size={22} className="text-status-error" />
                <p className="text-xs text-text-secondary">{plansError}</p>
                <button
                  type="button"
                  onClick={() => void loadSubscriptionPlans()}
                  className="settings-secondary-button"
                >
                  <ArrowClockwise size={14} />
                  Retry
                </button>
              </div>
            ) : plans.length === 0 ? (
              <div className="settings-card flex flex-col items-center justify-center py-8 text-center">
                <CreditCard size={24} className="text-text-muted mb-2" />
                <span className="text-xs font-semibold text-text-primary">No plans currently available</span>
              </div>
            ) : (
              <div className="settings-plan-grid">
                {plans.map((plan) => {
                  const isPopular = plan.badge === 'Best Value' || plan.id === 'enterprise_yearly'
                  const isLoadingThis = checkoutLoadingPlanId === plan.id
                  const hasPendingSession = !!pendingSessionIds[plan.id]

                  return (
                    <div
                      key={plan.id}
                      className={clsx('settings-plan-card', isPopular && 'is-featured')}
                    >
                      {plan.badge && (
                        <div className="absolute -top-2.5 right-4 rounded bg-accent-primary px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-black">
                          {plan.badge}
                        </div>
                      )}

                      <div className="flex flex-col gap-2">
                        <span className="text-sm font-bold text-text-primary">{plan.name}</span>
                        <p className="text-xs text-text-secondary/70 leading-relaxed min-h-[36px]">
                          {plan.description}
                        </p>

                        <div className="flex items-baseline gap-1 my-2">
                          <span className="text-2xl font-extrabold text-text-primary font-mono">
                            ${plan.priceUsd.toFixed(2)}
                          </span>
                          <span className="text-xs text-text-muted font-medium">
                            / {plan.billingInterval}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-text-muted">
                          <span>{plan.seats} {plan.seats === 1 ? 'seat' : 'seats'}</span>
                          <span>{plan.durationDays} days</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 pt-3 border-t border-[var(--border-subtle)] mt-4">
                        {authUser ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleBuyPlan(plan)}
                              disabled={isLoadingThis || hasPendingSession}
                              className={clsx(
                                'settings-primary-button w-full cursor-pointer',
                                isPopular ? 'bg-accent-primary text-black border-accent-primary' : ''
                              )}
                            >
                              {isLoadingThis ? (
                                <CircleNotch size={14} className="animate-spin" />
                              ) : (
                                <CreditCard size={14} />
                              )}
                              <span>
                                {isLoadingThis
                                  ? 'Opening Checkout...'
                                  : hasPendingSession
                                    ? 'Checkout Opened'
                                    : 'Buy via Stripe'}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleVerifyAndActivate(plan)}
                              disabled={!hasPendingSession || stripeVerifying}
                              className={clsx(
                                'w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded-lg transition-all',
                                hasPendingSession && !stripeVerifying
                                  ? 'text-status-success hover:text-status-success/80 cursor-pointer bg-status-success/10'
                                  : 'text-text-muted opacity-40 cursor-not-allowed'
                              )}
                            >
                              <CheckCircle size={13} />
                              Verify & Activate Plan
                            </button>
                          </>
                        ) : (
                          <div className="flex flex-col items-center gap-1.5 py-1">
                            <span className="text-[11px] text-text-muted text-center">
                              Sign in to purchase a plan.
                            </span>
                            <button
                              type="button"
                              onClick={onOpenAuthModal}
                              className="text-[11px] font-semibold text-accent-primary hover:underline cursor-pointer"
                            >
                              Sign In / Create Account →
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Offline Key Activation */}
          <section className="relative settings-card overflow-hidden">
            {activating && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 backdrop-blur-md p-6 text-center animate-fade-in">
                <CircleNotch size={28} className="animate-spin text-accent-primary" />
                <span className="text-xs font-semibold text-accent-primary animate-pulse">
                  {activationStepMessage}
                </span>
              </div>
            )}

            <div className="flex flex-col gap-1 mb-3">
              <span className="text-sm font-semibold text-text-primary">Activate with License Key</span>
              <span className="text-xs text-text-secondary/70">
                Paste your cryptographic PRISM-ENTERPRISE key below for offline or airgapped activation.
              </span>
            </div>

            <div className="space-y-3">
              <div className="relative">
                <textarea
                  value={inputLicenseKey}
                  onChange={(e) => setInputLicenseKey(e.target.value)}
                  placeholder="Paste PRISM-ENTERPRISE-..."
                  rows={3}
                  style={{ WebkitTextSecurity: showKeyText ? 'none' : 'disc' } as any}
                  className="settings-text-input font-mono text-xs pr-10 resize-none"
                />
                <button
                  type="button"
                  onClick={() => setShowKeyText(!showKeyText)}
                  className="absolute right-3 top-3 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                  title={showKeyText ? 'Hide License Key' : 'Reveal License Key'}
                >
                  {showKeyText ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {licenseError && (
                <div className="text-xs text-status-error flex items-center gap-1.5 font-semibold">
                  <Warning size={14} weight="fill" />
                  {licenseError}
                </div>
              )}

              {licenseSuccess && (
                <div className="text-xs text-status-success flex items-center gap-1.5 font-semibold">
                  <Check size={14} weight="bold" />
                  {licenseSuccess}
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <a
                  href="https://github.com/brnalemusic"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-accent-primary hover:underline"
                >
                  Need a key? Contact Breno Alexandrē
                </a>

                <button
                  type="button"
                  onClick={handleActivateLicense}
                  disabled={activating || !inputLicenseKey.trim()}
                  className="settings-primary-button disabled:opacity-50 cursor-pointer"
                >
                  {activating && <CircleNotch size={14} className="animate-spin" />}
                  <span>{activating ? 'Validating...' : 'Activate Key'}</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {isActivationModalOpen && licenseInfo && (
        <EnterpriseActivationModal
          licenseInfo={licenseInfo}
          onClose={() => setIsActivationModalOpen(false)}
        />
      )}

      {stripeVerifying &&
        createPortal(
          <div className="prism-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fade-in">
            <div className="prism-modal-panel flex w-full max-w-sm flex-col items-center gap-4 p-7 text-center animate-soft-pop">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-primary/15 border border-accent-primary/30 text-accent-primary">
                <CircleNotch size={24} className="animate-spin" />
              </div>

              <div className="space-y-1">
                <h3 className="text-base font-bold text-text-primary">
                  {stripeCheckoutStage === 'opening' ? 'Preparing Checkout' : 'Completing Checkout'}
                </h3>
                <p className="text-xs text-text-secondary/80 leading-relaxed">
                  {stripeCheckoutStage === 'opening'
                    ? 'Creating secure Stripe session.'
                    : 'Please finish payment in your browser window.'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  stopSettingsPolling()
                  setStripeVerifying(false)
                }}
                className="text-xs font-semibold text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  )

  const renderAbout = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader
        title="About Prism"
        subtitle="Version details, desktop runtime architecture, and open source credits."
      />

      <div className="settings-card flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
            <Sparkle size={22} weight="duotone" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-text-primary">Prism Desktop</span>
            <span className="text-xs text-text-secondary/70">
              Next-generation Agentic AI Studio by Breno Alexandrē
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleVersionClick}
          className="font-mono text-xs font-bold bg-accent-primary/15 border border-accent-primary/30 text-accent-primary rounded-xl px-3 py-1.5 select-none hover:bg-accent-primary/25 transition-colors cursor-pointer"
          title="Click 5 times for easter egg"
        >
          {config.appVersion ? `v${config.appVersion}` : 'v9.0.0'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="settings-card flex flex-col items-center justify-center p-4 text-center">
          <span className="text-[11px] font-mono text-text-muted uppercase">Electron</span>
          <span className="text-sm font-bold text-text-primary mt-1">
            v{window.electron?.process?.versions?.electron || '39.8.9'}
          </span>
        </div>

        <div className="settings-card flex flex-col items-center justify-center p-4 text-center">
          <span className="text-[11px] font-mono text-text-muted uppercase">Chromium</span>
          <span className="text-sm font-bold text-text-primary mt-1">
            v{window.electron?.process?.versions?.chrome || '132.0'}
          </span>
        </div>

        <div className="settings-card flex flex-col items-center justify-center p-4 text-center">
          <span className="text-[11px] font-mono text-text-muted uppercase">Node.js</span>
          <span className="text-sm font-bold text-text-primary mt-1">
            v{window.electron?.process?.versions?.node || '22.11.0'}
          </span>
        </div>
      </div>
    </div>
  )

  const renderActiveSection = (): React.JSX.Element => {
    switch (activeSection) {
      case 'appearance':
        return renderAppearance()
      case 'shortcuts':
        return renderShortcuts()
      case 'system':
        return renderSystem()
      case 'voice':
        return renderVoice()
      case 'providers':
        return <ApiManagerSettings />
      case 'intelligence':
        return renderIntelligence()
      case 'runtime':
        return renderRuntime()
      case 'skills':
        return renderSkills()
      case 'workflows':
        return renderWorkflows()
      case 'discord':
        return renderDiscord()
      case 'license':
        return renderLicense()
      case 'about':
        return renderAbout()
      default:
        return renderAppearance()
    }
  }

  // Categories list for grouping in sidebar
  const categories: Array<{ id: SectionCategory; label: string }> = [
    { id: 'general', label: 'General' },
    { id: 'ai', label: 'AI & Models' },
    { id: 'integrations', label: 'Integrations & Info' }
  ]

  return (
    <div className="settings-shell flex h-full flex-1 flex-col overflow-hidden bg-black text-text-primary select-none">
      {/* Header Bar */}
      <header className="z-20 flex h-16 shrink-0 items-center justify-between border-b border-[var(--border-default)] bg-[var(--surface-lowest)] px-5 sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-primary/10 text-accent-primary border border-accent-primary/20 shrink-0">
            <Sliders size={18} weight="duotone" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold text-text-primary tracking-tight truncate">
                Settings
              </h1>
              <span className="text-text-muted text-xs hidden sm:inline">•</span>
              <span className="text-xs font-semibold text-accent-primary hidden sm:inline truncate">
                {activeNavSection.label}
              </span>
            </div>
            <p className="text-[11px] text-text-muted hidden sm:block truncate">
              {activeNavSection.description}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {message.text && (
            <span
              className={clsx(
                'hidden items-center gap-1.5 text-xs font-semibold animate-soft-pop md:flex px-2.5 py-1 rounded-lg border',
                message.type === 'success'
                  ? 'border-status-success/30 bg-status-success/10 text-status-success'
                  : 'border-status-error/30 bg-status-error/10 text-status-error'
              )}
            >
              {message.type === 'success' ? (
                <Check size={13} weight="bold" />
              ) : (
                <Warning size={13} weight="bold" />
              )}
              {message.text}
            </span>
          )}

          <button
            type="button"
            onClick={handleReset}
            className="settings-secondary-button hidden sm:inline-flex cursor-pointer"
            title="Restore default settings"
          >
            <RotateCcw size={13} />
            <span>Reset</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="settings-primary-button cursor-pointer"
          >
            <Save size={14} />
            <span>{isSaving ? 'Saving...' : 'Save'}</span>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-text-muted hover:border-[var(--border-default)] hover:bg-[var(--surface-raised)] hover:text-text-primary transition-colors cursor-pointer"
              title="Close settings"
            >
              <X size={16} weight="bold" />
            </button>
          )}
        </div>
      </header>

      {/* Main Area */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row overflow-hidden">
        {/* Desktop Sidebar */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--border-default)] bg-[var(--sidebar-bg)] p-3.5 lg:flex overflow-y-auto custom-scrollbar">
          {/* Quick Filter Search */}
          <div className="relative mb-3">
            <MagnifyingGlass size={13} className="absolute left-2.5 top-2.5 text-text-muted" />
            <input
              type="text"
              value={searchNavQuery}
              onChange={(e) => setSearchNavQuery(e.target.value)}
              placeholder="Search settings..."
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-lowest)] py-1.5 pl-8 pr-7 text-xs text-text-primary placeholder-text-muted focus:border-accent-primary/50 focus:outline-none transition-colors"
            />
            {searchNavQuery && (
              <button
                type="button"
                onClick={() => setSearchNavQuery('')}
                className="absolute right-2 top-2 text-text-muted hover:text-text-primary p-0.5"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="space-y-4">
            {categories.map((cat) => {
              const catSections = filteredSections.filter((s) => s.category === cat.id)
              if (catSections.length === 0) return null

              return (
                <div key={cat.id} className="space-y-1">
                  <span className="px-2.5 text-[10px] font-bold font-mono text-text-muted uppercase tracking-wider block">
                    {cat.label}
                  </span>
                  <div className="space-y-0.5">
                    {catSections.map((section) => {
                      const isActive = activeSection === section.id
                      return (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => handleSectionChange(section.id)}
                          className={clsx(
                            'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-all cursor-pointer outline-none',
                            isActive
                              ? 'bg-accent-primary/15 text-accent-primary border border-accent-primary/25 shadow-sm'
                              : 'text-text-secondary hover:bg-[var(--sidebar-hover)] hover:text-text-primary border border-transparent'
                          )}
                        >
                          <span
                            className={clsx(
                              'transition-colors',
                              isActive ? 'text-accent-primary' : 'text-text-muted group-hover:text-text-primary'
                            )}
                          >
                            {section.icon}
                          </span>
                          <span className="truncate">{section.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {filteredSections.length === 0 && (
              <div className="py-6 px-3 text-center text-xs text-text-muted">
                No settings match &ldquo;{searchNavQuery}&rdquo;
              </div>
            )}
          </div>
        </aside>

        {/* Mobile Dropdown Header */}
        <div className="relative shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-lowest)] p-3 lg:hidden">
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen((curr) => !curr)}
            className="flex w-full items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold text-text-primary"
          >
            <span className="flex items-center gap-2.5">
              <span className="text-accent-primary">{activeNavSection.icon}</span>
              {activeNavSection.label}
            </span>
            <CaretDown
              size={14}
              className={clsx(
                'text-text-muted transition-transform duration-200',
                isMobileMenuOpen && 'rotate-180'
              )}
            />
          </button>

          {isMobileMenuOpen && (
            <div className="absolute left-3 right-3 top-[calc(100%+4px)] z-30 max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface-raised)] p-2 shadow-2xl space-y-1 custom-scrollbar">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => handleSectionChange(section.id)}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors',
                    activeSection === section.id
                      ? 'bg-accent-primary/15 text-accent-primary'
                      : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
                  )}
                >
                  <span className={activeSection === section.id ? 'text-accent-primary' : 'text-text-muted'}>
                    {section.icon}
                  </span>
                  {section.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Settings Content Pane */}
        <main
          ref={contentRef}
          className="settings-content flex-1 overflow-y-auto p-5 sm:p-7 lg:p-9 custom-scrollbar"
        >
          <div className="mx-auto w-full max-w-3xl">{renderActiveSection()}</div>
        </main>
      </div>

      {isEasterEggOpen && <QuantumPhysicsGame onClose={() => setIsEasterEggOpen(false)} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Reusable Sub-Components
// ─────────────────────────────────────────────────────────────

function SectionHeader({
  title,
  subtitle
}: {
  title: string
  subtitle: string
}): React.JSX.Element {
  return (
    <div className="border-b border-[var(--border-subtle)] pb-4">
      <h2 className="text-xl font-bold tracking-tight text-text-primary sm:text-2xl">{title}</h2>
      <p className="mt-1 text-xs sm:text-sm text-text-secondary/80 leading-relaxed max-w-2xl">{subtitle}</p>
    </div>
  )
}

function SettingsGroupLabel({
  title,
  description
}: {
  title: string
  description?: string
}): React.JSX.Element {
  return (
    <div className="space-y-0.5">
      <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider font-mono">
        {title}
      </h3>
      {description && <p className="text-xs text-text-secondary/70 leading-relaxed">{description}</p>}
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
    <div className="settings-card flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        <span className="text-xs text-text-secondary/70 leading-relaxed">{description}</span>
      </div>
      <button
        type="button"
        onClick={onChange}
        role="switch"
        aria-checked={checked}
        className={clsx('settings-switch', checked && 'is-enabled')}
      >
        <span />
      </button>
    </div>
  )
}

function ShortcutCard({
  icon,
  title,
  description,
  value,
  onChange
}: {
  icon: React.ReactNode
  title: string
  description: string
  value: string
  onChange: (val: string) => void
}): React.JSX.Element {
  return (
    <div className="settings-card flex flex-col justify-between gap-3.5">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
          {icon}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-bold text-text-primary">{title}</span>
          <span className="text-[11px] text-text-secondary/70 leading-normal mt-0.5">
            {description}
          </span>
        </div>
      </div>
      <ShortcutRecorder value={value} onChange={onChange} />
    </div>
  )
}

function SkillCard({
  icon,
  title,
  description,
  enabled,
  onToggle
}: {
  icon: React.ReactNode
  title: string
  description: string
  enabled: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <div
      className={clsx(
        'settings-card flex flex-col justify-between gap-4 transition-all duration-200',
        enabled
          ? 'border-accent-primary/30 bg-accent-primary/[0.03]'
          : 'opacity-70 hover:opacity-100'
      )}
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-lowest)] border border-[var(--border-default)]">
            {icon}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={onToggle}
            className={clsx('settings-switch', enabled && 'is-enabled')}
          >
            <span />
          </button>
        </div>

        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-text-primary">{title}</span>
            <span
              className={clsx(
                'font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase',
                enabled
                  ? 'bg-status-success/15 text-status-success border border-status-success/30'
                  : 'bg-[var(--surface-raised)] text-text-muted border border-[var(--border-default)]'
              )}
            >
              {enabled ? 'Active' : 'Disabled'}
            </span>
          </div>
          <p className="text-xs text-text-secondary/70 mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
    </div>
  )
}

/**
 * Polished, bug-free CustomSelect component
 * Replaces unstyled native <select> with seamless animations and no overflow issues
 */
function CustomSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder = 'Select an option'
}: {
  value: T
  onChange: (val: T) => void
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>
  placeholder?: string
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((o) => o.value === value)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div className="relative w-full" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'flex w-full items-center justify-between rounded-lg border px-3.5 py-2.5 text-xs font-semibold transition-all cursor-pointer outline-none',
          isOpen
            ? 'border-accent-primary bg-[var(--surface-raised)] text-text-primary ring-1 ring-accent-primary/20'
            : 'border-[var(--border-default)] bg-[var(--surface-lowest)] text-text-primary hover:border-[var(--border-strong)] hover:bg-[var(--surface)]'
        )}
      >
        <span className="flex items-center gap-2 truncate">
          {selectedOption?.icon}
          <span className="truncate">{selectedOption?.label || placeholder}</span>
        </span>
        <CaretDown
          size={14}
          className={clsx('text-text-muted transition-transform duration-200 shrink-0 ml-2', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-[200] max-h-56 overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface-raised)] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.65)] space-y-0.5 custom-scrollbar animate-soft-pop">
          {options.map((opt) => {
            const isSelected = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  setIsOpen(false)
                }}
                className={clsx(
                  'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors cursor-pointer',
                  isSelected
                    ? 'bg-accent-primary/15 text-accent-primary'
                    : 'text-text-secondary hover:bg-white/[0.06] hover:text-text-primary'
                )}
              >
                <span className="flex items-center gap-2 truncate">
                  {opt.icon}
                  <span className="truncate">{opt.label}</span>
                </span>
                {isSelected && <Check size={14} weight="bold" className="text-accent-primary shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
