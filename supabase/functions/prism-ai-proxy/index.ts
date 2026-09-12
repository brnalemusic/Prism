import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ---------------------------------------------------------------------------
// Private upstream routing is held only in the Edge Function Secret
// ARCADIA_UPSTREAM_MAP_JSON. It must never be committed to source control.
// ---------------------------------------------------------------------------
const ARCADIA_UPSTREAM_MAP_SECRET = 'ARCADIA_UPSTREAM_MAP_JSON'

function loadArcadiaUpstreamMap(): Record<string, string> | null {
  const raw = Deno.env.get(ARCADIA_UPSTREAM_MAP_SECRET)
  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

    const entries = Object.entries(parsed).filter(
      ([publicModelId, upstreamModelId]) =>
        publicModelId.startsWith('prism-ai/') && typeof upstreamModelId === 'string' && upstreamModelId.length > 0
    )
    return entries.length > 0 ? Object.fromEntries(entries) : null
  } catch {
    return null
  }
}

const PUBLIC_ARCADIA_MODELS = [
  {
    id: 'prism-ai/arcadia-1-1-mini',
    object: 'model',
    created: 1786800000,
    owned_by: 'prism-ai',
    name: 'Arcadia 1.1 Mini',
    description: 'High-Throughput Lightweight Model',
    access_tier: 'free'
  },
  {
    id: 'prism-ai/arcadia-1-1-small',
    object: 'model',
    created: 1786800000,
    owned_by: 'prism-ai',
    name: 'Arcadia 1.1 Small',
    description: 'Low-Latency General Model',
    access_tier: 'free'
  },
  {
    id: 'prism-ai/arcadia-1-1-flash-09-11',
    object: 'model',
    created: 1786800000,
    owned_by: 'prism-ai',
    name: 'Arcadia 1.1 Flash (09/11)',
    description: 'Primary High-Speed Reasoning Model',
    access_tier: 'free'
  },
  {
    id: 'prism-ai/arcadia-1-1-pro',
    object: 'model',
    created: 1786800000,
    owned_by: 'prism-ai',
    name: 'Arcadia 1.1 Pro',
    description: 'Deep Reasoning & Advanced Synthesis',
    access_tier: 'paid'
  },
  {
    id: 'prism-ai/arcadia-1-2-flash-small',
    object: 'model',
    created: 1786800000,
    owned_by: 'prism-ai',
    name: 'Arcadia 1.2 Flash S',
    description: 'Fast Paid Model',
    access_tier: 'paid'
  },
  {
    id: 'prism-ai/arcadia-1-2-flash-giga',
    object: 'model',
    created: 1786800000,
    owned_by: 'prism-ai',
    name: 'Arcadia 1.2 Flash G',
    description: 'High-Capacity Paid Model',
    access_tier: 'paid'
  },
  {
    id: 'prism-ai/arcadia-bot-0-8-experimental',
    object: 'model',
    created: 1786800000,
    owned_by: 'prism-ai',
    name: 'Arcadia Bot 0.8',
    description: 'Experimental Robotics Model',
    access_tier: 'paid'
  }
]

const PAID_ARCADIA_MODEL_IDS = new Set(
  PUBLIC_ARCADIA_MODELS.filter((model) => model.access_tier === 'paid').map((model) => model.id)
)
const PUBLIC_ARCADIA_MODEL_IDS = new Set(PUBLIC_ARCADIA_MODELS.map((model) => model.id))

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
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-prism-skip-increment, x-goog-api-key, x-goog-api-client',
    'Access-Control-Max-Age': '86400'
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const requestUrl = new URL(req.url)
    const isModelsCatalog =
      req.method === 'GET' &&
      (requestUrl.pathname.endsWith('/v1/models') ||
        requestUrl.pathname.endsWith('/models') ||
        requestUrl.pathname.endsWith('/v1/models/') ||
        requestUrl.pathname.endsWith('/models/'))

    // 0. Public Arcadia Models Catalog Endpoint
    if (isModelsCatalog) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: PUBLIC_ARCADIA_MODELS,
          models: PUBLIC_ARCADIA_MODELS
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        }
      )
    }

    const isWarmup = requestUrl.pathname.endsWith('/warmup')
    const isUsageStatus = requestUrl.pathname.endsWith('/usage')

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }), {
        status: 405,
        headers: { ...corsHeaders, Allow: 'GET, POST, OPTIONS', 'Content-Type': 'application/json' }
      })
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()

    if (!jwt) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to access Prism Cloud models.', code: 'AUTH_REQUIRED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 1. Verify user JWT token
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt)
    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session. Please log in again.', code: 'AUTH_REQUIRED' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userId = userData.user.id

    // 2. SERVER-SIDE ENFORCEMENT: Check Account Activation Status
    const { data: activation, error: actErr } = await supabase
      .from('account_activations')
      .select('status')
      .eq('user_id', userId)
      .maybeSingle()

    if (actErr) {
      console.error('[prism-ai-proxy] Error checking activation status:', actErr)
    }

    const isActivated = activation?.status === 'active'

    if (!isActivated) {
      return new Response(
        JSON.stringify({
          error: 'Prism Cloud models require an active account. Please activate your account in Settings.',
          code: 'ACCOUNT_INACTIVE',
          accountInactive: true
        }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        }
      )
    }

    // 3. Usage status check
    if (isUsageStatus) {
      const { data: statusResult, error: statusErr } = await supabase.rpc(
        'get_user_ai_usage_status',
        { p_user_id: userId }
      )

      if (statusErr || !statusResult) {
        console.error('[prism-ai-proxy] RPC usage status error:', statusErr)
        return new Response(JSON.stringify({ error: 'Failed to load account usage.', code: 'USAGE_ERROR' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        })
      }

      return new Response(JSON.stringify(statusResult), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      })
    }

    // 4. Warm-up
    if (isWarmup) {
      const { data: keys, error: keysErr } = await supabase
        .from('prism_api_keys')
        .select('key_value')
        .eq('is_active', true)
        .limit(1)

      if (keysErr || !keys?.[0]?.key_value) {
        console.error('[prism-ai-proxy] Warm-up key lookup failed:', keysErr)
        return new Response(JSON.stringify({ error: 'Prism Cloud service is currently unavailable.', code: 'UNAVAILABLE' }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        })
      }

      try {
        const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
          method: 'GET',
          headers: { 'x-goog-api-key': keys[0].key_value }
        })
        if (!upstream.ok) {
          console.warn(`[prism-ai-proxy] Warm-up upstream returned status ${upstream.status}`)
          return new Response(JSON.stringify({ error: 'Prism Cloud warm-up failed.', code: 'WARMUP_FAILED' }), {
            status: 503,
            headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
          })
        }
      } catch (err: any) {
        console.warn('[prism-ai-proxy] Warm-up upstream error:', err?.message)
        return new Response(JSON.stringify({ error: 'Prism Cloud warm-up failed.', code: 'WARMUP_FAILED' }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        })
      }

      return new Response(null, {
        status: 204,
        headers: { ...corsHeaders, 'Cache-Control': 'no-store', Connection: 'keep-alive' }
      })
    }

    // 5. Parse Arcadia model route
    const nativeRoute = requestUrl.pathname.match(
      /\/models\/(.+):(streamGenerateContent|generateContent)$/
    )
    if (!nativeRoute) {
      return new Response(
        JSON.stringify({
          error: 'Prism Cloud requires the native GenerateContent protocol with a valid model.',
          code: 'INVALID_ROUTE'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const rawModelId = nativeRoute[1].replace(/^models\//, '')
    if (!/^[a-zA-Z0-9._/-]+$/.test(rawModelId) || rawModelId.includes('..')) {
      return new Response(JSON.stringify({ error: 'Invalid model identifier.', code: 'INVALID_MODEL' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const arcadiaUpstreamMap = loadArcadiaUpstreamMap()
    if (!arcadiaUpstreamMap) {
      console.error('[prism-ai-proxy] Arcadia upstream routing secret is missing or invalid.')
      return new Response(
        JSON.stringify({ error: 'Prism Cloud model routing is temporarily unavailable.', code: 'ROUTING_UNAVAILABLE' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate against the server-side Arcadia allowlist before consulting the private map.
    if (!PUBLIC_ARCADIA_MODEL_IDS.has(rawModelId)) {
      return new Response(
        JSON.stringify({
          error: 'Model not supported. Please use an official Prism Arcadia model identifier.',
          code: 'MODEL_NOT_SUPPORTED'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!(rawModelId in arcadiaUpstreamMap)) {
      return new Response(
        JSON.stringify({ error: 'Internal routing configuration is unavailable.', code: 'ROUTING_ERROR' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 6. Paid entitlement validation in the proxy (defense in depth)
    let isPaidEntitled = false
    if (PAID_ARCADIA_MODEL_IDS.has(rawModelId)) {
      const nowIso = new Date().toISOString()
      const { data: entLicenses, error: entErr } = await supabase
        .from('user_licenses')
        .select('id, plan_id, type, license_key')
        .eq('user_id', userId)
        .eq('status', 'active')
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .limit(5)

      if (entErr) {
        console.error('[prism-ai-proxy] Error checking paid entitlement:', entErr)
      }

      const hasLicense = Boolean(
        entLicenses &&
        entLicenses.some((l: any) =>
          String(l.plan_id || '').toLowerCase().startsWith('enterprise') ||
          String(l.type || '').toUpperCase() === 'ENTERPRISE' ||
          String(l.license_key || '').toUpperCase().includes('ENTERPRISE')
        )
      )

      const { data: userProfile, error: profileErr } = await supabase
        .from('profiles')
        .select('account_type')
        .eq('id', userId)
        .maybeSingle()

      if (profileErr) {
        console.error('[prism-ai-proxy] Error checking user profile:', profileErr)
      }

      const pType = String(userProfile?.account_type || '').toLowerCase()
      const isProfileEnterprise = pType === 'enterprise' || pType === 'company'

      isPaidEntitled = hasLicense || isProfileEnterprise
      if (!isPaidEntitled) {
        return new Response(
          JSON.stringify({
            error: 'This Arcadia model requires an active paid subscription.',
            code: 'PAID_PLAN_REQUIRED',
            paidPlanRequired: true
          }),
          {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
          }
        )
      }
    }

    // 7. Check rate limit
    const skipIncrement = req.headers.get('X-Prism-Skip-Increment') === 'true'

    if (skipIncrement) {
      const { data: statusResult, error: statusErr } = await supabase.rpc(
        'get_user_ai_usage_status',
        { p_user_id: userId }
      )

      if (statusErr) {
        console.error('[prism-ai-proxy] RPC usage status check error:', statusErr)
        return new Response(JSON.stringify({ error: 'Failed to verify account status.', code: 'RATE_LIMIT_ERROR' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const accountMetric = Array.isArray(statusResult) ? statusResult[0] : statusResult
      const remaining24h = accountMetric?.remaining_24h ?? 0

      if (remaining24h <= 0) {
        return new Response(
          JSON.stringify({
            error: 'Prism Cloud quota limit reached.',
            code: 'RATE_LIMIT_EXCEEDED',
            limitExceeded: true
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } else {
      const { data: usageResult, error: usageErr } = await supabase.rpc(
        'check_and_increment_ai_usage',
        { p_user_id: userId, p_model: rawModelId }
      )

      if (usageErr) {
        console.error('[prism-ai-proxy] RPC usage check error:', usageErr)
        return new Response(JSON.stringify({ error: 'Failed to process account rate limit.', code: 'RATE_LIMIT_ERROR' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      if (!usageResult?.allowed) {
        if (usageResult?.reason === 'paid_plan_required') {
          return new Response(
            JSON.stringify({
              error: 'This Arcadia model requires an active paid subscription.',
              code: 'PAID_PLAN_REQUIRED',
              paidPlanRequired: true
            }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        } else {

        const max24h = usageResult?.max_24h ?? '?'
        const tier = usageResult?.tier ?? 'free'

        const reasonMsg = `Prism Cloud quota limit reached (${max24h} requests per 24 hours for ${tier} tier). Please try again later.`

        return new Response(
          JSON.stringify({
            error: reasonMsg,
            code: 'RATE_LIMIT_EXCEEDED',
            limitExceeded: true,
            usage: usageResult
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }
    }

    // 8. Resolve Private Upstream Model
    const upstreamModelId = arcadiaUpstreamMap[rawModelId]
    if (!upstreamModelId) {
      return new Response(
        JSON.stringify({ error: 'Internal routing error.', code: 'ROUTING_ERROR' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 9. Retrieve active API keys
    const { data: keys, error: keysErr } = await supabase
      .from('prism_api_keys')
      .select('key_value')
      .eq('is_active', true)

    if (keysErr || !keys || keys.length === 0) {
      console.error('[prism-ai-proxy] Error retrieving API keys:', keysErr)
      return new Response(
        JSON.stringify({
          error: 'Prism Cloud service is currently unavailable. No operational key found.',
          code: 'UNAVAILABLE'
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const availableKeys = keys.map((k) => k.key_value)
    const shuffledKeys = [...availableKeys].sort(() => Math.random() - 0.5)

    let bodyPayload: unknown
    try {
      bodyPayload = await req.json()
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON request body.', code: 'INVALID_PAYLOAD' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const action = nativeRoute[2]
    const streamQuery = action === 'streamGenerateContent' ? '?alt=sse' : ''
    const targetEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${upstreamModelId}:${action}${streamQuery}`

    let keyIndex = 0
    const failureDetails: Array<{ index: number; status: number }> = []

    for (const key of shuffledKeys) {
      keyIndex++
      try {
        const geminiRes = await fetch(targetEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key
          },
          body: JSON.stringify(bodyPayload),
        })

        if (geminiRes.ok) {
          return new Response(geminiRes.body, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': geminiRes.headers.get('Content-Type') || 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive'
            }
          })
        }

        try {
          await geminiRes.body?.cancel()
        } catch {
          // The upstream body may already be closed; the sanitized response below is authoritative.
        }
        console.warn(`[prism-ai-proxy] Key ${keyIndex}/${shuffledKeys.length} failed | Status: ${geminiRes.status}`)
        failureDetails.push({ index: keyIndex, status: geminiRes.status })

        // Client payload validation error (e.g. malformed parameters)
        if (geminiRes.status >= 400 && geminiRes.status < 500 && geminiRes.status !== 429) {
          return new Response(
            JSON.stringify({
              error: 'Invalid request format or parameters for Prism Cloud model.',
              code: 'INVALID_PAYLOAD'
            }),
            {
              status: geminiRes.status,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
          )
        }
      } catch {
        console.warn(`[prism-ai-proxy] Key ${keyIndex}/${shuffledKeys.length} network error`)
        failureDetails.push({ index: keyIndex, status: 0 })
      }
    }

    const statusCounts = failureDetails.reduce(
      (acc, d) => {
        acc[d.status] = (acc[d.status] || 0) + 1
        return acc
      },
      {} as Record<number, number>
    )
    console.error(
      `[prism-ai-proxy] All keys exhausted | Public route: ${rawModelId} | Breakdown: ${JSON.stringify(statusCounts)}`
    )

    return new Response(
      JSON.stringify({
        error:
          'Prism Cloud servers are temporarily overloaded. Please try again in a few minutes or use your own API key.',
        code: 'OVERLOADED',
        serverOverloaded: true
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch {
    console.error('[prism-ai-proxy] Unexpected proxy error')
    return new Response(
      JSON.stringify({
        error:
          'Prism Cloud service encountered an internal error. Full technical diagnostics are restricted for infrastructure abstraction and security. Prism administrators should check server logs.',
        code: 'INTERNAL_ERROR'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
