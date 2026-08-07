import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { SessionMode, ProviderConfig } from '../shared/types'

export interface SlashWorkflow {
  id: string
  command: string // e.g., "/summarize"
  name: string // e.g., "Summarizer"
  description: string // e.g., "Summarize text and check for errors"
  systemInstruction: string // instructions injected into system prompt
  toolConstraints?: string[] // undefined allows all tools; an empty list disables tools
}

export interface AppConfig {
  launcherShortcut: string
  modelSelectionShortcut: string
  screenshotShortcut: string
  newChatShortcut: string
  dictationShortcut: string
  webSearchShortcut: string
  youtubeModeShortcut: string
  providers: ProviderConfig[]
  lastSelectedChatModel?: string
  sttModel?: string
  quickLauncherModel?: string
  searchModel?: string
  minimizeToTray: boolean
  autoLaunch: boolean
  quickLauncherMode?: 'simple' | 'advanced'
  username?: string
  appVersion?: string
  ttsVoice: string
  theme:
    | 'marine'
    | 'vertez'
    | 'akoustik'
    | 'terno'
    | 'ursula'
    | 'rgb'
    | 'fire'
    | 'lava'
    | 'gold'
    | 'forest'
    | 'indigo'
    | 'violet'
    | 'white'
  zoomFactor: number
  terminalShell?: string
  workflows?: SlashWorkflow[]
  rgbThemeExpiry?: number
  sessionMode: SessionMode
  disciplinePath?: string
  modelReasoningLevels?: Record<string, string>
  userGeminiKey?: string
  userNvidiaNimKey?: string
  userOpenaiKey?: string
  openaiBaseUrl?: string
  openaiModelId?: string
  openaiModelName?: string
  defaultModel?: string
  licenseKey?: string
  suppressLicenseModal?: boolean
  hasResetV8Keys?: boolean
  discordBotToken?: string
  discordGatewayEnabled?: boolean
  discordGatewayModel?: string
}

const DEFAULT_CONFIG: AppConfig = {
  hasResetV8Keys: false,
  suppressLicenseModal: false,
  launcherShortcut: 'CommandOrControl+Space',
  modelSelectionShortcut: 'CommandOrControl+M',
  screenshotShortcut: 'Ctrl+Alt+Space',
  newChatShortcut: 'CommandOrControl+N',
  dictationShortcut: 'CommandOrControl+D',
  webSearchShortcut: 'CommandOrControl+S',
  youtubeModeShortcut: 'CommandOrControl+Y',
  providers: [],
  lastSelectedChatModel: '',
  sttModel: '',
  quickLauncherModel: '',
  searchModel: '',
  discordBotToken: '',
  discordGatewayEnabled: false,
  discordGatewayModel: '',
  minimizeToTray: false,
  modelReasoningLevels: {},
  autoLaunch: false,
  quickLauncherMode: 'simple',
  ttsVoice: 'Aoede',
  theme: 'marine',
  zoomFactor: 1.0,
  terminalShell: 'powershell.exe',
  sessionMode: 'execution',
  disciplinePath: '',
  workflows: [
    {
      id: 'default-search',
      command: '/search',
      name: 'Search',
      description: 'Perform deep web research on a topic',
      systemInstruction:
        'Deep web research mode. Use web_search to find information, verify facts across sources, and output a structured summary with references.',
      toolConstraints: ['web_search', 'saw_link_from_url', 'open_browser_link']
    },
    {
      id: 'default-summarize',
      command: '/summarize',
      name: 'Summarizer',
      description: 'Create a structured summary of the text and check for errors',
      systemInstruction:
        'Summarize mode. Analyze input, extract key points, organize cleanly, fix errors, and output a concise summary.',
      toolConstraints: []
    }
  ]
}

const VALID_VOICES = new Set(['Aoede', 'Puck', 'Charon', 'Kore', 'Fenrir'])
const VALID_THEMES = new Set([
  'marine',
  'vertez',
  'akoustik',
  'terno',
  'ursula',
  'rgb',
  'fire',
  'lava',
  'gold',
  'forest',
  'indigo',
  'violet',
  'white'
])
const VALID_SESSION_MODES = new Set(['conversation', 'execution', 'discipline'])
const VALID_PRISM_THINKING_LEVELS = new Set(['minimal', 'low', 'medium', 'high'])
const PRISM_CLOUD_MODEL_IDS = new Set([
  'gemini-3.1-flash-lite',
  'models/gemini-3-flash-preview',
  'gemini-3-flash-preview'
])

export function normalizeReasoningLevels(levels?: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [modelKey, level] of Object.entries(levels || {})) {
    const cleanKey = modelKey.startsWith('prism_provider:')
      ? modelKey.slice('prism_provider:'.length)
      : modelKey
    const isPrismCloudKey = PRISM_CLOUD_MODEL_IDS.has(cleanKey)
    normalized[modelKey] = isPrismCloudKey
      ? VALID_PRISM_THINKING_LEVELS.has(level)
        ? level
        : 'minimal'
      : level
  }
  return normalized
}

function tryDecryptKey(key?: string): string {
  if (!key || typeof key !== 'string') return ''
  const trimmed = key.trim()
  if (!trimmed) return ''
  const isHex = /^[0-9a-fA-F]+$/.test(trimmed)
  if (isHex && safeStorage.isEncryptionAvailable()) {
    try {
      const buffer = Buffer.from(trimmed, 'hex')
      return safeStorage.decryptString(buffer)
    } catch {
      return trimmed
    }
  }
  return trimmed
}

export function synthesizeLegacyProviders(config: Partial<AppConfig>): ProviderConfig[] {
  // If v8 migration has already taken place or providers array is defined, legacy synthesis is bypassed
  if (config.hasResetV8Keys || Array.isArray(config.providers)) {
    return []
  }

  const synthesized: ProviderConfig[] = []

  const legacyGemini = tryDecryptKey(config.userGeminiKey)
  if (legacyGemini && legacyGemini.trim() !== '') {
    const defaultModel = config.defaultModel || config.lastSelectedChatModel || 'gemini-3.6-flash'
    synthesized.push({
      id: 'google-gemini',
      name: 'Google AI Studio',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: legacyGemini.trim(),
      completionType: 'gemini_native',
      isTrusted: true,
      models: [
        { id: defaultModel, name: defaultModel, enabled: true, isTrusted: true },
        {
          id: 'gemini-3.5-flash-lite',
          name: 'gemini-3.5-flash-lite',
          enabled: true,
          isTrusted: true
        },
        { id: 'gemini-3.1-pro', name: 'gemini-3.1-pro', enabled: true, isTrusted: true }
      ]
    })
  }

  const legacyNvidia = tryDecryptKey(config.userNvidiaNimKey)
  if (legacyNvidia && legacyNvidia.trim() !== '') {
    synthesized.push({
      id: 'nvidia-nim',
      name: 'NVIDIA NIM',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: legacyNvidia.trim(),
      completionType: 'chat_completions',
      isTrusted: true,
      models: [
        {
          id: 'meta/llama-3.3-70b-instruct',
          name: 'meta/llama-3.3-70b-instruct',
          enabled: true,
          isTrusted: true
        }
      ]
    })
  }

  const legacyOpenai = tryDecryptKey(config.userOpenaiKey)
  if (legacyOpenai && legacyOpenai.trim() !== '') {
    const modelId = config.openaiModelId || 'gpt-4o'
    synthesized.push({
      id: 'openai',
      name: 'OpenAI GPT',
      baseUrl: config.openaiBaseUrl || 'https://api.openai.com/v1',
      apiKey: legacyOpenai.trim(),
      completionType: 'chat_completions',
      isTrusted: true,
      models: [
        { id: modelId, name: config.openaiModelName || modelId, enabled: true, isTrusted: true }
      ]
    })
  }

  return synthesized
}

function normalizeConfig(config: AppConfig): AppConfig {
  const providers = Array.isArray(config.providers) ? [...config.providers] : []

  return {
    ...config,
    userGeminiKey: '',
    userNvidiaNimKey: '',
    userOpenaiKey: '',
    openaiBaseUrl: undefined,
    openaiModelId: undefined,
    openaiModelName: undefined,
    hasResetV8Keys: true,
    launcherShortcut: config.launcherShortcut || DEFAULT_CONFIG.launcherShortcut,
    modelSelectionShortcut: config.modelSelectionShortcut || DEFAULT_CONFIG.modelSelectionShortcut,
    screenshotShortcut: config.screenshotShortcut || DEFAULT_CONFIG.screenshotShortcut,
    newChatShortcut: config.newChatShortcut || DEFAULT_CONFIG.newChatShortcut,
    dictationShortcut: config.dictationShortcut || DEFAULT_CONFIG.dictationShortcut,
    webSearchShortcut: config.webSearchShortcut || DEFAULT_CONFIG.webSearchShortcut,
    youtubeModeShortcut: config.youtubeModeShortcut || DEFAULT_CONFIG.youtubeModeShortcut,
    providers,
    lastSelectedChatModel:
      typeof config.lastSelectedChatModel === 'string' ? config.lastSelectedChatModel : '',
    sttModel: typeof config.sttModel === 'string' ? config.sttModel : '',
    quickLauncherModel:
      typeof config.quickLauncherModel === 'string' ? config.quickLauncherModel : '',
    searchModel: typeof config.searchModel === 'string' ? config.searchModel : '',
    discordBotToken: typeof config.discordBotToken === 'string' ? config.discordBotToken : '',
    discordGatewayEnabled: typeof config.discordGatewayEnabled === 'boolean' ? config.discordGatewayEnabled : false,
    discordGatewayModel: typeof config.discordGatewayModel === 'string' ? config.discordGatewayModel : '',
    ttsVoice: VALID_VOICES.has(config.ttsVoice) ? config.ttsVoice : DEFAULT_CONFIG.ttsVoice,
    theme: VALID_THEMES.has(config.theme)
      ? (config.theme as AppConfig['theme'])
      : DEFAULT_CONFIG.theme,
    zoomFactor:
      config.zoomFactor !== undefined &&
      !isNaN(config.zoomFactor) &&
      config.zoomFactor >= 0.5 &&
      config.zoomFactor <= 3.0
        ? config.zoomFactor
        : DEFAULT_CONFIG.zoomFactor,
    terminalShell: config.terminalShell || DEFAULT_CONFIG.terminalShell,
    workflows: Array.isArray(config.workflows) ? config.workflows : DEFAULT_CONFIG.workflows,
    rgbThemeExpiry: config.rgbThemeExpiry,
    sessionMode: VALID_SESSION_MODES.has(config.sessionMode)
      ? config.sessionMode
      : DEFAULT_CONFIG.sessionMode,
    disciplinePath:
      typeof config.disciplinePath === 'string'
        ? config.disciplinePath
        : DEFAULT_CONFIG.disciplinePath,
    modelReasoningLevels: normalizeReasoningLevels(config.modelReasoningLevels)
  }
}

const CONFIG_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'),
  'PrismDesktop'
)
const CONFIG_FILE = path.join(CONFIG_DIR, 'prismconfigs.cfg')

export function loadConfig(): AppConfig {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
    }

    if (!fs.existsSync(CONFIG_FILE)) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2))
      return DEFAULT_CONFIG
    }

    let data: string
    try {
      data = fs.readFileSync(CONFIG_FILE, 'utf-8')
    } catch (readErr) {
      console.error('[Config] Failed to read config file:', readErr)
      return DEFAULT_CONFIG
    }

    let parsedConfig: Partial<AppConfig> & Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(data)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Config root must be a JSON object.')
      }
      parsedConfig = parsed as Partial<AppConfig> & Record<string, unknown>
    } catch (parseErr) {
      // Config file is corrupted — back it up and start fresh
      console.error(
        '[Config] Config file is corrupted. Backing up and resetting to defaults.',
        parseErr
      )
      const backupPath = CONFIG_FILE + `.corrupted.${Date.now()}.bak`
      try {
        fs.copyFileSync(CONFIG_FILE, backupPath)
        console.log(`[Config] Corrupted config backed up to: ${backupPath}`)
      } catch (backupErr) {
        console.error('[Config] Failed to back up corrupted config:', backupErr)
      }
      try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2))
      } catch (writeErr) {
        console.error('[Config] Failed to write default config:', writeErr)
      }
      return DEFAULT_CONFIG
    }

    // One-time clean reset for v8.0.0 migration
    if (!parsedConfig.hasResetV8Keys) {
      console.log(
        '[Config] Upgrading to v8.0.0 fresh start. Cleaning legacy keys and custom providers once...'
      )
      parsedConfig.providers = []
      parsedConfig.userGeminiKey = ''
      parsedConfig.userNvidiaNimKey = ''
      parsedConfig.userOpenaiKey = ''
      parsedConfig.lastSelectedChatModel = ''
      parsedConfig.hasResetV8Keys = true
      try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(parsedConfig, null, 2))
      } catch (e) {
        console.error('Failed to save v8 reset config:', e)
      }
    }

    const config = normalizeConfig({ ...DEFAULT_CONFIG, ...parsedConfig })

    if (
      JSON.stringify(parsedConfig.modelReasoningLevels || {}) !==
      JSON.stringify(config.modelReasoningLevels || {})
    ) {
      try {
        fs.writeFileSync(
          CONFIG_FILE,
          JSON.stringify(
            { ...parsedConfig, modelReasoningLevels: config.modelReasoningLevels },
            null,
            2
          )
        )
      } catch (migrationError) {
        console.error(
          '[Config] Failed to persist Prism Cloud thinking-level migration:',
          migrationError
        )
      }
    }

    // Decrypt API keys inside providers if safeStorage was used
    if (config.providers && Array.isArray(config.providers)) {
      config.providers = config.providers.map((p) => {
        let key = p.apiKey || ''
        const isHex = /^[0-9a-fA-F]+$/.test(key)
        if (key && safeStorage.isEncryptionAvailable() && isHex) {
          try {
            const buffer = Buffer.from(key, 'hex')
            key = safeStorage.decryptString(buffer)
          } catch (e) {
            console.error(`Failed to decrypt provider ${p.name} key:`, e)
          }
        }
        return { ...p, apiKey: key }
      })
    }

    return config
  } catch (error) {
    console.error('Failed to load config:', error)
    return DEFAULT_CONFIG
  }
}

/**
 * Saves a partial config by merging with the current on-disk config.
 *
 * @param config  The fields to save.
 * @param currentConfig  Optional: pass the already-loaded config to avoid
 *   reading the config file from disk again (eliminates a redundant
 *   read + safeStorage decrypt on every save call).
 */
export function saveConfig(config: Partial<AppConfig>, currentConfig?: AppConfig): boolean {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
    }

    // Use the caller-supplied config snapshot to avoid a redundant disk read
    const existingConfig = currentConfig ?? loadConfig()
    const mergedConfig = { ...existingConfig, ...config }
    const configToSave = normalizeConfig(mergedConfig)

    // Encrypt API keys inside providers using safeStorage if not already encrypted
    if (configToSave.providers && Array.isArray(configToSave.providers)) {
      configToSave.providers = configToSave.providers.map((p) => {
        let key = p.apiKey || ''
        let isAlreadyEncrypted = false
        if (key && /^[0-9a-fA-F]+$/.test(key)) {
          try {
            safeStorage.decryptString(Buffer.from(key, 'hex'))
            isAlreadyEncrypted = true
          } catch {
            isAlreadyEncrypted = false
          }
        }
        if (key && safeStorage.isEncryptionAvailable() && !isAlreadyEncrypted) {
          try {
            const encrypted = safeStorage.encryptString(key)
            key = encrypted.toString('hex')
          } catch (e) {
            console.error(`Failed to encrypt provider ${p.name} key:`, e)
          }
        }
        return { ...p, apiKey: key }
      })
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2))
    return true
  } catch (error) {
    console.error('Failed to save config:', error)
    return false
  }
}
