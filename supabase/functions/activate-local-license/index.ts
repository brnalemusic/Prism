import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import crypto from 'node:crypto'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

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
    const isVerified = crypto.verify(
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
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')

    if (!jwt) {
      return new Response(
        JSON.stringify({ error: 'Authentication required.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt)

    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid session token.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const user = userData.user
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

    // 1. Floating Seat Enforcement: Revoke active license for this license_id from other users
    await supabase
      .from('user_licenses')
      .update({ status: 'transferred' })
      .eq('license_id', payload.id)
      .neq('user_id', user.id)

    // 2. Check if row exists for current user and this license_id
    const { data: existing } = await supabase
      .from('user_licenses')
      .select('id')
      .eq('user_id', user.id)
      .eq('license_id', payload.id)
      .maybeSingle()

    if (existing) {
      await supabase
        .from('user_licenses')
        .update({
          status: 'active',
          expires_at: payload.expiresAt,
          license_key: rawKey,
          user_email: user.email,
          company_name: payload.licensee || user.user_metadata?.company_name || 'Enterprise Licensee',
        })
        .eq('id', existing.id)
    } else {
      await supabase.from('user_licenses').insert({
        user_id: user.id,
        license_id: payload.id,
        plan_id: payload.plan_id || 'enterprise_local',
        license_key: rawKey,
        status: 'active',
        issued_at: payload.issuedAt || new Date().toISOString(),
        expires_at: payload.expiresAt,
        user_email: user.email,
        company_name: payload.licensee || user.user_metadata?.company_name || 'Enterprise Licensee',
      })
    }

    // 3. Update profiles account_type to enterprise
    await supabase
      .from('profiles')
      .update({ account_type: 'enterprise' })
      .eq('id', user.id)

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
