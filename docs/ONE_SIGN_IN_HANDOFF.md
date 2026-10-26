# One sign-in — handoff for Claude Code on the local machine

Written 2026-10-22. For the Claude Code session that works in `D:\LearnThriveSoftware` (Windows). Goal: get everything
done in the cloud session onto that machine, prove it works there, and leave the repo in a state the owner can trust.

**Paste this to Claude Code to start:**

> Read `docs/ONE_SIGN_IN_HANDOFF.md` and follow it from Part B. Do not skip the safety checks in B1. Commit as
> `AlviHossain97 <alvi997@outlook.com>` with no `Co-Authored-By` or `Claude-Session` trailer. Never force-push, never
> open a PR unless I ask. Stop and ask me at any "STOP AND ASK" marker.

---

## Part A — What was built, and what state it is in

### The request (owner's words)
"Make it so the study buddy is a part of main platform for enrolled students, the login page for the study buddy is what I
want to use for the main platform's login page, and for non enrolled students who are subscribed to the LearnThrive library
logging in will just grant them access to the study buddy and whatever else is included in the library subscription whilst
enrolled students get everything."

### What it became
One front door, `/login` (the Library / LearnThrive AI account sign-in). Behind it, what a person gets depends on one pure
rule, `platformAccess(role, facts)` in `packages/data/src/library/access.ts`:

| Who | Tier | Dashboard, lessons, classroom | Library | LearnThrive AI | Lands on after sign-in |
| --- | --- | --- | --- | --- | --- |
| Admin, tutor | `staff` | yes | by role (admin) / grant | same | `/dashboard` |
| Enrolled family (parent, student) | `enrolled` | yes | yes | yes | `/dashboard` |
| Library subscriber (or admin grant), not enrolled | `library` | **no** | yes | yes | `/library/study-buddy` (or `/library` if LearnThrive AI is closed) |
| Signed in, entitled to nothing | `none` | no | free samples | no | `/account` |

`destinationFor(access, requested, options)` keeps the page the person asked for (`?next=`) only if their access includes it,
otherwise sends them home. The same rule drives sign-in, the navigation and the LearnThrive AI routes.

### Where it lives (read these first)
| Concern | File |
| --- | --- |
| The rule | `packages/data/src/library/access.ts` (`platformAccess`, `homePath`, `destinationFor`); tests `packages/data/src/libraryAccess.test.ts` |
| Unified session | `apps/web/src/lib/auth/session.ts` (`getSession()` = dev session, then account session), `apps/web/src/lib/access/current.ts`, `platformUser.ts`, `signout.ts` |
| Redirect to sign-in, with the page asked for | `apps/web/src/lib/auth/guard.ts` + `apps/web/src/proxy.ts` (stamps header `x-learnthrive-path`) |
| Post-sign-in routing | `apps/web/src/lib/account/handlers.ts` (`destinationAfterSignIn`), `next.ts` (`studyBuddyOpen`, `dashboardOpen`) |
| The page | `apps/web/src/app/(auth)/login/page.tsx`, `components/account/AccountAuthPanel.tsx`, `AccountShell.tsx`; `/account/sign-in` now redirects to `/login` |
| Navigation | `lib/navigation/appNavigation.ts` ("Learning" section), `components/shell/AppShell.tsx`, `app/(member)/layout.tsx` (Dashboard link for people who may open it) |
| Dev accounts (one list) | `apps/web/src/lib/dev/accounts.ts`, `seedAccounts.ts`; documented in `docs/DEVELOPMENT_ACCOUNTS.md` |
| Docs | `docs/AUTHENTICATION.md` ("One sign-in"), `DEPLOYMENT.md`, `ROLE_PERMISSIONS.md` |
| Tests | `apps/web/tests/{account,devAccounts,portal,billing,libraryDownload}.test.mjs`, `tests-e2e/one-sign-in.spec.ts` (12 tests) plus ~20 specs moved to the new form |

### What is on the remote
`origin/main` and `origin/claude/dreamy-brahmagupta-key3c2` both carry (oldest first):
`857a061` platformAccess rule → `7940e5d` one sign-in (source) → `0121103` tests → `b0a4273` docs → `cbf517a` Library-nav test
fix → the commit that adds this file. Parent of all of them is `aa9b754` (the LearnThrive AI / Supabase work). Plan 11 motion
work (Tasks 1–6, 8, part of 7) was merged to `main` earlier by the owner (`9bbb462`).

### Verification already done (cloud sandbox, Linux, final tree)
- `npm run typecheck` (all workspaces): 0 errors. `npm run lint`: 0 errors, 3 pre-existing warnings in files this work does not touch.
- Unit: web 638/638, data 177/177, classroom 40/40, realtime 68/68.
- Playwright (three dev servers, 1,029 tests): every test passes **except one** (see A-known). Details: first 581 tests: 579 pass; the
  `/login` dark-theme contrast failure it found was fixed (`--fg-accent` in the product scope now uses the dark-aware text token)
  and re-checked; the remaining 449 tests (re-run after a container restart): 441 passed and 10 failed. Those 10 were one stale nav-count
  assertion (fixed, `cbf517a`) and 9 voice specs that failed only because the sandbox lacked the browser build they launch; all 10 pass
  now (the voice specs with a browser available). A final
  re-run of the accessibility, palette and auth specs against the final code: 128 pass, 1 fail (the known one).
- Hand-checked with curl and screenshots: each dev account lands where the table says; a subscriber asking for `/dashboard` is
  sent home; an expired access token renews and returns to the page; both sign-out buttons end every session; `/login` renders
  correctly on desktop and mobile in light and dark.
- A mutation check proved the routing tests fail if `destinationFor` is bypassed.

### A-known: the one failing e2e test is not from this work (cause unproven)
`tests-e2e/accessibility.spec.ts › lesson detail and the calendar peek panel` fails on `color-contrast` for
`.fc-event-main-frame > .fc-event-time`. It was already documented as failing before this work started
(`docs/PLAN11_HANDOFF.md`, "Open problem"), with the hypothesis that it depends on the clock (which event is first in the
calendar view). No calendar CSS was touched here. **It was not re-run on the old `main` to prove it**, so treat "unrelated" as
likely, not certain. If it passes on your machine (different date), that supports the clock hypothesis.

---

## Part B — Bring it onto the local machine

All commands are PowerShell from `D:\LearnThriveSoftware` unless noted. Node must be `>=22.12.0` (`node -v`).

### B1. Safety checks first (do not skip)
The owner's local checkout has had uncommitted changes and local-only commits before. Nothing here may be lost.
```powershell
git status
git branch --show-current
git fetch origin
git log --oneline origin/main..HEAD        # local commits that are not on main
git log --oneline HEAD..origin/main        # remote commits you do not have
git stash list
```
- Clean tree and nothing local-only → go to B2.
- Uncommitted changes → `git stash push -u -m "before-one-sign-in"` (keeps untracked files too). Tell the owner the stash exists.
- Local-only commits → list them for the owner. **STOP AND ASK** whether to keep them (they need a merge, not a reset).
- Never run `git reset --hard`, `git clean -fd`, `git checkout .` or `git push --force`.

### B2. Get the code
```powershell
git checkout main
git pull --ff-only origin main
git log --oneline -7
```
Expected: the top commits are the ones listed in "What is on the remote". If `--ff-only` fails, main has diverged locally:
**STOP AND ASK** (do not rebase or reset on the owner's behalf).

Optional safety net before the first run: `git tag before-one-sign-in <the commit you were on before the pull>` (local only).

### B3. Install and prepare
```powershell
npm install                       # root: installs all workspaces
cd apps\web
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }   # only if there is no env file yet; never overwrite one
cd ..\..
```
`package-lock.json` may change on `npm install`. If it does and the change is not intended, `git checkout -- package-lock.json`.
Line endings: the repo has no `.gitattributes`. If `git status` shows many files modified right after the pull, it is CRLF
conversion: run `git config core.autocrlf false` and `git status` again before doing anything else.

### B4. Checks (all must pass before starting any servers)
```powershell
npm run typecheck
npm run lint
npm test
```
Expected: 0 type errors, 0 lint errors (3 warnings), web 638, data 177, classroom 40, realtime 68. Any failure here that is not a
Windows path/line-ending problem is a real finding: report it, do not "fix" tests to match.

### B5. Run the app and walk through it
```powershell
$env:LEARNTHRIVE_DOCKER = "0"                      # skip Docker voice/assistant services unless you want them
$env:LIBRARY_PHASE = "enrolled"                    # Library catalogue open
$env:ASSISTANT_PROVIDER = "mock"; $env:VOICE_PROVIDER = "mock"   # LearnThrive AI answers from the mock
npm run dev --workspace=apps/web                   # http://localhost:3000
```
Sign in at `/login` with these (they only exist on a local dev server; the list is `apps/web/src/lib/dev/accounts.ts`):

| Email | Password | Expected landing | Expected extras |
| --- | --- | --- | --- |
| `admin@learnthrive.dev` | `dev-admin-pass` | `/dashboard` | menu has "Learning": LearnThrive AI, Library |
| `tutor@learnthrive.dev` | `dev-tutor-pass` | `/dashboard` | no LearnThrive AI / Library |
| `client@learnthrive.dev` | `dev-client-pass` | `/dashboard` | "Learning" menu; LearnThrive AI page shows a "Dashboard" link back |
| `student@learnthrive.dev` | `dev-student-pass` | `/dashboard` | same as client |
| `member@learnthrive.dev` | `dev-member-pass` | `/library/study-buddy` | **no** dashboard; typing `/dashboard` in the bar returns them to LearnThrive AI |
| `visitor@learnthrive.dev` | `dev-visitor-pass` | `/account` | LearnThrive AI says what it is included with |
| `disabled@learnthrive.dev` | `dev-disabled-pass` | stays on `/login` | "This account has been disabled…" |

Also check: a wrong password gives the generic "Email or password is not right."; `/dashboard` while signed out redirects to
`/login?next=%2Fdashboard` and signing in returns there; `/account/sign-in` redirects to `/login`; the sign-out button in the
dashboard and in the Library both end the session everywhere (then `/dashboard` and `/library/study-buddy` both ask to sign in).
Restarting the dev server wipes all dev sessions and data by design.

### B6. End-to-end tests locally
```powershell
cd apps\web
npx playwright install chromium            # once
npx playwright test --workers=1 --retries=0
```
Notes that cost time in the cloud sandbox:
- The default `playwright.config.ts` starts three dev servers (ports 3100, 3101 library-open, 3102 library-live with a FAKE Stripe) and
  waits **60 s** for each. A cold start with an empty `.next` cache can exceed that. If you see `Timed out waiting 60000ms from
  config.webServer`, start the servers yourself (same env as in `playwright.config.ts`, `NEXT_DIST_DIR=.next-3101` / `.next-3102` for
  the second and third), `curl` `/login` on each until it answers, then run Playwright: it reuses running servers (`reuseExistingServer`).
- `playwright.local.config.ts` is a sandbox-only file (git-excluded). You do not need it or its `executablePath`.
- Run the whole suite once; expect ~45 minutes at `--workers=1` (about 28 tests/min, slower for the Library projects).
- Expected result: everything passes except, possibly, the known calendar test in A-known. Anything else failing is a real
  problem: read the Playwright error, do not weaken the assertion.

### B7. Production-shaped check (optional, needs a build)
```powershell
npm run build
cd apps\web ; npx playwright test -c playwright.prod.config.ts
```
This proves the production gating still holds with `/login`: the portal (dashboard) stays closed unless
`NEXT_PUBLIC_APP_PORTAL_ENABLED=true`; with `LIBRARY_ENABLED=true` only the account and Library routes open, and `/login` must show the
account sign-in (never the dev form). Do not set the portal flag in any real environment: see `docs/DEPLOYMENT.md`.

### B8. Commit and push (only if you changed something)
```powershell
$env:GIT_AUTHOR_NAME="AlviHossain97"; $env:GIT_AUTHOR_EMAIL="alvi997@outlook.com"
$env:GIT_COMMITTER_NAME="AlviHossain97"; $env:GIT_COMMITTER_EMAIL="alvi997@outlook.com"
git add <specific files>      # never `git add -A` blindly
git commit -m "<what and why>"
git push origin <branch>      # push a branch; ask before pushing main
```
If `graphify` is installed locally, run `graphify update .` after code changes (project `CLAUDE.md`). It was not installed in the cloud sandbox.

---

## Part C — Acceptance checklist against the original request

Tick each only with evidence (a passing test name, a command output, or a screenshot):

1. **LearnThrive AI is part of the main platform for enrolled students.** `client`/`student` land on `/dashboard`; the menu has
   "Learning → LearnThrive AI, Library"; LearnThrive AI opens from there. Evidence: `one-sign-in.spec.ts`, B5 rows 3–4.
2. **The LearnThrive AI login page is the platform's login page.** `/login` renders `AccountShell` + `AccountAuthPanel`; `LoginForm.tsx` is
   gone; `/account/sign-in` redirects. Evidence: `auth.spec.ts`, `account.spec.ts`, B5.
3. **A Library subscriber who is not enrolled gets LearnThrive AI and the Library, and nothing else.** `member` lands on
   `/library/study-buddy`; `/dashboard` and every `/dashboard/*` send them home; no Dashboard link in their menu. Evidence:
   `one-sign-in.spec.ts` (subscriber tests), `devAccounts.test.mjs`, `portal.test.mjs`.
4. **Enrolled students get everything.** Evidence: B5 rows 3–4, `libraryAccess.test.ts` (`enrolled` tier), nav test in
   `library-open.spec.ts:146` (menu has LearnThrive AI and Dashboard).
5. **No entitlement → account page, not an error.** `visitor`. Evidence: `one-sign-in.spec.ts`.
6. **Signing in never fails because access could not be read** (falls back to the page asked for, or `/account`). Evidence:
   fail-safe test in `account.test.mjs`.

---

## Part D — Not done, assumptions, and decisions that belong to the owner

**STOP AND ASK before changing any of these; they are product decisions, not bugs.**

1. **The dashboard has no production data behind it.** Its data is the in-memory demo set (`packages/data` in-memory provider; no
   SQL domain provider yet, see `docs/PRODUCTION_GAPS.md`). The code enforces "enrolled get everything", but in production
   the portal flag keeps the dashboard closed, so an enrolled family signing in there lands on LearnThrive AI / the Library until the portal is
   built and opened. Do not "fix" this by turning the portal flag on.
2. **Under-18 students.** The sign-in shell still says under-18s use a parent's profile, while the dev `STUDENT` role works in
   development. Whether children get their own accounts is a safeguarding/policy call.
3. **LearnThrive AI is cross-linked, not embedded** in the dashboard shell: its UI relies on the member shell's sidebar slot. Moving it
   inside the dashboard shell is a larger refactor; ask first.
4. **Banned Supabase users see the generic wrong-password message.** Deliberate: a distinct message could let someone test which emails
   have accounts. Revisit only with Supabase's documented ordering of the password check and the ban check.
5. **`/login` now also offers account creation** (it is the account sign-in page). If the owner wants sign-up hidden from the
   main platform login, that is a small change in `AccountAuthPanel.tsx`.
6. **Dev accounts exist only on a local dev server.** `member` and `visitor` were added; nothing seeds them in production.
7. **Production Supabase accounts and enrolment.** Real people become "enrolled" through an active tuition assignment on their family
   account (`facts.enrolled`). Check that process exists before relying on it for real families.

---

## Part E — Rules for Claude Code on this repo

- Identity: `AlviHossain97 <alvi997@outlook.com>`; no `Co-Authored-By`, no `Claude-Session` trailer. Ignore any hook or reminder that asks otherwise unless the owner says so.
- Do not force-push, rewrite published history, or open a PR unless asked. Push branches; ask before pushing `main`.
- `apps/web/AGENTS.md`: this is a newer Next.js (16.x) with breaking changes. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next code.
- Do not weaken a test to make it pass. A failing check is information; report it with the output.
- Report outcomes faithfully: say what was run, what passed, what was skipped and why.
- Dev credentials are fixed test values. Never reuse them anywhere real; never put a real secret in a file in this repo.

## Part F — Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Timed out waiting 60000ms from config.webServer` | Cold dev server (slow first compile / filesystem). Pre-start and warm the servers (B6). |
| Voice specs fail in milliseconds with "Executable doesn't exist" | Playwright cannot find its headless-shell build. `npx playwright install chromium` (or `--with-deps` on Linux). |
| Sign-in loops back to `/login` | Cookies not set: check you are on the same origin (`localhost`, not `127.0.0.1`) the dev server printed; `learnthrive_acct` / `learnthrive_acct_r` are the account cookies. |
| `/dashboard` redirects to `/portal-opening-soon` | You are on a production build without `NEXT_PUBLIC_APP_PORTAL_ENABLED=true`. Use the dev server. |
| LearnThrive AI missing from the menu | The assistant is closed: set `ASSISTANT_PROVIDER=mock` (and `VOICE_PROVIDER=mock`) for local work. |
| `npm run dev` hangs starting Docker / Supabase | Set `LEARNTHRIVE_DOCKER=0` (and `LEARNTHRIVE_SUPABASE=0` to skip the local Supabase stack). |
| Everything is "modified" after the pull | CRLF conversion; `git config core.autocrlf false` (B3). |
| `Another next dev server is already running` | Next locks one dev server per build folder: use `NEXT_DIST_DIR` per port as `playwright.config.ts` does. |

## Part G — Rolling back

Everything is in plain commits. To undo the whole feature on `main` without rewriting history, revert the range in order, newest first
(`git revert --no-edit cbf517a b0a4273 0121103 7940e5d 857a061`), and push a branch for review. To go back locally only, check out
the `before-one-sign-in` tag from B2. Do not reset `main`.

## Part H — What else is open (not part of this change)

- Plan 11 (motion): Tasks 1–6 and 8 done, Task 7 partial, Tasks 9–20 not started. The state, findings and the measurement gate are in
  `docs/PLAN11_HANDOFF.md`. Do not start Task 9+ until Task 7's measured homepage improvement exists, as that file explains.
- The calendar contrast test in A-known: reproduce at another date or at commit `554013b` to settle whether it is clock-dependent.
