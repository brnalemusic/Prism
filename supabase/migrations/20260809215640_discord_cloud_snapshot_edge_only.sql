create or replace function private.get_discord_cloud_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_period_start timestamptz := date_trunc('week', v_now at time zone 'UTC') at time zone 'UTC';
  v_plan_tier text;
  v_limits public.discord_plan_limits%rowtype;
  v_link public.discord_cloud_links%rowtype;
  v_preferences public.discord_cloud_preferences%rowtype;
  v_ticket public.discord_queue_tickets%rowtype;
  v_worker public.discord_worker_instances%rowtype;
  v_used integer := 0;
  v_queue_position integer;
  v_models jsonb;
  v_worker_status text := 'offline';
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;

  v_plan_tier := private.discord_plan_for_user(p_user_id);
  select * into strict v_limits
  from public.discord_plan_limits
  where plan_tier = v_plan_tier;

  select * into v_link
  from public.discord_cloud_links
  where user_id = p_user_id and status <> 'revoked';

  select * into v_preferences
  from public.discord_cloud_preferences
  where user_id = p_user_id;

  select coalesce(voice_seconds_used, 0) into v_used
  from public.discord_usage_periods
  where user_id = p_user_id and period_start = v_period_start;

  select * into v_ticket
  from public.discord_queue_tickets
  where user_id = p_user_id and state in ('queued', 'active')
  order by created_at desc
  limit 1;

  if v_ticket.id is not null and v_ticket.state = 'queued' then
    select count(*)::integer into v_queue_position
    from public.discord_queue_tickets as ticket
    where ticket.plan_tier = v_ticket.plan_tier
      and ticket.state = 'queued'
      and (ticket.ready_at, ticket.created_at, ticket.id)
        <= (v_ticket.ready_at, v_ticket.created_at, v_ticket.id);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', model.id,
        'display_name', model.display_name,
        'modality', model.modality
      ) order by model.sort_order, model.id
    ),
    '[]'::jsonb
  ) into v_models
  from public.discord_cloud_models as model
  where model.is_active = true;

  select * into v_worker
  from public.discord_worker_instances
  where state <> 'offline'
  order by
    (last_heartbeat_at >= v_now - interval '45 seconds') desc,
    (discord_gateway_state = 'connected') desc,
    last_heartbeat_at desc
  limit 1;

  if v_worker.worker_id is not null and v_worker.last_heartbeat_at >= v_now - interval '45 seconds' then
    v_worker_status := case
      when v_worker.discord_gateway_state in ('connecting', 'reconnecting') then 'reconnecting'
      when v_worker.discord_gateway_state <> 'connected' then 'degraded'
      when v_worker.gemini_state in ('degraded', 'unavailable') then 'degraded'
      else 'online'
    end;
  end if;

  return jsonb_build_object(
    'link', case when v_link.id is null then null else jsonb_build_object(
      'id', v_link.id,
      'discord_user_id', v_link.discord_user_id,
      'discord_tag', v_link.discord_tag,
      'status', v_link.status,
      'confirmed_at', v_link.confirmed_at
    ) end,
    'preferences', jsonb_build_object(
      'chat_model_id', coalesce(v_preferences.chat_model_id, 'gemini-3.1-flash-lite'),
      'voice_model_id', coalesce(v_preferences.voice_model_id, 'gemini-3.1-flash-live-preview'),
      'gateway_mode', coalesce(v_preferences.gateway_mode, 'cloud')
    ),
    'models', v_models,
    'voice', jsonb_build_object(
      'plan_tier', v_plan_tier,
      'used_seconds', v_used,
      'limit_seconds', v_limits.weekly_voice_seconds,
      'remaining_seconds', greatest(0, v_limits.weekly_voice_seconds - v_used),
      'period_start', v_period_start,
      'period_ends_at', v_period_start + interval '7 days',
      'pool_capacity', v_limits.pool_capacity,
      'queue_delay_seconds', v_limits.queue_delay_seconds,
      'queue_state', case
        when v_ticket.id is null then null
        when v_ticket.state = 'queued' and v_ticket.ready_at > v_now then 'admission_delay'
        else v_ticket.state
      end,
      'queue_position', v_queue_position,
      'ticket_id', v_ticket.id,
      'eligible_at', v_ticket.ready_at
    ),
    'worker', jsonb_build_object(
      'status', v_worker_status,
      'gateway_state', coalesce(v_worker.discord_gateway_state, 'disconnected'),
      'gemini_state', coalesce(v_worker.gemini_state, 'unknown'),
      'active_sessions', coalesce(v_worker.active_sessions, 0),
      'last_heartbeat_at', v_worker.last_heartbeat_at
    )
  );
end;
$$;
revoke all on function private.get_discord_cloud_snapshot(uuid)
  from public, anon, authenticated;
create or replace function public.discord_edge_get_cloud_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Service authorization required' using errcode = '42501';
  end if;
  return private.get_discord_cloud_snapshot(p_user_id);
end;
$$;
revoke all on function public.discord_edge_get_cloud_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.discord_edge_get_cloud_snapshot(uuid) to service_role;
drop function if exists public.get_discord_cloud_snapshot();
