import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { action, email, password, fullName, companyName, accountType } = await req.json()

    if (!email) {
      return new Response(
        JSON.stringify({ success: false, error: 'Email is required.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Server misconfiguration.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    // Action 1: Confirm user in auth.users so Supabase Auth never blocks login with "Email not confirmed"
    if (action === 'confirm-unconfirmed-user') {
      const { data: usersData, error: listErr } = await supabaseAdmin.auth.admin.listUsers()
      if (!listErr && usersData?.users) {
        const targetUser = usersData.users.find(u => u.email?.toLowerCase() === email.trim().toLowerCase())
        if (targetUser) {
          await supabaseAdmin.auth.admin.updateUserById(targetUser.id, { email_confirm: true })
          return new Response(
            JSON.stringify({ success: true }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
          )
        }
      }
      return new Response(
        JSON.stringify({ success: false, error: 'User not found.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      )
    }

    // Action 2: Standard Admin Create User (sets email_confirm: true so login is never blocked)
    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim(),
      password: password,
      email_confirm: true,
      user_metadata: {
        full_name: (fullName || '').trim(),
        company_name: (companyName || '').trim(),
        account_type: accountType || (companyName ? 'enterprise' : 'individual')
      }
    })

    if (createErr) {
      const isAlreadyRegistered = createErr.message.toLowerCase().includes('already') || createErr.message.toLowerCase().includes('exists')
      if (isAlreadyRegistered) {
        // Ensure user is email_confirmed in auth.users so they can sign in freely
        const { data: usersData } = await supabaseAdmin.auth.admin.listUsers()
        const targetUser = usersData?.users?.find(u => u.email?.toLowerCase() === email.trim().toLowerCase())
        if (targetUser) {
          await supabaseAdmin.auth.admin.updateUserById(targetUser.id, { email_confirm: true })
        }
        return new Response(
          JSON.stringify({ success: false, isAlreadyRegistered: true, error: 'An account with this email already exists. Please sign in.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
      return new Response(
        JSON.stringify({ success: false, error: createErr.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    return new Response(
      JSON.stringify({ success: true, user: newUser.user }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err?.message || 'Unexpected server error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
