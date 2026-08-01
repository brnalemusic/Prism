import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js'
import { safeStorage, app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { UserProfile, AuthResponse, SignUpData, LoginData } from '../shared/types'

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
 * Formats Supabase user & profile data into UserProfile
 */
async function buildUserProfile(user: User): Promise<UserProfile> {
  const client = getSupabaseClient()
  let fullName = user.user_metadata?.full_name || ''
  let companyName = user.user_metadata?.company_name || ''
  let accountType = user.user_metadata?.account_type || (companyName ? 'enterprise' : 'individual')
  let avatarUrl = user.user_metadata?.avatar_url || ''

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
    avatarUrl
  }
}

/**
 * Initializes and restores session on main process boot up
 */
export async function initializeAuthSession(): Promise<UserProfile | null> {
  const { user } = await ensureActiveSession()
  if (!user) return null
  return await buildUserProfile(user)
}

/**
 * Handles user Sign Up
 */
export async function authSignUp(data: SignUpData): Promise<AuthResponse> {
  const client = getSupabaseClient()
  try {
    const { data: authRes, error } = await client.auth.signUp({
      email: data.email.trim(),
      password: data.password,
      options: {
        data: {
          full_name: data.fullName.trim(),
          company_name: (data.companyName || '').trim(),
          account_type: data.accountType || (data.companyName ? 'enterprise' : 'individual')
        }
      }
    })

    if (error) {
      return { success: false, error: error.message }
    }

    if (!authRes.user) {
      return { success: false, error: 'Failed to create user account.' }
    }

    if (authRes.session) {
      saveSessionSecurely(authRes.session)
    }

    const userProfile = await buildUserProfile(authRes.user)

    // Ensure profile entry exists in public.profiles
    try {
      await client.from('profiles').upsert({
        id: authRes.user.id,
        email: userProfile.email,
        full_name: userProfile.fullName,
        company_name: userProfile.companyName,
        account_type: userProfile.accountType
      })
    } catch (upsertErr) {
      console.warn('[Auth] Upsert profile warning:', upsertErr)
    }

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
    const { data: authRes, error } = await client.auth.signInWithPassword({
      email: data.email.trim(),
      password: data.password
    })

    if (error) {
      return { success: false, error: error.message }
    }

    if (!authRes.user || !authRes.session) {
      return { success: false, error: 'Invalid login credentials or session failed.' }
    }

    saveSessionSecurely(authRes.session)
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
 * Requests password reset email
 */
export async function authResetPassword(email: string): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient()
  try {
    const { error } = await client.auth.resetPasswordForEmail(email.trim())
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
