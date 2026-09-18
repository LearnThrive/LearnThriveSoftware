# Architecture

## Starting point (before this migration)

Two separate repositories:

- **`D:\LearnThrive`** — the real, live LearnThrive Tuition marketing website. Next.js 16 (App Router) + React 19, TypeScript, no database, no authentication. A `POST /api/enquiry` route sends booking-consultation emails via Resend. Its footer links to a real, external, already-in-use TutorCruncher account for tutor login. Content/link tests via Node's built-in test runner (`node --test`); a browser/accessibility check script using axe-core against a locally installed Chrome/Edge.
- **`D:\LearnThriveSoftware`** — the classroom prototype covered by this repository's own earlier plans (`plan.md` through `plan4.md`, gitignored/private). Vite + React 19 client, Express 5 + Socket.IO 4 signalling server, a hand-rolled WebRTC mesh (1 tutor + up to 3 students), a collaborative Excalidraw whiteboard, Cloudflare Realtime TURN credential generation, and extensive classroom moderation (polls, understanding checks, timers, announcements, a Help Queue). 89 Vitest tests, 20 Playwright scenarios × 2 browsers. No accounts, no persistence — everything lives in an in-memory `Map` per room and resets on server restart.

## This migration (Phase A — repository convergence)

Both became workspace members of one npm-workspaces monorepo at `D:\LearnThriveSoftware`:

```
D:\LearnThriveSoftware
├── apps/
│   ├── web/         Next.js — public site now, +platform UI from Phase B onward
│   ├── classroom/    Vite + React — the real-time classroom, unchanged in behaviour
│   └── realtime/      Express + Socket.IO — the classroom's signalling/TURN backend
├── packages/
│   └── shared/        shared/protocol.ts + shared/allowedHosts.ts, now @learnthrive/shared
└── docs/               this document and its siblings
```

`D:\LearnThrive` was read from, never written to — the plan behind this migration is explicit that it stays read-only source material. Its `src/`, `public/`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, and test suite were copied into `apps/web` verbatim; nothing was redesigned in the process (see "What changed in the copy" below for the small, necessary exceptions).

### Why four workspace members, not one

The plan behind this migration states four boundaries as **mandatory**: web application, realtime/classroom service, domain/data access layer, and shared models/permissions must all be genuinely separable, not just organised by folder convention inside one app. An npm workspace gives each boundary a real package boundary — its own `package.json`, its own dependency graph, its own lint/typecheck/test/build lifecycle — so "separate" is enforced by tooling (a workspace can only import another workspace's code via that workspace's declared package exports, e.g. `@learnthrive/shared/protocol`), not just by developer discipline.

`packages/data` (the domain/data-access layer named in the plan's illustrative tree) doesn't exist yet — it's introduced in Phase C alongside the domain model and repositories, once there's an actual domain to model. Introducing an empty package now would be scaffolding without substance.

### Why the classroom wasn't rewritten into Next.js this pass

The plan's own preferred long-term direction is Next.js as the primary LearnThrive web application, with the classroom UI eventually migrated into its authenticated area. This migration deliberately did **not** attempt that rewrite in the same pass as the structural monorepo move, for a concrete reason: `apps/classroom` is a large, working, extensively-tested real-time application — a hand-rolled WebRTC mesh with per-peer bandwidth policy, a lazily-loaded Excalidraw whiteboard with a custom reconciliation protocol, and 20 Playwright scenarios that exercise real getUserMedia/WebRTC/Socket.IO behaviour end to end. Rewriting that into React Server Components / Next.js's client-component boundaries at the same time as moving every file on disk would combine two large, independently risky changes into one, with no way to isolate which one caused a regression if something broke. The plan itself warns against exactly this: "If some classroom code genuinely needs to remain in its current Vite application temporarily, introduce a migration boundary rather than destabilising it."

So `apps/classroom` stays a Vite app for now — the "migration boundary" is architectural (a separate workspace, entered from the platform via an authenticated route once Phase E builds that integration) rather than a rewrite. Every classroom test (89 Vitest + 40 Playwright runs) was re-verified passing after the move, unmodified in what they assert.

### What changed in the copy

Almost nothing behaviourally. Specifically:

- **Import paths**: `shared/protocol.ts`/`shared/allowedHosts.ts` moved to `packages/shared` and are now imported as `@learnthrive/shared/protocol` / `@learnthrive/shared/allowedHosts` (a real package import, resolved via the workspace's `node_modules` symlink) instead of relative paths like `../../shared/protocol`.
- **Split `package.json`/`tsconfig.json`/`vitest.config.ts`/`eslint.config.js`**: each app now owns its own, scoped to only its own directory, where before one root config covered both the Vite client and the Express server.
- **A dependency-hoisting bug found and fixed during this migration**: `@excalidraw/excalidraw`'s own transitive dependencies (several `@radix-ui/react-*` packages) have a hard (non-peer) dependency on `react@18.3.1`. In a flat, non-workspace install this hadn't surfaced. Once `apps/classroom` became a workspace member with no direct `react` dependency declared at the *root* `package.json`, npm's hoisting algorithm picked React 18.3.1 for the top-level `node_modules/react` slot (outvoted by sheer number of radix-ui subpackages) and nested a second copy of React 19.3.0 inside `apps/classroom/node_modules` to satisfy the app's own direct dependency — two React copies at runtime, which crashed the whiteboard specifically with "Invalid hook call" the moment Excalidraw rendered. Fixed with an `overrides` pin at the root `package.json` (`"react": "^19.3.0", "react-dom": "^19.3.0"`), forcing one resolved copy everywhere in the tree. Caught by re-running the full Playwright suite after the move, not assumed safe — see the verification note below.
- **Two small, faithful bug fixes in the migrated marketing site** (`apps/web`), both proven pre-existing in the real `D:\LearnThrive` repository by running its own unmodified `npm test` before touching anything: (1) four ESLint findings (two `<a>` tags that should be Next's `<Link>`, one unescaped apostrophe, one effect that set state synchronously — restructured into a lazy `useState` initializer) that a fresh dependency install surfaced via a newer `eslint-plugin-react-hooks` rule; (2) the enquiry API route constructed its Resend client at module load time, and a `resend` patch release (6.28.0 → 6.28.1) started throwing synchronously on a missing API key at construction — breaking the route's own test suite's stated intent ("route loads without email credentials and returns 503"). Fixed by reading the API key and constructing the Resend client at request time inside the handler, exactly matching what the test file was already asserting. Pinned `resend` to the exact `6.28.0` from the original lockfile as well, though the request-time fix is what actually resolved it.

None of these change what a visitor or a classroom participant sees or experiences — they're infrastructure/dependency-resolution fixes and pre-existing bug fixes surfaced by the migration, not redesign.

## Verification performed for this phase

- `apps/realtime`: lint, typecheck, 63/63 Vitest (including this session's TURN-relay and flood-limiter regression tests).
- `apps/classroom`: lint, typecheck, 26/26 Vitest, production build (~364 KB gzip initial JS, unchanged from before the move), **40/40 Playwright** (Chromium + Firefox) — including the real 4-participant/6-edge-mesh scenario and the collaborative whiteboard, run against the new dual-workspace dev startup (`apps/realtime` + `apps/classroom` launched together via the root `npm run dev`).
- `apps/web`: lint, typecheck, 12/12 content/link tests, production build (all 18 routes render).
- Root aggregate `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` all pass across every workspace.

## Phase B — auth foundation

Adds `apps/web`'s `/login`, a development-only in-memory credential store (five fictional seed accounts, scrypt-hashed passwords), server-issued sessions (HTTP-only cookie, validated server-side against an in-memory session store, never trusting the cookie's mere presence), and role guards (`requireSession`/`requireRole`/`requireRoleForApi`). A minimal `/dashboard` shell renders role-differentiated placeholder copy; `/dashboard/admin` is the first real role-restricted route, proving the guard mechanism end to end. See `docs/AUTHENTICATION.md`, `docs/ROLE_PERMISSIONS.md`, and `docs/DEVELOPMENT_ACCOUNTS.md`.

Two real bugs found and fixed while building this phase's own test coverage (both in the *tests*, not the app, caught by the tests failing loudly rather than passing on a false premise):

- Next.js 16's dev server treats `127.0.0.1` and `localhost` as different origins and silently returns 403 for `/_next/static` chunk requests from `127.0.0.1` — which meant zero client JS loaded and every button/form on the page was inert, with no visible error banner. The Playwright config's `baseURL`/`webServer.url` needed to be `localhost`, not `127.0.0.1`.
- The login E2E test helper's `.click()` on the sign-in button only waits for the click event to dispatch, not for the async fetch-then-`router.push()` chain it triggers — a caller's next `page.goto()` could race ahead of the actual login completing. Fixed by waiting for the resulting URL change alongside the click.

Verification: 21/21 Node `--test` unit tests (password hashing, dev credential store — valid/invalid/unknown/disabled login, case-insensitive email) + 12/12 Playwright E2E scenarios (login, logout, session persistence across reload, role-gated route access proven for Tutor/Client/Admin, already-authenticated redirect, password show/hide, empty-submission validation) — all against a real running `next dev` server (not `next start`; see `docs/AUTHENTICATION.md`'s production-safety note for why). Full workspace lint/typecheck/build still pass, and all 18 original marketing routes remain statically prerendered — the new auth-aware routes (`/login`, `/dashboard`, `/dashboard/admin`, the two `/api/auth/*` routes) are the only ones now server-rendered on demand, exactly as expected.

## Phase C — People and Tuition Assignments

Adds `packages/data` (the domain/data-access layer named as mandatory back in Phase A's boundary list, introduced now that there's an actual domain to model): `Tutor`, `Client`, `Student`, `ClientStudentLink` (many-to-many — a plan-specified requirement, not a 1:1 assumption), and `TuitionAssignment`, each behind a repository interface with one implementation today (`InMemoryDataProvider`, seeded with the plan's own demo scenario — Jamie Patel/Sarah Ahmed/Ayaan Ahmed/GCSE Mathematics). Admin-only pages for listing/creating people and assignments, using Next.js Server Actions for mutations (each re-checking `requireRole(["ADMIN"])` itself, since a Server Action is a callable POST endpoint independent of which page renders a form pointing at it). See `docs/DOMAIN_MODEL.md`.

Found and fixed one real bug in this phase's own test infrastructure: the `apps/web/tests/auth.test.mjs` TypeScript-loading helper (built in Phase B to load `devProvider.ts` without a compiled JS build step) only recursively transpiled *relative* imports; once `devProvider.ts` started importing `@learnthrive/data/inMemoryProvider` (a workspace package, also raw TS source with no compiled JS), that import fell through to real Node `require()`, which resolved the file via `node_modules` but then hit Node's own native TypeScript type-stripping — which doesn't support constructor parameter properties, a feature `packages/data`'s repository classes use. Fixed by extending the test loader to route `@learnthrive/data/*` specifiers through its own recursive transpiler too, anchored to a fixed, known path rather than re-derived per caller.

Verification: 6/6 new `packages/data` unit tests (repository CRUD, the many-to-many Client↔Student relationship, seed-data integrity), apps/web unit tests still 21/21, and 4 new Playwright E2E scenarios (Admin sees the seeded demo data, Admin adds a new Tutor, Admin creates a new Tuition Assignment, a Tutor is blocked from the people-management routes) — 16/16 alongside Phase B's existing 12. Full workspace lint/typecheck/test/build pass; the marketing site's 18 static routes remain untouched.

## What's next

Phase D (calendar and lessons) is the next phase in the plan's own sequence — see `plan5.md` (private) for the full phase sequence.
