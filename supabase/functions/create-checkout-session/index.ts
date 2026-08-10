import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DATABASE_REQUEST_TIMEOUT_MS = 10_000
const STRIPE_REQUEST_TIMEOUT_MS = 15_000

const SUCCESS_URL = 'https://jfqyqkkdmoqdpejzxdhd.supabase.co/functions/v1/payment-success'
const CANCEL_URL = 'https://jfqyqkkdmoqdpejzxdhd.supabase.co/functions/v1/payment-cancel'

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

async function fetchStripe(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), STRIPE_REQUEST_TIMEOUT_MS)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function getAuthenticatedUser(req: Request): { id: string; email?: string } | null {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const payloadBase64 = jwt.split('.')[1]
  if (!payloadBase64) return null

  try {
    const normalized = payloadBase64.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded)) as { sub?: string; email?: string }
    return claims.sub ? { id: claims.sub, email: claims.email } : null
  } catch {
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { fetch: fetchWithTimeout },
    })
    const user = getAuthenticatedUser(req)
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { plan_id } = await req.json()
    if (!plan_id) {
      return new Response(
        JSON.stringify({ error: 'plan_id is required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: plan, error: planError } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('id', plan_id)
      .eq('is_active', true)
      .single()

    if (planError || !plan) {
      return new Response(
        JSON.stringify({ error: 'Plan not found or inactive.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const unitAmountCents = Math.round(parseFloat(plan.price_usd) * 100)
    const params = new URLSearchParams()
    params.append('mode', 'payment')
    params.append('success_url', `${SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}&plan=${plan.id}`)
    params.append('cancel_url', CANCEL_URL)
    params.append('line_items[0][price_data][currency]', 'usd')
    params.append('line_items[0][price_data][unit_amount]', unitAmountCents.toString())
    params.append('line_items[0][price_data][product_data][name]', `Prism ${plan.name}`)
    params.append('line_items[0][price_data][product_data][description]', plan.description ?? '')
    params.append('line_items[0][quantity]', '1')
    params.append('client_reference_id', user.id)
    params.append('metadata[plan_id]', plan.id)
    params.append('metadata[duration_days]', String(plan.duration_days ?? 30))
    params.append('metadata[user_id]', user.id)

    if (user.email) {
      params.append('customer_email', user.email)
    }

    const stripeRes = await fetchStripe('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const session = await stripeRes.json()
    if (!stripeRes.ok || !session.url) {
      console.error('[create-checkout-session] Stripe error:', JSON.stringify(session))
      return new Response(
        JSON.stringify({ error: session.error?.message ?? 'Failed to create Stripe session.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { error: pendingError } = await supabase.from('pending_checkout_sessions').upsert({
      session_id: session.id,
      plan_id: plan.id,
      user_id: user.id,
      user_email: user.email ?? null,
      status: 'pending',
    })

    if (pendingError) throw pendingError

    return new Response(
      JSON.stringify({ url: session.url, session_id: session.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[create-checkout-session] Unexpected error:', err)
    const error = err?.name === 'AbortError'
      ? 'Checkout service timed out. Please try again.'
      : err?.message || 'Internal server error.'
    return new Response(
      JSON.stringify({ error }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
