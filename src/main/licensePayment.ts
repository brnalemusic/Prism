import { createClient } from '@supabase/supabase-js'
import type { SubscriptionPlan, CheckoutSessionResult, PaymentVerificationResult } from '../shared/types'
import { activateLicenseKey, syncLocalLicenseWithSupabase } from './license'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Supabase client (anon key only — safe to ship in the binary)
// ---------------------------------------------------------------------------
const SUPABASE_URL = 'https://jfqyqkkdmoqdpejzxdhd.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_WcCSfH1dSXUzHDjlQGk2kw_4TQcAt4Q'

// Edge Function base URL (same Supabase project)
const EDGE_BASE = `${SUPABASE_URL}/functions/v1`

function getSupabaseClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}

// ---------------------------------------------------------------------------
// Fetch active subscription plans from Supabase DB
// ---------------------------------------------------------------------------
export async function fetchSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const client = getSupabaseClient()
  try {
    const { data, error } = await client
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .order('price_usd', { ascending: true })

    if (error || !data || data.length === 0) {
      console.error('[LicensePayment] Error fetching plans from Supabase:', error)
      return getFallbackPlans()
    }

    return data.map((item: any) => ({
      id: item.id,
      name: item.name,
      description: item.description || '',
      priceUsd: parseFloat(item.price_usd),
      billingInterval: item.billing_interval || 'month',
      durationDays: parseInt(item.duration_days, 10) || 30,
      seats: parseInt(item.seats, 10) || 1,
      badge: item.badge || undefined,
      isActive: item.is_active ?? true,
    }))
  } catch (err) {
    console.error('[LicensePayment] Unexpected error fetching plans:', err)
    return getFallbackPlans()
  }
}

function getFallbackPlans(): SubscriptionPlan[] {
  return [
    {
      id: 'enterprise_monthly',
      name: 'Enterprise Monthly',
      description: 'Full Prism Enterprise features billed monthly.',
      priceUsd: 149.90,
      billingInterval: 'month',
      durationDays: 30,
      seats: 1,
      badge: 'Monthly',
      isActive: true,
    },
    {
      id: 'enterprise_yearly',
      name: 'Enterprise Yearly',
      description: 'Full Prism Enterprise features billed annually.',
      priceUsd: 1079.90,
      billingInterval: 'year',
      durationDays: 365,
      seats: 1,
      badge: 'Best Value',
      isActive: true,
    },
    {
      id: 'enterprise_decade',
      name: 'Enterprise 10 Years',
      description: 'Full Prism Enterprise features valid for 10 years.',
      priceUsd: 7195.90,
      billingInterval: 'decade',
      durationDays: 3650,
      seats: 1,
      badge: 'Decade Pass',
      isActive: true,
    },
  ]
}

// ---------------------------------------------------------------------------
// Create a real Stripe Checkout Session via Supabase Edge Function.
// NOTE: No Stripe secret key exists in this file — it lives exclusively
//       in the Supabase Edge Function environment (server-side).
// ---------------------------------------------------------------------------
export async function createStripeCheckoutSession(
  planId: string,
  userEmail: string | undefined,
  accessToken: string
): Promise<CheckoutSessionResult> {
  try {
    const res = await fetch(`${EDGE_BASE}/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ plan_id: planId, email: userEmail ?? '' }),
    })

    const data = await res.json()

    if (!res.ok || !data.url) {
      console.error('[LicensePayment] Edge Function error:', data)
      return { success: false, error: data.error ?? 'Failed to create Stripe Checkout session.' }
    }

    return {
      success: true,
      checkoutUrl: data.url,
      sessionId: data.session_id,
    }
  } catch (err: any) {
    console.error('[LicensePayment] Network error creating session:', err)
    return { success: false, error: err?.message ?? 'Network error contacting payment server.' }
  }
}

// ---------------------------------------------------------------------------
// Sign the license payload with the local Ed25519 private key.
// The Edge Function returns the raw payload; we sign it here so the
// private key never leaves the machine and is never sent over the network.
// ---------------------------------------------------------------------------
function signPayload(payloadBase64: string): string {
  const KEYS_DIR = path.join(__dirname, '..', '..', 'scripts', 'license-keys')
  const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private_key.pem')

  let privateKeyPem = ''
  if (fs.existsSync(PRIVATE_KEY_PATH)) {
    privateKeyPem = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8')
  }

  // Generate a temporary ephemeral key if the static PEM is missing
  if (!privateKeyPem) {
    const keypair = crypto.generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    privateKeyPem = keypair.privateKey
  }

  const signatureBuffer = crypto.sign(null, Buffer.from(payloadBase64), privateKeyPem)
  return signatureBuffer.toString('base64url')
}

// ---------------------------------------------------------------------------
// Verify that the Stripe Checkout Session was paid, then activate a license.
// The verification happens server-side in the Edge Function — this function
// only calls the Edge Function and, on success, activates the key locally.
// ---------------------------------------------------------------------------
export async function verifyAndActivatePayment(
  planId: string,
  sessionId: string,
  userEmail: string,
  companyName: string | undefined,
  accessToken: string
): Promise<PaymentVerificationResult> {
  try {
    // 1. Call the Edge Function — it verifies payment_status === 'paid' with Stripe
    const res = await fetch(`${EDGE_BASE}/verify-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        session_id: sessionId,
        plan_id: planId,
        email: userEmail,
        company_name: companyName ?? '',
      }),
    })

    const data = await res.json()

    if (!res.ok || !data.success) {
      console.error('[LicensePayment] Edge Function verify-payment error:', data)
      return { success: false, error: data.error ?? 'Payment verification failed.' }
    }

    // 2. Sign the payload locally with the Ed25519 key
    const payloadBase64 = data.payload
      ? Buffer.from(JSON.stringify(data.payload)).toString('base64url')
      : ''

    if (!payloadBase64) {
      return { success: false, error: 'Invalid license payload returned by server.' }
    }

    const signature = signPayload(payloadBase64)
    const licenseKey = `PRISM-ENTERPRISE.${payloadBase64}.${signature}`

    // 3. Activate the license locally in Prism
    const activation = activateLicenseKey(licenseKey)
    if (!activation.success) {
      return { success: false, error: activation.error ?? 'Failed to activate generated license.' }
    }

    // The verified payment already grants the remote entitlement. Keep the
    // stored key in sync too, so future authenticated sessions retain the
    // license-to-account link without relying on email matching.
    await syncLocalLicenseWithSupabase(accessToken).catch((err) => {
      console.warn('[LicensePayment] Failed to replace the pending remote license key:', err)
    })

    return { success: true, licenseKey }
  } catch (err: any) {
    console.error('[LicensePayment] verifyAndActivatePayment error:', err)
    return { success: false, error: err?.message ?? 'Payment verification failed.' }
  }
}
