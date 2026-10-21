# Deployment

How the **public LearnThrive site** (the marketing pages and the enquiry form) goes to production, and what is deliberately *not* part of that. Written for plan 15 Wave 12. The pass/fail state of each requirement is in [DEPLOYMENT_READINESS.md](DEPLOYMENT_READINESS.md); the questions only the owner can answer are in [PLAN15_OWNER_INPUTS.md](PLAN15_OWNER_INPUTS.md).

## What deploys where

| Piece | Deployed? | Notes |
| --- | --- | --- |
| `apps/web` — the public site, `/api/enquiry`, `/api/health`, `/og/*` | **Yes**, as one Next.js 16 app | The only thing in this deployment. |
| The signed-in app (`/login`, `/dashboard/**`, the classroom page) | **No — closed in production** | Built into the same bundle but unreachable: see "The portal" below. It opens when real authentication exists (the Supabase work), not before. |
| `apps/realtime` (the Socket.IO classroom server) | **No** | It holds long-lived WebSocket connections and in-memory room state, so it cannot run as serverless functions. It needs a long-running Node host of its own, and is a separate decision made when the portal opens. |
| `apps/classroom` (the standalone Vite classroom prototype) | **No** | Prototype; not part of the site. |
| Storybook | **Never** | A development tool. |
| `apps/web/server.ts` | **No** | Development only: it wraps `next dev` (`npm run dev` runs it with `tsx`). Production does not need it. |

Without the realtime server the deployed site behaves exactly as intended: every public page works, the enquiry form sends mail, and anything classroom-related is unreachable because the portal is closed.

## Production start path

```bash
npm ci
npm run build --workspace=apps/web          # next build
NODE_ENV=production npm run start --workspace=apps/web -- -p 3000     # next start
```

`next start` is the whole production runtime; `tsx server.ts` is not involved. A host that builds for you (Vercel and similar) runs the same two Next commands. The build needs outbound network access once (for the Google-hosted fonts, which `next/font` downloads at build time and then serves from the site itself; nothing is requested from Google at runtime).

Use Node `^20.19`, `^22.13` or `>=24` (the `engines` field; CI pins 22.12.0).

## The portal (login, dashboards, classroom)

In a production build these routes are closed by `src/proxy.ts`:

- `/login`, `/dashboard/**`, `/403` redirect to `/portal-opening-soon`, a branded page that says the portal is not open yet and offers the enquiry route. It is `noindex` and is not in the sitemap.
- `/api/auth/**` is a 404.
- The header and footer show no "Login"/"Tutor login" link and make no session request.
- `/dev/**` and `/api/dev/**` (development tools) are a 404 in production **whatever the portal setting is**, as are the pages' own `NODE_ENV` guards.

The development authentication provider refuses to run when `NODE_ENV=production`, by design, so opening the portal in production before a real provider exists would crash the auth flow rather than expose anything. **Do not set `NEXT_PUBLIC_APP_PORTAL_ENABLED=true` until Supabase auth has replaced the development provider**, the CSP has been reviewed for the app (it is written for the public site; see `src/lib/securityHeaders.ts`) and the cookie notice has been re-checked.

The flag is a build-time value (`NEXT_PUBLIC_*`), so changing it means rebuilding.

### The Library carve-out (`LIBRARY_ENABLED`)

`LIBRARY_ENABLED=true` (a server variable, read on each request; anything but exactly `true` is closed) opens **only** the account and Library routes in production while everything above stays closed. `decide()` in `src/lib/portal.ts` is the one place that says which, and `tests/portal.test.mjs` pins it:

- Opened: `/login` (it redirects to `/account/sign-in`), `/account/**`, `/library/**`, and `/api/account/**`, `/api/library/**`, `/api/billing/**` (the Stripe webhook needs no cookie) and `/api/assistant/**`. All of them are `noindex`.
- Still closed: `/dashboard/**`, `/403`, `/api/auth/**`, `/api/lessons/**`, the classroom, `/dev/**` and `/api/dev/**`.
- It fails closed twice over. With the flag on but **no Supabase settings**, the account routes answer 503 ("Accounts are not open yet"), `/account` is a 404, and nothing is signed in. The in-memory account backend that development uses refuses to run when `NODE_ENV=production`.
- Before setting it: Supabase is created and the migrations applied (`docs/SUPABASE_MIGRATION.md`), the Supabase Auth settings in `docs/AUTHENTICATION.md` are made, and the gates in `plan19.md` section 6 are done. `tests-prod/library-enabled.spec.ts` checks the closed-backend state on a production build.

## Environment variables

Set these in the host's dashboard for the production environment. **Never commit values.** (The assistant that wrote this could not edit `apps/web/.env.example`, because access to `.env*` files is blocked in its environment; paste the block below into it so the example stays complete.)

| Variable | Required in production? | What it does | Example / default |
| --- | --- | --- | --- |
| `NODE_ENV` | set by the host / `next start` | Selects production behaviour everywhere. | `production` |
| `RESEND_API_KEY` | **Yes** — the enquiry route fails closed (503, "email us directly") without it | Resend API key used to send the enquiry notification and the parent's auto-reply. | `re_...` (secret) |
| `RESEND_FROM_EMAIL` | **Yes** — fails closed without it | The verified sender address on your Resend domain. The shared `onboarding@resend.dev` default is for development only. | `enquiries@learnthrivetuition.co.uk` |
| `ENQUIRY_EMAIL` | **Yes** — fails closed without it | Where enquiry notifications are delivered. | `info@learnthrivetuition.co.uk` |
| `CAREERS_EMAIL` | No — falls back to `ENQUIRY_EMAIL`, then the site address | Where tutor applications (with their attachments, which can include identity documents) and agreement reconfirmations are delivered. Use the company mailbox. | `info@learnthrivetuition.co.uk` |
| `SUBJECT_REQUEST_EMAIL` | No — falls back to `ENQUIRY_EMAIL` | Where "Can't see your subject?" requests are delivered. | `info@learnthrivetuition.co.uk` |
| `LIBRARY_PHASE` | No — default `info` | `info` (coming soon), `enrolled` (the catalogue is open to enrolled families and free samples; needs the account backend) or `live` (reads as `enrolled` until subscriptions are built). Anything else reads as `info`. `/library` reads it on each request; `/pricing` is static and reads it at **build time**. | unset (`info`) |
| `LIBRARY_PRICE_MONTHLY` | No — leave unset until the owner has set a price | Monthly price in pounds, **display only**: `9.99`, no `£`. The pricing page shows it only if it is a valid amount (up to four digits, optional two decimals, above zero); otherwise it says "Price announced at launch". Nothing is sold: no payment is taken whatever this says. **Build-time.** | unset |
| `LIBRARY_PRICE_ANNUAL` | No — as above | Annual price in pounds, display only: `99` or `99.00`. **Build-time.** | unset |
| `LIBRARY_WAITLIST_EMAIL` | No — falls back to `ENQUIRY_EMAIL`, then the site address | Where Library waitlist sign-ups are delivered. Use the company mailbox. | `info@learnthrivetuition.co.uk` |
| `LIBRARY_DOWNLOADS_PER_HOUR` | No — default `60` | Downloads one family account may make in an hour (1 to 1000). | unset (60) |
| `LIBRARY_ENABLED` | No — leave unset until the account backend is ready | `true` opens the account and Library routes in production (see "The Library carve-out" above). Server variable, read per request. | unset (closed) |
| `SUPABASE_URL` | **Yes** for accounts | The project URL, for Supabase Auth. Server only: never a `NEXT_PUBLIC_` variable. With this, `SUPABASE_ANON_KEY` and `DATABASE_URL` not all set, production runs no account backend. | `https://abcdefgh.supabase.co` |
| `SUPABASE_ANON_KEY` | **Yes** for accounts | The project's anon (publishable) key. It grants only what Auth allows anyone. Server only. | (secret-ish) |
| `DATABASE_URL` | **Yes** for accounts | Postgres connection string for the server's own queries (use Supabase's **pooler**, transaction mode, port 6543). Connect as a role that bypasses RLS only on the server; this key must never reach the browser or a log. | `postgres://...` (secret) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** for downloads and the import tool | The service role key, for the private `library` storage bucket. It bypasses every policy: server and the import tool only, never a `NEXT_PUBLIC_` variable, never logged. Rotate it if it ever leaks. | (secret) |
| `STRIPE_SECRET_KEY` | Only to take payment | `sk_test_...`, `sk_live_...` or a restricted `rk_...`. Server only; never logged. A test key puts the server in test mode and the webhook then refuses live events (and the reverse). `docs/BILLING.md` has every Stripe step. | (secret) |
| `STRIPE_WEBHOOK_SECRET` | Only to take payment | `whsec_...` for `/api/billing/webhook`; two, comma separated, while rotating. | (secret) |
| `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` | Only to take payment | The `price_...` IDs of the recurring GBP prices. An amount is rejected: prices live in Stripe. | `price_1Abc...` |
| `STRIPE_API_VERSION`, `STRIPE_AUTOMATIC_TAX` | No | The API version the server's calls use (default `2025-09-30.clover`); `true` asks Stripe Tax to calculate tax at checkout. | unset |
| `LIBRARY_VAT_STATUS` | **Yes** to take payment | `registered` (prices include VAT) or `not_registered`. The accountant decides; unset means no checkout. | unset |
| `LIBRARY_MIN_PER_SUBJECT`, `LIBRARY_REQUIRED_SUBJECTS` | **Yes** to take payment | The content gate: the least published resources each listed subject must have (for example `5` and `Maths,English,Science,11+`). | unset |
| `LIBRARY_TERMS_APPROVED` | **Yes** to take payment, and for `/library/terms` in production | `true` once the owners and a solicitor have approved the terms, the content licence and the checkout wording. | unset |
| `ASSISTANT_ENABLED` | **Yes** to turn Study Buddy on | The kill switch. In production the assistant is on only if this is exactly `true`; anything else (or unset) closes it and `/api/assistant/*` answers 503. `docs/ASSISTANT.md`. | unset (off) |
| `ASSISTANT_PRODUCTION_APPROVED` | **Yes** to turn Study Buddy on | `true` only after plan19 section 6 (provider contract, safeguarding, privacy, terms) is complete and recorded. | unset |
| `ASSISTANT_PROVIDER`, `ASSISTANT_BASE_URL`, `ASSISTANT_API_KEY` | **Yes** to turn Study Buddy on | In production only `custom` qualifies: an OpenAI-compatible endpoint chosen under section 6. Ollama and NVIDIA NIM are development only and are refused. The key is server only and never logged. | `custom`, `https://...`, (secret) |
| `ASSISTANT_MODEL`, `ASSISTANT_VISION_MODEL` | With `custom` | The production provider's model names. | provider's names |
| `ASSISTANT_MINORS_APPROVED` | No | `true` only after the safeguarding lead approves in writing. Until then Study Buddy is for adult account holders, with a recorded confirmation. | unset |
| `ASSISTANT_SAFEGUARDING_EMAIL` | **Yes** before Study Buddy opens | The safeguarding lead's mailbox for flags (an opaque reference and a category, not the pupil's name). Unset: the fixed reply is still given but nobody is told. | `safeguarding@...` |
| `ASSISTANT_CONTEXT`, `ASSISTANT_MAX_OUTPUT_TOKENS`, `ASSISTANT_DAILY_MESSAGES`, `ASSISTANT_PER_MINUTE`, `ASSISTANT_DAILY_TOKEN_BUDGET`, `ASSISTANT_CONCURRENCY` | No | Limits and the hosted cost cap. Defaults and meanings in `docs/ASSISTANT.md`. | `8192`, `700`, `40`, `6`, `40000`, `1` |
| `VOICE_ENABLED`, `VOICE_PROVIDER`, `VOICE_URL`, `VOICE_TOKEN` | **No: leave unset** | Voice mode is development only. In production `/api/assistant/voice/*` is closed whatever these say, because no production speech provider has been chosen (plan19 section 6). `docs/VOICE.md`. | unset |
| `NEXT_PUBLIC_SITE_URL` | No (staging) | The site's own address, which Stripe sends people back to and `ALLOWED_ORIGINS` also accepts. Default the production address. | `https://staging.example.com` |
| `STRIPE_FAKE` | **Never in production** | Development and tests only: swaps in a fake Stripe. Refused when `NODE_ENV=production`. | unset |
| `CAPTCHA_SECRET` | **Yes** for applications, reconfirmations, subject requests and the Library waitlist — those routes fail closed (503) without it | Key that signs the human-check challenges (an HMAC). At least 32 characters; use 64 hex characters. Never sent to the browser. | `openssl rand -hex 32` (secret) |
| `CLIENT_IP_HEADER` | No — see `docs/RENDER.md` | Name of the request header that carries the visitor's address, if the host sets a trusted one (for example `true-client-ip`). Used by the careers, subject-request and Library waitlist rate limits. | unset |
| `TRUSTED_PROXY_HOPS` | No (default `1`) | How many proxies sit in front of the app, when the address is taken from `X-Forwarded-For` (counted from the right). | `1` |
| `CAREERS_OPEN_FOR_TESTING` | **Never in production** — a production build ignores it | Development and tests only: opens the application and reconfirmation forms while the safeguarding agreement is still a draft. The e2e config sets it to `1`. | unset |
| `ALLOWED_ORIGINS` | No (the default is right) | Comma-separated origins allowed to POST to the enquiry, careers, reconfirmation, subject-request and Library waitlist routes. The default is `https://www.learnthrivetuition.co.uk,https://learnthrivetuition.co.uk`. Set it only for a staging host. | `https://staging.example.com` |
| `NEXT_PUBLIC_APP_PORTAL_ENABLED` | No — leave unset | `true` opens the portal (see above). Unset = closed in production. Build-time. | unset |
| `NEXT_PUBLIC_THEME_TOGGLE` | No | `0` removes the dark theme and the theme switch (kill switch). Build-time. | unset (on) |
| `NEXT_PUBLIC_SMOOTH_SCROLL` | No | `0` removes smooth scrolling entirely (kill switch). Build-time. | unset (on) |
| `NEXT_PUBLIC_CLASSROOM_URL` | No — portal only | Where an external classroom is served; also added to the CSP's `connect-src`/`frame-src`. | unset |
| `CSP_REPORT_ONLY` | No | `1` sends the CSP as `Content-Security-Policy-Report-Only` instead of enforcing it (a staging soak). Build-time. | unset |
| `NEXT_PUBLIC_MOTION_DEBUG` | No | `1` includes the motion debug overlay in a production build. Leave unset. | unset |
| `PORT` | host-dependent | Port for `next start` / `server.ts`. | `3000` |
| `DISCONNECT_GRACE_MS` | No — `apps/realtime` only | Classroom reconnect grace period. Not used by the website. | host default |
| `CHROME_PATH` | No — local scripts only | Browser path for `scripts/profile-motion.mjs`. | unset |
| `CI` | set by CI | Playwright retries and `forbidOnly`. | set by CI |

Per environment: **production** sets the three email variables and `CAPTCHA_SECRET`, plus `CAREERS_EMAIL`, `SUBJECT_REQUEST_EMAIL` and `LIBRARY_WAITLIST_EMAIL` if applications, subject requests and Library waitlist sign-ups should go to a different mailbox from enquiries. The Library variables are optional: leave `LIBRARY_PHASE` and both prices unset for the coming-soon pages with no price. **Staging** sets the same with a staging Resend address (a mailbox you control as `ENQUIRY_EMAIL`) and `ALLOWED_ORIGINS` for its host. **Local development** needs none: with no `RESEND_API_KEY` the forms answer with the friendly 503.

To keep `apps/web/.env.example` complete, paste this block into it (names only, no values):

```
RESEND_API_KEY=
RESEND_FROM_EMAIL=
ENQUIRY_EMAIL=
CAREERS_EMAIL=
SUBJECT_REQUEST_EMAIL=
LIBRARY_WAITLIST_EMAIL=
LIBRARY_PHASE=
LIBRARY_PRICE_MONTHLY=
LIBRARY_PRICE_ANNUAL=
LIBRARY_ENABLED=
LIBRARY_DOWNLOADS_PER_HOUR=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_MONTHLY=
STRIPE_PRICE_ANNUAL=
STRIPE_API_VERSION=
STRIPE_AUTOMATIC_TAX=
LIBRARY_VAT_STATUS=
ASSISTANT_ENABLED=
ASSISTANT_PRODUCTION_APPROVED=
ASSISTANT_PROVIDER=
ASSISTANT_BASE_URL=
ASSISTANT_API_KEY=
ASSISTANT_MODEL=
ASSISTANT_VISION_MODEL=
ASSISTANT_MINORS_APPROVED=
ASSISTANT_SAFEGUARDING_EMAIL=
LIBRARY_MIN_PER_SUBJECT=
LIBRARY_REQUIRED_SUBJECTS=
LIBRARY_TERMS_APPROVED=
NEXT_PUBLIC_SITE_URL=
CAPTCHA_SECRET=
ALLOWED_ORIGINS=
CLIENT_IP_HEADER=
TRUSTED_PROXY_HOPS=
```

`CAREERS_OPEN_FOR_TESTING` is deliberately left out: it must never be set in production.

## Security headers

Served on every route (`src/lib/securityHeaders.ts`, applied in `next.config.ts`):

- `Content-Security-Policy` (production builds): `default-src 'self'`, no `eval`, no external origin, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'`. It allows `'unsafe-inline'` for scripts and styles because a nonce would force every page to render per request (installed Next docs), costing the static, CDN-cacheable site its speed. Hash-based CSP via Next's experimental `sri` option is the route to removing it.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` — **without `preload`**. Add `preload` and submit the domain to the preload list only once the owner confirms the domain and every subdomain will be HTTPS permanently; it is hard to undo.
- `Cross-Origin-Opener-Policy: same-origin`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (camera/microphone `(self)` for the classroom; see the comment in `securityHeaders.ts`), and no `X-Powered-By`.
- `X-Robots-Tag: noindex, nofollow` on `/login`, `/403`, `/dashboard/**`, `/api/**`.

## Enquiry endpoint in production

Layers, in order: origin check (403 for a foreign `Origin`), per-address rate limit (5 per 15 minutes, in memory), body validation, honeypot field and minimum fill time (both answer with the normal success response and send nothing), duplicate suppression (the same enquiry within a minute is one enquiry), fail-closed configuration check, send. Outcomes are logged as one JSON line each with **no personal data** (`{"event":"enquiry","outcome":"sent"}`, `silently_dropped` with a reason, `rate_limited`, `unavailable`, `send_failed`).

**The in-memory limiter is per server instance.** On a serverless or multi-instance host it limits each instance separately, so it is a second layer, not the first. Add a platform rate-limit rule on `POST /api/enquiry` (for example 5 requests per 10 minutes per IP at the host's firewall / WAF); the owner chooses the host, so the rule itself is an owner-blocked item. A third-party CAPTCHA is deliberately not added (privacy and cookie implications; owner decision, see the owner inputs).

The rate limiter trusts the first `X-Forwarded-For` address. Confirm the chosen host overwrites that header rather than passing a client-supplied one through.

## Careers, reconfirmation and subject-request endpoints in production

Three more write paths, all email-only (no database, no file storage): `POST /api/careers/apply` (multipart, with the CV, cover letter and supporting documents attached to one email), `POST /api/safeguarding/reconfirm` and `POST /api/subject-request`, plus `POST /api/careers/challenge`, which issues the signed human-check challenge. Each answers in this order: the gate (`applicationsOpen` / `agreementOpen`), the origin check, the per-address and whole-route rate limits, the fail-closed configuration check (no `RESEND_API_KEY`, no verified sender or no `CAPTCHA_SECRET` is a friendly 503 "email us"), then a size-limited read of the body, the honeypot and minimum-time checks, the human check, validation and file inspection, and only then the send. Outcomes are logged as one JSON line each with no personal data.

**The application and reconfirmation forms stay closed until the owner approves the safeguarding agreement.** `careersConfig.agreementApprovedByOwner` ships `false`: the pages say applications open soon, the forms are not offered and the two routes answer 503 `closed`. To open them, review every clause marked `ownerApproved: false` in `apps/web/src/lib/safeguarding-agreement-v1.ts`, mark them approved, set the flag to `true`, and update the agreement version date. `tests/safeguardingAgreement.test.mjs` fails the build if the flag is `true` while any clause is unapproved. A production build ignores `CAREERS_OPEN_FOR_TESTING`.

**Before opening applications on Render**, run the probes in `docs/RENDER.md`: the upload size the service really accepts (the limits are deliberately cautious), and which header carries the visitor's address (set `CLIENT_IP_HEADER` or `TRUSTED_PROXY_HOPS` to match). The rate limits are in memory, so they are correct for one instance and reset on a restart; `docs/RENDER.md` says what to add if the service ever runs on several.

## Library information pages

`/library` and `/pricing` are public, static, cookie-free pages in coming-soon mode (plan19 Phase B2; see [LIBRARY.md](LIBRARY.md)). They need no database, sign-in or Stripe. Nothing can be bought: there is no payment, pre-order or deposit.

- **Flag.** `LIBRARY_PHASE` defaults to `info`. Only `info` is built, so setting `enrolled` or `live` changes nothing yet. Leave it unset.
- **To show a price,** set `LIBRARY_PRICE_MONTHLY` and/or `LIBRARY_PRICE_ANNUAL` in pounds (`9.99`, `99`) and redeploy. A missing or invalid value shows "Price announced at launch". The prices are for display only; the owner and the accountant decide them (including the VAT treatment of a digital subscription) before anything is shown.
- **Redeploy to change anything.** The phase and prices are read when the site is built, so changing either needs a new build and deploy, not just a restart.
- **The waitlist** posts to `POST /api/library-waitlist`, which sends one email to `LIBRARY_WAITLIST_EMAIL` (then `ENQUIRY_EMAIL`, then the site address) and a short confirmation, with a removal line, to the person. It uses the same guards as the subject-request route and the same variables (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CAPTCHA_SECRET`, `ALLOWED_ORIGINS`) and fails closed with a 503 "email us" without them. Nothing is stored. Without JavaScript, and when the route answers 503, the page offers an email link to the site address (`info@`), not to `LIBRARY_WAITLIST_EMAIL`, so those messages arrive in that mailbox. Sign-ups are kept in the mailbox until the launch email has gone out or 12 months, whichever is sooner ([RETENTION_AND_DELETION.md](RETENTION_AND_DELETION.md)).
- **Before launch,** the owners approve the page copy and the privacy and cookie wording ([apps/web/LEGAL_REVIEW.md](../apps/web/LEGAL_REVIEW.md), "Library waitlist"). Add a host rate-limit rule on `POST /api/library-waitlist` as for the enquiry route.

## Email deliverability checklist (owner)

1. Add and **verify** the sending domain in Resend (the domain of `RESEND_FROM_EMAIL`).
2. Publish the SPF and DKIM DNS records Resend gives you; confirm Resend shows both verified.
3. Publish a DMARC record (start with `p=none` and a reporting address, tighten later).
4. Use a from-address on that domain, not `onboarding@resend.dev`.
5. In staging, submit a real enquiry end to end: the notification arrives at `ENQUIRY_EMAIL` with Reply-To set to the parent, and the parent's auto-reply arrives (check spam).
6. Send the auto-reply to Gmail, Outlook and Apple Mail addresses and read it in each.

## Canonical host

`siteConfig.url` is `https://www.learnthrivetuition.co.uk`. The bare domain redirects there permanently (308) with path and query preserved (`next.config.ts`), so DNS must point **both** names at the host. Every page's `canonical`, the sitemap, `robots.txt` and the JSON-LD use the `www` form. Trailing slashes are not used (Next's default).

## Branch and deploy process

- `main` is the deployable branch. Work happens on a branch and merges by pull request.
- CI (`.github/workflows/ci.yml`) runs on every pull request: lint, typecheck, unit tests, a production build, then the production smoke suite (`apps/web/tests-prod`) in Chromium, Firefox and WebKit against `next start`. It must be green to merge. On pushes to `main` it also runs the full dev-server Playwright suite. `npm audit --omit=dev` runs as a report and never blocks.
- A merge to `main` deploys through the host's Git integration (the owner chooses the host; nothing here is host-specific). Prefer a preview deployment per pull request.

## Rollback

1. In the host's dashboard, redeploy or "promote" the previous successful deployment (the fastest rollback on any immutable-deploy host).
2. If the host cannot, revert the merge on `main` (`git revert -m 1 <merge commit>`), let CI pass and deploy that.
3. A bad environment variable is rolled back by restoring the previous value and redeploying (build-time `NEXT_PUBLIC_*` values need a rebuild).
4. The enquiry, application, reconfirmation, subject-request and Library waitlist forms are the only write paths. If they must be stopped at once, remove `RESEND_API_KEY`: every route then answers with its "email us directly" message and sends nothing. To close only applications, set `acceptingApplications` to `false` in `apps/web/src/lib/careers-config.ts` and redeploy.

## Pre-launch smoke checklist

Run against the **staging** deployment, then again on production after the first deploy.

- [ ] `npm run test:prod-smoke` passes with `PROD_BASE_URL` set to the deployment (it sends no real email).
- [ ] Submit a real enquiry end to end in staging (checklist above, item 5).
- [ ] Every public route returns 200; an unknown URL shows the branded 404.
- [ ] `/login` and `/dashboard` show "Portal opening soon"; `/dev/motion` and `/api/auth/session` are 404.
- [ ] `https://learnthrivetuition.co.uk/about` redirects to the `www` URL.
- [ ] `/robots.txt`, `/sitemap.xml`, `/.well-known/security.txt`, `/manifest.webmanifest` and `/api/health` respond; the sitemap lists the legal pages.
- [ ] Response headers: CSP, HSTS, COOP, X-Content-Type-Options present (browser dev tools, Network tab, any page).
- [ ] The browser console is clean on the home page, `/book` and `/faq` (no CSP violations).
- [ ] A social-preview check of the home page and one subject page shows the branded card.
- [ ] The host's firewall/rate-limit rule on `POST /api/enquiry` is active.
- [ ] The owner has signed off the cookie notice change ([apps/web/LEGAL_REVIEW.md](../apps/web/LEGAL_REVIEW.md)).
- [ ] Careers, while the agreement is a draft: `/careers/apply` and `/safeguarding/reconfirm` say they are not open yet and show no form; the application and reconfirmation routes answer 503 `closed`; the agreement page is a draft and out of the sitemap; no page carries job posting markup.
- [ ] Library information pages: `/library` and `/pricing` return 200, say coming soon, show a price only if one is configured, and are in the sitemap; the waitlist form sends one email to the waitlist mailbox and a confirmation with a removal line to the sender (check spam); the owner has approved the copy ([apps/web/LEGAL_REVIEW.md](../apps/web/LEGAL_REVIEW.md)).
- [ ] Before opening applications: the owner has approved the agreement and set `agreementApprovedByOwner`; the upload-size and client-address probes in [RENDER.md](RENDER.md) have been run on the deployed service; one real application with a CV and an identity document arrives in the `CAREERS_EMAIL` mailbox with its attachments, the applicant's confirmation arrives, and a subject request and a reconfirmation arrive too (check spam).
