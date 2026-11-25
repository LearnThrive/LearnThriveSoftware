-- 0032_admin_lesson_chat.sql: an administrator may step into a lesson's chat (docs/LESSON_CHAT.md, "Administrators").
--
-- Until now only the lesson's own tutor and a student on it could send. An administrator could read every lesson's chat (audited) but not say
-- anything, so a problem in a lesson (a student who cannot get in, a tutor who needs help, a worrying message) had no channel to the people in it.
-- Now an administrator may send, AS AN ADMINISTRATOR (sender_party 'admin', shown to everyone as such), at any time, on any lesson that is not
-- cancelled. The record they send as is their own profile. The database checks it by itself, as it does for tutors and students: the sender must
-- hold the ADMIN role and must be sending as themself. The tutor and student rules (the lesson's own people, the hour either side) are unchanged.
-- Re-runnable.

alter table public.lesson_messages drop constraint if exists lesson_messages_sender_party_check;
alter table public.lesson_messages add constraint lesson_messages_sender_party_check check (sender_party in ('tutor', 'student', 'admin'));

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

  if new.sender_party = 'admin' then
    -- An administrator, sending as themself: their own profile is the record, and they hold the ADMIN role. Any time: a problem does not keep to
    -- the timetable.
    if new.sender_profile_id is null
       or new.sender_record_id is distinct from new.sender_profile_id
       or not exists (select 1 from public.profile_roles r where r.profile_id = new.sender_profile_id and r.role = 'ADMIN') then
      raise exception 'Only an administrator can send as an administrator.' using errcode = 'insufficient_privilege';
    end if;
  else
    -- The lesson's own people: the outer limit is the database's, an hour either side of the schedule (the application enforces the exact window).
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
  end if;

  if new.removed_at is not null or new.removed_by is not null or new.removal_reason is not null then
    raise exception 'A message is not sent already removed.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- An administrator joining a lesson's classroom to supervise it is written to the lesson's own history, which its tutor sees: supervision is never
-- hidden from the people being supervised.
alter table public.lesson_activity drop constraint if exists lesson_activity_type_check;
alter table public.lesson_activity add constraint lesson_activity_type_check
  check (type in ('CREATED', 'RESCHEDULED', 'CANCELLED', 'ATTENDANCE_MARKED', 'COMPLETED', 'REPORT_SUBMITTED', 'REPORT_APPROVED', 'REPORT_RETURNED', 'SUPERVISED'));
