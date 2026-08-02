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
        JSON.stringify({ error: 'Authentication required.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 1. Authenticate caller strictly using JWT token to get their own user ID
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt)

    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session. Please log in again.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userId = userData.user.id
    console.log(`[delete-account] Processing permanent account deletion for user: ${userId} (${userData.user.email})`)

    // 2. Remove user records from public tables
    await supabaseAdmin.from('profiles').delete().eq('id', userId)
    await supabaseAdmin.from('user_licenses').delete().eq('user_id', userId)

    // 3. Delete user completely from auth.users using Admin API
    const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId)

    if (deleteErr) {
      console.error(`[delete-account] Error deleting user ${userId}:`, deleteErr)
      return new Response(
        JSON.stringify({ error: `Failed to delete user account: ${deleteErr.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[delete-account] User ${userId} successfully deleted.`)

    return new Response(
      JSON.stringify({ success: true, message: 'Account permanently deleted.' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[delete-account] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal server error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
