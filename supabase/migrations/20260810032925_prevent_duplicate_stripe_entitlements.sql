
create unique index if not exists user_licenses_stripe_session_id_unique
  on public.user_licenses (stripe_session_id)
  where stripe_session_id is not null;
;
