-- 0021_tuition_billing.sql — the money side of tuition: rates, monthly statements, payments recorded by hand, refund approval.
--
-- What it stores follows the owners' answers of 7 Nov 2026 (docs/OWNER_ANSWERS_2026-11-07.md, docs/TUITION_BILLING.md):
--   * monthly statements IN ARREARS for lessons delivered (B1), frozen once issued (B16);
--   * a family rate that cannot change inside its contract year (B3), kept apart from what a tutor earns (B2);
--   * the sibling discount as a recorded flag on the family (B4);
--   * an admin's decision about a cancelled lesson (who cancelled, or "no charge") (B6, B8);
--   * payments an admin records (the family payment method is not decided, B19), voided with a reason and never edited;
--   * refund requests that only a named approver can decide, with an optional second approver above a threshold (B11);
--   * an append-only audit trail of every change.
--
-- Tutors never see any of it (B17): like the lesson tables, it is written and read ONLY by the server. RLS is on and FORCED, there is no
-- policy and no grant for anon or authenticated, and the app refuses everyone but an admin. Re-runnable; additive only.
-- Financial records are kept when people leave (docs/LAWFUL_BASES.md), so the references to people are `restrict`, not `cascade`.

-- ---------------------------------------------------------------------------------------------
-- settings: one row, the rules the owners have not finished deciding live here so they can be set without a deploy
-- ---------------------------------------------------------------------------------------------
create table if not exists public.tuition_billing_settings (
  singleton boolean primary key default true check (singleton),
  late_cancel_notice_hours integer not null default 24 check (late_cancel_notice_hours between 0 and 720),
  sibling_discount_percent integer not null default 10 check (sibling_discount_percent between 0 and 100),
  repeat_late_cancel_fee_pence integer check (repeat_late_cancel_fee_pence is null or repeat_late_cancel_fee_pence between 0 and 100000),
  allowance_reset_months integer check (allowance_reset_months is null or allowance_reset_months between 1 and 60),
  refund_second_approval_pence integer check (refund_second_approval_pence is null or refund_second_approval_pence >= 1),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.tuition_billing_settings (singleton) values (true) on conflict (singleton) do nothing;
comment on column public.tuition_billing_settings.repeat_late_cancel_fee_pence is 'OPEN (B6): null until the owners decide the charge for a repeat late cancellation.';
comment on column public.tuition_billing_settings.allowance_reset_months is 'OPEN (B6): null = a child''s waived-first allowance never resets.';
comment on column public.tuition_billing_settings.refund_second_approval_pence is 'OPEN (B11): null = one approver is enough.';

-- ---------------------------------------------------------------------------------------------
-- rates
-- ---------------------------------------------------------------------------------------------
create table if not exists public.tuition_family_rates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  assignment_id uuid not null references public.tuition_assignments (id) on delete restrict,
  hourly_pence integer not null check (hourly_pence between 100 and 20000),
  contract_start date not null,
  contract_end date not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (contract_end >= contract_start)
);
create index if not exists tuition_family_rates_client_idx on public.tuition_family_rates (client_id, assignment_id, contract_start);

create table if not exists public.tuition_tutor_rates (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutors (id) on delete restrict,
  hourly_pence integer not null check (hourly_pence between 500 and 4500), -- 5 to 45 pounds an hour (B2)
  effective_from date not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists tuition_tutor_rates_tutor_idx on public.tuition_tutor_rates (tutor_id, effective_from);

create table if not exists public.tuition_family_profiles (
  client_id uuid primary key references public.clients (id) on delete restrict,
  sibling_discount_eligible boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- an admin's decision about a lesson
-- ---------------------------------------------------------------------------------------------
create table if not exists public.tuition_charge_decisions (
  lesson_id uuid primary key references public.lessons (id) on delete cascade,
  party text check (party is null or party in ('FAMILY', 'TUTOR', 'LEARNTHRIVE')),
  waive boolean not null default false,
  note text not null default '' check (char_length(note) <= 500),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz not null default now(),
  check (party is not null or waive),
  check (not waive or char_length(btrim(note)) >= 3)
);

-- ---------------------------------------------------------------------------------------------
-- statements (frozen once issued), payments, refunds
-- ---------------------------------------------------------------------------------------------
create sequence if not exists public.tuition_invoice_seq;

create table if not exists public.tuition_statements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  invoice_number text not null unique check (char_length(invoice_number) between 5 and 40),
  issued_on date not null,
  issued_by uuid references public.profiles (id) on delete set null,
  client_name text not null check (char_length(client_name) <= 200),
  period_start date not null,
  period_end date not null,
  lines jsonb not null,
  lesson_charges_pence integer not null,
  missed_lesson_charges_pence integer not null,
  sibling_discount_pence integer not null check (sibling_discount_pence >= 0),
  sibling_discount_percent integer not null,
  sibling_discount_applied boolean not null,
  total_charges_pence integer not null,
  payments_received_pence integer not null,
  payment_ids jsonb not null default '[]'::jsonb,
  opening_balance_pence integer not null,
  closing_balance_pence integer not null,
  blockers text[] not null default '{}',
  company jsonb not null,
  created_at timestamptz not null default now(),
  unique (client_id, period)
);
create index if not exists tuition_statements_client_idx on public.tuition_statements (client_id, period);

create table if not exists public.tuition_payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  amount_pence integer not null check (amount_pence between 1 and 10000000),
  received_on date not null,
  method text not null check (char_length(btrim(method)) between 1 and 40),
  note text not null check (char_length(btrim(note)) between 3 and 500),
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null,
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 3 and 500),
  check ((voided_at is null) = (void_reason is null))
);
create index if not exists tuition_payments_client_idx on public.tuition_payments (client_id, received_on);

create table if not exists public.tuition_refunds (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  amount_pence integer not null check (amount_pence between 1 and 10000000),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  statutory boolean not null default false,
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'AWAITING_SECOND_APPROVAL', 'APPROVED', 'REJECTED')),
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  first_approved_by uuid references public.profiles (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000)
);
create index if not exists tuition_refunds_client_idx on public.tuition_refunds (client_id, requested_at);

-- ---------------------------------------------------------------------------------------------
-- audit: who did what to the money, never edited or deleted
-- ---------------------------------------------------------------------------------------------
create table if not exists public.tuition_billing_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor_id text not null check (char_length(actor_id) <= 100),
  action text not null check (char_length(action) between 1 and 60),
  subject text not null check (char_length(subject) <= 200),
  detail jsonb not null default '{}'::jsonb
);
create index if not exists tuition_billing_audit_at_idx on public.tuition_billing_audit (at desc);

create or replace function private.tuition_billing_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only: an issued statement or an audit entry is never changed or removed', tg_table_name using errcode = 'restrict_violation';
end;
$$;
drop trigger if exists tuition_statements_append_only on public.tuition_statements;
create trigger tuition_statements_append_only before update or delete on public.tuition_statements for each row execute function private.tuition_billing_append_only();
drop trigger if exists tuition_billing_audit_append_only on public.tuition_billing_audit;
create trigger tuition_billing_audit_append_only before update or delete on public.tuition_billing_audit for each row execute function private.tuition_billing_append_only();

-- ---------------------------------------------------------------------------------------------
-- Server only: RLS on and forced, no policy, no grant to anon or authenticated.
-- ---------------------------------------------------------------------------------------------
alter table public.tuition_billing_settings enable row level security;
alter table public.tuition_family_rates enable row level security;
alter table public.tuition_tutor_rates enable row level security;
alter table public.tuition_family_profiles enable row level security;
alter table public.tuition_charge_decisions enable row level security;
alter table public.tuition_statements enable row level security;
alter table public.tuition_payments enable row level security;
alter table public.tuition_refunds enable row level security;
alter table public.tuition_billing_audit enable row level security;
alter table public.tuition_billing_settings force row level security;
alter table public.tuition_family_rates force row level security;
alter table public.tuition_tutor_rates force row level security;
alter table public.tuition_family_profiles force row level security;
alter table public.tuition_charge_decisions force row level security;
alter table public.tuition_statements force row level security;
alter table public.tuition_payments force row level security;
alter table public.tuition_refunds force row level security;
alter table public.tuition_billing_audit force row level security;

revoke all on public.tuition_billing_settings, public.tuition_family_rates, public.tuition_tutor_rates, public.tuition_family_profiles,
  public.tuition_charge_decisions, public.tuition_statements, public.tuition_payments, public.tuition_refunds, public.tuition_billing_audit from anon, authenticated;
revoke all on sequence public.tuition_invoice_seq from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------------------------
comment on table public.tuition_billing_settings is 'The billing rules the owners can set without a deploy. One row. Rules still undecided are null. Server only.';
comment on table public.tuition_family_rates is 'What a family pays per hour for one tuition assignment, fixed for the contract year. Kept apart from what a tutor earns. Server only; tutors never see it.';
comment on table public.tuition_tutor_rates is 'What LearnThrive pays a tutor per hour (5 to 45 pounds). Not the family rate. Server only; never shown to families.';
comment on table public.tuition_family_profiles is 'Per-family billing facts, today only whether the sibling discount applies. Server only.';
comment on table public.tuition_charge_decisions is 'An admin''s decision about one lesson: who cancelled it, or a waiver with a reason. Server only.';
comment on table public.tuition_statements is 'Monthly statements in arrears, frozen once issued (append-only). Server only; tutors never see them.';
comment on table public.tuition_payments is 'Payments an admin recorded by hand. Voided with a reason, never edited or deleted. Server only.';
comment on table public.tuition_refunds is 'Refund requests. Only a named approver can decide one; a second approver can be required above a threshold. Server only.';
comment on table public.tuition_billing_audit is 'Who did what to the money. Append-only. Server only.';

-- Same convention as 0005, 0010 and 0013: every function in private is executable by the API roles (a trigger function cannot be called directly).
grant execute on all functions in schema private to authenticated, service_role;
