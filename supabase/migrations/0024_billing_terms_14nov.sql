-- 0024_billing_terms_14nov.sql — what Tahasin's answers of 14 Nov 2026 change in the billing tables (docs/OWNER_ANSWERS_ROUND2_2026-11-14.md).
--
--   tuition_family_rates.contract_end   null = open-ended. There is no fixed 12-month contract any more: families commit for an initial three
--                                       months and can then leave on a month's notice, so a rate applies until a newer one replaces it. A new
--                                       rate closes the one before it (the day before it starts); the application refuses a change that would
--                                       reach back before today.
--   tuition_billing_settings.payment_instructions
--                                       what a parent is told on their statement page about how to pay (the company's bank details and the
--                                       reference to quote). Families pay by bank transfer at launch, so the website has to say how. Set by an
--                                       administrator, never in the code or the repository.
--
-- Re-runnable; additive only.

alter table public.tuition_family_rates alter column contract_end drop not null;
alter table public.tuition_family_rates drop constraint if exists tuition_family_rates_check;
alter table public.tuition_family_rates drop constraint if exists tuition_family_rates_contract_dates_check;
alter table public.tuition_family_rates add constraint tuition_family_rates_contract_dates_check check (contract_end is null or contract_end >= contract_start);
comment on column public.tuition_family_rates.contract_end is 'The last day this rate applies, or null while it is the current rate. A newer rate for the same assignment ends it.';

alter table public.tuition_billing_settings add column if not exists payment_instructions text not null default '' check (char_length(payment_instructions) <= 1000);
comment on column public.tuition_billing_settings.payment_instructions is 'How a parent pays by bank transfer: shown on their statement page. Set by an administrator.';
