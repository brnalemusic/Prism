alter table public.discord_queue_tickets add column if not exists chat_quota_consumed_at timestamptz;

create or replace function public.discord_worker_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_bot_token text;
  v_gemini_keys jsonb;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;
  select decrypted_secret into v_bot_token from vault.decrypted_secrets where name = 'discord_cloud_bot_token';
  select coalesce(jsonb_agg(key_value order by created_at, id), '[]'::jsonb) into v_gemini_keys from public.prism_api_keys where is_active = true and key_value <> '';
  if v_bot_token is null or jsonb_array_length(v_gemini_keys) = 0 then
    raise exception 'Discord Cloud secrets are not provisioned';
  end if;
  return jsonb_build_object('discord_bot_token', v_bot_token, 'gemini_api_keys', v_gemini_keys);
end
$function$;

create or replace function public.discord_worker_authorize_chat(p_ticket_id uuid, p_worker_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ticket public.discord_queue_tickets%rowtype;
  v_usage jsonb;
begin
  if not private.is_discord_worker() then
    raise exception 'Discord worker authorization required' using errcode = '42501';
  end if;
  select * into v_ticket from public.discord_queue_tickets where id = p_ticket_id for update;
  if not found or v_ticket.session_kind <> 'chat' or v_ticket.state <> 'active' or v_ticket.lease_owner is distinct from p_worker_id or v_ticket.lease_expires_at <= clock_timestamp() then
    raise exception 'Chat ticket is not actively leased by this worker' using errcode = '42501';
  end if;
  if v_ticket.chat_quota_consumed_at is not null then
    return jsonb_build_object('allowed', true, 'already_authorized', true);
  end if;
  select public.check_and_increment_ai_usage(v_ticket.user_id) into v_usage;
  if coalesce((v_usage ->> 'allowed')::boolean, false) then
    update public.discord_queue_tickets set chat_quota_consumed_at = clock_timestamp(), updated_at = clock_timestamp() where id = v_ticket.id;
  end if;
  return v_usage;
end
$function$;

revoke all on function public.discord_worker_bootstrap() from public, anon, authenticated;
grant execute on function public.discord_worker_bootstrap() to service_role;
revoke all on function public.discord_worker_authorize_chat(uuid, text) from public, anon, authenticated;
grant execute on function public.discord_worker_authorize_chat(uuid, text) to service_role;;
