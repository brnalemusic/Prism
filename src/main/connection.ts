import * as dotenv from 'dotenv'
import * as path from 'path'
import { Agent, fetch as undiciFetch, setGlobalDispatcher } from 'undici'
import { isGoogleHost } from './ai/trustedRegistry'
import { loadConfig } from './config'
import { getAuthAccessToken, getCurrentAuthUser } from './supabaseAuth'

dotenv.config({ path: path.join(__dirname, '../../.env') })

export interface ConnectionTestResult {
  ok: boolean
  errorType?: 'offline' | 'invalid-key' | 'server' | 'unknown'
  message?: string
}

export const KEEPALIVE_WINDOW_MS = 2 * 60 * 60 * 1000
export const HEARTBEAT_INTERVAL_MS = 150000

const PRISM_CLOUD_WARMUP_URL =
  'https://jfqyqkkdmoqdpejzxdhd.supabase.co/functions/v1/prism-ai-proxy/warmup'
const WARMUP_TIMEOUT_MS = 5000

let connectionSessionExpiry = 0
let heartbeatTimer: NodeJS.Timeout | null = null
let prismCloudAgent: Agent | null = null
let warmupPromise: Promise<boolean> | null = null

function getPrismCloudAgent(): Agent {
  if (!prismCloudAgent || prismCloudAgent.closed || prismCloudAgent.destroyed) {
    prismCloudAgent = new Agent({
      connections: 4,
      pipelining: 1,
      keepAliveTimeout: 180000,
      keepAliveMaxTimeout: 300000
    })
    setGlobalDispatcher(prismCloudAgent)
  }
  return prismCloudAgent
}

/**
 * Installs the persistent Undici transport used by the Gemini SDK and by the
 * Prism Cloud warm-up request. The SDK reads global fetch at request time.
 */
export function initializePrismCloudTransport(): void {
  getPrismCloudAgent()
  globalThis.fetch = undiciFetch as unknown as typeof globalThis.fetch
}

/** Sends one authenticated, non-billable request that warms the full Cloud path. */
export function warmPrismCloudConnection(): Promise<boolean> {
  if (warmupPromise) return warmupPromise

  warmupPromise = (async () => {
    const token = await getAuthAccessToken()
    if (!token) return false

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS)
    try {
      const response = await undiciFetch(PRISM_CLOUD_WARMUP_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Prism-Warmup': 'true'
        },
        body: '{}',
        signal: controller.signal,
        dispatcher: getPrismCloudAgent()
      })
      return response.ok
    } catch {
      return false
    } finally {
      clearTimeout(timeout)
    }
  })()

  return warmupPromise.finally(() => {
    warmupPromise = null
  })
}

export function setConnectionApiKey(_key: string): void {
  void _key
}

export async function testGeminiConnection(_overrideKey?: string): Promise<ConnectionTestResult> {
  const authUser = await getCurrentAuthUser()
  const authJwt = await getAuthAccessToken()
  if (authUser && authJwt) return { ok: true }

  const config = loadConfig()
  let providers = config.providers || []
  if (_overrideKey?.trim()) {
    const existingIdx = providers.findIndex((p) => p.apiKey?.trim())
    if (existingIdx >= 0) {
      providers = providers.map((p, idx) =>
        idx === existingIdx ? { ...p, apiKey: _overrideKey.trim() } : p
      )
    }
  }

  let activeProvider = providers.find(
    (p) => p.apiKey?.trim() && Array.isArray(p.models) && p.models.some((m) => m?.enabled)
  )
  if (!activeProvider && _overrideKey?.trim()) {
    const defaultModel = config.lastSelectedChatModel || 'gemini-3.6-flash'
    activeProvider = {
      id: 'override-provider', name: 'Custom Endpoint',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: _overrideKey.trim(),
      completionType: 'gemini_native', isTrusted: true,
      models: [{ id: defaultModel, name: defaultModel, enabled: true, isTrusted: true }]
    }
  }
  if (!activeProvider?.apiKey) {
    return { ok: false, errorType: 'invalid-key', message: 'No active API provider or account login found.' }
  }

  try {
    const baseUrl = activeProvider.baseUrl.replace(/\/+$/, '')
    const headers: Record<string, string> = {}
    if (activeProvider.completionType === 'anthropic_messages') {
      headers['x-api-key'] = activeProvider.apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else if (isGoogleHost(baseUrl)) {
      headers['x-goog-api-key'] = activeProvider.apiKey
    } else headers.Authorization = `Bearer ${activeProvider.apiKey}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const response = await fetch(`${baseUrl}/models`, { method: 'GET', headers, signal: controller.signal })
    clearTimeout(timeout)
    if (response.ok || response.status === 404) return { ok: true }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, errorType: 'invalid-key', message: `API key for provider "${activeProvider.name}" is invalid or expired.` }
    }
    return { ok: false, errorType: 'server', message: `Provider "${activeProvider.name}" returned status ${response.status}.` }
  } catch (error) {
    return classifyError(error, activeProvider.name)
  }
}

function classifyError(primary: unknown, providerName?: string): ConnectionTestResult {
  const message = primary instanceof Error ? primary.message : String(primary)
  const text = message.toLowerCase()
  if (/api key not valid|api_key_invalid|unauthorized|401|permission_denied|api key expired/.test(text)) {
    return { ok: false, errorType: 'invalid-key', message: `API key for provider "${providerName || 'API'}" is invalid or expired.` }
  }
  if (/fetch failed|getaddrinfo|enotfound|econnrefused|etimedout|network|failed to fetch|internet/.test(text)) {
    return { ok: false, errorType: 'offline', message: 'No internet connection. Check your network and try again.' }
  }
  if (/503|500|overloaded/.test(text)) {
    return { ok: false, errorType: 'server', message: `Servers for provider "${providerName || 'API'}" are busy. Try again in a moment.` }
  }
  return { ok: false, errorType: 'unknown', message: message || 'Could not reach the configured API provider.' }
}

export function markConnectionActive(): void {
  connectionSessionExpiry = Date.now() + KEEPALIVE_WINDOW_MS
  initializePrismCloudTransport()
  void warmPrismCloudConnection()
  if (heartbeatTimer) return

  heartbeatTimer = setInterval(() => {
    if (Date.now() >= connectionSessionExpiry) {
      stopKeepAlive()
      return
    }
    void warmPrismCloudConnection()
  }, HEARTBEAT_INTERVAL_MS)
}

export function stopKeepAlive(): void {
  connectionSessionExpiry = 0
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

export async function closePrismCloudTransport(): Promise<void> {
  stopKeepAlive()
  const agent = prismCloudAgent
  prismCloudAgent = null
  if (agent && !agent.closed && !agent.destroyed) await agent.close()
}

export async function checkInternetConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch('https://www.google.com/generate_204', { method: 'HEAD', signal: controller.signal, cache: 'no-store' })
    clearTimeout(timeout)
    return res.ok || res.status === 204
  } catch {
    return false
  }
}
