create or replace function public.discord_worker_get_status(
  p_discord_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_link public.discord_cloud_links%rowtype;
  v_preferences public.discord_cloud_preferences%rowtype;
  v_plan_tier text;
  v_limits public.discord_plan_limits%rowtype;
  v_period_start timestamptz := date_trunc('week', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  v_used integer := 0;
  v_queue_position integer := 0;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  select * into v_link
  from public.discord_cloud_links
  where discord_user_id = p_discord_user_id and status <> 'revoked';

  if not found then
    return jsonb_build_object('linked', false);
  end if;

  select * into v_preferences
  from public.discord_cloud_preferences
  where user_id = v_link.user_id;

  v_plan_tier := private.discord_plan_for_user(v_link.user_id);

  select * into strict v_limits
  from public.discord_plan_limits
  where plan_tier = v_plan_tier;

  select coalesce(voice_seconds_used, 0) into v_used
  from public.discord_usage_periods
  where user_id = v_link.user_id and period_start = v_period_start;

  select count(*) into v_queue_position
  from public.discord_queue_tickets
  where plan_tier = v_plan_tier
    and state = 'queued'
    and created_at <= coalesce((
      select min(created_at)
      from public.discord_queue_tickets
      where user_id = v_link.user_id and state = 'queued'
    ), '-infinity'::timestamptz);

  return jsonb_build_object(
    'linked', true,
    'link_status', v_link.status,
    'user_id', v_link.user_id,
    'installation_id', v_link.installation_id,
    'plan_tier', v_plan_tier,
    'chat_model_id', coalesce(v_preferences.chat_model_id, 'gemini-3.1-flash-lite'),
    'voice_model_id', coalesce(v_preferences.voice_model_id, 'gemini-3.1-flash-live-preview'),
    'voice_used_seconds', v_used,
    'voice_limit_seconds', v_limits.weekly_voice_seconds,
    'voice_remaining_seconds', greatest(0, v_limits.weekly_voice_seconds - v_used),
    'pool_capacity', v_limits.pool_capacity,
    'queue_delay_seconds', v_limits.queue_delay_seconds,
    'queue_position', v_queue_position,
    'period_start', v_period_start,
    'period_ends_at', v_period_start + interval '7 days'
  );
end
$function$;
revoke all on function public.discord_worker_get_status(text)
  from public, anon, authenticated;
grant execute on function public.discord_worker_get_status(text) to service_role;
create or replace function public.discord_worker_set_model(
  p_discord_user_id text,
  p_model_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_link public.discord_cloud_links%rowtype;
  v_model public.discord_cloud_models%rowtype;
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

  select * into v_model
  from public.discord_cloud_models
  where id = p_model_id and modality = 'chat' and is_active = true;

  if not found then
    return jsonb_build_object('success', false, 'error', 'model_not_available');
  end if;

  insert into public.discord_cloud_preferences (user_id, chat_model_id)
  values (v_link.user_id, v_model.id)
  on conflict (user_id) do update
  set chat_model_id = excluded.chat_model_id, updated_at = clock_timestamp();

  return jsonb_build_object(
    'success', true,
    'model_id', v_model.id,
    'display_name', v_model.display_name
  );
end
$function$;
revoke all on function public.discord_worker_set_model(text, text)
  from public, anon, authenticated;
grant execute on function public.discord_worker_set_model(text, text) to service_role;
create or replace function public.discord_worker_get_session(
  p_user_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session public.discord_session_index%rowtype;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;

  select * into v_session
  from public.discord_session_index
  where id = p_session_id and user_id = p_user_id;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object('found', true, 'session', to_jsonb(v_session));
end
$function$;
revoke all on function public.discord_worker_get_session(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.discord_worker_get_session(uuid, uuid) to service_role;
create or replace function public.discord_worker_list_sessions(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_sessions jsonb;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
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
    where user_id = p_user_id
    order by updated_at desc
    limit 50
  ) as session_row;

  return v_sessions;
end
$function$;
revoke all on function public.discord_worker_list_sessions(uuid)
  from public, anon, authenticated;
grant execute on function public.discord_worker_list_sessions(uuid) to service_role;
