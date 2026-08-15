alter table public.discord_queue_tickets
  add column if not exists preferred_worker_id text;
create index if not exists discord_queue_tickets_worker_claim_idx
  on public.discord_queue_tickets (preferred_worker_id, plan_tier, ready_at, created_at)
  where state = 'queued';
create unique index if not exists discord_queue_tickets_one_kind_per_user_idx
  on public.discord_queue_tickets (user_id, session_kind)
  where state in ('queued', 'active');
drop function if exists public.discord_worker_enqueue(text, text, text, text, text);
create or replace function public.discord_worker_enqueue(
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
  if not exists (
    select 1 from public.discord_worker_instances
    where worker_id = p_worker_id and state <> 'offline'
  ) then
    raise exception 'Worker is not registered';
  end if;

  select * into v_link
  from public.discord_cloud_links
  where discord_user_id = p_discord_user_id and status = 'active'
  for update;

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
    if v_ticket.preferred_worker_id = p_worker_id then
      return jsonb_build_object(
        'accepted', true,
        'ticket', to_jsonb(v_ticket),
        'reused', true
      );
    end if;
    return jsonb_build_object('accepted', false, 'error', 'request_already_queued');
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
    ready_at,
    preferred_worker_id
  ) values (
    v_link.user_id,
    p_discord_user_id,
    p_session_kind,
    v_plan_tier,
    'queued',
    nullif(p_guild_id, ''),
    p_channel_id,
    nullif(p_thread_id, ''),
    clock_timestamp() + make_interval(secs => v_delay),
    p_worker_id
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
end;
$$;
revoke all on function public.discord_worker_enqueue(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.discord_worker_enqueue(text, text, text, text, text, text)
  to service_role;
create or replace function public.discord_worker_claim(
  p_plan_tier text,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  where plan_tier = p_plan_tier
  for update;

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
      and (preferred_worker_id is null or preferred_worker_id = p_worker_id)
    order by ready_at, created_at, id
    limit 1
    for update skip locked
  )
  returning * into v_ticket;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'queue_empty');
  end if;

  return jsonb_build_object('claimed', true, 'ticket', to_jsonb(v_ticket));
end;
$$;
revoke all on function public.discord_worker_claim(text, text)
  from public, anon, authenticated;
grant execute on function public.discord_worker_claim(text, text) to service_role;
create or replace function public.discord_worker_get_ticket_status(
  p_ticket_id uuid,
  p_discord_user_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ticket public.discord_queue_tickets%rowtype;
  v_position integer;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  select * into v_ticket
  from public.discord_queue_tickets
  where id = p_ticket_id and discord_user_id = p_discord_user_id;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  if v_ticket.state = 'queued' then
    select count(*)::integer into v_position
    from public.discord_queue_tickets
    where plan_tier = v_ticket.plan_tier
      and state = 'queued'
      and (ready_at, created_at, id)
        <= (v_ticket.ready_at, v_ticket.created_at, v_ticket.id);
  end if;

  return jsonb_build_object(
    'found', true,
    'state', v_ticket.state,
    'plan_tier', v_ticket.plan_tier,
    'position', v_position,
    'eligible_at', v_ticket.ready_at,
    'seconds_until_eligible', greatest(
      0,
      ceil(extract(epoch from (v_ticket.ready_at - clock_timestamp())))::integer
    )
  );
end;
$$;
revoke all on function public.discord_worker_get_ticket_status(uuid, text)
  from public, anon, authenticated;
grant execute on function public.discord_worker_get_ticket_status(uuid, text) to service_role;
create or replace function public.discord_worker_cancel_ticket(
  p_ticket_id uuid,
  p_discord_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.discord_queue_tickets%rowtype;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  select * into v_ticket
  from public.discord_queue_tickets
  where id = p_ticket_id and discord_user_id = p_discord_user_id
  for update;

  if not found then
    return jsonb_build_object('cancelled', false, 'error', 'ticket_not_found');
  end if;
  if v_ticket.state = 'queued' then
    update public.discord_queue_tickets
    set
      state = 'released',
      finished_at = clock_timestamp(),
      updated_at = clock_timestamp(),
      lease_owner = null,
      lease_expires_at = null
    where id = v_ticket.id;
    return jsonb_build_object('cancelled', true, 'state', 'released');
  end if;

  return jsonb_build_object('cancelled', false, 'state', v_ticket.state);
end;
$$;
revoke all on function public.discord_worker_cancel_ticket(uuid, text)
  from public, anon, authenticated;
grant execute on function public.discord_worker_cancel_ticket(uuid, text) to service_role;
create or replace function public.discord_worker_get_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not private.is_discord_worker() then
      jsonb_build_array()
    else coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', model.id,
          'display_name', model.display_name,
          'modality', model.modality
        ) order by model.sort_order, model.id
      ),
      '[]'::jsonb
    )
  end
  from public.discord_cloud_models as model
  where model.is_active = true;
$$;
revoke all on function public.discord_worker_get_catalog()
  from public, anon, authenticated;
grant execute on function public.discord_worker_get_catalog() to service_role;
create or replace function private.expire_discord_worker_queue_on_offline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state = 'offline' and old.state is distinct from new.state then
    update public.discord_queue_tickets
    set
      state = 'expired',
      finished_at = clock_timestamp(),
      updated_at = clock_timestamp(),
      lease_owner = null,
      lease_expires_at = null
    where preferred_worker_id = new.worker_id
      and state = 'queued';
  end if;
  return null;
end;
$$;
revoke all on function private.expire_discord_worker_queue_on_offline()
  from public, anon, authenticated;
drop trigger if exists discord_worker_offline_queue_cleanup
  on public.discord_worker_instances;
create trigger discord_worker_offline_queue_cleanup
after update of state on public.discord_worker_instances
for each row execute function private.expire_discord_worker_queue_on_offline();
