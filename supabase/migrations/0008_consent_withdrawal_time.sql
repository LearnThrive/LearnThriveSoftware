-- A consent withdrawal is stamped with the DATABASE's clock, whatever the caller sent (plan20, found on the real stack).
--
-- Before: a signed-in user could set consents.withdrawn_at to any timestamp at or after granted_at. A value from the person's own
-- device is wrong in both directions: slightly behind the server (clock skew) it was refused by the check constraint, and in the
-- future it recorded a withdrawal that had not happened yet. The first withdrawal of a row now always gets now(); as before, a
-- recorded withdrawal can never be changed or undone. Re-runnable (create or replace; the trigger already exists from 0001).

create or replace function private.consents_withdraw_once() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception 'a consent withdrawal cannot be changed or undone; record a new consent instead'
      using errcode = 'check_violation';
  end if;
  if old.withdrawn_at is null and new.withdrawn_at is not null then
    new.withdrawn_at := now();
  end if;
  return new;
end;
$$;
