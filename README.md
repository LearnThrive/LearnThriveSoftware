# LearnThrive

The unified LearnThrive Tuition platform: the public marketing website, the authenticated tutoring platform (accounts, calendar, lessons, attendance, reports, notifications), and the real-time classroom — one product, one dev server, one origin.

It is an npm workspace monorepo with four members:

```
apps/
  web/         Next.js — public marketing site, the authenticated platform, AND the classroom UI
               (apps/web/src/features/classroom — see "Single dev server" below), all served
               from one custom Node server (apps/web/server.ts) that also hosts Socket.IO
  classroom/   Vite + React — the ORIGINAL standalone classroom, kept only for its own existing
               test suite during the transition (see "The retired standalone classroom" below)
  realtime/    Express + Socket.IO — the classroom's signalling/TURN backend, now a library
               (`createSignallingServer()`) that apps/web's server.ts attaches to its own HTTP
               server; still runnable standalone too (apps/realtime/server/index.ts)
packages/
  data/        The domain/repository layer (Tutors, Clients, Students, Lessons, Reports, ...)
  shared/      Protocol types, the classroom join-token contract, and constants shared across apps
```

`apps/web` is the marketing site migrated from the separate `D:\LearnThrive` repository (kept as read-only source material during that migration — never modified), now grown into the full platform.

## Single dev server

```bash
npm install
npm run dev
```

Open **`http://localhost:3000`** — that one origin serves the public site, the authenticated dashboard, the API routes, the classroom UI, and Socket.IO together. Log in at `/login` with one of the development accounts in [docs/DEVELOPMENT_ACCOUNTS.md](docs/DEVELOPMENT_ACCOUNTS.md) to reach `/dashboard`. **Must run in dev mode** — the development auth provider deliberately refuses to run under `NODE_ENV=production`; see [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md).

Under the hood, `npm run dev` runs `apps/web`'s own `dev` script, `tsx server.ts` — a custom Node HTTP server that hosts Next.js's request handler and an attached Socket.IO server side by side (see `docs/ARCHITECTURE.md`). There is no second process, no second port, and nothing else to start manually: the classroom's real-time signalling logic (`apps/realtime/server/signalling.ts`, unchanged) is imported as a library and wired to that same server, and its React UI (`apps/web/src/features/classroom/`, ported from the original `apps/classroom`) is lazy-loaded only when a Lesson's classroom route is actually opened.

### Study Buddy's model and voice (Docker)

`npm run dev` also starts, before the site, the two services Study Buddy needs, in Docker ([config/compose.yaml](config/compose.yaml), started by [scripts/dev-services.mjs](scripts/dev-services.mjs)):

| Service | Address | What it is |
| --- | --- | --- |
| `ollama` | `http://127.0.0.1:11434` | the local language model (`ollama/ollama:0.35.0`, on the GPU). It uses the models already downloaded on this machine (`OLLAMA_MODELS`, here `D:\OllamaModels`); the default model is fetched once if missing |
| `voice` | `http://127.0.0.1:8765` | the speech sidecar (`services/voice/Dockerfile`: Whisper `small.en` on the GPU, Piper voices from `services/voice/models`) |

It needs Docker Desktop running with GPU support (WSL 2 and an NVIDIA driver), and the Piper voices downloaded once ([docs/VOICE.md](docs/VOICE.md)). Without Docker, or if a service fails, the site still starts and Study Buddy says it is unavailable. A service already running outside Docker (the Ollama app, `npm run voice:dev`) is used instead of starting a second one. The services keep running when the site stops:

```bash
npm run services:up        # start or check them without the site
npm run services:logs      # follow their logs
npm run services:down      # stop them
npm run services:rebuild   # after changing services/voice
```

Loading the model through the Windows folder mount takes about 85 s the first time; it then stays loaded for 30 minutes. `LEARNTHRIVE_DOCKER=0` skips all of this (the Playwright servers set it), and so do `ASSISTANT_PROVIDER=mock` with `VOICE_PROVIDER=mock`.

### Supabase on your machine (accounts, Library, storage)

The site runs on in-memory accounts by default. To run it on **real Supabase locally** (Postgres 17, Auth, Storage, a mail catcher): `npm run supabase:start` (needs Docker), set the four local `SUPABASE_*` / `DATABASE_URL` values in `apps/web/.env` as [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) says, and run `npm run test:realstack` to check it (174 tests against the real services). **Stop it with `npm run supabase:stop` when you are done:** the CLI publishes it on every network interface and serves a keyless SQL endpoint ([docs/SUPABASE_REAL_STACK.md](docs/SUPABASE_REAL_STACK.md)). Production setup, the dashboard checklist and the operations runbook: [SUPABASE_MIGRATION.md](docs/SUPABASE_MIGRATION.md), [SUPABASE_DASHBOARD_CHECKLIST.md](docs/SUPABASE_DASHBOARD_CHECKLIST.md), [SUPABASE_RUNBOOK.md](docs/SUPABASE_RUNBOOK.md). Check an environment without printing a value: `cd apps/web && npm run check:env`.

Joining a classroom happens from a Lesson — `/dashboard/lessons/:id` → **Join Classroom** → `/dashboard/lessons/:id/classroom` — never a separate site. A `/dev/classroom` route (hidden from all navigation, 404s outside development) retains the original manual name/room-code entry form for local debugging and is what `apps/classroom`'s own Playwright suite still drives.

## The retired standalone classroom

`apps/classroom` (the original Vite app) and running it directly (`npm run dev:standalone`, or `npm run dev --workspace=apps/classroom`) still work — kept specifically so `apps/classroom`'s own pre-existing test suite keeps running unmodified during the transition (see [apps/classroom/README.md](apps/classroom/README.md)) — but no normal development workflow needs it anymore. New classroom work happens in `apps/web/src/features/classroom/`.

### Environment variables

Each app owns its own `.env` (never committed) — see that app's own `.env.example`:

- `apps/realtime/.env.example` — Cloudflare Realtime TURN credentials (`CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN`). See [apps/classroom/TURN_TESTING.md](apps/classroom/TURN_TESTING.md).
- `apps/web/.env.example` — enquiry-form email (`RESEND_API_KEY`, `ENQUIRY_EMAIL`).

**If you're migrating from before this restructuring**: your real `.env` (with the Cloudflare TURN credentials) is likely still sitting at the repository root — move it to `apps/realtime/.env`. This tool was blocked by its own sandbox from touching real `.env` files directly, so that one move needs to be done by hand.

## Quality checks

Run per workspace (each is independently testable):

```bash
npm run lint --workspace=apps/web
npm run typecheck --workspace=apps/web
npm run test --workspace=apps/web
npx playwright test --workspace=apps/web   # apps/web's own Playwright suite (single-origin, auth, role journeys)
```

Swap `apps/web` for `apps/classroom`, `apps/realtime`, or `packages/data` for that workspace's checks (`apps/classroom` additionally has `npm run test:browser`, its own Playwright suite, driven via `/dev/classroom`). Or run everything at once from the root:

```bash
npm run lint         # all workspaces
npm run typecheck    # all workspaces
npm run test          # all workspaces (vitest for classroom/realtime, node --test for web/data)
npm run build          # classroom build, realtime typecheck, web build
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the single-server architecture, the web/realtime/shared/data boundaries, and the phase-by-phase history of this platform.
- [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) — the development auth provider, password hashing, sessions, production safety.
- [docs/ROLE_PERMISSIONS.md](docs/ROLE_PERMISSIONS.md) — roles and what's actually enforced where.
- [docs/DEVELOPMENT_ACCOUNTS.md](docs/DEVELOPMENT_ACCOUNTS.md) — the seeded dev accounts, their credentials, and resetting demo data.
- [docs/DOMAIN_MODEL.md](docs/DOMAIN_MODEL.md), [docs/SCHEDULING.md](docs/SCHEDULING.md), [docs/ATTENDANCE.md](docs/ATTENDANCE.md), [docs/LESSON_REPORTS.md](docs/LESSON_REPORTS.md), [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md) — the domain model, calendar/lessons, attendance, reports, and notifications.
- [docs/CLASSROOM_INTEGRATION.md](docs/CLASSROOM_INTEGRATION.md) — the signed join-token boundary between a Lesson and the classroom.
- [docs/HARDENING.md](docs/HARDENING.md) — the IDOR/access-control adversarial test checklist.
- [docs/SUPABASE_MIGRATION.md](docs/SUPABASE_MIGRATION.md) — the (unimplemented) future database schema map.
- [docs/PRODUCTION_GAPS.md](docs/PRODUCTION_GAPS.md) — everything genuinely standing between this and a real production deployment.
- [apps/classroom/README.md](apps/classroom/README.md) — the original standalone classroom app, kept for its own test suite (see "The retired standalone classroom" above).

## Status

This is a **development platform**, not production-ready — see [docs/PRODUCTION_GAPS.md](docs/PRODUCTION_GAPS.md) for the full, honest list. What's real today: login/logout/sessions/role guards; people management and tuition assignments; a full calendar (recurrence, drag-to-reschedule, conflict detection, DST-correct timezones); a signed-token classroom integration launched directly from a Lesson, in the same origin as everything else; attendance and a completion-gated lesson report workflow (draft/submit/approve, with a strict Parent-visible/internal-notes boundary); in-app notifications and an Admin activity feed. Nothing persists across a server restart, and there are no accounts beyond the seeded development ones.
