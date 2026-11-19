-- 0029_lesson_chat_threads.sql — a lesson's chat carries over to every later occurrence of the same assignment (docs/LESSON_CHAT.md).
--
-- 0027 gave each lesson row its own conversation. A weekly maths lesson is one assignment with a lesson row per week, so the chat (and its files)
-- is now keyed by the ASSIGNMENT: thread_id = the lesson's assignment_id, set by the database on insert, never by the client. Who may send is
-- unchanged (the lesson's own tutor or a student on it, only during that occurrence); anyone who is part of a later occurrence reads the whole thread.
--
-- Also adds lesson_file_objects: the stored bytes, in Postgres, private (no API grants), so shared files survive a restart without a storage bucket.
-- Re-runnable.

alter table public.lesson_messages add column if not exists thread_id uuid;
alter table public.lesson_files add column if not exists thread_id uuid;

-- One-time backfill, past the append-only guards.
alter table public.lesson_messages disable trigger lesson_messages_update_guard;
alter table public.lesson_files disable trigger lesson_files_no_update;
update public.lesson_messages m set thread_id = l.assignment_id from public.lessons l where l.id = m.lesson_id and m.thread_id is null;
update public.lesson_files f set thread_id = l.assignment_id from public.lessons l where l.id = f.lesson_id and f.thread_id is null;
alter table public.lesson_messages enable trigger lesson_messages_update_guard;
alter table public.lesson_files enable trigger lesson_files_no_update;

alter table public.lesson_messages alter column thread_id set not null;
alter table public.lesson_files alter column thread_id set not null;
create index if not exists lesson_messages_thread_idx on public.lesson_messages (thread_id, created_at, id);
create index if not exists lesson_files_thread_idx on public.lesson_files (thread_id);

-- The insert guards stamp the thread from the lesson, so the caller cannot choose it.
create or replace function private.lesson_messages_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_lesson public.lessons%rowtype;
begin
  select * into v_lesson from public.lessons l where l.id = new.lesson_id;
  if not found then
    raise exception 'There is no such lesson.' using errcode = 'foreign_key_violation';
  end if;
  if v_lesson.status in ('CANCELLED', 'NO_SHOW') then
    raise exception 'A cancelled lesson has no chat.' using errcode = 'check_violation';
  end if;
  new.created_at := now();
  new.thread_id := v_lesson.assignment_id;
  if now() < v_lesson.start_at - interval '60 minutes' or now() >= v_lesson.start_at + make_interval(mins => v_lesson.duration_minutes) + interval '60 minutes' then
    raise exception 'Messages can only be sent during the lesson.' using errcode = 'check_violation';
  end if;

  if new.sender_party = 'tutor' then
    if new.sender_record_id is distinct from v_lesson.tutor_id
       or not exists (select 1 from public.tutors t where t.id = v_lesson.tutor_id and t.profile_id = new.sender_profile_id)
       or not exists (select 1 from public.profile_roles r where r.profile_id = new.sender_profile_id and r.role = 'TUTOR') then
      raise exception 'Only the lesson''s tutor can send as its tutor.' using errcode = 'insufficient_privilege';
    end if;
  else
    if not exists (select 1 from public.lesson_students ls where ls.lesson_id = new.lesson_id and ls.student_id = new.sender_record_id)
       or not exists (select 1 from public.learner_identities li where li.student_id = new.sender_record_id and li.profile_id = new.sender_profile_id and li.status = 'active')
       or not exists (select 1 from public.profile_roles r where r.profile_id = new.sender_profile_id and r.role = 'STUDENT') then
      raise exception 'Only a student enrolled in this lesson can send as a student.' using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.removed_at is not null or new.removed_by is not null or new.removal_reason is not null then
    raise exception 'A message is not sent already removed.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create or replace function private.lesson_files_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_thread uuid;
begin
  select m.thread_id into v_thread from public.lesson_messages m where m.id = new.message_id and m.lesson_id = new.lesson_id;
  if not found then
    raise exception 'A file belongs to the lesson of its message.' using errcode = 'check_violation';
  end if;
  new.thread_id := v_thread;
  return new;
end;
$$;

-- Stored bytes. Private: no grant to any API role; only the server writes and reads.
create table if not exists public.lesson_file_objects (
  storage_key text primary key check (storage_key ~ '^lessons/[A-Za-z0-9_-]{1,80}/[0-9a-f-]{36}\.(png|jpg|pdf)$'),
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'application/pdf')),
  bytes bytea not null check (octet_length(bytes) between 1 and 26214400),
  created_at timestamptz not null default now()
);
alter table public.lesson_file_objects enable row level security;
alter table public.lesson_file_objects force row level security;
revoke all on public.lesson_file_objects from anon, authenticated;

comment on table public.lesson_file_objects is 'The bytes of files shared in a lesson chat, keyed by lesson_files.storage_key. Private: only the server reads and writes it.';
comment on column public.lesson_messages.thread_id is 'The conversation: the lesson''s assignment, so every occurrence of a recurring lesson shares one chat. Stamped by the database.';
