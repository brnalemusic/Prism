import crypto from 'node:crypto'
import { loadConfig, saveConfig } from './config'
import type { LicenseInfo, ActivationResult } from '../shared/types'

// Embedded Public Key (Ed25519)
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAkHVl3RMVeGM9QIntkaQ6Q48vFU1G2ZwALwScZiWaYg0=
-----END PUBLIC KEY-----`

export function verifyLicenseKey(keyString: string): { valid: boolean; info?: LicenseInfo; error?: string } {
  if (!keyString || typeof keyString !== 'string') {
    return { valid: false, error: 'License key is missing or invalid format.' }
  }

  const trimmed = keyString.trim()
  const parts = trimmed.split('.')
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid license key structure.' }
  }

  const [_prefix, payloadBase64, signatureBase64] = parts

  try {
    const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf8')
    const payload = JSON.parse(payloadJson) as {
      id: string
      licensee: string
      email: string
      type: string
      seats: number
      issuedAt: string
      expiresAt: string
    }

    const signatureBuffer = Buffer.from(signatureBase64, 'base64url')
    const isVerified = crypto.verify(
      null,
      Buffer.from(payloadBase64),
      PUBLIC_KEY_PEM,
      signatureBuffer
    )

    if (!isVerified) {
      return { valid: false, error: 'Invalid signature. License key has been tampered with or is invalid.' }
    }

    // Check expiration
    if (payload.expiresAt) {
      const expiryDate = new Date(payload.expiresAt)
      if (isNaN(expiryDate.getTime()) || expiryDate < new Date()) {
        return { valid: false, error: 'License key has expired.' }
      }
    }

    const info: LicenseInfo = {
      id: payload.id,
      licensee: payload.licensee,
      email: payload.email,
      type: payload.type || 'ENTERPRISE',
      seats: payload.seats || 1,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      isActivated: true,
      key: trimmed
    }

    return { valid: true, info }
  } catch (err: any) {
    return { valid: false, error: `Failed to verify license key: ${err?.message || 'Unknown error'}` }
  }
}

export function getLicenseInfo(): LicenseInfo | null {
  const config = loadConfig()
  if (!config.licenseKey) return null

  const verification = verifyLicenseKey(config.licenseKey)
  if (verification.valid && verification.info) {
    return verification.info
  }

  return null
}

export function activateLicenseKey(keyString: string): ActivationResult {
  const verification = verifyLicenseKey(keyString)
  if (!verification.valid || !verification.info) {
    return {
      success: false,
      error: verification.error || 'Invalid license key.'
    }
  }

  const saved = saveConfig({ licenseKey: keyString.trim() })
  if (!saved) {
    return { success: false, error: 'Failed to persist license activation in configuration.' }
  }

  return {
    success: true,
    info: verification.info
  }
}

export function deactivateLicense(): boolean {
  return saveConfig({ licenseKey: '' })
}

export function startLicenseExpirationMonitor(onExpired: () => void): () => void {
  const checkExpiration = () => {
    const config = loadConfig()
    if (!config.licenseKey) return

    const verification = verifyLicenseKey(config.licenseKey)
    if (!verification.valid) {
      console.log('⏰ License key has expired or is invalid. Revoking activation...')
      deactivateLicense()
      onExpired()
    }
  }

  // Initial check on launch
  checkExpiration()

  // Periodically check every 10 seconds
  const interval = setInterval(checkExpiration, 10000)
  return () => clearInterval(interval)
}

const SUPABASE_URL = 'https://jfqyqkkdmoqdpejzxdhd.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_WcCSfH1dSXUzHDjlQGk2kw_4TQcAt4Q'
const EDGE_BASE = `${SUPABASE_URL}/functions/v1`

/**
 * Syncs the currently active local Enterprise key with Supabase for the logged-in user session.
 */
export async function syncLocalLicenseWithSupabase(accessToken: string, licenseKey?: string): Promise<boolean> {
  const keyToSync = licenseKey?.trim() || getLicenseInfo()?.key
  if (!keyToSync) return false

  try {
    const res = await fetch(`${EDGE_BASE}/activate-local-license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ license_key: keyToSync })
    })

    const data = await res.json()
    if (!res.ok || !data.success) {
      console.warn('[LicenseSync] Failed to sync local license with Supabase:', data?.error)
      return false
    }

    console.log('[LicenseSync] Successfully synced local Enterprise license with Supabase account.')
    return true
  } catch (err) {
    console.error('[LicenseSync] Network error syncing local license:', err)
    return false
  }
}

/**
 * Revokes the online Enterprise status for the logged-in user session when they log out or deactivate.
 */
export async function revokeLocalLicenseFromSupabase(accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${EDGE_BASE}/deactivate-local-license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    })

    const data = await res.json()
    if (!res.ok || !data.success) {
      console.warn('[LicenseSync] Failed to revoke online enterprise status:', data?.error)
      return false
    }

    console.log('[LicenseSync] Successfully revoked online enterprise status.')
    return true
  } catch (err) {
    console.error('[LicenseSync] Network error revoking online license status:', err)
    return false
  }
}


