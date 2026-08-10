import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Buffer } from 'node:buffer'
import { verify as verifySignature } from 'node:crypto'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DATABASE_REQUEST_TIMEOUT_MS = 10_000

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAkHVl3RMVeGM9QIntkaQ6Q48vFU1G2ZwALwScZiWaYg0=
-----END PUBLIC KEY-----`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface LicensePayload {
  id: string
  licensee: string
  email: string
  type: string
  seats: number
  issuedAt: string
  expiresAt: string
  plan_id?: string
  stripe_session_id?: string
}

const fetchWithTimeout: typeof fetch = async (input, init) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DATABASE_REQUEST_TIMEOUT_MS)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

interface AuthenticatedUser {
  id: string
  email?: string
  metadata?: Record<string, unknown>
}

function getAuthenticatedUser(req: Request): AuthenticatedUser | null {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const payloadBase64 = jwt.split('.')[1]
  if (!payloadBase64) return null

  try {
    const normalized = payloadBase64.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded)) as { sub?: string; email?: string; user_metadata?: Record<string, unknown> }
    if (!claims.sub) return null
    return { id: claims.sub, email: claims.email, metadata: claims.user_metadata }
  } catch {
    return null
  }
}

function verifyLicenseKey(keyString: string): { valid: boolean; payload?: LicensePayload; rawKey?: string; error?: string } {
  if (!keyString || typeof keyString !== 'string') {
    return { valid: false, error: 'License key is missing or invalid.' }
  }

  const trimmed = keyString.trim()
  const parts = trimmed.split('.')
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid license key format.' }
  }

  const [_prefix, payloadBase64, signatureBase64] = parts

  try {
    const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf8')
    const payload = JSON.parse(payloadJson) as LicensePayload

    const signatureBuffer = Buffer.from(signatureBase64, 'base64url')
    const isVerified = verifySignature(
      null,
      Buffer.from(payloadBase64),
      PUBLIC_KEY_PEM,
      signatureBuffer
    )

    if (!isVerified) {
      return { valid: false, error: 'Invalid license signature.' }
    }

    if (payload.expiresAt) {
      const expiryDate = new Date(payload.expiresAt)
      if (isNaN(expiryDate.getTime()) || expiryDate < new Date()) {
        return { valid: false, error: 'License key has expired.' }
      }
    }

    return { valid: true, payload, rawKey: trimmed }
  } catch (err: any) {
    return { valid: false, error: `Verification failed: ${err?.message || 'Unknown error'}` }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const user = getAuthenticatedUser(req)
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { fetch: fetchWithTimeout }
    })
    const { license_key } = await req.json()

    const verification = verifyLicenseKey(license_key)
    if (!verification.valid || !verification.payload || !verification.rawKey) {
      return new Response(
        JSON.stringify({ error: verification.error || 'Invalid license key.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const payload = verification.payload
    const rawKey = verification.rawKey
    const isStripeLicense = typeof payload.stripe_session_id === 'string' && payload.stripe_session_id.length > 0

    const planId = payload.plan_id || 'enterprise_local'
    const { data: plan, error: planErr } = await supabase
      .from('subscription_plans')
      .select('id')
      .eq('id', planId)
      .maybeSingle()

    if (planErr || !plan) {
      throw new Error('The license plan is not configured for Prism Cloud.')
    }

    if (isStripeLicense) {
      const { data: stripeLicense, error: stripeLicenseError } = await supabase
        .from('user_licenses')
        .select('id')
        .eq('user_id', user.id)
        .eq('stripe_session_id', payload.stripe_session_id)
        .maybeSingle()

      if (stripeLicenseError || !stripeLicense) {
        throw new Error('No verified Stripe entitlement was found for this Prism account.')
      }

      const { error: stripeUpdateError } = await supabase
        .from('user_licenses')
        .update({
          license_key: rawKey,
          user_email: user.email,
          company_name: payload.licensee || user.metadata?.company_name || 'Enterprise Licensee',
        })
        .eq('id', stripeLicense.id)

      if (stripeUpdateError) throw stripeUpdateError

      return new Response(
        JSON.stringify({ success: true, tier: 'enterprise', license_id: payload.id }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Floating-seat enforcement applies only to signed local licenses.
    const { error: transferErr } = await supabase
      .from('user_licenses')
      .update({ status: 'transferred' })
      .eq('license_id', payload.id)
      .neq('user_id', user.id)
      .is('stripe_session_id', null)

    if (transferErr) throw transferErr

    // 2. Check if row exists for current user and this license_id
    const { data: existing, error: existingErr } = await supabase
      .from('user_licenses')
      .select('id')
      .eq('user_id', user.id)
      .eq('license_id', payload.id)
      .is('stripe_session_id', null)
      .maybeSingle()

    if (existingErr) throw existingErr

    if (existing) {
      const { error: updateErr } = await supabase
        .from('user_licenses')
        .update({
          status: 'active',
          expires_at: payload.expiresAt,
          license_key: rawKey,
          user_email: user.email,
          company_name: payload.licensee || user.metadata?.company_name || 'Enterprise Licensee',
        })
        .eq('id', existing.id)
      if (updateErr) throw updateErr
    } else {
      const { error: insertErr } = await supabase.from('user_licenses').insert({
        user_id: user.id,
        license_id: payload.id,
        plan_id: planId,
        license_key: rawKey,
        status: 'active',
        issued_at: payload.issuedAt || new Date().toISOString(),
        expires_at: payload.expiresAt,
        user_email: user.email,
        company_name: payload.licensee || user.metadata?.company_name || 'Enterprise Licensee',
      })
      if (insertErr) throw insertErr
    }

    return new Response(
      JSON.stringify({ success: true, tier: 'enterprise', license_id: payload.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[activate-local-license] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal server error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
