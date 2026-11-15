-- 0025_roles.sql — a person holds a SET of roles, not one (docs/ROLE_PERMISSIONS.md).
--
--   profile_roles          one row per role a person holds. This is the source of truth for what a person may do. Server only: RLS forced, no
--                          policy, no grant to anon or authenticated, so nothing a signed-in person sends can write it.
--   role_changes           append-only: who changed whose roles, when, from what to what. Ids and role names only.
--   public.set_profile_roles   the ONLY way the application changes roles. It checks, under row locks, everything the application also
--                          checks (the caller is an administrator and not the person being changed; the set is valid; the last administrator
--                          stays one; a role that needs a record has one), writes the change and the audit row in one transaction.
--   JUNIOR_TUTOR           a new role: a narrower tutor. It cannot be held together with TUTOR, so a union can never make a junior a tutor.
--
-- profiles.role is KEPT, but only as the PRIMARY role of the set (highest of ADMIN, TUTOR, JUNIOR_TUTOR, CLIENT, STUDENT), maintained from
-- profile_roles by a trigger. Older database functions (the learner invitation accept, provision_account) and the policies read or write it, and
-- rewriting them is a separate, riskier change. A write to profiles.role by one of those REPLACES the set with that one role, which is what they
-- always meant. The application never reads profiles.role for an authorization decision: it reads profile_roles.
--
-- Backfill: every profile gets its current role; an administrator who has a tutor record also gets TUTOR (that capability is now a role).
-- Additive and re-runnable. NOT applied to any hosted project: it needs the owner's go-ahead (launch checklist 4.2 and 4.3).

-- ---------------------------------------------------------------------------------------------
-- The roles a profile may hold: widen the old four to five
-- ---------------------------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('ADMIN', 'TUTOR', 'JUNIOR_TUTOR', 'CLIENT', 'STUDENT'));

create table if not exists public.profile_roles (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('ADMIN', 'TUTOR', 'JUNIOR_TUTOR', 'CLIENT', 'STUDENT')),
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (profile_id, role)
);
create index if not exists profile_roles_role_idx on public.profile_roles (role);

insert into public.profile_roles (profile_id, role) select p.id, p.role from public.profiles p on conflict do nothing;
insert into public.profile_roles (profile_id, role)
  select t.profile_id, 'TUTOR' from public.tutors t join public.profiles p on p.id = t.profile_id
   where p.role = 'ADMIN' and not exists (select 1 from public.profile_roles r where r.profile_id = t.profile_id and r.role in ('TUTOR', 'JUNIOR_TUTOR'))
  on conflict do nothing;

create table if not exists public.role_changes (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_profile_id uuid references public.profiles (id) on delete set null,
  target_profile_id uuid references public.profiles (id) on delete set null,
  old_roles text[] not null,
  new_roles text[] not null
);
create index if not exists role_changes_target_idx on public.role_changes (target_profile_id, at desc);

-- Append-only, but the two ids may be CLEARED (set null) when a person is purged, as in identity_audit: nothing else may change.
create or replace function private.role_changes_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'role_changes is append-only' using errcode = 'restrict_violation';
  end if;
  if (to_jsonb(new) - 'actor_profile_id' - 'target_profile_id') is distinct from (to_jsonb(old) - 'actor_profile_id' - 'target_profile_id')
     or (new.actor_profile_id is not null and new.actor_profile_id is distinct from old.actor_profile_id)
     or (new.target_profile_id is not null and new.target_profile_id is distinct from old.target_profile_id) then
    raise exception 'role_changes is append-only: a change of roles is never edited' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists role_changes_guard on public.role_changes;
create trigger role_changes_guard before update or delete on public.role_changes for each row execute function private.role_changes_guard();

-- ---------------------------------------------------------------------------------------------
-- Invariants, enforced in the database as well as in the application
-- ---------------------------------------------------------------------------------------------
-- Internal writes (the sync below and the legacy replace) set this for their own transaction, so the checks do not fire on their own work.
create or replace function private.roles_internal() returns boolean
language sql stable set search_path = '' as $$ select coalesce(current_setting('private.roles_internal', true), '') = '1' $$;

create or replace function private.profile_roles_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.roles_internal() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    -- Only while the person still exists: deleting a person (a purge) removes their roles with them.
    if exists (select 1 from public.profiles p where p.id = old.profile_id) then
      if old.role = 'ADMIN' and not exists (select 1 from public.profile_roles r where r.role = 'ADMIN' and r.profile_id <> old.profile_id) then
        raise exception 'the last administrator cannot lose the admin role' using errcode = 'restrict_violation';
      end if;
      if not exists (select 1 from public.profile_roles r where r.profile_id = old.profile_id and r.role <> old.role) then
        raise exception 'a person must keep at least one role' using errcode = 'restrict_violation';
      end if;
    end if;
    return old;
  end if;
  if exists (
    select 1 from public.profile_roles r
     where r.profile_id = new.profile_id and r.role <> new.role
       and ((new.role = 'TUTOR' and r.role = 'JUNIOR_TUTOR') or (new.role = 'JUNIOR_TUTOR' and r.role = 'TUTOR')
         or (new.role = 'CLIENT' and r.role = 'STUDENT') or (new.role = 'STUDENT' and r.role = 'CLIENT'))) then
    raise exception 'those roles cannot be held together' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists profile_roles_check on public.profile_roles;
create trigger profile_roles_check before insert or update or delete on public.profile_roles for each row execute function private.profile_roles_check();

-- profiles.role follows the set: the highest role held.
create or replace function private.sync_primary_role() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := coalesce(new.profile_id, old.profile_id);
  v_primary text;
  v_prev text := coalesce(current_setting('private.roles_internal', true), '');
begin
  select r.role into v_primary from public.profile_roles r where r.profile_id = v_id
   order by array_position(array['ADMIN', 'TUTOR', 'JUNIOR_TUTOR', 'CLIENT', 'STUDENT'], r.role) limit 1;
  if v_primary is not null then
    perform set_config('private.roles_internal', '1', true);
    update public.profiles p set role = v_primary where p.id = v_id and p.role is distinct from v_primary;
    perform set_config('private.roles_internal', v_prev, true); -- put it back as found: a caller may be inside its own internal write
  end if;
  return null;
end;
$$;
drop trigger if exists sync_primary_role on public.profile_roles;
create trigger sync_primary_role after insert or update or delete on public.profile_roles for each row execute function private.sync_primary_role();

-- A direct write to profiles.role (the sign-up trigger's insert, provision_account, the learner invitation accept) REPLACES the set with that one role.
create or replace function private.profile_role_written() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.roles_internal() then
    return null;
  end if;
  -- A direct write cannot strip the last administrator either.
  if new.role <> 'ADMIN' and exists (select 1 from public.profile_roles r where r.profile_id = new.id and r.role = 'ADMIN')
     and not exists (select 1 from public.profile_roles r where r.role = 'ADMIN' and r.profile_id <> new.id) then
    raise exception 'the last administrator cannot lose the admin role' using errcode = 'restrict_violation';
  end if;
  perform set_config('private.roles_internal', '1', true);
  insert into public.profile_roles (profile_id, role) values (new.id, new.role) on conflict do nothing;
  -- An administrator who is linked to a tutor record teaches: that capability is now the TUTOR role (create-account and promote-admin rely on this).
  if new.role = 'ADMIN' and exists (select 1 from public.tutors t where t.profile_id = new.id)
     and not exists (select 1 from public.profile_roles r where r.profile_id = new.id and r.role in ('TUTOR', 'JUNIOR_TUTOR')) then
    insert into public.profile_roles (profile_id, role) values (new.id, 'TUTOR') on conflict do nothing;
  end if;
  -- Becoming an administrator ADDS to a person who already teaches (promote-admin has always left their tutor record working); any other
  -- direct write is a replacement.
  delete from public.profile_roles r where r.profile_id = new.id and r.role <> new.role
     and not (new.role = 'ADMIN' and r.role in ('TUTOR', 'JUNIOR_TUTOR'));
  perform set_config('private.roles_internal', '', true);
  return null;
end;
$$;
drop trigger if exists profile_role_written on public.profiles;
create trigger profile_role_written after insert or update of role on public.profiles for each row execute function private.profile_role_written();

-- Linking a tutor record to an administrator's login gives them TUTOR (an administrator who teaches).
create or replace function private.tutor_linked() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.profile_id is not null and exists (select 1 from public.profile_roles r where r.profile_id = new.profile_id and r.role = 'ADMIN')
     and not exists (select 1 from public.profile_roles r where r.profile_id = new.profile_id and r.role in ('TUTOR', 'JUNIOR_TUTOR')) then
    insert into public.profile_roles (profile_id, role) values (new.profile_id, 'TUTOR') on conflict do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists tutor_linked on public.tutors;
create trigger tutor_linked after insert or update of profile_id on public.tutors for each row execute function private.tutor_linked();

-- Administrator, from the set (the policies call this).
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profile_roles r where r.profile_id = auth.uid() and r.role = 'ADMIN')
$$;

-- ---------------------------------------------------------------------------------------------
-- The one writer
-- ---------------------------------------------------------------------------------------------
create or replace function public.set_profile_roles(p_actor uuid, p_profile uuid, p_roles text[], p_now timestamptz)
returns table (status text, before_roles text[], after_roles text[])
language plpgsql security definer set search_path = '' as $$
declare
  v_order text[] := array['ADMIN', 'TUTOR', 'JUNIOR_TUTOR', 'CLIENT', 'STUDENT'];
  v_before text[];
  v_after text[];
  v_role text;
begin
  -- Lock every administrator's roles and the target's, so two changes at once cannot both leave no administrator.
  perform 1 from public.profile_roles r where r.role = 'ADMIN' or r.profile_id = p_profile for update;

  if not exists (select 1 from public.profile_roles r where r.profile_id = p_actor and r.role = 'ADMIN') then
    return query select 'not_admin'::text, null::text[], null::text[]; return;
  end if;
  if p_actor = p_profile then
    return query select 'self'::text, null::text[], null::text[]; return;
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile) then
    return query select 'not_found'::text, null::text[], null::text[]; return;
  end if;

  select coalesce(array_agg(x order by array_position(v_order, x)), '{}') into v_after from (select distinct unnest(coalesce(p_roles, '{}')) as x) s;
  if cardinality(v_after) = 0 then
    return query select 'empty'::text, null::text[], null::text[]; return;
  end if;
  if exists (select 1 from unnest(v_after) x where x <> all (v_order)) then
    return query select 'unknown_role'::text, null::text[], null::text[]; return;
  end if;
  if ('TUTOR' = any (v_after) and 'JUNIOR_TUTOR' = any (v_after)) or ('CLIENT' = any (v_after) and 'STUDENT' = any (v_after)) then
    return query select 'exclusive'::text, null::text[], null::text[]; return;
  end if;

  select coalesce(array_agg(r.role order by array_position(v_order, r.role)), '{}') into v_before from public.profile_roles r where r.profile_id = p_profile;
  if v_before = v_after then
    return query select 'unchanged'::text, v_before, v_after; return;
  end if;
  if 'ADMIN' = any (v_before) and not ('ADMIN' = any (v_after))
     and not exists (select 1 from public.profile_roles r where r.role = 'ADMIN' and r.profile_id <> p_profile) then
    return query select 'last_admin'::text, v_before, v_after; return;
  end if;
  -- A role that means "this person's own record" needs the record: nobody is a tutor without a tutor record, or a student without a learner login.
  if ('TUTOR' = any (v_after) or 'JUNIOR_TUTOR' = any (v_after)) and not exists (select 1 from public.tutors t where t.profile_id = p_profile) then
    return query select 'needs_record'::text, v_before, v_after; return;
  end if;
  if 'STUDENT' = any (v_after) and not exists (select 1 from public.learner_identities l where l.profile_id = p_profile and l.status = 'active') then
    return query select 'needs_record'::text, v_before, v_after; return;
  end if;

  perform set_config('private.roles_internal', '1', true);
  insert into public.profile_roles (profile_id, role, granted_by, granted_at)
    select p_profile, x, p_actor, p_now from unnest(v_after) x where x <> all (v_before);
  delete from public.profile_roles r where r.profile_id = p_profile and r.role <> all (v_after);
  -- The primary role follows (written here while the internal flag is still on, so the legacy-write trigger leaves the set alone).
  select r.role into v_role from public.profile_roles r where r.profile_id = p_profile order by array_position(v_order, r.role) limit 1;
  update public.profiles p set role = v_role where p.id = p_profile and p.role is distinct from v_role;
  perform set_config('private.roles_internal', '', true);

  insert into public.role_changes (at, actor_profile_id, target_profile_id, old_roles, new_roles) values (p_now, p_actor, p_profile, v_before, v_after);
  return query select 'changed'::text, v_before, v_after;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Server only
-- ---------------------------------------------------------------------------------------------
alter table public.profile_roles enable row level security;
alter table public.role_changes enable row level security;
alter table public.profile_roles force row level security;
alter table public.role_changes force row level security;
revoke all on public.profile_roles, public.role_changes from anon, authenticated;
revoke all on function public.set_profile_roles(uuid, uuid, text[], timestamptz) from public, anon, authenticated;

comment on table public.profile_roles is 'The roles each person holds (a set). The source of truth for what a person may do; profiles.role is only the primary one, kept for older functions. Server only.';
comment on table public.role_changes is 'Append-only: who changed whose roles, when, from what to what. Ids and role names only. Server only.';
comment on function public.set_profile_roles(uuid, uuid, text[], timestamptz) is 'Changes a person''s roles after checking the caller is an administrator (and not the person), the set is valid, the last administrator stays one and a role that needs a record has one; audits it. Server only.';

-- Same convention as 0005, 0010, 0013 and 0021: every function in private is executable by the API roles (a trigger function cannot be called directly).
grant execute on all functions in schema private to authenticated, service_role;
