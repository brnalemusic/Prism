alter table public.discord_cloud_preferences
  add column if not exists gateway_mode text not null default 'cloud'
    check (gateway_mode in ('cloud', 'byok'));
create table if not exists public.discord_link_ip_rate_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  window_started_at timestamptz not null default clock_timestamp(),
  blocked_until timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.discord_link_ip_rate_limits enable row level security;
revoke all on public.discord_link_ip_rate_limits from anon, authenticated;
drop policy if exists discord_link_ip_rate_limits_deny_clients
  on public.discord_link_ip_rate_limits;
create policy discord_link_ip_rate_limits_deny_clients
on public.discord_link_ip_rate_limits
for all to anon, authenticated
using (false)
with check (false);
comment on table public.discord_link_ip_rate_limits is
  'Hashed network-origin counters for Discord link challenge issuance. Raw IP addresses and link codes are never stored.';
create or replace function private.issue_discord_link_challenge(
  p_user_id uuid,
  p_installation_id uuid,
  p_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_random bytea := extensions.gen_random_bytes(4);
  v_code text;
  v_salt bytea := extensions.gen_random_bytes(16);
  v_pepper text;
  v_challenge_id uuid;
  v_expires_at timestamptz := v_now + interval '5 minutes';
  v_installation_id uuid;
  v_ip_rate public.discord_link_ip_rate_limits%rowtype;
begin
  if p_user_id is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid link challenge request';
  end if;

  select id into v_installation_id
  from public.prism_installations
  where id = p_installation_id
    and user_id = p_user_id
    and status = 'active'
  for update;

  if v_installation_id is null then
    raise exception 'Active installation not found' using errcode = '42501';
  end if;

  if (
    select count(*)
    from public.discord_link_challenges
    where user_id = p_user_id
      and created_at >= v_now - interval '10 minutes'
  ) >= 5 then
    return jsonb_build_object(
      'success', false,
      'error', 'rate_limited',
      'retry_at', v_now + interval '10 minutes'
    );
  end if;

  insert into public.discord_link_ip_rate_limits (ip_hash)
  values (p_ip_hash)
  on conflict (ip_hash) do nothing;

  select * into strict v_ip_rate
  from public.discord_link_ip_rate_limits
  where ip_hash = p_ip_hash
  for update;

  if v_ip_rate.blocked_until is not null and v_ip_rate.blocked_until > v_now then
    return jsonb_build_object(
      'success', false,
      'error', 'rate_limited',
      'retry_at', v_ip_rate.blocked_until
    );
  end if;

  if v_ip_rate.window_started_at <= v_now - interval '10 minutes' then
    update public.discord_link_ip_rate_limits
    set
      attempt_count = 1,
      window_started_at = v_now,
      blocked_until = null,
      updated_at = v_now
    where ip_hash = p_ip_hash;
  elsif v_ip_rate.attempt_count >= 19 then
    update public.discord_link_ip_rate_limits
    set
      attempt_count = attempt_count + 1,
      blocked_until = v_now + interval '10 minutes',
      updated_at = v_now
    where ip_hash = p_ip_hash;
    return jsonb_build_object(
      'success', false,
      'error', 'rate_limited',
      'retry_at', v_now + interval '10 minutes'
    );
  else
    update public.discord_link_ip_rate_limits
    set attempt_count = attempt_count + 1, updated_at = v_now
    where ip_hash = p_ip_hash;
  end if;

  select decrypted_secret into strict v_pepper
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
    'success', true,
    'challenge_id', v_challenge_id,
    'code', v_code,
    'expires_at', v_expires_at
  );
end;
$$;
revoke all on function private.issue_discord_link_challenge(uuid, uuid, text)
  from public, anon, authenticated;
create or replace function public.discord_edge_issue_link_challenge(
  p_user_id uuid,
  p_installation_id uuid,
  p_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Service authorization required' using errcode = '42501';
  end if;
  return private.issue_discord_link_challenge(p_user_id, p_installation_id, p_ip_hash);
end;
$$;
revoke all on function public.discord_edge_issue_link_challenge(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.discord_edge_issue_link_challenge(uuid, uuid, text)
  to service_role;
create or replace function public.discord_worker_enqueue_v2(
  p_discord_user_id text,
  p_session_kind text,
  p_guild_id text,
  p_channel_id text,
  p_thread_id text,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_gateway_mode text;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  select link.user_id into v_user_id
  from public.discord_cloud_links as link
  where link.discord_user_id = p_discord_user_id and link.status = 'active';

  if v_user_id is null then
    return jsonb_build_object('accepted', false, 'error', 'account_not_linked');
  end if;

  select coalesce(preferences.gateway_mode, 'cloud') into v_gateway_mode
  from public.discord_cloud_preferences as preferences
  where preferences.user_id = v_user_id;

  if coalesce(v_gateway_mode, 'cloud') <> 'cloud' then
    return jsonb_build_object('accepted', false, 'error', 'gateway_mode_disabled');
  end if;

  return public.discord_worker_enqueue(
    p_discord_user_id,
    p_session_kind,
    p_guild_id,
    p_channel_id,
    p_thread_id,
    p_worker_id
  );
end;
$$;
revoke all on function public.discord_worker_enqueue_v2(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.discord_worker_enqueue_v2(text, text, text, text, text, text)
  to service_role;
create or replace function public.discord_worker_get_status_v2(p_discord_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
  v_gateway_mode text;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;
  v_status := public.discord_worker_get_status(p_discord_user_id);
  if coalesce((v_status ->> 'linked')::boolean, false) then
    select coalesce(preferences.gateway_mode, 'cloud') into v_gateway_mode
    from public.discord_cloud_preferences as preferences
    where preferences.user_id = (v_status ->> 'user_id')::uuid;
  end if;
  return v_status || jsonb_build_object('gateway_mode', coalesce(v_gateway_mode, 'cloud'));
end;
$$;
revoke all on function public.discord_worker_get_status_v2(text)
  from public, anon, authenticated;
grant execute on function public.discord_worker_get_status_v2(text) to service_role;
create or replace function public.discord_worker_start_voice_v2(
  p_ticket_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.discord_queue_tickets%rowtype;
  v_current_plan text;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;
  select * into v_ticket
  from public.discord_queue_tickets
  where id = p_ticket_id and lease_owner = p_worker_id and state = 'active'
  for update;
  if not found then
    return jsonb_build_object('started', false, 'error', 'ticket_not_active');
  end if;
  if not exists (
    select 1
    from public.discord_cloud_links as link
    join public.discord_cloud_preferences as preferences on preferences.user_id = link.user_id
    where link.user_id = v_ticket.user_id
      and link.discord_user_id = v_ticket.discord_user_id
      and link.status = 'active'
      and preferences.gateway_mode = 'cloud'
  ) then
    update public.discord_queue_tickets
    set state = 'released', finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_ticket.id;
    return jsonb_build_object('started', false, 'error', 'gateway_mode_disabled');
  end if;

  v_current_plan := private.discord_plan_for_user(v_ticket.user_id);
  if v_current_plan <> v_ticket.plan_tier then
    update public.discord_queue_tickets
    set state = 'released', finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_ticket.id;
    return jsonb_build_object('started', false, 'error', 'plan_changed_retry');
  end if;
  return public.discord_worker_start_voice(p_ticket_id, p_worker_id);
end;
$$;
revoke all on function public.discord_worker_start_voice_v2(uuid, text)
  from public, anon, authenticated;
grant execute on function public.discord_worker_start_voice_v2(uuid, text) to service_role;
create or replace function public.discord_worker_heartbeat_voice_v2(
  p_session_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.discord_voice_sessions%rowtype;
  v_current_plan text;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;
  select * into v_session
  from public.discord_voice_sessions
  where id = p_session_id and worker_id = p_worker_id and state = 'active'
  for update;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  if not exists (
    select 1
    from public.discord_cloud_links as link
    join public.discord_cloud_preferences as preferences on preferences.user_id = link.user_id
    where link.user_id = v_session.user_id
      and link.status = 'active'
      and preferences.gateway_mode = 'cloud'
  ) then
    perform public.discord_worker_finish_voice(p_session_id, p_worker_id, 'gateway_mode_disabled');
    return jsonb_build_object('found', true, 'allowed', false, 'finished', true);
  end if;

  v_current_plan := private.discord_plan_for_user(v_session.user_id);
  update public.discord_usage_periods
  set plan_tier = v_current_plan, updated_at = clock_timestamp()
  where user_id = v_session.user_id and period_start = v_session.period_start;

  return public.discord_worker_heartbeat_voice(p_session_id, p_worker_id);
end;
$$;
revoke all on function public.discord_worker_heartbeat_voice_v2(uuid, text)
  from public, anon, authenticated;
grant execute on function public.discord_worker_heartbeat_voice_v2(uuid, text)
  to service_role;
create or replace function public.discord_worker_get_session_v2(
  p_user_id uuid,
  p_session_id uuid,
  p_installation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.discord_session_index%rowtype;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.discord_cloud_links as link
    join public.discord_cloud_preferences as preferences on preferences.user_id = link.user_id
    where link.user_id = p_user_id
      and link.installation_id = p_installation_id
      and link.status = 'active'
      and preferences.gateway_mode = 'cloud'
  ) then
    return jsonb_build_object('found', false);
  end if;

  select * into v_session
  from public.discord_session_index
  where id = p_session_id
    and user_id = p_user_id
    and installation_id = p_installation_id;

  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object('found', true, 'session', to_jsonb(v_session));
end;
$$;
revoke all on function public.discord_worker_get_session_v2(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.discord_worker_get_session_v2(uuid, uuid, uuid)
  to service_role;
create or replace function public.discord_worker_list_sessions_v2(
  p_user_id uuid,
  p_installation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sessions jsonb;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.discord_cloud_links as link
    join public.discord_cloud_preferences as preferences on preferences.user_id = link.user_id
    where link.user_id = p_user_id
      and link.installation_id = p_installation_id
      and link.status = 'active'
      and preferences.gateway_mode = 'cloud'
  ) then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(to_jsonb(session_row) order by session_row.updated_at desc), '[]'::jsonb)
  into v_sessions
  from (
    select
      id,
      installation_id,
      discord_channel_id,
      discord_thread_id,
      model_id,
      cursor_index,
      created_at,
      updated_at
    from public.discord_session_index
    where user_id = p_user_id and installation_id = p_installation_id
    order by updated_at desc
    limit 50
  ) as session_row;

  return v_sessions;
end;
$$;
revoke all on function public.discord_worker_list_sessions_v2(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.discord_worker_list_sessions_v2(uuid, uuid)
  to service_role;
create or replace function public.discord_worker_reserve_outbound_nonce(
  p_nonce uuid,
  p_user_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted uuid;
  v_existing public.discord_outbound_idempotency%rowtype;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.discord_session_index
    where id = p_session_id and user_id = p_user_id
  ) then
    return jsonb_build_object('reserved', false, 'error', 'session_not_found');
  end if;

  insert into public.discord_outbound_idempotency (
    nonce,
    user_id,
    session_id,
    direction,
    expires_at
  ) values (
    p_nonce,
    p_user_id,
    p_session_id,
    'desktop_to_discord',
    clock_timestamp() + interval '24 hours'
  )
  on conflict (nonce) do nothing
  returning nonce into v_inserted;

  if v_inserted is not null then
    return jsonb_build_object('reserved', true, 'duplicate', false);
  end if;

  select * into v_existing
  from public.discord_outbound_idempotency
  where nonce = p_nonce
    and user_id = p_user_id
    and session_id = p_session_id
    and direction = 'desktop_to_discord';

  if not found then
    return jsonb_build_object('reserved', false, 'error', 'nonce_conflict');
  end if;

  return jsonb_build_object(
    'reserved', false,
    'duplicate', true,
    'discord_message_id', v_existing.discord_message_id
  );
end;
$$;
revoke all on function public.discord_worker_reserve_outbound_nonce(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.discord_worker_reserve_outbound_nonce(uuid, uuid, uuid)
  to service_role;
create or replace function public.discord_worker_finalize_outbound_nonce(
  p_nonce uuid,
  p_user_id uuid,
  p_discord_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;
  update public.discord_outbound_idempotency
  set discord_message_id = p_discord_message_id
  where nonce = p_nonce
    and user_id = p_user_id
    and direction = 'desktop_to_discord'
    and (discord_message_id is null or discord_message_id = p_discord_message_id);
  return found;
end;
$$;
revoke all on function public.discord_worker_finalize_outbound_nonce(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.discord_worker_finalize_outbound_nonce(uuid, uuid, text)
  to service_role;
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job
  where jobname = 'prism-discord-link-rate-retention';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'prism-discord-link-rate-retention',
    '17 * * * *',
    $cleanup$delete from public.discord_link_challenges where created_at < clock_timestamp() - interval '24 hours'; delete from public.discord_link_ip_rate_limits where updated_at < clock_timestamp() - interval '24 hours';$cleanup$
  );
end;
$$;
