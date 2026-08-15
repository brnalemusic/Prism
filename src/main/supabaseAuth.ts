import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js'
import { safeStorage, app, shell, net } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import type {
  UserProfile,
  AuthResponse,
  UserAiUsageStatus,
  ModelAiUsageStatus,
  WebLoginBeginResult,
  ActivationStatusResult,
  AccountActivationResult
} from '../shared/types'
import { getLicenseInfo, syncLocalLicenseWithSupabase, revokeLocalLicenseFromSupabase } from './license'

// Supabase Configuration for Prism Agent Project
const SUPABASE_URL = 'https://jfqyqkkdmoqdpejzxdhd.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_WcCSfH1dSXUzHDjlQGk2kw_4TQcAt4Q'
const PRISM_WEB_BASE_URL = 'https://prismagent.vercel.app'
const PRISM_CLOUD_USAGE_URL = `${SUPABASE_URL}/functions/v1/prism-ai-proxy/usage`
const SUPABASE_REQUEST_TIMEOUT_MS = 12_000
const OAUTH_FLOW_EXPIRY_MS = 5 * 60 * 1000 // 5 minutes TTL

let supabase: SupabaseClient | null = null

interface PendingOAuthSession {
  verifier: string
  state: string
  createdAt: number
}

let inMemoryOAuthSession: PendingOAuthSession | null = null

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function generateCodeVerifier(): string {
  return base64UrlEncode(crypto.randomBytes(48))
}

function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest()
  return base64UrlEncode(hash)
}

function generateOAuthState(): string {
  return base64UrlEncode(crypto.randomBytes(32))
}

function constantTimeEqualStrings(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  return crypto.timingSafeEqual(bufA, bufB)
}

function getOAuthStateFilePath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'prism_oauth_pending.enc')
}

function savePendingOAuthSession(pending: PendingOAuthSession | null): void {
  inMemoryOAuthSession = pending
  const filePath = getOAuthStateFilePath()
  if (!pending) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
      } catch (err) {
        console.error('[Auth] Failed to delete pending OAuth file:', err)
      }
    }
    return
  }

  try {
    const rawData = JSON.stringify(pending)
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(rawData)
      fs.writeFileSync(filePath, encrypted)
    } else {
      fs.writeFileSync(filePath, Buffer.from(rawData, 'utf8').toString('base64'), 'utf8')
    }
  } catch (err) {
    console.error('[Auth] Failed to save pending OAuth state:', err)
  }
}

function loadPendingOAuthSession(): PendingOAuthSession | null {
  if (inMemoryOAuthSession) {
    if (Date.now() - inMemoryOAuthSession.createdAt < OAUTH_FLOW_EXPIRY_MS) {
      return inMemoryOAuthSession
    }
    savePendingOAuthSession(null)
    return null
  }

  const filePath = getOAuthStateFilePath()
  if (!fs.existsSync(filePath)) return null

  try {
    const fileBuffer = fs.readFileSync(filePath)
    let rawJson = ''
    if (safeStorage.isEncryptionAvailable()) {
      rawJson = safeStorage.decryptString(fileBuffer)
    } else {
      rawJson = Buffer.from(fileBuffer.toString('utf8'), 'base64').toString('utf8')
    }
    const session = JSON.parse(rawJson) as PendingOAuthSession
    if (Date.now() - session.createdAt < OAUTH_FLOW_EXPIRY_MS) {
      inMemoryOAuthSession = session
      return session
    }
    savePendingOAuthSession(null)
    return null
  } catch (err) {
    console.error('[Auth] Failed to load pending OAuth session:', err)
    return null
  }
}

function fetchSupabaseWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SUPABASE_REQUEST_TIMEOUT_MS)

  const fetchFn = typeof net !== 'undefined' && net.fetch ? (net.fetch as unknown as typeof fetch) : fetch
  return fetchFn(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout))
}

function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: false
      },
      global: {
        fetch: fetchSupabaseWithTimeout
      }
    })

    // Listen to token refresh and auth events to automatically keep session saved on disk
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        saveSessionSecurely(session)
      } else if (event === 'SIGNED_OUT') {
        saveSessionSecurely(null)
      }
    })
  }
  return supabase
}

// Session persistence storage file path in app userData
function getSessionFilePath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'prism_session.enc')
}

/**
 * Securely saves Supabase auth session using Electron safeStorage
 */
function saveSessionSecurely(session: Session | null): void {
  const filePath = getSessionFilePath()
  if (!session) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
      } catch (err) {
        console.error('[Auth] Failed to delete session file:', err)
      }
    }
    return
  }

  try {
    const rawData = JSON.stringify(session)
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(rawData)
      fs.writeFileSync(filePath, encrypted)
    } else {
      fs.writeFileSync(filePath, Buffer.from(rawData, 'utf8').toString('base64'), 'utf8')
    }
  } catch (err) {
    console.error('[Auth] Failed to save encrypted session:', err)
  }
}

/**
 * Reads and decrypts stored auth session
 */
function loadSessionSecurely(): Session | null {
  const filePath = getSessionFilePath()
  if (!fs.existsSync(filePath)) return null

  try {
    const fileBuffer = fs.readFileSync(filePath)
    let rawJson = ''
    if (safeStorage.isEncryptionAvailable()) {
      rawJson = safeStorage.decryptString(fileBuffer)
    } else {
      rawJson = Buffer.from(fileBuffer.toString('utf8'), 'base64').toString('utf8')
    }
    return JSON.parse(rawJson) as Session
  } catch (err) {
    console.error('[Auth] Failed to load/decrypt saved session:', err)
    return null
  }
}

/**
 * Ensures there is an active session in the Supabase client memory.
 * Restores from encrypted disk storage if missing or expired.
 */
async function ensureActiveSession(): Promise<{ session: Session | null; user: User | null }> {
  const client = getSupabaseClient()

  try {
    // Check in-memory session first
    const { data: currentData } = await client.auth.getSession()
    if (currentData?.session?.user) {
      return { session: currentData.session, user: currentData.session.user }
    }

    // Try loading saved session from disk
    const savedSession = loadSessionSecurely()
    if (savedSession?.refresh_token) {
      const { data: refreshRes, error } = await client.auth.setSession({
        access_token: savedSession.access_token,
        refresh_token: savedSession.refresh_token
      })

      if (!error && refreshRes?.session && refreshRes?.user) {
        saveSessionSecurely(refreshRes.session)
        return { session: refreshRes.session, user: refreshRes.user }
      }
    }
  } catch (err) {
    console.error('[Auth] Error ensuring active session:', err)
  }

  return { session: null, user: null }
}

/**
 * Ensures user profile row exists in public.profiles table
 */
async function ensureProfileRow(user: User): Promise<void> {
  const { session } = await ensureActiveSession()
  if (!session?.access_token) {
    return
  }

  const client = getSupabaseClient()
  try {
    const fullName = user.user_metadata?.full_name || ''
    const companyName = user.user_metadata?.company_name || ''
    const accountType = user.user_metadata?.account_type || (companyName ? 'enterprise' : 'individual')

    const { error } = await client.from('profiles').upsert({
      id: user.id,
      email: user.email || '',
      full_name: fullName,
      company_name: companyName,
      account_type: accountType,
      updated_at: new Date().toISOString()
    })

    if (error) {
      console.warn('[Auth] ensureProfileRow upsert warning:', error.message)
    }
  } catch (err) {
    console.warn('[Auth] ensureProfileRow unexpected error:', err)
  }
}

/**
 * Formats Supabase user & profile data into UserProfile
 */
async function buildUserProfile(user: User): Promise<UserProfile> {
  const client = getSupabaseClient()
  let fullName = user.user_metadata?.full_name || ''
  let companyName = user.user_metadata?.company_name || ''
  let accountType = user.user_metadata?.account_type || 'individual'
  let avatarUrl = user.user_metadata?.avatar_url || ''
  let activationStatus: 'active' | 'inactive' = 'inactive'
  let activatedAt: string | null = null
  const emailConfirmed = true

  try {
    const { data: profile } = await client
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()

    if (profile) {
      if (profile.full_name) fullName = profile.full_name
      if (profile.company_name) companyName = profile.company_name
      if (profile.account_type) accountType = profile.account_type
      if (profile.avatar_url) avatarUrl = profile.avatar_url
    } else {
      await ensureProfileRow(user)
    }

    // Fetch account activation status
    const statusRes = await getAccountActivationStatus()
    activationStatus = statusRes.status
    activatedAt = statusRes.activatedAt ?? null
  } catch (e) {
    console.warn('[Auth] Could not fetch profile / activation data:', e)
  }

  return {
    id: user.id,
    email: user.email || '',
    fullName,
    companyName,
    accountType,
    emailConfirmed,
    avatarUrl,
    activationStatus,
    activatedAt
  }
}

/**
 * Initializes and restores session on main process boot up
 */
export async function initializeAuthSession(): Promise<UserProfile | null> {
  const { session, user } = await ensureActiveSession()
  if (!user) return null
  if (session?.access_token) {
    await reconcileLocalLicenseEntitlement(session.access_token)
    await ensureProfileRow(user)
  }
  return await buildUserProfile(user)
}

/**
 * Keeps local-license entitlement tied to the current Prism installation.
 */
async function reconcileLocalLicenseEntitlement(accessToken: string): Promise<void> {
  if (getLicenseInfo()?.isActivated) {
    await syncLocalLicenseWithSupabase(accessToken).catch((err) => {
      console.warn('[Auth] Failed to synchronize the active local license:', err)
    })
    return
  }

  await revokeLocalLicenseFromSupabase(accessToken).catch((err) => {
    console.warn('[Auth] Failed to revoke a local license missing from this Prism installation:', err)
  })
}

/**
 * Begins the OAuth 2.1 Authorization Code + PKCE flow in the user's default browser.
 */
export async function authBeginWebLogin(): Promise<WebLoginBeginResult> {
  try {
    const verifier = generateCodeVerifier()
    const challenge = generateCodeChallenge(verifier)
    const state = generateOAuthState()

    savePendingOAuthSession({
      verifier,
      state,
      createdAt: Date.now()
    })

    const consentUrl = new URL(`${PRISM_WEB_BASE_URL}/oauth/consent`)
    consentUrl.searchParams.set('client_id', 'prism-desktop')
    consentUrl.searchParams.set('response_type', 'code')
    consentUrl.searchParams.set('redirect_uri', 'prism://auth-callback')
    consentUrl.searchParams.set('code_challenge', challenge)
    consentUrl.searchParams.set('code_challenge_method', 'S256')
    consentUrl.searchParams.set('state', state)

    const finalUrl = consentUrl.toString()
    await shell.openExternal(finalUrl)

    return {
      success: true,
      url: finalUrl
    }
  } catch (err: any) {
    console.error('[Auth] Error beginning web login:', err)
    return {
      success: false,
      error: err?.message || 'Failed to open web browser for sign in.'
    }
  }
}

/**
 * Cancels pending OAuth login flow.
 */
export async function authCancelWebLogin(): Promise<boolean> {
  savePendingOAuthSession(null)
  return true
}

/**
 * Handles incoming deep link URL (e.g. prism://auth-callback?code=...&state=...)
 */
export async function handleDeepLinkAuth(urlStr: string): Promise<UserProfile | null> {
  if (!urlStr || !urlStr.startsWith('prism://auth-callback')) {
    // If it's another prism deep link e.g. delete account
    if (urlStr.includes('action=delete-account') || urlStr.includes('delete-account')) {
      return null
    }
    return null
  }

  const client = getSupabaseClient()
  try {
    const parsedUrl = new URL(urlStr)
    const code = parsedUrl.searchParams.get('code')
    const incomingState = parsedUrl.searchParams.get('state')
    const errorParam = parsedUrl.searchParams.get('error')
    const errorDescription = parsedUrl.searchParams.get('error_description')

    if (errorParam) {
      console.warn('[Auth] OAuth flow denied or returned error:', errorParam, errorDescription)
      savePendingOAuthSession(null)
      return null
    }

    if (!code || !incomingState) {
      console.warn('[Auth] Callback missing authorization code or state parameter.')
      return null
    }

    const pending = loadPendingOAuthSession()
    if (!pending) {
      console.warn('[Auth] No active OAuth login attempt found or session expired.')
      return null
    }

    const isStateValid = constantTimeEqualStrings(pending.state, incomingState)
    if (!isStateValid) {
      console.error('[Auth] State parameter mismatch in OAuth callback. Possible CSRF or forged link.')
      savePendingOAuthSession(null)
      return null
    }

    // Exchange authorization code + PKCE verifier for tokens at Supabase desktop-oauth-token endpoint
    const tokenEndpoint = `${SUPABASE_URL}/functions/v1/desktop-oauth-token`
    const tokenResponse = await fetchSupabaseWithTimeout(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: code.trim(),
        code_verifier: pending.verifier,
        redirect_uri: 'prism://auth-callback',
        client_id: 'prism-desktop'
      })
    })

    // Consume pending state
    savePendingOAuthSession(null)

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text().catch(() => '')
      console.error('[Auth] Token exchange failed with status', tokenResponse.status, errBody)
      return null
    }

    const tokenData = await tokenResponse.json()
    if (!tokenData?.access_token || !tokenData?.refresh_token) {
      console.error('[Auth] Token endpoint response missing required tokens.')
      return null
    }

    const { data: sessionData, error: sessionErr } = await client.auth.setSession({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token
    })

    if (sessionErr || !sessionData.session || !sessionData.user) {
      console.error('[Auth] Failed to set session after token exchange:', sessionErr)
      return null
    }

    saveSessionSecurely(sessionData.session)
    await reconcileLocalLicenseEntitlement(sessionData.session.access_token)
    await ensureProfileRow(sessionData.user)

    return await buildUserProfile(sessionData.user)
  } catch (err) {
    console.error('[Auth] Error handling OAuth deep link callback:', err)
  }
  return null
}

/**
 * Gets account activation status for current logged-in user
 */
export async function getAccountActivationStatus(): Promise<ActivationStatusResult> {
  const token = await getAuthAccessToken()
  if (!token) {
    return { status: 'inactive', error: 'Authentication required.' }
  }

  const client = getSupabaseClient()
  try {
    const { data, error } = await client.functions.invoke<ActivationStatusResult>('account-status', {
      headers: { Authorization: `Bearer ${token}` }
    })

    if (error || !data) {
      return { status: 'inactive', error: error?.message || 'Activation status is temporarily unavailable.' }
    }

    return {
      status: data.status || 'inactive',
      activatedAt: data.activatedAt ?? null
    }
  } catch (err: any) {
    return { status: 'inactive', error: err?.message || 'Error checking activation status.' }
  }
}

/**
 * Activates user account with a 6-digit code (format XXX-XXX)
 */
export async function activateAccountWithCode(code: string): Promise<AccountActivationResult> {
  const token = await getAuthAccessToken()
  if (!token) {
    return { success: false, error: 'Please sign in to activate your account.' }
  }

  const client = getSupabaseClient()
  try {
    const { data, error } = await client.functions.invoke<AccountActivationResult>('activate-account', {
      headers: { Authorization: `Bearer ${token}` },
      body: { code }
    })

    if (error) {
      return {
        success: false,
        error: error.message || 'Failed to activate account.',
        code: (error as any).code,
        retryAfter: (error as any).retryAfter
      }
    }

    if (data?.status === 'active') {
      const { user } = await ensureActiveSession()
      if (user) {
        await buildUserProfile(user)
      }
      return {
        success: true,
        status: 'active',
        activatedAt: data.activatedAt
      }
    }

    return {
      success: false,
      error: data?.error || 'Invalid or expired activation code.',
      code: data?.code,
      retryAfter: data?.retryAfter
    }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to complete activation request.' }
  }
}

/**
 * Handles user Logout (Sign Out)
 */
export async function authLogout(): Promise<boolean> {
  const client = getSupabaseClient()
  try {
    const token = await getAuthAccessToken()
    if (token) {
      const revoked = await revokeLocalLicenseFromSupabase(token)
      if (!revoked) {
        console.error('[Auth] Refusing to sign out before the local license entitlement is revoked.')
        return false
      }
    }
    await client.auth.signOut()
    saveSessionSecurely(null)
    return true
  } catch (err) {
    console.error('[Auth] Logout error:', err)
    return false
  }
}

/**
 * Gets currently logged-in user profile
 */
export async function getCurrentAuthUser(): Promise<UserProfile | null> {
  const { user } = await ensureActiveSession()
  if (!user) {
    return null
  }
  return await buildUserProfile(user)
}

/**
 * Fast check if user email is verified
 */
export async function isUserEmailVerified(): Promise<boolean> {
  try {
    const { user } = await ensureActiveSession()
    if (!user) return false
    return !!(user.email_confirmed_at || user.confirmed_at)
  } catch {
    return false
  }
}

/**
 * Requests password reset email
 */
export async function authResetPassword(email: string): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  try {
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${PRISM_WEB_BASE_URL}/auth/reset-password`
    })
    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to send password reset request.' }
  }
}

/**
 * Updates current user profile details
 */
export async function authUpdateProfile(updates: Partial<UserProfile>): Promise<AuthResponse> {
  const client = getSupabaseClient()
  let { user } = await ensureActiveSession()

  if (!user) {
    return { success: false, error: 'User is not authenticated.' }
  }

  const userId = user.id
  try {
    const profileUpdates: Record<string, any> = {
      id: userId,
      email: user.email || '',
      updated_at: new Date().toISOString()
    }
    if (updates.fullName !== undefined) profileUpdates.full_name = updates.fullName
    if (updates.companyName !== undefined) profileUpdates.company_name = updates.companyName
    if (updates.accountType !== undefined) profileUpdates.account_type = updates.accountType

    const { error: profileErr } = await client.from('profiles').upsert(profileUpdates)

    if (profileErr) {
      console.error('[Auth] Profile table update error:', profileErr)
      return { success: false, error: profileErr.message }
    }

    const userMetaUpdates: Record<string, any> = {}
    if (updates.fullName !== undefined) userMetaUpdates.full_name = updates.fullName
    if (updates.companyName !== undefined) userMetaUpdates.company_name = updates.companyName
    if (updates.accountType !== undefined) userMetaUpdates.account_type = updates.accountType

    if (Object.keys(userMetaUpdates).length > 0) {
      const { data: updatedAuthUser } = await client.auth.updateUser({
        data: userMetaUpdates
      })
      if (updatedAuthUser?.user) {
        user = updatedAuthUser.user
      }
    }

    const updatedUser = await buildUserProfile(user)
    return { success: true, user: updatedUser }
  } catch (err: any) {
    console.error('[Auth] Unexpected error updating profile:', err)
    return { success: false, error: err?.message || 'Failed to update profile.' }
  }
}

/**
 * Synchronously check if the logged-in user email is verified
 */
export function isUserEmailVerifiedSync(): boolean {
  try {
    const session = loadSessionSecurely()
    if (!session || !session.user) return false
    return !!(session.user.email_confirmed_at || session.user.confirmed_at)
  } catch {
    return false
  }
}

/**
 * Fast check if user has a stored session
 */
export function isUserAuthenticated(): boolean {
  try {
    const session = loadSessionSecurely()
    return !!(session && (session.user || session.refresh_token))
  } catch {
    return false
  }
}

/**
 * Gets active Supabase access token for the logged-in user
 */
export async function getAuthAccessToken(): Promise<string | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    const { session } = await Promise.race([
      ensureActiveSession(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Timed out restoring the Prism session.')),
          SUPABASE_REQUEST_TIMEOUT_MS
        )
      })
    ])
    return session?.access_token || null
  } catch (err) {
    console.warn('[Auth] Could not restore an access token:', err)
    return null
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

/**
 * Gets current AI quota usage status for the logged-in user
 */
export async function getUserAiUsage(): Promise<UserAiUsageStatus | null> {
  const { session, user } = await ensureActiveSession()
  if (!user || !session?.access_token) return null

  try {
    const response = await fetchSupabaseWithTimeout(`${PRISM_CLOUD_USAGE_URL}?model=all`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: '{}'
    })

    if (response.ok) {
      const rpcData = await response.json()
      const rawList: any[] = Array.isArray(rpcData) ? rpcData : [rpcData]

      const modelList: ModelAiUsageStatus[] = rawList.map((item) => {
        const modelId = item.model_id || 'legacy'
        const modelName =
          modelId === 'gemini-3-flash-preview' || modelId === 'gemini-3-flash'
            ? 'Gemini 3 Flash'
            : modelId === 'gemini-3.1-flash-lite'
              ? 'Gemini 3.1 Flash-Lite'
              : 'Legacy Model'

        const max5h = item.max_5h || (modelId === 'gemini-3.1-flash-lite' ? 180 : 20)
        const max1w = item.max_1w || item.max_7d || (modelId === 'gemini-3.1-flash-lite' ? 720 : 80)
        const count5h = item.count_5h ?? 0
        const count1w = item.count_1w ?? 0
        const remaining5h = item.remaining_5h ?? Math.max(0, max5h - count5h)
        const remaining1w = item.remaining_1w ?? Math.max(0, max1w - count1w)

        const percentage5h = Math.round((remaining5h / max5h) * 100)
        const percentage1w = Math.round((remaining1w / max1w) * 100)
        const percentageRemaining = Math.min(percentage5h, percentage1w)

        return {
          modelId,
          modelName,
          tier: item.tier || 'free',
          count5h,
          count1w,
          remaining5h,
          remaining1w,
          max5h,
          max1w,
          percentage5h,
          percentage1w,
          percentageRemaining,
          reset5hSeconds: item.reset_5h_seconds ?? 0,
          reset1wSeconds: item.reset_1w_seconds ?? 0
        }
      })

      const modelsMap: Record<string, ModelAiUsageStatus> = {}
      for (const m of modelList) {
        modelsMap[m.modelId] = m
      }

      const primary =
        modelsMap['gemini-3-flash-preview'] ||
        modelsMap['gemini-3-flash'] ||
        modelsMap['legacy'] ||
        modelList[0]

      return {
        percentageRemaining: primary ? primary.percentageRemaining : 100,
        percentage5h: primary ? primary.percentage5h : 100,
        percentage1w: primary ? primary.percentage1w : 100,
        count5h: primary ? primary.count5h : 0,
        count1w: primary ? primary.count1w : 0,
        remaining5h: primary ? primary.remaining5h : 20,
        remaining1w: primary ? primary.remaining1w : 80,
        max5h: primary ? primary.max5h : 20,
        max1w: primary ? primary.max1w : 80,
        reset5hSeconds: primary ? primary.reset5hSeconds : 0,
        reset1wSeconds: primary ? primary.reset1wSeconds : 0,
        models: modelsMap,
        modelList
      }
    }

    if (response.status === 403) {
      console.log('[Auth] Prism Cloud usage returned 403 (Account Inactive)')
    } else {
      console.error('[Auth] Prism Cloud usage request failed with status:', response.status)
    }
  } catch (err) {
    console.error('[Auth] Error fetching user AI usage status:', err)
  }

  return null
}

/**
 * Sends account deletion confirmation email
 */
export async function authRequestDeleteAccountEmail(email: string): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  try {
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${PRISM_WEB_BASE_URL}/account/settings?action=delete-account`
    })

    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to send account deletion email.' }
  }
}

/**
 * Verifies email OTP code and permanently deletes caller's account
 */
export async function authConfirmDeleteAccount(otpCode: string): Promise<{ success: boolean; error?: string }> {
  const { session, user } = await ensureActiveSession()
  if (!user || !session?.access_token || !user.email) {
    return { success: false, error: 'No active authenticated user session found.' }
  }

  if (!otpCode || !otpCode.trim()) {
    return { success: false, error: 'Confirmation code is required.' }
  }

  const client = getSupabaseClient()
  try {
    const code = otpCode.trim()
    let verified = false

    const { data: verifyEmailRes, error: verifyEmailErr } = await client.auth.verifyOtp({
      email: user.email,
      token: code,
      type: 'email'
    })

    if (!verifyEmailErr && verifyEmailRes?.user) {
      verified = true
    } else {
      const { data: verifyRecRes, error: verifyRecErr } = await client.auth.verifyOtp({
        email: user.email,
        token: code,
        type: 'recovery'
      })
      if (!verifyRecErr && verifyRecRes?.user) {
        verified = true
      }
    }

    if (!verified) {
      return { success: false, error: 'Invalid or expired confirmation code. Please check your email and try again.' }
    }

    const activeAccessToken = (await getAuthAccessToken()) || session.access_token

    const { data: fnData, error: fnErr } = await client.functions.invoke('delete-account', {
      headers: {
        Authorization: `Bearer ${activeAccessToken}`
      }
    })

    if (fnErr || (fnData && !fnData.success)) {
      const msg = fnErr?.message || fnData?.error || 'Failed to delete account on server.'
      return { success: false, error: msg }
    }

    await authLogout()
    saveSessionSecurely(null)

    return { success: true }
  } catch (err: any) {
    console.error('[Auth] Error confirming account deletion:', err)
    return { success: false, error: err?.message || 'Failed to complete account deletion.' }
  }
}

/**
 * Verifies account password and permanently deletes caller's account
 */
export async function authConfirmDeleteAccountWithPassword(password: string): Promise<{ success: boolean; error?: string }> {
  const { user } = await ensureActiveSession()
  if (!user || !user.email) {
    return { success: false, error: 'No active authenticated user session found.' }
  }

  if (!password || !password.trim()) {
    return { success: false, error: 'Account password is required.' }
  }

  const client = getSupabaseClient()
  try {
    const { data: authRes, error: authErr } = await client.auth.signInWithPassword({
      email: user.email,
      password: password
    })

    if (authErr || !authRes.session) {
      return { success: false, error: 'Incorrect password. Please enter your account password to confirm.' }
    }

    const token = authRes.session.access_token
    const { data: fnData, error: fnErr } = await client.functions.invoke('delete-account', {
      headers: { Authorization: `Bearer ${token}` }
    })

    if (fnErr || (fnData && !fnData.success)) {
      const msg = fnErr?.message || fnData?.error || 'Failed to delete account on server.'
      return { success: false, error: msg }
    }

    await authLogout()
    saveSessionSecurely(null)

    return { success: true }
  } catch (err: any) {
    console.error('[Auth] Error confirming account deletion with password:', err)
    return { success: false, error: err?.message || 'Failed to complete account deletion.' }
  }
}
