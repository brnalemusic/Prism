import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DATABASE_REQUEST_TIMEOUT_MS = 10_000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function getAuthenticatedUserId(req: Request): string | null {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const payloadBase64 = jwt.split('.')[1]
  if (!payloadBase64) return null

  try {
    const normalized = payloadBase64.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded)) as { sub?: string }
    return claims.sub || null
  } catch {
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const userId = getAuthenticatedUserId(req)
    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Authentication required.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { fetch: fetchWithTimeout }
    })
    // Deactivate only the account's license entitlement. Account type is a
    // separate profile attribute and must never be changed by this flow.
    const { error: deactivateErr } = await supabase
      .from('user_licenses')
      .update({ status: 'inactive' })
      .eq('user_id', userId)
      .eq('status', 'active')
      .is('stripe_session_id', null)

    if (deactivateErr) throw deactivateErr

    return new Response(
      JSON.stringify({ success: true, tier: 'free' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[deactivate-local-license] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal server error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
