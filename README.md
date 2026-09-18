# LearnThrive

This repository is the beginning of the unified LearnThrive Tuition platform: the public marketing website, the authenticated tutoring platform (accounts, calendar, lessons, reports), and the real-time classroom, converging into one product.

It is an npm workspace monorepo with four members:

```
apps/
  web/         Next.js — public marketing site + (from Phase B onward) the authenticated platform
  classroom/   Vite + React — the existing real-time classroom (Call/Board/Present, whiteboard, moderation)
  realtime/    Express + Socket.IO — the classroom's signalling/TURN backend
packages/
  shared/      Protocol types and constants shared by apps/classroom and apps/realtime
```

`apps/classroom` and `apps/realtime` are the pre-existing classroom prototype, moved here largely unchanged (see [apps/classroom/README.md](apps/classroom/README.md) for everything classroom-specific — features, testing, TURN, browser support). `apps/web` is the marketing site migrated from the separate `D:\LearnThrive` repository (kept as read-only source material during that migration — never modified).

## Why this structure

The plan behind this migration ([plan5.md](plan5.md), private/gitignored) requires four boundaries to be real, not just conventions: the web application, the realtime/classroom service, the domain/data access layer, and shared models/permissions must all be genuinely separable. This workspace layout is that separation — each `apps/*` directory is an independently runnable, independently testable unit with its own `package.json`, and `packages/shared` is the only thing more than one app is allowed to import from.

The classroom was **not** rewritten into Next.js this pass. It's a substantial, well-tested real-time application (WebRTC mesh, a collaborative whiteboard, extensive Playwright coverage); moving it wholesale into a different framework in the same pass as a large structural migration would be exactly the kind of destabilising rewrite this plan explicitly warns against. It's kept as `apps/classroom`, an independent Vite app, with a documented integration boundary — future phases mount authenticated lessons into it rather than reimplementing it.

## Local development

```bash
npm install
npm run dev
```

This starts both `apps/realtime` (the signalling/TURN server, port 3001) and `apps/classroom` (the Vite dev server, port 5173) together. Open `http://127.0.0.1:5173/meeting` for the classroom directly during development.

To run the marketing/platform web app instead (or alongside):

```bash
npm run dev:web
```

Open `http://localhost:3000`. Log in at `/login` with one of the five development accounts in [docs/DEVELOPMENT_ACCOUNTS.md](docs/DEVELOPMENT_ACCOUNTS.md) to reach `/dashboard`. **Must run in dev mode** (`next dev`, not `next start`) — the development auth provider deliberately refuses to run under `NODE_ENV=production`; see [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md).

### Environment variables

Each app owns its own `.env` (never committed) — see that app's own `.env.example`:

- `apps/realtime/.env.example` — Cloudflare Realtime TURN credentials (`CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN`). See [apps/classroom/TURN_TESTING.md](apps/classroom/TURN_TESTING.md).
- `apps/web/.env.example` — enquiry-form email (`RESEND_API_KEY`, `ENQUIRY_EMAIL`).

**If you're migrating from before this restructuring**: your real `.env` (with the Cloudflare TURN credentials) is likely still sitting at the repository root — move it to `apps/realtime/.env`. This tool was blocked by its own sandbox from touching real `.env` files directly, so that one move needs to be done by hand.

## Quality checks

Run per app (each is independently testable):

```bash
npm run lint --workspace=apps/classroom
npm run typecheck --workspace=apps/classroom
npm run test --workspace=apps/classroom
npm run test:browser --workspace=apps/classroom   # Playwright — starts both apps/realtime and apps/classroom
```

Swap `apps/classroom` for `apps/realtime` or `apps/web` for that app's checks. Or run everything at once from the root:

```bash
npm run lint         # all workspaces
npm run typecheck     # all workspaces
npm run test          # all workspaces (vitest for classroom/realtime, node --test for web)
npm run build          # classroom build, realtime typecheck, web build
```

## Documentation

- [apps/classroom/README.md](apps/classroom/README.md) — the classroom app: features, architecture, testing, TURN, browser support, production gaps (classroom-specific).
- [apps/web/README.md](apps/web/README.md) — the marketing site: local development, quality checks, enquiry form.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — this repository's overall structure and the reasoning behind it.
- [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) — the development auth provider, password hashing, sessions, production safety.
- [docs/ROLE_PERMISSIONS.md](docs/ROLE_PERMISSIONS.md) — roles and what's actually enforced where.
- [docs/DEVELOPMENT_ACCOUNTS.md](docs/DEVELOPMENT_ACCOUNTS.md) — the five seeded dev accounts and their credentials.

Further platform-level docs (domain model, scheduling, lesson reports, Supabase migration plan, platform-wide production gaps) land as the corresponding phases of this migration are implemented — see `docs/` as it grows.

## Status

This is a **development platform**, not production-ready. As of this migration (Phase A — repository convergence, Phase B — auth foundation), there is real login/logout/sessions/role guards, but no accounts beyond five fictional in-memory dev users, and no domain model beyond the classroom's own ephemeral, in-memory room state — those are later phases of the same plan. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for what exists today versus what's planned.
