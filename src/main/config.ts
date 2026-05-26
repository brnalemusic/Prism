import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

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
}

const DEFAULT_CONFIG: AppConfig = {
  launcherShortcut: 'CommandOrControl+Space',
  modelSelectionShortcut: 'CommandOrControl+M',
  screenshotShortcut: 'Ctrl+Alt+Space',
  defaultModel: 'prism-5',
  subagentModel: 'prism-4.2',
  minimizeToTray: false,
  autoLaunch: false,
  quickLauncherMode: 'simple',
  userGeminiKey: ''
}

const VALID_MODEL_KEYS = new Set(['prism-5', 'prism-4.3', 'prism-4.2', 'prism-4.1', 'prism-4'])

function normalizeConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    screenshotShortcut: config.screenshotShortcut || DEFAULT_CONFIG.screenshotShortcut,
    defaultModel: VALID_MODEL_KEYS.has(config.defaultModel)
      ? config.defaultModel
      : DEFAULT_CONFIG.defaultModel,
    subagentModel: VALID_MODEL_KEYS.has(config.subagentModel)
      ? config.subagentModel
      : DEFAULT_CONFIG.subagentModel
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
