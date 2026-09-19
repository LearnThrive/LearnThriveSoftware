# Development Accounts

These are **development-only accounts**, seeded in-memory by `apps/web/src/lib/auth/devProvider.ts` every time the dev server starts (and lost every time it restarts — nothing here persists). The credentials themselves are fixed dev-only passwords, not real ones, and this file is safe to have in source control because none of them work anywhere except a local development server running with `NODE_ENV` not set to `production` — see `docs/AUTHENTICATION.md`'s "Production safety" section for why that's a hard guarantee, not just a convention.

Log in at `/login`.

| Role | Name | Email | Password | Notes |
| --- | --- | --- | --- | --- |
| Admin | Alvi Hossain | `admin@learnthrive.dev` | `dev-admin-pass` | |
| Tutor | Tahasin Hasan | `tutor@learnthrive.dev` | `dev-tutor-pass` | |
| Client | Abdurrahman Mustafa | `client@learnthrive.dev` | `dev-client-pass` | Parent/guardian role |
| Student | Brian James Khalawon | `student@learnthrive.dev` | `dev-student-pass` | |
| (disabled) | Disabled Test Account | `disabled@learnthrive.dev` | `dev-disabled-pass` | Deliberately inactive — exists specifically to exercise the "this account has been disabled" login state without any extra setup. |

To add another seed account, edit `SEED_ACCOUNTS` in `apps/web/src/lib/auth/devProvider.ts`. Passwords are hashed (scrypt) at seed time, same as any real login — there's no separate "dev mode skips hashing" code path.

## Resetting

Two options, for two different things:

- **Restarting the dev server** (`npm run dev --workspace=apps/web`, or the root `npm run dev:web`) wipes everything — the in-memory user store, every issued session, and all domain data (people, lessons, reports, notifications).
- **"Reset demo data"** on `/dashboard/admin` (Admin only, hidden when `NODE_ENV=production`) — plan section 98's deliberate reset-without-restarting: `POST /api/dev/reset` discards whatever domain data (extra people, lessons, reports, notifications) accumulated during the current dev-server process, and restores the fixed seed scenario (`packages/data/src/inMemoryProvider.ts`'s `resetDataProvider()`), **without** logging anyone out — the auth/session store is untouched, since accumulated test clutter is a domain-data problem, not a login problem. The route is guarded twice: a hard `NODE_ENV === "production"` check (throws, doesn't silently no-op) and `requireRoleForApi(["ADMIN"])`.
