
alter table public.pending_checkout_sessions
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists pending_checkout_sessions_user_id_idx
  on public.pending_checkout_sessions (user_id);

update public.pending_checkout_sessions as pcs
set user_id = users.id
from auth.users as users
where pcs.user_id is null
  and pcs.user_email is not null
  and lower(pcs.user_email) = lower(users.email);

update public.user_licenses as licenses
set user_id = users.id
from auth.users as users
where licenses.user_id is null
  and licenses.user_email is not null
  and lower(licenses.user_email) = lower(users.email);

insert into public.subscription_plans (
  id,
  name,
  description,
  price_usd,
  billing_interval,
  duration_days,
  seats,
  is_active
)
values (
  'enterprise_local',
  'Enterprise Local License',
  'Internal plan used for signed Enterprise license keys.',
  0,
  'license',
  1,
  1,
  false
)
on conflict (id) do nothing;

create or replace function public.get_user_ai_usage_status(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_now timestamptz := now();
  v_rec record;
  v_tier text;
  v_limits record;
  v_count_5h integer := 0;
  v_count_1w integer := 0;
  v_reset_5h_sec integer := 0;
  v_reset_1w_sec integer := 0;
begin
  select case when exists (
    select 1
    from public.user_licenses as licenses
    where licenses.user_id = p_user_id
      and licenses.status = 'active'
      and (licenses.expires_at is null or licenses.expires_at > v_now)
      and licenses.plan_id like 'enterprise%'
  ) then 'enterprise' else 'free' end
  into v_tier;

  select max_5h, max_7d
  into v_limits
  from public.ai_rate_limits
  where tier = v_tier;

  if not found then
    v_tier := 'free';
    v_limits.max_5h := 20;
    v_limits.max_7d := 120;
  end if;

  select *
  into v_rec
  from public.user_ai_usage
  where user_id = p_user_id;

  if found then
    if v_rec.window_5h_start is not null and v_now < v_rec.window_5h_start + interval '5 hours' then
      v_count_5h := v_rec.count_5h;
      v_reset_5h_sec := greatest(0, floor(extract(epoch from (v_rec.window_5h_start + interval '5 hours' - v_now)))::integer);
    end if;

    if v_rec.window_1w_start is not null and v_now < v_rec.window_1w_start + interval '7 days' then
      v_count_1w := v_rec.count_1w;
      v_reset_1w_sec := greatest(0, floor(extract(epoch from (v_rec.window_1w_start + interval '7 days' - v_now)))::integer);
    end if;
  end if;

  return jsonb_build_object(
    'tier', v_tier,
    'count_5h', v_count_5h,
    'count_1w', v_count_1w,
    'remaining_5h', greatest(0, v_limits.max_5h - v_count_5h),
    'remaining_1w', greatest(0, v_limits.max_7d - v_count_1w),
    'max_5h', v_limits.max_5h,
    'max_1w', v_limits.max_7d,
    'reset_5h_seconds', v_reset_5h_sec,
    'reset_1w_seconds', v_reset_1w_sec
  );
end;
$function$;

create or replace function public.check_and_increment_ai_usage(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_now timestamptz := now();
  v_rec record;
  v_window_5h_start timestamptz;
  v_count_5h integer;
  v_window_1w_start timestamptz;
  v_count_1w integer;
  v_tier text;
  v_limits record;
begin
  select case when exists (
    select 1
    from public.user_licenses as licenses
    where licenses.user_id = p_user_id
      and licenses.status = 'active'
      and (licenses.expires_at is null or licenses.expires_at > v_now)
      and licenses.plan_id like 'enterprise%'
  ) then 'enterprise' else 'free' end
  into v_tier;

  select max_5h, max_7d
  into v_limits
  from public.ai_rate_limits
  where tier = v_tier;

  if not found then
    v_tier := 'free';
    v_limits.max_5h := 20;
    v_limits.max_7d := 120;
  end if;

  select *
  into v_rec
  from public.user_ai_usage
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.user_ai_usage (
      user_id,
      window_5h_start,
      count_5h,
      window_1w_start,
      count_1w,
      updated_at
    )
    values (p_user_id, v_now, 1, v_now, 1, v_now);

    return jsonb_build_object(
      'allowed', true,
      'tier', v_tier,
      'count_5h', 1,
      'count_1w', 1,
      'remaining_5h', v_limits.max_5h - 1,
      'remaining_1w', v_limits.max_7d - 1,
      'max_5h', v_limits.max_5h,
      'max_7d', v_limits.max_7d
    );
  end if;

  if v_now >= v_rec.window_5h_start + interval '5 hours' then
    v_window_5h_start := v_now;
    v_count_5h := 1;
  else
    v_window_5h_start := v_rec.window_5h_start;
    v_count_5h := v_rec.count_5h + 1;
  end if;

  if v_now >= v_rec.window_1w_start + interval '7 days' then
    v_window_1w_start := v_now;
    v_count_1w := 1;
  else
    v_window_1w_start := v_rec.window_1w_start;
    v_count_1w := v_rec.count_1w + 1;
  end if;

  if v_count_5h > v_limits.max_5h then
    return jsonb_build_object(
      'allowed', false,
      'reason', '5h_limit_exceeded',
      'tier', v_tier,
      'count_5h', v_rec.count_5h,
      'count_1w', v_rec.count_1w,
      'remaining_5h', 0,
      'remaining_1w', greatest(0, v_limits.max_7d - v_rec.count_1w),
      'max_5h', v_limits.max_5h,
      'max_7d', v_limits.max_7d
    );
  end if;

  if v_count_1w > v_limits.max_7d then
    return jsonb_build_object(
      'allowed', false,
      'reason', '7d_limit_exceeded',
      'tier', v_tier,
      'count_5h', v_rec.count_5h,
      'count_1w', v_rec.count_1w,
      'remaining_5h', greatest(0, v_limits.max_5h - v_rec.count_5h),
      'remaining_1w', 0,
      'max_5h', v_limits.max_5h,
      'max_7d', v_limits.max_7d
    );
  end if;

  update public.user_ai_usage
  set
    window_5h_start = v_window_5h_start,
    count_5h = v_count_5h,
    window_1w_start = v_window_1w_start,
    count_1w = v_count_1w,
    updated_at = v_now
  where user_id = p_user_id;

  return jsonb_build_object(
    'allowed', true,
    'tier', v_tier,
    'count_5h', v_count_5h,
    'count_1w', v_count_1w,
    'remaining_5h', v_limits.max_5h - v_count_5h,
    'remaining_1w', v_limits.max_7d - v_count_1w,
    'max_5h', v_limits.max_5h,
    'max_7d', v_limits.max_7d
  );
end;
$function$;

revoke all on function public.get_user_ai_usage_status(uuid) from public, anon, authenticated;
grant execute on function public.get_user_ai_usage_status(uuid) to service_role;

revoke all on function public.check_and_increment_ai_usage(uuid) from public, anon, authenticated;
grant execute on function public.check_and_increment_ai_usage(uuid) to service_role;
;
