-- 0035_lesson_chat_any_time.sql: a lesson's tutor and students may message in its chat at any time (docs/LESSON_CHAT.md).
--
-- Until now they could send only during the lesson (the database allowing an hour either side), so nobody could say beforehand that they were running
-- late or could not come. Now the tutor and the enrolled students may send at any time on any lesson that is not cancelled, as an administrator
-- already may (0032). Who may send is unchanged and still checked here: the lesson's own tutor, or a student enrolled in it, as themself. Parents
-- still only read, administrators still read everything, and nothing can be edited or deleted.
--
-- A message sent outside the lesson's time is announced to the others with an in-app notification, so notifications gain the type LESSON_MESSAGE.
-- Re-runnable.

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
  -- The time is the database's: a message cannot be back-dated or sent ahead.
  new.created_at := now();
  new.thread_id := v_lesson.assignment_id;

  if new.sender_party = 'admin' then
    -- An administrator, sending as themself: their own profile is the record, and they hold the ADMIN role.
    if new.sender_profile_id is null
       or new.sender_record_id is distinct from new.sender_profile_id
       or not exists (select 1 from public.profile_roles r where r.profile_id = new.sender_profile_id and r.role = 'ADMIN') then
      raise exception 'Only an administrator can send as an administrator.' using errcode = 'insufficient_privilege';
    end if;
  elsif new.sender_party = 'tutor' then
    -- The lesson's own tutor record, belonging to the sender, and the sender holds the TUTOR role. A junior tutor (JUNIOR_TUTOR) cannot send.
    if new.sender_record_id is distinct from v_lesson.tutor_id
       or not exists (select 1 from public.tutors t where t.id = v_lesson.tutor_id and t.profile_id = new.sender_profile_id)
       or not exists (select 1 from public.profile_roles r where r.profile_id = new.sender_profile_id and r.role = 'TUTOR') then
      raise exception 'Only the lesson''s tutor can send as its tutor.' using errcode = 'insufficient_privilege';
    end if;
  else
    -- A student enrolled in this lesson, through their own learner login.
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

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('LESSON_REMINDER', 'LESSON_RESCHEDULED', 'REPORT_AVAILABLE', 'REPORT_REQUIRED', 'REPORT_AWAITING_APPROVAL', 'SCHEDULING_CONFLICT', 'LESSON_MESSAGE'));
