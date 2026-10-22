-- 0012_paper_jobs.sql — Paper Tutor jobs that survive a restart.
--
-- A paper takes minutes. Until now a job lived in the web server's memory, so a restart lost it. This table holds the job's state, the questions
-- found, ONE CHECKPOINT PER FINISHED QUESTION and the worker lease, so an interrupted job is picked up again and only the questions without a
-- checkpoint are redone. The uploaded paper is a chat file (chat_files, 7 days) and the annotated result is stored as another; a job keeps neither.
--
--   * One active job per family, enforced by the database (a partial unique index), not just by the application.
--   * A worker holds a LEASE (lease_owner, lease_expires_at) and renews it with every checkpoint; writes name the worker and are refused once the
--     lease is lost or taken over (fencing), so two processes cannot both finish one job.
--   * Retention: expires_at is 7 days from the start (the same as the uploads); a job also goes with its chat (on delete cascade).
--   * Server only: RLS on and forced, no policy, no grant to anon or authenticated. Every repository call names the owner (family and learner).
-- Re-runnable.

create table if not exists public.paper_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  student_id uuid references public.students (id) on delete cascade,
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  file_id uuid not null,
  scheme_file_id uuid,
  kind text not null check (kind in ('solve', 'mark')),
  state text not null check (state in ('extracting', 'ready', 'solving', 'done', 'failed', 'cancelled')),
  mode text check (mode is null or char_length(mode) <= 40),
  selected_ids jsonb check (selected_ids is null or jsonb_typeof(selected_ids) = 'array'),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  checkpoints jsonb not null default '{}'::jsonb check (jsonb_typeof(checkpoints) = 'object'),
  progress jsonb not null default '[]'::jsonb check (jsonb_typeof(progress) = 'array'),
  result_file_id uuid,
  page_count integer check (page_count is null or page_count >= 0),
  worked_pages integer[] not null default '{}',
  message text check (message is null or char_length(message) <= 1000),
  attempts integer not null default 1 check (attempts >= 0),
  lease_owner text check (lease_owner is null or char_length(lease_owner) <= 80),
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  -- A job being worked on always has a lease; one that is waiting or finished never does.
  check ((state in ('extracting', 'solving')) = (lease_owner is not null and lease_expires_at is not null))
);
create unique index if not exists paper_jobs_one_active_idx on public.paper_jobs (client_id) where state in ('extracting', 'solving');
create index if not exists paper_jobs_owner_idx on public.paper_jobs (client_id, created_at desc);
create index if not exists paper_jobs_lease_idx on public.paper_jobs (lease_expires_at) where state in ('extracting', 'solving');
create index if not exists paper_jobs_session_idx on public.paper_jobs (session_id);
create index if not exists paper_jobs_expires_idx on public.paper_jobs (expires_at);

alter table public.paper_jobs enable row level security;
alter table public.paper_jobs force row level security;
revoke all on public.paper_jobs from anon, authenticated;

comment on table public.paper_jobs is
  'A Paper Tutor job (solve or mark a paper) with one checkpoint per finished question and a worker lease, so it resumes after a restart. One active job per family. Server only. Removed with its chat, or after 7 days.';
comment on column public.paper_jobs.checkpoints is 'Finished questions keyed by question id. Derived from the student''s upload: kept no longer than the upload.';
comment on column public.paper_jobs.lease_owner is 'The worker running this job. Writes by any other worker are refused (fencing).';
