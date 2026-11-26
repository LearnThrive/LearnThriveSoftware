-- 0034_tuition_repeating_prices.sql — the same price for every lesson of one class between two dates.
--
-- A lesson's own price (0033) covers one lesson. An administrator can also repeat a price: what each child's family is charged and/or what the
-- tutor is paid, for every lesson of a tuition assignment from a start date to an end date (both included), whenever each lesson is booked. A
-- lesson with a price of its own keeps it. The application refuses two repeating prices for the same class that share a day. Statements already
-- issued are stored copies and are not affected.
--
-- Server only, like every other billing table (0021): RLS on and forced, nothing granted to anon or authenticated; the site's narrow database
-- role is granted here when it exists (see 0031). Re-runnable.

create table if not exists public.tuition_repeating_prices (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.tuition_assignments (id) on delete cascade,
  client_pence integer check (client_pence is null or client_pence between 0 and 100000), -- per child, up to 1,000 pounds
  tutor_pence integer check (tutor_pence is null or tutor_pence between 0 and 100000),   -- for each lesson, once
  start_date date not null,
  end_date date not null,
  note text not null default '' check (char_length(note) <= 500),
  set_by uuid references public.profiles (id) on delete set null,
  set_at timestamptz not null default now(),
  check (client_pence is not null or tutor_pence is not null),
  check (end_date >= start_date and end_date - start_date < 731)
);
create index if not exists tuition_repeating_prices_assignment_idx on public.tuition_repeating_prices (assignment_id, start_date);

alter table public.tuition_repeating_prices enable row level security;
alter table public.tuition_repeating_prices force row level security;
revoke all on public.tuition_repeating_prices from anon, authenticated;

do $$
begin
  if exists (select from pg_roles where rolname = 'learnthrive_server') then
    grant select, insert, update, delete on public.tuition_repeating_prices to learnthrive_server;
  end if;
end
$$;

comment on table public.tuition_repeating_prices is 'A price repeated over every lesson of one class between two dates: what each child''s family is charged and what the tutor is paid, kept apart. Server only; tutors never see it.';
