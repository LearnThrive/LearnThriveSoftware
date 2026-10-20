-- 0001_core.sql — identities, family accounts, student profiles, tuition assignments, consents.
--
-- Plain Postgres (15 or newer) written for Supabase: relies on the auth schema (auth.users,
-- auth.uid()) and the roles anon / authenticated / service_role that Supabase provides.
-- Every migration in this folder is re-runnable (create ... if not exists, create or replace,
-- drop ... if exists) so that applying the whole set twice is a no-op. Row Level Security,
-- grants and policies for all tables live in 0005_rls.sql.
--
-- Family model (docs/DOMAIN_MODEL.md):
--   profiles          one row per auth user (role is set by the server, never by the user)
--   clients           the family / billing account; owned by one ADULT profile (Client)
--   students          student profiles under a family; NO email, NO auth user (Student)
--   client_students   many-to-many guardian link (ClientStudentLink)
--   tuition_assignments + assignment_students   (TuitionAssignment; enrolment is derived)

-- A private schema for helpers. It is not in the API's exposed-schema list, so none of it is
-- reachable over the REST/GraphQL API; it only serves RLS policies and triggers.
create schema if not exists private;

-- New objects must be born without access for the API roles. Supabase grants ALL on every new
-- table/sequence/function in public to anon, authenticated and service_role by default; take
-- that away from the two client-facing roles. 0005_rls.sql then grants exactly what is wanted.
-- (service_role keeps the default: it is the server-side key and bypasses RLS.)
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
-- New functions are executable by PUBLIC by default; require an explicit grant instead.
alter default privileges revoke execute on functions from public;

create or replace function private.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'CLIENT' check (role in ('ADMIN', 'TUTOR', 'CLIENT', 'STUDENT')),
  display_name text not null default '' check (char_length(display_name) <= 80),
  adult_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.profiles is
  'One row per auth user. role and adult_confirmed_at are written only by the server (service role); a user can edit display_name only.';
comment on column public.profiles.role is
  'Set to CLIENT on creation. Never taken from user metadata. Changed only with the service role.';
comment on column public.profiles.adult_confirmed_at is
  'Self-declaration, recorded at sign-up, that the account holder is 18 or over. Required before a family account can be created.';

-- A profile is created for every new auth user. The role is always CLIENT: nothing the user
-- supplies (raw_user_meta_data) can choose it. Only the display name and the adult declaration
-- are read from the sign-up metadata, and both are the user's own statements.
create or replace function private.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, adult_confirmed_at)
  values (
    new.id,
    left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80),
    case when new.raw_user_meta_data ->> 'adult_confirmed' = 'true' then now() end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- tutors (staff; created by the server)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.tutors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete set null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  subjects text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.tutors is
  'Staff. Not every tutor has a login yet (profile_id nullable). Written only by the server.';

-- ---------------------------------------------------------------------------------------------
-- clients: the family / billing account. Owned by exactly one adult profile.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null unique references public.profiles (id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.clients is
  'Family account (domain Client): the adult who pays and holds the account. A profile owns at most one. Row family boundary for all RLS.';

-- ---------------------------------------------------------------------------------------------
-- students: profiles under a family. No email, no auth user: students under 18 never hold an
-- email-based account.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  year_group text check (year_group is null or char_length(year_group) <= 40),
  is_minor boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists students_client_id_idx on public.students (client_id);
comment on table public.students is
  'Student profile under a family account (domain Student). Has no email and no auth user. client_id is the owning family; extra guardians are in client_students.';
comment on column public.students.display_name is
  'First name or nickname only; do not store full names, schools or addresses here.';
comment on column public.students.is_minor is
  'True (under 18) unless the server says otherwise. The assistant and voice features stay off for minors until the safeguarding gate is signed off.';

-- ---------------------------------------------------------------------------------------------
-- client_students: guardian links (domain ClientStudentLink). Many-to-many.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.client_students (
  client_id uuid not null references public.clients (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, student_id)
);
create index if not exists client_students_student_id_idx on public.client_students (student_id);
comment on table public.client_students is
  'Guardian links. The owning family is linked automatically when a student is created; further links (second guardian) are written only by the server after verification.';

create or replace function private.link_student_to_owner() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.client_students (client_id, student_id)
  values (new.client_id, new.id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists students_link_owner on public.students;
create trigger students_link_owner
  after insert on public.students
  for each row execute function private.link_student_to_owner();

-- ---------------------------------------------------------------------------------------------
-- tuition_assignments + assignment_students (domain TuitionAssignment; clientIds is derived
-- through client_students, never stored). Lesson defaults and report settings arrive with the
-- lessons migration; only what enrolment needs is here.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.tuition_assignments (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  subject text not null check (char_length(btrim(subject)) between 1 and 80),
  level text check (level is null or char_length(level) <= 40),
  tutor_id uuid not null references public.tutors (id) on delete restrict,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED', 'ENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tuition_assignments_tutor_id_idx on public.tuition_assignments (tutor_id);
create index if not exists tuition_assignments_status_idx on public.tuition_assignments (status);
comment on table public.tuition_assignments is
  'Ongoing tutor/student/subject relationship. A family is enrolled while a student of theirs is on an ACTIVE assignment.';

drop trigger if exists tuition_assignments_touch on public.tuition_assignments;
create trigger tuition_assignments_touch
  before update on public.tuition_assignments
  for each row execute function private.touch_updated_at();

create table if not exists public.assignment_students (
  assignment_id uuid not null references public.tuition_assignments (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (assignment_id, student_id)
);
create index if not exists assignment_students_student_id_idx on public.assignment_students (student_id);
comment on table public.assignment_students is
  'Normalised TuitionAssignment.studentIds. Enrolment of a family is derived from this plus client_students.';

-- ---------------------------------------------------------------------------------------------
-- consents: what the account holder agreed to, and when. Optionally about one of their students.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  student_id uuid references public.students (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{1,39}$'),
  version text not null check (char_length(version) between 1 and 40),
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  check (withdrawn_at is null or withdrawn_at >= granted_at)
);
create index if not exists consents_profile_kind_idx on public.consents (profile_id, kind);
comment on table public.consents is
  'Consent register: kind (for example terms, privacy, marketing), the version and a hash of the exact text shown. A withdrawal is recorded once; re-consenting is a new row.';

create or replace function private.consents_withdraw_once() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception 'a consent withdrawal cannot be changed or undone; record a new consent instead'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists consents_withdraw_once on public.consents;
create trigger consents_withdraw_once
  before update on public.consents
  for each row execute function private.consents_withdraw_once();
