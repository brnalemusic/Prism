-- Prism Discord Cloud v2 private Realtime control channel.
-- Broadcast payloads contain control metadata only. They never contain Discord
-- messages, prompts, model output, transcripts, or audio.

drop policy if exists "discord users receive own control broadcasts"
  on realtime.messages;
create policy "discord users receive own control broadcasts"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) = 'discord-control:' || (select auth.uid())::text
);
create or replace function public.broadcast_discord_control_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_data jsonb;
  target_user_id uuid;
  record_id text;
begin
  record_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  target_user_id := nullif(record_data ->> 'user_id', '')::uuid;

  if target_user_id is null then
    return null;
  end if;

  record_id := coalesce(
    nullif(record_data ->> 'id', ''),
    nullif(record_data ->> 'period_start', ''),
    target_user_id::text
  );

  perform realtime.send(
    jsonb_build_object(
      'table', tg_table_name,
      'operation', tg_op,
      'recordId', record_id,
      'occurredAt', clock_timestamp()
    ),
    'control_changed',
    'discord-control:' || target_user_id::text,
    false
  );

  return null;
end;
$$;
revoke all on function public.broadcast_discord_control_change() from public;
revoke all on function public.broadcast_discord_control_change() from anon;
revoke all on function public.broadcast_discord_control_change() from authenticated;
drop trigger if exists discord_cloud_preferences_control_broadcast
  on public.discord_cloud_preferences;
create trigger discord_cloud_preferences_control_broadcast
after insert or update or delete on public.discord_cloud_preferences
for each row execute function public.broadcast_discord_control_change();
drop trigger if exists discord_link_challenges_control_broadcast
  on public.discord_link_challenges;
create trigger discord_link_challenges_control_broadcast
after insert or update or delete on public.discord_link_challenges
for each row execute function public.broadcast_discord_control_change();
drop trigger if exists discord_cloud_links_control_broadcast
  on public.discord_cloud_links;
create trigger discord_cloud_links_control_broadcast
after insert or update or delete on public.discord_cloud_links
for each row execute function public.broadcast_discord_control_change();
drop trigger if exists discord_usage_periods_control_broadcast
  on public.discord_usage_periods;
create trigger discord_usage_periods_control_broadcast
after insert or update or delete on public.discord_usage_periods
for each row execute function public.broadcast_discord_control_change();
drop trigger if exists discord_queue_tickets_control_broadcast
  on public.discord_queue_tickets;
create trigger discord_queue_tickets_control_broadcast
after insert or update or delete on public.discord_queue_tickets
for each row execute function public.broadcast_discord_control_change();
drop trigger if exists discord_voice_sessions_control_broadcast
  on public.discord_voice_sessions;
create trigger discord_voice_sessions_control_broadcast
after insert or update or delete on public.discord_voice_sessions
for each row execute function public.broadcast_discord_control_change();
drop trigger if exists discord_session_index_control_broadcast
  on public.discord_session_index;
create trigger discord_session_index_control_broadcast
after insert or update or delete on public.discord_session_index
for each row execute function public.broadcast_discord_control_change();
