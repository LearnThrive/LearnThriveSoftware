-- 0028_staff_meetings.sql — meetings between staff (administrators and tutors), held in the same video room as a lesson but not tied to one.
--
--   staff_meetings            one row per meeting: a title, a start, a length, the room code and who hosts it. Instant meetings are the same row with a
--                             start of "now". A cancelled meeting is kept, marked, never deleted.
--   staff_meeting_invitees    the people invited (not the host). A person is a sign-in's id, kept as plain text with a name copied at the time, so a
--                             meeting record does not depend on anyone's profile surviving.
--
-- Staff only: nobody under 18 and no parent is ever invited. The web app decides who may host (an administrator) and who may invite (an administrator or a
-- tutor with a login), and re-checks at the moment of joining that the person is still staff.
--
-- Server only, like the lesson and safeguarding tables: RLS on and FORCED, no policy, no grant to anon or authenticated.
-- Re-runnable; additive only. Written as a file: it is applied only on the owner's go-ahead.

create table if not exists public.staff_meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 100),
  starts_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  -- The room code the video room is keyed by: the same shape as a lesson's (packages/shared ROOM_PATTERN), and unguessable.
  room_id text not null unique check (room_id ~ '^[a-z0-9][a-z0-9-]{7,47}$'),
  host_id text not null check (char_length(host_id) between 1 and 100),
  host_name text not null check (char_length(btrim(host_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by is null or char_length(cancelled_by) between 1 and 100),
  check ((cancelled_at is null) = (cancelled_by is null))
);
create index if not exists staff_meetings_start_idx on public.staff_meetings (starts_at);
create index if not exists staff_meetings_host_idx on public.staff_meetings (host_id, starts_at);

create table if not exists public.staff_meeting_invitees (
  meeting_id uuid not null references public.staff_meetings (id) on delete cascade,
  person_id text not null check (char_length(person_id) between 1 and 100),
  person_name text not null check (char_length(btrim(person_name)) between 1 and 80),
  primary key (meeting_id, person_id)
);
create index if not exists staff_meeting_invitees_person_idx on public.staff_meeting_invitees (person_id);

alter table public.staff_meetings enable row level security;
alter table public.staff_meeting_invitees enable row level security;
alter table public.staff_meetings force row level security;
alter table public.staff_meeting_invitees force row level security;
revoke all on public.staff_meetings, public.staff_meeting_invitees from anon, authenticated;

comment on table public.staff_meetings is 'A meeting between staff (administrators and tutors) in the video room, not tied to a lesson. Cancelled meetings are kept and marked. Server only.';
comment on table public.staff_meeting_invitees is 'Who is invited to a staff meeting besides its host: a sign-in id and the name at the time. Goes with the meeting. Server only.';
