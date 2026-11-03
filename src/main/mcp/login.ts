import { createHash, randomBytes, randomUUID } from 'crypto'
import { shell } from 'electron'
import * as http from 'http'
import type {
  McpConnectPresetResult,
  McpGalleryPreset,
  McpLoginRequest,
  McpLoginResolution,
  McpOAuthCallback,
  McpGalleryConnection
} from '../../shared/mcpTypes'
import { getMcpGalleryPreset } from './presets'
import { saveServer } from './store'
import {
  deleteGalleryOAuthData,
  deleteServerSecrets,
  loadGalleryOAuthData,
  loadServerSecrets,
  saveGalleryOAuthData,
  saveServerSecrets
} from './secrets'
import { forgetServer, refreshServer } from './manager'
import { broadcastIpc } from '../safeSend'
import { getTask, updateTask, loadTasks, saveTasks } from '../agenda/tasks'
import { focusMainWindow } from '../mainWindow'

/** How long the native sign-in dialog waits before it is treated as cancelled. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

interface PendingLogin {
  request: McpLoginRequest
  resolve: (values: Record<string, string> | null) => void
  timer: NodeJS.Timeout
}

const pending = new Map<string, PendingLogin>()
interface PendingOAuth { provider: string; state: string; verifier: string; redirectUri: string; expiresAt: number; resolve: (token: string | null) => void }
const oauthPending = new Map<string, PendingOAuth>()
const tokenCache = new Map<string, Record<string, string>>()

function b64url(value: Buffer): string { return value.toString('base64url') }

async function fetchOAuthMetadata(provider: string, resource: string): Promise<{ authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string; scopes_supported?: string[] }> {
  if (provider === 'gmail') {
    return {
      authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_endpoint: 'https://oauth2.googleapis.com/token',
      scopes_supported: ['https://www.googleapis.com/auth/gmail.modify']
    }
  }
  if (provider === 'github') {
    return {
      authorization_endpoint: 'https://github.com/login/oauth/authorize',
      token_endpoint: 'https://github.com/login/oauth/access_token',
      scopes_supported: ['repo', 'read:org', 'read:user', 'user:email']
    }
  }
  const resourceUrl = new URL(resource)
  const protectedUrls = [new URL(`/.well-known/oauth-protected-resource${resourceUrl.pathname}`, resourceUrl.origin), new URL('/.well-known/oauth-protected-resource', resourceUrl.origin)]
  let authServer = resourceUrl.origin
  for (const protectedUrl of protectedUrls) {
    try {
      const response = await fetch(protectedUrl)
      if (response.ok) {
        const metadata = await response.json() as { authorization_servers?: string[] }
        authServer = metadata.authorization_servers?.[0] ?? authServer
        break
      }
    } catch { /* OAuth server may share the resource origin. */ }
  }
  const issuer = new URL(authServer)
  const issuerPath = issuer.pathname.replace(/\/$/, '')
  const candidates = issuerPath
    ? [new URL(`/.well-known/oauth-authorization-server${issuerPath}`, issuer.origin), new URL(`${issuerPath}/.well-known/oauth-authorization-server`, issuer.origin), new URL('/.well-known/oauth-authorization-server', issuer.origin)]
    : [new URL('/.well-known/oauth-authorization-server', issuer.origin)]
  for (const candidate of candidates) {
    const response = await fetch(candidate)
    if (!response.ok) continue
    const metadata = await response.json() as { issuer?: string; authorization_endpoint?: string; token_endpoint?: string; registration_endpoint?: string; scopes_supported?: string[] }
    if (metadata.issuer && new URL(metadata.issuer).origin !== issuer.origin) continue
    if (metadata.authorization_endpoint && metadata.token_endpoint) return metadata as { authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string; scopes_supported?: string[] }
  }
  throw new Error('The provider does not publish supported OAuth authorization metadata.')
}

async function requestOAuthToken(provider: string, resource: string, clientId?: string, clientSecret?: string, forceAuthorization = false): Promise<string> {
  const existing = loadGalleryOAuthData(provider)
  if (!forceAuthorization && existing.refresh_token && existing.token_endpoint && existing.client_id) {
    if (Number(existing.expires_at || 0) > Date.now() + 60_000 && existing.access_token) return existing.access_token
    const refreshed = await fetch(existing.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: existing.refresh_token,
        client_id: existing.client_id,
        ...(existing.client_secret ? { client_secret: existing.client_secret } : {})
      })
    })
    if (refreshed.ok) {
      const body = await refreshed.json() as { access_token?: string; refresh_token?: string; expires_in?: number }
      if (body.access_token) {
        const next = {
          ...existing,
          access_token: body.access_token,
          refresh_token: body.refresh_token || existing.refresh_token,
          expires_at: String(Date.now() + (body.expires_in ?? 3600) * 1000)
        }
        saveGalleryOAuthData(provider, next)
        tokenCache.set(provider, next)
        return body.access_token
      }
    }
    deleteGalleryOAuthData(provider)
    throw new Error('Provider authorization expired or was revoked. Reconnect this account.')
  }
  const metadata = await fetchOAuthMetadata(provider, resource)
  let redirectUri = ''
  let resolvedClientId = clientId || existing.client_id || ''
  let resolvedSecret = clientSecret || existing.client_secret || ''
  const state = b64url(randomBytes(32))
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const callbackServer = http.createServer()
  await new Promise<void>((resolve, reject) => {
    callbackServer.once('error', reject)
    callbackServer.listen(53682, '127.0.0.1', () => resolve())
  })
  const address = callbackServer.address()
  if (!address || typeof address === 'string') throw new Error('Could not start the local OAuth callback listener.')
  redirectUri = `http://127.0.0.1:53682/oauth/callback`
  if (!resolvedClientId && !metadata.registration_endpoint && provider === 'github') {
    callbackServer.close()
    throw new Error('Set up a GitHub OAuth App client ID before connecting.')
  }
  if (!resolvedClientId && metadata.registration_endpoint && provider === 'supabase') {
    const registered = await fetch(metadata.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Prism', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) })
    if (registered.ok) resolvedClientId = (await registered.json() as { client_id?: string }).client_id || ''
  }
  if (!resolvedClientId) { callbackServer.close(); throw new Error(provider === 'gmail' ? 'Set up a Google Cloud OAuth client ID in the Gmail integration settings before connecting.' : 'The provider did not allow automatic OAuth client registration.') }
  const authUrl = new URL(metadata.authorization_endpoint)
  authUrl.search = new URLSearchParams({ response_type: 'code', client_id: resolvedClientId, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256', ...(provider === 'supabase' ? { resource } : {}), ...(provider === 'gmail' ? { scope: 'https://www.googleapis.com/auth/gmail.modify', access_type: 'offline', prompt: 'consent select_account' } : provider === 'github' ? { scope: (metadata.scopes_supported ?? []).join(' ') } : { prompt: 'consent' }) }).toString()
  const code = await new Promise<string>((resolve, reject) => {
    const finish = (value: string | null): void => { clearTimeout(timer); oauthPending.delete(state); callbackServer.close(); value ? resolve(value) : reject(new Error('OAuth sign-in was cancelled or denied.')) }
    const timer = setTimeout(() => finish(null), LOGIN_TIMEOUT_MS)
    oauthPending.set(state, { provider, state, verifier, redirectUri, expiresAt: Date.now() + LOGIN_TIMEOUT_MS, resolve: finish })
    callbackServer.on('request', (request, response) => {
      const callbackUrl = new URL(request.url || '/', redirectUri)
      const callbackState = callbackUrl.searchParams.get('state') || ''
      if (callbackUrl.pathname !== '/oauth/callback' || callbackState !== state) { response.writeHead(400).end('Invalid OAuth callback.'); return }
      const pendingLogin = oauthPending.get(state)
      if (!pendingLogin || pendingLogin.expiresAt < Date.now()) { response.writeHead(410).end('Sign-in expired.'); return }
      oauthPending.delete(state)
      const returnedCode = callbackUrl.searchParams.has('error') ? null : callbackUrl.searchParams.get('code')
      if (!returnedCode) { response.writeHead(400).end('OAuth authorization was denied.'); pendingLogin.resolve(null); return }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Prism authorization received</title><p>Authorization received. Return to Prism.</p>')
      pendingLogin.resolve(returnedCode)
    })
    shell.openExternal(authUrl.toString()).catch(() => finish(null))
  })
  const response = await fetch(metadata.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(provider === 'github' ? { accept: 'application/json' } : {}) }, body: new URLSearchParams({ ...(provider === 'github' ? {} : { grant_type: 'authorization_code' }), code, redirect_uri: redirectUri, client_id: resolvedClientId, ...(provider === 'github' ? {} : { code_verifier: verifier }), ...(resolvedSecret ? { client_secret: resolvedSecret } : {}) }) })
  if (!response.ok) { deleteGalleryOAuthData(provider); throw new Error(`OAuth token exchange failed (HTTP ${response.status}).`) }
  const body = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string }
  if (!body.access_token) throw new Error('OAuth provider returned no access token.')
  if (provider === 'supabase' && !body.refresh_token) throw new Error('Supabase OAuth did not return a refresh token; Prism cannot keep this account connected securely.')
  if (provider === 'gmail' && !body.refresh_token) throw new Error('Google did not return a refresh token. Remove Prism from your Google account, then reconnect and grant offline access.')
  const data: Record<string, string> = { ...existing, access_token: body.access_token, refresh_token: body.refresh_token || existing.refresh_token || '', expires_at: String(Date.now() + (body.expires_in ?? 3600) * 1000), client_id: resolvedClientId, client_secret: resolvedSecret, token_endpoint: metadata.token_endpoint, connected_at: String(Date.now()) }
  if (provider === 'github') {
    const verify = await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${body.access_token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } })
    if (!verify.ok) throw new Error('GitHub did not accept the OAuth account credential.')
    const user = await verify.json() as { login?: string }
    data.account_label = user.login || ''
  }
  saveGalleryOAuthData(provider, data)
  tokenCache.set(provider, data)
  return body.access_token
}

export function handleMcpOAuthCallback(callback: McpOAuthCallback): boolean {
  const entry = oauthPending.get(callback.state)
  if (!entry || entry.provider !== callback.provider || entry.expiresAt < Date.now()) return false
  if (!callback.error && !callback.code) return false
  entry.resolve(callback.error || !callback.code ? null : callback.code)
  return true
}

export function getGalleryConnections(): McpGalleryConnection[] {
  return ['github', 'supabase', 'gmail'].map((provider) => {
    const data = loadGalleryOAuthData(provider)
    const config = getMcpGalleryPreset(provider)
    if (config?.auth === 'google-oauth-client' && data.client_id) {
      return {
        presetId: provider as McpGalleryConnection['presetId'],
        connected: Boolean(data.refresh_token || (data.access_token && Number(data.expires_at) > Date.now())),
        accountLabel: data.account_label,
        connectedAt: data.connected_at ? Number(data.connected_at) : undefined
      }
    }
    return {
      presetId: provider as McpGalleryConnection['presetId'],
      connected: Boolean(data.refresh_token || (data.access_token && Number(data.expires_at) > Date.now())),
      accountLabel: data.account_label,
      connectedAt: data.connected_at ? Number(data.connected_at) : undefined
    }
  })
}

export function disconnectMcpGallery(provider: string): void {
  for (const [state, entry] of oauthPending) {
    if (entry.provider !== provider) continue
    oauthPending.delete(state)
    entry.resolve(null)
  }
  tokenCache.delete(provider)
  deleteGalleryOAuthData(provider)
  const config = getMcpGalleryPreset(provider)
  if (config) {
    const legacy = loadServerSecrets(provider)
    const legacyKeys = new Set(
      config.id === 'github'
        ? ['GITHUB_TOKEN']
        : config.id === 'supabase'
          ? ['SUPABASE_ACCESS_TOKEN']
          : ['GMAIL_USER', 'GMAIL_APP_PASSWORD']
    )
    if (Object.keys(legacy).some((key) => legacyKeys.has(key))) deleteServerSecrets(provider)
  }
  const tasks = loadTasks()
  let changed = false
  for (const task of tasks) {
    if (!task.mcpServerIds.includes(provider)) continue
    task.mcpServerIds = task.mcpServerIds.filter((id) => id !== provider)
    task.updatedAt = Date.now()
    changed = true
  }
  if (changed) {
    saveTasks(tasks)
    broadcastIpc('agenda-tasks-changed')
  }
}

export async function getMcpOAuthAccessToken(provider: string, resource: string): Promise<string> {
  return requestOAuthToken(provider, resource)
}

export function isMcpGalleryOAuthConnected(provider: string): boolean {
  const data = loadGalleryOAuthData(provider)
  return Boolean(data.refresh_token || (data.access_token && Number(data.expires_at) > Date.now()))
}

export function saveGalleryOAuthClient(provider: string, clientId: string, clientSecret: string): void {
  if (!['github', 'supabase', 'gmail'].includes(provider)) throw new Error('Unknown gallery provider.')
  if (!clientId.trim()) throw new Error('OAuth client ID is required.')
  saveGalleryOAuthData(provider, { client_id: clientId.trim(), client_secret: clientSecret.trim() })
}

export function getPendingMcpLoginCount(): number {
  return pending.size
}

/** True when every credential the preset needs is already stored encrypted. */
export function hasPresetCredentials(presetId: string): boolean {
  const preset = getMcpGalleryPreset(presetId)
  if (!preset) return false
  const data = loadGalleryOAuthData(preset.id)
  return Boolean(data.refresh_token || (data.access_token && Number(data.expires_at) > Date.now()))
}

/**
 * Opens the global Prism sign-in dialog and waits for the user.
 *
 * The caller never sees the credentials in plain text outside this module: the
 * result is merged into encrypted storage by {@link connectMcpPreset}.
 */
export function requestMcpLogin(
  preset: McpGalleryPreset,
  options: { taskId?: string; taskTitle?: string; runId?: string; signal?: AbortSignal } = {}
): Promise<Record<string, string> | null> {
  if (options.signal?.aborted) return Promise.resolve(null)

  const requestId = randomUUID()
  const createdAt = Date.now()
  const existingKeys = Object.keys(loadServerSecrets(preset.id))
  const request: McpLoginRequest = {
    requestId,
    presetId: preset.id,
    presetName: preset.name,
    description: preset.description,
    brand: preset.brand,
    fields: [],
    existingKeys,
    taskId: options.taskId,
    taskTitle: options.taskTitle,
    runId: options.runId,
    createdAt,
    expiresAt: createdAt + LOGIN_TIMEOUT_MS
  }

  return new Promise<Record<string, string> | null>((resolve) => {
    let settled = false

    const settle = (values: Record<string, string> | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      pending.delete(requestId)
      broadcastIpc('mcp-login-closed', { requestId })
      resolve(values)
    }

    const onAbort = (): void => settle(null)
    const timer = setTimeout(() => settle(null), LOGIN_TIMEOUT_MS)

    options.signal?.addEventListener('abort', onAbort, { once: true })
    pending.set(requestId, { request, resolve: settle, timer })
    focusMainWindow()
    broadcastIpc('mcp-login-request', request)
  })
}

/** Applies the values typed in the native dialog. */
export function resolveMcpLogin(
  resolution: McpLoginResolution
): { ok: boolean; error?: string } {
  if (!resolution || typeof resolution.requestId !== 'string') {
    return { ok: false, error: 'Malformed sign-in response.' }
  }

  const entry = pending.get(resolution.requestId)
  if (!entry) return { ok: false, error: 'This sign-in request is no longer pending.' }

  if (resolution.cancelled) {
    entry.resolve(null)
    return { ok: true }
  }

  const values: Record<string, string> = {}
  const existing = loadServerSecrets(entry.request.presetId)
  for (const field of entry.request.fields) {
    const typed = typeof resolution.values?.[field.key] === 'string'
      ? resolution.values[field.key].trim()
      : ''
    if (!typed && !existing[field.key]?.trim()) {
      return { ok: false, error: `${field.label} is required.` }
    }
    if (typed) values[field.key] = typed
  }

  entry.resolve(values)
  return { ok: true }
}

export interface ConnectPresetOptions {
  /** Credentials already collected by the caller. Missing fields trigger the dialog. */
  values?: Record<string, string>
  taskId?: string
  taskTitle?: string
  runId?: string
  attachToTask?: boolean
  signal?: AbortSignal
  clientId?: string
  clientSecret?: string
}

/**
 * Installs or refreshes one gallery integration, asking for credentials only
 * when they are missing. Never writes a token to mcp.json or to the URL.
 */
export async function connectMcpPreset(
  presetId: string,
  options: ConnectPresetOptions = {}
): Promise<McpConnectPresetResult> {
  const preset = getMcpGalleryPreset(presetId)
  if (!preset) {
    return { ok: false, error: `Unknown integration "${presetId}".` }
  }

  if (preset.auth === 'google-oauth-client' && !options.clientId && !loadGalleryOAuthData(preset.id).client_id) {
    return { ok: false, error: 'Google OAuth client setup is required before connecting Gmail.' }
  }
  if (preset.id !== 'supabase' && !options.clientId && !loadGalleryOAuthData(preset.id).client_id) {
    return { ok: false, error: `${preset.name} OAuth client setup is required before connecting.` }
  }
  const priorOAuth = loadGalleryOAuthData(preset.id)

  try {
    const token = await requestOAuthToken(preset.id, preset.url, options.clientId, options.clientSecret, true)
    // Old gallery token fields are removed without touching unrelated custom secrets.
    const legacy = loadServerSecrets(preset.id)
    const legacyKeys = new Set(preset.id === 'github' ? ['GITHUB_TOKEN'] : preset.id === 'supabase' ? ['SUPABASE_ACCESS_TOKEN'] : ['GMAIL_USER', 'GMAIL_APP_PASSWORD'])
    for (const key of legacyKeys) delete legacy[key]
    if (Object.keys(legacy).length === 0) deleteServerSecrets(preset.id)
    else saveServerSecrets(preset.id, legacy)
    const server = saveServer({
      id: preset.id,
      name: preset.name,
      transport: preset.transport,
      command: preset.command,
      args: preset.args,
      env: {},
      url: preset.url,
      enabled: true,
      presetId: preset.id,
      authEnvKey: undefined
    })
    const status = await refreshServer(server.id)
    if (status.state !== 'ready') {
      stopConnectedGalleryServer(preset.id)
      if (priorOAuth.refresh_token || priorOAuth.access_token) saveGalleryOAuthData(preset.id, priorOAuth)
      else deleteGalleryOAuthData(preset.id)
      return { ok: false, server, status, error: status.error ?? 'The provider MCP handshake failed.' }
    }
    const currentOAuth = loadGalleryOAuthData(preset.id)
    saveGalleryOAuthData(preset.id, {
      ...currentOAuth,
      ...(options.clientId ? { client_id: options.clientId, client_secret: options.clientSecret ?? '' } : {}),
      access_token: token,
      connected_at: String(Date.now())
    })
    if (options.attachToTask && options.taskId) {
      const task = getTask(options.taskId)
      if (task && !task.mcpServerIds.includes(server.id)) {
        updateTask(task.id, { mcpServerIds: [...task.mcpServerIds, server.id] })
        broadcastIpc('agenda-tasks-changed')
      }
    }
    broadcastIpc('mcp-servers-changed')
    return {
      ok: true,
      server,
      status,
      tools: status.tools.map((tool) => tool.name),
      error: status.error ?? undefined
    }
  } catch (error) {
    if (priorOAuth.access_token || priorOAuth.refresh_token) saveGalleryOAuthData(preset.id, priorOAuth)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function stopConnectedGalleryServer(serverId: string): void {
  forgetServer(serverId)
}
