do $fix$
declare
  v_signature regprocedure;
  v_definition text;
  v_updated text;
begin
  foreach v_signature in array array[
    'private.issue_discord_link_challenge(uuid,uuid)'::regprocedure,
    'private.issue_discord_link_challenge(uuid,uuid,text)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_signature) into v_definition;
    v_updated := replace(
      v_definition,
      'get_byte(v_random, 0) * 16777216',
      'get_byte(v_random, 0)::bigint * 16777216'
    );
    if v_updated = v_definition then
      raise exception 'Expected link-code expression was not found in %', v_signature;
    end if;
    execute v_updated;
  end loop;
end;
$fix$;
