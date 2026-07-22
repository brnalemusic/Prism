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
  toolConstraints?: string[] // optional list of allowed tools (empty/undefined = all allowed)
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
  subagentModel?: string
  minimizeToTray: boolean
  autoLaunch: boolean
  quickLauncherMode?: 'simple' | 'advanced'
  username?: string
  appVersion?: string
  ttsVoice: string
  theme: 'marine' | 'vertez' | 'akoustik' | 'terno' | 'ursula' | 'rgb'
  zoomFactor: number
  terminalShell?: string
  workflows?: SlashWorkflow[]
  rgbThemeExpiry?: number
  sessionMode: SessionMode
  disciplinePath?: string
  modelReasoningLevels?: Record<string, string>
}

const DEFAULT_CONFIG: AppConfig = {
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
  subagentModel: '',
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
        "You are running in Web Search Mode. Your goal is to conduct deep, comprehensive research on the user's query. Use the web_search tool to find relevant information. Analyze search results carefully, verify facts across multiple sources, and present a structured, clear summary of the findings with references.",
      toolConstraints: ['web_search', 'saw_link_from_url', 'open_browser_link']
    },
    {
      id: 'default-subagents',
      command: '/subagents',
      name: 'Subagents Swarm',
      description: 'Delegate complex tasks to a swarm of subagents',
      systemInstruction:
        "You are running in Subagent Mode. Your goal is to delegate and orchestrate the user's request using worker subagents. First, analyze the task requirements and break them down. Then, spawn the required number of subagents using the run_subagents tool. Coordinate their execution, monitor group chat updates, and synthesize their individual outputs into a comprehensive final report.",
      toolConstraints: ['run_subagents']
    },
    {
      id: 'default-summarize',
      command: '/summarize',
      name: 'Summarizer',
      description: 'Create a structured summary of the text and check for errors',
      systemInstruction:
        "You are running in Summarize Mode. Your goal is to analyze the user's input text, extract the key points, organize them in a clean structure, check for spelling, grammar, or factual errors, and output a concise, professional summary.",
      toolConstraints: []
    }
  ]
}

const VALID_VOICES = new Set(['Aoede', 'Puck', 'Charon', 'Kore', 'Fenrir'])
const VALID_THEMES = new Set(['marine', 'vertez', 'akoustik', 'terno', 'ursula', 'rgb'])
const VALID_SESSION_MODES = new Set(['conversation', 'execution', 'discipline'])

function normalizeConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    launcherShortcut: config.launcherShortcut || DEFAULT_CONFIG.launcherShortcut,
    modelSelectionShortcut: config.modelSelectionShortcut || DEFAULT_CONFIG.modelSelectionShortcut,
    screenshotShortcut: config.screenshotShortcut || DEFAULT_CONFIG.screenshotShortcut,
    newChatShortcut: config.newChatShortcut || DEFAULT_CONFIG.newChatShortcut,
    dictationShortcut: config.dictationShortcut || DEFAULT_CONFIG.dictationShortcut,
    webSearchShortcut: config.webSearchShortcut || DEFAULT_CONFIG.webSearchShortcut,
    youtubeModeShortcut: config.youtubeModeShortcut || DEFAULT_CONFIG.youtubeModeShortcut,
    providers: Array.isArray(config.providers) ? config.providers : [],
    lastSelectedChatModel: typeof config.lastSelectedChatModel === 'string' ? config.lastSelectedChatModel : '',
    sttModel: typeof config.sttModel === 'string' ? config.sttModel : '',
    quickLauncherModel: typeof config.quickLauncherModel === 'string' ? config.quickLauncherModel : '',
    searchModel: typeof config.searchModel === 'string' ? config.searchModel : '',
    subagentModel: typeof config.subagentModel === 'string' ? config.subagentModel : '',
    ttsVoice: VALID_VOICES.has(config.ttsVoice) ? config.ttsVoice : DEFAULT_CONFIG.ttsVoice,
    theme: VALID_THEMES.has(config.theme)
      ? (config.theme as 'marine' | 'vertez' | 'akoustik' | 'terno' | 'ursula' | 'rgb')
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
    sessionMode: VALID_SESSION_MODES.has(config.sessionMode) ? config.sessionMode : DEFAULT_CONFIG.sessionMode,
    disciplinePath: typeof config.disciplinePath === 'string' ? config.disciplinePath : DEFAULT_CONFIG.disciplinePath,
    modelReasoningLevels: config.modelReasoningLevels || {}
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

    const data = fs.readFileSync(CONFIG_FILE, 'utf-8')
    const parsedConfig = JSON.parse(data)
    const config = normalizeConfig({ ...DEFAULT_CONFIG, ...parsedConfig })

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

export function saveConfig(config: Partial<AppConfig>): boolean {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
    }

    const existingConfig = loadConfig()
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

