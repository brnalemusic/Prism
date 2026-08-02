import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { session_id, plan_id, email, company_name } = await req.json()

    if (!session_id || !plan_id) {
      return new Response(
        JSON.stringify({ error: 'session_id and plan_id are required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // --- Idempotency check: session already activated? ---
    const { data: existingSession } = await supabase
      .from('pending_checkout_sessions')
      .select('status, activated_at')
      .eq('session_id', session_id)
      .single()

    if (existingSession?.status === 'activated') {
      return new Response(
        JSON.stringify({ error: 'This payment session has already been used to activate a license.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- Verify payment with Stripe ---
    const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    })

    const stripeSession = await stripeRes.json()

    if (!stripeRes.ok) {
      console.error('[verify-payment] Stripe fetch error:', JSON.stringify(stripeSession))
      return new Response(
        JSON.stringify({ error: 'Could not retrieve payment session from Stripe.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- Payment status check ---
    if (stripeSession.payment_status !== 'paid') {
      return new Response(
        JSON.stringify({
          error: `Payment not completed. Current status: "${stripeSession.payment_status}". Please complete checkout first.`,
        }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- Validate plan matches session metadata ---
    const metaPlanId = stripeSession.metadata?.plan_id
    if (metaPlanId && metaPlanId !== plan_id) {
      return new Response(
        JSON.stringify({ error: 'Plan mismatch between session and request.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- Fetch plan details ---
    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('id', plan_id)
      .single()

    if (!plan) {
      return new Response(
        JSON.stringify({ error: 'Plan not found.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const durationDays: number = parseInt(stripeSession.metadata?.duration_days ?? String(plan.duration_days ?? 30), 10)
    const resolvedEmail: string = email ?? stripeSession.customer_details?.email ?? 'customer@prism.app'
    const resolvedCompany: string = company_name ?? resolvedEmail.split('@')[0] ?? 'Enterprise Licensee'

    // --- Build signed license key payload ---
    const now = new Date()
    const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000)
    const licenseId = `PRISM-${crypto.randomUUID().replace(/-/g, '').substring(0, 12).toUpperCase()}`

    const payload = {
      id: licenseId,
      licensee: resolvedCompany,
      email: resolvedEmail,
      type: 'ENTERPRISE',
      seats: parseInt(String(plan.seats ?? 1), 10),
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      plan_id: plan.id,
      stripe_session_id: session_id,
    }

    // Encode payload as base64url (no private key on Edge — the main process will sign locally)
    // We return the full payload so the Electron app can sign it with its local Ed25519 key.
    // The license_key is assembled on the main process side after receiving this payload.
    const payloadBase64 = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    // --- Save license record to Supabase ---
    const paymentIntent = stripeSession.payment_intent ?? null

    await supabase.from('user_licenses').insert({
      plan_id: plan.id,
      license_key: `PRISM-ENTERPRISE.${payloadBase64}.PENDING_SIGNATURE`,
      status: 'active',
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      stripe_session_id: session_id,
      stripe_payment_intent_id: paymentIntent,
      user_email: resolvedEmail,
      company_name: resolvedCompany,
    })

    // --- Mark session as activated (idempotency) ---
    await supabase
      .from('pending_checkout_sessions')
      .upsert({ session_id, plan_id, status: 'activated', activated_at: now.toISOString() })

    return new Response(
      JSON.stringify({
        success: true,
        payload,
        duration_days: durationDays,
        payment_intent_id: paymentIntent,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[verify-payment] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal server error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
