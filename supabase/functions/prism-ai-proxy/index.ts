import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')

    if (!jwt) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to access Prism Cloud models.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // 1. Verify user JWT token
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt)
    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session. Please log in again.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userId = userData.user.id

    // 2. Check & increment rate limit via RPC
    const { data: usageResult, error: usageErr } = await supabase.rpc('check_and_increment_ai_usage', {
      p_user_id: userId
    })

    if (usageErr) {
      console.error('[prism-ai-proxy] RPC usage check error:', usageErr)
      return new Response(
        JSON.stringify({ error: 'Failed to process account rate limit.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!usageResult?.allowed) {
      // Use server-returned limits in the message — never hardcoded values
      const max5h = usageResult?.max_5h ?? '?'
      const max7d = usageResult?.max_7d ?? '?'
      const tier  = usageResult?.tier ?? 'free'

      const reasonMsg = usageResult?.reason === '5h_limit_exceeded'
        ? `Prism Cloud quota limit reached (${max5h} requests per 5 hours for ${tier} tier). Please try again later.`
        : `Prism Cloud weekly quota limit reached (${max7d} requests per 7 days for ${tier} tier). Please try again later.`

      return new Response(
        JSON.stringify({ error: reasonMsg, limitExceeded: true, usage: usageResult }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3. Retrieve active Gemini API keys from secure database
    const { data: keys, error: keysErr } = await supabase
      .from('prism_api_keys')
      .select('key_value')
      .eq('is_active', true)

    if (keysErr || !keys || keys.length === 0) {
      console.error('[prism-ai-proxy] Error retrieving API keys:', keysErr)
      return new Response(
        JSON.stringify({ error: 'Prism Cloud service is currently unavailable. No API key found.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Shuffle available keys to balance load and provide seamless fallback
    const availableKeys = keys.map((k) => k.key_value)
    const shuffledKeys = [...availableKeys].sort(() => Math.random() - 0.5)

    // 4. Parse incoming OpenAI-compatible request payload
    const bodyPayload = await req.json()

    // Pass through exact model requested by user
    let modelId = bodyPayload.model || 'models/gemini-3-flash-preview'
    bodyPayload.model = modelId

    // 5. Target endpoint
    const targetEndpoint = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

    let lastErrorStatus = 500
    let lastErrorText = ''

    // Attempt request with automatic fallback across all 18 keys if rate limit / error occurs
    for (const key of shuffledKeys) {
      try {
        const geminiRes = await fetch(targetEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify(bodyPayload)
        })

        if (geminiRes.ok) {
          // Success! Return SSE stream back to client
          return new Response(geminiRes.body, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': geminiRes.headers.get('Content-Type') || 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            }
          })
        }

        // Key returned error (e.g. 429 rate limit or 500) -> Log and fallback to next key
        lastErrorStatus = geminiRes.status
        lastErrorText = await geminiRes.text().catch(() => '')
        console.warn(`[prism-ai-proxy] Key returned status ${geminiRes.status}. Retrying next API key...`)
      } catch (fetchErr: any) {
        console.warn(`[prism-ai-proxy] Key request failed: ${fetchErr?.message}. Retrying next API key...`)
        lastErrorText = fetchErr?.message || 'Network fetch error'
      }
    }

    // If all keys were exhausted and failed
    console.error(`[prism-ai-proxy] All ${shuffledKeys.length} API keys failed. Last status: ${lastErrorStatus}`)
    return new Response(
      JSON.stringify({ error: `Provider API Error ${lastErrorStatus}: All API keys exhausted. ${lastErrorText}` }),
      { status: lastErrorStatus, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[prism-ai-proxy] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal proxy server error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
