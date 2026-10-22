-- 0011_tuition_domain.sql — the tuition data the signed-in app (lessons, attendance, reports, notifications) runs on.
--
-- Until now these lived only in the in-memory development provider (packages/data/src/inMemoryProvider.ts). This is the schema for the
-- production domain provider (packages/data/src/sqlProvider.ts), behind the same repository interfaces, so no page changes.
--
-- Written ONLY by the server: no grants and no policy for anon or authenticated (deny-all, like billing and the webhook ledger), and RLS
-- is forced. The app scopes every read to the signed-in person's role and records, and learners see only their own (lib/dashboard,
-- lib/reports/reportService.ts: `internal_tutor_notes` never leaves the server). Re-runnable; additive only.

alter table public.tutors add column if not exists contact_email text check (contact_email is null or char_length(contact_email) <= 254);
comment on column public.tutors.contact_email is
  'Where to reach a tutor who has no login yet (profile_id null). Once there is a login, the sign-in address is used and this is ignored.';

alter table public.tuition_assignments
  add column if not exists default_duration_minutes integer check (default_duration_minutes is null or default_duration_minutes between 5 and 600),
  add column if not exists default_location_type text check (default_location_type is null or default_location_type in ('ONLINE', 'IN_PERSON')),
  add column if not exists default_lesson_notes text check (default_lesson_notes is null or char_length(default_lesson_notes) <= 2000),
  add column if not exists require_report_approval boolean;

-- ---------------------------------------------------------------------------------------------
-- lessons
-- ---------------------------------------------------------------------------------------------
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.tuition_assignments (id) on delete restrict,
  tutor_id uuid not null references public.tutors (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  subject text not null check (char_length(btrim(subject)) between 1 and 80),
  start_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 5 and 600),
  location_type text not null check (location_type in ('ONLINE', 'IN_PERSON')),
  location text check (location is null or char_length(location) <= 300),
  classroom_room_id text unique check (classroom_room_id is null or char_length(classroom_room_id) <= 100),
  notes text check (notes is null or char_length(notes) <= 4000),
  report_required boolean not null default true,
  status text not null default 'PLANNED' check (status in ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  recurrence_id uuid,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancellation_reason text check (cancellation_reason is null or char_length(cancellation_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lessons_tutor_start_idx on public.lessons (tutor_id, start_at);
create index if not exists lessons_assignment_idx on public.lessons (assignment_id);
create index if not exists lessons_recurrence_idx on public.lessons (recurrence_id) where recurrence_id is not null;
create index if not exists lessons_start_idx on public.lessons (start_at);

drop trigger if exists lessons_touch on public.lessons;
create trigger lessons_touch before update on public.lessons for each row execute function private.touch_updated_at();

-- Who is on a lesson. A family's view of a lesson is derived through client_students (ACTIVE links), never stored on the lesson.
create table if not exists public.lesson_students (
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  primary key (lesson_id, student_id)
);
create index if not exists lesson_students_student_idx on public.lesson_students (student_id);

-- ---------------------------------------------------------------------------------------------
-- tutor availability, attendance, activity, reports, notifications, settings
-- ---------------------------------------------------------------------------------------------
create table if not exists public.tutor_availability_blocks (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutors (id) on delete cascade,
  type text not null check (type in ('AVAILABLE', 'UNAVAILABLE')),
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);
create index if not exists tutor_availability_tutor_idx on public.tutor_availability_blocks (tutor_id);

create table if not exists public.lesson_attendance (
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  status text not null check (status in ('ATTENDED', 'ABSENT', 'LATE', 'EXCUSED')),
  arrival_time timestamptz,
  departure_time timestamptz,
  notes text check (notes is null or char_length(notes) <= 1000),
  marked_by uuid references public.profiles (id) on delete set null,
  marked_at timestamptz not null default now(),
  primary key (lesson_id, student_id)
);

create table if not exists public.lesson_activity (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  type text not null check (type in ('CREATED', 'RESCHEDULED', 'CANCELLED', 'ATTENDANCE_MARKED', 'COMPLETED', 'REPORT_SUBMITTED', 'REPORT_APPROVED')),
  message text not null check (char_length(message) <= 1000),
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists lesson_activity_lesson_idx on public.lesson_activity (lesson_id, created_at);
create index if not exists lesson_activity_recent_idx on public.lesson_activity (created_at desc);
comment on table public.lesson_activity is 'Append-only timeline of what happened to a lesson. The application never updates or deletes a row.';

create table if not exists public.lesson_reports (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.lessons (id) on delete cascade,
  tutor_id uuid not null references public.tutors (id) on delete restrict,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'APPROVED')),
  public_summary text not null default '' check (char_length(public_summary) <= 4000),
  progress text check (progress is null or char_length(progress) <= 4000),
  areas_for_improvement text check (areas_for_improvement is null or char_length(areas_for_improvement) <= 4000),
  next_steps text check (next_steps is null or char_length(next_steps) <= 4000),
  engagement text check (engagement is null or engagement in ('LOW', 'MEDIUM', 'HIGH')),
  confidence text check (confidence is null or confidence in ('LOW', 'MEDIUM', 'HIGH')),
  internal_tutor_notes text check (internal_tutor_notes is null or char_length(internal_tutor_notes) <= 4000),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.lesson_reports.internal_tutor_notes is 'Tutor-facing only. Never sent to a family or a learner: lib/reports/reportService.ts is the one place that strips it.';

drop trigger if exists lesson_reports_touch on public.lesson_reports;
create trigger lesson_reports_touch before update on public.lesson_reports for each row execute function private.touch_updated_at();

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('LESSON_REMINDER', 'LESSON_RESCHEDULED', 'REPORT_AVAILABLE', 'REPORT_REQUIRED', 'REPORT_AWAITING_APPROVAL', 'SCHEDULING_CONFLICT')),
  message text not null check (char_length(message) <= 1000),
  link text check (link is null or (char_length(link) <= 300 and link ~ '^/')),
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- Exactly one row: the platform-wide default.
create table if not exists public.platform_settings (
  singleton boolean primary key default true check (singleton),
  require_report_approval boolean not null default true
);
insert into public.platform_settings (singleton) values (true) on conflict (singleton) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Server only: RLS on and forced, no policy, no grant to anon or authenticated.
-- ---------------------------------------------------------------------------------------------
alter table public.lessons enable row level security;
alter table public.lesson_students enable row level security;
alter table public.tutor_availability_blocks enable row level security;
alter table public.lesson_attendance enable row level security;
alter table public.lesson_activity enable row level security;
alter table public.lesson_reports enable row level security;
alter table public.notifications enable row level security;
alter table public.platform_settings enable row level security;
alter table public.lessons force row level security;
alter table public.lesson_students force row level security;
alter table public.tutor_availability_blocks force row level security;
alter table public.lesson_attendance force row level security;
alter table public.lesson_activity force row level security;
alter table public.lesson_reports force row level security;
alter table public.notifications force row level security;
alter table public.platform_settings force row level security;

revoke all on public.lessons, public.lesson_students, public.tutor_availability_blocks, public.lesson_attendance, public.lesson_activity,
  public.lesson_reports, public.notifications, public.platform_settings from anon, authenticated;

comment on table public.lessons is 'A scheduled lesson (one occurrence; a series shares recurrence_id). Server only. A family''s view of it is derived through the students on it and their ACTIVE guardian links.';
comment on table public.lesson_students is 'The students on a lesson. Server only.';
comment on table public.tutor_availability_blocks is 'A tutor''s recurring weekly availability, in the scheduling timezone (docs/SCHEDULING.md). Server only.';
comment on table public.lesson_attendance is 'One record per student per lesson: marking again replaces it. Server only.';
comment on table public.lesson_reports is 'One report per lesson. internal_tutor_notes is tutor-facing only. Server only.';
comment on table public.notifications is 'In-app notifications for one person (a profile). Server only.';
comment on table public.platform_settings is 'The single platform-wide settings row (the default for requiring approval of lesson reports). Server only.';
