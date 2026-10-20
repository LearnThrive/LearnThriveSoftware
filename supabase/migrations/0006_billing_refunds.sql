-- 0006_billing_refunds.sql (plan19 phase E)
--
-- A fully refunded subscription ends access at once, whatever Stripe still says about the subscription itself
-- (the owner may refund and leave the subscription to run out, or refund and forget to cancel it). The server
-- records the refund time here and the entitlement derivation (packages/data, deriveEntitlement) treats a refunded
-- subscription as not entitled. ended_at is when Stripe ended the subscription, which is when a cancelled
-- subscription's access stops. Re-runnable.

alter table public.subscriptions
  add column if not exists refunded_at timestamptz,
  add column if not exists ended_at timestamptz;

comment on column public.subscriptions.ended_at is
  'When Stripe ended the subscription (status canceled), as reported by Stripe. A cancelled subscription grants access until this time. Server writes only.';

comment on column public.subscriptions.refunded_at is
  'Set by the server when a charge for this subscription was fully refunded. A refunded subscription grants no access. Server writes only.';
