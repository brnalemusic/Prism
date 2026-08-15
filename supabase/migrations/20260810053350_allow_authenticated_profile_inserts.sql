create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);;
