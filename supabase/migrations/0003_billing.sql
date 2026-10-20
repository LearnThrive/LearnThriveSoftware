-- 0003_billing.sql — Stripe mirror, entitlements, grants, download audit, webhook idempotency.
--
-- Stripe stays the source of truth; these tables mirror it. Everything here is written ONLY by the
-- server (service role). A signed-in user may read their own family's subscriptions and entitlements
-- (0005_rls.sql) and nothing else in this file.

-- Stripe customer id per family account. Its own table (not a column on clients) so that no
-- client-writable row can ever point a family at someone else's Stripe customer. Server only.
create table if not exists public.billing_customers (
  client_id uuid primary key references public.clients (id) on delete cascade,
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at timestamptz not null default now()
);
comment on table public.billing_customers is
  'Maps a family account to its Stripe customer. Server only; never readable by anon or signed-in users.';

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  stripe_subscription_id text not null unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  stripe_price_id text not null check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  status text not null check (status in (
    'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  plan_interval text not null check (plan_interval in ('month', 'year')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_client_id_idx on public.subscriptions (client_id);
comment on table public.subscriptions is
  'Mirror of the Stripe subscription state for a family account (the billing holder is an adult). Server writes only.';

drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch
  before update on public.subscriptions
  for each row execute function private.touch_updated_at();

-- Manual access granted by an administrator (support, bursaries, press). Server only.
create table if not exists public.admin_grants (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index if not exists admin_grants_client_id_idx on public.admin_grants (client_id);
comment on table public.admin_grants is
  'Administrator override of Library access. Server only (service role); never readable by users.';

-- What a family may open. One row per reason it has access; canAccess() takes the union of the
-- rows whose window contains now() (and, for subscription rows, whose subscription is still good).
create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  source text not null check (source in ('enrolled', 'subscription', 'admin_grant')),
  assignment_id uuid references public.tuition_assignments (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete cascade,
  admin_grant_id uuid references public.admin_grants (id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  -- exactly the reference that matches the source, and no other
  check (
    (source = 'enrolled' and assignment_id is not null and subscription_id is null and admin_grant_id is null)
    or (source = 'subscription' and subscription_id is not null and assignment_id is null and admin_grant_id is null)
    or (source = 'admin_grant' and admin_grant_id is not null and assignment_id is null and subscription_id is null)
  ),
  -- the natural key, so the server can upsert idempotently (nulls compare equal)
  unique nulls not distinct (client_id, source, assignment_id, subscription_id, admin_grant_id)
);
create index if not exists entitlements_client_window_idx on public.entitlements (client_id, ends_at);
comment on table public.entitlements is
  'Derived access rights (enrolled / subscription / admin_grant) with an active window (ends_at null = open ended). Server writes only; a family may read its own.';

-- COUNTER-ONLY audit row for downloads. No file name, no IP address, no user agent and no
-- personal data beyond the account reference. flags are machine tokens such as rate_limited or
-- burst; the check below stops free text (an IP address or an email) being stored in them.
create table if not exists public.download_events (
  id bigint generated always as identity primary key,
  client_id uuid references public.clients (id) on delete set null,
  resource_id uuid references public.resources (id) on delete set null,
  at timestamptz not null default now(),
  flags text[] not null default '{}'
    check (cardinality(flags) <= 10 and array_to_string(flags, ',') ~ '^([a-z0-9_]{1,40}(,[a-z0-9_]{1,40})*)?$')
);
create index if not exists download_events_client_at_idx on public.download_events (client_id, at desc);
create index if not exists download_events_resource_idx on public.download_events (resource_id);
comment on table public.download_events is
  'Counter-only audit of downloads (account, resource, time, anomaly flags). Server only. client_id becomes null if the account is deleted.';

-- Webhook idempotency: insert the event id first; a duplicate delivery hits the primary key.
-- The payload is deliberately NOT stored (it carries customer details).
create table if not exists public.stripe_webhook_events (
  event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9_]+$'),
  event_type text not null check (char_length(event_type) between 1 and 100),
  livemode boolean not null default false,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 80)
);
create index if not exists stripe_webhook_events_unprocessed_idx
  on public.stripe_webhook_events (received_at) where processed_at is null;
comment on table public.stripe_webhook_events is
  'Processed Stripe event ids (idempotency). No payload stored. Server only.';
