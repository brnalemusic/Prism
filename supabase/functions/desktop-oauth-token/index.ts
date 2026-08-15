import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const OAUTH_PEPPER = Deno.env.get('ACTIVATION_CODE_PEPPER') ?? 'default_prism_pepper_value'

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

function getCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400'
  }
}

async function computeHmacSha256(message: string, pepper: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function computePkceChallenge(verifier: string): Promise<string> {
  const enc = new TextEncoder()
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(verifier))
  return base64UrlEncode(new Uint8Array(hash))
}

function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  const enc = new TextEncoder()
  const bufA = enc.encode(a)
  const bufB = enc.encode(b)
  let diff = 0
  for (let i = 0; i < bufA.length; i++) {
    diff |= bufA[i] ^ bufB[i]
  }
  return diff === 0
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders()

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'invalid_request', error_description: 'Method not allowed.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const {
      grant_type: grantType,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri
    } = body

    if (grantType !== 'authorization_code') {
      return new Response(
        JSON.stringify({ error: 'unsupported_grant_type', error_description: 'Only authorization_code grant type is supported.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!code || typeof code !== 'string') {
      return new Response(
        JSON.stringify({ error: 'invalid_request', error_description: 'Missing code parameter.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!codeVerifier || typeof codeVerifier !== 'string') {
      return new Response(
        JSON.stringify({ error: 'invalid_request', error_description: 'Missing code_verifier parameter.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!redirectUri || redirectUri !== 'prism://auth-callback') {
      return new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid redirect_uri.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const codeHash = await computeHmacSha256(code.trim(), OAUTH_PEPPER)
    const now = new Date()

    // 1. Look up authorization code
    const { data: authRecord, error: lookupErr } = await supabaseAdmin
      .from('desktop_oauth_codes')
      .select('id, user_id, user_email, code_challenge, code_challenge_method, expires_at, consumed_at')
      .eq('code_hash', codeHash)
      .maybeSingle()

    if (lookupErr || !authRecord) {
      return new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'Authorization code is invalid or expired.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Check if expired or already consumed
    if (authRecord.consumed_at || new Date(authRecord.expires_at) < now) {
      return new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'Authorization code has expired or already been used.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. Verify PKCE code challenge
    const computedChallenge = await computePkceChallenge(codeVerifier.trim())
    const isPkceValid = constantTimeEqual(computedChallenge, authRecord.code_challenge)

    if (!isPkceValid) {
      return new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE code verification failed.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 4. Mark code as consumed immediately
    await supabaseAdmin
      .from('desktop_oauth_codes')
      .update({ consumed_at: now.toISOString() })
      .eq('id', authRecord.id)

    // 5. Determine user email
    let userEmail = authRecord.user_email
    if (!userEmail) {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(authRecord.user_id)
      userEmail = userData?.user?.email
    }

    if (!userEmail) {
      return new Response(
        JSON.stringify({ error: 'server_error', error_description: 'User email not found.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 6. Generate magiclink token
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: userEmail
    })

    if (linkErr || !linkData?.properties?.hashed_token) {
      console.error('[desktop-oauth-token] Failed to generate token link:', linkErr)
      return new Response(
        JSON.stringify({ error: 'server_error', error_description: 'Failed to create user session.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 7. Verify OTP + fetch Profile + fetch Activation in parallel
    const [{ data: sessionData, error: otpErr }, { data: profileData }, { data: activationData }] = await Promise.all([
      supabaseAnon.auth.verifyOtp({
        token_hash: linkData.properties.hashed_token,
        type: 'magiclink'
      }),
      supabaseAdmin.from('profiles').select('*').eq('id', authRecord.user_id).maybeSingle(),
      supabaseAdmin.from('account_activations').select('status, activated_at').eq('user_id', authRecord.user_id).maybeSingle()
    ])

    if (otpErr || !sessionData?.session) {
      console.error('[desktop-oauth-token] OTP exchange error:', otpErr)
      return new Response(
        JSON.stringify({ error: 'server_error', error_description: 'Failed to issue active session.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        token_type: 'bearer',
        expires_in: sessionData.session.expires_in,
        user: sessionData.user,
        profile: profileData || null,
        activation: activationData || { status: 'inactive', activated_at: null }
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        }
      }
    )
  } catch (err: any) {
    console.error('[desktop-oauth-token] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: 'server_error', error_description: err?.message || 'Internal server error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
