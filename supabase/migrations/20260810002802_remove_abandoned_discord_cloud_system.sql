
set lock_timeout = '5s';
set statement_timeout = '60s';

do $$
declare job_record record;
begin
  for job_record in
    select jobid from cron.job
    where jobname in ('prism-discord-cloud-v2-cleanup','prism-discord-link-rate-retention')
  loop
    perform cron.unschedule(job_record.jobid);
  end loop;
end
$$;

drop trigger if exists discord_cloud_links_control_broadcast on public.discord_cloud_links;
drop trigger if exists discord_cloud_preferences_control_broadcast on public.discord_cloud_preferences;
drop trigger if exists discord_link_challenges_control_broadcast on public.discord_link_challenges;
drop trigger if exists discord_queue_tickets_control_broadcast on public.discord_queue_tickets;
drop trigger if exists discord_session_index_control_broadcast on public.discord_session_index;
drop trigger if exists discord_usage_periods_control_broadcast on public.discord_usage_periods;
drop trigger if exists discord_voice_sessions_control_broadcast on public.discord_voice_sessions;
drop trigger if exists discord_worker_offline_queue_cleanup on public.discord_worker_instances;

do $$
declare function_record record;
begin
  for function_record in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private')
      and (
        p.proname like 'discord_%'
        or p.proname like '%_discord_%'
        or p.proname = 'broadcast_discord_control_change'
      )
    order by n.nspname, p.proname, p.oid
  loop
    execute format('drop function if exists %s', function_record.signature);
  end loop;
end
$$;

drop table if exists public.discord_outbound_idempotency;
drop table if exists public.discord_voice_sessions;
drop table if exists public.discord_session_index;
drop table if exists public.discord_queue_tickets;
drop table if exists public.discord_usage_periods;
drop table if exists public.discord_cloud_preferences;
drop table if exists public.discord_cloud_links;
drop table if exists public.discord_link_challenges;
drop table if exists public.discord_link_attempts;
drop table if exists public.discord_link_ip_rate_limits;
drop table if exists public.discord_control_audit;
drop table if exists public.discord_interaction_states;
drop table if exists public.discord_worker_instances;
drop table if exists public.discord_cloud_models;
drop table if exists public.discord_plan_limits;
drop table if exists public.prism_installations;

delete from vault.secrets
where name in ('discord_cloud_bot_token','discord_link_pepper');

drop extension if exists pg_cron;
;
