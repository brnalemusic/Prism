import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import {
  SessionMode,
  ProviderConfig,
  HarnessSettings,
  HarnessToolName,
  HarnessProjectConfig
} from '../shared/types'

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
  generativeBrowserModel?: string
  imageGenerationModel?: string
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
  discordGatewayVoiceModel?: string
  disabledSkills?: string[]
  harness: HarnessSettings
}

export const DEFAULT_HARNESS_TOOLS: HarnessToolName[] = [
  'read',
  'list',
  'find',
  'grep',
  'to_ask',
  'write',
  'edit',
  'delete_lines',
  'apply_patch',
  'exec_command',
  'write_stdin',
  'read_terminal_output',
  'web_search'
]

const defaultHarnessProjectsRoot = (): string =>
  path.join(app.getPath('documents'), 'PrismProjects')

export function createDefaultHarnessSettings(): HarnessSettings {
  return {
    toolManifestVersion: 2,
    projectsRoot: defaultHarnessProjectsRoot(),
    defaultPermissionMode: 'ask',
    defaultMaxRounds: 200,
    enabledTools: [...DEFAULT_HARNESS_TOOLS],
    maxReadLines: 800,
    maxReadCharacters: 80_000,
    maxTerminalOutputCharacters: 100_000,
    maxContextCharacters: 80_000,
    webPageCount: 5,
    showSteps: true,
    showThinking: true,
    animateActivity: true,
    reduceMotion: false,
    tabProjectMode: 'fixed',
    startupProjectMode: 'last_opened',
    defaultProjectPath: undefined,
    userGlobalInstructions: '',
    yoloAcknowledged: false,
    projects: {}
  }
}

const DEFAULT_CONFIG: AppConfig = {
  disabledSkills: [],
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
  generativeBrowserModel: '',
  imageGenerationModel: '',
  discordBotToken: '',
  discordGatewayEnabled: false,
  discordGatewayModel: '',
  discordGatewayVoiceModel: '',
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
  harness: createDefaultHarnessSettings(),
  workflows: [
    {
      id: 'default-search',
      command: '/search',
      name: 'Search',
      description: 'Perform deep web research on a topic',
      systemInstruction:
        'Deep web research mode. Always use web_fetch for comprehensive, in-depth multi-source research (synthesizing up to 50 web Sources), or web_search with an explicit resultCount from 1 to 10 for standard queries.',
      toolConstraints: ['web_search', 'web_fetch', 'open_browser_link']
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
const VALID_SESSION_MODES = new Set(['conversation', 'execution', 'discipline', 'harness'])
const VALID_HARNESS_PERMISSION_MODES = new Set(['ask', 'independent', 'yolo'])
const VALID_HARNESS_STARTUP_MODES = new Set(['last_opened', 'default_project', 'prompt'])
const VALID_HARNESS_TOOLS = new Set<string>(DEFAULT_HARNESS_TOOLS)
const VALID_PRISM_THINKING_LEVELS = new Set(['minimal', 'low', 'medium', 'high'])
const PRISM_CLOUD_MODEL_IDS = new Set([
  'prism-ai/arcadia-1.0-mini',
  'prism-ai/arcadia-1.0-flash',
  'prism-ai/arcadia-1.0-pro',
  'prism-ai/arcadia-1.1-flash',
  'arcadia-1.0-mini',
  'arcadia-1.0-flash',
  'arcadia-1.0-pro',
  'arcadia-1.1-flash'
])

export function migrateLegacyModelKey(key: string): string {
  if (!key || typeof key !== 'string') return ''
  if (key === 'gemini-3.1-flash-lite' || key === 'prism_provider:gemini-3.1-flash-lite') {
    return 'prism_provider:prism-ai/arcadia-1.0-mini'
  }
  if (
    key === 'models/gemini-3-flash-preview' ||
    key === 'gemini-3-flash-preview' ||
    key === 'gemini-3-flash' ||
    key === 'prism_provider:models/gemini-3-flash-preview' ||
    key === 'prism_provider:gemini-3-flash-preview' ||
    key === 'prism_provider:gemini-3-flash'
  ) {
    return 'prism_provider:prism-ai/arcadia-1.0-flash'
  }
  return key
}

export function normalizeReasoningLevels(levels?: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [rawModelKey, level] of Object.entries(levels || {})) {
    const modelKey = migrateLegacyModelKey(rawModelKey)
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
  const defaultHarness = createDefaultHarnessSettings()
  const rawHarness = config.harness || defaultHarness
  const upgradeHarnessToolDefaults = rawHarness.toolManifestVersion !== 2
  const normalizeInteger = (
    value: unknown,
    fallback: number,
    minimum: number,
    maximum: number
  ): number =>
    typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
      ? value
      : fallback
  const normalizedProjects: Record<string, HarnessProjectConfig> = {}
  if (
    rawHarness.projects &&
    typeof rawHarness.projects === 'object' &&
    !Array.isArray(rawHarness.projects)
  ) {
    for (const rawProject of Object.values(rawHarness.projects)) {
      if (!rawProject || typeof rawProject !== 'object' || Array.isArray(rawProject)) continue
      const candidate = rawProject as Partial<HarnessProjectConfig>
      if (typeof candidate.rootPath !== 'string' || !candidate.rootPath.trim()) continue
      const rootPath = path.resolve(candidate.rootPath)
      const project: HarnessProjectConfig = {
        rootPath,
        displayName:
          typeof candidate.displayName === 'string' && candidate.displayName.trim()
            ? candidate.displayName.trim()
            : path.basename(rootPath),
        createdAt:
          typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
            ? candidate.createdAt
            : Date.now(),
        updatedAt:
          typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
            ? candidate.updatedAt
            : Date.now(),
        permissionMode:
          typeof candidate.permissionMode === 'string' &&
          VALID_HARNESS_PERMISSION_MODES.has(candidate.permissionMode)
            ? candidate.permissionMode
            : undefined,
        maxRounds:
          candidate.maxRounds === undefined
            ? undefined
            : normalizeInteger(candidate.maxRounds, defaultHarness.defaultMaxRounds, 1, 1000),
        enabledTools: Array.isArray(candidate.enabledTools)
          ? (Array.from(
              new Set([
                ...candidate.enabledTools.filter((name) => VALID_HARNESS_TOOLS.has(name)),
                ...(upgradeHarnessToolDefaults ? ['to_ask'] : [])
              ])
            ) as HarnessToolName[])
          : undefined,
        maxReadLines:
          candidate.maxReadLines === undefined
            ? undefined
            : normalizeInteger(candidate.maxReadLines, defaultHarness.maxReadLines, 1, 5000),
        maxReadCharacters:
          candidate.maxReadCharacters === undefined
            ? undefined
            : normalizeInteger(
                candidate.maxReadCharacters,
                defaultHarness.maxReadCharacters,
                1000,
                500_000
              ),
        maxTerminalOutputCharacters:
          candidate.maxTerminalOutputCharacters === undefined
            ? undefined
            : normalizeInteger(
                candidate.maxTerminalOutputCharacters,
                defaultHarness.maxTerminalOutputCharacters,
                1000,
                1_000_000
              ),
        maxContextCharacters:
          candidate.maxContextCharacters === undefined
            ? undefined
            : normalizeInteger(
                candidate.maxContextCharacters,
                defaultHarness.maxContextCharacters,
                10_000,
                200_000
              ),
        webPageCount:
          candidate.webPageCount === undefined
            ? undefined
            : normalizeInteger(candidate.webPageCount, defaultHarness.webPageCount, 3, 5),
        showSteps: typeof candidate.showSteps === 'boolean' ? candidate.showSteps : undefined,
        showThinking:
          typeof candidate.showThinking === 'boolean' ? candidate.showThinking : undefined,
        animateActivity:
          typeof candidate.animateActivity === 'boolean' ? candidate.animateActivity : undefined,
        reduceMotion:
          typeof candidate.reduceMotion === 'boolean' ? candidate.reduceMotion : undefined,
        userProjectInstructions:
          typeof candidate.userProjectInstructions === 'string'
            ? candidate.userProjectInstructions.slice(0, 5000)
            : undefined
      }
      const key = rootPath.replace(/[\\/]+$/, '')
      normalizedProjects[process.platform === 'win32' ? key.toLowerCase() : key] = project
    }
  }
  const normalizedHarness: HarnessSettings = {
    ...defaultHarness,
    ...rawHarness,
    toolManifestVersion: 2,
    projectsRoot:
      typeof rawHarness.projectsRoot === 'string' && rawHarness.projectsRoot.trim()
        ? path.resolve(rawHarness.projectsRoot.trim())
        : defaultHarness.projectsRoot,
    defaultPermissionMode: VALID_HARNESS_PERMISSION_MODES.has(rawHarness.defaultPermissionMode)
      ? rawHarness.defaultPermissionMode
      : defaultHarness.defaultPermissionMode,
    defaultMaxRounds: normalizeInteger(rawHarness.defaultMaxRounds, 200, 1, 1000),
    enabledTools: Array.isArray(rawHarness.enabledTools)
      ? (Array.from(
          new Set([
            ...rawHarness.enabledTools.filter((name) => VALID_HARNESS_TOOLS.has(name)),
            ...(upgradeHarnessToolDefaults ? ['to_ask'] : [])
          ])
        ) as HarnessToolName[])
      : [...DEFAULT_HARNESS_TOOLS],
    maxReadLines: normalizeInteger(rawHarness.maxReadLines, 800, 1, 5000),
    maxReadCharacters: normalizeInteger(rawHarness.maxReadCharacters, 80_000, 1000, 500_000),
    maxTerminalOutputCharacters: normalizeInteger(
      rawHarness.maxTerminalOutputCharacters,
      100_000,
      1000,
      1_000_000
    ),
    maxContextCharacters: normalizeInteger(
      rawHarness.maxContextCharacters,
      80_000,
      10_000,
      200_000
    ),
    webPageCount: normalizeInteger(rawHarness.webPageCount, 5, 3, 5),
    showSteps: rawHarness.showSteps !== false,
    showThinking: rawHarness.showThinking !== false,
    animateActivity: rawHarness.animateActivity !== false,
    reduceMotion: rawHarness.reduceMotion === true,
    tabProjectMode: rawHarness.tabProjectMode === 'grouped' ? 'grouped' : 'fixed',
    startupProjectMode:
      typeof rawHarness.startupProjectMode === 'string' &&
      VALID_HARNESS_STARTUP_MODES.has(rawHarness.startupProjectMode)
        ? (rawHarness.startupProjectMode as 'last_opened' | 'default_project' | 'prompt')
        : 'last_opened',
    defaultProjectPath:
      typeof rawHarness.defaultProjectPath === 'string' && rawHarness.defaultProjectPath.trim()
        ? path.resolve(rawHarness.defaultProjectPath)
        : undefined,
    userGlobalInstructions:
      typeof rawHarness.userGlobalInstructions === 'string'
        ? rawHarness.userGlobalInstructions.slice(0, 5000)
        : '',
    yoloAcknowledged: rawHarness.yoloAcknowledged === true,
    lastProjectPath:
      typeof rawHarness.lastProjectPath === 'string' && rawHarness.lastProjectPath.trim()
        ? path.resolve(rawHarness.lastProjectPath)
        : undefined,
    projects: normalizedProjects
  }
  const providers = (Array.isArray(config.providers) ? config.providers : []).map((provider) => {
    if (
      provider?.completionType === 'puter_native' &&
      !provider.puterAuthToken?.trim() &&
      provider.apiKey?.trim()
    ) {
      // Older Prism releases stored the account session in apiKey. Keep existing
      // Puter accounts working while making the User-Pays credential explicit.
      return { ...provider, puterAuthToken: provider.apiKey, apiKey: '' }
    }
    return provider
  })

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
      typeof config.lastSelectedChatModel === 'string'
        ? migrateLegacyModelKey(config.lastSelectedChatModel)
        : '',
    sttModel: typeof config.sttModel === 'string' ? config.sttModel : '',
    quickLauncherModel:
      typeof config.quickLauncherModel === 'string'
        ? migrateLegacyModelKey(config.quickLauncherModel)
        : '',
    searchModel:
      typeof config.searchModel === 'string' ? migrateLegacyModelKey(config.searchModel) : '',
    generativeBrowserModel:
      typeof config.generativeBrowserModel === 'string'
        ? migrateLegacyModelKey(config.generativeBrowserModel)
        : '',
    imageGenerationModel:
      typeof config.imageGenerationModel === 'string'
        ? migrateLegacyModelKey(config.imageGenerationModel)
        : '',
    discordBotToken: typeof config.discordBotToken === 'string' ? config.discordBotToken : '',
    discordGatewayEnabled:
      typeof config.discordGatewayEnabled === 'boolean' ? config.discordGatewayEnabled : false,
    discordGatewayModel:
      typeof config.discordGatewayModel === 'string' ? config.discordGatewayModel : '',
    discordGatewayVoiceModel:
      typeof config.discordGatewayVoiceModel === 'string' ? config.discordGatewayVoiceModel : '',
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
    harness: normalizedHarness,
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

    const normalizedReasoningLevelsChanged =
      JSON.stringify(parsedConfig.modelReasoningLevels || {}) !==
      JSON.stringify(config.modelReasoningLevels || {})
    const normalizedProvidersChanged =
      JSON.stringify(parsedConfig.providers || []) !== JSON.stringify(config.providers || [])
    if (normalizedReasoningLevelsChanged || normalizedProvidersChanged) {
      try {
        fs.writeFileSync(
          CONFIG_FILE,
          JSON.stringify(
            {
              ...parsedConfig,
              modelReasoningLevels: config.modelReasoningLevels,
              providers: config.providers
            },
            null,
            2
          )
        )
      } catch (migrationError) {
        console.error('[Config] Failed to persist config normalization:', migrationError)
      }
    }

    // Decrypt provider credentials if safeStorage was used.
    if (config.providers && Array.isArray(config.providers)) {
      config.providers = config.providers.map((p) => {
        const decrypt = (value: string, label: string): string => {
          const isHex = /^[0-9a-fA-F]+$/.test(value)
          if (!value || !safeStorage.isEncryptionAvailable() || !isHex) return value
          try {
            return safeStorage.decryptString(Buffer.from(value, 'hex'))
          } catch (e) {
            console.error(`Failed to decrypt provider ${p.name} ${label}:`, e)
            return value
          }
        }
        return {
          ...p,
          apiKey: decrypt(p.apiKey || '', 'API key'),
          puterAuthToken: decrypt(p.puterAuthToken || '', 'Puter session')
        }
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

    // Encrypt provider credentials using safeStorage if not already encrypted.
    if (configToSave.providers && Array.isArray(configToSave.providers)) {
      configToSave.providers = configToSave.providers.map((p) => {
        const encrypt = (value: string, label: string): string => {
          let encryptedValue = value
          let isAlreadyEncrypted = false
          if (encryptedValue && /^[0-9a-fA-F]+$/.test(encryptedValue)) {
            try {
              safeStorage.decryptString(Buffer.from(encryptedValue, 'hex'))
              isAlreadyEncrypted = true
            } catch {
              isAlreadyEncrypted = false
            }
          }
          if (encryptedValue && safeStorage.isEncryptionAvailable() && !isAlreadyEncrypted) {
            try {
              encryptedValue = safeStorage.encryptString(encryptedValue).toString('hex')
            } catch (e) {
              console.error(`Failed to encrypt provider ${p.name} ${label}:`, e)
            }
          }
          return encryptedValue
        }
        return {
          ...p,
          apiKey: encrypt(p.apiKey || '', 'API key'),
          puterAuthToken: encrypt(p.puterAuthToken || '', 'Puter session')
        }
      })
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2))
    return true
  } catch (error) {
    console.error('Failed to save config:', error)
    return false
  }
}
