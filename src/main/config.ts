import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export interface AppConfig {
  launcherShortcut: string
  modelSelectionShortcut: string
  defaultModel: string
  minimizeToTray: boolean
  userGeminiKey?: string
}

const DEFAULT_CONFIG: AppConfig = {
  launcherShortcut: 'CommandOrControl+Space',
  modelSelectionShortcut: 'CommandOrControl+M',
  defaultModel: 'gemma-3-27b-it',
  minimizeToTray: false,
  userGeminiKey: ''
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
    const config = { ...DEFAULT_CONFIG, ...JSON.parse(data) }

    // Decrypt API key if it exists and safeStorage is available
    if (config.userGeminiKey && safeStorage.isEncryptionAvailable()) {
      try {
        const buffer = Buffer.from(config.userGeminiKey, 'hex')
        config.userGeminiKey = safeStorage.decryptString(buffer)
      } catch (e) {
        console.error('Failed to decrypt userGeminiKey:', e)
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

    const configToSave = { ...config }

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
