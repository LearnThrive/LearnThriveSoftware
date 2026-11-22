-- 0031_server_role_grants.sql — let the site's database role reach the tables added after the role was last refreshed.
--
-- The site connects as the narrow role `learnthrive_server` (apps/web/scripts/create-server-role.mjs), which is granted table by table: a table made by a
-- later migration is NOT reachable until the role is refreshed or granted here. Migrations 0028 (staff meetings) and 0029 (the lesson file bytes) added
-- three tables and nothing granted them, so People -> Meetings failed with "permission denied for table staff_meetings" and lesson file uploads would have.
-- Same grant the role script makes for every table. A database without that role (a local test one) skips it. Re-runnable.

do $$
begin
  if exists (select from pg_roles where rolname = 'learnthrive_server') then
    grant select, insert, update, delete on public.staff_meetings, public.staff_meeting_invitees, public.lesson_file_objects to learnthrive_server;
  end if;
end
$$;
