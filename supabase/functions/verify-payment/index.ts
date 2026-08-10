import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function parseStoredPayload(licenseKey: string): Record<string, unknown> | null {
  const [, payloadBase64] = licenseKey.split('.')
  if (!payloadBase64) return null

  try {
    const normalized = payloadBase64.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(atob(padded)) as Record<string, unknown>
  } catch {
    return null
  }
}

function getAuthenticatedUser(req: Request): { id: string; email?: string; metadata?: Record<string, unknown> } | null {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const payloadBase64 = jwt.split('.')[1]
  if (!payloadBase64) return null

  try {
    const normalized = payloadBase64.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded)) as { sub?: string; email?: string; user_metadata?: Record<string, unknown> }
    return claims.sub ? { id: claims.sub, email: claims.email, metadata: claims.user_metadata } : null
  } catch {
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const user = getAuthenticatedUser(req)
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { session_id, plan_id } = await req.json()
    if (!session_id || !plan_id) {
      return new Response(
        JSON.stringify({ error: 'session_id and plan_id are required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: pendingSession, error: pendingError } = await supabase
      .from('pending_checkout_sessions')
      .select('plan_id, status, user_id')
      .eq('session_id', session_id)
      .maybeSingle()

    if (pendingError || !pendingSession) {
      return new Response(
        JSON.stringify({ error: 'Checkout session was not created for this Prism account.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (pendingSession.user_id !== user.id || pendingSession.plan_id !== plan_id) {
      return new Response(
        JSON.stringify({ error: 'This checkout session belongs to a different Prism account.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (pendingSession.status === 'activated') {
      const { data: existingLicense, error: existingLicenseError } = await supabase
        .from('user_licenses')
        .select('license_key')
        .eq('stripe_session_id', session_id)
        .eq('user_id', user.id)
        .maybeSingle()

      const payload = !existingLicenseError && existingLicense
        ? parseStoredPayload(existingLicense.license_key)
        : null

      if (payload) {
        return new Response(
          JSON.stringify({ success: true, payload, already_activated: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ error: 'This payment was already processed. Please contact Prism support.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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

    if (stripeSession.payment_status !== 'paid') {
      return new Response(
        JSON.stringify({
          error: `Payment not completed. Current status: "${stripeSession.payment_status}". Please complete checkout first.`,
        }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (
      (stripeSession.client_reference_id && stripeSession.client_reference_id !== user.id) ||
      (stripeSession.metadata?.user_id && stripeSession.metadata.user_id !== user.id) ||
      (stripeSession.metadata?.plan_id && stripeSession.metadata.plan_id !== plan_id)
    ) {
      return new Response(
        JSON.stringify({ error: 'Stripe session metadata does not match this Prism account.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: plan, error: planError } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('id', plan_id)
      .single()

    if (planError || !plan) {
      return new Response(
        JSON.stringify({ error: 'Plan not found.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const durationDays = parseInt(stripeSession.metadata?.duration_days ?? String(plan.duration_days ?? 30), 10)
    const resolvedEmail = user.email ?? stripeSession.customer_details?.email
    if (!resolvedEmail) {
      return new Response(
        JSON.stringify({ error: 'The authenticated account does not have an email address.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const metadataCompany = typeof user.metadata?.company_name === 'string'
      ? user.metadata.company_name.trim()
      : ''
    const resolvedCompany = metadataCompany || resolvedEmail.split('@')[0] || 'Enterprise Licensee'
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
    const payloadBase64 = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    const { error: licenseError } = await supabase.from('user_licenses').insert({
      user_id: user.id,
      license_id: licenseId,
      plan_id: plan.id,
      license_key: `PRISM-ENTERPRISE.${payloadBase64}.PENDING_SIGNATURE`,
      status: 'active',
      issued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      stripe_session_id: session_id,
      stripe_payment_intent_id: stripeSession.payment_intent ?? null,
      user_email: resolvedEmail,
      company_name: resolvedCompany,
    })

    if (licenseError) throw licenseError

    const { error: activateError } = await supabase
      .from('pending_checkout_sessions')
      .update({ status: 'activated', activated_at: now.toISOString() })
      .eq('session_id', session_id)
      .eq('user_id', user.id)
      .eq('status', 'pending')

    if (activateError) throw activateError

    return new Response(
      JSON.stringify({
        success: true,
        payload,
        duration_days: durationDays,
        payment_intent_id: stripeSession.payment_intent ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[verify-payment] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal server error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
