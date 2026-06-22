import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

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
  defaultModel: string
  subagentModel: string
  minimizeToTray: boolean
  autoLaunch: boolean
  quickLauncherMode?: 'simple' | 'advanced'
  userGeminiKey?: string
  envGeminiKey?: string
  username?: string
  appVersion?: string
  ttsVoice: string
  theme: 'marine' | 'vertez' | 'akoustik' | 'terno' | 'ursula' | 'rgb'
  zoomFactor: number
  terminalShell?: string
  workflows?: SlashWorkflow[]
  rgbThemeExpiry?: number
}

const DEFAULT_CONFIG: AppConfig = {
  launcherShortcut: 'CommandOrControl+Space',
  modelSelectionShortcut: 'CommandOrControl+M',
  screenshotShortcut: 'Ctrl+Alt+Space',
  defaultModel: 'prism-6-super-fast',
  subagentModel: 'prism-6-dragon',
  minimizeToTray: false,
  autoLaunch: false,
  quickLauncherMode: 'simple',
  userGeminiKey: '',
  ttsVoice: 'Aoede',
  theme: 'marine',
  zoomFactor: 1.0,
  terminalShell: 'powershell.exe',
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

const VALID_MODEL_KEYS = new Set([
  'prism-6-super-fast',
  'prism-6-fast-old',
  'prism-6-fast',
  'prism-6-dragon',
  'prism-6-dense'
])
const VALID_VOICES = new Set(['Aoede', 'Puck', 'Charon', 'Kore', 'Fenrir'])
const VALID_THEMES = new Set(['marine', 'vertez', 'akoustik', 'terno', 'ursula', 'rgb'])

function normalizeConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    screenshotShortcut: config.screenshotShortcut || DEFAULT_CONFIG.screenshotShortcut,
    defaultModel: VALID_MODEL_KEYS.has(config.defaultModel)
      ? config.defaultModel
      : DEFAULT_CONFIG.defaultModel,
    subagentModel: VALID_MODEL_KEYS.has(config.subagentModel)
      ? config.subagentModel
      : DEFAULT_CONFIG.subagentModel,
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
    rgbThemeExpiry: config.rgbThemeExpiry
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

    if (
      !parsedConfig.defaultModel ||
      !VALID_MODEL_KEYS.has(parsedConfig.defaultModel) ||
      !parsedConfig.subagentModel ||
      !VALID_MODEL_KEYS.has(parsedConfig.subagentModel)
    ) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
    }

    // Decrypt API key if it exists
    if (config.userGeminiKey) {
      const isHex = /^[0-9a-fA-F]+$/.test(config.userGeminiKey)
      if (safeStorage.isEncryptionAvailable() && isHex) {
        try {
          const buffer = Buffer.from(config.userGeminiKey, 'hex')
          config.userGeminiKey = safeStorage.decryptString(buffer)
        } catch (e) {
          console.error('Failed to decrypt userGeminiKey:', e)
          config.userGeminiKey = ''
        }
      } else if (isHex && !safeStorage.isEncryptionAvailable()) {
        // Prevent using raw encrypted hex string as API key if encryption is not available
        config.userGeminiKey = ''
      }
    }

    return config
  } catch (error) {
    console.error('Failed to load config:', error)
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: AppConfig): boolean {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
    }

    const configToSave = normalizeConfig({ ...config })

    // Encrypt API key if it exists and safeStorage is available
    if (configToSave.userGeminiKey && safeStorage.isEncryptionAvailable()) {
      try {
        const encrypted = safeStorage.encryptString(configToSave.userGeminiKey)
        configToSave.userGeminiKey = encrypted.toString('hex')
      } catch (e) {
        console.error('Failed to encrypt userGeminiKey:', e)
      }
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2))
    return true
  } catch (error) {
    console.error('Failed to save config:', error)
    return false
  }
}
