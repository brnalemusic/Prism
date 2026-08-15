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

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
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
    const nowMs = now.getTime()

    // 1. Check rate limits across 5 sliding windows:
    //    - 1 attempt in 5 seconds
    //    - 2 attempts in 1 minute (60s)
    //    - 4 attempts in 10 minutes (600s)
    //    - 5 attempts in 24 hours (86400s)
    //    - 8 attempts in 7 days (604800s)
    const sevenDaysAgo = new Date(nowMs - 7 * 86400_000).toISOString()
    const { data: recentAttempts, error: attErr } = await supabaseAdmin
      .from('account_activation_attempts')
      .select('attempted_at')
      .eq('user_id', userId)
      .gte('attempted_at', sevenDaysAgo)
      .order('attempted_at', { ascending: false })

    if (attErr) {
      console.error('[activate-account] Failed to fetch attempts:', attErr)
    }

    const attemptsList = recentAttempts || []

    // Helper to calculate remaining lockout seconds for a window
    const checkLimit = (windowMs: number, maxCount: number): number | null => {
      const windowAttempts = attemptsList.filter(
        (a) => nowMs - new Date(a.attempted_at).getTime() <= windowMs
      )
      if (windowAttempts.length >= maxCount) {
        const oldestInWindow = windowAttempts[windowAttempts.length - 1]
        const elapsed = nowMs - new Date(oldestInWindow.attempted_at).getTime()
        return Math.max(1, Math.ceil((windowMs - elapsed) / 1000))
      }
      return null
    }

    const lockout5s = checkLimit(5_000, 1)
    const lockout1m = checkLimit(60_000, 2)
    const lockout10m = checkLimit(600_000, 4)
    const lockout24h = checkLimit(86400_000, 5)
    const lockout7d = checkLimit(7 * 86400_000, 8)

    const maxLockout = Math.max(
      lockout5s ?? 0,
      lockout1m ?? 0,
      lockout10m ?? 0,
      lockout24h ?? 0,
      lockout7d ?? 0
    )

    if (maxLockout > 0) {
      return new Response(
        JSON.stringify({
          error: `Too many activation attempts. Please wait ${maxLockout} seconds before trying again.`,
          code: 'ACTIVATION_RATE_LIMITED',
          retryAfter: maxLockout
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Retry-After': String(maxLockout)
          }
        }
      )
    }

    // Record this attempt
    await supabaseAdmin.from('account_activation_attempts').insert({
      user_id: userId,
      attempted_at: now.toISOString()
    })

    // 2. Check if already active (idempotent success)
    const { data: currentAct } = await supabaseAdmin
      .from('account_activations')
      .select('status, activated_at')
      .eq('user_id', userId)
      .maybeSingle()

    if (currentAct?.status === 'active') {
      return new Response(
        JSON.stringify({
          status: 'active',
          activatedAt: currentAct.activated_at || now.toISOString(),
          message: 'Account is already active.'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. Parse input body and code
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      // Empty or invalid json
    }

    const rawInput = typeof body?.code === 'string' ? body.code : ''
    const normalizedCode = rawInput.replace(/[^0-9]/g, '').trim()

    if (normalizedCode.length !== 6) {
      return new Response(
        JSON.stringify({
          error: 'Invalid or expired activation code.',
          code: 'INVALID_OR_EXPIRED_CODE'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const inputHash = await computeHmacSha256(normalizedCode, ACTIVATION_CODE_PEPPER)

    // 4. Find valid, unexpired and unconsumed code for this user
    const { data: codeRecords, error: codeErr } = await supabaseAdmin
      .from('account_activation_codes')
      .select('id, code_hash, expires_at, consumed_at')
      .eq('user_id', userId)
      .is('consumed_at', null)
      .gt('expires_at', now.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)

    if (codeErr || !codeRecords || codeRecords.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'Invalid or expired activation code.',
          code: 'INVALID_OR_EXPIRED_CODE'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const targetRecord = codeRecords[0]
    const matches = constantTimeEquals(targetRecord.code_hash, inputHash)

    if (!matches) {
      return new Response(
        JSON.stringify({
          error: 'Invalid or expired activation code.',
          code: 'INVALID_OR_EXPIRED_CODE'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 5. Code matched! Consume code and activate account in database
    const activatedAt = now.toISOString()

    await supabaseAdmin
      .from('account_activation_codes')
      .update({ consumed_at: activatedAt })
      .eq('id', targetRecord.id)

    const { error: updateActErr } = await supabaseAdmin
      .from('account_activations')
      .upsert({
        user_id: userId,
        status: 'active',
        activated_at: activatedAt,
        updated_at: activatedAt
      })

    if (updateActErr) {
      console.error('[activate-account] Activation upsert error:', updateActErr)
      return new Response(
        JSON.stringify({ error: 'Failed to update account activation status.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        status: 'active',
        activatedAt
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[activate-account] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal server error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
