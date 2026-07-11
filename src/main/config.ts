import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { SessionMode } from '../shared/types'

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
  defaultModel: string
  subagentModel: string
  minimizeToTray: boolean
  autoLaunch: boolean
  quickLauncherMode?: 'simple' | 'advanced'
  userGeminiKey?: string
  envGeminiKey?: string
  userNvidiaNimKey?: string
  envNvidiaNimKey?: string
  userOpenaiKey?: string
  envOpenaiKey?: string
  openaiBaseUrl?: string
  openaiModelId?: string
  openaiModelName?: string
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
}


const DEFAULT_CONFIG: AppConfig = {
  launcherShortcut: 'CommandOrControl+Space',
  modelSelectionShortcut: 'CommandOrControl+M',
  screenshotShortcut: 'Ctrl+Alt+Space',
  newChatShortcut: 'CommandOrControl+N',
  dictationShortcut: 'CommandOrControl+D',
  webSearchShortcut: 'CommandOrControl+S',
  youtubeModeShortcut: 'CommandOrControl+Y',
  defaultModel: 'gemini-3.1-flash-lite',
  subagentModel: 'gemma-4-26b-a4b-it',
  minimizeToTray: false,
  autoLaunch: false,
  quickLauncherMode: 'simple',
  userGeminiKey: '',
  userNvidiaNimKey: '',
  userOpenaiKey: '',
  openaiBaseUrl: '',
  openaiModelId: '',
  openaiModelName: '',
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

const VALID_MODEL_KEYS = new Set([
  // Gemini
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemma-4-26b-a4b-it',
  'gemma-4-31b-it',
  // NVIDIA NIM
  'deepseek-ai/deepseek-v4-flash',
  'deepseek-ai/deepseek-v4-pro',
  'moonshotai/kimi-k2.6',
  'meta/llama-3.2-90b-vision-instruct',
  'minimaxai/minimax-m2.7',
  'minimaxai/minimax-m3',
  'mistralai/mistral-large-3-675b-instruct-2512',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'openai/gpt-oss-120b',
  'microsoft/phi-4-multimodal-instruct',
  'stepfun-ai/step-3.5-flash',
  'stepfun-ai/step-3.7-flash',
  'z-ai/glm-5.2'
])
const VALID_VOICES = new Set(['Aoede', 'Puck', 'Charon', 'Kore', 'Fenrir'])
const VALID_THEMES = new Set(['marine', 'vertez', 'akoustik', 'terno', 'ursula', 'rgb'])
const VALID_SESSION_MODES = new Set(['conversation', 'execution', 'discipline'])

function mapLegacyModelKey(key: string): string {
  const mapping: Record<string, string> = {
    'prism-4': 'gemini-3.1-flash-lite',
    'prism-4.1': 'gemini-3.1-flash-lite',
    'prism-4.2': 'gemma-4-26b-a4b-it',
    'prism-4.3': 'gemma-4-31b-it',
    'prism-5': 'gemini-3.5-flash',
    'prism-6-super-fast': 'gemini-3.1-flash-lite',
    'prism-6-fast-old': 'gemini-3.1-flash-lite',
    'prism-6-fast': 'gemini-3.5-flash',
    'prism-6-dragon': 'gemma-4-26b-a4b-it',
    'prism-6-dense': 'gemma-4-31b-it'
  }
  return mapping[key] || key
}

function normalizeConfig(config: AppConfig): AppConfig {
  const defaultModel = mapLegacyModelKey(config.defaultModel)
  const subagentModel = mapLegacyModelKey(config.subagentModel)
  const isDefaultValid = VALID_MODEL_KEYS.has(defaultModel) || (config.openaiModelId && defaultModel === config.openaiModelId)
  const isSubagentValid = VALID_MODEL_KEYS.has(subagentModel) || (config.openaiModelId && subagentModel === config.openaiModelId)

  return {
    ...config,
    launcherShortcut: config.launcherShortcut || DEFAULT_CONFIG.launcherShortcut,
    modelSelectionShortcut: config.modelSelectionShortcut || DEFAULT_CONFIG.modelSelectionShortcut,
    screenshotShortcut: config.screenshotShortcut || DEFAULT_CONFIG.screenshotShortcut,
    newChatShortcut: config.newChatShortcut || DEFAULT_CONFIG.newChatShortcut,
    dictationShortcut: config.dictationShortcut || DEFAULT_CONFIG.dictationShortcut,
    webSearchShortcut: config.webSearchShortcut || DEFAULT_CONFIG.webSearchShortcut,
    youtubeModeShortcut: config.youtubeModeShortcut || DEFAULT_CONFIG.youtubeModeShortcut,
    defaultModel: isDefaultValid ? defaultModel : DEFAULT_CONFIG.defaultModel,
    subagentModel: isSubagentValid ? subagentModel : DEFAULT_CONFIG.subagentModel,
    userNvidiaNimKey: typeof config.userNvidiaNimKey === 'string' ? config.userNvidiaNimKey : '',
    userOpenaiKey: typeof config.userOpenaiKey === 'string' ? config.userOpenaiKey : '',
    openaiBaseUrl: typeof config.openaiBaseUrl === 'string' ? config.openaiBaseUrl : '',
    openaiModelId: typeof config.openaiModelId === 'string' ? config.openaiModelId : '',
    openaiModelName: typeof config.openaiModelName === 'string' ? config.openaiModelName : '',
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
    disciplinePath: typeof config.disciplinePath === 'string' ? config.disciplinePath : DEFAULT_CONFIG.disciplinePath
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
      !VALID_MODEL_KEYS.has(mapLegacyModelKey(parsedConfig.defaultModel)) ||
      !parsedConfig.subagentModel ||
      !VALID_MODEL_KEYS.has(mapLegacyModelKey(parsedConfig.subagentModel))
    ) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
    }

    // Decrypt API keys if they exist
    const keysToDecrypt = ['userGeminiKey', 'userNvidiaNimKey', 'userOpenaiKey'] as const
    for (const key of keysToDecrypt) {
      const val = config[key]
      if (val) {
        const isHex = /^[0-9a-fA-F]+$/.test(val)
        if (safeStorage.isEncryptionAvailable() && isHex) {
          try {
            const buffer = Buffer.from(val, 'hex')
            config[key] = safeStorage.decryptString(buffer)
          } catch (e) {
            console.error(`Failed to decrypt ${key}:`, e)
            config[key] = ''
          }
        } else if (isHex && !safeStorage.isEncryptionAvailable()) {
          config[key] = ''
        }
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

    // Encrypt API keys if they exist and safeStorage is available
    const keysToEncrypt = ['userGeminiKey', 'userNvidiaNimKey', 'userOpenaiKey'] as const
    for (const key of keysToEncrypt) {
      const val = configToSave[key]
      if (val && safeStorage.isEncryptionAvailable()) {
        try {
          const encrypted = safeStorage.encryptString(val)
          configToSave[key] = encrypted.toString('hex')
        } catch (e) {
          console.error(`Failed to encrypt ${key}:`, e)
        }
      }
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2))
    return true
  } catch (error) {
    console.error('Failed to save config:', error)
    return false
  }
}
