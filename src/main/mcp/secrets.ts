import { safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { CONFIG_DIR } from '../config'

type SecretsFile = Record<string, string>

function secretsPath(): string {
  return path.join(CONFIG_DIR, 'mcp-secrets.json')
}

function readSecrets(): SecretsFile {
  try {
    if (!fs.existsSync(secretsPath())) return {}
    const parsed = JSON.parse(fs.readFileSync(secretsPath(), 'utf8')) as SecretsFile
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    console.warn('[mcp] could not read mcp-secrets.json:', error)
    return {}
  }
}

function writeSecrets(value: SecretsFile): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  const target = secretsPath()
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, target)
}

function requireEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is unavailable, so Prism will not save MCP secrets.')
  }
}

/** Encrypts the environment of one server. An empty map removes the stored secrets. */
export function saveServerSecrets(serverId: string, env: Record<string, string>): void {
  const store = readSecrets()
  const entries = Object.entries(env).filter(([key, value]) => key.trim() && value !== undefined)
  if (entries.length === 0) {
    delete store[serverId]
  } else {
    requireEncryption()
    store[serverId] = safeStorage
      .encryptString(JSON.stringify(Object.fromEntries(entries)))
      .toString('base64')
  }
  writeSecrets(store)
}

export function loadServerSecrets(serverId: string): Record<string, string> {
  const store = readSecrets()
  const encrypted = store[serverId]
  if (!encrypted) return {}
  try {
    requireEncryption()
    const decoded = JSON.parse(
      safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    ) as Record<string, string>
    return decoded && typeof decoded === 'object' ? decoded : {}
  } catch (error) {
    console.warn(`[mcp] could not decrypt the secrets of ${serverId}:`, error)
    return {}
  }
}

export function deleteServerSecrets(serverId: string): void {
  const store = readSecrets()
  if (!(serverId in store)) return
  delete store[serverId]
  writeSecrets(store)
}

/** Environment for a spawned server: the user environment plus the stored secrets. */
export function buildServerEnv(serverId: string): NodeJS.ProcessEnv {
  return { ...process.env, ...loadServerSecrets(serverId) }
}
