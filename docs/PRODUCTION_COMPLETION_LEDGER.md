# Production completion: plan and progress ledger

Brief: `LearnThrive_Production_Completion_Claude_Code_Prompt.md`. Branch `feature/production-completion` (from `feature/paper-marker`, which is two
commits on `main` at `73af57b`; nothing pushed, no PR). Commits are authored `AlviHossain97 <alvi997@outlook.com>`, no trailers.
Status words: **implemented**, **mock-tested** (in-memory / fake Auth / PGlite), **service-tested** (a real local Supabase, Stripe test mode or
model ran), **benchmarked**, **production-enabled** (nothing is, by design).

## Baseline (Phase 0, 2026-10-22)

Clean tree on a new branch; 652 web unit tests passing, data suite green, lint 0 errors. Migrations in the repo were `0001` to `0009`
(`0009_server_lookups`). The CLI is linked to a hosted project named `learnthrive-prod` (ref in `supabase/.temp`): **never touched**; its migration
state is unverified. Env files exist (`apps/web/.env`); values are never printed.

## Status by workstream

| # | Workstream | Status |
| --- | --- | --- |
| 1 | Identity, guardian-linked learners, persistent tuition data and enrolment | **mostly implemented and mock-tested; not service-tested** (see below) |
| 2 | One authenticated shell | partly: learner-aware navigation and a supervised-view banner exist in the member shell; the AppShell/MemberShell merge is **not started** |
| 3 | Stripe (plugin-led), Payments, Invoicing, Tax; Supabase deployment preparation | **step 1 done, then blocked**: `claude plugin install stripe@claude-plugins-official` succeeded (user scope, 2026-10-22). Its tools are not loaded in the running session (needs `/reload-plugins` or a restart) and the Stripe MCP needs interactive OAuth (`/mcp`, choose the LearnThrive sandbox). `stripe_implementation_planner` has therefore **not run**; the `npx skills add` fallback was deliberately not used (the planner is not "genuinely unavailable" yet). Nothing else in workstream 3 is built |
| 4 | Durable full-paper processing | **one slice done** (commit `d4c1ca4`): one configurable limit chain (`PAPER_MAX_PAGES` 60, `PAPER_MAX_QUESTIONS` 150, `PAPER_RENDER_BATCH` 6), pages drawn in batches (result identical to drawing all), no silent truncation (the job names the questions left out), 3-digit question numbers; a generated 30-page / 120-question paper is read completely. **Not done:** persistent jobs and worker (still process memory), hierarchical `1(a)(i)` structure, scan layout adapter, symbolic verification, benchmarks on real papers |
| 5 | Handwritten work assessment | an opt-in marker exists from earlier work (`docs/ASSISTANT.md`, flag `PAPER_MARKER_ENABLED`), on the old in-memory job model; the brief's evidence model, scheme matching and human-benchmark gate are **not built** |
| 6 | Final regression, runbook, handoff | not started |

## Workstream 1: what exists (commits `0294beb`, `b770001`, `d3609f9`)

- Migration `0010_learner_identity.sql`: `learner_identities`, `learner_invitations`, `supervised_contexts`, `identity_audit`; guardian-link `status` and
  `can_view_progress`; `students.access_mode`; learner-never-a-client triggers; learner/guardian RLS; `create_learner_invitation` and
  `accept_learner_invitation` as atomic functions granted only to the server role (`create-server-role.mjs` updated); chats with a `student_id` are server-only.
- Migration `0011_tuition_domain.sql`: lessons, lesson_students, tutor_availability_blocks, lesson_attendance, lesson_activity, lesson_reports,
  notifications, platform_settings (all server-only, RLS forced).
- `packages/data`: `IdentityRepository` (memory + SQL, one contract), `resolveActor` (the one eligibility decision), `accessFactsFor`, `directLoginAllowed`,
  owner-scoped chat store (`ChatOwner` = family AND learner), `createSqlDataProvider` (every domain repository, one contract on memory + PGlite),
  `tutors.linkLogin`, `accounts.domainRef`.
- `apps/web`: `lib/learner/{resolve,handlers}.ts`, routes `/api/learners/*` and `/api/learner/*`, pages `/account/learners` and `/learner/accept`, the
  supervised banner, assistant/paper/voice gates on the resolved owner, learner-aware sign-in routing/navigation/downloads/account page, billing refused
  inside a supervised view, `lib/data/provider.ts` (Postgres in production, in-memory only in development, **throws** in production without Supabase),
  admin enrolment actions (pause/resume/end, change tutor, add/remove students, link a tutor login), dev student is now a real learner.
- Docs: `docs/IDENTITY.md` (model, rules, routes, owner decisions).

### Evidence run

| Check | Result |
| --- | --- |
| `npm test --workspace=apps/web` | 664 / 664 |
| `npm test --workspace=packages/data` | 263 pass, 1 skipped (a derived-families case that only the Postgres provider has), 0 fail |
| `npm run lint` | 0 errors (3 old warnings) |
| Playwright, new `learner.spec.ts` (fourth dev server :3103) | 2 / 2, axe clean |
| Playwright, regression: one-sign-in, study-buddy, study-buddy-paper | 28 / 28 |
| Playwright, regression: people, lessons, auth | 35 / 35 |

### Not done in workstream 1 (precise)

- **No real-Supabase evidence.** Docker Desktop's engine will not start on this machine (the process starts and exits, no window; `docker ps` reports no
  `dockerDesktopLinuxEngine` pipe). Needs the owner to open Docker Desktop once and finish any first-run/WSL prompt. Until then: invitations through real
  GoTrue, the narrow `learnthrive_server` role calling the two new functions (`realstack.role.test.ts` expects them), real concurrency on accept, direct
  authenticated-user RLS over the real API, Storage denial, restart/multi-instance persistence, `supabase db reset` + upgrade-from-populated-copy. Next
  command once Docker is up: `npm run supabase:start` then `npm run test:realstack` (the contracts `identityContract.ts` and `dataProviderContract.ts`
  should also be wired into `realstack.*.test.ts` the way `libraryContract` is).
- Backfill/migration dry-run tooling for real families (duplicate and missing-link detection, never matching by name) is not written.
- Staff-side suspension/revocation of a learner has store support but no screen; invitation emails are not sent by the app (link shown once).
- The staff dashboards' per-role scoping on the SQL provider was not re-audited page by page; only the contract and the in-memory e2e ran.
- Orphan reporting (learner `profiles` left after a student is deleted) and deletion of a learner's storage files are listed, not built.
- Seed data reaches production bundles only if `getDataProvider`'s in-memory branch is not tree-shaken; the guarantee today is the runtime refusal
  (tested), not bundle absence. `npm run check:bundle` has not been run against a production build.

## Owner decisions / inputs still needed (grouped)

1. Production age rule for own logins (default Year 9 is a staging value) and the wording/version of the guardian consent (`LEARNER_CONSENT_TEXT`).
2. `ASSISTANT_MINORS_APPROVED` and the safeguarding lead's recorded approval: closed everywhere.
3. Docker Desktop on the dev machine (see above), and, for workstream 3, Stripe sandbox access through the Stripe MCP OAuth (interactive) and the tax
   registration facts. Hosted Supabase (`learnthrive-prod`): nothing was run against it; a dry run needs the owner's go-ahead.

## Next steps, in order

1. Docker up, then real-stack runs for workstream 1 (above) and wire the two new contracts into the real-stack files.
2. Workstream 2: one shell (`AppShell` + `MemberShell` merge with a page-specific secondary slot for Study Buddy history; capability navigation from
   `platformAccess`); browser/visual checks for guardian, enrolled learner, Library subscriber, linked Library learner at desktop and mobile.
3. Workstream 3: `claude plugin install stripe@claude-plugins-official`, Stripe MCP OAuth, `stripe_implementation_planner`; audit `lib/billing/*`; tuition
   invoicing, tax plumbing, webhook evidence with the Stripe CLI; deployment preparation (clean-stack apply, upgrade dry run, backup/restore, checklist).
4. Workstream 4: durable jobs table + worker, hierarchical question structure, no silent truncation, symbolic verification adapter, benchmark harness.
5. Workstream 5: marking evidence model, scheme matching, review flow, release gate.
6. Final regression, runbook, handoff document.

## Gotchas learned (for whoever continues)

- Node's `String.prototype.replace` treats `$'` and `$&` in the replacement as special: a SQL string ending `$'` corrupted a migration during patching. Use a
  function replacement. Heredocs also collapse backslashes in this shell; write patch scripts with the Write tool.
- `node --test` suites: migrations are applied to PGlite by `createTestDb`; a new table must be added to `EXPECTED_TABLES` / `FORCED_TABLES` in
  `schema.test.ts`, `PUBLIC_TABLES` in `apps/web/scripts/supabase-verify.mjs`, and given a `comment on table`.
