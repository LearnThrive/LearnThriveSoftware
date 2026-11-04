-- 0018_purges.sql — the purge tool (launch checklist 3.7): a person who has left is removed in one audited step, with the exceptions
-- confirmed in docs/LAWFUL_BASES.md kept.
--
-- What this adds:
--   data_purges     an append-only log of purges that have happened: the date, who did it and what kind. NEVER who it was about:
--                   there is no student id, client id, tutor id, name or email in it, so the log itself cannot become the record the
--                   purge was meant to remove (3.7.5).
--   private.purge_student / _tutor / _family
--                   the deletions themselves, as functions so each purge is ONE transaction that either happens completely or not at
--                   all. SECURITY INVOKER on purpose: they run with the rights of the caller, never more. Closed to anon,
--                   authenticated and PUBLIC; only the site's server role calls them.
--   public.purge_student / _tutor / _family
--                   the same, plus the log row, returning a result word and counts (numbers only).
--
-- Re-runnable; additive only.

-- ---------------------------------------------------------------------------------------------
-- data_purges: what happened, never who it was about
-- ---------------------------------------------------------------------------------------------
create table if not exists public.data_purges (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  kind text not null check (kind in ('STUDENT', 'TUTOR', 'FAMILY')),
  -- Null once the administrator who ran it has their own account deleted; the row itself stays.
  actor_profile_id uuid references public.profiles (id) on delete set null,
  -- Row counts by what was removed, for the record ("lessonsRemoved": 12). Numbers only.
  counts jsonb not null default '{}'::jsonb
);
create index if not exists data_purges_at_idx on public.data_purges (at desc);
comment on table public.data_purges is
  'Append-only log of purges: date, administrator, what kind and how many rows. Deliberately holds no student, client or tutor id, name or email. Server only.';

alter table public.data_purges enable row level security;
alter table public.data_purges force row level security;
revoke all on public.data_purges from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Student: everything about them, except records another child is still on
-- ---------------------------------------------------------------------------------------------
-- A lesson that exists only for this student goes with them (it names them in its title and notes, and nobody else needs it). A lesson
-- shared with a sibling stays, with their link and attendance removed and their name taken out of its free text.
create or replace function private.purge_student(p_student uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_name text;
  v_profiles uuid[] := '{}';
  v_lessons uuid[] := '{}';
  v_sole uuid[] := '{}';
  v_shared uuid[] := '{}';
  v_attendance int := 0;
  v_reports_removed int := 0;
  v_reports_kept int := 0;
  v_assignment_links int := 0;
  v_guardian_links int := 0;
  v_invitations int := 0;
  v_identities int := 0;
  v_supervised int := 0;
  v_audit int := 0;
  v_assignments_ended int := 0;
  v_notifications int := 0;
  v_chats int := 0;
  v_chat_files int := 0;
  v_scrubbed int := 0;
begin
  select s.display_name into v_name from public.students s where s.id = p_student;
  if not found then
    return null;
  end if;

  select coalesce(array_agg(l.profile_id), '{}'::uuid[]) into v_profiles
    from public.learner_identities l where l.student_id = p_student;
  select coalesce(array_agg(x.lesson_id), '{}'::uuid[]) into v_lessons
    from public.lesson_students x where x.student_id = p_student;

  select coalesce(array_agg(l.id), '{}'::uuid[]) into v_sole
    from public.lessons l
   where l.id = any(v_lessons)
     and (select count(*) from public.lesson_students y where y.lesson_id = l.id) = 1;
  select coalesce(array_agg(x.id), '{}'::uuid[]) into v_shared
    from (select unnest(v_lessons) as id except select unnest(v_sole)) x;

  select count(*) into v_attendance from public.lesson_attendance a where a.student_id = p_student;
  select count(*) into v_reports_removed from public.lesson_reports r where r.lesson_id = any(v_sole);
  select count(*) into v_reports_kept from public.lesson_reports r where r.lesson_id = any(v_shared);
  select count(*) into v_assignment_links from public.assignment_students x where x.student_id = p_student;
  select count(*) into v_guardian_links from public.client_students c where c.student_id = p_student;
  select count(*) into v_invitations from public.learner_invitations i where i.student_id = p_student;
  select count(*) into v_identities from public.learner_identities l where l.student_id = p_student;
  select count(*) into v_supervised from public.supervised_contexts c where c.student_id = p_student;
  select count(*) into v_audit from public.identity_audit a where a.student_id = p_student;
  select count(*) into v_notifications from public.notifications n where n.user_id = any(v_profiles);
  select count(*) into v_chats from public.chat_sessions c where c.student_id = p_student;
  select count(*) into v_chat_files from public.chat_files f
    join public.chat_sessions c on c.id = f.session_id where c.student_id = p_student;

  -- Free text on records that must stay (a shared lesson, its timeline, its report) may name the child. Take the name out; keep the record.
  if coalesce(v_name, '') <> '' then
    update public.lessons l
       set title = replace(l.title, v_name, 'Student'),
           notes = replace(l.notes, v_name, 'Student')
     where l.id = any(v_shared) and (position(v_name in l.title) > 0 or position(v_name in coalesce(l.notes, '')) > 0);
    get diagnostics v_scrubbed = row_count;
    update public.lesson_activity a
       set message = replace(a.message, v_name, 'Student')
     where a.lesson_id = any(v_shared) and position(v_name in a.message) > 0;
    -- An assignment outlives the purge (a sibling may still be on it, and its lessons hang off it), and the admin screen asks for a
    -- title that names a child ("GCSE Mathematics - Brian"), so it is scrubbed exactly as a shared lesson is.
    update public.tuition_assignments a
       set title = replace(a.title, v_name, 'Student'),
           default_lesson_notes = replace(a.default_lesson_notes, v_name, 'Student')
     where a.id in (select s.assignment_id from public.assignment_students s where s.student_id = p_student)
       and (position(v_name in a.title) > 0 or position(v_name in coalesce(a.default_lesson_notes, '')) > 0);
    update public.lesson_reports r
       set public_summary = replace(r.public_summary, v_name, 'Student'),
           progress = replace(r.progress, v_name, 'Student'),
           areas_for_improvement = replace(r.areas_for_improvement, v_name, 'Student'),
           next_steps = replace(r.next_steps, v_name, 'Student'),
           internal_tutor_notes = replace(r.internal_tutor_notes, v_name, 'Student')
     where r.lesson_id = any(v_shared)
       and (position(v_name in r.public_summary) > 0 or position(v_name in coalesce(r.progress, '')) > 0
         or position(v_name in coalesce(r.areas_for_improvement, '')) > 0 or position(v_name in coalesce(r.next_steps, '')) > 0
         or position(v_name in coalesce(r.internal_tutor_notes, '')) > 0);
  end if;

  delete from public.lesson_attendance a where a.student_id = p_student;
  delete from public.lesson_students x where x.student_id = p_student and x.lesson_id = any(v_shared);
  -- Cascades the attendance, reports, timeline and links of the lessons that were only this child's.
  delete from public.lessons l where l.id = any(v_sole);
  delete from public.assignment_students x where x.student_id = p_student;
  -- An assignment with nobody left on it is ended, not deleted: it is the history of what was taught, and the preview says so.
  update public.tuition_assignments a set status = 'ENDED'
   where a.status <> 'ENDED'
     and not exists (select 1 from public.assignment_students s where s.assignment_id = a.id);
  get diagnostics v_assignments_ended = row_count;
  delete from public.consents c where c.student_id = p_student;
  delete from public.supervised_contexts c where c.student_id = p_student;
  delete from public.learner_invitations i where i.student_id = p_student;
  delete from public.learner_identities l where l.student_id = p_student;
  delete from public.identity_audit a where a.student_id = p_student;
  delete from public.notifications n where n.user_id = any(v_profiles);
  delete from public.chat_sessions c where c.student_id = p_student;
  delete from public.client_students c where c.student_id = p_student;
  delete from public.students s where s.id = p_student;

  return jsonb_build_object(
    'lessonsRemoved', coalesce(array_length(v_sole, 1), 0),
    'lessonsKept', coalesce(array_length(v_shared, 1), 0),
    'attendanceRemoved', v_attendance,
    'reportsRemoved', v_reports_removed,
    'reportsKept', v_reports_kept,
    'assignmentLinksRemoved', v_assignment_links,
    'assignmentsEnded', v_assignments_ended,
    'guardianLinksRemoved', v_guardian_links,
    'invitationsRemoved', v_invitations,
    'loginsRemoved', coalesce(array_length(v_profiles, 1), 0),
    'supervisedContextsRemoved', v_supervised,
    'auditRowsRemoved', v_audit,
    'notificationsRemoved', v_notifications,
    'chatsRemoved', v_chats,
    'chatFilesRemoved', v_chat_files,
    'recordsScrubbed', v_scrubbed
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Tutor: the record and login go; the lessons they taught stay, as an archived tutor's
-- ---------------------------------------------------------------------------------------------
-- lessons.tutor_id and lesson_reports.tutor_id are NOT NULL with ON DELETE RESTRICT, because a lesson must always name someone who
-- taught it. One archived tutor row absorbs them, so the real tutor's id appears nowhere after the purge while the scheduling history
-- (and the reports a student still needs) survives.
create or replace function private.purge_tutor(p_tutor uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_profile uuid;
  v_is_archived boolean;
  v_assignments int := 0;
  v_lessons int := 0;
  v_reports int := 0;
  v_blocks int := 0;
  v_notifications int := 0;
  v_logins int := 0;
begin
  select t.profile_id, t.id = '00000000-0000-4000-8000-0000000000fe'::uuid
    into v_profile, v_is_archived
    from public.tutors t where t.id = p_tutor;
  if not found then
    return null;
  end if;
  -- The archive row is a place to hang history, not a person: it is never purged.
  if v_is_archived then
    return null;
  end if;

  select count(*) into v_assignments from public.tuition_assignments a where a.tutor_id = p_tutor;
  select count(*) into v_lessons from public.lessons l where l.tutor_id = p_tutor;
  select count(*) into v_reports from public.lesson_reports r where r.tutor_id = p_tutor;
  select count(*) into v_blocks from public.tutor_availability_blocks b where b.tutor_id = p_tutor;
  if v_profile is not null then
    select count(*) into v_notifications from public.notifications n where n.user_id = v_profile;
    v_logins := 1;
  end if;

  insert into public.tutors (id, display_name, subjects, active)
  values ('00000000-0000-4000-8000-0000000000fe'::uuid, 'Former tutor', '{}'::text[], false)
  on conflict (id) do nothing;

  update public.tuition_assignments a set tutor_id = '00000000-0000-4000-8000-0000000000fe'::uuid, status = 'ENDED'
   where a.tutor_id = p_tutor;
  update public.lessons l set tutor_id = '00000000-0000-4000-8000-0000000000fe'::uuid where l.tutor_id = p_tutor;
  update public.lesson_reports r set tutor_id = '00000000-0000-4000-8000-0000000000fe'::uuid where r.tutor_id = p_tutor;
  delete from public.tutor_availability_blocks b where b.tutor_id = p_tutor;
  delete from public.notifications n where n.user_id = v_profile;
  delete from public.tutors t where t.id = p_tutor;

  return jsonb_build_object(
    'assignmentsEnded', v_assignments,
    'lessonsAnonymised', v_lessons,
    'reportsAnonymised', v_reports,
    'availabilityBlocksRemoved', v_blocks,
    'notificationsRemoved', v_notifications,
    'loginsRemoved', v_logins
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Family: each child, then the family account and the parent's login
-- ---------------------------------------------------------------------------------------------
create or replace function private.purge_family(p_client uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_student uuid;
  v_each jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_chats int := 0;
  v_notifications int := 0;
begin
  select c.owner_profile_id into v_owner from public.clients c where c.id = p_client;
  if not found then
    return null;
  end if;

  for v_student in select s.id from public.students s where s.client_id = p_client order by s.id loop
    v_each := private.purge_student(v_student);
    if v_each is not null then
      v_counts := (
        select coalesce(jsonb_object_agg(key, total), '{}'::jsonb)
          from (
            select key, sum(value::bigint)::bigint as total
              from (select key, value from jsonb_each_text(v_counts)
                    union all
                    select key, value from jsonb_each_text(v_each)) parts
             group by key
          ) sums
      );
    end if;
  end loop;

  select count(*) into v_chats from public.chat_sessions c where c.client_id = p_client;
  if v_owner is not null then
    select count(*) into v_notifications from public.notifications n where n.user_id = v_owner;
  end if;

  delete from public.chat_sessions c where c.client_id = p_client;
  delete from public.notifications n where n.user_id = v_owner;
  delete from public.consents c where c.profile_id = v_owner;
  -- Cascades any guardian link or chat left behind; every student row is already gone.
  delete from public.clients c where c.id = p_client;

  v_counts := v_counts || jsonb_build_object(
    'familiesRemoved', 1,
    'parentChatsRemoved', v_chats,
    'parentNotificationsRemoved', v_notifications,
    'loginsRemoved', coalesce((v_counts ->> 'loginsRemoved')::int, 0) + case when v_owner is null then 0 else 1 end
  );
  return v_counts;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- The public operations: the same, plus the log row (numbers only)
-- ---------------------------------------------------------------------------------------------
create or replace function public.purge_student(p_student uuid, p_actor uuid)
returns table (result text, counts jsonb, log_id uuid)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_counts jsonb;
  v_log uuid;
begin
  v_counts := private.purge_student(p_student);
  if v_counts is null then
    return query select 'not_found'::text, '{}'::jsonb, null::uuid;
    return;
  end if;
  insert into public.data_purges (kind, actor_profile_id, counts) values ('STUDENT', p_actor, v_counts) returning id into v_log;
  return query select 'ok'::text, v_counts, v_log;
end;
$$;

create or replace function public.purge_tutor(p_tutor uuid, p_actor uuid)
returns table (result text, counts jsonb, log_id uuid)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_counts jsonb;
  v_log uuid;
begin
  v_counts := private.purge_tutor(p_tutor);
  if v_counts is null then
    return query select 'not_found'::text, '{}'::jsonb, null::uuid;
    return;
  end if;
  insert into public.data_purges (kind, actor_profile_id, counts) values ('TUTOR', p_actor, v_counts) returning id into v_log;
  return query select 'ok'::text, v_counts, v_log;
end;
$$;

create or replace function public.purge_family(p_client uuid, p_actor uuid)
returns table (result text, counts jsonb, log_id uuid)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_counts jsonb;
  v_log uuid;
begin
  v_counts := private.purge_family(p_client);
  if v_counts is null then
    return query select 'not_found'::text, '{}'::jsonb, null::uuid;
    return;
  end if;
  insert into public.data_purges (kind, actor_profile_id, counts) values ('FAMILY', p_actor, v_counts) returning id into v_log;
  return query select 'ok'::text, v_counts, v_log;
end;
$$;

-- Only the server calls these: never a browser key, never PUBLIC.
revoke all on function private.purge_student(uuid) from public, anon, authenticated;
revoke all on function private.purge_tutor(uuid) from public, anon, authenticated;
revoke all on function private.purge_family(uuid) from public, anon, authenticated;
revoke all on function public.purge_student(uuid, uuid) from public, anon, authenticated;
revoke all on function public.purge_tutor(uuid, uuid) from public, anon, authenticated;
revoke all on function public.purge_family(uuid, uuid) from public, anon, authenticated;

grant execute on function private.purge_student(uuid) to service_role;
grant execute on function private.purge_tutor(uuid) to service_role;
grant execute on function private.purge_family(uuid) to service_role;
grant execute on function public.purge_student(uuid, uuid) to service_role;
grant execute on function public.purge_tutor(uuid, uuid) to service_role;
grant execute on function public.purge_family(uuid, uuid) to service_role;
