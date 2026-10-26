-- 0010_learner_identity.sql — a learner can have their own login, bound to an existing student record by a guardian's invitation.
--
-- Before this, `students` had no authentication link: every child was a row under an adult's family account and nobody else could
-- sign in as them. This adds (all forward, re-runnable, nothing renamed or dropped):
--
--   learner_identities   one auth profile <-> one student, 1:1 both ways (unique on each side), with a status the guardian or staff can
--                        change. The profile's role is STUDENT; the server sets it, nothing a person sends can.
--   learner_invitations  a guardian's single-use, expiring invitation for one student. Only the SHA-256 of the token is stored.
--   identity_audit       who suspended, revoked, invited or accepted, with ids only (no email, no name).
--   client_students      the guardian link gets a status and a permission, so a second guardian can be suspended or revoked.
--   students.access_mode none | supervised (a guardian's own session picks the learner) | direct (the learner's own login)
--
-- Privacy rules written into the policies below, not only into application code:
--   * a guardian can read the family's records but NOT a learner's chat conversations (chats with a student_id are server-only);
--   * a learner can read their own student record and their own assignments, never a sibling's;
--   * a learner cannot become a "client" (the paying adult account): a trigger refuses it on both sides.
-- The site's server role bypasses row level security, so the same scoping is repeated in the repositories (packages/data).

-- ---------------------------------------------------------------------------------------------
-- Guardian links: status and permission
-- ---------------------------------------------------------------------------------------------
alter table public.client_students
  add column if not exists status text not null default 'active',
  add column if not exists can_view_progress boolean not null default true,
  add column if not exists verified_at timestamptz not null default now(),
  add column if not exists status_changed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_students_status_check') then
    alter table public.client_students add constraint client_students_status_check check (status in ('active', 'suspended', 'revoked'));
  end if;
end $$;

comment on column public.client_students.status is
  'active, suspended or revoked. Only active links give a guardian anything: access, enrolment benefit and billing relationships all ignore the others.';
comment on column public.client_students.can_view_progress is
  'May this guardian see the learner''s reports and progress. There is deliberately NO permission to read the learner''s LearnThrive AI conversations.';

-- ---------------------------------------------------------------------------------------------
-- How a student gets in
-- ---------------------------------------------------------------------------------------------
alter table public.students add column if not exists access_mode text not null default 'none';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'students_access_mode_check') then
    alter table public.students add constraint students_access_mode_check check (access_mode in ('none', 'supervised', 'direct'));
  end if;
end $$;

comment on column public.students.access_mode is
  'none: no learner access. supervised: a guardian''s signed-in session selects this learner (no email needed). direct: the learner has their own login (learner_identities).';

-- ---------------------------------------------------------------------------------------------
-- learner_identities
-- ---------------------------------------------------------------------------------------------
create table if not exists public.learner_identities (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.students (id) on delete cascade,
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  activated_at timestamptz not null default now(),
  status_changed_at timestamptz,
  status_changed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.learner_identities is
  'A learner''s own login bound to one student record. 1:1 on both sides, so an identity can never be ambiguous. Written only by the server.';

-- A learner profile is not a paying family account, and the other way round.
create or replace function private.learner_not_client() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'learner_identities' then
    if exists (select 1 from public.clients c where c.owner_profile_id = new.profile_id) then
      raise exception 'an account that owns a family account cannot also be a learner' using errcode = 'check_violation';
    end if;
  else
    if exists (select 1 from public.learner_identities l where l.profile_id = new.owner_profile_id) then
      raise exception 'a learner account cannot own a family account' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists learner_identities_not_client on public.learner_identities;
create trigger learner_identities_not_client
  before insert on public.learner_identities
  for each row execute function private.learner_not_client();

drop trigger if exists clients_not_learner on public.clients;
create trigger clients_not_learner
  before insert on public.clients
  for each row execute function private.learner_not_client();

-- ---------------------------------------------------------------------------------------------
-- learner_invitations
-- ---------------------------------------------------------------------------------------------
create table if not exists public.learner_invitations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  invited_by uuid not null references public.profiles (id) on delete cascade,
  -- The address the invitation is for, lower case. When set, only a signed-in account with exactly this verified address can accept.
  email text check (email is null or (email = lower(email) and char_length(email) between 3 and 254)),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (accepted_at is null or revoked_at is null),
  check (expires_at > created_at)
);
-- At most one open invitation per student: re-inviting revokes the earlier one in the same statement (the server does it).
create unique index if not exists learner_invitations_one_open
  on public.learner_invitations (student_id) where accepted_at is null and revoked_at is null;
create index if not exists learner_invitations_client_idx on public.learner_invitations (client_id, created_at desc);
comment on table public.learner_invitations is
  'A guardian''s invitation for one student. Single use (accepted_at), expiring, revocable. Only the SHA-256 of the token is stored; the token itself is shown once.';

-- ---------------------------------------------------------------------------------------------
-- supervised_contexts: a guardian's signed-in session with ONE learner selected (a young child with no login of their own).
-- The browser holds an opaque token; only its SHA-256 is stored. The actor stays the guardian: this row only says "for now, show the
-- learner's view". It ends when it expires, when the guardian leaves it (with their password), or when the link or access mode changes.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.supervised_contexts (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  guardian_profile_id uuid not null references public.profiles (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  expires_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index if not exists supervised_contexts_guardian_idx on public.supervised_contexts (guardian_profile_id, student_id);
comment on table public.supervised_contexts is
  'A guardian session viewing as one learner. Server only (no API grants). Only the token hash is stored; ended_at is set when the guardian leaves.';

-- ---------------------------------------------------------------------------------------------
-- identity_audit: ids and actions only
-- ---------------------------------------------------------------------------------------------
create table if not exists public.identity_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_profile_id uuid references public.profiles (id) on delete set null,
  action text not null check (action ~ '^[a-z][a-z_]{2,39}$'),
  client_id uuid references public.clients (id) on delete set null,
  student_id uuid references public.students (id) on delete set null,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists identity_audit_student_idx on public.identity_audit (student_id, at desc);
comment on table public.identity_audit is
  'Invitations created, accepted, revoked; learner access suspended, restored, revoked; guardian links changed. Ids only: never an email address or a name.';

-- ---------------------------------------------------------------------------------------------
-- Helpers (private; used by policies and, for the service role, by queries)
-- ---------------------------------------------------------------------------------------------
create or replace function private.my_learner_student_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select l.student_id from public.learner_identities l
  where l.profile_id = auth.uid() and l.status = 'active'
$$;

-- Only an ACTIVE guardian link counts as "in my family" from now on.
create or replace function private.student_in_my_family(p_student_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.client_students cs
    where cs.student_id = p_student_id and cs.client_id = private.my_client_id() and cs.status = 'active'
  )
$$;

create or replace function private.assignment_in_my_family(p_assignment_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.assignment_students s
    join public.client_students cs on cs.student_id = s.student_id
    where s.assignment_id = p_assignment_id and cs.client_id = private.my_client_id() and cs.status = 'active'
  )
$$;

-- True when the caller is a learner and is on the assignment themselves (not a sibling).
create or replace function private.is_my_learner_assignment(p_assignment_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.assignment_students s
    where s.assignment_id = p_assignment_id and s.student_id = private.my_learner_student_id()
  )
$$;

-- A family is enrolled while a student on an ACTIVE guardian link is on an ACTIVE assignment.
create or replace function public.client_is_enrolled(p_client_id uuid) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from public.client_students cs
    join public.assignment_students s on s.student_id = cs.student_id
    join public.tuition_assignments a on a.id = s.assignment_id
    where cs.client_id = p_client_id and cs.status = 'active' and a.status = 'ACTIVE'
  )
$$;

-- One student's OWN enrolment: what a learner's tuition routes follow (never a sibling's assignment).
create or replace function public.student_is_enrolled(p_student_id uuid) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from public.assignment_students s
    join public.tuition_assignments a on a.id = s.assignment_id
    where s.student_id = p_student_id and a.status = 'ACTIVE'
  )
$$;
revoke execute on function public.student_is_enrolled(uuid) from public, anon, authenticated;
grant execute on function public.student_is_enrolled(uuid) to service_role;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------------------------
alter table public.learner_identities enable row level security;
alter table public.learner_invitations enable row level security;
alter table public.identity_audit enable row level security;
alter table public.supervised_contexts enable row level security;
alter table public.supervised_contexts force row level security;
-- (learner_identities is read by the definer helper private.my_learner_student_id, so, like the tables the other helpers read, it is not forced.)
alter table public.learner_invitations force row level security;
alter table public.identity_audit force row level security;

revoke all on public.learner_identities, public.learner_invitations, public.identity_audit, public.supervised_contexts from anon, authenticated;
grant select on public.learner_identities to authenticated;
-- Everything but the token hash: a hash is never needed by a browser.
grant select (id, student_id, client_id, email, expires_at, accepted_at, revoked_at, created_at) on public.learner_invitations to authenticated;
grant select on public.identity_audit to authenticated;

drop policy if exists learner_identities_self_read on public.learner_identities;
create policy learner_identities_self_read on public.learner_identities for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists learner_identities_family_read on public.learner_identities;
create policy learner_identities_family_read on public.learner_identities for select to authenticated
  using ((select private.student_in_my_family(student_id)));

drop policy if exists learner_identities_admin_read on public.learner_identities;
create policy learner_identities_admin_read on public.learner_identities for select to authenticated
  using ((select private.is_admin()));

drop policy if exists learner_invitations_family_read on public.learner_invitations;
create policy learner_invitations_family_read on public.learner_invitations for select to authenticated
  using (client_id = (select private.my_client_id()));

drop policy if exists identity_audit_admin_read on public.identity_audit;
create policy identity_audit_admin_read on public.identity_audit for select to authenticated
  using ((select private.is_admin()));

-- A learner reads their own student record and their own assignments (the household's other learners stay invisible).
drop policy if exists students_learner_read on public.students;
create policy students_learner_read on public.students for select to authenticated
  using (id = (select private.my_learner_student_id()));

drop policy if exists tuition_assignments_visible_read on public.tuition_assignments;
create policy tuition_assignments_visible_read on public.tuition_assignments for select to authenticated
  using (
    (select private.is_my_assignment(id))
    or (select private.assignment_in_my_family(id))
    or (select private.is_my_learner_assignment(id))
    or (select private.is_admin())
  );

drop policy if exists assignment_students_visible_read on public.assignment_students;
create policy assignment_students_visible_read on public.assignment_students for select to authenticated
  using (
    (select private.student_in_my_family(student_id))
    or student_id = (select private.my_learner_student_id())
    or (select private.is_my_assignment(assignment_id))
    or (select private.is_admin())
  );

-- ---------------------------------------------------------------------------------------------
-- A learner's conversations are theirs: not a guardian's to read. Chats that belong to a student are written and read by the server
-- only (it scopes them to that learner); the family's own RLS access is limited to the adult's own chats (no student).
-- ---------------------------------------------------------------------------------------------
drop policy if exists chat_sessions_family_read on public.chat_sessions;
create policy chat_sessions_family_read on public.chat_sessions for select to authenticated
  using (client_id = (select private.my_client_id()) and student_id is null and deletion_requested_at is null);

drop policy if exists chat_sessions_family_insert on public.chat_sessions;
create policy chat_sessions_family_insert on public.chat_sessions for insert to authenticated
  with check (client_id = (select private.my_client_id()) and student_id is null);

drop policy if exists chat_sessions_family_update on public.chat_sessions;
create policy chat_sessions_family_update on public.chat_sessions for update to authenticated
  using (client_id = (select private.my_client_id()) and student_id is null and deletion_requested_at is null)
  with check (client_id = (select private.my_client_id()) and student_id is null);

-- "Delete this chat" for the adult's own chats only; a learner's chats are deleted through the server (the guardian may, the policy of
-- docs/IDENTITY.md), which is service role.
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
     and s.student_id is null
     and s.deletion_requested_at is null;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The two multi-step operations, as functions so each is one atomic transaction that locks what it changes.
-- SECURITY INVOKER on purpose: they run with the rights of the caller (the site's server role), never more; and they are closed to
-- anon, authenticated and PUBLIC: only the server calls them. They return a result word, never raise for an expected refusal.
-- ---------------------------------------------------------------------------------------------

-- A guardian's invitation for one of their students. Replaces any open one (one open invitation per student), refuses a student that
-- already has an active or suspended login, and caps invitations per student per day.
create or replace function public.create_learner_invitation(
  p_client uuid, p_student uuid, p_by uuid, p_email text, p_token_hash text, p_expires timestamptz, p_max_per_day integer, p_now timestamptz
) returns table (result text, invitation_id uuid)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Serialise concurrent invitations for the same student.
  perform 1 from public.students s where s.id = p_student for update;
  if not exists (
    select 1 from public.students s
    join public.client_students cs on cs.student_id = s.id
    where s.id = p_student and s.client_id = p_client and s.active and cs.client_id = p_client and cs.status = 'active'
  ) then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if exists (select 1 from public.learner_identities l where l.student_id = p_student and l.status <> 'revoked') then
    return query select 'already_learner'::text, null::uuid;
    return;
  end if;
  if (select count(*) from public.learner_invitations i where i.student_id = p_student and i.created_at > p_now - interval '24 hours') >= p_max_per_day then
    return query select 'limit'::text, null::uuid;
    return;
  end if;
  update public.learner_invitations i set revoked_at = p_now, revoked_by = p_by
   where i.student_id = p_student and i.accepted_at is null and i.revoked_at is null;
  insert into public.learner_invitations (student_id, client_id, invited_by, email, token_hash, expires_at, created_at)
  values (p_student, p_client, p_by, lower(p_email), p_token_hash, p_expires, p_now)
  returning id into v_id;
  insert into public.identity_audit (at, actor_profile_id, action, client_id, student_id)
  values (p_now, p_by, 'invitation_created', p_client, p_student);
  return query select 'ok'::text, v_id;
end;
$$;

-- Spends an invitation for a signed-in profile: the invitation is accepted, the learner login created and the profile becomes a STUDENT,
-- all or nothing. The order of refusals is fixed (used, revoked, expired, wrong address, not eligible) so tests and messages agree.
create or replace function public.accept_learner_invitation(
  p_token_hash text, p_profile uuid, p_email text, p_now timestamptz
) returns table (result text, student_id uuid, client_id uuid)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  inv public.learner_invitations%rowtype;
  v_role text;
begin
  select * into inv from public.learner_invitations i where i.token_hash = p_token_hash for update;
  if not found then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;
  if inv.accepted_at is not null then
    return query select 'used'::text, null::uuid, null::uuid;
    return;
  end if;
  if inv.revoked_at is not null then
    return query select 'revoked'::text, null::uuid, null::uuid;
    return;
  end if;
  if inv.expires_at <= p_now then
    return query select 'expired'::text, null::uuid, null::uuid;
    return;
  end if;
  if inv.email is not null and inv.email <> lower(p_email) then
    return query select 'email_mismatch'::text, null::uuid, null::uuid;
    return;
  end if;
  select p.role into v_role from public.profiles p where p.id = p_profile for update;
  if v_role is distinct from 'CLIENT'
     or exists (select 1 from public.clients c where c.owner_profile_id = p_profile)
     or exists (select 1 from public.learner_identities l where l.profile_id = p_profile)
     or not exists (select 1 from public.students s where s.id = inv.student_id and s.active)
     or not exists (select 1 from public.client_students cs where cs.client_id = inv.client_id and cs.student_id = inv.student_id and cs.status = 'active')
     or exists (select 1 from public.learner_identities l where l.student_id = inv.student_id and l.status <> 'revoked') then
    return query select 'not_eligible'::text, null::uuid, null::uuid;
    return;
  end if;
  -- A student whose earlier login was revoked can be bound to a new one: the revoked record is kept only as the audit trail.
  delete from public.learner_identities l where l.student_id = inv.student_id and l.status = 'revoked';
  insert into public.learner_identities (student_id, profile_id, activated_at) values (inv.student_id, p_profile, p_now);
  update public.profiles p set role = 'STUDENT' where p.id = p_profile;
  update public.students s set access_mode = 'direct' where s.id = inv.student_id;
  update public.learner_invitations i set accepted_at = p_now, accepted_by = p_profile where i.id = inv.id;
  insert into public.identity_audit (at, actor_profile_id, action, client_id, student_id)
  values (p_now, p_profile, 'invitation_accepted', inv.client_id, inv.student_id);
  return query select 'ok'::text, inv.student_id, inv.client_id;
end;
$$;

revoke all on function public.create_learner_invitation(uuid, uuid, uuid, text, text, timestamptz, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.accept_learner_invitation(text, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_learner_invitation(uuid, uuid, uuid, text, text, timestamptz, integer, timestamptz) to service_role;
grant execute on function public.accept_learner_invitation(text, uuid, text, timestamptz) to service_role;
