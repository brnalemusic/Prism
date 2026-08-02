import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const SUCCESS_URL = 'https://jfqyqkkdmoqdpejzxdhd.supabase.co/functions/v1/payment-success'
const CANCEL_URL = 'https://jfqyqkkdmoqdpejzxdhd.supabase.co/functions/v1/payment-cancel'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { plan_id, email } = await req.json()

    if (!plan_id) {
      return new Response(
        JSON.stringify({ error: 'plan_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
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
    params.append('metadata[plan_id]', plan.id)
    params.append('metadata[duration_days]', String(plan.duration_days ?? 30))

    if (email?.trim()) {
      params.append('customer_email', email.trim())
    }

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
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

    // Save pending session to Supabase for later verification
    await supabase.from('pending_checkout_sessions').upsert({
      session_id: session.id,
      plan_id: plan.id,
      user_email: email ?? null,
      status: 'pending',
    })

    return new Response(
      JSON.stringify({ url: session.url, session_id: session.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[create-checkout-session] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal server error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
