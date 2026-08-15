-- Migration: prism_web_account_activation
-- Implements account activations, one-time verification codes with sliding window rate limits, and fixes RPC search_paths & permissions.

-- 1. Account Activations Table
CREATE TABLE IF NOT EXISTS public.account_activations (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')) DEFAULT 'inactive',
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.account_activations ENABLE ROW LEVEL SECURITY;
-- No public/authenticated policies: access exclusively via backend service_role / security definer

-- 2. Activation Codes Table (HMAC-SHA-256 hashed with server-side pepper)
CREATE TABLE IF NOT EXISTS public.account_activation_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_activation_codes_lookup
  ON public.account_activation_codes (user_id, expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE public.account_activation_codes ENABLE ROW LEVEL SECURITY;
-- No public/authenticated policies: access exclusively via backend service_role / security definer

-- 3. Activation Verification Attempts Table (for sliding window rate limiting)
CREATE TABLE IF NOT EXISTS public.account_activation_attempts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_activation_attempts_window
  ON public.account_activation_attempts (user_id, attempted_at DESC);

ALTER TABLE public.account_activation_attempts ENABLE ROW LEVEL SECURITY;
-- No public/authenticated policies: access exclusively via backend service_role / security definer

-- 4. Initial Backfill: Set all existing users in auth.users to 'inactive'
INSERT INTO public.account_activations (user_id, status, created_at, updated_at)
SELECT id, 'inactive', now(), now()
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- 5. Updated handle_new_user trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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

  insert into public.account_activations (
    user_id,
    status,
    created_at,
    updated_at
  )
  values (
    new.id,
    'inactive',
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (user_id) do nothing;

  return new;
end;
$function$;

-- 6. Cleanup legacy overloads
DROP FUNCTION IF EXISTS public.check_and_increment_ai_usage(uuid);
DROP FUNCTION IF EXISTS public.get_user_ai_usage_status();

-- 7. Hardened check_and_increment_ai_usage with fixed search_path
CREATE OR REPLACE FUNCTION public.check_and_increment_ai_usage(p_user_id uuid, p_model text DEFAULT 'legacy'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_now timestamptz := clock_timestamp();
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
  where tier = v_tier and model_id = p_model;

  if not found then
    v_tier := 'free';
    v_limits.max_5h := 20;
    v_limits.max_7d := 120;
  end if;

  select *
  into v_rec
  from public.user_ai_usage
  where user_id = p_user_id and model_id = p_model
  for update;

  if not found then
    insert into public.user_ai_usage (
      user_id,
      model_id,
      window_5h_start,
      count_5h,
      window_1w_start,
      count_1w,
      updated_at
    )
    values (p_user_id, p_model, v_now, 1, v_now, 1, v_now);

    return jsonb_build_object(
      'allowed', true,
      'tier', v_tier,
      'model_id', p_model,
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
      'model_id', p_model,
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
      'model_id', p_model,
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
  where user_id = p_user_id and model_id = p_model;

  return jsonb_build_object(
    'allowed', true,
    'tier', v_tier,
    'model_id', p_model,
    'count_5h', v_count_5h,
    'count_1w', v_count_1w,
    'remaining_5h', v_limits.max_5h - v_count_5h,
    'remaining_1w', v_limits.max_7d - v_count_1w,
    'max_5h', v_limits.max_5h,
    'max_7d', v_limits.max_7d
  );
end;
$function$;

-- 8. Hardened get_user_ai_usage_status with fixed search_path
CREATE OR REPLACE FUNCTION public.get_user_ai_usage_status(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_tier text;
  v_result jsonb := '[]'::jsonb;
  v_limit record;
  v_usage record;
  v_count_5h integer;
  v_count_1w integer;
  v_reset_5h_sec integer;
  v_reset_1w_sec integer;
  v_model_obj jsonb;
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

  for v_limit in select model_id, max_5h, max_7d from public.ai_rate_limits where tier = v_tier loop
    v_count_5h := 0;
    v_count_1w := 0;
    v_reset_5h_sec := 0;
    v_reset_1w_sec := 0;

    select * into v_usage from public.user_ai_usage where user_id = p_user_id and model_id = v_limit.model_id;

    if found then
      if v_usage.window_5h_start is not null and v_now < v_usage.window_5h_start + interval '5 hours' then
        v_count_5h := v_usage.count_5h;
        v_reset_5h_sec := greatest(0, floor(extract(epoch from (v_usage.window_5h_start + interval '5 hours' - v_now)))::integer);
      end if;

      if v_usage.window_1w_start is not null and v_now < v_usage.window_1w_start + interval '7 days' then
        v_count_1w := v_usage.count_1w;
        v_reset_1w_sec := greatest(0, floor(extract(epoch from (v_usage.window_1w_start + interval '7 days' - v_now)))::integer);
      end if;
    end if;

    v_model_obj := jsonb_build_object(
      'model_id', v_limit.model_id,
      'tier', v_tier,
      'count_5h', v_count_5h,
      'count_1w', v_count_1w,
      'remaining_5h', greatest(0, v_limit.max_5h - v_count_5h),
      'remaining_1w', greatest(0, v_limit.max_7d - v_count_1w),
      'max_5h', v_limit.max_5h,
      'max_1w', v_limit.max_7d,
      'reset_5h_seconds', v_reset_5h_sec,
      'reset_1w_seconds', v_reset_1w_sec
    );
    v_result := v_result || v_model_obj;
  end loop;

  return v_result;
end;
$function$;

-- 9. Revoke public/anon/authenticated execution on internal quota RPCs
REVOKE EXECUTE ON FUNCTION public.check_and_increment_ai_usage(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_ai_usage_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_ai_usage(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_ai_usage_status(uuid) TO service_role;
