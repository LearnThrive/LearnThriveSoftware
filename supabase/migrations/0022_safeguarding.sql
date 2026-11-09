-- 0022_safeguarding.sql — two safeguarding records the platform did not have (docs/SAFEGUARDING_RECORDS.md):
--
--   tutor_vetting_checks           one row each time an administrator SEES a check for a tutor (DBS, identity, right to work, references,
--                                  safeguarding training, the signed agreement): the date seen, how, when it runs out, and by whom.
--                                  Never a certificate number and never a copy (the rule the careers screens already follow). The newest
--                                  check of each kind is the current one; a mistake is voided with a reason, not edited away.
--   safeguarding_concerns          a concern a tutor or an administrator raised. Only the named safeguarding leads read it (the app checks;
--                                  see lib/safeguarding). The content never changes after it is written: only the status moves.
--   safeguarding_concern_events    append-only: raised, each time a lead opened it, each refused attempt to open it, each status change
--                                  and each note.
--
-- Server only, like the lesson and billing tables: RLS on and FORCED, no policy, no grant to anon or authenticated.
--
-- Leaving and purging: a tutor's vetting rows go with the tutor (cascade). A concern is a safeguarding record, which is one of the three
-- retention exceptions (docs/LAWFUL_BASES.md), so it deliberately does NOT reference students, lessons or profiles: purging a person
-- leaves the concern as it was written. Deleting one is a decision for the safeguarding lead, made outside this table's normal use.
-- Re-runnable; additive only.

create table if not exists public.tutor_vetting_checks (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutors (id) on delete cascade,
  kind text not null check (kind in ('DBS', 'IDENTITY', 'RIGHT_TO_WORK', 'REFERENCES', 'SAFEGUARDING_TRAINING', 'AGREEMENT')),
  checked_on date not null,
  expires_on date,
  how text not null check (char_length(btrim(how)) between 2 and 80),
  note text not null default '' check (char_length(note) <= 500),
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null,
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 3 and 500),
  check (expires_on is null or expires_on > checked_on),
  check ((voided_at is null) = (void_reason is null)),
  -- A DBS certificate number is 12 digits. It is never stored: the record is that the check was seen.
  check (how !~ '\d{12}' and note !~ '\d{12}')
);
create index if not exists tutor_vetting_checks_tutor_idx on public.tutor_vetting_checks (tutor_id, kind, checked_on desc);

create table if not exists public.safeguarding_concerns (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^SC-[0-9]{8}-[0-9A-F]{6}$'),
  raised_by text not null check (char_length(raised_by) between 1 and 100),
  raised_by_role text not null check (raised_by_role in ('TUTOR', 'ADMIN')),
  raised_at timestamptz not null default now(),
  category text not null check (category in ('CHILD_WELFARE', 'DISCLOSURE', 'ONLINE_SAFETY', 'ADULT_CONDUCT', 'OTHER')),
  about text not null check (char_length(btrim(about)) between 2 and 200),
  student_ref text check (student_ref is null or char_length(student_ref) <= 100),
  lesson_ref text check (lesson_ref is null or char_length(lesson_ref) <= 100),
  details text not null check (char_length(btrim(details)) between 10 and 5000),
  immediate_danger boolean not null default false,
  status text not null default 'OPEN' check (status in ('OPEN', 'IN_REVIEW', 'CLOSED'))
);
create index if not exists safeguarding_concerns_status_idx on public.safeguarding_concerns (status, raised_at desc);
create index if not exists safeguarding_concerns_raised_by_idx on public.safeguarding_concerns (raised_by, raised_at desc);

create table if not exists public.safeguarding_concern_events (
  id uuid primary key default gen_random_uuid(),
  concern_id uuid not null references public.safeguarding_concerns (id) on delete restrict,
  at timestamptz not null default now(),
  actor_id text not null check (char_length(actor_id) between 1 and 100),
  kind text not null check (kind in ('RAISED', 'VIEWED', 'ACCESS_REFUSED', 'STATUS', 'NOTE')),
  note text not null default '' check (char_length(note) <= 2000)
);
create index if not exists safeguarding_concern_events_concern_idx on public.safeguarding_concern_events (concern_id, at);

-- What was written stays as it was written: only a concern's status may change, and nothing is deleted. The event log is append-only.
create or replace function private.safeguarding_concern_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a safeguarding concern is never deleted through the application' using errcode = 'restrict_violation';
  end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'a safeguarding concern cannot be edited after it is raised: only its status changes' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists safeguarding_concern_guard on public.safeguarding_concerns;
create trigger safeguarding_concern_guard before update or delete on public.safeguarding_concerns for each row execute function private.safeguarding_concern_guard();

create or replace function private.safeguarding_events_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'safeguarding_concern_events is append-only' using errcode = 'restrict_violation';
end;
$$;
drop trigger if exists safeguarding_events_append_only on public.safeguarding_concern_events;
create trigger safeguarding_events_append_only before update or delete on public.safeguarding_concern_events for each row execute function private.safeguarding_events_append_only();

alter table public.tutor_vetting_checks enable row level security;
alter table public.safeguarding_concerns enable row level security;
alter table public.safeguarding_concern_events enable row level security;
alter table public.tutor_vetting_checks force row level security;
alter table public.safeguarding_concerns force row level security;
alter table public.safeguarding_concern_events force row level security;
revoke all on public.tutor_vetting_checks, public.safeguarding_concerns, public.safeguarding_concern_events from anon, authenticated;

comment on table public.tutor_vetting_checks is 'Each time an administrator saw a check for a tutor: the kind, the date, how, when it runs out. Never a certificate number or a copy. Server only. Goes with the tutor.';
comment on table public.safeguarding_concerns is 'A safeguarding concern raised by a tutor or an administrator. Read only by the named safeguarding leads. Never edited, only its status. Kept when a person is purged (retention exception). Server only.';
comment on table public.safeguarding_concern_events is 'Append-only history of a concern: raised, every time it was opened and by whom, every refused attempt, status changes and notes. Server only.';

-- Same convention as 0005, 0010, 0013 and 0021: every function in private is executable by the API roles (a trigger function cannot be called directly).
grant execute on all functions in schema private to authenticated, service_role;
