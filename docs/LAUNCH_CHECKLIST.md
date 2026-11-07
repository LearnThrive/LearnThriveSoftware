# Launch checklist: the tuition platform

Written 2 November 2026. How to take the monorepo (`apps/web`, `packages/data`, `supabase/`) from "built and tested locally" to "real families, tutors and admins using it", **not including LearnThrive AI or the Library**.

**Scope.** Launching means: the public site (marketing, enquiry, careers, subject requests), `/login` and the account pages, the dashboards for admin, tutor, guardian and learner (lessons, calendar, attendance, reports, notifications, availability, people and enrolment), and the classroom. It runs as one Next.js app on Render, Postgres and Auth on Supabase, email through Resend, **parents paying for lessons through Stripe** (decided 2 Nov 2026; task 3.10), and **classroom video relayed through Cloudflare Realtime TURN** (decided 2 Nov 2026; task 3.1).

**Where this comes from.** Every claim below is from this repo's docs or code (`DEPLOYMENT.md`, `DEPLOYMENT_READINESS.md`, `RENDER.md`, `SUPABASE_*.md`, `IDENTITY.md`, `PRODUCTION_COMPLETION_LEDGER.md`, `PRODUCTION_GAPS.md`) read on that date. Nothing in it was run against real infrastructure. Items marked **(verify)** are things the docs leave unclear.

**Decisions already made (2 Nov 2026)** are recorded in Phase 0: Stripe for lessons (Tahasin supplies the access and rules), Cloudflare SFU and TURN for classroom media (10 students), manual accounts for everyone with username sign-in, all learners under 18 linked to a parent, Alvi, Tahasin and Abdurrahman as admin-tutors and Brian as admin only, Tahasin as safeguarding lead, no lesson recording, DBS paid by tutors, records purged when people leave, careers stored in Supabase, Data API on, and the classroom served by `server.ts`.

**Update 7 Nov 2026.** Tahasin's answers are recorded in [OWNER_ANSWERS_2026-11-07.md](OWNER_ANSWERS_2026-11-07.md). They **reverse** two decisions below (**lessons are now to be recorded for safeguarding, once the privacy work is done; the DPIA is reopened**) and **change the payments design** (monthly billing in arrears; the family payment method, and so whether Stripe is used, is not confirmed). Where Phase 0 or task 3.10 below still says the old thing, the 7 Nov answers win. Nothing is to be recorded and no public wording is to change until the items marked OPEN there are closed.

**How to use it.** Work the phases in order; a phase's "Done when" lines are the evidence you need before starting the next. Tick a box only with evidence (a command output, a screenshot, a dashboard value). Owner = a decision or account only the business owners can supply. Build = code or config work. Ops = something done in a dashboard or shell.

**Rules that apply throughout.**
- Never commit a secret or an `.env*` file. Values live in Render's dashboard, and one shell session for operator scripts.
- Never run anything against the hosted Supabase project without the owner's explicit go-ahead for that step.
- Do not weaken a test to make it pass. A failure is information.

---

## Switches that stay OFF at launch (AI and Library are out of scope)

Confirm each is **unset** in Render's production environment and re-check after every deploy:

| Variable | Why it stays unset |
| --- | --- |
| `ASSISTANT_ENABLED`, `ASSISTANT_PRODUCTION_APPROVED`, `ASSISTANT_MINORS_APPROVED`, `ASSISTANT_PROVIDER`, `ASSISTANT_*`, `OLLAMA_API_KEY` | LearnThrive AI is closed in production unless `ASSISTANT_ENABLED` is exactly `true`. |
| `LIBRARY_ENABLED`, `LIBRARY_PHASE`, `LIBRARY_PRICE_*`, `LIBRARY_VAT_STATUS`, `LIBRARY_TERMS_APPROVED`, `LIBRARY_MIN_PER_SUBJECT`, `LIBRARY_REQUIRED_SUBJECTS` | Library stays "coming soon", nothing can be bought. |
| `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` | These are the **Library's** subscription prices. Tuition payments get their own prices (task 3.10). Leave these unset so the Library can never be bought. |

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are **no longer in this list**: tuition payments need them. Because the Library shares the same Stripe code, task 3.10.6 and the switch audit (7.8) must prove that setting Stripe keys does **not** open Library checkout (it needs `LIBRARY_PHASE=live`, a price, a VAT status, a content threshold and approved terms).
| `VOICE_*` | Voice is closed in production whatever these say. |
| `CAREERS_OPEN_FOR_TESTING`, `STRIPE_FAKE`, `NEXT_PUBLIC_MOTION_DEBUG` | Development or test only. |

**Caveat.** Building with `NEXT_PUBLIC_APP_PORTAL_ENABLED=true` makes `decide()` in `apps/web/src/lib/portal.ts` let everything except `/dev` and `/api/dev` through, including `/library/**` and `/api/assistant/**`. Those routes then rely on their own switches above. Task 8.6 proves they stay closed.

---

## Phase 0: Owner decisions and inputs

None of these can be defaulted by an engineer. For each, write the answer and the date in the "Answer" column of your own copy, then do the dependent tasks. A task that depends on an unanswered decision is blocked, not skipped.

### 0.1 Payments for tuition: DECIDED, product rules still open
- **Updated 7 Nov 2026** ([answers](OWNER_ANSWERS_2026-11-07.md), B1 to B19). The **charging model is decided: monthly in arrears for lessons delivered** (0.1a answered), with a month-end statement and email reminder; the 10% sibling discount, the free 30-minute taster, the 24-hour cancellation rule with a waived first late cancellation and first no-show per child, no routine make-up lessons, no late fees, lessons paused only after more than one month overdue (never automatically), tutors never seeing amounts, and tutors paid by bank transfer (0.1h answered) are all recorded there. **Not decided: how families pay (PayPal is excluded), the family rates, the repeat late-cancellation fee, the refund criteria, VAT treatment and the accountant.** Stripe as the way families pay is therefore **not confirmed**; read the bullet below as the 2 Nov position.
- **Decided (2 Nov 2026).** Parents pay for lessons through **Stripe**. The app has nothing for this yet: the Stripe code in `apps/web/src/lib/billing/*` and migrations `0003`/`0006` handle Library subscriptions only. Building it is task 3.10 and is the biggest item before launch.
- **Still to answer (blocks the design, so answer before any code):**
  - **0.1a Charging model.** Pay per lesson when booked; prepaid packages/blocks of lessons; a monthly invoice in arrears for lessons delivered; or a fixed monthly subscription per assignment.
  - **0.1b Rates.** Per tutor, subject, level or assignment; who sets them; how a mid-term change works; sibling discounts or concessions.
  - **0.1c Cancellation, no-show, make-up and refund rules**, including late-cancel charges and how long a prepaid lesson stays valid.
  - **0.1d Trial or first lesson:** free, discounted or full price.
  - **0.1e Failed or late payment:** retries, reminders, and what happens to lessons (recommended: never cut a child off without a human decision).
  - **0.1f VAT and tax:** the accountant decides whether the tuition is exempt for this company. The repo already notes the Library's digital subscription is not covered by the tuition exemption.
  - **0.1g Payment methods:** cards only, or also Apple/Google Pay and Direct Debit (Bacs; cheaper for recurring but needs mandates).
  - **0.1h Tutor pay:** the company pays tutors outside Stripe (assumed, simplest), or Stripe Connect (adds identity checks for every tutor and a much larger build).
- **Who answers.** **Tahasin Hasan will provide the Stripe account access and these product rules** (decided 2 Nov 2026), with the accountant for VAT. Until he does, all of 3.10 is blocked; the build can be designed but not finished.
- **Done when.** Each answer is written down and the terms, FAQ and fees wording match.

### 0.2 Accounts: DECIDED, LearnThrive creates every account, and people sign in with a username
- **Decided (2 Nov 2026).** Nobody signs themselves up. LearnThrive creates the accounts for staff, tutors, parents and learners, on the project's Supabase (Alvi asked Claude to create them; see 3.2.8 for how, and the approval needed at that moment). **People sign in with a username, not an email address**, for ease of use, and because young children have no email.
- **What changes.**
  - Supabase "Allow new users to sign up" stays **off permanently** (`supabase:verify -- --expect-signup closed`). The public sign-up screen and `/api/account/signup` are shut in production (3.2.5).
  - **Supabase Auth requires an email.** Each username is therefore stored with a fixed, internal, never-mailed address built from it (for example `kit-4821@accounts.learnthrivetuition.co.uk`; the exact internal domain is a decision in 3.2.1). The person only ever types the username. Nothing is ever sent to that address.
  - **Every account is linked to a real email address** (decided 2 Nov 2026), used for password resets, notices and invoices, but not typed to sign in. **A student's account is linked to the same email as their parent's account**, so a child's reset link and any notice go to the parent. That means a forgotten password can be reset by email after all: the person enters their username, and our own site sends a one-time link to the linked address (3.2.4). An admin reset remains the fallback.
  - The linked email is stored on the account's record (the parent's own address for a parent; the **parent's address for each of their children**; each tutor's and admin's own address). It is not the Supabase login address, and the internal username address is never mailed.
  - The admin "create account" feature does not exist yet; it is task 3.2 and a launch blocker.
- **Still to write down.** The onboarding procedure, and who does each step (admin creates the parent account, then each child's record and login, then the assignment).

### 0.3 Learners: DECIDED, all under 18, usernames, each linked to a parent
- **Decided.** Every learner is under 18 (Year 1 to A Level). Every learner has their own account, with a **username**, linked to the client (parent or guardian) account. A parent sees each of their enrolled children separately. The data model already fits: `client_students` links, `learner_identities`, the parent's `/dashboard/children` and `/dashboard/progress/[studentId]`, and the guardian supervised view (`docs/IDENTITY.md`).
- **Usernames for children** (Children's Code: collect no more than needed): do not build a child's username from their full name or school. Use a short generated pattern (for example a word and four digits). The display name shown inside the app is a separate field.
- **Still to confirm.** Whether the youngest children sign in themselves or always through the parent's supervised view (the supervised view stays available either way). The parent's agreement to the child having an account is given in the enrolment terms (from Tahasin).

### 0.4 Safeguarding, privacy and legal: decisions recorded
| Item | Answer (2 Nov 2026) | Still needed |
| --- | --- | --- |
| Safeguarding lead | **Tahasin Hasan** | A monitored concern address and the published procedure; sign-off on the learner age rule (0.3) |
| Who controls and handles data, privacy requests, complaints and breaches | **Tahasin Hasan and Abdurrahman Mustafa** | A contact address for each request type on the privacy and complaints pages; a written breach plan (the ICO must be told within 72 hours of becoming aware of a reportable breach) |
| DBS | **Tutors pay for their own DBS** | Say so plainly on the careers pages and in the agreement; decide what LearnThrive checks and records (suggested: see the certificate or Update Service result, record the date and outcome only, never keep the certificate) |
| Lesson recording | **SUPERSEDED 7 Nov 2026: all lessons are to be recorded for safeguarding**, subject to the privacy and implementation decisions (OWNER_ANSWERS D6, F5). Until then nothing is recorded and the public pages keep saying so. *(2 Nov: lessons are not recorded, for tutor and student privacy.)* | Write it into the privacy notice, terms, FAQ and safeguarding policy, and have Tahasin decide the compensating controls (for example a parent may sit in, no private messaging) |
| DPIA | **REOPENED 7 Nov 2026** (OWNER_ANSWERS F5): assess the children's portal and routine recording, and complete a DPIA where required, **before recording is enabled**. *(2 Nov: decided not needed.)* | The assessment; see the note below, which is now a requirement |
| ICO data protection fee | **Paid** | Put the annual renewal date in a calendar |
| Lawful bases | **Confirmed by Alvi, 2 Nov 2026**: [LAWFUL_BASES.md](LAWFUL_BASES.md) | Tahasin and Abdurrahman keep it under review; the privacy and careers notices must say the same |
| Retention | **Purge**: when a student or tutor leaves, their records are purged, apart from the legal exceptions in `LAWFUL_BASES.md` (financial records, safeguarding records, unsuccessful applications) | Build the purge tool (3.7); update `RETENTION_AND_DELETION.md` to match |
| Terms | **Tahasin will provide them** | Blocks publishing the terms page and any payment wording (3.10.13b) until received |
| Stripe | **Tahasin will provide the account access and the product rules** (0.1) | Blocks all of 3.10 |
| Suppliers | Render, Supabase, Resend, Stripe, Cloudflare; IONOS is the **domain registrar and DNS only**; company email is hosted elsewhere (probably Google Workspace, as `legal-faqs.tsx` says: confirm) | Final list with transfer safeguards for the privacy page |

- **Note on the DPIA.** You decided one is not needed, and that is recorded. I would still have Tahasin and Abdurrahman check it against the ICO's own DPIA screening checklist first. UK GDPR requires one before processing that is likely to be high risk, and the ICO lists children's data and online services aimed at children among the things that point that way. A short DPIA is cheap insurance and also answers the questions the first school, parent or regulator will ask. Treat it as recommended, not blocking.
- **Careers.** The safeguarding agreement approval flag (`agreementApprovedByOwner`) is separate and stays closed until the clauses are approved (see 3.12).
- Legal review of `apps/web/LEGAL_REVIEW.md` sections for cookies, privacy, accounts, payments and the portal.

### 0.5 Staff access: DECIDED
- **Alvi Hossain, Tahasin Hasan and Abdurrahman Mustafa are each admin and tutor. Brian is admin only.** Accounts are created manually (0.2). A person who is both an admin and a tutor **does not work in the code yet** (task 3.11), so three of the four launch accounts depend on it. Staff multi-factor sign-in for the site's own admins is still **not built** (3.6); with four admins and usernames, use long unique passwords.

### 0.6 Infrastructure: decisions recorded
- **Classroom video: Cloudflare SFU plus TURN, for up to 10 students per lesson.** Alvi created a serverless SFU on Cloudflare and will supply the **TURN keys**. A peer-to-peer mesh cannot carry 10 students (each person would upload to every other), so the SFU is required, not optional: task 3.13, now a launch blocker for any lesson of more than a few students. The code today is mesh plus TURN with a hard limit of one tutor and three students.
- **Classroom server: DECIDED and BUILT, `server.ts` in production** on one Render instance (`npm run serve --workspace=apps/web`, see 3.1). Cloudflare does not host the Socket.IO signalling, so this stays our process.
- **Staging Supabase project:** a second project is only for rehearsing migrations and flows without touching production data; it is **not** needed for the SFU. I recommend creating one, because migrations `0010`–`0016` have never run on a hosted project. Alvi said to ask when it is needed: it is needed before 4.2.
- **Supabase Data API: stays on**, `public` schema only (the probes in `supabase:verify` confirm what a browser key can reach).
- **Backups:** point-in-time recovery on or off is still open (recommended on).
- **Error reporting and analytics:** none (the cookie page assumes none).
- **CAPTCHA: done.** The enquiry form now uses the site's own human check (a signed proof-of-work, no third-party script or cookie), joining careers, subject requests and account forms. In production the enquiry route refuses to run without `CAPTCHA_SECRET`. A third-party CAPTCHA such as Cloudflare Turnstile was **not** added because it loads scripts the site's Content Security Policy forbids and changes the cookie and privacy position; revisit only if spam gets through.

### 0.7 Accounts and access to hand over
- **Render: Brian holds the account.** He creates the web service, or invites a teammate to; secrets are passed through a password manager, never chat or email.
- Supabase organisation (exists: Pro plan, project `learnthrive-prod`, ref `vwsjvdpkgjhwmqmufmrh`, London), a Resend account, a **Stripe** account (from Tahasin, 3.10.2), a **Cloudflare** account (TURN key and the SFU app id and secret), **IONOS** for the domain and DNS, the company email provider's admin (to add SPF/DKIM), GitHub/GitLab repo access, Google Search Console, an uptime monitor.

### 0.8 Content
- **Images: decided, keep the current photos.** The founders section on the About page has been restyled (portrait and name as a header, the bio full width underneath, equal cards, a brand-coloured ring on the portrait, side by side on phones). No new photography is needed.
- `security.txt` contact: today the public `info@` address, expiry 30 Sept 2027. Confirm it is monitored.
- Planning files: `.gitignore` now ignores `plan*.md`. `plan.md` was already committed, so it is still tracked; run `git rm --cached plan.md` when you want it out of the repository (the file stays on disk).

---

## Phase 1: Make the repo shippable

### 1.1 Get the working tree clean and on `main`
- **Why.** Production is deployed only from a clean, pushed `main`. At the time of writing there are uncommitted changes (assistant thinking and essay-prompt edits among them) and untracked brief files at the repo root.
- **Do.** Review `git status`; commit work in sensible commits (stage paths, never `git add -A`); leave the root briefs (`*_Prompt.md`, `plan*.md`, `CAREERS_*.md`) untracked or move them as decided in 0.8; make sure no `.env*` is staged.
- **Done when.** `git status` is clean and the branch is pushed.

### 1.2 Decide the remote and branch rules
- The repo has two remotes (`origin` on GitHub, `gitlab`). Pick the one Render deploys from, protect `main`, require CI to pass, and merge by pull request.

### 1.3 Run the whole quality gate on a clean checkout
- **Do.** `npm ci`, then from the repo root `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (the build also builds `apps/classroom` and typechecks `apps/realtime`). For the web app: `npm run check:bundle --workspace=apps/web` against the production build, which also confirms no seed data or secret reaches the browser bundle. The ledger notes this was never run against a production build.
- **Done when.** All pass; paste the counts into the release notes.

### 1.4 Prove the CI workflow on GitHub
- `.github/workflows/ci.yml` has never executed on GitHub (`DEPLOYMENT_READINESS.md` 16.6). Open a pull request, watch lint, typecheck, tests, build and the production smoke suite (Chromium, Firefox, WebKit) pass, then merge. Fix anything environment-specific that fails.

### 1.5 Fix the stale pieces
- Correct the claim that company mailboxes are on IONOS. IONOS is the domain registrar and DNS only (0.4). It appears in `docs/DEPLOYMENT.md`, `docs/RENDER.md`, `docs/RETENTION_AND_DELETION.md`, the marketing repo's `DEPLOYMENT_PLAN.md` and possibly the privacy page; `legal-faqs.tsx` currently says Google Workspace/Gmail, which is probably right: confirm and make everything agree.
- Regenerate `apps/web/.env.example` (names only): `cd apps/web && node scripts/env-docs.mjs --template > .env.example`, review the diff first (it overwrites). Use `node`, not `npm run`.
- Run `npm run env:docs --workspace=apps/web` so `docs/ENVIRONMENT.md` matches the registry.
- Update the footer test and legal wording in the marketing site if that repo is retired by this launch (see 9.1).
- Run `npm audit --omit=dev` and re-read the known exception: the findings are all through Excalidraw, which **is** reachable once the portal opens (the classroom whiteboard). Decide fix or accept, and record it.

---

## Phase 2: Prove the tuition database on a real Supabase stack

Why: the tuition tables (migrations `0010`, `0011`) and the learner-identity functions have only ever run on PGlite (in-process Postgres). Docker would not start on the dev machine, so the real service has never run them.

### 2.1 Get Docker running
- Open Docker Desktop once and finish any first-run or WSL prompt until `docker ps` works. If the engine will not start, use another machine; this blocks everything in this phase.

### 2.2 Start the local stack and run the real-stack suite
- **Do.** `npm run supabase:start`, then `npm run test:realstack` (runs the data and web real-stack tests).
- **Expect.** The 174 existing tests pass; the suite proves migrations apply from nothing, row-level security through the real API, and the narrow server role.
- **Care.** The local stack publishes ports on all interfaces and serves an unauthenticated `/pg/query`; run `npm run supabase:stop` when finished.

### 2.3 Wire the unproven contracts into the real-stack files
- The ledger lists these as undone: add the **identity**, **data provider** (lessons, attendance, reports, notifications, availability, settings) and **paper jobs** contracts (`identityContract.ts`, `dataProviderContract.ts`) to the `realstack.*.test.ts` files the way the Library contract is, so they run against real Postgres directly, through the pooler, and as the `learnthrive_server` role.
- Update `create-server-role.mjs` grants if any new table or function is unreachable by the role (a test pins this on purpose).

### 2.4 Test the real flows against real Auth
- With the local stack and `npm run dev:supabase`, walk through today's flow: guardian sign-up, email confirm (read the email in the local mail catcher), sign-in, create a learner invitation, learner sign-up, accept; refresh; password reset; sign-out. Repeat with the admin-created flow once 3.2 is built (sign-ups off, set-password email, sign-in).
- Run the migration upgrade path: `supabase db reset`, and apply the later migrations to a populated copy (the ledger lists "upgrade-from-populated-copy" as undone).

### 2.5 Re-audit tuition scoping on the SQL provider
- The ledger says the staff dashboards' per-role scoping was not re-audited page by page on the SQL provider. For each dashboard page, confirm with two families and two tutors that nobody sees another's students, lessons, reports, attendance or notifications, including by guessing ids in the URL. Add Playwright/real-stack tests for any gap found.

**Phase 2 done when:** the real-stack suite (with the new contracts) passes, a full guardian→learner flow works on real Auth, and the scoping audit is written down.

---

## Phase 3: Close the build gaps

Each task says whether it is **required** for launch or **optional**.

### 3.1 Serve the classroom in production, with Cloudflare TURN (required if the classroom is used)

**What Cloudflare does and does not do.** The decision is Cloudflare Realtime **TURN**: it relays video and audio when two people cannot connect directly. It does **not** run the classroom's signalling (the Socket.IO server that admits students, carries chat and sets up each call). That server is still ours to host. The repo is built for exactly this split: `apps/realtime/server/signalling.ts` mints short-lived TURN credentials from a Cloudflare key (`GET /api/turn-credentials`) so the long-lived pair never reaches a browser.

**The problem to fix.** The browser connects Socket.IO and fetches `/api/turn-credentials` on the **same origin** as the site (`apps/web/src/features/classroom/meeting.ts` and `ice.ts`). `next start` serves neither; only the development wrapper `apps/web/server.ts` does. `DEPLOYMENT.md` says `server.ts` is development only, so as written, production would have **no working classroom** and no TURN endpoint.

- **3.1.1 Where signalling runs: DECIDED and BUILT (2 Nov 2026), `server.ts` in production.** `apps/web/serve.mjs` (run with `npm run serve --workspace=apps/web`) sets `NODE_ENV=production`, registers `tsx` (now a production dependency of `apps/web`) and starts `server.ts`: the Next.js site, Socket.IO signalling and `GET /api/turn-credentials` on one port and one origin. It follows Next's custom-server guide. **Exactly one instance** (rooms are in memory); a deploy or restart ends any lesson in progress, so deploy outside lesson hours. Render's build must install dev tools (`npm ci --include=dev`) because Render sets `NODE_ENV=production`. Documented in `DEPLOYMENT.md` and `RENDER.md`.
- **3.1.2 Proven locally.** A production build served by `serve.mjs` answered pages (200 with the CSP and HSTS headers), `/socket.io/?EIO=4&transport=polling` (200 with a session id), `/api/turn-credentials` (503 "not configured" without a Cloudflare key, as intended), `/api/health` and a 404 for `/api/dev/reset`; the whole production smoke suite (62 tests) passed against it, plus the new `tests-prod/unified-server.spec.ts` (`PROD_SERVER=unified`). **Still to prove on Render:** the same checks against the live service, WebSocket upgrades through Render's proxy, and a real TURN key returning 200 with `iceServers`. A 503 means TURN is not configured, a 502 means Cloudflare rejected the key, a 429 is the 20 per minute guard.
- **3.1.3 Cloudflare credentials.** In the Cloudflare dashboard (Realtime, TURN) create a TURN key; copy the **Key ID** and **API Token** immediately (the token is shown once). Set `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` **on the process that serves `/api/turn-credentials`** (Render for Option A). Server-only: never `NEXT_PUBLIC_` or `VITE_`. Do not set the static `NEXT_PUBLIC_TURN_*` variables in production (they ship a long-lived credential to every browser).
- **3.1.4 Make the environment check know about them.** `docs/ENVIRONMENT.md` currently lists the two Cloudflare variables as "classroom server (not deployed)", so `npm run check:env` would not flag them as missing. Add them to `apps/web/scripts/env-registry.mjs` as required in production for the classroom, then regenerate (`npm run env:docs --workspace=apps/web`) and re-run `check:env`.
- **3.1.5 Secrets.** Set `CLASSROOM_JOIN_SECRET` to a long random value (for example `openssl rand -hex 32`) wherever the web app and any realtime service run, **identical on both**. If unset, the code falls back to a hardcoded development secret (`DEV_FALLBACK_SECRET`), which must never reach production: add it to `check:env` as required.
- **3.1.6 Prove the relay on the live service.** Two participants join with `?forceTurn=1&debug=1`; the diagnostics panel must show **Relay (TURN)** for each peer. A configured relay can still fail silently while calls connect directly, which is why this test exists. Do it from two networks, one on mobile data.
- **3.1.7 Docs disagree; resolve it.** `apps/classroom/TURN_TESTING.md` says the happy path was exercised with a real key; `PRODUCTION_GAPS.md` says it was never proven against a real account. Treat it as unproven until 3.1.6 passes on staging, then update both files.
- **3.1.8 Limits to accept or fix.** Media is a peer-to-peer mesh (up to 3 outgoing streams at the 4-person maximum); the Cloudflare SFU for 10 students is built but unproved against the real service (3.13). Safari/iOS has never been tested (Phase 7). Force-mute is a directive, not enforcement (signalling never touches media). Signalling events have no rate limiting beyond the message size cap.
- **Done when.** Two real devices on different networks complete a lesson on staging, `Relay (TURN)` shows with `?forceTurn=1`, and `check:env` fails if the Cloudflare pair or the join secret is missing.

### 3.2 Username sign-in and admin-created accounts (required; replaces sign-up and email sign-in)

**Decisions (0.2, 0.3):** LearnThrive creates every account, and people sign in with a **username**. Sign-ups are off. Today the code signs in by **email** throughout, has an admin screen for tutor, client, student and assignment **records**, and an action that links a tutor's *existing* login by email, but **no way to create a login**.

- **3.2.1 The username model.**
  - Supabase Auth needs an email, so each username gets a fixed **internal** address derived from it, on a domain used for nothing else (suggested: `accounts.learnthrivetuition.co.uk`, or a subdomain with no mail records). **Nothing is ever sent there.** Decide the domain and check on the real local stack (Docker needed) that Supabase accepts it: some Auth versions refuse addresses whose domain has no mail records. If it does, use a domain that has a null MX record (an intentional "no mail here" record) or a catch-all.
  - Add a `username` to the profile: unique, case-insensitive, 3 to 30 characters, lower-case letters, digits, dots, dashes and underscores; no spaces; a reserved list (`admin`, `support`, `learnthrive`, and so on). The server maps `username` to the internal address; the browser never sees it.
  - Sign-in takes **username and password**. Wrong username and wrong password give the **same** message and take the same time, so nobody can find out which usernames exist. Keep the existing lockout and rate limits, now keyed on the username and the network address.
  - Each account has a **linked real email** (for resets, notices and invoices) held on its record, separate from the internal username address. A child's points to the parent's. Make it required when an account is created, validate it, and let an admin correct it (an address change is audited).
- **3.2.2 Change every place that assumes email sign-in.** The account runtime (`apps/web/src/lib/account/supabaseAuth.ts` and the in-memory twin), the sign-in panel (`AccountAuthPanel.tsx`) and its labels, the `auth_user_by_email` / `auth_email` database functions the server uses, `linkLogin` (by email today), the invitation code, the development accounts (`lib/dev/accounts.ts`), seed data, and the roughly twenty Playwright specs that sign in through the form. Update `docs/AUTHENTICATION.md` and `docs/DEVELOPMENT_ACCOUNTS.md`.
- **3.2.3 Admin "create account" (server only).**
  - An ADMIN-only action (and the same logic as a script, 3.2.8) that calls the Supabase **Auth Admin API** with the secret service key (`SUPABASE_SERVICE_ROLE_KEY`, server only, never in the browser or a log) to create the user with a confirmed internal address, and sets the profile role on the server (`CLIENT`, `TUTOR`, `STUDENT`; `ADMIN` only through the controlled path in 3.2.7).
  - In **one transaction** link the new profile to its record: the tutor's `profile_id`, the client's `owner_profile_id`, or the learner's `learner_identities` row. Write an audit row holding ids and the action only, never a name.
  - A parent with several children: create the parent's client account first, then for each child the student record and the learner login linked to that client (a `client_students` link with `can_view_progress`). Check the parent sees **each child separately** (`/dashboard/children`, `/dashboard/progress/<child>`) and never another family's child.
- **3.2.4 Passwords.** The Supabase login address is internal and never mailed, so Supabase's own recovery email cannot be used. Our site does the emailing instead, through Resend:
  - The admin tool generates a **random temporary password** (at least 16 characters) and shows it **once** to the admin to hand over by a secure route; it is never stored, logged or put in chat.
  - The profile is flagged "must change password": the first sign-in goes straight to a change-password screen and nothing else works until it is done. The new password follows the rules (at least 12 characters, not on the leaked-password list when that check is available).
  - **Reset by email:** a person enters their **username**; whatever the answer, the page says "if that account exists, we have emailed its linked address" (so nobody can learn which usernames exist). The site emails a one-time link, valid for 30 minutes and single use, to the **linked real email** (a child's goes to their parent); the link opens a page to choose a new password (12 characters or more). Limit requests per username and per network address, and sign everyone out of other sessions on a successful reset. Build this as our own token flow (a hashed token stored with its expiry) or by asking Supabase's Admin API for a recovery link and sending it ourselves; do not rely on Supabase sending it.
  - **Reset by an admin (fallback):** an admin issues a new temporary password the same way as at creation, after confirming the person's identity (a call to the parent, for a child). Audited.
  - Parents and tutors can change their own password while signed in.
- **3.2.5 Shut public sign-up.** In production remove account creation from `/login`; make `/api/account/signup`, the learner sign-up and accept routes, and the email password-reset routes refuse with a friendly "ask us"; confirm Supabase sign-ups are off so a direct call to Supabase also fails. Retire the learner invitation flow in favour of 3.2.3.
- **3.2.6 Offboarding.** When a student leaves or a tutor stops: end the assignment, revoke the link, disable the login (Supabase ban) so it cannot sign in, and then purge (3.7).
- **3.2.7 Admins and tutor-admins.** The first admin is bootstrapped once by the script (3.2.8) because no screen can create one; promotion to `ADMIN` stays a controlled script (`promote-admin`, adapted to usernames), not a screen, by design (`docs/AUTHENTICATION.md`). The four launch staff accounts are in 3.2.8; tutor-admin behaviour is 3.11.
- **3.2.8 Creating the real accounts on the hosted project (Claude runs it, with approval at that moment).**
  - **Prerequisites, in order:** migrations pushed (4.3), the server role created (4.5), the dashboard settings applied (4.6), and 3.2.1–3.2.4 built and passing on the real stack.
  - **The accounts:** Alvi Hossain, Tahasin Hasan and Abdurrahman Mustafa as admin and tutor; Brian as admin only; then the families and children from the real list (9.3). Usernames agreed with each person first.
  - **How:** a script (`scripts/create-account.mjs`, in the style of `promote-admin.mjs` and `create-server-role.mjs`: dry run first, typed confirmation, an explicit `--host`, refuses a local or unexpected host) reads a list from a file outside the repository and writes the one-time temporary passwords to a **separate file outside the repository, chosen by the owner**, never to chat or the terminal log. Claude does not read, repeat or store the passwords; the owner hands each one over and the person must change it at first sign-in.
  - **Approval:** this writes to the hosted project, so Alvi confirms the dry run output (names, roles, usernames, host) before the real run, every time.
- **3.2.9 Tests.** Playwright: admin creates a family with two children and a tutor; each signs in with the temporary password, is forced to change it, and sees exactly the right things; a second family sees nothing of the first. Real-stack tests (Docker): the Admin API call works with the narrow server role and the secret key; a non-admin, a tutor and a parent cannot call the action; a duplicate username, a reserved name and an `ADMIN` role request are refused; Supabase's public sign-up endpoint fails; wrong-username and wrong-password responses are indistinguishable; the lockout works on the username.
- **Done when.** An admin can create a parent, two children and a tutor in the dashboard; each can sign in with a username and a temporary password and must change it; a forgotten password can be reset by a link sent to the linked email (a child's to the parent); public sign-up and the Supabase email flows are closed end to end; the cross-family tests pass; and the four staff accounts exist on the hosted project.

### 3.3 Backfill and migration tooling for real data (required before loading families)
- Write the dry-run tool the ledger says is missing: detect duplicate and missing guardian-student links in whatever source you are importing from (spreadsheet or TutorCruncher export), report them, and only then load. Never match people by name.
- Define the source of truth for current tutors, families, students, assignments and upcoming lessons, and who checks the loaded data.

### 3.4 Lesson reminders and invitation emails (optional for launch)
- Reminders are derived when a page renders and nothing is sent; there is no scheduler. Invitation links are shown once to the guardian rather than emailed. If you want emailed reminders or invitations, build a scheduled job and a delivery path through Resend, with approved wording and an unsubscribe/preferences rule. Otherwise state clearly in the onboarding guide that notifications are in-app only.

### 3.5 Staff-side learner suspension screen (optional)
- Store support exists; add an admin screen to suspend or revoke a learner login if you want staff, not only guardians, to do it.

### 3.6 Staff MFA (required or accepted risk per 0.5)
- The Supabase organisation members must use MFA (set in the dashboard, Phase 4). For the site's own admins MFA is not built; either build it or record the accepted risk and keep to few admins.

### 3.7 Purge tool for people who have left (required)

**Decision (0.4):** when a student or a tutor leaves, LearnThrive **purges their records**, apart from the exceptions confirmed in `LAWFUL_BASES.md`: financial records (kept for the period the accountant sets, usually 6 years), safeguarding records (kept separately, as Tahasin and the safeguarding policy require), and unsuccessful applications (6 or 12 months). Nothing like this exists: deleting a student today leaves the learner's `auth.users`/`profiles` row and any stored files behind.
- **3.7.1 Student purge.** An admin action that, after a typed confirmation, removes in one audited step: the student record and its links, the learner login (the profile and the Supabase Auth user), attendance, lesson reports and progress, notifications, any stored files, and their name from lesson records (or anonymises lesson rows that must remain for scheduling history). Keep the exceptions above, with the minimum identifying data they need. If the family has no other children, offer to purge the family record and the parent's login too.
- **3.7.2 Tutor purge.** Remove the tutor record and login, availability, and their name from lessons (anonymised where history must remain). Reports they wrote about students stay with the student's record until that student is purged. Keep what the tutor exceptions require.
- **3.7.3 Preview first.** Show exactly what will go and what will be kept and why before anything is deleted; deletion is final, so offer a delay (for example 30 days between "marked as left" and the purge) that the admin can shorten.
- **3.7.4 Backups.** A purge does not remove the record from Supabase backups until they age out. Say so in the privacy notice, and do not restore a backup without re-running purges that happened since.
- **3.7.5 A log without personal data.** Record that a purge happened (date, who, what kind), never who it was about.
- **3.7.6 Tests.** After a purge, a database query for the person's id and name finds nothing in any table or bucket except the listed exceptions; the person cannot sign in; a sibling and the family are untouched; the audit row exists; and a purge cannot be run by a non-admin.
- **Done when.** The tests pass and a rehearsal purge on staging leaves only the documented exceptions.

### 3.8 Observability (required to run it safely)
- Today: structured logs for the enquiry route and `/api/health`, nothing else. Add at least: uptime monitoring on `/api/health`, log retention and alerting on Render, and a decision on error reporting (0.6). The realtime service has no health monitoring either.

### 3.9 Reset-demo-data safety check (required)
- Confirm the admin "Reset demo data" button and `/api/dev/reset` cannot appear in production (they are `NODE_ENV`-guarded and the proxy 404s `/api/dev`); the production smoke suite must assert it.

### 3.10 Tuition payments with Stripe (required; the largest build item)

> **7 Nov 2026:** the charging model is now **monthly statements in arrears** (see 0.1 and [OWNER_ANSWERS_2026-11-07.md](OWNER_ANSWERS_2026-11-07.md) section 3), and the family payment method is **not confirmed**, so Stripe checkout, prepaid Checkout and subscriptions below may not be the right design. Build the decided parts first (rates, chargeable-lesson rules with per-child waivers, the sibling line, the statement, hiding amounts from tutors, overdue as a flag) and add collection when the method is chosen.
>
> **Built (7 Nov 2026, uncommitted):** all of those decided parts, as admin-only pages and a recorded-by-hand payment ledger, plus the named-approver refund action. See [TUITION_BILLING.md](TUITION_BILLING.md). Still to do: migration `0021` on the hosted database (owner), set `TUITION_REFUND_APPROVER_EMAILS`, the owners' open rules (repeat fee, allowance reset, second approver), collection once the payment method is chosen.

**Decision (0.1):** parents pay for lessons through Stripe. **What exists:** only the Library's subscription billing: a REST-over-`fetch` Stripe client (`apps/web/src/lib/billing/stripe.ts`), a webhook signature check (`signature.ts`), hosted Checkout in subscription mode, the hosted Customer Portal, mirroring of Stripe state into the database (`reconcile.ts`, migrations `0003` and `0006`), a fake Stripe for tests (`devStripe.ts`) and a test-mode/live-mode guard. The family `clients` row already owns the Stripe customer (`billing_customers`), and billing is already refused to learners and inside a supervised view. **What does not exist:** anything that prices, charges, invoices, refunds or reports a tuition lesson. Reuse the plumbing; the tuition rules are new.

- **3.10.1 Answer 0.1a–0.1h first.** Every step below depends on the charging model, rates, cancellation and refund rules, failed-payment policy, VAT and who pays the tutors. Do not write code until these are written down and the owners and accountant have agreed them.
- **3.10.2 Stripe tooling and account.**
  - The ledger records `stripe@claude-plugins-official` installed; its tools need a reload or restart, and the Stripe server needs **interactive OAuth (`/mcp`, choose the LearnThrive sandbox account)**. Authorise it yourself; do not give anyone live-mode access. Then run the plugin's `stripe_implementation_planner` before designing.
  - In the Stripe dashboard (owner): complete business verification, add the UK bank account for payouts, set the public business name, statement descriptor, support email and phone, and branding; turn on the card payment methods you chose (0.1g); keep sandbox and live strictly separate.
  - Create a **restricted API key** for the app with only the permissions it uses (rather than the full secret key), one for sandbox and one for live.
- **3.10.3 Write the design (short) in `docs/TUITION_PAYMENTS.md` and have it approved.** It states: the objects (customer, price, Checkout Session, Invoice, PaymentIntent, refund); the state machine for a charge (due, paid, failed, refunded, disputed, written off); when a lesson becomes chargeable and what happens on cancel, no-show and reschedule; what the guardian sees; what admin can override; failure and refund rules; tax; and what is logged. Money is stored as **integer pence** with currency `GBP`, never floats.
- **3.10.4 Data model (new migration, `0017` or next).**
  - Tables such as: a rate per assignment (amount, unit, effective dates), charges or invoices (family, student, assignment, the lessons covered, amounts, tax, status, Stripe ids, idempotency key), payments, refunds/credits (reason, actor), and a processed-webhook-events table for idempotency. Financial rows are **append-only history**; corrections are new rows.
  - Follow the repo's rules: a `comment on table` for each, RLS enabled and forced (server-only like `0011`), add the tables to `EXPECTED_TABLES` and `FORCED_TABLES` in `packages/data/src/schema.test.ts` and `PUBLIC_TABLES` in `apps/web/scripts/supabase-verify.mjs`, add a repository to the `DataProvider` with memory and SQL implementations held to one contract test, and **re-run `create-server-role.mjs`** after applying (a new table is unreachable by the site's role until you do).
- **3.10.5 Server logic.**
  - Create the Stripe object for the chosen model (Checkout in payment mode for prepaid lessons or packages; Invoices for monthly arrears; Subscriptions for a fixed monthly fee). Reuse the family's existing Stripe customer.
  - **Prices come from the server, never from the browser.** Look up the rate from the database each time; ignore any amount a client sends. Test this explicitly.
  - Send an idempotency key with every create call. Put only internal ids in Stripe metadata (no names, emails or notes about a child).
  - Enforce who may pay: an adult guardian only; never a learner, never inside a supervised view, never for another family.
- **3.10.6 Webhook.**
  - Reuse `POST /api/billing/webhook` or add a tuition path; verify the signature; handle each event idempotently by event id; read the current state back from Stripe rather than trusting event order (the Library does this).
  - Events to handle at least: `checkout.session.completed` and `checkout.session.async_payment_succeeded/failed`, `invoice.finalized/paid/payment_failed/voided`, `payment_intent.succeeded/payment_failed`, `charge.refunded`, `charge.dispute.created/closed`.
  - Refuse live events on a test key and the reverse (existing guard). The same endpoint must **not** open Library checkout when the Stripe keys are set: add a test.
- **3.10.7 Guardian screens.** A billing page: what is due, paid and refunded; links to Stripe's hosted invoices and receipts; "pay now"; card management via the Stripe Customer Portal. Show the price and the cancellation and refund terms **before** payment (plain English; owners and a solicitor approve the wording, as the Library's `consumer.ts` does). Accessible, mobile first. Hidden from learners.
- **3.10.8 Admin screens.** Set and change rates on assignments; see each family's balance and history; record a manual payment (bank transfer or cash) as an exception; issue a credit or refund **with a reason and an audit entry**; export for the accountant. Decide whether tutors see any amounts (default: no).
- **3.10.9 Lesson to charge rules.** Implement the rules from 0.1c: what is charged when a lesson is booked, attended, cancelled late or missed; make-up lessons; prepaid expiry; pro-rata for a mid-month start; rounding. Add tests that cross DST changes and the join window.
- **3.10.10 Failure and access policy.** Failed payment: Stripe retries plus reminder emails (Stripe's own or ours through Resend, with approved wording). Disputes and chargebacks: a written process and who handles them. **Recommended default:** never remove a child's access to lessons automatically; show a notice and let an admin decide.
- **3.10.11 Tax.** The accountant decides VAT treatment (0.1f). Turn on `STRIPE_AUTOMATIC_TAX` only if VAT-registered and Stripe Tax is set up. Invoices carry the company's legal name, number and registered office (`apps/web/src/lib/site.ts` holds LearnThrive Tuition Ltd, 16680738, England and Wales; the owner confirms them against Companies House).
- **3.10.12 Tests.**
  - Unit and contract tests on memory, PGlite and the real stack; the signed-webhook harness; duplicate, out-of-order and replayed events; refund and dispute flows.
  - Stripe sandbox with the **Stripe CLI**: `stripe listen --forward-to <your webhook url>` and `stripe trigger <event>`. Test cards: `4242 4242 4242 4242` (success), `4000 0025 0000 3155` (3D Secure required), `4000 0000 0000 9995` (declined for insufficient funds).
  - Security: family B cannot see, pay or refund family A's charge by guessing ids; a tampered amount is ignored; a learner and a supervised view are refused; a tutor sees no card or payment detail; no card data, key or webhook secret appears in logs or the browser bundle (`npm run check:bundle`).
  - Playwright end to end, with axe, for the guardian billing flow.
- **3.10.13 Invoice email on payment (decided 2 Nov 2026).** When a client's payment succeeds the system emails them an invoice. Send it to the **client's linked email**, from the verified Resend sender, with the invoice number, date, the lessons or period it covers, the amount, any tax, the company's name, number and registered office, and a link to the Stripe-hosted invoice or receipt (and a PDF if the accountant wants one). Decide whether Stripe sends it (turn on its customer emails and finalise a Stripe Invoice per payment) or our site sends it from the `invoice.paid` / `payment_intent.succeeded` webhook; sending our own gives control of the wording but must never fire twice for one payment (key it on the Stripe event or invoice id) and must not send on a failed or refunded payment (a refund gets its own credit-note email). Test with Stripe's test mode and a real inbox; a student's account never pays, so the invoice always goes to the parent. Keep the invoices for the period the accountant sets (this is one of the retention exceptions in `LAWFUL_BASES.md`).
- **3.10.13b Privacy and legal.**
- **3.10.14 Go-live gates (checked in 8.2).** Stripe account activated; live restricted key and live webhook signing secret set in Render only; the live webhook endpoint registered and returning 2xx; one real small payment and refund made by the **owner** on production with their own card; the statement descriptor and receipt email checked; the accountant has signed off; Stripe webhook-failure alerts turned on.
- **Done when.** A guardian can pay for a lesson in sandbox end to end; the charge, receipt, refund and a failed payment all show correctly to the guardian and the admin; the cross-family and tamper tests pass; and Library checkout is still closed with the Stripe keys set.

### 3.11 A tutor who is also an admin (required)

**Decision (0.5):** a tutor who also runs things can be an admin. **Today this does not work.** Each profile has one role. An `ADMIN` cannot join a classroom (`apps/web/src/lib/actions/classroom.ts` allows only `TUTOR` or `STUDENT`), cannot set availability (`requireRole(["TUTOR"])`), and the "not the tutor for this lesson" checks compare a `TUTOR`'s own id. Linking a login to a tutor record (`linkLogin`) only accepts a profile that is currently a plain `CLIENT`, and sets it to `TUTOR`, so promoting to `ADMIN` afterwards silently loses the tutor tools.

- **3.11.1 Model.** Keep `ADMIN` as the role and treat "is a tutor" as a capability derived from a linked tutor record (`tutors.profile_id = this profile`), not as a second role. Alternative: allow a set of roles per profile. Pick one and write it down in `docs/ROLE_PERMISSIONS.md` before coding.
- **3.11.2 Link without demoting.** An admin-run path (for example in the 3.2 screen) that links a tutor record to a profile that is an `ADMIN`, without changing the role, and still refuses a profile that already owns a family or a learner login.
- **3.11.3 Update every guard** that tests the role: the classroom join (and the join window, which differs for tutors), availability pages, the calendar's "can join" check, lesson visibility, notifications, search, navigation and shortcuts, report and attendance rules (an admin teaching a lesson acts as its tutor; an admin not teaching it acts as an admin), and the palette.
- **3.11.4 Tests.** A tutor-admin sees both the tutor tools and the admin screens; teaches and joins their own lesson; cannot act as the tutor of someone else's lesson (only as admin); an admin who is not a tutor still cannot join as one; a tutor who is not an admin gets no admin screen; add IDOR cases for each.
- **Launch accounts that need this:** **Alvi Hossain, Tahasin Hasan and Abdurrahman Mustafa** are each admin and tutor. **Brian** is admin only (he must not see tutor tools such as availability, and must not appear in tutor lists).
- **Done when.** The above tests pass, and real accounts of both kinds (admin and tutor, admin only) are exercised in staging (7.5).

### 3.12 Careers applications in the database, viewed by admins (required if you want them open at launch)

**Decision (2 Nov 2026):** careers becomes a **fully fledged application page** stored in Supabase, with admins reviewing applications after signing in. The page already exists as one scrolling form in eight numbered sections with a section list, a review panel and file uploads (`apps/web/src/components/careers/apply`); keep it and finish it. Applicants are not account holders, so they do **not** use usernames; they give a contact email. **Today** the form emails the application and its attachments (CV, cover letter, identity documents) to a mailbox and stores nothing (`docs/RETENTION_AND_DELETION.md`). The forms also stay closed until `agreementApprovedByOwner` is set.

- **3.12.1 Data model (new migration).** Tables for applications (the role applied for, the answers, a status such as new, reviewing, interview, accepted, rejected, withdrawn, timestamps), application files (stored in a **private Storage bucket**, with the size and type limits already in `careersConfig.limits`: 3 MB a file, 12 MB in all), a status history, and internal notes. RLS enabled and forced, server-only access like `0011`. Follow the repo's rules: a `comment on table` each, add to `EXPECTED_TABLES`/`FORCED_TABLES` in `schema.test.ts` and `PUBLIC_TABLES` in `supabase-verify.mjs`, re-run `create-server-role.mjs`, and add the bucket in the migration (as `0007` does) with no public policy.
- **3.12.2 Submission.** Keep what is already good: origin check, rate limits, honeypot, minimum time, the human check, file inspection and the agreement gate. Change the destination from an email with attachments to the database and the private bucket. Send the applicant a confirmation with **no attachments or copy of their answers**, and the admins a short "new application" notification with **no personal content**.
- **3.12.3 Admin screens (ADMIN only).** A list with filters and status; a detail page with the answers; files opened through a **short-lived signed link created on each click** (about 60 seconds), never a stored public URL; internal notes; a recorded decision; a DBS field that records only that the certificate or Update Service result was seen, by whom and on what date. Every view of an applicant's files is logged. Tutors and parents cannot see any of it.
- **3.12.4 DBS and identity wording.** The careers pages and the agreement say plainly that **tutors pay for their own DBS** (0.4). Prefer recording "identity seen" over keeping scans; delete scans once verified.
- **3.12.5 Retention and deletion.** Apply `RETENTION_AND_DELETION.md` (unsuccessful: up to 6 months after the decision, 12 if they agreed to be kept; identity documents 6 months) in the app: a deletion action for an application and its files, and a monthly report of what is due. A data subject's export and delete request is handled by an admin from the same screen.
- **3.12.6 Privacy.** Update `/careers/privacy` and `/privacy`: what is collected, why (see `LAWFUL_BASES.md`), who sees it, how long it is kept, and that files are stored securely in the UK-region project (London).
- **3.12.7 Agreement gate.** Review every clause with `ownerApproved: false` in `safeguarding-agreement-v1.ts`; set `agreementApprovedByOwner` only when approved. Until then the forms stay closed even though the system exists.
- **3.12.8 Tests.** Unit, PGlite and real-stack for the repository; Playwright for apply and the admin review; security tests that a parent, a tutor and an anonymous visitor cannot read an application or sign a file link, that links expire, and that a renamed file type is refused.
- **Done when.** A test application with a CV and an identity document appears for an admin, the files open only through expiring links, deleting it removes the rows and the files, and the log shows who looked.

### 3.13 Cloudflare SFU for classroom video, up to 10 students (BUILT 2 Nov 2026; waiting for the keys and a real-device test)

**Decision (0.6):** the classroom carries video through the Cloudflare SFU Alvi created, with TURN, for up to **10 students plus the tutor**. A peer-to-peer mesh cannot carry that (each person would upload ten copies), which is why the room limit used to be 1 tutor and 3 students.

**What is built.** Nothing here has run against the real Cloudflare service (there are no keys in the repo or this environment), so every item below is "implemented and tested against fakes", not "proved".
- **Server** (`apps/realtime/server/sfu.ts`, glue in `signalling.ts`): the browser never calls Cloudflare. It asks our server, over its authenticated Socket.IO connection, to make four calls (create session, publish or pull tracks, renegotiate, close). The server holds the app secret, checks the caller owns the session, checks a pulled track was published by someone **in the caller's own room**, rebuilds each request from only the allowed fields, runs one call at a time per session, rate limits each connection, and returns only the fields the browser needs. Shapes follow Cloudflare's OpenAPI schema (`https://rtc.live.cloudflare.com/v1/apps/{appId}/sessions/...`).
- **Rooms:** with `CLOUDFLARE_SFU_APP_ID` and `CLOUDFLARE_SFU_APP_SECRET` set a room holds **1 tutor and 10 students** (`SFU_MAX_STUDENTS`); without them it falls back to the old mesh with 3. The server tells each client which in `room:joined`, and prints which at start-up (a warning if it is the mesh).
- **Browser** (`apps/web/src/features/classroom/sfu.ts`, wired in `meeting.ts`): one send-only connection (camera and microphone, published once; a screen share swaps the video in place with no renegotiation, as the mesh did) and one receive-only connection that pulls everyone else's tracks. Serialised per session, with retry of a track that is not ready, rebuild of a failed connection (up to three times), a silent and a black placeholder track when a person has no camera or microphone (Cloudflare collects a track with no packets after 30 seconds), and a camera cap of 700 kbps (250 in Data Saver, none while sharing a screen).
- **Interface:** the participant count shows the real room size, and the gallery grows to 2, 3 or 4 columns for a full class and scrolls on small screens.
- **Tests:** 17 new server tests (parsing, the Cloudflare client's calls and error handling, the one-at-a-time queue, session ownership and rate limits, and a real Socket.IO room with a tutor and ten students, an eleventh refused, pull and publish rules, unpublishing on leave) and 12 browser-logic tests with a fake peer connection. The old mesh tests all pass unchanged. The classroom still opens and connects in the existing browser test.
- **Environment registry:** the four Cloudflare variables and `CLASSROOM_JOIN_SECRET` are now registered and **required in production** (`npm run check:env`).

**Alvi supplies (then it can be proved):** `CLOUDFLARE_SFU_APP_ID` and `CLOUDFLARE_SFU_APP_SECRET` (Cloudflare dashboard, Realtime, SFU, the app), `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` (Realtime, TURN: a different credential), and a long random `CLASSROOM_JOIN_SECRET`. Put them in the local `.env` to test and in Render's dashboard for production; never in the repository.

**Still to do (cannot be done without the keys and real devices):**
- **3.13.1 First real run.** With the keys in `.env`, start `npm run dev`, join a lesson as a tutor and as a student on two devices, and watch for video and audio both ways. Expect small fixes: this is the first contact with the real service. Read the server console (it names Cloudflare's status and code for any failed call, never the secret).
- **3.13.2 Eleven people.** A real test with a tutor and ten students on different networks, one on mobile data, one on Safari, for an hour; kill the server mid-lesson and check people recover on restart.
- **3.13.3 Relay.** Confirm TURN: join with `?forceTurn=1&debug=1`; the connection must still come up.
- **3.13.4 Cost.** Cloudflare bills what it sends (egress), at $0.05 a GB after the first 1,000 GB each month (shared with TURN); what students send up is free. Full video to a full class is the worst case: each of 11 people pulls 10 streams at about 0.7 Mbps, roughly 77 Mbps, about **35 GB an hour**, so about $1.75 for each such hour beyond the free allowance, and the free 1,000 GB covers roughly 28 of those hours a month. Typical lessons are far smaller. Set a billing alert in Cloudflare before launch. Pulling only the tiles a person can see, or lower-resolution copies, would cut this: not built.
- **3.13.5 Moderation.** The tutor's mute and stop-share are still requests the student's browser obeys (our servers never touch media). Real enforcement is possible because our server created each session and could close a student's published track through Cloudflare; not built. Decide whether it matters before large lessons.
- **3.13.6 Known limits.** Pulled tracks of someone who left are closed on Cloudflare's side but the receiving connection keeps an unused slot; a very long lesson with many rejoins should rebuild the receiving connection (it does so on failure, not on a schedule). Safari/iOS behaviour is untested.
- **Done when.** A lesson with a tutor and 10 students runs for an hour on real devices with usable video, working chat and whiteboard, a tutor who can mute and remove a student, and nothing recorded.

---

## Phase 4: Hosted Supabase (`learnthrive-prod`)

Every step here needs the owner present or approving. Nothing has ever been pushed to this project.

### 4.1 Choose staging vs production order
- If you chose a staging project (0.6), do all of Phase 4 and 5–8 on **staging first** (with `ALLOWED_ORIGINS` and Redirect URLs for the staging host only), then repeat on production.

### 4.2 Link and dry run
- `npx supabase link --project-ref vwsjvdpkgjhwmqmufmrh`; the CLI asks for the database password, which the owner types (or sets `SUPABASE_DB_PASSWORD` for that shell only).
- `npx supabase db push --dry-run`. It must list **all sixteen migrations** (`0001`–`0016`; older docs say nine). **Stop and show the owner.**

### 4.3 Push
- On approval: `npx supabase db push`. Confirm the migration history lists all sixteen and the buckets `library` and `chat-uploads` exist and are private.

### 4.4 Advisors
- Run the Security and Performance advisors (dashboard → Database → Advisors). Resolve **every security warning** in a new migration (not in the dashboard). Record the result.

### 4.5 Create the narrow database role
- The owner generates a password: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
- In one shell session: `DATABASE_ADMIN_URL=... LEARNTHRIVE_SERVER_PASSWORD=... node apps/web/scripts/create-server-role.mjs --host <db host>` and type the confirmation. **Re-run after any migration that adds a table.**
- Note: a password change takes 10–16 s to reach the pooler; failed bursts trip a 1-minute circuit breaker.

### 4.6 Apply every dashboard setting
- Work through `docs/SUPABASE_DASHBOARD_CHECKLIST.md` section by section and tick each row (Authentication, Data API, Storage, Database, API keys, Billing/spend cap/organisation). The ones that matter most for tuition:
  - **Site URL** = `https://www.learnthrivetuition.co.uk` exactly; **Redirect URLs** only `.../account/confirm` and `.../account/reset`, no wildcards.
  - **Sign-ups: OFF, permanently** (0.2). Accounts are created by an admin through the Auth Admin API (3.2).
  - **Anonymous sign-ins off; only the email provider on** (it is what username sign-in uses underneath); password minimum 12, leaked-password protection on. "Confirm email" is moot because the Admin API creates users already confirmed.
  - **Email templates and custom SMTP are now optional.** With username sign-in nothing is ever sent to an account's internal address, so no confirmation or recovery email is used. Leave the templates as they are and set up custom SMTP only if you later add real-email features. Do not paste the old confirmation and recovery templates; they build links to pages that are shut.
  - **Site URL** is still `https://www.learnthrivetuition.co.uk` and the redirect URLs stay exact with no wildcard (a wrong value breaks any link Supabase builds).
  - **JWT 3600 s; refresh-token rotation on; session time-box 30 days; inactivity 7 days.**
  - **Data API: stays ON** (decided), `public` only; GraphQL off; exposed schemas never `private`, `auth`, `storage`.
  - **API keys:** publishable → `SUPABASE_ANON_KEY`, secret → `SUPABASE_SERVICE_ROLE_KEY`; disable the legacy keys once the new ones are proven.
  - **Backups daily, PITR per 0.6, SSL enforcement on, network restrictions to Render's outbound addresses if the plan allows, spend cap on, organisation MFA required, DPA accepted and filed.**

### 4.7 Run the read-only probes
- `SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run supabase:verify --workspace=apps/web` (add `-- --expect-signup closed`: sign-ups stay off). **No FAIL.**

### 4.8 Smoke test the whole auth round trip on the hosted project
- `SMOKE_EMAIL=you+smoke@<your domain> npm run supabase:smoke --workspace=apps/web -- --host <api host> --mailbox prompt`. It creates and removes one test account and proves the emailed link points at the right host.

### 4.9 First administrator
- With sign-ups off nobody can sign up to become the first admin, and the dashboard's "Add user" needs a real email. The **first admin is created by the account script (3.2.8)**, run once with the owner's approval against the hosted project, then promoted with `DATABASE_URL=... npm run db:promote-admin --workspace=apps/web -- --username <name> --host <db host>` (adapted to usernames in 3.2.2). Every later account comes from the admin screen (3.2); no screen promotes anyone to admin, by design.

### 4.10 Record and rehearse recovery
- Read `docs/SUPABASE_RUNBOOK.md`: credential rotation, restore from backup (then re-run the role script and update `DATABASE_URL`), suspending a user, suspected key leak. Do one restore rehearsal on staging.

**Phase 4 done when:** probes show no FAIL, the smoke test passes, advisors are clean, and a first admin exists.

---

## Phase 5: Domain and email

### 5.1 Resend
- Verify the sending domain; copy the SPF/DKIM records; set `RESEND_FROM_EMAIL` to an address on it (the shared `onboarding@resend.dev` sender is never used in production). Create two API keys: one for the site (`RESEND_API_KEY`), one for Supabase Auth SMTP.

### 5.2 DNS records
- IONOS holds the domain and its DNS. **Keep every existing mail record** (the MX records and SPF/DKIM of whoever hosts your company mailboxes: confirm who, probably Google Workspace). A domain may have only **one SPF record**, so merge Resend's `include:` into the existing one rather than adding a second. Add Resend's DKIM records as given. Add DMARC at `p=none` with a report address; tighten later. Because the same domain sends mail from two providers, test both after the change.
- Point `www` and the apex at Render (apex redirects to `www`, 308). Lower the TTL a day or more before the cutover.

### 5.3 Test deliverability on staging
- Submit a real enquiry: the notification reaches `ENQUIRY_EMAIL` with Reply-To set to the parent, and the parent's auto-reply arrives. Check spam, and read them in Gmail, Outlook, Apple Mail and on a phone. (Accounts send no email, because people sign in with usernames.)

### 5.4 Mailboxes
- Decide who watches `info@` and the careers/subject-request mail, the mailbox size/filters, the retention routine, and the promise in the auto-reply (five working days).

---

## Phase 6: Render service and environment

### 6.1 Create the service
- Web Service (Node), root = repo root, **paid instance** (free tier cold-starts), health check `/api/health`, Node 22.
- Build: `npm ci && npm run build` (builds classroom + web). Start: `npm run serve --workspace=apps/web` (the unified server, 3.1). **One instance only.**
- The build needs outbound network once for fonts.

### 6.2 Environment variables (names only; values in the dashboard)
- **Core:** `NODE_ENV=production`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_PORTAL_ENABLED=true` (**build-time**: changing it needs a rebuild).
- **Email:** `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ENQUIRY_EMAIL`, and optionally `CAREERS_EMAIL`, `SUBJECT_REQUEST_EMAIL`, `CAPTCHA_SECRET` (64 hex characters: `openssl rand -hex 32`).
- **Accounts and data:** `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable), `SUPABASE_SERVICE_ROLE_KEY` (secret), `DATABASE_URL` (pooler, port 6543, user `learnthrive_server.<ref>`, never `postgres`).
- **Classroom:** `CLASSROOM_JOIN_SECRET` (long random, never defaulted), `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` (server-only; no `NEXT_PUBLIC_TURN_*` in production), and the service's `PORT`.
- **Payments (task 3.10):** `STRIPE_SECRET_KEY` (a restricted key, live only after 8.2), `STRIPE_WEBHOOK_SECRET`, the tuition price ids or settings the design needs, `STRIPE_AUTOMATIC_TAX` only if the accountant says so, and `NEXT_PUBLIC_SITE_URL` (Stripe sends people back to it). Never `STRIPE_FAKE`.
- **Learners:** `LEARNER_INVITE_HOURS`, `LEARNER_INVITES_PER_DAY`, `LEARNER_DIRECT_MIN_YEAR` per 0.3.
- **Rate limits:** `CLIENT_IP_HEADER` or `TRUSTED_PROXY_HOPS` after the probe in 7.4.
- Keep the "OFF at launch" list above unset.

### 6.3 Validate the environment without printing it
- Run `npm run check:env --workspace=apps/web -- --env production` in a shell that has the production variables. It reports each as present, missing, malformed or forbidden, and rejects `postgres`, a direct or local database address, and a wrong key kind. Fix everything it flags.

### 6.4 Add the host protections
- A firewall/rate-limit rule at Render or your CDN on `POST /api/enquiry` (for example 5 per 10 minutes per IP) and on the sign-in/sign-up routes. The app's own limiter is per instance.
- Preview deployments: set variables for Preview too, but never point a preview at the production database.

---

## Phase 7: Staging soak

Run on the staging deployment (or the production service with the portal still closed).

### 7.1 Automated suites
- `PROD_BASE_URL=<staging> npm run test:prod-smoke --workspace=apps/web` (`PW_CROSS_BROWSER=1` for Firefox, WebKit and iPhone profiles). Then the full Playwright suite (`npm run test:e2e --workspace=apps/web`, about 45 minutes) against a dev stack with the same code; record failures. Known stale specs: eight e2e specs need updating (see the task chip raised earlier).

### 7.2 Public site
- Every public route returns 200 with an `<h1>`; unknown URL shows the branded 404; the apex redirects to `www`; `robots.txt`, `sitemap.xml`, `/.well-known/security.txt`, `manifest.webmanifest`, `/api/health` respond; CSP/HSTS/COOP present; no console or CSP violations; no cookie set by public pages; no third-party requests.
- Social preview cards for the home page and one subject page.

### 7.3 Accessibility and devices
- axe suites (light and dark) pass; keyboard-only and 200% zoom suites pass; a **manual screen-reader pass** (NVDA on Windows, VoiceOver on Mac/iPhone) of sign-in, dashboard, a lesson and the classroom controls; 360 px reflow.
- Real **iPhone and Mac Safari** pass for smooth scroll, View Transitions, WebGL, `backdrop-filter` and the classroom (untested in all docs). Lighthouse on mobile and desktop for the main routes; record budgets.

### 7.4 Rate-limit and upload probes
- The forged `X-Forwarded-For` probe against `/api/careers/challenge` (expect 40 `200`s then `429`s) and the upload-size probe against `/api/careers/apply` from `RENDER.md`; set `CLIENT_IP_HEADER`/`TRUSTED_PROXY_HOPS` and lower upload limits if needed.

### 7.5 Each role end to end (use fresh test accounts, never real families)
- **Admin:** create a tutor, a client, a student, an assignment; link the tutor login; create, reschedule and cancel a lesson; change the report-approval setting; check the activity feed and settings; end an assignment.
- **Tutor:** set availability; see only assigned students; run a lesson in the classroom; record attendance; submit a report; see a notification.
- **Guardian:** the admin creates the account; the parent signs in with a username and a temporary password and must change it; sees each child separately, with lessons, progress and approved reports (never internal tutor notes: there is a "CONFIDENTIAL" test for this); uses the supervised view for a young child and leaves it (needs the guardian's password); a parent with two enrolled children sees each one's lessons and reports separately and never a sibling's from the wrong child's page; an admin reset of a forgotten password works and the old password stops working.
- **Learner:** the admin creates the account, linked to the parent; the child signs in with a username and a temporary password and must change it; sees only their own record and lessons; joins a lesson; blocked from the family account, billing and other siblings.
- **Cross-family attack tests:** a second family and a second tutor cannot open the first one's lessons, reports, students, attendance or classroom by URL or Server Action id.

### 7.6 Lesson mechanics
- Time zones and daylight saving: a recurring lesson crossing the clock change; a join window that opens and closes at the right time; a late/early join; an ended class returning to the lesson page; attendance gating the report; report approval gating visibility.

### 7.7 Classroom with real devices
- Two devices on different networks (one on mobile data), camera/microphone permissions, screen share, whiteboard, chat, reconnect after a drop, tutor moderation (mute/stop-share), 4-person maximum, server restart behaviour, the Cloudflare TURN relay with `?forceTurn=1` (diagnostics must read **Relay (TURN)**), `/api/turn-credentials` answering 200 with `iceServers`.

### 7.8 Switch audit
- With the portal flag on and the "OFF at launch" variables unset: `/library/ai` and `/api/assistant/*` answer closed; `/library` and `/pricing` stay "coming soon"; `/api/billing/*` offers no checkout; `/dev/**` and `/api/dev/**` are 404; `/api/auth/**` (development provider) is 404 or refuses; no dev account can sign in; the development "Dev accounts" hints are absent from `/login`.

### 7.9 Resilience
- Restart the service mid-session: sessions survive (stored in Supabase), no demo data appears, the classroom reconnects gracefully. Kill the database connection: pages show a friendly error, not a stack trace. Confirm `error.tsx`/`global-error.tsx` render.

### 7.10 Privacy/legal sign-off
- Cookie notice and privacy page describe exactly what the portal sets (session cookies for sign-in; the supervised-view cookie; theme in local storage); the owner and a legal reviewer have signed `LEGAL_REVIEW.md`; HSTS `preload` stays off unless you confirm permanent HTTPS.

### 7.11 Payments in the sandbox (staging uses Stripe test mode only)
- Pay with the three test cards (success, 3D Secure, decline); check the receipt email, the guardian billing page, the admin balance and the database rows agree to the penny.
- Replay and duplicate a webhook with the Stripe CLI; refund in the dashboard and in the app; trigger a dispute; confirm each shows correctly and nothing is double-counted.
- A second family, a learner, a supervised view and a tutor each fail to see or pay another family's charge.
- Confirm the staging site refuses a live Stripe key and the production site refuses a test key.
- Confirm Library checkout is still closed with the Stripe keys set.

**Phase 7 done when:** every list above is ticked with evidence and no open "must fix" remains.

---

## Phase 8: Go-live sequence

Launch in two steps so the riskier part opens last.

### 8.1 Step one: public site live, portal closed
- Deploy with `NEXT_PUBLIC_APP_PORTAL_ENABLED` **unset**. Everything public works; `/login` and `/dashboard` show "Portal opening soon". This is the already-verified state in `DEPLOYMENT.md`.
- Cutover: lower TTL (5.2), add the custom domain in Render, wait for the TLS certificate, switch DNS, keep the old site's DNS values for rollback, re-run the smoke suite against the live URL (`PROD_BASE_URL`), send one real enquiry, and look at the live headers/cookies/requests (RENDER.md "After every deploy").
- Submit the sitemap in Search Console; add the uptime monitor; record results in `LEGAL_REVIEW.md` ("What was checked after deployment").

### 8.2 Step two: open the portal
- Preconditions: Phases 2–7 done, the first admin exists, staff accounts created and linked, and real data loaded per Phase 9 (or a deliberately empty start).
- Rebuild/redeploy with `NEXT_PUBLIC_APP_PORTAL_ENABLED=true` (it is build-time). Sign-ups **stay off**; re-run `supabase:verify -- --expect-signup closed`. The first real accounts are created by an admin (3.2).
- **Payments go live in this step, not before.** Complete the 3.10.14 gates: swap in the live restricted key and live webhook secret in Render, register the live webhook endpoint, make one real small payment and refund with the owner's own card, check the statement descriptor and receipt, and turn on Stripe's webhook-failure alerts. Until then keep Stripe in test mode and tell families fees are invoiced outside the site.
- Immediately: run the smoke suite, sign in as the real admin, run a throwaway test lesson through the classroom, and confirm the 7.8 switch audit again on the live URL.

### 8.3 Rollback plan (have it written before step two)
- Fast: redeploy the previous successful Render deploy, or rebuild with the portal flag unset (the portal closes at once; data is untouched). Remove `RESEND_API_KEY` to stop every form. Sign-ups are already off; to lock every family out at once, rebuild with the portal flag unset.
- Database: restore from a backup or PITR per the runbook, then re-run `create-server-role.mjs` and update `DATABASE_URL`.
- Decide in advance who decides to roll back and who tells families.

---

## Phase 9: Real data and onboarding

### 9.1 Retire or redirect the old marketing site
- The standalone marketing repo (`D:\LearnThrive`) and this monorepo both contain the public site. Decide which serves the domain. If the monorepo replaces it, port nothing twice, redirect old URLs with 308s (list them first), then archive the old deployment after a quiet period. The old site's TutorCruncher login link was removed on purpose; decide where tutors and families sign in from now on.

### 9.2 Load staff
- An admin (or the script, 3.2.8) creates each person's record and account: **Alvi, Tahasin and Abdurrahman as admin and tutor, Brian as admin only** (3.11), then any other tutors. Each signs in with a username and a temporary password handed over securely and changes it at once. Check each tutor sees only their own students, and that Brian has no tutor tools. Remove or disable any test staff.

### 9.3 Load families
- Run the dry-run tool (3.3) on the real source; fix duplicates and missing links; load in a small batch (one family, then five); verify each family's view with them on a call before the next batch.
- Explain to each family how and when they will be charged, what the cancellation and refund terms are, and where to see receipts, before their first charge.
- Give each family a short guide: how to sign in with their username and temporary password and change it, what to do if they forget it (ask us: an admin issues a new one), find their child's lessons, join a class, and who to contact. State clearly that payments and (if 3.4 is skipped) reminders happen outside the site.

### 9.4 Create learner accounts
- An admin creates each child's account, linked to the parent's, under the age rule from 0.3; for the youngest children use the supervised view. Parents agree to the child having an account in the enrolment terms (from Tahasin).

### 9.5 Dress rehearsal
- Run one real lesson with a tutor and a willing family in the live classroom before opening to everyone.

---

## Phase 10: Run it

### 10.1 First week
- Watch the logs and the `info@` mailbox daily; check Supabase usage, auth errors and the pooler; watch `/api/health`; record every incident. Triage any "I cannot see my child's lesson" report by checking the linking path (3.2) first.

### 10.2 Routine
- After any migration that adds a table: re-run `create-server-role.mjs` (the site's role cannot reach a new table until you do).
- Rotate credentials on the schedule in `SUPABASE_RUNBOOK.md`; review organisation members and remove leavers the same day; review admin accounts monthly.
- Apply retention: delete or archive per `RETENTION_AND_DELETION.md`; keep the safeguarding agreement and reconfirmation emails for the agreed period.
- **Payments:** reconcile Stripe payouts against the app's records monthly with the accountant; review failed payments, refunds and disputes weekly in the first month; respond to disputes inside Stripe's deadline; rotate the Stripe restricted key and webhook secret on the same schedule as other credentials; keep Stripe's dashboard users named, with MFA.
- Dependency updates and `npm audit` monthly; re-run the full suites before each deploy.

### 10.3 Review after 30 days
- What broke, what families asked for most, the real response time on `info@`, classroom call quality, and whether to build the optional items (reminders, staff MFA, learner suspension screen) or open the Library and LearnThrive AI (their own gates apply).

---

## Quick status board

| Phase | What it proves | Status |
| --- | --- | --- |
| 0 Decisions | Everything only the owners can answer | open |
| 1 Repo | Clean `main`, CI green on GitHub, bundle check | open |
| 2 Real stack | Tuition tables and identity work on real Supabase | open (Docker blocked) |
| 3 Build gaps | Classroom served, onboarding path, backfill tool | open |
| 3.10 Tuition payments | Stripe sandbox flow, refunds, tamper and cross-family tests | open (product rules unanswered) |
| 3.1 Classroom server | `serve.mjs` runs site, signalling and TURN endpoint on one origin | built and proven locally; not yet on Render |
| 3.2 Username sign-in and admin-created accounts | Create parent, children and tutor; sign in by username; sign-up closed end to end | open |
| 3.11 Tutor-admin | A tutor who is also an admin can teach and admin | open |
| 3.12 Careers in Supabase | Applications stored, admins review, files via expiring links | open |
| 3.13 Cloudflare SFU, 10 students | An hour-long lesson with 11 people on real devices | built and tested against fakes; needs the keys and a real-device test |
| 3.7 Purge tool | A purged person leaves only the documented exceptions | open |
| 4 Hosted Supabase | Project migrated, configured, smoke-tested, first admin | open |
| 5 Domain and email | Deliverable mail, DNS ready | open |
| 6 Render | Service running with a validated environment | open |
| 7 Staging soak | Every role, device, switch and probe checked | open |
| 8 Go-live | Public first, then portal; rollback ready | open |
| 9 Data | Staff, families, learners loaded and verified | open |
| 10 Run | Monitoring, routines, 30-day review | open |
