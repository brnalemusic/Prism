create or replace function public.discord_edge_confirm_link_v2(
  p_user_id uuid,
  p_link_id uuid,
  p_installation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.discord_cloud_links%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Service authorization required' using errcode = '42501';
  end if;

  update public.discord_cloud_links
  set
    status = 'active',
    confirmed_at = clock_timestamp(),
    last_active_at = clock_timestamp()
  where id = p_link_id
    and user_id = p_user_id
    and installation_id = p_installation_id
    and status = 'pending_desktop_confirmation'
    and exists (
      select 1 from public.prism_installations
      where id = p_installation_id and user_id = p_user_id and status = 'active'
    )
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
    p_user_id::text,
    v_link.id::text
  );

  return jsonb_build_object('success', true, 'status', 'active');
end;
$$;
revoke all on function public.discord_edge_confirm_link_v2(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.discord_edge_confirm_link_v2(uuid, uuid, uuid)
  to service_role;
