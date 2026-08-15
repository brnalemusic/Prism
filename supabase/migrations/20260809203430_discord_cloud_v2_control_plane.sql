-- Prism Discord Gateway Cloud v2 control plane.
-- Supabase stores only identity, entitlement, quota, queue, lease, and cursor
-- metadata. Discord messages, transcripts, and audio never enter this schema.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
-- ---------------------------------------------------------------------------
-- Immediate containment for pre-v2 public surfaces
-- ---------------------------------------------------------------------------

do $migration$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles',
        'subscription_plans',
        'user_licenses',
        'pending_checkout_sessions',
        'prism_api_keys',
        'user_ai_usage',
        'ai_rate_limits',
        'discord_cloud_links',
        'discord_gateway_queue',
        'discord_voice_usage',
        'discord_chat_sessions'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  end loop;
end
$migration$;
revoke all on function public.check_and_increment_ai_usage(uuid)
  from public, anon, authenticated;
revoke all on function public.get_user_ai_usage_status(uuid)
  from public, anon, authenticated;
grant execute on function public.check_and_increment_ai_usage(uuid) to service_role;
grant execute on function public.get_user_ai_usage_status(uuid) to service_role;
alter function public.check_and_increment_ai_usage(uuid) set search_path = '';
alter function public.get_user_ai_usage_status(uuid) set search_path = '';
drop function if exists public.check_and_consume_discord_voice_time(uuid, integer);
drop function if exists public.check_discord_gateway_queue(text, uuid);
drop function if exists public.verify_and_link_discord(text, text, text);
drop table if exists public.discord_chat_sessions;
drop table if exists public.discord_voice_usage;
drop table if exists public.discord_gateway_queue;
drop table if exists public.discord_cloud_links;
-- A caller-safe overload replaces the former arbitrary-user status RPC.
create or replace function public.get_user_ai_usage_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return public.get_user_ai_usage_status(v_user_id);
end
$function$;
revoke all on function public.get_user_ai_usage_status() from public, anon;
grant execute on function public.get_user_ai_usage_status() to authenticated;
-- New accounts always start at the individual tier. Enterprise authorization
-- is derived only from a server-verified, active license.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    company_name,
    account_type
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'company_name', ''),
    'individual'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
    company_name = coalesce(nullif(excluded.company_name, ''), public.profiles.company_name),
    updated_at = clock_timestamp();

  return new;
end
$function$;
alter function public.handle_new_user() set search_path = '';
revoke all on function public.handle_new_user() from public, anon, authenticated;
create or replace function private.protect_profile_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    if new.id is distinct from old.id
      or new.email is distinct from old.email
      or new.account_type is distinct from old.account_type
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Protected profile fields cannot be changed'
        using errcode = '42501';
    end if;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end
$function$;
revoke all on function private.protect_profile_fields() from public, anon, authenticated;
drop trigger if exists profiles_protect_fields on public.profiles;
create trigger profiles_protect_fields
before update on public.profiles
for each row execute function private.protect_profile_fields();
alter table public.profiles enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.user_licenses enable row level security;
alter table public.pending_checkout_sessions enable row level security;
alter table public.prism_api_keys enable row level security;
alter table public.user_ai_usage enable row level security;
alter table public.ai_rate_limits enable row level security;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);
create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);
create policy subscription_plans_read_active
on public.subscription_plans
for select
to anon, authenticated
using (is_active = true);
create policy user_licenses_select_own
on public.user_licenses
for select
to authenticated
using ((select auth.uid()) = user_id);
create policy user_ai_usage_select_own
on public.user_ai_usage
for select
to authenticated
using ((select auth.uid()) = user_id);
create policy ai_rate_limits_read
on public.ai_rate_limits
for select
to authenticated
using (true);
revoke all on public.pending_checkout_sessions from anon, authenticated;
revoke all on public.prism_api_keys from anon, authenticated;
revoke insert, update, delete on public.user_licenses from anon, authenticated;
create index if not exists user_licenses_user_id_idx
  on public.user_licenses (user_id);
create index if not exists user_licenses_plan_id_idx
  on public.user_licenses (plan_id);
create index if not exists user_licenses_active_entitlement_idx
  on public.user_licenses (user_id, expires_at)
  where status = 'active';
-- ---------------------------------------------------------------------------
-- Discord Cloud v2 relational control plane
-- ---------------------------------------------------------------------------

create table public.prism_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_label text not null check (char_length(device_label) between 1 and 80),
  public_key text not null check (char_length(public_key) between 32 and 256),
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  unique (user_id, public_key)
);
create table public.discord_cloud_models (
  id text primary key,
  display_name text not null,
  modality text not null check (modality in ('chat', 'voice')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.discord_cloud_models (
  id,
  display_name,
  modality,
  is_active,
  sort_order
)
values
  ('gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite', 'chat', true, 10),
  ('gemini-3-flash-preview', 'Gemini 3 Flash Preview', 'chat', true, 20),
  ('gemini-3.1-flash-live-preview', 'Gemini 3.1 Flash Live Preview', 'voice', true, 30)
on conflict (id) do update
set
  display_name = excluded.display_name,
  modality = excluded.modality,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = clock_timestamp();
create table public.discord_cloud_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_model_id text not null default 'gemini-3.1-flash-lite'
    references public.discord_cloud_models(id),
  voice_model_id text not null default 'gemini-3.1-flash-live-preview'
    references public.discord_cloud_models(id),
  content_storage_mode text not null default 'discord_remote'
    check (content_storage_mode = 'discord_remote'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (chat_model_id in (
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview'
  )),
  check (voice_model_id = 'gemini-3.1-flash-live-preview')
);
create table public.discord_plan_limits (
  plan_tier text primary key check (plan_tier in ('standard', 'enterprise')),
  weekly_voice_seconds integer not null check (weekly_voice_seconds > 0),
  pool_capacity integer not null check (pool_capacity > 0),
  queue_delay_seconds integer not null check (queue_delay_seconds >= 0),
  max_user_sessions integer not null default 1 check (max_user_sessions > 0),
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.discord_plan_limits (
  plan_tier,
  weekly_voice_seconds,
  pool_capacity,
  queue_delay_seconds,
  max_user_sessions
)
values
  ('standard', 1200, 20, 10, 1),
  ('enterprise', 18000, 100, 2, 2)
on conflict (plan_tier) do update
set
  weekly_voice_seconds = excluded.weekly_voice_seconds,
  pool_capacity = excluded.pool_capacity,
  queue_delay_seconds = excluded.queue_delay_seconds,
  max_user_sessions = excluded.max_user_sessions,
  updated_at = clock_timestamp();
create table public.discord_link_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null references public.prism_installations(id) on delete cascade,
  code_hash bytea not null,
  salt bytea not null,
  state text not null default 'pending'
    check (state in ('pending', 'consumed', 'expired', 'cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at)
);
create table public.discord_link_attempts (
  discord_user_id text primary key,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  window_started_at timestamptz not null default clock_timestamp(),
  blocked_until timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);
create table public.discord_cloud_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  installation_id uuid not null references public.prism_installations(id) on delete restrict,
  discord_user_id text not null unique,
  discord_tag text,
  status text not null default 'pending_desktop_confirmation'
    check (status in ('pending_desktop_confirmation', 'active', 'revoked')),
  created_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz,
  last_active_at timestamptz,
  revoked_at timestamptz
);
create table public.discord_usage_periods (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start timestamptz not null,
  plan_tier text not null references public.discord_plan_limits(plan_tier),
  voice_seconds_used integer not null default 0 check (voice_seconds_used >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, period_start)
);
create table public.discord_queue_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  discord_user_id text not null,
  session_kind text not null check (session_kind in ('chat', 'voice')),
  plan_tier text not null references public.discord_plan_limits(plan_tier),
  state text not null default 'queued'
    check (state in ('queued', 'active', 'finished', 'released', 'expired', 'failed')),
  guild_id text,
  channel_id text not null,
  thread_id text,
  ready_at timestamptz not null,
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);
create table public.discord_voice_sessions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null unique references public.discord_queue_tickets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  worker_id text not null,
  state text not null default 'active'
    check (state in ('active', 'finished', 'quota_exhausted', 'expired', 'failed')),
  period_start timestamptz not null,
  started_at timestamptz not null default clock_timestamp(),
  last_heartbeat_at timestamptz not null default clock_timestamp(),
  lease_expires_at timestamptz not null,
  metered_seconds integer not null default 0 check (metered_seconds >= 0),
  ended_at timestamptz,
  end_reason text
);
create table public.discord_session_index (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null references public.prism_installations(id) on delete cascade,
  discord_channel_id text not null,
  discord_thread_id text not null,
  local_session_id text,
  model_id text not null references public.discord_cloud_models(id),
  source text not null default 'discord' check (source = 'discord'),
  cursor_index bigint not null default 0 check (cursor_index >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (user_id, discord_thread_id)
);
create table public.discord_outbound_idempotency (
  nonce uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.discord_session_index(id) on delete cascade,
  direction text not null check (direction in ('discord_to_desktop', 'desktop_to_discord')),
  discord_message_id text,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null
);
create table public.discord_interaction_states (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null,
  interaction_kind text not null,
  state_token_hash bytea not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create table public.discord_worker_instances (
  worker_id text primary key,
  version text not null,
  region text,
  state text not null default 'online'
    check (state in ('online', 'draining', 'offline')),
  started_at timestamptz not null default clock_timestamp(),
  last_heartbeat_at timestamptz not null default clock_timestamp(),
  active_sessions integer not null default 0 check (active_sessions >= 0)
);
create table public.discord_control_audit (
  id bigint generated always as identity primary key,
  event_code text not null,
  actor_type text not null check (actor_type in ('user', 'worker', 'system')),
  actor_id text,
  subject_id text,
  request_id uuid,
  created_at timestamptz not null default clock_timestamp()
);
create index prism_installations_user_id_idx
  on public.prism_installations (user_id);
create index discord_link_challenges_active_idx
  on public.discord_link_challenges (expires_at)
  where state = 'pending';
create index discord_link_challenges_user_id_idx
  on public.discord_link_challenges (user_id);
create index discord_cloud_links_installation_id_idx
  on public.discord_cloud_links (installation_id);
create index discord_queue_tickets_claim_idx
  on public.discord_queue_tickets (plan_tier, ready_at, created_at)
  where state = 'queued';
create index discord_queue_tickets_active_idx
  on public.discord_queue_tickets (plan_tier, lease_expires_at)
  where state = 'active';
create index discord_queue_tickets_user_id_idx
  on public.discord_queue_tickets (user_id);
create index discord_voice_sessions_active_idx
  on public.discord_voice_sessions (lease_expires_at)
  where state = 'active';
create index discord_voice_sessions_user_id_idx
  on public.discord_voice_sessions (user_id);
create index discord_session_index_user_id_idx
  on public.discord_session_index (user_id);
create index discord_session_index_installation_id_idx
  on public.discord_session_index (installation_id);
create index discord_outbound_idempotency_user_id_idx
  on public.discord_outbound_idempotency (user_id);
create index discord_outbound_idempotency_expiry_idx
  on public.discord_outbound_idempotency (expires_at);
create index discord_interaction_states_expiry_idx
  on public.discord_interaction_states (expires_at)
  where consumed_at is null;
create index discord_control_audit_created_at_idx
  on public.discord_control_audit (created_at desc);
-- ---------------------------------------------------------------------------
-- RLS: users see only their metadata. Worker writes go through guarded RPCs.
-- ---------------------------------------------------------------------------

alter table public.prism_installations enable row level security;
alter table public.discord_cloud_models enable row level security;
alter table public.discord_cloud_preferences enable row level security;
alter table public.discord_plan_limits enable row level security;
alter table public.discord_link_challenges enable row level security;
alter table public.discord_link_attempts enable row level security;
alter table public.discord_cloud_links enable row level security;
alter table public.discord_usage_periods enable row level security;
alter table public.discord_queue_tickets enable row level security;
alter table public.discord_voice_sessions enable row level security;
alter table public.discord_session_index enable row level security;
alter table public.discord_outbound_idempotency enable row level security;
alter table public.discord_interaction_states enable row level security;
alter table public.discord_worker_instances enable row level security;
alter table public.discord_control_audit enable row level security;
create policy prism_installations_select_own
on public.prism_installations for select to authenticated
using ((select auth.uid()) = user_id);
create policy prism_installations_insert_own
on public.prism_installations for insert to authenticated
with check ((select auth.uid()) = user_id and status = 'active');
create policy prism_installations_update_own
on public.prism_installations for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy discord_cloud_models_read
on public.discord_cloud_models for select to authenticated
using (is_active = true);
create policy discord_cloud_preferences_select_own
on public.discord_cloud_preferences for select to authenticated
using ((select auth.uid()) = user_id);
create policy discord_cloud_preferences_insert_own
on public.discord_cloud_preferences for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy discord_cloud_preferences_update_own
on public.discord_cloud_preferences for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy discord_plan_limits_read
on public.discord_plan_limits for select to authenticated
using (true);
create policy discord_link_challenges_select_own
on public.discord_link_challenges for select to authenticated
using ((select auth.uid()) = user_id);
create policy discord_cloud_links_select_own
on public.discord_cloud_links for select to authenticated
using ((select auth.uid()) = user_id);
create policy discord_usage_periods_select_own
on public.discord_usage_periods for select to authenticated
using ((select auth.uid()) = user_id);
create policy discord_queue_tickets_select_own
on public.discord_queue_tickets for select to authenticated
using ((select auth.uid()) = user_id);
create policy discord_voice_sessions_select_own
on public.discord_voice_sessions for select to authenticated
using ((select auth.uid()) = user_id);
create policy discord_session_index_select_own
on public.discord_session_index for select to authenticated
using ((select auth.uid()) = user_id);
create policy discord_session_index_update_own
on public.discord_session_index for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
revoke all on public.discord_link_attempts from anon, authenticated;
revoke all on public.discord_outbound_idempotency from anon, authenticated;
revoke all on public.discord_interaction_states from anon, authenticated;
revoke all on public.discord_worker_instances from anon, authenticated;
revoke all on public.discord_control_audit from anon, authenticated;
-- ---------------------------------------------------------------------------
-- Private helpers and guarded RPC surface
-- ---------------------------------------------------------------------------

create or replace function private.is_discord_worker()
returns boolean
language sql
stable
set search_path = ''
as $function$
  select coalesce(
    (select auth.jwt()) -> 'app_metadata' ->> 'discord_worker',
    'false'
  ) = 'true';
$function$;
revoke all on function private.is_discord_worker() from public, anon, authenticated;
create or replace function private.discord_plan_for_user(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select case when exists (
    select 1
    from public.user_licenses as license
    where license.user_id = p_user_id
      and license.status = 'active'
      and (license.expires_at is null or license.expires_at > clock_timestamp())
      and license.plan_id like 'enterprise%'
  ) then 'enterprise' else 'standard' end;
$function$;
revoke all on function private.discord_plan_for_user(uuid)
  from public, anon, authenticated;
do $vault_secret$
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'discord_link_pepper'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'discord_link_pepper',
      'Prism Discord Cloud link challenge pepper'
    );
  end if;
end
$vault_secret$;
create or replace function public.discord_issue_link_challenge(
  p_installation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_random bytea := extensions.gen_random_bytes(4);
  v_code text;
  v_salt bytea := extensions.gen_random_bytes(16);
  v_pepper text;
  v_challenge_id uuid;
  v_expires_at timestamptz := clock_timestamp() + interval '5 minutes';
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.prism_installations
    where id = p_installation_id
      and user_id = v_user_id
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
  where user_id = v_user_id and state = 'pending';

  insert into public.discord_link_challenges (
    user_id,
    installation_id,
    code_hash,
    salt,
    expires_at
  )
  values (
    v_user_id,
    p_installation_id,
    extensions.digest(convert_to(v_code, 'utf8') || v_salt || convert_to(v_pepper, 'utf8'), 'sha256'),
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
    v_user_id::text,
    v_challenge_id::text
  );

  return jsonb_build_object(
    'challenge_id', v_challenge_id,
    'code', v_code,
    'expires_at', v_expires_at
  );
end
$function$;
revoke all on function public.discord_issue_link_challenge(uuid) from public, anon;
grant execute on function public.discord_issue_link_challenge(uuid) to authenticated;
create or replace function public.discord_worker_consume_link_challenge(
  p_code text,
  p_discord_user_id text,
  p_discord_tag text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_pepper text;
  v_attempt public.discord_link_attempts%rowtype;
  v_challenge public.discord_link_challenges%rowtype;
  v_link public.discord_cloud_links%rowtype;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  if p_code !~ '^[0-9]{6}$' then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;

  insert into public.discord_link_attempts (discord_user_id)
  values (p_discord_user_id)
  on conflict (discord_user_id) do nothing;

  select * into strict v_attempt
  from public.discord_link_attempts
  where discord_user_id = p_discord_user_id
  for update;

  if v_attempt.blocked_until is not null and v_attempt.blocked_until > v_now then
    return jsonb_build_object(
      'success', false,
      'error', 'rate_limited',
      'retry_at', v_attempt.blocked_until
    );
  end if;

  if v_attempt.window_started_at <= v_now - interval '10 minutes' then
    update public.discord_link_attempts
    set
      attempt_count = 1,
      window_started_at = v_now,
      blocked_until = null,
      updated_at = v_now
    where discord_user_id = p_discord_user_id;
  elsif v_attempt.attempt_count >= 4 then
    update public.discord_link_attempts
    set
      attempt_count = attempt_count + 1,
      blocked_until = v_now + interval '10 minutes',
      updated_at = v_now
    where discord_user_id = p_discord_user_id;

    return jsonb_build_object(
      'success', false,
      'error', 'rate_limited',
      'retry_at', v_now + interval '10 minutes'
    );
  else
    update public.discord_link_attempts
    set attempt_count = attempt_count + 1, updated_at = v_now
    where discord_user_id = p_discord_user_id;
  end if;

  select decrypted_secret
  into strict v_pepper
  from vault.decrypted_secrets
  where name = 'discord_link_pepper';

  select challenge.*
  into v_challenge
  from public.discord_link_challenges as challenge
  where challenge.state = 'pending'
    and challenge.expires_at > v_now
    and challenge.code_hash = extensions.digest(
      convert_to(p_code, 'utf8')
      || challenge.salt
      || convert_to(v_pepper, 'utf8'),
      'sha256'
    )
  order by challenge.created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_or_expired');
  end if;

  if exists (
    select 1
    from public.discord_cloud_links
    where discord_user_id = p_discord_user_id
      and user_id <> v_challenge.user_id
      and status <> 'revoked'
  ) then
    return jsonb_build_object('success', false, 'error', 'discord_already_linked');
  end if;

  update public.discord_link_challenges
  set state = 'consumed', consumed_at = v_now, attempts = attempts + 1
  where id = v_challenge.id;

  insert into public.discord_cloud_links (
    user_id,
    installation_id,
    discord_user_id,
    discord_tag,
    status,
    last_active_at
  ) values (
    v_challenge.user_id,
    v_challenge.installation_id,
    p_discord_user_id,
    nullif(p_discord_tag, ''),
    'pending_desktop_confirmation',
    v_now
  )
  on conflict (user_id) do update
  set
    installation_id = excluded.installation_id,
    discord_user_id = excluded.discord_user_id,
    discord_tag = excluded.discord_tag,
    status = 'pending_desktop_confirmation',
    confirmed_at = null,
    revoked_at = null,
    last_active_at = v_now
  returning * into v_link;

  insert into public.discord_cloud_preferences (user_id)
  values (v_challenge.user_id)
  on conflict (user_id) do nothing;

  insert into public.discord_control_audit (
    event_code,
    actor_type,
    actor_id,
    subject_id
  ) values (
    'link_discord_confirmed',
    'worker',
    p_discord_user_id,
    v_link.id::text
  );

  return jsonb_build_object(
    'success', true,
    'link_id', v_link.id,
    'status', v_link.status
  );
end
$function$;
revoke all on function public.discord_worker_consume_link_challenge(text, text, text)
  from public, anon;
grant execute on function public.discord_worker_consume_link_challenge(text, text, text)
  to authenticated;
create or replace function public.discord_confirm_link(p_link_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_link public.discord_cloud_links%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.discord_cloud_links
  set
    status = 'active',
    confirmed_at = clock_timestamp(),
    last_active_at = clock_timestamp()
  where id = p_link_id
    and user_id = v_user_id
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
    v_user_id::text,
    v_link.id::text
  );

  return jsonb_build_object('success', true, 'status', 'active');
end
$function$;
revoke all on function public.discord_confirm_link(uuid) from public, anon;
grant execute on function public.discord_confirm_link(uuid) to authenticated;
create or replace function public.discord_revoke_link()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.discord_cloud_links
  set status = 'revoked', revoked_at = clock_timestamp()
  where user_id = v_user_id and status <> 'revoked';

  update public.discord_queue_tickets
  set state = 'released', finished_at = clock_timestamp(), updated_at = clock_timestamp()
  where user_id = v_user_id and state in ('queued', 'active');
end
$function$;
revoke all on function public.discord_revoke_link() from public, anon;
grant execute on function public.discord_revoke_link() to authenticated;
create or replace function public.discord_worker_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_bot_token text;
  v_gemini_key text;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  select decrypted_secret into v_bot_token
  from vault.decrypted_secrets
  where name = 'discord_cloud_bot_token';

  select decrypted_secret into v_gemini_key
  from vault.decrypted_secrets
  where name = 'discord_cloud_gemini_api_key';

  if v_bot_token is null or v_gemini_key is null then
    raise exception 'Discord Cloud secrets are not provisioned';
  end if;

  return jsonb_build_object(
    'discord_bot_token', v_bot_token,
    'gemini_api_key', v_gemini_key
  );
end
$function$;
revoke all on function public.discord_worker_bootstrap() from public, anon;
grant execute on function public.discord_worker_bootstrap() to authenticated;
create or replace function public.discord_worker_register(
  p_worker_id text,
  p_version text,
  p_region text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  insert into public.discord_worker_instances (
    worker_id,
    version,
    region,
    state,
    started_at,
    last_heartbeat_at
  ) values (
    p_worker_id,
    p_version,
    nullif(p_region, ''),
    'online',
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (worker_id) do update
  set
    version = excluded.version,
    region = excluded.region,
    state = 'online',
    started_at = clock_timestamp(),
    last_heartbeat_at = clock_timestamp();
end
$function$;
revoke all on function public.discord_worker_register(text, text, text)
  from public, anon;
grant execute on function public.discord_worker_register(text, text, text)
  to authenticated;
create or replace function public.discord_worker_heartbeat(
  p_worker_id text,
  p_active_sessions integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  update public.discord_worker_instances
  set
    state = 'online',
    active_sessions = greatest(p_active_sessions, 0),
    last_heartbeat_at = clock_timestamp()
  where worker_id = p_worker_id;

  if not found then
    raise exception 'Worker is not registered';
  end if;
end
$function$;
revoke all on function public.discord_worker_heartbeat(text, integer)
  from public, anon;
grant execute on function public.discord_worker_heartbeat(text, integer)
  to authenticated;
create or replace function public.discord_worker_enqueue(
  p_discord_user_id text,
  p_session_kind text,
  p_guild_id text,
  p_channel_id text,
  p_thread_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_link public.discord_cloud_links%rowtype;
  v_plan_tier text;
  v_delay integer;
  v_max_user_sessions integer;
  v_ticket public.discord_queue_tickets%rowtype;
  v_position integer;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  if p_session_kind not in ('chat', 'voice') then
    raise exception 'Unsupported session kind';
  end if;

  select * into v_link
  from public.discord_cloud_links
  where discord_user_id = p_discord_user_id and status = 'active';

  if not found then
    return jsonb_build_object('accepted', false, 'error', 'account_not_linked');
  end if;

  v_plan_tier := private.discord_plan_for_user(v_link.user_id);

  select queue_delay_seconds, max_user_sessions
  into strict v_delay, v_max_user_sessions
  from public.discord_plan_limits
  where plan_tier = v_plan_tier;

  select * into v_ticket
  from public.discord_queue_tickets
  where user_id = v_link.user_id
    and session_kind = p_session_kind
    and state in ('queued', 'active')
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'accepted', true,
      'ticket', to_jsonb(v_ticket),
      'reused', true
    );
  end if;

  if (
    select count(*)
    from public.discord_queue_tickets
    where user_id = v_link.user_id and state in ('queued', 'active')
  ) >= v_max_user_sessions then
    return jsonb_build_object('accepted', false, 'error', 'user_session_limit');
  end if;

  insert into public.discord_queue_tickets (
    user_id,
    discord_user_id,
    session_kind,
    plan_tier,
    state,
    guild_id,
    channel_id,
    thread_id,
    ready_at
  ) values (
    v_link.user_id,
    p_discord_user_id,
    p_session_kind,
    v_plan_tier,
    'queued',
    nullif(p_guild_id, ''),
    p_channel_id,
    nullif(p_thread_id, ''),
    clock_timestamp() + make_interval(secs => v_delay)
  )
  returning * into v_ticket;

  select count(*) into v_position
  from public.discord_queue_tickets
  where plan_tier = v_plan_tier
    and state = 'queued'
    and (ready_at, created_at, id) <= (v_ticket.ready_at, v_ticket.created_at, v_ticket.id);

  return jsonb_build_object(
    'accepted', true,
    'ticket', to_jsonb(v_ticket),
    'position', v_position,
    'reused', false
  );
end
$function$;
revoke all on function public.discord_worker_enqueue(text, text, text, text, text)
  from public, anon;
grant execute on function public.discord_worker_enqueue(text, text, text, text, text)
  to authenticated;
create or replace function public.discord_worker_claim(
  p_plan_tier text,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_capacity integer;
  v_active integer;
  v_ticket public.discord_queue_tickets%rowtype;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  select pool_capacity into v_capacity
  from public.discord_plan_limits
  where plan_tier = p_plan_tier;

  if v_capacity is null then
    raise exception 'Unknown plan tier';
  end if;

  select count(*) into v_active
  from public.discord_queue_tickets
  where plan_tier = p_plan_tier
    and state = 'active'
    and lease_expires_at > clock_timestamp();

  if v_active >= v_capacity then
    return jsonb_build_object('claimed', false, 'reason', 'pool_full');
  end if;

  update public.discord_queue_tickets
  set
    state = 'active',
    lease_owner = p_worker_id,
    lease_expires_at = clock_timestamp() + interval '45 seconds',
    attempt_count = attempt_count + 1,
    started_at = coalesce(started_at, clock_timestamp()),
    updated_at = clock_timestamp()
  where id = (
    select id
    from public.discord_queue_tickets
    where plan_tier = p_plan_tier
      and state = 'queued'
      and ready_at <= clock_timestamp()
    order by ready_at, created_at, id
    limit 1
    for update skip locked
  )
  returning * into v_ticket;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'queue_empty');
  end if;

  return jsonb_build_object('claimed', true, 'ticket', to_jsonb(v_ticket));
end
$function$;
revoke all on function public.discord_worker_claim(text, text) from public, anon;
grant execute on function public.discord_worker_claim(text, text) to authenticated;
create or replace function public.discord_worker_heartbeat_ticket(
  p_ticket_id uuid,
  p_worker_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  update public.discord_queue_tickets
  set
    lease_expires_at = clock_timestamp() + interval '45 seconds',
    updated_at = clock_timestamp()
  where id = p_ticket_id
    and state = 'active'
    and lease_owner = p_worker_id;

  return found;
end
$function$;
revoke all on function public.discord_worker_heartbeat_ticket(uuid, text)
  from public, anon;
grant execute on function public.discord_worker_heartbeat_ticket(uuid, text)
  to authenticated;
create or replace function public.discord_worker_release_ticket(
  p_ticket_id uuid,
  p_worker_id text,
  p_final_state text default 'finished'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  if p_final_state not in ('finished', 'released', 'failed') then
    raise exception 'Invalid final ticket state';
  end if;

  update public.discord_queue_tickets
  set
    state = p_final_state,
    lease_expires_at = null,
    updated_at = clock_timestamp(),
    finished_at = clock_timestamp()
  where id = p_ticket_id
    and state = 'active'
    and lease_owner = p_worker_id;

  return found;
end
$function$;
revoke all on function public.discord_worker_release_ticket(uuid, text, text)
  from public, anon;
grant execute on function public.discord_worker_release_ticket(uuid, text, text)
  to authenticated;
create or replace function private.meter_discord_voice_session(
  p_session_id uuid,
  p_finish boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_session public.discord_voice_sessions%rowtype;
  v_usage public.discord_usage_periods%rowtype;
  v_limit integer;
  v_bill_until timestamptz;
  v_elapsed integer;
  v_delta integer;
  v_charge integer;
  v_remaining integer;
  v_exhausted boolean;
begin
  select * into v_session
  from public.discord_voice_sessions
  where id = p_session_id
  for update;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  select * into strict v_usage
  from public.discord_usage_periods
  where user_id = v_session.user_id
    and period_start = v_session.period_start
  for update;

  select weekly_voice_seconds into strict v_limit
  from public.discord_plan_limits
  where plan_tier = v_usage.plan_tier;

  v_bill_until := case
    when p_finish then v_now
    else least(v_now, v_session.lease_expires_at)
  end;
  v_elapsed := greatest(
    0,
    floor(extract(epoch from (v_bill_until - v_session.started_at)))::integer
  );
  v_delta := greatest(0, v_elapsed - v_session.metered_seconds);
  v_remaining := greatest(0, v_limit - v_usage.voice_seconds_used);
  v_charge := least(v_delta, v_remaining);

  if v_charge > 0 then
    update public.discord_usage_periods
    set
      voice_seconds_used = voice_seconds_used + v_charge,
      updated_at = v_now
    where user_id = v_session.user_id
      and period_start = v_session.period_start
    returning * into v_usage;

    update public.discord_voice_sessions
    set metered_seconds = metered_seconds + v_charge
    where id = p_session_id
    returning * into v_session;
  end if;

  v_exhausted := v_usage.voice_seconds_used >= v_limit;

  if p_finish or v_exhausted then
    update public.discord_voice_sessions
    set
      state = case when v_exhausted then 'quota_exhausted' else 'finished' end,
      ended_at = v_now,
      end_reason = case when v_exhausted then 'weekly_quota_exhausted' else p_reason end,
      last_heartbeat_at = v_now,
      lease_expires_at = v_now
    where id = p_session_id;

    update public.discord_queue_tickets
    set
      state = 'finished',
      finished_at = v_now,
      updated_at = v_now,
      lease_expires_at = null
    where id = v_session.ticket_id and state = 'active';
  else
    update public.discord_voice_sessions
    set
      last_heartbeat_at = v_now,
      lease_expires_at = v_now + interval '45 seconds'
    where id = p_session_id;
  end if;

  return jsonb_build_object(
    'found', true,
    'allowed', not v_exhausted,
    'used_seconds', v_usage.voice_seconds_used,
    'limit_seconds', v_limit,
    'remaining_seconds', greatest(0, v_limit - v_usage.voice_seconds_used),
    'metered_seconds', v_session.metered_seconds,
    'finished', p_finish or v_exhausted
  );
end
$function$;
revoke all on function private.meter_discord_voice_session(uuid, boolean, text)
  from public, anon, authenticated;
create or replace function public.discord_worker_start_voice(
  p_ticket_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ticket public.discord_queue_tickets%rowtype;
  v_period_start timestamptz := date_trunc('week', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  v_usage public.discord_usage_periods%rowtype;
  v_limit integer;
  v_session public.discord_voice_sessions%rowtype;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  select * into v_ticket
  from public.discord_queue_tickets
  where id = p_ticket_id
    and state = 'active'
    and session_kind = 'voice'
    and lease_owner = p_worker_id
  for update;

  if not found then
    return jsonb_build_object('started', false, 'error', 'active_ticket_not_found');
  end if;

  insert into public.discord_usage_periods (
    user_id,
    period_start,
    plan_tier
  ) values (
    v_ticket.user_id,
    v_period_start,
    v_ticket.plan_tier
  )
  on conflict (user_id, period_start) do nothing;

  select * into strict v_usage
  from public.discord_usage_periods
  where user_id = v_ticket.user_id and period_start = v_period_start
  for update;

  select weekly_voice_seconds into strict v_limit
  from public.discord_plan_limits
  where plan_tier = v_usage.plan_tier;

  if v_usage.voice_seconds_used >= v_limit then
    update public.discord_queue_tickets
    set state = 'finished', finished_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_ticket_id;

    return jsonb_build_object(
      'started', false,
      'error', 'weekly_quota_exhausted',
      'used_seconds', v_usage.voice_seconds_used,
      'limit_seconds', v_limit,
      'remaining_seconds', 0
    );
  end if;

  insert into public.discord_voice_sessions (
    ticket_id,
    user_id,
    worker_id,
    period_start,
    lease_expires_at
  ) values (
    p_ticket_id,
    v_ticket.user_id,
    p_worker_id,
    v_period_start,
    clock_timestamp() + interval '45 seconds'
  )
  on conflict (ticket_id) do update
  set
    worker_id = excluded.worker_id,
    lease_expires_at = excluded.lease_expires_at,
    last_heartbeat_at = clock_timestamp()
  returning * into v_session;

  return jsonb_build_object(
    'started', true,
    'session_id', v_session.id,
    'used_seconds', v_usage.voice_seconds_used,
    'limit_seconds', v_limit,
    'remaining_seconds', v_limit - v_usage.voice_seconds_used
  );
end
$function$;
revoke all on function public.discord_worker_start_voice(uuid, text)
  from public, anon;
grant execute on function public.discord_worker_start_voice(uuid, text)
  to authenticated;
create or replace function public.discord_worker_heartbeat_voice(
  p_session_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.discord_voice_sessions
    where id = p_session_id and worker_id = p_worker_id and state = 'active'
  ) then
    return jsonb_build_object('found', false);
  end if;

  return private.meter_discord_voice_session(p_session_id, false, 'heartbeat');
end
$function$;
revoke all on function public.discord_worker_heartbeat_voice(uuid, text)
  from public, anon;
grant execute on function public.discord_worker_heartbeat_voice(uuid, text)
  to authenticated;
create or replace function public.discord_worker_finish_voice(
  p_session_id uuid,
  p_worker_id text,
  p_reason text default 'completed'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.discord_voice_sessions
    where id = p_session_id and worker_id = p_worker_id and state = 'active'
  ) then
    return jsonb_build_object('found', false);
  end if;

  return private.meter_discord_voice_session(
    p_session_id,
    true,
    left(coalesce(p_reason, 'completed'), 80)
  );
end
$function$;
revoke all on function public.discord_worker_finish_voice(uuid, text, text)
  from public, anon;
grant execute on function public.discord_worker_finish_voice(uuid, text, text)
  to authenticated;
create or replace function public.discord_worker_upsert_session_index(
  p_discord_user_id text,
  p_channel_id text,
  p_thread_id text,
  p_model_id text,
  p_cursor_index bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_link public.discord_cloud_links%rowtype;
  v_session public.discord_session_index%rowtype;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  select * into v_link
  from public.discord_cloud_links
  where discord_user_id = p_discord_user_id and status = 'active';

  if not found then
    return jsonb_build_object('success', false, 'error', 'account_not_linked');
  end if;

  insert into public.discord_session_index (
    user_id,
    installation_id,
    discord_channel_id,
    discord_thread_id,
    model_id,
    cursor_index
  ) values (
    v_link.user_id,
    v_link.installation_id,
    p_channel_id,
    p_thread_id,
    p_model_id,
    greatest(p_cursor_index, 0)
  )
  on conflict (user_id, discord_thread_id) do update
  set
    discord_channel_id = excluded.discord_channel_id,
    model_id = excluded.model_id,
    cursor_index = greatest(public.discord_session_index.cursor_index, excluded.cursor_index),
    updated_at = clock_timestamp()
  returning * into v_session;

  return jsonb_build_object('success', true, 'session', to_jsonb(v_session));
end
$function$;
revoke all on function public.discord_worker_upsert_session_index(text, text, text, text, bigint)
  from public, anon;
grant execute on function public.discord_worker_upsert_session_index(text, text, text, text, bigint)
  to authenticated;
create or replace function public.discord_worker_record_nonce(
  p_nonce uuid,
  p_user_id uuid,
  p_session_id uuid,
  p_direction text,
  p_discord_message_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  if p_direction not in ('discord_to_desktop', 'desktop_to_discord') then
    raise exception 'Invalid sync direction';
  end if;

  insert into public.discord_outbound_idempotency (
    nonce,
    user_id,
    session_id,
    direction,
    discord_message_id,
    expires_at
  ) values (
    p_nonce,
    p_user_id,
    p_session_id,
    p_direction,
    nullif(p_discord_message_id, ''),
    clock_timestamp() + interval '7 days'
  )
  on conflict (nonce) do nothing;

  return found;
end
$function$;
revoke all on function public.discord_worker_record_nonce(uuid, uuid, uuid, text, text)
  from public, anon;
grant execute on function public.discord_worker_record_nonce(uuid, uuid, uuid, text, text)
  to authenticated;
create or replace function private.discord_cleanup_expired()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session record;
begin
  update public.discord_link_challenges
  set state = 'expired'
  where state = 'pending' and expires_at <= clock_timestamp();

  for v_session in
    select id
    from public.discord_voice_sessions
    where state = 'active' and lease_expires_at <= clock_timestamp()
    order by id
    for update skip locked
  loop
    perform private.meter_discord_voice_session(v_session.id, true, 'worker_lease_expired');
    update public.discord_voice_sessions
    set state = 'expired', end_reason = 'worker_lease_expired'
    where id = v_session.id and state = 'finished';
  end loop;

  update public.discord_queue_tickets
  set
    state = case when attempt_count < 3 then 'queued' else 'expired' end,
    ready_at = case
      when attempt_count < 3 then clock_timestamp() + interval '2 seconds'
      else ready_at
    end,
    lease_owner = null,
    lease_expires_at = null,
    updated_at = clock_timestamp(),
    finished_at = case when attempt_count >= 3 then clock_timestamp() else null end
  where state = 'active' and lease_expires_at <= clock_timestamp();

  update public.discord_worker_instances
  set state = 'offline'
  where state <> 'offline'
    and last_heartbeat_at <= clock_timestamp() - interval '90 seconds';

  delete from public.discord_interaction_states
  where expires_at <= clock_timestamp();

  delete from public.discord_outbound_idempotency
  where expires_at <= clock_timestamp();
end
$function$;
revoke all on function private.discord_cleanup_expired()
  from public, anon, authenticated;
do $cron$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'prism-discord-cloud-v2-cleanup';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'prism-discord-cloud-v2-cleanup',
    '* * * * *',
    'select private.discord_cleanup_expired();'
  );
end
$cron$;
-- Realtime is control-state only. It never contains messages, transcripts,
-- prompts, model responses, or audio.
do $realtime$
declare
  v_table text;
begin
  foreach v_table in array array[
    'prism_installations',
    'discord_cloud_preferences',
    'discord_cloud_links',
    'discord_queue_tickets',
    'discord_voice_sessions',
    'discord_session_index'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end
$realtime$;
comment on table public.discord_session_index is
  'Metadata-only Discord cursor index. Message content remains on Discord and the user device.';
comment on table public.discord_outbound_idempotency is
  'Metadata-only nonce ledger. Payloads are transported directly between Discord, the worker, and Prism Desktop.';
