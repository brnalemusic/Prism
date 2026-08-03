import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js'
import { safeStorage, app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { UserProfile, AuthResponse, SignUpData, LoginData, UserAiUsageStatus } from '../shared/types'
import { syncLocalLicenseWithSupabase, revokeLocalLicenseFromSupabase } from './license'

// Supabase Configuration for Prism Agent Project
const SUPABASE_URL = 'https://jfqyqkkdmoqdpejzxdhd.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_WcCSfH1dSXUzHDjlQGk2kw_4TQcAt4Q'

let supabase: SupabaseClient | null = null

function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: false
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
      // Fallback if safeStorage is not supported
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
    // Session is not authenticated yet (e.g. pending email confirmation).
    // Database trigger `on_auth_user_created` handles the initial profile row creation in Supabase Postgres.
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
    } else {
      console.log('[Auth] Profile row successfully synced for user:', user.id)
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
      // Row is missing in public.profiles table -> try creating/upserting it
      await ensureProfileRow(user)
    }
  } catch (e) {
    console.warn('[Auth] Could not fetch profile table row:', e)
  }

  return {
    id: user.id,
    email: user.email || '',
    fullName,
    companyName,
    accountType,
    emailConfirmed,
    avatarUrl
  }
}

/**
 * Initializes and restores session on main process boot up
 */
export async function initializeAuthSession(): Promise<UserProfile | null> {
  const { session, user } = await ensureActiveSession()
  if (!user) return null
  if (session?.access_token) {
    syncLocalLicenseWithSupabase(session.access_token).catch(() => {})
    await ensureProfileRow(user)
  }
  return await buildUserProfile(user)
}

/**
 * Handles user Sign Up
 */
export async function authSignUp(data: SignUpData): Promise<AuthResponse> {
  const client = getSupabaseClient()
  try {
    // 1. If account was already registered during a previous attempt, attempt direct login
    const { data: directLoginRes } = await client.auth.signInWithPassword({
      email: data.email.trim(),
      password: data.password
    })

    if (directLoginRes?.user && directLoginRes?.session) {
      saveSessionSecurely(directLoginRes.session)
      syncLocalLicenseWithSupabase(directLoginRes.session.access_token).catch(() => {})
      await ensureProfileRow(directLoginRes.user)
      const userProfile = await buildUserProfile(directLoginRes.user)
      return {
        success: true,
        user: userProfile
      }
    }

    // 2. Otherwise attempt standard signUp
    const { data: authRes, error } = await client.auth.signUp({
      email: data.email.trim(),
      password: data.password,
      options: {
        emailRedirectTo: 'prism://auth-callback',
        data: {
          full_name: data.fullName.trim(),
          company_name: (data.companyName || '').trim(),
          account_type: data.accountType || (data.companyName ? 'enterprise' : 'individual')
        }
      }
    })

    if (error) {
      const isAlreadyRegistered =
        error.message.toLowerCase().includes('already') ||
        error.message.toLowerCase().includes('registered') ||
        error.message.toLowerCase().includes('exists')

      if (isAlreadyRegistered) {
        return {
          success: false,
          error: 'An account with this email already exists. Please switch to Sign In.'
        }
      }

      console.warn('[Auth] Standard signup failed or rate limited by email dispatch. Invoking admin-signup Edge Function fallback...')
      const { data: fnData, error: fnErr } = await client.functions.invoke('admin-signup', {
        body: {
          email: data.email.trim(),
          password: data.password,
          fullName: data.fullName.trim(),
          companyName: (data.companyName || '').trim(),
          accountType: data.accountType || (data.companyName ? 'enterprise' : 'individual')
        }
      })

      if (fnData?.isAlreadyRegistered) {
        return {
          success: false,
          error: 'An account with this email already exists. Please switch to Sign In.'
        }
      }

      if (!fnErr && fnData?.success) {
        console.log('[Auth] Admin signup created account successfully! Signing in...')
        const { data: loginRes } = await client.auth.signInWithPassword({
          email: data.email.trim(),
          password: data.password
        })

        if (loginRes?.user && loginRes?.session) {
          saveSessionSecurely(loginRes.session)
          syncLocalLicenseWithSupabase(loginRes.session.access_token).catch(() => {})
          await ensureProfileRow(loginRes.user)
          const userProfile = await buildUserProfile(loginRes.user)
          return {
            success: true,
            user: userProfile
          }
        }
      }

      return { success: false, error: error.message }
    }

    if (!authRes.user) {
      return { success: false, error: 'Failed to create user account.' }
    }

    if (authRes.session) {
      saveSessionSecurely(authRes.session)
      syncLocalLicenseWithSupabase(authRes.session.access_token).catch(() => {})
    }

    // Ensure profile entry exists in public.profiles table
    await ensureProfileRow(authRes.user)
    const userProfile = await buildUserProfile(authRes.user)

    return {
      success: true,
      user: userProfile
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'An unexpected error occurred during sign up.'
    }
  }
}

/**
 * Handles user Login (Sign In)
 */
export async function authLogin(data: LoginData): Promise<AuthResponse> {
  const client = getSupabaseClient()
  try {
    let { data: authRes, error } = await client.auth.signInWithPassword({
      email: data.email.trim(),
      password: data.password
    })

    if (error && error.message.toLowerCase().includes('not confirmed')) {
      console.warn('[Auth] Login returned "Email not confirmed". Invoking admin-signup to unblock user...')
      await client.functions.invoke('admin-signup', {
        body: {
          action: 'confirm-unconfirmed-user',
          email: data.email.trim()
        }
      })
      const retryRes = await client.auth.signInWithPassword({
        email: data.email.trim(),
        password: data.password
      })
      authRes = retryRes.data
      error = retryRes.error
    }

    if (error) {
      return { success: false, error: error.message }
    }

    if (!authRes.user || !authRes.session) {
      return { success: false, error: 'Invalid login credentials or session failed.' }
    }

    saveSessionSecurely(authRes.session)
    syncLocalLicenseWithSupabase(authRes.session.access_token).catch(() => {})
    await ensureProfileRow(authRes.user)
    const userProfile = await buildUserProfile(authRes.user)

    return {
      success: true,
      user: userProfile
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'An unexpected error occurred during login.'
    }
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
      await revokeLocalLicenseFromSupabase(token).catch(() => {})
    }
    await client.auth.signOut()
    saveSessionSecurely(null)
    return true
  } catch (err) {
    console.error('[Auth] Logout error:', err)
    saveSessionSecurely(null)
    return true
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
 * Resends confirmation email for unverified user account
 */
export async function authResendConfirmationEmail(email: string): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  try {
    const { error } = await client.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: {
        emailRedirectTo: 'prism://auth-callback'
      }
    })
    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to resend verification email.' }
  }
}

/**
 * Handles incoming deep link URL (e.g. prism://auth-callback#access_token=... or ?token_hash=...)
 */
export async function handleDeepLinkAuth(urlStr: string): Promise<UserProfile | null> {
  const client = getSupabaseClient()
  try {
    let accessToken = ''
    let refreshToken = ''
    let tokenHash = ''
    let type = ''

    if (urlStr.includes('#')) {
      const hashPart = urlStr.split('#')[1]
      const params = new URLSearchParams(hashPart)
      accessToken = params.get('access_token') || ''
      refreshToken = params.get('refresh_token') || ''
    }

    if (urlStr.includes('?')) {
      const queryPart = urlStr.split('?')[1].split('#')[0]
      const params = new URLSearchParams(queryPart)
      if (!accessToken) accessToken = params.get('access_token') || ''
      if (!refreshToken) refreshToken = params.get('refresh_token') || ''
      tokenHash = params.get('token_hash') || params.get('token') || ''
      type = params.get('type') || 'signup'
    }

    const isDeleteAction = urlStr.includes('action=delete-account') || urlStr.includes('delete-account')

    let activeUser: User | null = null
    let activeSessionToken: string | null = null

    if (accessToken && refreshToken) {
      const { data, error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      })
      if (!error && data.session && data.user) {
        activeUser = data.user
        activeSessionToken = data.session.access_token
        saveSessionSecurely(data.session)
      }
    } else if (tokenHash) {
      const { data, error } = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type: (type as any) || 'recovery'
      })
      if (!error && data.session && data.user) {
        activeUser = data.user
        activeSessionToken = data.session.access_token
        saveSessionSecurely(data.session)
      }
    }

    if (activeUser && isDeleteAction) {
      console.log('[Auth] Deep link triggered account deletion for user:', activeUser.id)
      const token = activeSessionToken || (await getAuthAccessToken())
      if (token) {
        const { data: fnData, error: fnErr } = await client.functions.invoke('delete-account', {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (fnErr || (fnData && !fnData.success)) {
          console.error('[Auth] Error executing delete-account function via deep link:', fnErr || fnData?.error)
        } else {
          console.log('[Auth] Account successfully deleted via email confirmation link!')
        }
      }
      await authLogout()
      saveSessionSecurely(null)
      return null
    }

    if (activeUser) {
      syncLocalLicenseWithSupabase(activeSessionToken!).catch(() => {})
      await ensureProfileRow(activeUser)
      return await buildUserProfile(activeUser)
    }
  } catch (err) {
    console.error('[Auth] Error handling deep link auth:', err)
  }
  return null
}

/**
 * Requests password reset email
 */
export async function authResetPassword(email: string): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  try {
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'prism://auth-callback'
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
    // 1. Update public.profiles table
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

    // 2. Also sync auth user_metadata
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
  const { session } = await ensureActiveSession()
  return session?.access_token || null
}


/**
 * Gets current AI quota usage status for the logged-in user
 */
export async function getUserAiUsage(): Promise<UserAiUsageStatus | null> {
  const { user } = await ensureActiveSession()
  if (!user) return null

  const client = getSupabaseClient()
  try {
    const { data: rpcData, error } = await client.rpc('get_user_ai_usage_status', {
      p_user_id: user.id
    })

    if (!error && rpcData) {
      const max5h = rpcData.max_5h || 20
      const max1w = rpcData.max_1w || 120
      const count5h = rpcData.count_5h ?? 0
      const count1w = rpcData.count_1w ?? 0
      const remaining5h = rpcData.remaining_5h ?? Math.max(0, max5h - count5h)
      const remaining1w = rpcData.remaining_1w ?? Math.max(0, max1w - count1w)

      const percentage5h = Math.round((remaining5h / max5h) * 100)
      const percentage1w = Math.round((remaining1w / max1w) * 100)
      const percentageRemaining = Math.min(percentage5h, percentage1w)

      return {
        percentageRemaining,
        percentage5h,
        percentage1w,
        count5h,
        count1w,
        remaining5h,
        remaining1w,
        reset5hSeconds: rpcData.reset_5h_seconds ?? 0,
        reset1wSeconds: rpcData.reset_1w_seconds ?? 0
      }
    }

    if (error) {
      console.error('[Auth] RPC get_user_ai_usage_status error:', error)
    }
  } catch (err) {
    console.error('[Auth] Error fetching user AI usage status:', err)
  }

  return null
}

/**
 * Sends account deletion confirmation email with prism://auth-callback?action=delete-account redirect URL
 */
export async function authRequestDeleteAccountEmail(email: string): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  try {
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'prism://auth-callback?action=delete-account'
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
