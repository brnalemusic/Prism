import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const OAUTH_PEPPER = Deno.env.get('ACTIVATION_CODE_PEPPER') ?? 'default_prism_pepper_value'
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const ALLOWED_ORIGINS = new Set([
  'https://prismagent.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
])

const ALLOWED_CLIENT_IDS = new Set([
  'prism-desktop',
  '8ae3ee2d-497f-42e0-9561-67e18f4e2b5b'
])

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : '*'
  return {
    'Access-Control-Allow-Origin': allowOrigin,
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

function generateSecureAuthCode(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `ac_${base64UrlEncode(bytes)}`
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()

    if (!jwt) {
      return new Response(
        JSON.stringify({ error: 'Authentication required.', code: 'AUTH_REQUIRED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt)
    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session.', code: 'AUTH_REQUIRED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json().catch(() => ({}))
    const {
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod = 'S256',
      state
    } = body

    if (!clientId || !ALLOWED_CLIENT_IDS.has(clientId)) {
      return new Response(
        JSON.stringify({ error: 'Invalid client_id.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!redirectUri || redirectUri !== 'prism://auth-callback') {
      return new Response(
        JSON.stringify({ error: 'Invalid redirect_uri.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!codeChallenge || typeof codeChallenge !== 'string' || codeChallenge.length < 16) {
      return new Response(
        JSON.stringify({ error: 'Invalid code_challenge.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (codeChallengeMethod !== 'S256') {
      return new Response(
        JSON.stringify({ error: 'Unsupported code_challenge_method. Only S256 is supported.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!state || typeof state !== 'string') {
      return new Response(
        JSON.stringify({ error: 'State parameter is required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userId = userData.user.id
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString() // 5 minutes TTL

    const rawCode = generateSecureAuthCode()
    const codeHash = await computeHmacSha256(rawCode, OAUTH_PEPPER)

    // Store authorization code
    const { error: insertErr } = await supabaseAdmin
      .from('desktop_oauth_codes')
      .insert({
        user_id: userId,
        user_email: userData.user.email,
        code_hash: codeHash,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        redirect_uri: redirectUri,
        client_id: clientId,
        expires_at: expiresAt
      })

    if (insertErr) {
      console.error('[desktop-oauth-authorize] Insert error:', insertErr)
      return new Response(
        JSON.stringify({ error: 'Failed to issue authorization code.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const redirectUrl = `prism://auth-callback?code=${encodeURIComponent(rawCode)}&state=${encodeURIComponent(state)}`

    return new Response(
      JSON.stringify({
        success: true,
        redirect_url: redirectUrl
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      }
    )
  } catch (err: any) {
    console.error('[desktop-oauth-authorize] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal server error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
