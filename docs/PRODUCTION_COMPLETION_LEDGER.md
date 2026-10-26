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
| 2 | One authenticated shell | **implemented and browser-verified** (commit `abe6471`): `PlatformShell` renders tuition, Library, LearnThrive AI and account in one frame; `platformNavigation()` builds the menu from capability, with unit-tested rows; `SidebarSection` slot for LearnThrive AI history; flush mode for LearnThrive AI; keyboard/focus test; desktop and 390 px checked for guardian, enrolled learner, Library subscriber and linked learner. Details in `docs/IDENTITY.md` ("One shell") |
| 3 | Stripe (plugin-led), Payments, Invoicing, Tax; Supabase deployment preparation | **step 1 done, then blocked**: `claude plugin install stripe@claude-plugins-official` succeeded (user scope, 2026-10-22). Its tools are not loaded in the running session (needs `/reload-plugins` or a restart) and the Stripe MCP needs interactive OAuth (`/mcp`, choose the LearnThrive sandbox). `stripe_implementation_planner` has therefore **not run**; the `npx skills add` fallback was deliberately not used (the planner is not "genuinely unavailable" yet). Nothing else in workstream 3 is built |
| 4 | Durable full-paper processing | **implemented and mock-tested; benchmarked on synthetic papers only, no real paper has been run.** Limit chain (`d4c1ca4`); verification evidence (`b1a09f7`); durable jobs with leases, checkpoints and recovery, migration 0012 (`bc0258e`, `c9affba`); real exam structure: parts, stems, continuation, cover/formulae/blank pages (`32b8305`); scan layout adapter validated against the drawing (`ce5c744`); benchmark harness, manifest, held-out discipline (`088a87e`). **Not done:** any run on real exam papers (the owner supplies and annotates them), resuming a question that was mid-solve when a worker died (it is solved again), the real model through the harness |
| 5 | Handwritten work assessment | **implemented and mock-tested; UNVALIDATED.** Evidence/judgement model, scheme matching and criteria, provisional rubric, blank/unreadable/wrong states, pending marks kept apart from zero, corrections and tutor review as append-only versions, blank-paper reference, release flag `PAPER_MARKS_RELEASED`, validation harness with thresholds set in advance (commits `3eebf89`, `b27259e`, `cfa3d4e`). **Not done:** validation on permissioned, human-marked handwriting (none exists here); a real exam-board scheme has never been read |
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

## Workstreams 2, 4 and 5: what exists and what it was checked with (2026-10-22 to 23)

Workstream 2 is described in `docs/IDENTITY.md`. Workstreams 4 and 5 are described in `docs/ASSISTANT.md` (Paper Tutor, Checking a completed paper) and
`docs/PAPER_BENCHMARK.md`.

- **Verification** (`mathsEvidence.ts`, `solve.ts`): numeric agreement, completeness, working consistency and answer form are separate pieces of evidence.
  `x = 2` for `x² = 4` is a failed check; a zero-denominator root is extraneous; `0.8333…` for `5/6` fails on form; a right answer reached through an invalid
  step is left for review. Writing the benchmark found four more checker defects (printed marks read as maths, a stem hiding a part's expression, `12 x 7`,
  a list of solutions judged as a chain); each has a regression test.
- **Durable jobs** (migration `0012_paper_jobs.sql`, `PaperJobRepository`): one active job per family is a partial unique index; a worker holds a lease renewed
  by a heartbeat; every write is fenced by the lease; a job whose worker has gone is taken over and carries on from its per-question checkpoints; three runs and
  it is failed; retention 7 days. Contract tests run on memory and Postgres (PGlite); recovery, fencing and cross-process cancel are tested end to end.
- **Structure and layout** (`questions.ts`, `layout.ts`): parts found by sequence, stems as context, ids opaque and labels as printed, continuation, page kinds;
  a vision-proposed answer space on a scan is used only if the drawing agrees.
- **Marking** (`assess.ts`, `scheme.ts`, `mark.ts`, migration `0013_paper_assessments.sql`): see `docs/ASSISTANT.md`. The credit rules are code the model cannot bend
  (no cited line, no credit; the answer mark is the calculation's; dependent and follow-through marks).
- **Benchmark** (`bench.ts`, `benchRun.ts`, `benchMark.ts`, `scripts/paper-bench.mjs`): four synthetic paper cases (extraction 100%, false "verified" 0, 0 bad
  placements) and one synthetic marking case. **These prove the harness and pin known failure modes; they say nothing about real papers or real handwriting.**

| Check | Result |
| --- | --- |
| `node --test tests/*.test.mjs` (apps/web) | 736 / 736 |
| `npx tsx --test src/*.test.ts` (packages/data) | 280 pass, 1 skipped, 0 fail |
| `tsc --noEmit` (web and data) | clean |
| ESLint (storybook-static and test-results ignored) | 0 errors, 3 old warnings |
| Playwright `study-buddy-paper` + `study-buddy` (project library-open) | 16 / 16, including the new correction flow |
| Real Supabase / Docker | not run (see blockers) |
| Real model (`qwen3.5:9b`) through the benchmark | not run |
| Real exam papers, real mark schemes, real handwriting | none available |

## Three local Ollama roles (owner brief, 2026-10-23)

Brief: `LearnThrive_Ollama_Three_Model_Claude_Code_Prompt.md` (untracked, not committed). Runbook:
[docs/OLLAMA_THREE_MODEL.md](OLLAMA_THREE_MODEL.md). Measured numbers: [docs/OLLAMA_BENCHMARK.md](OLLAMA_BENCHMARK.md),
`docs/benchmarks/ollama-results.json`, `docs/benchmarks/photo-check.json`.

- **Implemented and mock-tested:** native Windows runtime (`scripts/ollama-local.mjs`, two loopback servers: GPU tutor on 11434, CPU helpers
  on 11435), `dev-services.mjs` preferring it over Docker, tutor adapter (thinking, native tool calls, metrics, `keep_alive`, correct
  capability cache), shared warm-up manager with the exact `num_ctx`, staged deadlines and one absolute turn deadline, read-only tools
  (`search_authorised_material`, `get_question_region`, `check_calculation`), embeddings adapter (validated batches, EmbeddingGemma prefixes),
  typed-decision adapter with probability + margin floors and deterministic fallback, retrieval index (migration `0014_chat_retrieval.sql`,
  owner-scoped chunks, question-aware chunking, background indexing, exact label lookup first), stored document readings reused on follow-ups,
  and image budgets in config. `apps/web/tests/assistantRoles.test.mjs`; the data contract tests cover the new repository surface.
- **Service-tested on the real machine:** benchmark runner `npm run ollama:bench` (three models, cold and warm, GPU sampling) and the
  end-to-end photo check `npm run ollama:photo-check` against the real provider, document reader and deadlines. The original picture
  timeout's cause is reproduced and fixed: Docker/WSL model mount (215-251 s cold load) versus native (8.5 s, `qwen3.5:9b`), the 45 s timer
  spanning the load, a warm-up at a different context forcing a reload, and re-sent pages on follow-ups.
- **Selected by measurement** (`docs/OLLAMA_BENCHMARK.md`): `bonsai-2:9b` (18/18 exact answers, photo first answer 0.94 s, 2.7 GiB VRAM
  free), `embeddinggemma-2:270m-q8_0-text` and `laya:421m-typed-decisions-bf16` on a CPU helper process. `qwen3.5:9b` stays as the
  rollback and `bonsai-2:4b` as the speed profile. One fault was found by measuring rather than trusting configuration: this build uses
  Vulkan, so `CUDA_VISIBLE_DEVICES=-1` did not keep the helper off the GPU (~800 MiB); `OLLAMA_VULKAN=0` does, and the helper now reports
  `size_vram: 0`.
- **Also run on the real machine:** the photo path through the real site (`npm run ollama:browser-check`: cold first words 8.5 s, warm
  0.67 s, "Reading the picture" then "Preparing the model" shown, no timeout), idle expiry, helpers beside the tutor (no eviction, 0 VRAM),
  a PDF follow-up that does not re-read the file, two students at once, and a backend restart (`npm run ollama:lifecycle`); six cold
  starts per model (5.2-5.7 s for the 9B). Evidence: `docs/benchmarks/{lifecycle-check,browser-check-cold,browser-check-warm,cold-starts}.json`.
- **Not done:** no real student handwriting, scanned exam PDF or real exam-board paper in the benchmark; routing accuracy on real
  families' messages (the router abstained on 9 of 12 held-out examples); background indexing timed beside a queued Paper Tutor job;
  voice on the GPU during a photo turn; production use is not authorised (Ollama is still development-only).

## Owner decisions / inputs still needed (grouped)

1. Production age rule for own logins (default Year 9 is a staging value) and the wording/version of the guardian consent (`LEARNER_CONSENT_TEXT`).
2. `ASSISTANT_MINORS_APPROVED` and the safeguarding lead's recorded approval: closed everywhere.
3. **Real papers for the benchmark**: download, annotate (a second person checks) and describe them in `apps/web/benchmarks/paper/manifest.json`; keep at least a
   third held out from a different series. **Human-marked handwritten responses** (permissioned, anonymised, marked by a qualified person) in
   `marking-manifest.json`. Until they exist the marker is unvalidated and `PAPER_MARKS_RELEASED` should stay off in production. The sample sizes in
   `MARKING_THRESHOLDS` are the owner's to adjust before the held-out run.
4. Tutor review: whether a guardian must permit sharing a learner's marked paper with their tutor (today: an active assignment is enough), and whether a tutor's review
   should outlive the 7-day job retention.
5. Docker Desktop on the dev machine (see above), and, for workstream 3, Stripe sandbox access through the Stripe MCP OAuth (interactive) and the tax
   registration facts. Hosted Supabase (`learnthrive-prod`): nothing was run against it; a dry run needs the owner's go-ahead.

## Blockers

- Docker will not start: no real-stack evidence for workstreams 1, 4 (migrations 0012, 0013 on a real database) or 5. Migrations 0012 and 0013 were applied to PGlite
  only, including the second-application idempotency test.
- Stripe MCP needs interactive OAuth (workstream 3).
- Nothing about real exam papers, boards' mark schemes or real handwriting can be claimed.

## Next steps, in order

1. Docker up, then real-stack runs for workstream 1 (above) and wire the two new contracts into the real-stack files.
2. Workstream 2 is done. Workstream 4 and 5 need real data (see owner decisions 3): run `npm run paper:bench -- --provider ollama` once papers are in the manifest.
3. Workstream 3: `claude plugin install stripe@claude-plugins-official`, Stripe MCP OAuth, `stripe_implementation_planner`; audit `lib/billing/*`; tuition
   invoicing, tax plumbing, webhook evidence with the Stripe CLI; deployment preparation (clean-stack apply, upgrade dry run, backup/restore, checklist).
4. Wire the new contracts (papers repository, identity, data provider) into the real-stack files and run them once Docker is up.
5. Add a tutor-facing review screen on top of `/api/tutor/papers/<id>`; today it is an API only.
6. Final regression, runbook, handoff document.

## Gotchas learned (for whoever continues)

- Node's `String.prototype.replace` treats `$'` and `$&` in the replacement as special: a SQL string ending `$'` corrupted a migration during patching. Use a
  function replacement. Heredocs also collapse backslashes in this shell; write patch scripts with the Write tool.
- A new table also needs a `comment on table`, and an append-only history table needs its trigger to allow the cascade from its parent (`pg_trigger_depth() > 1`).
- `node --test` suites: migrations are applied to PGlite by `createTestDb`; a new table must be added to `EXPECTED_TABLES` / `FORCED_TABLES` in
  `schema.test.ts`, `PUBLIC_TABLES` in `apps/web/scripts/supabase-verify.mjs`, and given a `comment on table`.
