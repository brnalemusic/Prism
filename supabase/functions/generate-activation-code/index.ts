import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ACTIVATION_CODE_PEPPER = Deno.env.get('ACTIVATION_CODE_PEPPER') ?? 'default_prism_pepper_value'
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const ALLOWED_ORIGINS = new Set([
  'https://prismagent.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
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

function generate6DigitCode(): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  const num = buf[0] % 1000000
  return num.toString().padStart(6, '0')
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

    const userId = userData.user.id
    const now = new Date()

    // 1. Check if account is already active
    const { data: activation } = await supabaseAdmin
      .from('account_activations')
      .select('status, activated_at')
      .eq('user_id', userId)
      .maybeSingle()

    if (activation?.status === 'active') {
      return new Response(
        JSON.stringify({
          status: 'active',
          activatedAt: activation.activated_at,
          message: 'Account is already active.'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Check rate limit on code generation: max 1 per 60s, max 10 per hour
    const oneMinAgo = new Date(now.getTime() - 60_000).toISOString()
    const oneHourAgo = new Date(now.getTime() - 3600_000).toISOString()

    const { data: recentCodes, error: rateErr } = await supabaseAdmin
      .from('account_activation_codes')
      .select('created_at')
      .eq('user_id', userId)
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false })

    if (!rateErr && recentCodes) {
      const codeInLastMin = recentCodes.find((c) => new Date(c.created_at).getTime() > now.getTime() - 60_000)
      if (codeInLastMin) {
        const elapsedSec = Math.floor((now.getTime() - new Date(codeInLastMin.created_at).getTime()) / 1000)
        const retryAfter = Math.max(1, 60 - elapsedSec)
        return new Response(
          JSON.stringify({
            error: `Please wait ${retryAfter} seconds before generating a new code.`,
            code: 'RATE_LIMITED',
            retryAfter
          }),
          {
            status: 429,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Retry-After': String(retryAfter)
            }
          }
        )
      }

      if (recentCodes.length >= 10) {
        return new Response(
          JSON.stringify({
            error: 'Maximum code generation limit reached for this hour (10 codes/hour). Please try again later.',
            code: 'HOURLY_LIMIT_EXCEEDED',
            retryAfter: 3600
          }),
          {
            status: 429,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Retry-After': '3600'
            }
          }
        )
      }
    }

    // 3. Generate 6-digit code and format as XXX-XXX
    const rawCode = generate6DigitCode()
    const formattedCode = `${rawCode.slice(0, 3)}-${rawCode.slice(3)}`
    const codeHash = await computeHmacSha256(rawCode, ACTIVATION_CODE_PEPPER)
    const expiresAt = new Date(now.getTime() + 60_000).toISOString()

    // 4. Invalidate previous unconsumed codes for this user
    await supabaseAdmin
      .from('account_activation_codes')
      .update({ consumed_at: now.toISOString() })
      .eq('user_id', userId)
      .is('consumed_at', null)

    // 5. Insert new code hash
    const { error: insertErr } = await supabaseAdmin
      .from('account_activation_codes')
      .insert({
        user_id: userId,
        code_hash: codeHash,
        expires_at: expiresAt
      })

    if (insertErr) {
      console.error('[generate-activation-code] Insert error:', insertErr)
      return new Response(
        JSON.stringify({ error: 'Failed to generate activation code.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        code: formattedCode,
        expiresAt
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      }
    )
  } catch (err: any) {
    console.error('[generate-activation-code] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal server error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
