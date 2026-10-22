# Production completion: plan and progress ledger

Started 2026-10-22 on branch `feature/production-completion` (from `feature/paper-marker`, itself two commits on `main` at `73af57b`).
The brief is `LearnThrive_Production_Completion_Claude_Code_Prompt.md`. This file is the live record: what is done, what was run, what
is blocked. Statuses use the brief's words: **implemented** (code exists), **mock-tested** (fake or in-memory providers),
**service-tested** (a real local Supabase / Stripe test mode / model ran), **benchmarked**, **production-enabled** (nothing is, by design).

## Baseline (Phase 0)

| Check | Result |
| --- | --- |
| Branch / remote | `feature/production-completion`; `origin/main` = `73af57b`; no stashes; no unrelated changes |
| Unit tests (`npm test --workspace=apps/web`) | 652 / 652 pass at the start of this work |
| Typecheck / lint (web) | clean / 0 errors (3 old warnings) |
| Local Supabase | Docker Desktop was not running; started (see blockers) |
| Hosted Supabase | CLI is linked to a project named `learnthrive-prod` (ref in `supabase/.temp`). **Not touched.** Its migration state is unverified |
| Migrations in repo | `0001_core` to `0008_consent_withdrawal_time`. (An earlier note said 0009: there is none) |
| Env files | `apps/web/.env` and `.env.example` exist; values are never printed. Names/presence/mode only |

## What the audit found (source, not old docs)

- `students` has no auth link; `clients.owner_profile_id` is unique, so a learner cannot be a second "client"; `client_students` is the guardian link and has no status or permissions.
- `platformUser.ts` still maps to domain records through `devDomainIdFor`; production has no domain provider at all (`DataProvider` is in-memory only), and the portal is closed in production (`PORTAL_ENABLED`).
- The assistant gate (`assistant/handlers.ts`) refuses any account without `adultConfirmed`; chats, files and paper jobs are scoped by `clientId` alone.
- Paper jobs are a process-local `Map`; `paper.ts` reads 20 pages and slices to 30 questions; verification is numeric (spot values), not symbolic.
- Billing is Library subscriptions only (Checkout, portal, mirror, reconcile); no tuition invoices, no tax plumbing beyond `automatic_tax`.

## Workstreams, dependencies, release conditions

| # | Workstream | Depends on | Release condition | Status |
| --- | --- | --- | --- | --- |
| 1 | Identity, guardian-linked learners, persistent tuition data and enrolment | none | real local Auth + SQL end to end, adversarial permission tests | in progress |
| 2 | One authenticated shell | 1 (actor facts) | role/entitlement navigation, browser checks | not started |
| 3 | Stripe (plugin-led), Payments, Invoicing, Tax; Supabase deployment preparation | 1 (customer mapping) | real sandbox evidence, migration dry run | not started |
| 4 | Durable full-paper processing | 1 (learner scoping) | full-paper benchmarks, restart recovery | not started |
| 5 | Handwritten work assessment | 4 | human-benchmark status, release flag | partly done (see `docs/ASSISTANT.md`: opt-in marker on the old job model) |
| 6 | Final regression, runbook, handoff | all | actual results | not started |

## Progress log

(Each entry: date, what, evidence.)

- 2026-10-22: Phase 0 done. Branch created, baseline recorded above.

## Blockers and owner inputs

(Filled in as found.)
