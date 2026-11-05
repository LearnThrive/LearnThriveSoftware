-- 0019_leaving.sql — the delay between "marked as left" and the purge (launch checklist 3.7.3).
--
-- 0018 made a purge final the moment an administrator typed the phrase. 3.7.3 asks for a pause first: a person is marked as left, and
-- the purge becomes possible a set number of days later, which the administrator may bring forward. This adds:
--
--   left_at / left_by / purge_after   on students, tutors and clients. All three together or none: a record is either still with us,
--                                    or it has a leaving date and an earliest purge date.
--   the due rule, in the database     public.purge_student / _tutor / _family now answer 'not_left' or 'not_due' instead of deleting.
--                                    The site checks as well, but the rule lives here so no caller can skip it.
--
-- `left_at` is NOT `active`. `active` means suspended and reversible by itself; `left_at` means gone, and starts a clock that ends in
-- deletion. Marking as left changes nothing else and can be undone (`left_at` back to null) until the purge happens.
--
-- The default delay (30 days) is NOT written here: the site holds it (PURGE_DELAY_DAYS in packages/data/src/repositories.ts) and sends
-- the date it computed, so the screen and the database can never disagree about it. What the database enforces is only "not before the
-- date on the row", which is what makes the delay real rather than advice.
--
-- Re-runnable; additive only. The three wrappers are replaced rather than edited in 0018, so a database already at 0018 moves forward
-- the same way a new one does.

-- ---------------------------------------------------------------------------------------------
-- The columns
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array['students', 'tutors', 'clients'] loop
    execute format('alter table public.%I add column if not exists left_at timestamptz', v_table);
    execute format('alter table public.%I add column if not exists left_by uuid references public.profiles (id) on delete set null', v_table);
    execute format('alter table public.%I add column if not exists purge_after timestamptz', v_table);
    if not exists (select 1 from pg_constraint where conname = format('%s_leaving_check', v_table)) then
      execute format('alter table public.%I add constraint %I check ((left_at is null) = (purge_after is null))', v_table, format('%s_leaving_check', v_table));
    end if;
    execute format('create index if not exists %I on public.%I (purge_after) where left_at is not null', format('%s_purge_after_idx', v_table), v_table);
  end loop;
end $$;

comment on column public.students.left_at is
  'When this student left, or null. Not the same as active (suspended): left_at starts the clock in launch checklist 3.7.3 that ends in a purge. Reversible until then.';
comment on column public.students.purge_after is
  'The earliest the student may be purged. Set when they are marked as left, and only ever brought forward by an administrator.';
comment on column public.tutors.left_at is 'When this tutor left, or null. See public.students.left_at.';
comment on column public.tutors.purge_after is 'The earliest this tutor may be purged. See public.students.purge_after.';
comment on column public.clients.left_at is 'When this family left, or null. See public.students.left_at.';
comment on column public.clients.purge_after is 'The earliest this family may be purged. See public.students.purge_after.';

-- ---------------------------------------------------------------------------------------------
-- The due rule, enforced where it cannot be skipped
-- ---------------------------------------------------------------------------------------------
-- Answers: 'not_left' (nobody marked them as left), 'not_due' (the delay has not run out), or null when it may go ahead.
create or replace function private.purge_blocked(p_left_at timestamptz, p_purge_after timestamptz, p_now timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_left_at is null or p_purge_after is null then 'not_left'
    when p_purge_after > p_now then 'not_due'
    else null
  end
$$;

comment on function private.purge_blocked(timestamptz, timestamptz, timestamptz) is
  'Why a purge may not go ahead yet, or null when it may. One place, so the three operations cannot drift apart.';

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
  v_blocked text;
  v_found boolean;
begin
  select true, private.purge_blocked(s.left_at, s.purge_after, now())
    into v_found, v_blocked
    from public.students s where s.id = p_student;
  if not coalesce(v_found, false) then
    return query select 'not_found'::text, '{}'::jsonb, null::uuid;
    return;
  end if;
  if v_blocked is not null then
    return query select v_blocked, '{}'::jsonb, null::uuid;
    return;
  end if;

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
  v_blocked text;
  v_found boolean;
begin
  select true, private.purge_blocked(t.left_at, t.purge_after, now())
    into v_found, v_blocked
    from public.tutors t where t.id = p_tutor;
  if not coalesce(v_found, false) then
    return query select 'not_found'::text, '{}'::jsonb, null::uuid;
    return;
  end if;
  if v_blocked is not null then
    return query select v_blocked, '{}'::jsonb, null::uuid;
    return;
  end if;

  v_counts := private.purge_tutor(p_tutor);
  if v_counts is null then
    return query select 'not_found'::text, '{}'::jsonb, null::uuid;
    return;
  end if;
  insert into public.data_purges (kind, actor_profile_id, counts) values ('TUTOR', p_actor, v_counts) returning id into v_log;
  return query select 'ok'::text, v_counts, v_log;
end;
$$;

-- A family's children go with it, and each child is purged by the same code as a single student. A child does NOT need its own leaving
-- date for that: the family's is the decision, and a child cannot stay behind once the family record is gone.
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
  v_blocked text;
  v_found boolean;
begin
  select true, private.purge_blocked(c.left_at, c.purge_after, now())
    into v_found, v_blocked
    from public.clients c where c.id = p_client;
  if not coalesce(v_found, false) then
    return query select 'not_found'::text, '{}'::jsonb, null::uuid;
    return;
  end if;
  if v_blocked is not null then
    return query select v_blocked, '{}'::jsonb, null::uuid;
    return;
  end if;

  v_counts := private.purge_family(p_client);
  if v_counts is null then
    return query select 'not_found'::text, '{}'::jsonb, null::uuid;
    return;
  end if;
  insert into public.data_purges (kind, actor_profile_id, counts) values ('FAMILY', p_actor, v_counts) returning id into v_log;
  return query select 'ok'::text, v_counts, v_log;
end;
$$;

revoke all on function private.purge_blocked(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function private.purge_blocked(timestamptz, timestamptz, timestamptz) to service_role;
