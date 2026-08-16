import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ---------------------------------------------------------------------------
// Private Upstream Mapping (STRICTLY INTERNAL TO TRUSTED BACKEND)
// ---------------------------------------------------------------------------
const ARCADIA_UPSTREAM_MAP: Record<string, string> = {
  'prism-ai/arcadia-1.0-mini': 'gemini-3.1-flash-lite',
  'prism-ai/arcadia-1.0-flash': 'gemini-3-flash-preview',
  'prism-ai/arcadia-1.0-pro': 'gemma-4-31b-it',
  'prism-ai/arcadia-1.1-flash': 'gemini-3.5-flash'
}

const PUBLIC_ARCADIA_MODELS = [
  {
    id: 'prism-ai/arcadia-1.0-mini',
    object: 'model',
    created: 1786800000,
    owned_by: 'prism-ai',
    name: 'Arcadia-1.0 Mini',
    description: 'High-Throughput Lightweight Model'
  },
  {
    id: 'prism-ai/arcadia-1.0-flash',
    object: 'model',
    created: 1786800000,
    owned_by: 'prism-ai',
    name: 'Arcadia-1.0 Flash',
    description: 'Primary High-Speed Reasoning Model'
  },
  {
    id: 'prism-ai/arcadia-1.0-pro',
    object: 'model',
    created: 1786800000,
    owned_by: 'prism-ai',
    name: 'Arcadia-1.0 Pro',
    description: 'Deep Reasoning & Advanced Synthesis'
  },
  {
    id: 'prism-ai/arcadia-1.1-flash',
    object: 'model',
    created: 1786800000,
    owned_by: 'prism-ai',
    name: 'Arcadia-1.1 Flash',
    description: 'Next-Gen Enterprise Reasoning Engine'
  }
]

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
          headers: { 'x-goog-api-key': keys[0].key_value },
          signal: req.signal
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

    // Validate against public Arcadia allowlist (Reject direct upstream names like gemini-*)
    if (!(rawModelId in ARCADIA_UPSTREAM_MAP)) {
      return new Response(
        JSON.stringify({
          error: 'Model not supported. Please use an official Prism Arcadia model identifier.',
          code: 'MODEL_NOT_SUPPORTED'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 6. Enterprise Entitlement Validation in Proxy (Defense in Depth)
    if (rawModelId === 'prism-ai/arcadia-1.1-flash') {
      const nowIso = new Date().toISOString()
      const { data: entLicenses, error: entErr } = await supabase
        .from('user_licenses')
        .select('id, plan_id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .like('plan_id', 'enterprise%')
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .limit(1)

      if (entErr) {
        console.error('[prism-ai-proxy] Error checking Enterprise license:', entErr)
      }

      const hasEnterpriseLicense = Boolean(entLicenses && entLicenses.length > 0)
      if (!hasEnterpriseLicense) {
        return new Response(
          JSON.stringify({
            error: 'Arcadia-1.1 Flash is exclusive to Enterprise subscribers.',
            code: 'ENTERPRISE_REQUIRED',
            enterpriseRequired: true
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

      const rawList: any[] = Array.isArray(statusResult) ? statusResult : [statusResult]
      const modelMetric = rawList.find((m) => m.model_id === rawModelId) || rawList[0]
      const remaining5h = modelMetric?.remaining_5h ?? 0
      const remaining1w = modelMetric?.remaining_1w ?? 0

      if (remaining5h <= 0 || remaining1w <= 0) {
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
        if (usageResult?.reason === 'enterprise_required') {
          return new Response(
            JSON.stringify({
              error: 'Arcadia-1.1 Flash is exclusive to Enterprise subscribers.',
              code: 'ENTERPRISE_REQUIRED',
              enterpriseRequired: true
            }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        const max5h = usageResult?.max_5h ?? '?'
        const max7d = usageResult?.max_7d ?? '?'
        const tier = usageResult?.tier ?? 'free'

        const reasonMsg =
          usageResult?.reason === '5h_limit_exceeded'
            ? `Prism Cloud quota limit reached (${max5h} requests per 5 hours for ${tier} tier). Please try again later.`
            : `Prism Cloud weekly quota limit reached (${max7d} requests per 7 days for ${tier} tier). Please try again later.`

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

    // 8. Resolve Private Upstream Model
    const upstreamModelId = ARCADIA_UPSTREAM_MAP[rawModelId]
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

    const bodyPayload = await req.json()
    const action = nativeRoute[2]
    const streamQuery = action === 'streamGenerateContent' ? '?alt=sse' : ''
    const targetEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${upstreamModelId}:${action}${streamQuery}`

    let keyIndex = 0
    const failureDetails: Array<{ index: number; status: number; reason: string }> = []

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
          signal: req.signal
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

        const errText = await geminiRes.text().catch(() => '')
        const truncated = errText.length > 500 ? errText.slice(0, 500) + '...' : errText
        console.warn(
          `[prism-ai-proxy] Key ${keyIndex}/${shuffledKeys.length} failed | Status: ${geminiRes.status} | Details: ${truncated}`
        )
        failureDetails.push({ index: keyIndex, status: geminiRes.status, reason: truncated })

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
      } catch (fetchErr: any) {
        console.warn(
          `[prism-ai-proxy] Key ${keyIndex}/${shuffledKeys.length} network error: ${fetchErr?.message}`
        )
        failureDetails.push({
          index: keyIndex,
          status: 0,
          reason: fetchErr?.message || 'Network error'
        })
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
      `[prism-ai-proxy] All keys exhausted | Public: ${rawModelId} | Upstream: ${upstreamModelId} | Breakdown: ${JSON.stringify(statusCounts)}`
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
  } catch (err: any) {
    console.error('[prism-ai-proxy] Unexpected error:', err)
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
