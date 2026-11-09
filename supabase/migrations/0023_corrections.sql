-- 0023_corrections.sql — putting a record right, on the record (docs/improvement/PLAN.md items 5 and 6).
--
--   identity_audit.tutor_id   an administrator correcting a tutor's details (name, contact email, subjects) is audited like a correction
--                             to a student's, so the row needs to say which tutor. Ids only, as before: the audit never holds a name,
--                             an address or the old or new value, only WHICH fields changed (in `detail`). Cleared when the tutor is
--                             purged, like the other ids on this table.
--   lesson_activity.type      a new event, REPORT_RETURNED: an administrator sent a submitted report back to its tutor for changes.
--
-- Re-runnable; additive only.

alter table public.identity_audit add column if not exists tutor_id uuid references public.tutors (id) on delete set null;
create index if not exists identity_audit_tutor_idx on public.identity_audit (tutor_id, at desc) where tutor_id is not null;
comment on column public.identity_audit.tutor_id is 'The tutor a correction was about (tutor_details_changed). Ids only; cleared when the tutor is purged.';

alter table public.lesson_activity drop constraint if exists lesson_activity_type_check;
alter table public.lesson_activity add constraint lesson_activity_type_check
  check (type in ('CREATED', 'RESCHEDULED', 'CANCELLED', 'ATTENDANCE_MARKED', 'COMPLETED', 'REPORT_SUBMITTED', 'REPORT_APPROVED', 'REPORT_RETURNED'));
