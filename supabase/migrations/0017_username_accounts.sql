-- 0017_username_accounts.sql — LearnThrive creates every account, and people sign in with a username (launch checklist 0.2, 3.2).
--
-- Supabase Auth requires an email address, so each username has a fixed internal address built from it, which only ever goes to Auth
-- and is never mailed (apps/web/src/lib/account/username.ts). The address a person can actually be reached on is `linked_email`: their
-- own, or for a learner their parent's. Public sign-up stays off for good, so a login is made by an administrator through the Auth
-- Admin API and then bound to its record here, in one transaction, by provision_account. Re-runnable; additive only.

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists linked_email text;
alter table public.profiles add column if not exists must_change_password boolean not null default false;
alter table public.profiles add column if not exists login_disabled_at timestamptz;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or (char_length(username) between 3 and 30 and username ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'));
alter table public.profiles drop constraint if exists profiles_linked_email_format;
alter table public.profiles add constraint profiles_linked_email_format
  check (linked_email is null or (char_length(linked_email) <= 160 and linked_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));

create unique index if not exists profiles_username_idx on public.profiles (username);

comment on column public.profiles.username is
  'What the person types to sign in. Lower case and unique. A child''s is generated, never built from their name or school.';
comment on column public.profiles.linked_email is
  'Where resets, notices and invoices go: the person''s own address, or their parent''s for a learner. Not the Auth address, which is internal and never mailed.';
comment on column public.profiles.must_change_password is
  'Set when an administrator issues a temporary password. Nothing but choosing a new one works until it is cleared.';
comment on column public.profiles.login_disabled_at is
  'When an administrator disabled this login. Auth holds the ban itself; this is what the site reads, and a disabled login gets no reset email.';

-- The address to write to: the linked one, and only otherwise the Auth one. Replaces 0009's version, so no caller can ever reach the
-- internal address by accident (billing emails, the tutor and family lists).
create or replace function public.auth_email(p_profile uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.linked_email, u.email::text)
    from auth.users u left join public.profiles p on p.id = u.id
   where u.id = p_profile
$$;

comment on function public.auth_email(uuid) is 'The address to write to for a profile: the linked email, else the Auth address. Server only: the narrow server role never reads the auth schema directly.';

-- Binds a login the Admin API has just made to its record. One transaction, so a person is never half made: on any refusal nothing
-- changes, and the caller deletes the login again. Only a brand new login qualifies, whatever is asked for, so this can never convert
-- an existing person. ADMIN is accepted here because the operator script uses it; no screen ever asks for it (apps/web lib/account/provision.ts).
create or replace function public.provision_account(
  p_profile uuid,
  p_username text,
  p_linked_email text,
  p_display_name text,
  p_role text,
  p_tutor uuid,
  p_student uuid,
  p_actor uuid,
  p_now timestamptz
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_client uuid;
begin
  if p_role is null or p_role not in ('ADMIN', 'TUTOR', 'CLIENT', 'STUDENT')
     or (p_role = 'TUTOR') <> (p_tutor is not null) and p_role <> 'ADMIN'
     or (p_role = 'STUDENT') <> (p_student is not null) then
    return 'not_eligible';
  end if;

  select * into v_profile from public.profiles p where p.id = p_profile for update;
  if not found then
    return 'no_profile';
  end if;
  if v_profile.username is not null or v_profile.role <> 'CLIENT'
     or exists (select 1 from public.clients c where c.owner_profile_id = p_profile)
     or exists (select 1 from public.learner_identities l where l.profile_id = p_profile)
     or exists (select 1 from public.tutors t where t.profile_id = p_profile) then
    return 'not_eligible';
  end if;
  if exists (select 1 from public.profiles p where p.username = p_username) then
    return 'username_taken';
  end if;

  if p_student is not null then
    select cs.client_id into v_client
      from public.students s join public.client_students cs on cs.student_id = s.id and cs.status = 'active'
     where s.id = p_student and s.active
     order by (cs.client_id = s.client_id) desc
     limit 1;
    if v_client is null or exists (select 1 from public.learner_identities l where l.student_id = p_student and l.status <> 'revoked') then
      return 'not_eligible';
    end if;
  end if;

  if p_tutor is not null then
    update public.tutors t set profile_id = p_profile where t.id = p_tutor and t.profile_id is null;
    if not found then
      return 'not_eligible';
    end if;
  end if;

  update public.profiles p
     set username = p_username,
         linked_email = lower(p_linked_email),
         display_name = left(btrim(p_display_name), 80),
         role = p_role,
         must_change_password = true,
         adult_confirmed_at = case when p_role = 'STUDENT' then null else coalesce(p.adult_confirmed_at, p_now) end
   where p.id = p_profile;

  if p_role = 'CLIENT' then
    insert into public.clients (owner_profile_id) values (p_profile) returning id into v_client;
  elsif p_student is not null then
    -- A student whose earlier login was revoked can be bound to a new one: the revoked record is kept only as the audit trail.
    delete from public.learner_identities l where l.student_id = p_student and l.status = 'revoked';
    insert into public.learner_identities (student_id, profile_id, activated_at) values (p_student, p_profile, p_now);
    update public.students s set access_mode = 'direct' where s.id = p_student;
  end if;

  insert into public.identity_audit (at, actor_profile_id, action, client_id, student_id)
  values (p_now, p_actor, 'account_created', v_client, p_student);
  return 'ok';
exception
  when unique_violation then
    return 'username_taken';
end;
$$;

comment on function public.provision_account(uuid, text, text, text, text, uuid, uuid, uuid, timestamptz) is
  'Binds a brand new login to its username, linked email, role and record, in one transaction. Server only. Answers ok, no_profile, username_taken or not_eligible.';

revoke all on function public.provision_account(uuid, text, text, text, text, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.provision_account(uuid, text, text, text, text, uuid, uuid, uuid, timestamptz) to service_role;
