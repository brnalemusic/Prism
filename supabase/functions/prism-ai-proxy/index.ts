import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const PRISM_CLOUD_MODELS = new Set(['gemini-3.1-flash-lite', 'gemini-3-flash-preview'])
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-prism-skip-increment, x-goog-api-key, x-goog-api-client'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const requestUrl = new URL(req.url)
    const isWarmup = requestUrl.pathname.endsWith('/warmup')
    const isUsageStatus = requestUrl.pathname.endsWith('/usage')
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
        status: 405,
        headers: { ...corsHeaders, Allow: 'POST, OPTIONS', 'Content-Type': 'application/json' }
      })
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')

    if (!jwt) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to access Prism Cloud models.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 1. Verify user JWT token & email confirmation
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt)
    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session. Please log in again.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userId = userData.user.id

    // Usage status is read through this authenticated endpoint so the client
    // cannot choose another user's ID in a direct database RPC request.
    if (isUsageStatus) {
      const { data: statusResult, error: statusErr } = await supabase.rpc(
        'get_user_ai_usage_status',
        { p_user_id: userId }
      )

      if (statusErr || !statusResult) {
        console.error('[prism-ai-proxy] RPC usage status error:', statusErr)
        return new Response(JSON.stringify({ error: 'Failed to load account usage.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        })
      }

      return new Response(JSON.stringify(statusResult), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      })
    }

    // Warm-up is authenticated but deliberately non-billable. It primes the
    // Edge Function and the upstream Gemini route before the first AI prompt.
    if (isWarmup) {
      const { data: keys, error: keysErr } = await supabase
        .from('prism_api_keys')
        .select('key_value')
        .eq('is_active', true)
        .limit(1)

      if (keysErr || !keys?.[0]?.key_value) {
        console.error('[prism-ai-proxy] Warm-up key lookup failed:', keysErr)
        return new Response(JSON.stringify({ error: 'Prism Cloud service is currently unavailable.' }), {
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
          console.warn(`[prism-ai-proxy] Warm-up upstream returned ${upstream.status}`)
          return new Response(JSON.stringify({ error: 'Prism Cloud warm-up failed.' }), {
            status: 503,
            headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
          })
        }
      } catch (err: any) {
        console.warn('[prism-ai-proxy] Warm-up upstream error:', err?.message)
        return new Response(JSON.stringify({ error: 'Prism Cloud warm-up failed.' }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        })
      }

      return new Response(null, {
        status: 204,
        headers: { ...corsHeaders, 'Cache-Control': 'no-store', Connection: 'keep-alive' }
      })
    }

    // 2. Check rate limit — skip increment for non-billable requests (e.g. title generation)
    const skipIncrement = req.headers.get('X-Prism-Skip-Increment') === 'true'

    if (skipIncrement) {
      // Read-only quota check: verify user is within limits without incrementing
      const { data: statusResult, error: statusErr } = await supabase.rpc(
        'get_user_ai_usage_status',
        {
          p_user_id: userId
        }
      )

      if (statusErr) {
        console.error('[prism-ai-proxy] RPC usage status check error:', statusErr)
        return new Response(JSON.stringify({ error: 'Failed to verify account status.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Block non-billable requests too when user has zero quota remaining
      const remaining5h = statusResult?.remaining_5h ?? 0
      const remaining1w = statusResult?.remaining_1w ?? 0
      if (remaining5h <= 0 || remaining1w <= 0) {
        return new Response(
          JSON.stringify({ error: 'Prism Cloud quota limit reached.', limitExceeded: true }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } else {
      // Normal billable request: check AND increment usage counter
      const { data: usageResult, error: usageErr } = await supabase.rpc(
        'check_and_increment_ai_usage',
        {
          p_user_id: userId
        }
      )

      if (usageErr) {
        console.error('[prism-ai-proxy] RPC usage check error:', usageErr)
        return new Response(JSON.stringify({ error: 'Failed to process account rate limit.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      if (!usageResult?.allowed) {
        // Use server-returned limits in the message — never hardcoded values
        const max5h = usageResult?.max_5h ?? '?'
        const max7d = usageResult?.max_7d ?? '?'
        const tier = usageResult?.tier ?? 'free'

        const reasonMsg =
          usageResult?.reason === '5h_limit_exceeded'
            ? `Prism Cloud quota limit reached (${max5h} requests per 5 hours for ${tier} tier). Please try again later.`
            : `Prism Cloud weekly quota limit reached (${max7d} requests per 7 days for ${tier} tier). Please try again later.`

        return new Response(
          JSON.stringify({ error: reasonMsg, limitExceeded: true, usage: usageResult }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // 3. Retrieve active Gemini API keys from secure database
    const { data: keys, error: keysErr } = await supabase
      .from('prism_api_keys')
      .select('key_value')
      .eq('is_active', true)

    if (keysErr || !keys || keys.length === 0) {
      console.error('[prism-ai-proxy] Error retrieving API keys:', keysErr)
      return new Response(
        JSON.stringify({
          error: 'Prism Cloud service is currently unavailable. No API key found.'
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Shuffle available keys to balance load and provide seamless fallback
    const availableKeys = keys.map((k) => k.key_value)
    const shuffledKeys = [...availableKeys].sort(() => Math.random() - 0.5)

    // 4. Accept the native Gemini GenerateContent request emitted by @google/genai.
    const bodyPayload = await req.json()
    const nativeRoute = requestUrl.pathname.match(
      /\/models\/([a-zA-Z0-9._/-]+):(streamGenerateContent|generateContent)$/
    )
    if (!nativeRoute) {
      return new Response(
        JSON.stringify({
          error: 'Prism Cloud requires the native Gemini GenerateContent protocol.'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const rawModelId = nativeRoute[1].replace(/^models\//, '')
    if (!/^[a-zA-Z0-9._/-]+$/.test(rawModelId) || rawModelId.includes('..')) {
      return new Response(JSON.stringify({ error: 'Invalid Gemini model identifier.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    if (!PRISM_CLOUD_MODELS.has(rawModelId)) {
      return new Response(
        JSON.stringify({ error: 'This Gemini model is not available through Prism Cloud.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const action = nativeRoute[2]
    const streamQuery = action === 'streamGenerateContent' ? '?alt=sse' : ''
    const targetEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${rawModelId}:${action}${streamQuery}`

    let lastErrorText = ''
    let keyIndex = 0
    const failureDetails: Array<{ index: number; status: number; reason: string }> = []

    // Attempt request with automatic fallback across all keys if rate limit / error occurs
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
          // Success! Return SSE stream back to client
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

        // Key returned error (e.g. 429 rate limit or 500) -> Log full error body and fallback
        lastErrorText = await geminiRes.text().catch(() => '')
        const truncatedBody =
          lastErrorText.length > 500 ? lastErrorText.slice(0, 500) + '...' : lastErrorText
        console.warn(
          `[prism-ai-proxy] Key ${keyIndex}/${shuffledKeys.length} failed | Status: ${geminiRes.status} | Body: ${truncatedBody}`
        )
        failureDetails.push({ index: keyIndex, status: geminiRes.status, reason: truncatedBody })

        // Invalid native payloads are deterministic and must be returned to the
        // client so the tool loop can correct them. Rotating keys cannot help.
        if (geminiRes.status >= 400 && geminiRes.status < 500 && geminiRes.status !== 429) {
          return new Response(
            lastErrorText || JSON.stringify({ error: 'Invalid Gemini request.' }),
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
        lastErrorText = fetchErr?.message || 'Network fetch error'
      }
    }

    // All keys exhausted — log detailed failure breakdown
    const statusCounts = failureDetails.reduce(
      (acc, d) => {
        acc[d.status] = (acc[d.status] || 0) + 1
        return acc
      },
      {} as Record<number, number>
    )
    console.error(
      `[prism-ai-proxy] ALL ${shuffledKeys.length} keys failed | Model: ${rawModelId} | Breakdown: ${JSON.stringify(statusCounts)}`
    )
    console.error(`[prism-ai-proxy] Last error body: ${lastErrorText.slice(0, 1000)}`)

    return new Response(
      JSON.stringify({
        error:
          'Prism Cloud servers are temporarily overloaded. Please try again in a few minutes or use your own API key.',
        serverOverloaded: true
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[prism-ai-proxy] Unexpected error:', err)
    return new Response(JSON.stringify({ error: err?.message || 'Internal proxy server error.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
