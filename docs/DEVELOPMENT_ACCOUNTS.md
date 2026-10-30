# Development Accounts

These are **development-only accounts**. The list lives in one file, `apps/web/src/lib/dev/accounts.ts`, and is seeded in memory every time the dev server starts (and lost every time it restarts — nothing here persists). The credentials themselves are fixed dev-only passwords, not real ones, and this file is safe to have in source control because none of them work anywhere except a local development server (`NODE_ENV=development`) — see `docs/AUTHENTICATION.md`'s "Production safety" section for why that's a hard guarantee, not just a convention.

Sign in at `/login`. It is the one sign-in for everybody (`docs/AUTHENTICATION.md`, "One sign-in"): the same page the Library and LearnThrive AI use.

| Role | Name | Email | Password | Library standing | Lands on, and finds |
| --- | --- | --- | --- | --- | --- |
| Admin | Alvi Hossain | `admin@learnthrive.dev` | `dev-admin-pass` | (by role: all of it) | `/dashboard`; LearnThrive AI and the Library in the menu |
| Tutor | Tahasin Hasan | `tutor@learnthrive.dev` | `dev-tutor-pass` | none | `/dashboard`; no LearnThrive AI or Library |
| Client | Abdurrahman Mustafa | `client@learnthrive.dev` | `dev-client-pass` | **enrolled** | `/dashboard`; LearnThrive AI and the Library in the menu. Parent/guardian role |
| Student | Brian James Khalawon | `student@learnthrive.dev` | `dev-student-pass` | **enrolled** | `/dashboard`; LearnThrive AI and the Library in the menu |
| Library member | Library Member | `member@learnthrive.dev` | `dev-member-pass` | **subscription**, not enrolled | `/library/ai`; the dashboard is closed to them |
| Visitor | New Visitor | `visitor@learnthrive.dev` | `dev-visitor-pass` | none | `/account`; LearnThrive AI says what it is included with |
| (disabled) | Disabled Test Account | `disabled@learnthrive.dev` | `dev-disabled-pass` | none | Deliberately disabled — exists to exercise the "this account has been disabled" sign-in state without any extra setup. |

"Library standing" is what the in-memory Library store is told about the account at start-up (an active tuition assignment, or an open subscription). The Library pages show their contents only when the Library is open (`LIBRARY_PHASE=enrolled` or `live`) and LearnThrive AI only when the assistant is configured: on a default dev server the menus show neither, honestly.

The tutor, parent and student accounts are linked to the seeded domain records (`packages/data`'s `SEED_IDS`), which is what the dashboard shows them. The administrator, the Library member and the visitor have no such record.

To add another account, add a row to `DEV_ACCOUNTS` in `apps/web/src/lib/dev/accounts.ts` (a fixed UUID, the `library` standing, and `domainId` if it should be a seeded tutor, parent or student). Passwords are hashed (scrypt) at seed time, same as any real sign-in — there's no separate "dev mode skips hashing" code path. `inDevProvider: true` also puts it in the development staff provider (`lib/auth/devProvider.ts`, API only: `POST /api/auth/login`), which now shares the same ids so a person is one person whichever way they are looked up.

## Resetting

Two options, for two different things:

- **Restarting the dev server** (`npm run dev --workspace=apps/web`, or the root `npm run dev:web`) wipes everything — the in-memory user store, every issued session, and all domain data (people, lessons, reports, notifications).
- **"Reset demo data"** on `/dashboard/admin` (Admin only, hidden when `NODE_ENV=production`) — plan section 98's deliberate reset-without-restarting: `POST /api/dev/reset` discards whatever domain data (extra people, lessons, reports, notifications) accumulated during the current dev-server process, and restores the fixed seed scenario (`packages/data/src/inMemoryProvider.ts`'s `resetDataProvider()`), **without** logging anyone out — the auth/session store is untouched, since accumulated test clutter is a domain-data problem, not a login problem. The route is guarded twice: a hard `NODE_ENV === "production"` check (throws, doesn't silently no-op) and `requireRoleForApi(["ADMIN"])`.
