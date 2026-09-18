# Production gaps

What stands between this prototype and putting real Tutors, Clients (parents/guardians), and
Students in front of the LearnThrive Tuition platform. **Nothing here is implemented, and nothing
here should be read as "in progress" — these are gaps, not a roadmap commitment.**

This covers the platform as a whole (`apps/web`, `packages/data`, the classroom integration
boundary). For gaps specific to the classroom call/whiteboard/moderation feature itself, see
[`apps/classroom/PRODUCTION_GAPS.md`](../apps/classroom/PRODUCTION_GAPS.md) — that document
already separates "is the classroom feature solid" (largely yes) from "is LearnThrive ready for
real students" (no), and everything below is specific to the platform layer built in Phases B-J
of this migration, not a restatement of that document.

## Authentication and identity

- **There is no production authentication provider.** `DevelopmentAuthProvider`
  (`apps/web/src/lib/auth/devProvider.ts`) is an in-memory, scrypt-hashed credential store, reset
  on every server restart, with a hard `assertNotProductionWithoutRealProvider()` guard that
  throws if `NODE_ENV=production` — this is a deliberate fail-safe, not a placeholder to relax
  later. A real provider (Supabase Auth, per `docs/SUPABASE_MIGRATION.md`) is required before any
  real account exists.
- **No account self-service.** No sign-up, password reset, email verification, or MFA — every
  account is hand-seeded (`SEED_ACCOUNTS`).
- **Sessions are in-memory** (`apps/web/src/lib/auth/session.ts`) — every session is lost on
  restart, and there is no distributed-session story for running more than one server instance.

## Classroom integration

- **The dev-fallback shared secret.** `CLASSROOM_JOIN_SECRET` falls back to a hardcoded string
  (`packages/shared/classroomToken.ts`'s `DEV_FALLBACK_SECRET`) if unset in either `apps/web` or
  `apps/realtime`'s environment, so the two apps work together out of the box locally. A real
  deployment needs a real secrets manager, rotated, never defaulted.
- **`.env.example` files were never created** — the sandbox this platform was built in denies
  writing any `.env*` path outright. The required variables are documented in
  `docs/CLASSROOM_INTEGRATION.md` instead; whoever sets up a real environment needs to create
  those files by hand from that documentation.
- **No post-class workflow bridge.** The classroom prototype has no way to tell the platform a
  lesson actually happened, was joined, or ran long — attendance is entirely Tutor-entered on the
  platform afterwards, disconnected from what actually happened in the call. See
  `docs/ATTENDANCE.md`'s "auto session log" gap.
- **The cross-app end-to-end flow (Tutor clicks Join → lands admitted in the classroom) has never
  been exercised with all three dev servers running together in this session** — the token
  contract is proven at the `apps/realtime` boundary (real socket.io client tests) and the
  authorization/join-window logic is proven at the `apps/web` boundary, but nothing drove the
  actual redirect end-to-end (the Browser automation tool this platform was built with was
  removed from the session partway through Phase E). A manual pass is recommended before treating
  this as proven.

## Validation and data integrity

- **No shared validation schema library** (e.g. Zod) — every Server Action validates its own
  `FormData` inline, consistently but not centrally (see `docs/HARDENING.md`'s Validation
  section). Plan section 61 asks for shared schemas literally; this platform satisfies its
  individual field-level requirements without that specific mechanism.
- **No database-level constraints of any kind** — the in-memory provider trusts application code
  entirely (no foreign-key enforcement, no uniqueness constraints beyond what a repository method
  happens to check). A real Postgres migration needs real constraints, not just a port of the
  current `Map`-based logic.

## Notifications and scheduling

- **No time-based notifications.** `LESSON_REMINDER` (lesson approaching / upcoming) and a
  deadline-based `REPORT_REQUIRED` exist as domain types but nothing ever creates one — every
  real trigger fires from a user action, and a time-based one needs a scheduler/cron that doesn't
  exist anywhere in this prototype. See `docs/NOTIFICATIONS.md`.
- **No real email/SMS.** Plan section 55 explicitly defers this ("do not send real email/SMS
  unless infrastructure already exists") — every notification today is in-app only.
- **No lesson report PDF export** (plan section 47 explicitly defers this).
- **No report revision workflow** — a submitted/approved report has no in-app path back to draft
  for corrections.
- **No Student progress timeline page** (plan section 46) — the repository method
  (`ReportRepository.forStudent()`) exists to support it, but no page reads it yet.
- **No global/admin search** (plan section 52) across Students/Clients/Tutors/Lessons.
- **No settings page for `requireReportApproval`** — the data-layer setting and its
  per-Assignment override are fully respected by `reportService.ts`, but nothing in the UI lets
  an Admin actually change either value.

## Accessibility and device coverage

- **No automated accessibility audit tool was run** against `apps/web` (no axe-core or
  equivalent installed for this app), and no manual screen-reader pass was performed. Every
  interactive control added has a real label (verified indirectly by the Playwright tests, which
  locate controls via `getByLabel`/`aria-label`), but that is not the same as an audit. See
  `docs/HARDENING.md`.
- **No real-device or cross-browser testing of `apps/web`** — built and tested on Windows
  Chromium via Playwright only, same caveat `apps/classroom/PRODUCTION_GAPS.md` already records
  for the classroom app specifically (Safari/iOS untested there too).
- **No responsive testing against a real or emulated phone viewport** for the dashboard pages
  built in Phases F-H — the CSS is fluid/auto-fill by construction (verified by code review, not
  a live narrow-viewport pass).

## Observability and operations

- **No structured logging, metrics, tracing, or alerting** for `apps/web` beyond what Next.js's
  own dev server prints — the same gap `apps/classroom/PRODUCTION_GAPS.md` records for
  `apps/realtime`.
- **No backup/recovery plan** — there is no persistent data to back up today (everything is
  in-memory, reset on restart), but this becomes a real requirement the moment a database exists.
- **`resetDataProvider()`'s Admin-only "Reset demo data" button** (plan section 98) is a
  development convenience with two guards (`NODE_ENV` check, `requireRoleForApi(["ADMIN"])`) —
  it is not a production data-management tool and shouldn't be treated as one even in a staging
  environment with real data.

## Legal, safety, and compliance

- **No safeguarding policy integration** — for a platform used by Students (potentially minors),
  there is no recording-for-safety option, supervisory visibility, or incident-reporting path.
  This is a policy/product decision, not an engineering one, and needs to happen before real
  lessons run through this platform. `apps/classroom/PRODUCTION_GAPS.md` records the same gap at
  the classroom layer specifically.
- **No formal data protection review** against applicable requirements (e.g. UK GDPR, given the
  target audience) — this platform now persists (in-memory) real-shaped personal data (names,
  attendance, report contents, private Tutor notes) that the earlier classroom-only prototype
  never did.
- **No legal/compliance review** — terms of service, consent, liability — before any real tuition
  runs through this system.

## What this phase's work does establish

To be clear about what *is* solid, so the gaps above are read in context: every mutating
operation is guarded server-side at three independent layers (page, object/IDOR, action — see
`docs/ROLE_PERMISSIONS.md`), proven by a real adversarial test suite
(`apps/web/tests-e2e/hardening.spec.ts` plus the IDOR/visibility tests throughout
`lessons.spec.ts`) rather than just code review. The Parent/Student report-visibility boundary
(never leaking internal Tutor notes) is enforced in exactly one function and proven end-to-end
with a real "CONFIDENTIAL" string that never reaches the page. DST-safe recurrence, the
classroom join-token security boundary, and the attendance/report/completion gating chain all
have real, passing automated test coverage — by the end of Phase I: 69 `apps/web` unit tests, 7
`packages/data` unit tests, 68 `apps/realtime` unit tests, and 26 `apps/classroom` unit tests
(170 total), plus 35 `apps/web` and 40 `apps/classroom` Playwright scenarios (75 total). The gap
is specifically the production concerns above — real auth, real secrets, observability,
legal/safety review — not the application logic itself.
