# Development Accounts

These are **fictional, development-only accounts**, seeded in-memory by `apps/web/src/lib/auth/devProvider.ts` every time the dev server starts (and lost every time it restarts — nothing here persists). None of these names, emails or credentials refer to real people. This file is safe to have in source control precisely because none of it is real and none of it works anywhere except a local development server running with `NODE_ENV` not set to `production` — see `docs/AUTHENTICATION.md`'s "Production safety" section for why that's a hard guarantee, not just a convention.

Log in at `/login`.

| Role | Email | Password | Notes |
| --- | --- | --- | --- |
| Admin | `admin@learnthrive.dev` | `dev-admin-pass` | |
| Tutor | `tutor@learnthrive.dev` | `dev-tutor-pass` | |
| Client | `client@learnthrive.dev` | `dev-client-pass` | Parent/guardian role |
| Student | `student@learnthrive.dev` | `dev-student-pass` | |
| (disabled) | `disabled@learnthrive.dev` | `dev-disabled-pass` | Deliberately inactive — exists specifically to exercise the "this account has been disabled" login state without any extra setup. |

To add another seed account, edit `SEED_ACCOUNTS` in `apps/web/src/lib/auth/devProvider.ts`. Passwords are hashed (scrypt) at seed time, same as any real login — there's no separate "dev mode skips hashing" code path.

## Resetting

Restart the dev server (`npm run dev --workspace=apps/web`, or the root `npm run dev:web`). The in-memory user store and every issued session are both wiped — there's no separate reset command needed yet (plan section 98's `npm run dev:reset-data` becomes relevant once there's actual domain data — students, lessons, reports — worth resetting; the auth store alone doesn't need one).
