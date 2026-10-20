-- 0005_rls.sql — grants, helper functions and Row Level Security for EVERY table.
--
-- Model
--   * The family boundary is public.clients: a signed-in profile owns at most one client row, and a
--     user may touch only rows that belong to that client (or, for consents, to their own profile).
--   * anon (not signed in) may read the published catalogue (public.resources) and nothing else.
--   * authenticated gets the narrowest grants that work: COLUMN-level INSERT/UPDATE grants, so a
--     user can never write a column that decides access (role, owner, family, deadlines, ...).
--     Policies still carry USING + WITH CHECK, so even if a column grant were widened later, a row
--     could not be moved to another family. (rls.test.ts proves this by widening the grant.)
--   * service_role (the server key) bypasses RLS and is the only writer of billing, entitlements,
--     downloads, webhooks, admin grants, resource files, chat messages and chat files.
--   * RLS is ENABLED on every table. It is also FORCED on every table that no SECURITY DEFINER
--     helper reads (a forced policy would otherwise apply to the helper's own owner).
--
-- Helpers are SECURITY DEFINER with an empty search_path and fully qualified names, live in the
-- private schema (not exposed by the API) and are executable by signed-in users and the server only.

-- ---------------------------------------------------------------------------------------------
-- Start from nothing for the client-facing roles, then grant exactly what is needed below.
-- ---------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
-- Cannot be spoofed: auth.uid() comes from the signed JWT, and profiles.role is not writable by
-- any API role (no UPDATE grant on the column, no INSERT grant on the table).
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'
  )
$$;

create or replace function private.is_adult_confirmed() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.adult_confirmed_at is not null
  )
$$;

create or replace function private.my_client_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select c.id from public.clients c where c.owner_profile_id = auth.uid()
$$;

create or replace function private.my_tutor_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select t.id from public.tutors t where t.profile_id = auth.uid()
$$;

-- True when the student is linked to the caller's family account (owner or second guardian).
create or replace function private.student_in_my_family(p_student_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.client_students cs
    where cs.student_id = p_student_id and cs.client_id = private.my_client_id()
  )
$$;

-- True when the caller is the tutor on the assignment.
create or replace function private.is_my_assignment(p_assignment_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tuition_assignments a
    where a.id = p_assignment_id and a.tutor_id = private.my_tutor_id()
  )
$$;

-- True when one of the caller's family's students is on the assignment.
create or replace function private.assignment_in_my_family(p_assignment_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.assignment_students s
    join public.client_students cs on cs.student_id = s.student_id
    where s.assignment_id = p_assignment_id and cs.client_id = private.my_client_id()
  )
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- Enrolment is DERIVED, not stored: a family is enrolled while a student linked to it is on an
-- ACTIVE tuition assignment. The server mirrors this into entitlements (source 'enrolled'). Server only.
create or replace function public.client_is_enrolled(p_client_id uuid) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from public.client_students cs
    join public.assignment_students s on s.student_id = cs.student_id
    join public.tuition_assignments a on a.id = s.assignment_id
    where cs.client_id = p_client_id and a.status = 'ACTIVE'
  )
$$;
revoke execute on function public.client_is_enrolled(uuid) from public, anon, authenticated;
grant execute on function public.client_is_enrolled(uuid) to service_role;

-- "Delete this chat": hides it from the owner at once and queues it for the retention job, which
-- purges the rows AND the private storage objects. A SECURITY DEFINER function rather than a column
-- grant because Postgres re-applies the SELECT policy to an UPDATE's new row, so a user could not
-- update a chat into the hidden state; and so there is no column a user could clear to "undelete".
create or replace function public.request_chat_deletion(p_session_id uuid) returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  affected integer;
begin
  update public.chat_sessions s
     set deletion_requested_at = now()
   where s.id = p_session_id
     and s.client_id = private.my_client_id()
     and s.deletion_requested_at is null;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke execute on function public.request_chat_deletion(uuid) from public, anon;
grant execute on function public.request_chat_deletion(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Enable (and where safe force) RLS on every table
-- ---------------------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.tutors enable row level security;
alter table public.clients enable row level security;
alter table public.students enable row level security;
alter table public.client_students enable row level security;
alter table public.tuition_assignments enable row level security;
alter table public.assignment_students enable row level security;
alter table public.consents enable row level security;
alter table public.resources enable row level security;
alter table public.resource_files enable row level security;
alter table public.billing_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.admin_grants enable row level security;
alter table public.entitlements enable row level security;
alter table public.download_events enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_files enable row level security;
alter table public.usage_counters enable row level security;

-- Not read by any SECURITY DEFINER helper: force, so even the table owner is subject to policies.
alter table public.consents force row level security;
alter table public.resources force row level security;
alter table public.resource_files force row level security;
alter table public.billing_customers force row level security;
alter table public.subscriptions force row level security;
alter table public.admin_grants force row level security;
alter table public.entitlements force row level security;
alter table public.download_events force row level security;
alter table public.stripe_webhook_events force row level security;
alter table public.chat_sessions force row level security;
alter table public.chat_messages force row level security;
alter table public.chat_files force row level security;
alter table public.usage_counters force row level security;

-- ---------------------------------------------------------------------------------------------
-- Grants. Column lists are deliberate: anything not listed cannot be written by a user.
-- ---------------------------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

-- anon: the published catalogue, nothing else. (No file paths live in this table.)
grant select on public.resources to anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

grant select on public.tutors to authenticated;

grant select on public.clients to authenticated;
grant insert (owner_profile_id) on public.clients to authenticated;

grant select on public.students to authenticated;
grant insert (client_id, display_name, year_group) on public.students to authenticated;
grant update (display_name, year_group) on public.students to authenticated;
grant delete on public.students to authenticated;

grant select on public.client_students to authenticated;
grant select on public.tuition_assignments to authenticated;
grant select on public.assignment_students to authenticated;

grant select on public.consents to authenticated;
grant insert (profile_id, student_id, kind, version, text_sha256) on public.consents to authenticated;
grant update (withdrawn_at) on public.consents to authenticated;

grant select on public.subscriptions to authenticated;
grant select on public.entitlements to authenticated;
grant select on public.usage_counters to authenticated;

grant select on public.chat_sessions to authenticated;
grant insert (client_id, student_id, title) on public.chat_sessions to authenticated;
grant update (title) on public.chat_sessions to authenticated;
grant select on public.chat_messages to authenticated;
grant select on public.chat_files to authenticated;

-- No grants at all (deny-all for anon and authenticated; service_role only):
--   resource_files, billing_customers, admin_grants, download_events, stripe_webhook_events.

-- ---------------------------------------------------------------------------------------------
-- Policies. Written as: drop if exists + create, so the file can be applied again.
-- (select auth.uid()) / (select private.fn()) lets Postgres evaluate them once per statement.
-- ---------------------------------------------------------------------------------------------

-- profiles ------------------------------------------------------------------------------------
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_admin_read on public.profiles;
create policy profiles_admin_read on public.profiles for select to authenticated
  using ((select private.is_admin()));

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- tutors --------------------------------------------------------------------------------------
drop policy if exists tutors_self_read on public.tutors;
create policy tutors_self_read on public.tutors for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists tutors_admin_read on public.tutors;
create policy tutors_admin_read on public.tutors for select to authenticated
  using ((select private.is_admin()));

-- clients -------------------------------------------------------------------------------------
drop policy if exists clients_owner_read on public.clients;
create policy clients_owner_read on public.clients for select to authenticated
  using (owner_profile_id = (select auth.uid()));

drop policy if exists clients_admin_read on public.clients;
create policy clients_admin_read on public.clients for select to authenticated
  using ((select private.is_admin()));

-- The billing holder is an adult: a family account can be opened only after the adult declaration.
drop policy if exists clients_owner_insert on public.clients;
create policy clients_owner_insert on public.clients for insert to authenticated
  with check (owner_profile_id = (select auth.uid()) and (select private.is_adult_confirmed()));

-- students ------------------------------------------------------------------------------------
-- The owner clause reads the row's own column (so INSERT ... RETURNING works); the helper covers
-- a second guardian linked through client_students.
drop policy if exists students_family_read on public.students;
create policy students_family_read on public.students for select to authenticated
  using (client_id = (select private.my_client_id()) or (select private.student_in_my_family(id)));

drop policy if exists students_admin_read on public.students;
create policy students_admin_read on public.students for select to authenticated
  using ((select private.is_admin()));

drop policy if exists students_owner_insert on public.students;
create policy students_owner_insert on public.students for insert to authenticated
  with check (client_id = (select private.my_client_id()));

-- Only the owning family edits a student; a second guardian can read but not change.
drop policy if exists students_owner_update on public.students;
create policy students_owner_update on public.students for update to authenticated
  using (client_id = (select private.my_client_id()))
  with check (client_id = (select private.my_client_id()));

drop policy if exists students_owner_delete on public.students;
create policy students_owner_delete on public.students for delete to authenticated
  using (client_id = (select private.my_client_id()));

-- client_students -----------------------------------------------------------------------------
drop policy if exists client_students_family_read on public.client_students;
create policy client_students_family_read on public.client_students for select to authenticated
  using (client_id = (select private.my_client_id()));

drop policy if exists client_students_admin_read on public.client_students;
create policy client_students_admin_read on public.client_students for select to authenticated
  using ((select private.is_admin()));

-- tuition_assignments / assignment_students ---------------------------------------------------
drop policy if exists tuition_assignments_visible_read on public.tuition_assignments;
create policy tuition_assignments_visible_read on public.tuition_assignments for select to authenticated
  using (
    (select private.is_my_assignment(id))
    or (select private.assignment_in_my_family(id))
    or (select private.is_admin())
  );

-- A family sees only the rows for its OWN students (a group assignment does not reveal who else is on it).
drop policy if exists assignment_students_visible_read on public.assignment_students;
create policy assignment_students_visible_read on public.assignment_students for select to authenticated
  using (
    (select private.student_in_my_family(student_id))
    or (select private.is_my_assignment(assignment_id))
    or (select private.is_admin())
  );

-- consents ------------------------------------------------------------------------------------
drop policy if exists consents_self_read on public.consents;
create policy consents_self_read on public.consents for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists consents_self_insert on public.consents;
create policy consents_self_insert on public.consents for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and (student_id is null or (select private.student_in_my_family(student_id)))
  );

drop policy if exists consents_self_withdraw on public.consents;
create policy consents_self_withdraw on public.consents for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (
    profile_id = (select auth.uid())
    and (student_id is null or (select private.student_in_my_family(student_id)))
  );

-- resources (catalogue) -----------------------------------------------------------------------
drop policy if exists resources_public_read on public.resources;
create policy resources_public_read on public.resources for select to anon, authenticated
  using (published_at is not null and published_at <= now());

drop policy if exists resources_admin_read on public.resources;
create policy resources_admin_read on public.resources for select to authenticated
  using ((select private.is_admin()));

-- resource_files, billing_customers, admin_grants, download_events, stripe_webhook_events:
-- intentionally NO policy and NO grant. Deny-all for anon and authenticated; the server uses
-- service_role, which bypasses RLS.

-- subscriptions / entitlements / usage_counters (read own family; the server writes) ------------
drop policy if exists subscriptions_family_read on public.subscriptions;
create policy subscriptions_family_read on public.subscriptions for select to authenticated
  using (client_id = (select private.my_client_id()));

drop policy if exists subscriptions_admin_read on public.subscriptions;
create policy subscriptions_admin_read on public.subscriptions for select to authenticated
  using ((select private.is_admin()));

drop policy if exists entitlements_family_read on public.entitlements;
create policy entitlements_family_read on public.entitlements for select to authenticated
  using (client_id = (select private.my_client_id()));

drop policy if exists entitlements_admin_read on public.entitlements;
create policy entitlements_admin_read on public.entitlements for select to authenticated
  using ((select private.is_admin()));

drop policy if exists usage_counters_family_read on public.usage_counters;
create policy usage_counters_family_read on public.usage_counters for select to authenticated
  using (client_id = (select private.my_client_id()));

-- chat_sessions -------------------------------------------------------------------------------
-- Admins deliberately get NO read access to chats (children's conversations): the server reads
-- them only for a safeguarding flag, with the service role.
drop policy if exists chat_sessions_family_read on public.chat_sessions;
create policy chat_sessions_family_read on public.chat_sessions for select to authenticated
  using (client_id = (select private.my_client_id()) and deletion_requested_at is null);

drop policy if exists chat_sessions_family_insert on public.chat_sessions;
create policy chat_sessions_family_insert on public.chat_sessions for insert to authenticated
  with check (
    client_id = (select private.my_client_id())
    and (student_id is null or (select private.student_in_my_family(student_id)))
  );

drop policy if exists chat_sessions_family_update on public.chat_sessions;
create policy chat_sessions_family_update on public.chat_sessions for update to authenticated
  using (client_id = (select private.my_client_id()) and deletion_requested_at is null)
  with check (
    client_id = (select private.my_client_id())
    and (student_id is null or (select private.student_in_my_family(student_id)))
  );

-- chat_messages / chat_files: visible exactly when their session is visible (the subquery runs
-- under the caller's own RLS on chat_sessions, so a chat marked for deletion disappears too).
drop policy if exists chat_messages_family_read on public.chat_messages;
create policy chat_messages_family_read on public.chat_messages for select to authenticated
  using (exists (select 1 from public.chat_sessions s where s.id = chat_messages.session_id));

drop policy if exists chat_files_family_read on public.chat_files;
create policy chat_files_family_read on public.chat_files for select to authenticated
  using (exists (select 1 from public.chat_sessions s where s.id = chat_files.session_id));
