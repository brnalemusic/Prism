-- Route every privileged Discord operation through a JWT-verifying Edge
-- Function. The database RPCs below are callable only with the service role.

create or replace function private.is_discord_worker()
returns boolean
language sql
stable
set search_path = ''
as $function$
  select coalesce((select auth.role()), '') = 'service_role'
    or coalesce(
      (select auth.jwt()) -> 'app_metadata' ->> 'discord_worker',
      'false'
    ) = 'true';
$function$;
revoke all on function private.is_discord_worker()
  from public, anon, authenticated;
drop function if exists public.discord_issue_link_challenge(uuid);
drop function if exists public.discord_confirm_link(uuid);
drop function if exists public.discord_revoke_link();
create or replace function private.issue_discord_link_challenge(
  p_user_id uuid,
  p_installation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_random bytea := extensions.gen_random_bytes(4);
  v_code text;
  v_salt bytea := extensions.gen_random_bytes(16);
  v_pepper text;
  v_challenge_id uuid;
  v_expires_at timestamptz := clock_timestamp() + interval '5 minutes';
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  if not exists (
    select 1
    from public.prism_installations
    where id = p_installation_id
      and user_id = p_user_id
      and status = 'active'
  ) then
    raise exception 'Active installation not found' using errcode = '42501';
  end if;

  select decrypted_secret
  into strict v_pepper
  from vault.decrypted_secrets
  where name = 'discord_link_pepper';

  v_code := lpad((
    (
      get_byte(v_random, 0) * 16777216
      + get_byte(v_random, 1) * 65536
      + get_byte(v_random, 2) * 256
      + get_byte(v_random, 3)
    ) % 1000000
  )::text, 6, '0');

  update public.discord_link_challenges
  set state = 'cancelled'
  where user_id = p_user_id and state = 'pending';

  insert into public.discord_link_challenges (
    user_id,
    installation_id,
    code_hash,
    salt,
    expires_at
  ) values (
    p_user_id,
    p_installation_id,
    extensions.digest(
      convert_to(v_code, 'utf8')
      || v_salt
      || convert_to(v_pepper, 'utf8'),
      'sha256'
    ),
    v_salt,
    v_expires_at
  )
  returning id into v_challenge_id;

  insert into public.discord_control_audit (
    event_code,
    actor_type,
    actor_id,
    subject_id
  ) values (
    'link_challenge_issued',
    'user',
    p_user_id::text,
    v_challenge_id::text
  );

  return jsonb_build_object(
    'challenge_id', v_challenge_id,
    'code', v_code,
    'expires_at', v_expires_at
  );
end
$function$;
revoke all on function private.issue_discord_link_challenge(uuid, uuid)
  from public, anon, authenticated;
create or replace function public.discord_edge_issue_link_challenge(
  p_user_id uuid,
  p_installation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Service authorization required' using errcode = '42501';
  end if;

  return private.issue_discord_link_challenge(p_user_id, p_installation_id);
end
$function$;
revoke all on function public.discord_edge_issue_link_challenge(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.discord_edge_issue_link_challenge(uuid, uuid)
  to service_role;
create or replace function public.discord_edge_confirm_link(
  p_user_id uuid,
  p_link_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_link public.discord_cloud_links%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Service authorization required' using errcode = '42501';
  end if;

  update public.discord_cloud_links
  set
    status = 'active',
    confirmed_at = clock_timestamp(),
    last_active_at = clock_timestamp()
  where id = p_link_id
    and user_id = p_user_id
    and status = 'pending_desktop_confirmation'
  returning * into v_link;

  if not found then
    return jsonb_build_object('success', false, 'error', 'pending_link_not_found');
  end if;

  insert into public.discord_control_audit (
    event_code,
    actor_type,
    actor_id,
    subject_id
  ) values (
    'link_desktop_confirmed',
    'user',
    p_user_id::text,
    v_link.id::text
  );

  return jsonb_build_object('success', true, 'status', 'active');
end
$function$;
revoke all on function public.discord_edge_confirm_link(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.discord_edge_confirm_link(uuid, uuid)
  to service_role;
create or replace function public.discord_edge_revoke_link(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Service authorization required' using errcode = '42501';
  end if;

  update public.discord_cloud_links
  set status = 'revoked', revoked_at = clock_timestamp()
  where user_id = p_user_id and status <> 'revoked';

  update public.discord_queue_tickets
  set state = 'released', finished_at = clock_timestamp(), updated_at = clock_timestamp()
  where user_id = p_user_id and state in ('queued', 'active');
end
$function$;
revoke all on function public.discord_edge_revoke_link(uuid)
  from public, anon, authenticated;
grant execute on function public.discord_edge_revoke_link(uuid)
  to service_role;
-- This read-only status RPC needs no elevated privileges because every source
-- table is already constrained by RLS to the signed-in user.
create or replace function public.get_user_ai_usage_status()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := clock_timestamp();
  v_usage public.user_ai_usage%rowtype;
  v_tier text;
  v_max_5h integer;
  v_max_7d integer;
  v_count_5h integer := 0;
  v_count_7d integer := 0;
  v_reset_5h integer := 0;
  v_reset_7d integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_tier := case when exists (
    select 1
    from public.user_licenses
    where user_id = v_user_id
      and status = 'active'
      and (expires_at is null or expires_at > v_now)
      and plan_id like 'enterprise%'
  ) then 'enterprise' else 'free' end;

  select max_5h, max_7d
  into v_max_5h, v_max_7d
  from public.ai_rate_limits
  where tier = v_tier;

  if not found then
    v_tier := 'free';
    v_max_5h := 20;
    v_max_7d := 120;
  end if;

  select * into v_usage
  from public.user_ai_usage
  where user_id = v_user_id;

  if found then
    if v_now < v_usage.window_5h_start + interval '5 hours' then
      v_count_5h := v_usage.count_5h;
      v_reset_5h := greatest(0, floor(extract(epoch from (
        v_usage.window_5h_start + interval '5 hours' - v_now
      )))::integer);
    end if;

    if v_now < v_usage.window_1w_start + interval '7 days' then
      v_count_7d := v_usage.count_1w;
      v_reset_7d := greatest(0, floor(extract(epoch from (
        v_usage.window_1w_start + interval '7 days' - v_now
      )))::integer);
    end if;
  end if;

  return jsonb_build_object(
    'tier', v_tier,
    'count_5h', v_count_5h,
    'count_1w', v_count_7d,
    'remaining_5h', greatest(0, v_max_5h - v_count_5h),
    'remaining_1w', greatest(0, v_max_7d - v_count_7d),
    'max_5h', v_max_5h,
    'max_1w', v_max_7d,
    'reset_5h_seconds', v_reset_5h,
    'reset_1w_seconds', v_reset_7d
  );
end
$function$;
revoke all on function public.get_user_ai_usage_status() from public, anon;
grant execute on function public.get_user_ai_usage_status() to authenticated;
do $worker_privileges$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'discord_worker_%'
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      v_function
    );
    execute format('grant execute on function %s to service_role', v_function);
  end loop;
end
$worker_privileges$;
create policy pending_checkout_sessions_deny_clients
on public.pending_checkout_sessions
for all to anon, authenticated
using (false)
with check (false);
create policy prism_api_keys_deny_clients
on public.prism_api_keys
for all to anon, authenticated
using (false)
with check (false);
create policy discord_link_attempts_deny_clients
on public.discord_link_attempts
for all to anon, authenticated
using (false)
with check (false);
create policy discord_outbound_idempotency_deny_clients
on public.discord_outbound_idempotency
for all to anon, authenticated
using (false)
with check (false);
create policy discord_interaction_states_deny_clients
on public.discord_interaction_states
for all to anon, authenticated
using (false)
with check (false);
create policy discord_worker_instances_deny_clients
on public.discord_worker_instances
for all to anon, authenticated
using (false)
with check (false);
create policy discord_control_audit_deny_clients
on public.discord_control_audit
for all to anon, authenticated
using (false)
with check (false);
drop index if exists public.user_licenses_user_id_idx;
create index discord_cloud_preferences_chat_model_id_idx
  on public.discord_cloud_preferences (chat_model_id);
create index discord_cloud_preferences_voice_model_id_idx
  on public.discord_cloud_preferences (voice_model_id);
create index discord_link_challenges_installation_id_idx
  on public.discord_link_challenges (installation_id);
create index discord_outbound_idempotency_session_id_idx
  on public.discord_outbound_idempotency (session_id);
create index discord_session_index_model_id_idx
  on public.discord_session_index (model_id);
create index discord_usage_periods_plan_tier_idx
  on public.discord_usage_periods (plan_tier);
