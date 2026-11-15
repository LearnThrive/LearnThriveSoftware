-- 0026_payment_reference.sql — a payment reference for each family, to quote on a bank transfer.
--
--   clients.payment_reference   `LT-` and six characters from an alphabet with no 0, O, 1 or I. Random: it carries no name, email, id or date. Made once,
--                               on the server (the application draws one and writes it only where the column is still null), unique across families,
--                               and never changed afterwards: a trigger refuses any change once it is set.
--
-- The bank details themselves are NOT in the database. They are server environment variables (BANK_PAYEE_NAME, BANK_ACCOUNT_NUMBER, BANK_SORT_CODE,
-- BANK_NAME; docs/ENVIRONMENT.md), read by the application and shown only to a signed-in parent or an administrator.
--
-- Re-runnable; additive only. Written as a file: it is applied only on the owner's go-ahead.

alter table public.clients add column if not exists payment_reference text;

alter table public.clients drop constraint if exists clients_payment_reference_format;
alter table public.clients add constraint clients_payment_reference_format
  check (payment_reference is null or payment_reference ~ '^LT-[A-HJ-NP-Z2-9]{6}$');

create unique index if not exists clients_payment_reference_key on public.clients (payment_reference) where payment_reference is not null;

create or replace function public.clients_payment_reference_fixed() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.payment_reference is not null and new.payment_reference is distinct from old.payment_reference then
    raise exception 'A family''s payment reference never changes once it is made.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.clients_payment_reference_fixed() from public;

drop trigger if exists clients_payment_reference_fixed on public.clients;
create trigger clients_payment_reference_fixed before update of payment_reference on public.clients
  for each row execute function public.clients_payment_reference_fixed();

comment on column public.clients.payment_reference is 'What the family quotes on a bank transfer: LT- and six characters (no 0, O, 1, I). Random, no personal data, unique, set once and never changed.';

-- A signed-in family may read its own row (clients_owner_read) and so its own reference; nobody but the server can write it: authenticated has
-- INSERT on owner_profile_id only (0005) and no UPDATE at all.
