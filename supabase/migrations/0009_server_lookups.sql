-- Two lookups the server needs from Supabase Auth, as functions instead of table access (plan20, found on the real stack).
--
-- The site's database role (learnthrive_server) must not touch the auth schema: auth.users holds password hashes, tokens and every
-- person's metadata, and the postgres role is not allowed to hand out access to the auth SCHEMA anyway (it has no grant option on
-- it). The server only ever needs a person's sign-in email and, for the operator scripts, whether an address belongs to a confirmed
-- account. These two SECURITY DEFINER functions give exactly that and nothing else, in the same style as the other helpers: fixed
-- search_path, schema-qualified names, closed to anon, authenticated and PUBLIC, open to the service role (and, by the script that
-- creates the narrow role, to learnthrive_server). Re-runnable.

create or replace function public.auth_email(p_profile uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text from auth.users u where u.id = p_profile
$$;

create or replace function public.auth_user_by_email(p_email text) returns table (id uuid, email_confirmed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email_confirmed_at is not null from auth.users u where lower(u.email) = lower(p_email) limit 1
$$;

comment on function public.auth_email(uuid) is 'The sign-in email of a profile (billing emails). Server only: the narrow server role never reads the auth schema directly.';
comment on function public.auth_user_by_email(text) is 'The profile id and whether the address is confirmed, for the operator scripts. Server only.';

revoke all on function public.auth_email(uuid) from public, anon, authenticated;
revoke all on function public.auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_email(uuid) to service_role;
grant execute on function public.auth_user_by_email(text) to service_role;
