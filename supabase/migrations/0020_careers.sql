-- 0020_careers.sql — tutor applications stored in the database and reviewed by administrators (launch checklist 3.12).
--
-- Until now an application was emailed to a mailbox with its files attached, and the site stored nothing. From here it is stored, and
-- the mailbox only hears that one has arrived (no name, no answers, no files).
--
-- What this adds:
--   careers_applications            one row per application: the role, the applicant's name and contact email (for the list and for
--                                   replying), every answer as submitted (jsonb), the safeguarding agreement record, the status, the
--                                   decision date and the retention dates the site computed from it, and whether identity and the DBS
--                                   result were SEEN (who and when only: never a copy, never a certificate number).
--   careers_application_files       the files, which live in the private `careers` bucket under <application id>/<file id>. The file
--                                   row carries the cleaned original name for the reviewer; the storage path carries no name at all.
--   careers_application_notes       internal notes by administrators. Never shown to the applicant, a tutor or a family.
--   careers_application_events      append-only history: received, each status change, each file opened (who and when), checks
--                                   recorded, identity documents deleted. Deleting the application deletes its history with it.
--   careers_deletions               an append-only log that an application WAS deleted: the date, the administrator, why and how many
--                                   files. Never the reference, the name or the email, so the log cannot keep what was deleted
--                                   (the same rule as data_purges, 3.7.5).
--   the `careers` bucket            private; PDF, Word, JPEG and PNG; 3 MB a file, careersConfig.limits.
--
-- Server only, like 0011: RLS enabled and forced, no policy, no grant to anon or authenticated. The site's role reaches the tables through
-- create-server-role.mjs, which must be RE-RUN after this migration (a new table is unreachable to that role until it is).
--
-- Re-runnable; additive only.

create table if not exists public.careers_applications (
  id uuid primary key default gen_random_uuid(),
  -- The applicant quotes this (LT-APP-YYYYMMDD-XXXXXX). Not secret, not a credential.
  reference text not null unique check (reference ~ '^LT-APP-[0-9]{8}-[A-Z0-9]{6}$'),
  role_slug text not null check (char_length(role_slug) between 1 and 80),
  first_name text not null check (char_length(first_name) between 1 and 200),
  last_name text not null check (char_length(last_name) between 1 and 200),
  email text not null check (char_length(email) between 3 and 320),
  status text not null default 'NEW' check (status in ('NEW', 'REVIEWING', 'INTERVIEW', 'ACCEPTED', 'REJECTED', 'WITHDRAWN')),
  -- They ticked the box to be kept for future roles (12 months after the decision instead of 6).
  talent_pool boolean not null default false,
  answers jsonb not null default '{}'::jsonb,
  agreement jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set when the status becomes ACCEPTED, REJECTED or WITHDRAWN; cleared if it goes back to an open status.
  decided_at timestamptz,
  -- Computed by the site from the decision (RETENTION_AND_DELETION.md) and written with it, so the screen and the row cannot disagree.
  delete_after timestamptz,
  identity_delete_after timestamptz,
  identity_seen_on date,
  identity_seen_by uuid references public.profiles (id) on delete set null,
  dbs_seen_on date,
  dbs_seen_how text check (dbs_seen_how in ('CERTIFICATE', 'UPDATE_SERVICE')),
  dbs_seen_by uuid references public.profiles (id) on delete set null,
  check ((decided_at is null) or status in ('ACCEPTED', 'REJECTED', 'WITHDRAWN')),
  check ((dbs_seen_on is null) = (dbs_seen_how is null))
);
create index if not exists careers_applications_received_idx on public.careers_applications (received_at desc);
create index if not exists careers_applications_status_idx on public.careers_applications (status);
create index if not exists careers_applications_delete_after_idx on public.careers_applications (delete_after) where delete_after is not null;
comment on table public.careers_applications is
  'A tutor application (launch checklist 3.12): the answers as submitted, the agreement record, the status and its retention dates. Holds personal data of applicants, who are not account holders. Server only; read by administrators.';

create table if not exists public.careers_application_files (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.careers_applications (id) on delete cascade,
  -- The order the applicant gave them in (CV, cover letter, then supporting documents in their order), so the reviewer sees the same.
  position integer not null default 0 check (position >= 0),
  kind text not null check (kind in ('CV', 'COVER_LETTER', 'SUPPORTING')),
  -- What the applicant said it is ("Qualification or certificate"), and the form's value for that ("qualification").
  label text not null check (char_length(label) between 1 and 80),
  document_type text,
  -- An identity or right-to-work document: deleted at 6 months for an unsuccessful applicant, and as soon as identity is recorded as seen.
  sensitive boolean not null default false,
  filename text not null check (char_length(filename) between 1 and 200),
  content_type text not null check (content_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 3145728),
  -- <application id>/<file id>.<ext>: no name, so a path in a log or an error says nothing about anyone.
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|docx|jpg|png)$'),
  created_at timestamptz not null default now()
);
create index if not exists careers_application_files_app_idx on public.careers_application_files (application_id);
comment on table public.careers_application_files is
  'The files of a careers application. The bytes are in the private careers bucket at storage_path and are opened only through a signed link made on each request. Server only.';

create table if not exists public.careers_application_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.careers_applications (id) on delete cascade,
  author_profile_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  at timestamptz not null default now()
);
create index if not exists careers_application_notes_app_idx on public.careers_application_notes (application_id, at);
comment on table public.careers_application_notes is
  'Internal notes on a careers application, by administrators. Never shown to the applicant, a tutor or a family. Server only.';

create table if not exists public.careers_application_events (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.careers_applications (id) on delete cascade,
  kind text not null check (kind in ('RECEIVED', 'STATUS', 'FILE_VIEWED', 'IDENTITY_SEEN', 'DBS_SEEN', 'IDENTITY_FILES_DELETED')),
  actor_profile_id uuid references public.profiles (id) on delete set null,
  from_status text,
  to_status text,
  -- The file opened. Set null if the file is deleted later; `detail` still says which (by its label).
  file_id uuid references public.careers_application_files (id) on delete set null,
  detail text check (detail is null or char_length(detail) <= 200),
  at timestamptz not null default now()
);
create index if not exists careers_application_events_app_idx on public.careers_application_events (application_id, at);
comment on table public.careers_application_events is
  'Append-only history of a careers application: received, status changes, every file opened and by whom, checks recorded. Server only.';

create table if not exists public.careers_deletions (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor_profile_id uuid references public.profiles (id) on delete set null,
  reason text not null check (reason in ('RETENTION', 'REQUEST', 'WITHDRAWN', 'OTHER')),
  files integer not null default 0 check (files >= 0)
);
create index if not exists careers_deletions_at_idx on public.careers_deletions (at desc);
comment on table public.careers_deletions is
  'Append-only log that a careers application was deleted: date, administrator, reason and file count. Deliberately holds no reference, name or email. Server only.';

alter table public.careers_applications enable row level security;
alter table public.careers_application_files enable row level security;
alter table public.careers_application_notes enable row level security;
alter table public.careers_application_events enable row level security;
alter table public.careers_deletions enable row level security;
alter table public.careers_applications force row level security;
alter table public.careers_application_files force row level security;
alter table public.careers_application_notes force row level security;
alter table public.careers_application_events force row level security;
alter table public.careers_deletions force row level security;

revoke all on public.careers_applications, public.careers_application_files, public.careers_application_notes, public.careers_application_events,
  public.careers_deletions from anon, authenticated;

-- The private bucket. No storage policy for anon or authenticated, on purpose (see 0007): only the server, with the secret key, reads and
-- writes, and an administrator's browser receives the bytes from the site after the site's own ADMIN check.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'careers', 'careers', false, 3145728,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
