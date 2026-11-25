-- 0033_tuition_lesson_prices.sql — a price of its own for one lesson, with what the family pays and what the tutor is paid kept apart.
--
-- Until now every lesson was priced by the hour: the family's hourly rate for the assignment (tuition_family_rates) and the tutor's hourly pay
-- (tuition_tutor_rates). An administrator can now set, for ONE lesson, what each child's family is charged for it and/or what its tutor is paid
-- for it (a lesson may cost a family 10 pounds and pay its tutor 5). Either side may be left to the hourly rate (null). The service refuses to
-- change the family side once the lesson is on an issued statement (packages/data/src/tuitionBilling/service.ts).
--
-- Server only, like every other billing table (0021): RLS on and forced, nothing granted to anon or authenticated; the site's narrow database
-- role is granted here when it exists (see 0031). Re-runnable.

create table if not exists public.tuition_lesson_prices (
  lesson_id uuid primary key references public.lessons (id) on delete cascade,
  client_pence integer check (client_pence is null or client_pence between 0 and 100000), -- per child, up to 1,000 pounds
  tutor_pence integer check (tutor_pence is null or tutor_pence between 0 and 100000),   -- for the lesson, once
  note text not null default '' check (char_length(note) <= 500),
  set_by uuid references public.profiles (id) on delete set null,
  set_at timestamptz not null default now(),
  check (client_pence is not null or tutor_pence is not null)
);

alter table public.tuition_lesson_prices enable row level security;
alter table public.tuition_lesson_prices force row level security;
revoke all on public.tuition_lesson_prices from anon, authenticated;

do $$
begin
  if exists (select from pg_roles where rolname = 'learnthrive_server') then
    grant select, insert, update, delete on public.tuition_lesson_prices to learnthrive_server;
  end if;
end
$$;

comment on table public.tuition_lesson_prices is 'A price set for one lesson in place of the hourly rates: what each child''s family is charged and what the tutor is paid, kept apart. Server only; tutors never see it.';
