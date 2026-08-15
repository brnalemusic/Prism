import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400'
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
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

    const { data: activation, error: actErr } = await supabaseAdmin
      .from('account_activations')
      .select('status, activated_at')
      .eq('user_id', userId)
      .maybeSingle()

    if (actErr) {
      console.error('[account-status] Database lookup error:', actErr)
      return new Response(
        JSON.stringify({ error: 'Failed to retrieve account activation status.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!activation) {
      // Create default inactive row if missing
      await supabaseAdmin.from('account_activations').insert({
        user_id: userId,
        status: 'inactive'
      })

      return new Response(
        JSON.stringify({ status: 'inactive', activatedAt: null }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        }
      )
    }

    return new Response(
      JSON.stringify({
        status: activation.status || 'inactive',
        activatedAt: activation.activated_at || null
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      }
    )
  } catch (err: any) {
    console.error('[account-status] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal server error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
