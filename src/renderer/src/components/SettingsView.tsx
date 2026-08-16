import { useState, useEffect, useRef } from 'react'
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
  ArrowSquareOut,
  CheckCircle,
  X,
  CaretDown,
  ArrowClockwise,
  FilePpt,
  FilePdf
} from '@phosphor-icons/react'
import { ShortcutRecorder } from './ShortcutRecorder'
import { EnterpriseActivationModal } from './EnterpriseActivationModal'
import clsx from 'clsx'
import type { AppConfig, SlashWorkflow } from '../../../main/config'

type Config = AppConfig

import { ApiManagerSettings } from './ApiManagerSettings'
import { ModelSelector } from './ModelSelector'
import { QuantumPhysicsGame } from './QuantumPhysicsGame'

type SectionId =
  | 'shortcuts'
  | 'providers'
  | 'intelligence'
  | 'skills'
  | 'runtime'
  | 'appearance'
  | 'voice'
  | 'workflows'
  | 'system'
  | 'discord'
  | 'license'
  | 'about'

interface NavSection {
  id: SectionId
  label: string
  icon: React.ReactNode
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

export function SettingsView({
  onClose,
  onOpenAuthModal,
  initialSection = 'shortcuts'
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
  const [isSectionMenuOpen, setIsSectionMenuOpen] = useState(false)
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

  const [editingWorkflow, setEditingWorkflow] = useState<SlashWorkflow | null>(null)
  const [isAddingWorkflow, setIsAddingWorkflow] = useState(false)
  const [formCommand, setFormCommand] = useState('')
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPrompt, setFormPrompt] = useState('')
  const [formTools, setFormTools] = useState<string[]>([])
  const [formError, setFormError] = useState('')

  const [availableTools, setAvailableTools] =
    useState<Array<{ name: string; label: string; desc: string }>>(STATIC_TOOLS)

  // --- Easter Egg State ---
  const [easterEggClicks, setEasterEggClicks] = useState(0)
  const [lastClickTimestamp, setLastClickTimestamp] = useState(0)
  const [isEasterEggOpen, setIsEasterEggOpen] = useState(false)

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

  // --- License Management State ---
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
  // Stripe-specific loading state — rendered as a global portal modal, separate from the offline card
  const [stripeVerifying, setStripeVerifying] = useState(false)

  // --- Dynamic License Plans & Stripe Checkout State ---
  const [authUser, setAuthUser] = useState<import('../../../shared/types').UserProfile | null>(null)
  const [plans, setPlans] = useState<import('../../../shared/types').SubscriptionPlan[]>([])
  const [isLoadingPlans, setIsLoadingPlans] = useState(false)
  const [plansError, setPlansError] = useState<string | null>(null)
  const [checkoutLoadingPlanId, setCheckoutLoadingPlanId] = useState<string | null>(null)
  const [stripeCheckoutStage, setStripeCheckoutStage] = useState<'opening' | 'polling'>('opening')
  // Maps planId -> Stripe session_id after a real checkout is opened
  const [pendingSessionIds, setPendingSessionIds] = useState<Record<string, string>>({})
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null)

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
      console.error('Failed to load subscription plans from Supabase:', err)
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
    setCheckoutMessage(null)
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
          setLicenseError(openResult.error || 'Unable to open the checkout in your system browser.')
          return
        }
        setPendingSessionIds((prev) => ({ ...prev, [plan.id]: res.sessionId! }))
        setStripeCheckoutStage('polling')

        // Start automatic global polling every 2 seconds
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
            setLicenseError('Unable to verify the payment. Please try again.')
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
      setLicenseError(
        'No Stripe payment session found. Please click "Buy via Stripe" first and complete checkout.'
      )
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
        setCheckoutMessage(null)
        const info = await window.api.getLicenseInfo()
        if (info) {
          setLicenseInfo(info)
          setIsActivationModalOpen(true)
        }
      } else {
        setLicenseError(
          res.error || 'Payment verification failed. Please ensure checkout was completed.'
        )
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
      await new Promise((r) => setTimeout(r, 500))

      setActivationStepMessage('Verifying Cryptographic Ed25519 Signature...')
      await new Promise((r) => setTimeout(r, 600))

      setActivationStepMessage('Validating Enterprise License Entitlements...')
      const res = await window.api.activateLicense(inputLicenseKey)
      await new Promise((r) => setTimeout(r, 500))

      if (res.success && res.info) {
        setLicenseInfo(res.info)
        setLicenseSuccess(`Successfully activated Enterprise License for ${res.info.licensee}!`)
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
    setIsSectionMenuOpen(false)
    if (id === 'license') {
      void loadSubscriptionPlans()
    }
    if (contentRef.current) {
      contentRef.current.scrollTop = 0
    }
  }

  const sections: NavSection[] = [
    { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={18} weight="bold" /> },
    { id: 'providers', label: 'BYOK', icon: <Key size={18} weight="bold" /> },
    { id: 'intelligence', label: 'Intelligence', icon: <Bot size={18} weight="bold" /> },
    { id: 'skills', label: 'Skills', icon: <Sparkle size={18} weight="bold" /> },
    { id: 'runtime', label: 'AI Runtime', icon: <Shield size={18} weight="bold" /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette size={18} weight="bold" /> },
    { id: 'voice', label: 'Voice', icon: <Volume2 size={18} weight="bold" /> },
    { id: 'workflows', label: 'Workflows', icon: <Lightning size={18} weight="bold" /> },
    { id: 'system', label: 'System', icon: <Monitor size={18} weight="bold" /> },
    { id: 'discord', label: 'Discord', icon: <DiscordIcon /> },
    { id: 'license', label: 'License', icon: <Certificate size={18} weight="bold" /> },
    { id: 'about', label: 'About', icon: <Info size={18} weight="bold" /> }
  ]

  const activeNavSection = sections.find((section) => section.id === activeSection) || sections[0]

  // ─── Section renderers ──────────────────────────────────

  const renderShortcuts = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
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
                <span className="text-xs font-semibold text-text-primary">
                  Screenshot &amp; Ask
                </span>
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
        subtitle="Assign specific AI models for Dictation (STT), Quick Launcher, Search, Prism Gateway, and Subagents."
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
      </div>
    </div>
  )

  const renderAppearance = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader title="Appearance" subtitle="Customize Prism's theme and interface scaling." />

      <div className="space-y-3">
        <SettingsGroupLabel
          title="Theme"
          description="Changes the accent and the tonal sidebar while keeping the workspace pure black."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              { id: 'marine', label: 'Marine', accent: '#38bdf8', sidebar: '#030D15' },
              { id: 'fire', label: 'Fire', accent: '#ff3b2f', sidebar: '#150607' },
              { id: 'lava', label: 'Lava', accent: '#ff6b00', sidebar: '#160900' },
              { id: 'gold', label: 'Gold', accent: '#f5c518', sidebar: '#151100' },
              { id: 'forest', label: 'Forest', accent: '#22c55e', sidebar: '#04120A' },
              { id: 'indigo', label: 'Indigo', accent: '#6366f1', sidebar: '#070918' },
              { id: 'violet', label: 'Violet', accent: '#a855f7', sidebar: '#100718' },
              { id: 'white', label: 'White', accent: '#ffffff', sidebar: '#080808' }
            ] as const
          ).map(({ id, label, accent, sidebar }) => {
            const isActive = (config.theme || 'marine') === id
            return (
              <button
                key={id}
                title={label}
                onClick={() => {
                  setConfig({ ...config, theme: id })
                  document.documentElement.setAttribute('data-theme', id)
                  window.api.saveConfig({ theme: id })
                }}
                className={clsx(
                  'group flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition-colors focus:outline-none',
                  isActive
                    ? 'border-accent-primary/60 bg-accent-primary/[0.07]'
                    : 'border-[var(--border-default)] bg-[var(--surface)] hover:border-[var(--border-strong)]'
                )}
              >
                <div
                  className="relative h-9 w-9 shrink-0 rounded-lg border border-white/10"
                  style={{ background: sidebar }}
                >
                  <span
                    className="absolute bottom-1.5 left-1.5 h-2.5 w-2.5 rounded-full"
                    style={{ background: accent }}
                  />
                  {isActive && (
                    <span className="absolute right-1.5 top-1.5 text-white">
                      <Check size={12} weight="bold" />
                    </span>
                  )}
                </div>
                <span
                  className={clsx(
                    'truncate text-xs font-medium',
                    isActive ? 'text-text-primary' : 'text-text-secondary'
                  )}
                >
                  {label}
                </span>
              </button>
            )
          })}
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

  const renderDiscord = (): React.JSX.Element => (
    <div className="space-y-8 animate-soft-pop">
      <SectionHeader
        title="Discord Gateway"
        subtitle="Configure the bot connection and route text and realtime voice requests."
      />

      <section className="settings-card settings-discord-status">
        <div className="flex min-w-0 items-start gap-3">
          <div className="settings-icon-box">
            <DiscordIcon size={19} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text-primary">Gateway status</h3>
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
                    ? 'Configured'
                    : 'Token required'
                  : 'Disabled'}
              </span>
            </div>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-text-secondary">
              Prism starts or stops the Discord client after these settings are saved. Configured
              does not guarantee that Discord accepted the credentials.
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
          title="Bot credentials"
          description="Use the token generated for your application in the Discord Developer Portal."
        />
        <div className="settings-card">
          <label className="settings-field-label" htmlFor="discord-bot-token">
            Bot token
          </label>
          <div className="relative mt-2">
            <input
              id="discord-bot-token"
              type={showDiscordToken ? 'text' : 'password'}
              value={config.discordBotToken || ''}
              onChange={(e) => setConfig({ ...config, discordBotToken: e.target.value })}
              placeholder="Enter your Discord bot token"
              autoComplete="off"
              spellCheck={false}
              className="settings-text-input pr-11 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowDiscordToken((value) => !value)}
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-[var(--surface-raised)] hover:text-text-primary"
              title={showDiscordToken ? 'Hide bot token' : 'Show bot token'}
              aria-label={showDiscordToken ? 'Hide bot token' : 'Show bot token'}
            >
              {showDiscordToken ? <EyeSlash size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
            The token is stored through Prism configuration and is never displayed by default.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <SettingsGroupLabel
          title="Model routing"
          description="Choose independent models for Discord text messages and realtime voice sessions."
        />
        <div className="settings-routing-grid">
          <div className="settings-card settings-model-card">
            <div>
              <span className="settings-field-label">Text responses</span>
              <h3 className="mt-2 text-sm font-semibold text-text-primary">Gateway text model</h3>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                Handles server messages, direct messages, threads, and tool-driven text responses.
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
              <span className="settings-field-label">Realtime voice</span>
              <h3 className="mt-2 text-sm font-semibold text-text-primary">Gemini Live model</h3>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                Handles sessions started by the prism=join command and must support the Live API.
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

  const renderLicense = (): React.JSX.Element => (
    <div className="space-y-6 animate-soft-pop">
      <SectionHeader
        title="Enterprise License"
        subtitle="Manage your Prism Enterprise license key and commercial activation status."
      />

      {licenseInfo?.isActivated ? (
        <div className="settings-card border-accent-primary/35">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
                <Certificate size={22} weight="bold" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-text-primary">
                    {licenseInfo.licensee}
                  </span>
                  <span className="font-mono text-[10px] font-bold tracking-widest text-accent-primary bg-accent-primary/15 border border-accent-primary/30 px-2 py-0.5 rounded-full uppercase">
                    {licenseInfo.type}
                  </span>
                </div>
                <span className="text-xs text-text-secondary">{licenseInfo.email}</span>
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
                onClick={handleDeactivateLicense}
                className="px-3.5 py-2 text-xs font-semibold text-status-error bg-status-error/10 hover:bg-status-error/20 border border-status-error/20 rounded-xl transition-all cursor-pointer"
              >
                Deactivate License
              </button>
            </div>
          </div>

          <div className="settings-license-facts mt-4">
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-text-muted">License ID</span>
              <span className="text-xs font-mono font-semibold text-text-primary mt-0.5">
                {licenseInfo.id}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-text-muted">Seats Authorized</span>
              <span className="text-xs font-semibold text-text-primary mt-0.5">
                {licenseInfo.seats} Seat(s)
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-medium text-text-muted">Expiration Date</span>
              <span className="text-xs font-semibold text-text-primary mt-0.5">
                {new Date(licenseInfo.expiresAt).toLocaleDateString()} (
                {new Date(licenseInfo.expiresAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
                )
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {/* Dynamic Commercial Plans Grid (Fetched from Supabase) */}
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-text-primary">
                  Choose an Enterprise plan
                </span>
                <span className="text-xs text-text-secondary/70">
                  Select an Enterprise plan below. All prices and terms are fetched live from
                  Supabase.
                </span>
              </div>
            </div>

            {isLoadingPlans ? (
              <div className="settings-card flex min-h-28 items-center justify-center">
                <CircleNotch size={24} className="animate-spin text-accent-primary" />
                <span className="text-xs text-text-secondary ml-3">
                  Loading live pricing from Supabase...
                </span>
              </div>
            ) : plansError ? (
              <div className="settings-card flex min-h-32 flex-col items-center justify-center gap-3 text-center">
                <Warning size={22} className="text-status-error" />
                <div>
                  <p className="text-sm font-semibold text-text-primary">Pricing is unavailable</p>
                  <p className="mt-1 text-xs text-text-secondary">{plansError}</p>
                </div>
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
              <div className="settings-card flex min-h-32 flex-col items-center justify-center gap-2 text-center">
                <CreditCard size={22} className="text-text-muted" />
                <p className="text-sm font-semibold text-text-primary">
                  No plans are currently available
                </p>
                <p className="max-w-md text-xs text-text-secondary">
                  Prism did not receive an active commercial plan. Try again later or activate an
                  existing key below.
                </p>
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
                      className={clsx(
                        'settings-plan-card',
                        isPopular ? 'is-featured' : 'hover:border-[var(--border-strong)]'
                      )}
                    >
                      {plan.badge && (
                        <div className="absolute -top-2.5 right-4 rounded bg-accent-primary px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.06em] text-black">
                          {plan.badge}
                        </div>
                      )}

                      <div className="flex flex-col gap-2">
                        <span className="text-sm font-bold text-text-primary">{plan.name}</span>
                        <p className="text-xs text-text-secondary/80 leading-relaxed min-h-[36px]">
                          {plan.description}
                        </p>

                        <div className="flex items-baseline gap-1 my-3">
                          <span className="text-2xl font-extrabold text-text-primary font-mono">
                            $
                            {plan.priceUsd.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })}
                          </span>
                          <span className="text-xs text-text-muted font-medium">
                            / {plan.billingInterval}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-text-muted">
                          <span>
                            {plan.seats} {plan.seats === 1 ? 'seat' : 'seats'}
                          </span>
                          <span>{plan.durationDays} days</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 pt-3 border-t border-[var(--border-subtle)] mt-4">
                        {authUser ? (
                          <>
                            {/* Buy via Stripe — only for authenticated users */}
                            <button
                              onClick={() => handleBuyPlan(plan)}
                              disabled={isLoadingThis || hasPendingSession}
                              className={clsx(
                                'w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition-colors',
                                hasPendingSession
                                  ? 'opacity-40 cursor-not-allowed bg-[var(--surface-lowest)] border border-[var(--border-default)] text-text-muted'
                                  : isPopular
                                    ? 'bg-white hover:bg-neutral-200 text-black cursor-pointer'
                                    : 'bg-[var(--surface-raised)] hover:border-[var(--border-strong)] text-text-primary border border-[var(--border-default)] cursor-pointer'
                              )}
                              title={
                                hasPendingSession
                                  ? 'Payment session already opened — verify below'
                                  : undefined
                              }
                            >
                              {isLoadingThis ? (
                                <CircleNotch size={15} className="animate-spin" />
                              ) : (
                                <CreditCard size={15} />
                              )}
                              <span>
                                {isLoadingThis
                                  ? 'Opening Checkout...'
                                  : hasPendingSession
                                    ? 'Checkout Opened'
                                    : 'Buy via Stripe'}
                              </span>
                            </button>

                            {/* Verify & Activate — only enabled after a real session exists */}
                            <button
                              onClick={() => handleVerifyAndActivate(plan)}
                              disabled={!hasPendingSession || stripeVerifying}
                              className={clsx(
                                'w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded-lg transition-all',
                                hasPendingSession && !stripeVerifying
                                  ? 'text-status-success hover:text-status-success/80 cursor-pointer bg-status-success/10 hover:bg-status-success/15'
                                  : 'text-text-muted opacity-40 cursor-not-allowed'
                              )}
                              title={
                                !hasPendingSession
                                  ? 'Complete Stripe checkout first'
                                  : 'Verify payment and activate license'
                              }
                            >
                              <CheckCircle size={13} />
                              Verify & Activate Plan
                            </button>
                          </>
                        ) : (
                          // Not logged in — prompt to sign in
                          <div className="flex flex-col items-center gap-1.5 py-2">
                            <span className="text-[11px] text-text-muted text-center leading-relaxed">
                              Sign in to your Prism account to purchase a plan.
                            </span>
                            <button
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

          {/* Checkout Status Banner */}
          {checkoutMessage && (
            <div className="flex flex-col gap-2 p-4 rounded-xl border border-accent-primary/30 bg-accent-primary/[0.08] text-xs animate-soft-pop">
              <div className="flex items-center gap-2 text-accent-primary font-semibold">
                <ArrowSquareOut size={16} />
                <span>Stripe Checkout Session Active</span>
              </div>
              <p className="text-text-secondary">{checkoutMessage}</p>
            </div>
          )}

          {/* Manual Offline Key Activation Card */}
          <section className="relative settings-card overflow-hidden">
            {/* Loading overlay ONLY for offline key activation — not for Stripe */}
            {activating && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 backdrop-blur-md animate-soft-pop p-6 text-center">
                <CircleNotch size={28} className="animate-spin text-accent-primary" />
                <div className="flex flex-col items-center gap-1">
                  <span className="font-mono text-xs font-bold tracking-wider text-text-primary uppercase">
                    Prism Enterprise Licensing
                  </span>
                  <span className="text-xs font-medium text-accent-primary animate-pulse">
                    {activationStepMessage}
                  </span>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <span className="settings-field-label">Existing license</span>
              <span className="mt-1 text-sm font-semibold text-text-primary">
                Activate with a license key
              </span>
              <span className="text-xs text-text-secondary/70">
                Paste your PRISM-ENTERPRISE key below to activate offline or custom licenses.
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <div className="relative w-full">
                <textarea
                  value={inputLicenseKey}
                  onChange={(e) => setInputLicenseKey(e.target.value)}
                  placeholder="Paste PRISM-ENTERPRISE key here"
                  rows={4}
                  style={{ WebkitTextSecurity: showKeyText ? 'none' : 'disc' } as any}
                  className="settings-text-input min-h-[104px] resize-none pr-11 font-mono text-xs custom-scrollbar"
                />
                <button
                  type="button"
                  onClick={() => setShowKeyText(!showKeyText)}
                  className="absolute right-3 top-3 text-text-muted hover:text-text-primary transition-colors cursor-pointer p-1 rounded-md hover:bg-white/5"
                  title={showKeyText ? 'Hide License Key' : 'Reveal License Key'}
                >
                  {showKeyText ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {licenseError && (
                <span className="text-xs font-medium text-status-error flex items-center gap-1.5 mt-1">
                  <Warning size={14} />
                  {licenseError}
                </span>
              )}

              {licenseSuccess && (
                <span className="text-xs font-medium text-status-success flex items-center gap-1.5 mt-1">
                  <Check size={14} />
                  {licenseSuccess}
                </span>
              )}

              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <a
                  href="https://github.com/brnalemusic"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-accent-primary hover:underline"
                >
                  Need a commercial license? Contact Breno Alexandrē
                </a>

                <button
                  onClick={handleActivateLicense}
                  disabled={activating || !inputLicenseKey.trim()}
                  className="settings-primary-button disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {activating && <CircleNotch size={14} className="animate-spin" />}
                  <span>{activating ? 'Validating...' : 'Activate Key'}</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Confirmation Modal via React Portal */}
      {isActivationModalOpen && licenseInfo && (
        <EnterpriseActivationModal
          licenseInfo={licenseInfo}
          onClose={() => setIsActivationModalOpen(false)}
        />
      )}

      {/* Stripe Payment Verification Modal — global portal */}
      {stripeVerifying &&
        createPortal(
          <div className="prism-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fade-in">
            <div className="prism-modal-panel flex w-full max-w-sm flex-col items-center gap-5 p-8 text-center animate-soft-pop">
              <div className="w-14 h-14 rounded-2xl bg-accent-primary/15 border border-accent-primary/30 flex items-center justify-center">
                <CircleNotch size={28} className="animate-spin text-accent-primary" />
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-lg font-bold text-text-primary">
                  {stripeCheckoutStage === 'opening' ? 'Preparing Checkout' : 'Completing Checkout'}
                </h3>
                <p className="text-xs text-text-secondary/80 leading-relaxed max-w-xs">
                  {stripeCheckoutStage === 'opening'
                    ? 'Creating your secure checkout session.'
                    : 'Please complete your payment in the browser window.'}
                </p>
              </div>

              <button
                onClick={() => {
                  stopSettingsPolling()
                  setStripeVerifying(false)
                }}
                className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors py-1 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body
        )}
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

  const renderSkills = (): React.JSX.Element => (
    <div className="space-y-6 animate-soft-pop">
      <SectionHeader
        title="AI Skills"
        subtitle="Enable or disable specialized AI skills and execution tools for PDF, PowerPoint, and Browser capabilities."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* PowerPoint Skill */}
        <div className="flex flex-col justify-between p-5 rounded-[20px] border border-white/[0.08] bg-white/[0.035] hover:bg-white/[0.05] transition-all">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary">
                <FilePpt size={20} weight="bold" />
              </div>
              <button
                type="button"
                onClick={() => toggleSkillInSettings('pptx')}
                className={clsx(
                  'w-10 h-5 rounded-full transition-colors relative flex items-center p-0.5 cursor-pointer',
                  isSkillEnabledInSettings('pptx') ? 'bg-accent-primary' : 'bg-white/10'
                )}
              >
                <div
                  className={clsx(
                    'w-4 h-4 rounded-full bg-white transition-transform',
                    isSkillEnabledInSettings('pptx') ? 'translate-x-5' : 'translate-x-0'
                  )}
                />
              </button>
            </div>
            <h3 className="text-sm font-semibold text-text-primary">PowerPoint Skill</h3>
            <p className="text-xs text-text-secondary/60 mt-1">
              Allows the AI to learn presentation design guidelines and build 16:9 .pptx slide
              decks.
            </p>
          </div>
        </div>

        {/* PDF Skill */}
        <div className="flex flex-col justify-between p-5 rounded-[20px] border border-white/[0.08] bg-white/[0.035] hover:bg-white/[0.05] transition-all">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary">
                <FilePdf size={20} weight="bold" />
              </div>
              <button
                type="button"
                onClick={() => toggleSkillInSettings('pdf')}
                className={clsx(
                  'w-10 h-5 rounded-full transition-colors relative flex items-center p-0.5 cursor-pointer',
                  isSkillEnabledInSettings('pdf') ? 'bg-accent-primary' : 'bg-white/10'
                )}
              >
                <div
                  className={clsx(
                    'w-4 h-4 rounded-full bg-white transition-transform',
                    isSkillEnabledInSettings('pdf') ? 'translate-x-5' : 'translate-x-0'
                  )}
                />
              </button>
            </div>
            <h3 className="text-sm font-semibold text-text-primary">PDF Skill</h3>
            <p className="text-xs text-text-secondary/60 mt-1">
              Allows the AI to learn document formatting rules and compile clean A4 PDF files.
            </p>
          </div>
        </div>

        {/* Browser Skill */}
        <div className="flex flex-col justify-between p-5 rounded-[20px] border border-white/[0.08] bg-white/[0.035] hover:bg-white/[0.05] transition-all">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary">
                <Globe size={20} weight="bold" />
              </div>
              <button
                type="button"
                onClick={() => toggleSkillInSettings('browser')}
                className={clsx(
                  'w-10 h-5 rounded-full transition-colors relative flex items-center p-0.5 cursor-pointer',
                  isSkillEnabledInSettings('browser') ? 'bg-accent-primary' : 'bg-white/10'
                )}
              >
                <div
                  className={clsx(
                    'w-4 h-4 rounded-full bg-white transition-transform',
                    isSkillEnabledInSettings('browser') ? 'translate-x-5' : 'translate-x-0'
                  )}
                />
              </button>
            </div>
            <h3 className="text-sm font-semibold text-text-primary">Browser Skill</h3>
            <p className="text-xs text-text-secondary/60 mt-1">
              Enables integrated Playwright browser automation, navigation, typing, and page
              snapshots.
            </p>
          </div>
        </div>
      </div>
    </div>
  )

  const renderActiveSection = (): React.JSX.Element => {
    switch (activeSection) {
      case 'shortcuts':
        return renderShortcuts()
      case 'providers':
        return <ApiManagerSettings />
      case 'intelligence':
        return renderIntelligence()
      case 'skills':
        return renderSkills()
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
      case 'discord':
        return renderDiscord()
      case 'license':
        return renderLicense()
      case 'about':
        return renderAbout()
    }
  }

  return (
    <div className="settings-shell flex h-full flex-1 flex-col overflow-hidden bg-black animate-soft-pop">
      <header className="z-20 flex h-16 shrink-0 items-center justify-between border-b border-[var(--border-default)] bg-black px-4 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-text-primary sm:text-lg">Settings</h1>
          <p className="hidden text-xs text-text-muted sm:block">
            Configure how Prism works for you.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {message.text && (
            <span
              className={clsx(
                'hidden items-center gap-1.5 text-xs font-medium animate-soft-pop md:flex',
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

          <button
            onClick={handleReset}
            className="settings-secondary-button hidden sm:inline-flex"
            title="Restore default settings"
          >
            <RotateCcw size={14} />
            Reset
          </button>

          <button onClick={handleSave} disabled={isSaving} className="settings-primary-button">
            <Save size={15} />
            {isSaving ? 'Saving...' : 'Save'}
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-text-secondary transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-raised)] hover:text-text-primary"
              title="Close settings"
            >
              <X size={17} weight="bold" />
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <nav className="hidden w-60 shrink-0 flex-col gap-1 border-r border-[var(--border-default)] bg-[var(--sidebar-bg)] p-4 lg:flex">
          <span className="settings-field-label mb-2 px-3">Preferences</span>
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => handleSectionChange(section.id)}
              className={clsx(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                activeSection === section.id
                  ? 'bg-[var(--sidebar-surface)] font-medium text-text-primary'
                  : 'text-text-secondary hover:bg-[var(--sidebar-hover)] hover:text-text-primary'
              )}
            >
              <span
                className={clsx(
                  'transition-colors',
                  activeSection === section.id ? 'text-accent-primary' : 'text-text-muted'
                )}
              >
                {section.icon}
              </span>
              {section.label}
            </button>
          ))}
        </nav>

        <div className="relative shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-lowest)] p-3 lg:hidden">
          <button
            type="button"
            onClick={() => setIsSectionMenuOpen((current) => !current)}
            className="flex w-full items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--surface)] px-3 py-2.5 text-sm text-text-primary"
            aria-expanded={isSectionMenuOpen}
            aria-haspopup="menu"
          >
            <span className="flex items-center gap-2.5">
              <span className="text-accent-primary">{activeNavSection.icon}</span>
              {activeNavSection.label}
            </span>
            <CaretDown
              size={15}
              className={clsx(
                'text-text-muted transition-transform',
                isSectionMenuOpen && 'rotate-180'
              )}
            />
          </button>

          {isSectionMenuOpen && (
            <div
              role="menu"
              className="absolute left-3 right-3 top-[calc(100%-4px)] z-30 grid max-h-[min(420px,55vh)] grid-cols-2 gap-1 overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface-raised)] p-2 shadow-2xl sm:grid-cols-3"
            >
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  role="menuitem"
                  onClick={() => handleSectionChange(section.id)}
                  className={clsx(
                    'flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs transition-colors',
                    activeSection === section.id
                      ? 'bg-accent-primary/10 font-medium text-text-primary'
                      : 'text-text-secondary hover:bg-white/[0.05] hover:text-text-primary'
                  )}
                >
                  <span
                    className={
                      activeSection === section.id ? 'text-accent-primary' : 'text-text-muted'
                    }
                  >
                    {section.icon}
                  </span>
                  {section.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <main
          ref={contentRef}
          className="settings-content flex-1 overflow-y-auto p-5 sm:p-7 lg:p-10"
        >
          <div className="mx-auto w-full max-w-4xl">{renderActiveSection()}</div>
        </main>
      </div>

      {isEasterEggOpen && <QuantumPhysicsGame onClose={() => setIsEasterEggOpen(false)} />}
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
    <div className="mb-1 border-b border-[var(--border-subtle)] pb-5">
      <h2 className="text-2xl font-semibold tracking-[-0.03em] text-text-primary">{title}</h2>
      <p className="mt-1.5 max-w-2xl text-sm leading-6 text-text-secondary">{subtitle}</p>
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
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {description && <p className="mt-1 text-xs leading-5 text-text-muted">{description}</p>}
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
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        <span className="text-xs leading-5 text-text-secondary">{description}</span>
      </div>
      <button
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
