# Brian's launch steps: from `main` to families signing in, without Stripe

Written 15 November 2026 for Brian. Everything here is the hosting, database, email and sign-off work that is left. The code is finished and merged to `main` (commit `3fb69c2` or later); nothing below needs a code change. Parents pay by **bank transfer**, so there are no Stripe keys, no webhooks and no payment-provider account to set up.

The detail behind each step is in `docs/LAUNCH_CHECKLIST.md` (the task numbers in brackets) and `docs/RENDER.md`, `docs/SUPABASE_RUNBOOK.md`. If this file and those ever disagree, say so to Alvi before acting.

## Rules that apply to every step

- **Never commit a secret or an `.env*` file.** Values live in Render's dashboard, and in one shell session for the operator scripts. Never paste a key, password or connection string into a chat, an issue or a commit.
- **Nothing is written to the hosted Supabase project without Alvi's explicit go-ahead for that step.** Every step marked **STOP: show Alvi** needs it.
- **A failing check is information. Do not skip or weaken it.** If the same thing fails twice, stop and write down exactly what you saw.
- **No real person's data goes in** until the test data is cleared (Part 7). Until then use throwaway accounts.
- Use **PowerShell with `npm.cmd`** for the Supabase commands that take flags (a plain `npm` can lose the `--` flags and an open sign-up would pass).

## What "done" looks like

| Gate | Meaning | Part |
| --- | --- | --- |
| **A** | A test service is running on Render's own address, with a clean environment check and the smoke tests passing | 1 to 4 |
| **B** | The public site is live on `www.learnthrivetuition.co.uk`, portal closed ("Portal opening soon") | 5 and 6 |
| **C** | Families and tutors can sign in | 7 |

---

## Part 0: Before you start

- [ ] A clean checkout of `main` at `3fb69c2` or newer: `git clone https://github.com/AlviHossain97/LearnThriveSoftware.git` (GitHub says the repository moved to `LearnThrive/LearnThriveSoftware`; use whichever address works, see step 2.3).
- [ ] Node 22 and `npm ci` done.
- [ ] Run the whole gate once, so you know the starting point: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. All four must pass. (Lint shows 9 old warnings and no errors: that is normal.)
- [ ] You can sign in to: Supabase (project `learnthrive-prod`, ref `vwsjvdpkgjhwmqmufmrh`), Render, Resend, Cloudflare, IONOS (DNS) and GitHub, or you know who can.
- [ ] A password manager open, for every value you generate below.

---

## Part 1: The hosted database (`learnthrive-prod`)

**Why first:** the app now reads `profile_roles` (roles per person) and `clients.payment_reference` (the parent payment reference). Against a database without migrations `0022` to `0027`, account lookup and the parent Fees page fail.

The project holds `0001` to `0021` today. These add: `0022` safeguarding, `0023` corrections, `0024` billing terms, `0025` roles, `0026` payment reference, `0027` lesson chat tables (the chat itself stays **closed** in production, so these tables stay empty; they are applied so the schema matches the code and the verify probes pass).

- [ ] **1.1 Link.** `npx supabase link --project-ref vwsjvdpkgjhwmqmufmrh` (it asks for the database password, which you type, or set `SUPABASE_DB_PASSWORD` for that shell only). (4.2)
- [ ] **1.2 Look first (read only).** `npx supabase migration list`. Expect `0001` to `0021` on the remote side. **If anything else is there, stop:** someone changed the project and that has to be understood first.
- [ ] **1.3 Dry run.** `npx supabase db push --dry-run`. It must list exactly `0022` to `0027` and nothing else.
- [ ] **STOP: show Alvi the dry-run output and get a yes.**
- [ ] **1.4 Push.** `npx supabase db push`. Then `npx supabase migration list` shows `0001` to `0027` on both sides, and the dry run says "up to date". (4.3)
- [ ] **1.5 Re-run the narrow database role.** The role script only grants the tables that exist when it runs, and `0025` adds a function it must be allowed to call. In one shell session:
  `DATABASE_ADMIN_URL=... LEARNTHRIVE_SERVER_PASSWORD=... node apps/web/scripts/create-server-role.mjs --host <db host>` and type the confirmation. Use the **same** role password as before (it is in the password manager and in `DATABASE_URL`). (4.5)
- [ ] **1.6 Wait about two minutes** before anything connects as `learnthrive_server`. The pooler refuses the role for a minute or two after the script, and failed attempts trip a one-minute breaker.
- [ ] **1.7 Probes.** `SUPABASE_URL=... SUPABASE_ANON_KEY=... npm.cmd run supabase:verify --workspace=apps/web -- --expect-signup closed`. Look for `PASS signup sign-up is closed`, and **no FAIL**. (4.7)
- [ ] **1.8 Smoke test.** `SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... DATABASE_URL=... npm run supabase:smoke --workspace=apps/web -- --host vwsjvdpkgjhwmqmufmrh.supabase.co`, type the host when asked. All steps must print PASS (it was 11 of 11 before). `DATABASE_URL` must end `?sslmode=require`. (4.8)
- [ ] **1.9 Advisors.** Dashboard, Database, Advisors, Security and Performance. Expect only what was accepted on 8 Nov (one WARN on `request_chat_deletion`, 32 INFO, 9 performance WARN). **Anything new: show Alvi.** (4.4)
- [ ] **1.10 Record the results** (Part 9 evidence table), and update `docs/LAUNCH_CHECKLIST.md` task 4 if Alvi asks.

Do **not** run a restore, delete anything, or change dashboard settings in this part.

---

## Part 2: The Render service

- [ ] **2.1 Create the web service** (Gate A1, 6.1): type Web Service (Node), the repository connected, **a paid instance** (a free one cold-starts), **one instance only** (classroom rooms are in memory), Node 22, repository root.
  - Build command: `npm ci --include=dev && npm run build` (Render sets `NODE_ENV=production`, which would otherwise skip the build tools; the root build also typechecks the realtime code).
  - Start command: `npm run serve --workspace=apps/web`
  - Health check path: `/api/health`
  - Note the region, and tell Alvi so the privacy page's supplier list can name Render.
  - *Note:* `RENDER.md` still says `npm run build --workspace=apps/web` for the build. Use the command above and tell Alvi so the document can be fixed.
- [ ] **2.2 Set the environment (2.5 below) before the first deploy,** because several values are read at build time and a build without them has to be redone.
- [ ] **2.3 Repository address (A3).** Connect Render to whichever address GitHub currently serves. If `origin` still names `AlviHossain97/...` and GitHub redirects to `LearnThrive/...`, run `git remote set-url origin <new address>` locally. Then in GitHub, protect `main` with the `verify` job required (Settings, Branches). (1.2)

### 2.4 Generate the two secrets

On any machine: `openssl rand -hex 32`, twice. One is `CAPTCHA_SECRET`, one is `CLASSROOM_JOIN_SECRET`. Never reuse a development value. Put both in the password manager.

### 2.5 Environment (Render dashboard, Environment tab)

**Set these** (Gate A8, 6.2):

| Variable | Value / where it comes from |
| --- | --- |
| `RESEND_API_KEY` | Resend, the site's own key (Part 4) |
| `RESEND_FROM_EMAIL` | an address on the verified Resend domain (never `onboarding@resend.dev`) |
| `ENQUIRY_EMAIL` | `info@learnthrivetuition.co.uk`, once Alvi confirms who watches it |
| `CAPTCHA_SECRET`, `CLASSROOM_JOIN_SECRET` | the two you generated |
| `SUPABASE_URL` | `https://vwsjvdpkgjhwmqmufmrh.supabase.co` |
| `SUPABASE_ANON_KEY` | the publishable key (dashboard, API keys) |
| `SUPABASE_SERVICE_ROLE_KEY` | the secret key (dashboard, API keys) |
| `DATABASE_URL` | the pooler, port **6543**, user `learnthrive_server.vwsjvdpkgjhwmqmufmrh`, the role password from step 1.5, ending **`?sslmode=require`** |
| `CLOUDFLARE_SFU_APP_ID`, `CLOUDFLARE_SFU_APP_SECRET`, `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` | from Alvi (Cloudflare). All four are required in production even with the portal closed |
| `NEXT_PUBLIC_SITE_URL`, `ALLOWED_ORIGINS` | the test service's `https://...onrender.com` address while testing, then the real domain at the cutover. `NEXT_PUBLIC_*` is read **at build time**: changing it needs a rebuild |
| `TUITION_REFUND_APPROVER_EMAILS` | **Tahasin's linked email only** (he alone approves refunds; unset means nobody can) |
| `SAFEGUARDING_LEAD_EMAILS` | the linked emails of Tahasin and Abdurrahman (the only people who can read a safeguarding concern; unset keeps the concern form closed) |

**Leave these UNSET** (confirm again after every deploy, 7.8):

- Everything Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, `STRIPE_FAKE`. **No Stripe at launch.**
- `BANK_PAYEE_NAME`, `BANK_ACCOUNT_NUMBER`, `BANK_SORT_CODE`, `BANK_NAME`: the bank details are built into the site. Set all four **only** if the account ever changes and you want to change it without a deploy (all four or none: a partial set stops the server starting).
- `LESSON_CHAT_ENABLED`, `LESSON_FILE_URL_SECRET`, `CLASSROOM_WEB_URL`: the lesson chat is stored in the database and is open whenever the database is set up. `LESSON_CHAT_ENABLED=false` switches it off; `LESSON_FILE_URL_SECRET` (32+ characters) is optional (a key is derived from `CLASSROOM_JOIN_SECRET` without it); `CLASSROOM_WEB_URL` is only for a classroom server run apart from the website. Apply migrations 0029 and 0030 first.
- `ASSISTANT_*`, `OLLAMA_API_KEY`, `VOICE_*`, `LIBRARY_*`, `CAREERS_OPEN_FOR_TESTING`, `NEXT_PUBLIC_MOTION_DEBUG`.
- `NEXT_PUBLIC_APP_PORTAL_ENABLED`: leave unset until Gate C (Part 7). Unset means sign-in shows "Portal opening soon".

- [ ] **2.6 Check the environment.** In a shell with the same values: `npm run check:env --workspace=apps/web -- --env production`. Done when there is no `MISSING`, `MALFORMED` or `FORBIDDEN`. `HELD` lines are correct. (A9, 6.3)
- [ ] **2.7 Supabase URLs while testing (A10).** Dashboard, Authentication, URL Configuration: Site URL = the test service address, and the two redirect URLs `.../account/confirm` and `.../account/reset` exactly (no wildcards). Put them back to the real domain at the cutover (6.2).

---

## Part 3: Prove the running service (Gate A)

- [ ] `https://<service>/api/health` and `/api/health/ready` both answer 200 (A11).
- [ ] The classroom WebSocket works through Render's proxy, and `/api/turn-credentials` returns `iceServers`.
- [ ] The production smoke suite passes against the service: `PROD_BASE_URL=https://<service> npm run test:prod-smoke --workspace=apps/web`.
- [ ] The two address probes in `docs/RENDER.md` (the careers upload-size probe and the forged `X-Forwarded-For` probe). Set `CLIENT_IP_HEADER` or `TRUSTED_PROXY_HOPS` from the result, as that document says.
- [ ] **Host protections (A12):** a rate rule at Render or a CDN on `POST /api/enquiry` and the sign-in routes; preview deployments never pointed at the production database.
- [ ] **Monitoring (A13):** an uptime monitor on `/api/health/ready`, the alerts listed in `docs/OBSERVABILITY.md`, and a decision (ask Alvi) on log retention. A log store is a new supplier for the privacy page.
- [ ] **Cloudflare billing alert** set (3.13.4).

**Gate A is met when:** the service is up on its `onrender.com` address, `check:env` is clean, the smoke suite passes against it, a test enquiry arrives at `info@`, and the monitor is watching it.

---

## Part 4: Email (needed before the test enquiry works)

- [ ] **Resend (A4, 5.1):** create the account, verify the sending domain, copy the SPF and DKIM records, create **one** API key for the site (`RESEND_API_KEY`).
- [ ] **Mailboxes (A5, 5.4):** confirm `info@learnthrivetuition.co.uk` exists, who watches it, and that `security.txt`'s address is monitored.
- [ ] **DNS in IONOS (B1, 5.2):** merge Resend's `include:` into the **one** existing SPF record (keep Google Workspace's MX and SPF), add Resend's DKIM, add DMARC at `p=none`. Lower the TTL a day or more before the cutover. Keep the old values written down for rollback. Test mail both ways.
- [ ] **Deliverability (B2, 5.3):** a real enquiry reaches `info@` with Reply-To set to the parent, the auto-reply arrives, and both read well in Gmail, Outlook, Apple Mail and on a phone.

---

## Part 5: Sign-offs only the owners can give

You chase these; you do not decide them.

| # | What | Who | Where |
| --- | --- | --- | --- |
| 5.1 | **Tahasin approves the running costs** (`docs/RUNNING_COSTS.md`, about $50 a month plus about £12 a year for the domain; no payment fees with bank transfer). Check the figures against each supplier's own pricing page first (the document says which are unverified). **The site does not go live until he has ticked it.** | Tahasin | B0 |
| 5.2 | **Launch with the current public wording, solicitor review after** (decided 14 Nov). Confirm nothing has changed that decision. | Owners | B3 |
| 5.3 | **Terms page** and family terms from Tahasin; say what the site shows until they arrive. | Tahasin | B5 |
| 5.4 | **DBS wording** on the careers pages (done 14 Nov); who arranges the check is still open. The tutor application form **stays closed** until the safeguarding agreement's 60 unapproved clauses are approved. | Owners | B4, 3.12.7 |
| 5.5 | **Privacy and legal sign-off:** cookie notice and privacy page match what is set; the supplier list is complete (Render, Supabase, Resend, Cloudflare, Google Workspace, IONOS for DNS only; **not** Stripe); `LEGAL_REVIEW.md` signed. | Owners / reviewer | B6 |
| 5.6 | **What the old marketing site and TutorCruncher do** after launch, and the list of old URLs to redirect with 308s. | Owners | B9 |
| 5.7 | **Tell Tahasin card payment and a card on file are deferred** (his 14 Nov answer assumed cards). | Alvi | C |
| 5.8 | **The rollback:** redeploy the previous Render deploy, or rebuild with the portal flag unset. Write it down and name who decides. | Owners | B10 |
| 5.9 | **Accept staff MFA risk in writing,** or ask for it to be built (it is not built). | Owners | 3.6 |

---

## Part 6: Putting the public site on the real domain (Gate B)

Only after Parts 1 to 5 are done and the test service is healthy.

- [ ] **Public-site checks on the service (B7, 7.2, 7.3, 7.8):** every route 200 with an `<h1>`; branded 404; security headers present; no cookies from public pages; no third-party requests. The axe, keyboard and zoom suites, then a manual screen-reader pass and a real iPhone and Mac Safari pass. The switch audit with the portal flag **unset**.
- [ ] **Security leftovers (B8):** the 12 `npm audit` findings through Excalidraw are accepted and recorded; decide with Alvi whether CI's audit job should fail at `--audit-level=critical`.
- [ ] **Cutover (B11, 8.1):** custom domain on Render; wait for the certificate; set `NEXT_PUBLIC_SITE_URL` and `ALLOWED_ORIGINS` to the real domain and **rebuild**; switch DNS (`www` to Render, apex redirects to `www` with a 308); set Supabase Site URL back to `https://www.learnthrivetuition.co.uk` and the two redirect URLs exactly; re-run the smoke suite on the live URL; send one real enquiry; look at the live response headers and requests; submit the sitemap to Search Console; record the results in `LEGAL_REVIEW.md`.

**Gate B is met when:** the public site is live on the real domain with the portal closed, a real enquiry has been received and answered, and the rollback is written down.

---

## Part 7: Before families and tutors sign in (Gate C)

These do not block Gate A or B. They are here so nothing is forgotten when the portal opens (8.2).

- [ ] **Test every role on the Render service** with throwaway accounts made by `create-account.mjs` (7.5 to 7.9): administrator, tutor, parent, learner. Use test usernames and no real names or emails.
- [ ] **The bank-transfer flow end to end:** make a throwaway parent, sign in, open **Fees**, check the "Pay by bank transfer" panel shows the payee, sort code (written `NN-NN-NN`), account number, bank and a `LT-` reference, that each copy button works, and that the warning text is there. Have an administrator record a payment on that family and check it shows on the parent's page.
- [ ] **The classroom** on two real networks with the Cloudflare keys, then an hour with a tutor and ten students (3.13), and the TURN relay check (`?forceTurn=1`).
- [ ] **Rehearse the purge** on test data (3.7).
- [ ] **Clear the test data (7.12),** then create the four real staff accounts (4.9). The sequence matters: the clean-up deletes every login without exceptions, so the real staff are made after it.
  - Write the list as a JSON file **outside the repository** (format in the header of `apps/web/scripts/create-account.mjs`): Alvi, Tahasin and Abdurrahman as `"role": "ADMIN", "teaches": true` with their subjects, Brian as `"role": "ADMIN"` only, each with their own real `linkedEmail`.
  - Dry run: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DATABASE_URL=... npm run db:create-account --workspace=apps/web -- --file <list.json> --host <the host in DATABASE_URL>`. **Alvi confirms the output.**
  - Real run: the same with `--apply --passwords <a new file outside the repository>`, then type the host and the number of accounts. Hand each temporary password over privately; each person chooses their own at first sign-in. Delete the passwords file afterwards.
- [ ] **Billing before the first statement:** check what a parent sees on **Fees**, and settle with Tahasin the open billing questions: the family rates and who may see billing, when statements go out and in what form, the allowance reset, and what happens to billing records when someone leaves.
- [ ] **Open the portal:** set `NEXT_PUBLIC_APP_PORTAL_ENABLED=true` and **rebuild**, then repeat the switch audit on the live URL (8.2): Library, LearnThrive AI, voice, Stripe and the lesson chat must all still be closed.
- [ ] **Recording stays off** until the privacy work and impact assessment are done. **The careers forms stay closed** until the agreement is approved.
- [ ] Parent sign-in guide screens, once checked against the final portal (H5).

---

## Part 8: Known gaps (not blocking, tell Alvi when you hit one)

1. **No screen to find a family from its payment reference.** When money arrives quoting `LT-XXXXXX`, an administrator has no search by reference; the reference is stored and `GET /api/tuition/bank-details?clientId=<id>` returns it for a known family. Until a lookup is built, match payments by the payer name and amount, and record them against the family by hand.
2. **Lesson chat files.** Messages and files are saved in Postgres and carry over between a weekly lesson's sessions. Any document, image, audio, video, text or zip type is allowed (apply migration 0030). File links are signed with `LESSON_FILE_URL_SECRET` if set, else a key derived from `CLASSROOM_JOIN_SECRET`. File bytes sit in the database (10 MB cap each); move them to a private bucket if volume grows. No malware scanner is installed yet.
3. **The account tool gives each login one role, but the admin screens can add the rest.** A tutor who is also a student: make the tutor login (the tool, or Admin, People, Tutors, Create login), then open the student's page under People, Students and use "Link login" with the tutor's username. That binds the login to the student record and adds the Student role, so one sign-in holds both. A junior tutor: make the tutor login, then set the role to Junior tutor on the Roles screen (a tutor and a junior tutor cannot be held together). A parent with a student side is refused by design (Parent and Student exclude each other).
4. **Real-device and real-infrastructure checks are yours:** nothing in this file has been run against Render, the hosted Supabase project, Resend or Cloudflare by the person who wrote it.

---

## Part 9: Evidence log

Fill this in as you go. A tick without evidence does not count.

| Step | Date | Evidence (command output, screenshot, dashboard value) | By |
| --- | --- | --- | --- |
| 0: gate passes on a clean checkout | | | |
| 1.3: dry run lists exactly 0022 to 0027 | | | |
| 1.4: both sides show 0001 to 0027 | | | |
| 1.5: role script (tables granted) | | | |
| 1.7: probes, no FAIL | | | |
| 1.8: smoke test, all PASS | | | |
| 1.9: advisors, nothing new | | | |
| 2.6: `check:env` clean | | | |
| 3: health, WebSocket, TURN, smoke suite | | | |
| 4: test enquiry arrives at `info@` | | | |
| 5.1: Tahasin approved running costs | | | |
| 6: live domain, real enquiry received | | | |
| 7: every role tested; test data cleared; staff accounts made | | | |
