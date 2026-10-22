-- 0013_paper_assessments.sql — marking a completed paper: the blank paper, and every version of an assessment.
--
--   * paper_jobs.blank_file_id: the optional blank question paper uploaded with the completed one. The reference solution is made from it (question
--     only, no handwriting) instead of from the student's own page. Like the paper and the scheme it is a chat file; the job keeps only its id.
--   * paper_assessment_versions: APPEND-ONLY. One row per version of one question's assessment: version 1 is the AI's, then each correction of the
--     reading (by the student, a guardian or a tutor) and each tutor review, with who made it, when and why. The current value is also in
--     paper_jobs.checkpoints; this table is how it got there. Rows are never updated or deleted by the application (a trigger refuses it); they go with
--     the job when the job expires (7 days, the same as the uploads) or its chat is deleted.
--   * Server only: RLS on and forced, no policy, no grant to anon or authenticated.
-- Re-runnable.

alter table public.paper_jobs add column if not exists blank_file_id uuid;

create table if not exists public.paper_assessment_versions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.paper_jobs (id) on delete cascade,
  question_id text not null check (question_id ~ '^q[0-9]{1,4}$'),
  version integer not null check (version >= 1),
  kind text not null check (kind in ('ai', 'correction', 'review')),
  actor_kind text not null check (actor_kind in ('system', 'student', 'guardian', 'tutor')),
  -- The person who made it (a profile), when there is one. Not a foreign key: the version outlives nothing but its job, and the job holds the family.
  actor_id uuid,
  -- The whole assessed question at this version (the student's reading, the reference, the criteria, the awards, the unknowns).
  value jsonb not null check (jsonb_typeof(value) = 'object'),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (job_id, question_id, version),
  check ((kind = 'ai') = (actor_kind = 'system'))
);
create index if not exists paper_assessment_versions_job_idx on public.paper_assessment_versions (job_id, question_id, version);

-- Append-only: an old version is evidence of what was decided and by whom.
create or replace function private.paper_assessment_versions_append_only() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old; -- removed by the cascade from its job (retention, or the chat being deleted)
  end if;
  raise exception 'paper_assessment_versions is append-only' using errcode = 'restrict_violation';
end;
$$;
drop trigger if exists paper_assessment_versions_append_only on public.paper_assessment_versions;
create trigger paper_assessment_versions_append_only before update or delete on public.paper_assessment_versions
  for each row execute function private.paper_assessment_versions_append_only();

alter table public.paper_assessment_versions enable row level security;
alter table public.paper_assessment_versions force row level security;
revoke all on public.paper_assessment_versions from anon, authenticated;

comment on table public.paper_assessment_versions is
  'Every version of one question''s assessment on a marking job: the AI''s, each correction of the reading and each tutor review, with who and when. Append-only. Server only. Goes with its job.';
comment on column public.paper_jobs.blank_file_id is 'The blank question paper uploaded with a completed one (a chat file), used to make the reference solution from the question alone.';

-- Same convention as 0005 and 0010: every function in private is executable by the API roles (a trigger function cannot be called directly).
grant execute on all functions in schema private to authenticated, service_role;
