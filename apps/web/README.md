# LearnThrive Tuition — web app

Next.js app serving the public LearnThrive Tuition marketing website, the authenticated tutoring
platform (accounts, calendar, lessons, attendance, reports, notifications), and the real-time
classroom UI (`src/features/classroom`, lazy-loaded only when a Lesson's classroom route is
opened) — all under one origin, via a custom server that also hosts Socket.IO. See the
[repository root README](../../README.md) and [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
for the full picture; this file covers only what's specific to running/testing this workspace.

## Local development

From the repository root (this app is one workspace in an npm workspaces monorepo — see the root
README):

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. This runs `tsx server.ts` (this workspace's own `dev` script) — a
custom Node HTTP server, not plain `next dev`. A plain `next dev` (no Socket.IO, no classroom
real-time features) is still available as `npm run dev:next --workspace=apps/web` if you only
need the marketing/dashboard pages and want faster Turbopack-only reloads.

Log in at `/login` with one of the accounts in
[docs/DEVELOPMENT_ACCOUNTS.md](../../docs/DEVELOPMENT_ACCOUNTS.md). **Must run in dev mode** — the
development auth provider deliberately refuses to run under `NODE_ENV=production`; see
[docs/AUTHENTICATION.md](../../docs/AUTHENTICATION.md). This means `npm run build && npm start`
is useful only as a build/typecheck verification gate, never as a real way to run this app.

## Quality checks

```bash
npm run lint
npm run typecheck
npm run test        # node --test — unit/integration tests, no browser needed
npm run test:e2e    # Playwright — starts the real unified dev server and drives a real browser
npm run build        # next build — also the closest thing to a production-mode sanity check
```

`npm run test:browser` (`scripts/browser-check.mjs`) is a separate, older responsive/accessibility
screenshot check inherited from the original marketing site, writing review screenshots to
`artifacts/browser` using a locally installed Chrome or Edge — useful for a quick visual pass over
the public pages specifically, distinct from `test:e2e`'s Playwright suite.

## What's here

- `src/app/` — every route: public marketing pages, `/login`, `/dashboard/**` (the authenticated
  platform), `/dashboard/lessons/[id]/classroom` (a Lesson's classroom), `/dev/classroom`
  (hidden, development-only manual join/test route), and the API routes.
- `src/features/classroom/` — the real-time classroom UI, ported from the original standalone
  `apps/classroom` Vite app (Call/Board/Present, whiteboard, moderation, chat, polls, timer,
  Help Queue, and all its other existing behaviour — see
  [docs/CLASSROOM_INTEGRATION.md](../../docs/CLASSROOM_INTEGRATION.md)).
- `src/lib/` — auth, the domain-layer client, scheduling/attendance/report/notification services,
  and every Server Action.
- `server.ts` — the custom unified server (Next.js + Socket.IO on one HTTP server/port).
- `tests/` (unit) and `tests-e2e/` (Playwright) — see the Quality checks commands above.

## Enquiries

The booking form prepares an email addressed to the published LearnThrive inbox via the
`/api/enquiry` route (`RESEND_API_KEY`/`ENQUIRY_EMAIL` — see `.env.example`). The FAQ page and
homepage preview share `src/lib/faqs.ts`. Privacy, Cookies, Website Terms and Safeguarding pages
describe the marketing/enquiry side of the site specifically, not the authenticated platform.

The old public tutor directory URLs permanently redirect to About. "Tutor login" in the footer
now routes to this platform's own `/login` — there is no external Tutor login anymore.
