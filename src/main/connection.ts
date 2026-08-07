import * as dotenv from 'dotenv'
import * as path from 'path'
import { isGoogleHost } from './ai/trustedRegistry'

// Load environment variables from .env (same convention as gemini.ts)
dotenv.config({ path: path.join(__dirname, '../../.env') })

/**
 * Connection result returned by testGeminiConnection() and surfaced to the
 * renderer via the `test-gemini-connection` IPC channel.
 */
export interface ConnectionTestResult {
  ok: boolean
  errorType?: 'offline' | 'invalid-key' | 'server' | 'unknown'
  message?: string
}

// --- Keep-alive engine -------------------------------------------------------
//
// Two cooperating mechanisms keep the connection to Google warm:
//
// 1. The undici Agent (declared in gemini.ts) reuses TCP/HTTP sockets with a
//    3.5-minute keepAliveTimeout. That is the transport layer.
// 2. THIS engine is the application layer: while the user is actively using
//    Prism, it sends a lightweight ping every HEARTBEAT_INTERVAL_MS so the
//    pooled socket never goes cold. The window resets to KEEPALIVE_WINDOW_MS
//    (2 hours) on every message the user sends; once 2 hours pass with no
//    activity, the heartbeat stops itself to avoid unnecessary calls.

/** Total length of the keep-alive window, reset on every user message. */
export const KEEPALIVE_WINDOW_MS = 2 * 60 * 60 * 1000 // 2 hours

/** Heartbeat cadence — kept safely under the undici 3.5-min keepAliveTimeout. */
export const HEARTBEAT_INTERVAL_MS = 150000 // 2.5 minutes

let connectionSessionExpiry = 0
let heartbeatTimer: NodeJS.Timeout | null = null

export function setConnectionApiKey(_key: string): void {
  void _key
  // Deprecated stub
}

/**
 * Lightweight ping to the Gemini API used both as the pre-launch connection
 * test and as the keep-alive heartbeat.
 */
import { loadConfig } from './config'
import { getCurrentAuthUser, getAuthAccessToken } from './supabaseAuth'

export async function testGeminiConnection(_overrideKey?: string): Promise<ConnectionTestResult> {
  // Check if user is logged in via Supabase Auth
  const authUser = await getCurrentAuthUser()
  const authJwt = await getAuthAccessToken()
  if (authUser && authJwt) {
    // Prism Account is logged in! Prism Cloud is active.
    return { ok: true }
  }

  const config = loadConfig()
  let providers = config.providers || []

  if (_overrideKey && _overrideKey.trim() !== '') {
    const existingIdx = providers.findIndex((p) => p.apiKey && p.apiKey.trim() !== '')
    if (existingIdx >= 0) {
      providers = providers.map((p, idx) =>
        idx === existingIdx ? { ...p, apiKey: _overrideKey.trim() } : p
      )
    }
  }

  let activeProvider = providers.find(
    (p) =>
      p.apiKey &&
      p.apiKey.trim() !== '' &&
      Array.isArray(p.models) &&
      p.models.some((m) => m && m.enabled)
  )

  if (!activeProvider || !activeProvider.apiKey) {
    if (_overrideKey && _overrideKey.trim() !== '') {
      const defaultModel = config.lastSelectedChatModel || 'gemini-3.6-flash'
      activeProvider = {
        id: 'override-provider',
        name: 'Custom Endpoint',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: _overrideKey.trim(),
        completionType: 'gemini_native',
        isTrusted: true,
        models: [{ id: defaultModel, name: defaultModel, enabled: true, isTrusted: true }]
      }
    }
  }

  if (!activeProvider || !activeProvider.apiKey) {
    return {
      ok: false,
      errorType: 'invalid-key',
      message: 'No active API provider or account login found.'
    }
  }

  try {
    const baseUrl = activeProvider.baseUrl.replace(/\/+$/, '')
    const headers: Record<string, string> = {}

    if (activeProvider.completionType === 'anthropic_messages') {
      headers['x-api-key'] = activeProvider.apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else if (isGoogleHost(baseUrl)) {
      headers['x-goog-api-key'] = activeProvider.apiKey
    } else {
      headers['Authorization'] = `Bearer ${activeProvider.apiKey}`
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: controller.signal
    })
    clearTimeout(timeout)

    if (response.ok || response.status === 200 || response.status === 404) {
      return { ok: true }
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        errorType: 'invalid-key',
        message: `API key for provider "${activeProvider.name}" is invalid or expired.`
      }
    }

    return {
      ok: false,
      errorType: 'server',
      message: `Provider "${activeProvider.name}" returned status ${response.status}.`
    }
  } catch (error) {
    return classifyError(error, activeProvider.name)
  }
}

/**
 * Maps an HTTP/network error to a coarse errorType for the loading screen.
 */
function classifyError(primary: unknown, providerName?: string): ConnectionTestResult {
  const msg = (e: unknown): string =>
    e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e)

  const text = msg(primary).toLowerCase()

  if (
    text.includes('api key not valid') ||
    text.includes('api_key_invalid') ||
    text.includes('unauthorized') ||
    text.includes('401') ||
    text.includes('permission_denied') ||
    text.includes('api key expired')
  ) {
    return {
      ok: false,
      errorType: 'invalid-key',
      message: `API key for provider "${providerName || 'API'}" is invalid or expired.`
    }
  }

  if (
    text.includes('fetch failed') ||
    text.includes('getaddrinfo') ||
    text.includes('enotfound') ||
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('network') ||
    text.includes('failed to fetch') ||
    text.includes('internet')
  ) {
    return {
      ok: false,
      errorType: 'offline',
      message: 'No internet connection. Check your network and try again.'
    }
  }

  if (text.includes('503') || text.includes('500') || text.includes('overloaded')) {
    return {
      ok: false,
      errorType: 'server',
      message: `Servers for provider "${providerName || 'API'}" are busy. Try again in a moment.`
    }
  }

  return {
    ok: false,
    errorType: 'unknown',
    message: msg(primary) || 'Could not reach the configured API provider.'
  }
}

/**
 * Resets the keep-alive window to 2 hours from now and ensures the heartbeat
 * is running. Called on every successful connection test and on every message
 * the user sends — so active sessions stay warm while idle ones wind down.
 */
export function markConnectionActive(): void {
  connectionSessionExpiry = Date.now() + KEEPALIVE_WINDOW_MS

  if (heartbeatTimer) return

  heartbeatTimer = setInterval(async () => {
    if (Date.now() >= connectionSessionExpiry) {
      // The 2-hour window lapsed with no user activity — stop the heartbeat.
      stopKeepAlive()
      return
    }

    try {
      await testGeminiConnection()
    } catch {
      // Heartbeat failures are non-fatal; the next real message will surface
      // any persistent problem through the normal chat error flow.
    }
  }, HEARTBEAT_INTERVAL_MS)
}

/**
 * Stops the keep-alive heartbeat immediately (e.g. on app quit).
 */
export function stopKeepAlive(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

/**
 * Lightweight internet connectivity check that does NOT hit the Gemini API.
 * Uses a simple fetch to Google's generate_204 endpoint (returns 204 No
 * Content when online, fails on network errors). This is safe to call
 * frequently without rate-limit or keep-alive side effects.
 */
export async function checkInternetConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch('https://www.google.com/generate_204', {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store'
    })
    clearTimeout(timeout)
    return res.ok || res.status === 204
  } catch {
    return false
  }
}
