# Billing: Stripe subscriptions for the Library

Living document for plan19 phase E. Status: **built and tested against a fake Stripe and a signed-webhook harness; never run against a real Stripe account** (none was available, and no real payment was made or attempted). Nothing here is switched on in production: checkout stays closed until every gate under "What has to be true before anyone can pay" is met.

## How it works, in one page

- **Stripe Billing, hosted.** The pricing card posts to `POST /api/billing/create-checkout`; the server creates a Stripe Checkout Session and redirects the browser to Stripe's own page, where the card is entered. The customer manages everything afterwards (card, invoices, cancelling) on Stripe's hosted Customer Portal, reached from `POST /api/billing/create-portal-session`. **No card detail ever touches this site, and Stripe.js is not used**, so no script is added.
- **No SDK.** `src/lib/billing/stripe.ts` makes a handful of REST calls over `fetch` (create a Checkout Session, create a portal session, retrieve a subscription, retrieve an invoice, look up an invoice for a payment, list subscriptions). The webhook signature check is written out in `signature.ts`. The secret key is only ever in a request header and is never logged.
- **Stripe is the source of truth; the database mirrors it.** A webhook event says *which* subscription changed. The handler then reads that subscription's current state back from Stripe and mirrors it (`subscriptions`), so a late or out-of-order event can never overwrite newer state. Access is derived from the mirror (`entitlements`), in one function, `deriveEntitlement` (`packages/data/src/library/billing.ts`).
- **Download access** is then decided as before by `canAccess`: enrolled, or an open subscription entitlement, or an administrator grant, or a free sample (`docs/LIBRARY.md`).
- **One subscription per family.** The family account (`clients` row) is the Stripe customer's owner (`billing_customers`). The billing account holder is an adult.

## What has to be true before anyone can pay

Checkout is offered only when **all** of these hold (`src/lib/billing/config.ts`, `offer.ts`); the pages and the routes both check, and any one missing leaves `/pricing` as the coming-soon page:

| Gate | Setting | Owner decision |
| --- | --- | --- |
| The Library is in the live phase | `LIBRARY_PHASE=live` | When to open subscriptions |
| Stripe is configured with a price for the plan | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY` and/or `STRIPE_PRICE_ANNUAL` | Prices live in Stripe; the code reads price IDs, never an amount |
| The plan has a price to show | `LIBRARY_PRICE_MONTHLY` / `LIBRARY_PRICE_ANNUAL` (display text, `9.99`) | The same price, shown before paying |
| **The VAT treatment is decided** | `LIBRARY_VAT_STATUS=registered` (prices include VAT) or `not_registered` | **Accountant**. A digital subscription is not covered by the tuition VAT exemption. No default: unset means no checkout |
| **The content threshold is set and met** | `LIBRARY_MIN_PER_SUBJECT` and `LIBRARY_REQUIRED_SUBJECTS` (for example `Maths,English,Science,11+`) | **Owners** agree the minimum catalogue per subject. Checkout re-reads the published counts each time |
| **The terms are approved** | `LIBRARY_TERMS_APPROVED=true` | **Owners and a solicitor** approve the Library terms and content licence (`/library/terms`, draft wording in `src/app/(public)/library/terms/page.tsx`), the checkout wording (`src/lib/billing/consumer.ts`) and the refunds line |

Also required by the plan's gates (`plan19.md` section 6), not enforced by code: the privacy and cookie pages updated in the same deploy that sets `LIBRARY_ENABLED`, the DPIA and safeguarding approvals for anything beyond the Library, and the legal review of `apps/web/LEGAL_REVIEW.md` ("Library accounts, downloads and billing").

**Record the counts** when you switch on: `npm run library:import -- --dir <folder>` prints each resource, and `/library` shows the published number per subject in its facets. Put the per-subject numbers and the date in `docs/PLAN19_REPORT.md` (owner approval list).

## Stripe setup, step by step (owner, in the Stripe dashboard)

Do all of this in **test mode** first, against a staging site (`ALLOWED_ORIGINS` set for its host, `NEXT_PUBLIC_SITE_URL` set to its address).

1. **Account and business details.** Complete Stripe's business profile. Set the statement descriptor (for example `LEARNTHRIVE LIBRARY`) and support email and phone, which Stripe shows on receipts and on the Checkout page.
2. **Product and prices.** Create one product, "LearnThrive Library". Add a **recurring monthly price** and, if offering it, a **recurring yearly price**, both in **GBP**. If prices include VAT, set the price **tax behaviour to "inclusive"** and, if Stripe Tax is used, enable it (see step 7). Copy the two price IDs (`price_...`) into `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_ANNUAL`. No free trial, no coupons (the Checkout Session sets `allow_promotion_codes=false`).
3. **Customer Portal** (Settings, Billing, Customer portal). Turn on: cancel subscriptions (**at the end of the billing period**, not immediately), update payment method, view invoice history. Turn off: plan switching and quantity changes (there is one plan), pausing. Add the business information and a link to `/library/terms` and `/privacy`. Set the "return to" link to `/account`.
4. **Webhook endpoint** (Developers, Webhooks): add an endpoint `https://<site>/api/billing/webhook` and select these events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.upcoming`, `charge.refunded`. Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`. **Rotating**: add a second endpoint secret by putting both, comma separated, in `STRIPE_WEBHOOK_SECRET` until the old one is deleted.
5. **API key.** Use a **restricted key** if you can: write on Checkout Sessions and Customer portal sessions, read on Subscriptions, Invoices, Customers and Charges. (An unrestricted `sk_` key also works.) Put it in `STRIPE_SECRET_KEY`. A `sk_test_` key means test mode, `sk_live_` live mode: the webhook refuses an event from the other mode.
6. **Upcoming-renewal reminders.** Settings, Billing, Subscriptions and emails, "Upcoming renewal events": send `invoice.upcoming` **at least 7 days before renewal** (some rules require more for longer terms; check GOV.UK). The site turns each one into a reminder email.
7. **VAT and tax.** If VAT-registered, price inclusive and set `LIBRARY_VAT_STATUS=registered`. For Stripe to calculate and show tax, enable Stripe Tax and set `STRIPE_AUTOMATIC_TAX=true`. If not registered, `LIBRARY_VAT_STATUS=not_registered` and the page says no VAT is charged. **The accountant decides**; the code never guesses.
8. **Stripe's own emails.** Turn on successful-payment receipts and failed-payment emails in Stripe if you want Stripe's copies as well. The site also sends its own five emails (below).
9. **API version.** The server calls Stripe with `STRIPE_API_VERSION` (default `2025-09-30.clover`). Set the webhook endpoint's version to the same. The code reads the period end from the subscription item (new versions) or the subscription (old) and the invoice's subscription from either place. If a full refund is not recognised on your account's version, see "Refunds".

## Environment variables

| Variable | Needed for | Meaning |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | checkout, portal, webhook, reconcile | `sk_test_...`, `sk_live_...` or a restricted `rk_...`. Secret. |
| `STRIPE_WEBHOOK_SECRET` | webhook | `whsec_...`; two, comma separated, while rotating. Secret. |
| `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` | checkout | `price_...` IDs. An amount is rejected. |
| `STRIPE_API_VERSION` | optional | Default `2025-09-30.clover`. |
| `STRIPE_AUTOMATIC_TAX` | optional | `true` asks Stripe Tax to calculate tax at checkout. |
| `LIBRARY_VAT_STATUS` | checkout | `registered` or `not_registered`. Required. |
| `LIBRARY_MIN_PER_SUBJECT`, `LIBRARY_REQUIRED_SUBJECTS` | checkout | The content threshold. Required. |
| `LIBRARY_TERMS_APPROVED` | checkout, `/library/terms` in production | `true` once approved. Required. |
| `LIBRARY_PRICE_MONTHLY`, `LIBRARY_PRICE_ANNUAL` | pricing page | Display text, `9.99`. |
| `NEXT_PUBLIC_SITE_URL` | optional | Where Stripe sends people back to (default the production address). Set for staging. |
| `STRIPE_FAKE` | **development and tests only** | `1` swaps in a fake Stripe. Refused when `NODE_ENV=production`. |

`docs/DEPLOYMENT.md` has the full table. Never put a key in the repo, a log or a report.

## The routes

- `POST /api/billing/create-checkout`: a signed-in adult account, with the plan (`monthly` or `annual`) and `acknowledged=yes`. Order of checks: origin; the offer is open (config, phase, VAT, terms, content gate); rate limit (10 per 15 minutes per address); session; adult declaration; plan; **the acknowledgement** (the box is never pre-ticked: absent means no); the content gate against the published catalogue; no existing open subscription or entitlement. Then it **records the express consent** (`consents`: who, the version `CONSENT_VERSION`, a SHA-256 of the exact wording, when), creates the session and redirects to the checkout host (a reply pointing anywhere but `checkout.stripe.com` is refused). A browser form post gets a redirect (and a message back on `/pricing` for a refusal); a script gets JSON.
- `POST /api/billing/create-portal-session`: the same guards, then Stripe's hosted portal (`billing.stripe.com` only), returning to `/account`.
- `POST /api/billing/webhook`: **the signature over the raw body is the authentication** (no cookie, no Origin). `t=<seconds>,v1=<hex>`, HMAC-SHA256 of `t.body`, five minute tolerance (a captured request cannot be replayed later), constant-time compare, several secrets accepted. A bad or stale signature, a body that is not an event, or an event from the other mode is a `400`. Each event id is claimed once (`stripe_webhook_events`; the payload is never stored): a duplicate is a `200` that does nothing, a failure that is worth retrying is a `500` (Stripe retries, and every step is safe to repeat), and one that can never succeed (an account this site does not know) is recorded and answered `200` so Stripe stops.
- **Content Security Policy.** `form-action` additionally allows `https://checkout.stripe.com` and `https://billing.stripe.com`, **only while `LIBRARY_PHASE=live`**, because the hand-off is a plain form POST answered with a redirect and Chromium enforces `form-action` on that redirect (measured here: with `form-action 'self'` the browser stays on the page). Nothing else in the policy changes: no script, frame, connection or image source is added. The setting is read when the server starts. This is a small deviation from "the policy stays as it is"; the alternative is a `fetch` and a script-driven navigation, which would lose the no-JavaScript path.

## What each Stripe event does

| Event | Effect |
| --- | --- |
| `checkout.session.completed` | Links the Stripe customer to the family (`client_reference_id`), mirrors the subscription, sends the welcome email. |
| `customer.subscription.created` / `updated` / `deleted` | Mirrors the subscription (it can arrive before the checkout event: the `client_id` in the subscription's metadata links the customer). Sends the cancellation email when a cancellation is newly requested, or when it ends. |
| `invoice.paid` | Mirrors; sends the receipt email (a button to Stripe's hosted invoice) for a payment above zero. |
| `invoice.payment_failed` | Mirrors (the status becomes `past_due`); sends the payment-failed email. |
| `invoice.upcoming` | Sends the renewal reminder. |
| `charge.refunded` | A **full** refund ends access at once (`subscriptions.refunded_at`), whatever Stripe still says about the subscription. A partial refund changes nothing. |

Anything else is acknowledged and ignored. The five emails (`src/lib/billing/emails.ts`) are hand-built from the shared escaped helpers, go to the account's own sign-in address, and contain links only to this site or Stripe's hosted invoice page.

## How a Stripe state becomes access (`deriveEntitlement`)

| Stripe status | Access |
| --- | --- |
| `active`, `trialing` | Until the paid-through date plus **3 days** (`ACTIVE_GRACE_MS`): a renewal webhook that is a few hours late does not lock a paying family out, and if webhooks stop altogether access lapses 3 days after the period ends. |
| `past_due` | Only the period already paid for. No grace while the payment is failing. |
| `canceled` | Until Stripe's `ended_at` (the end of the paid period for a cancel-at-period-end; at once for an immediate cancellation), else the paid-through date. |
| `unpaid`, `incomplete`, `incomplete_expired`, `paused` | None. |
| refunded (any status) | None. |

The table is tested for every status (`packages/data/src/libraryBilling.test.ts`), and the whole matrix of enrolled / subscription (none, active, expired, refunded) / grant (none, open, revoked) / tier is tested end to end in `apps/web/tests/billing.test.mjs`.

## Reconciliation

`npm run billing:reconcile` (from `apps/web`; `DATABASE_URL` and `STRIPE_SECRET_KEY` in the environment) re-syncs the mirror from Stripe. It is a **dry run** unless given `--apply`: it lists what would change (new, or a differing status, price, interval, period end, cancel flag or end date), subscriptions for a customer this site has no account for (reported, never created), and mirrored subscriptions Stripe no longer lists (reported, left alone). `--apply` writes the differences and recomputes every entitlement, which also closes any whose window has run out. Run it after a webhook outage or a bad deploy, and now and then. `npm run billing:reconcile -- --mark-refunded sub_XXXX` ends access for one subscription whose full refund the webhook could not trace.

`npm run library:grant` gives or removes an administrator grant (`docs/LIBRARY.md`).

## Refunds

A full refund is recognised through the charge's invoice (older API versions put it on the charge, newer ones through the payment intent's invoice payment, which the code looks up). If a refund is **not** recognised on your Stripe account's version (access stays open after a full refund), run `billing:reconcile -- --mark-refunded <subscription id>`, and tell the engineer, because the lookup then needs adjusting for that version. The refunds wording customers see is draft (`src/lib/billing/consumer.ts`, `/library/terms`) and needs the owners and a solicitor.

## Consumer law, built in

Shown before payment, on the card and in the terms: the price and whether it includes VAT; the billing period; that it renews automatically; how to cancel (online, from the account, no phone call or letter); the refunds line; no discount, drip price or extra fee. **An unticked box** asks the customer to confirm that access starts at once and that the 14-day cancellation right is lost once access begins; the route refuses a checkout without it and records the consent. Reminder emails come before each renewal. The rules for subscription contracts are changing; sources disagree whether they start in spring 2027 or January 2027, so **check GOV.UK before launch**. The wording in `consumer.ts` and `/library/terms` is DRAFT and the owners and a solicitor must approve it. `CONSENT_VERSION` must change whenever the wording does.

## Test cards (Stripe test mode)

Use Stripe's published test cards, with any future expiry, any CVC and any postcode: `4242 4242 4242 4242` (succeeds), `4000 0000 0000 0341` (attaches but the first renewal fails: for `invoice.payment_failed`), `4000 0000 0000 9995` (insufficient funds), `4000 0025 0000 3155` (needs 3D Secure authentication). A test-mode run to do on staging before launch: subscribe monthly; check the welcome email, `/account` and a members download; open Manage billing; cancel (access stays to the end); resubscribe; use the Stripe test clock to advance to a renewal and to a failed renewal; refund fully in the dashboard (access must end); replay a webhook from the dashboard (a duplicate must do nothing); run `billing:reconcile` and `billing:reconcile -- --apply`.

## Tested, and not

Tested: config and every gate; the signature (valid, tampered, wrong secret, stale, malformed, missing, rotation); the exact shape of every Stripe request and every error mapping; both API shapes of a subscription and an invoice; every event above (including out-of-order delivery, a subscription event before the checkout event, unknown accounts, a customer that belongs to someone else, duplicates, retries and permanent failures); the five emails' escaping; checkout and portal with every refusal; reconciliation; and in a browser (fake Stripe, Stripe hosts intercepted): pricing card, unticked box and the focus-moving error, hand-off, webhook, account page, portal, cancellation, payment failure, refund, and the success page.

**Not** tested, because it needs a real Stripe account: Checkout and portal pages themselves, real webhook delivery and signing from Stripe (the algorithm is implemented from Stripe's documentation and cross-checked only against itself), real API versions, Stripe Tax, the dashboard settings above, live mode, and real emails (Resend). **Do the staging run above before any real payment.**
