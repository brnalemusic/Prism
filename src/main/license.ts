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

