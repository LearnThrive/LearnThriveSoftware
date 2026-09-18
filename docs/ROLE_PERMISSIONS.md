# Role Permissions

## Roles

```ts
type Role = "ADMIN" | "TUTOR" | "CLIENT" | "STUDENT";
```

`CLIENT` is the parent/guardian/fee-payer role — see plan section 14: a Client is not assumed to equal a Student (a Client can have multiple Students; the domain model in Phase C is what actually represents that relationship — this file only covers what exists today, the platform-account role itself). `STAFF` is named as a future possibility in the plan behind this migration and is deliberately not built — see `docs/PRODUCTION_GAPS.md` once that file exists.

## What's actually enforced today (Phase B)

Authorization is enforced **server-side only** — every check below runs in a Server Component or Route Handler, reading the server-validated session (see `docs/AUTHENTICATION.md`), never a client-supplied value. There is no route or operation in this codebase that is merely hidden by CSS or client-side routing without an equivalent server check; the plan behind this migration is explicit that this would not count as enforcement.

| Route | Who can reach it | Enforcement |
| --- | --- | --- |
| `/login` | Anyone unauthenticated. An authenticated visitor is redirected straight to `/dashboard`. | `apps/web/src/app/login/page.tsx` |
| `/dashboard` and everything under it | Any authenticated user (role-agnostic at this level) | `apps/web/src/app/dashboard/layout.tsx` via `requireSession()` |
| `/dashboard/admin` | `ADMIN` only. Any other authenticated role is redirected to `/403`. | `apps/web/src/app/dashboard/admin/page.tsx` via `requireRole(["ADMIN"])` |
| `/api/auth/login`, `/api/auth/logout` | Anyone (these routes *are* the authentication mechanism) | No guard — by design |

This table grows with every phase that adds a route. `/dashboard/admin` exists specifically to prove the `requireRole`/`/403` mechanism works end to end (see the Playwright suite at `apps/web/tests-e2e/auth.spec.ts`) ahead of Phase C giving Admin something substantial to manage.

## What each role will see (future phases — not built yet)

This is the plan's intended shape, recorded here so later phases have one place to check against rather than re-deriving it from the plan document each time. **None of this exists yet** beyond the placeholder `/dashboard` welcome copy already in place.

- **Admin**: full operational access — all lessons, all people (Tutors/Clients/Students), all reports, scheduling, report approval, platform settings.
- **Tutor**: only their own assigned lessons and students (via Tuition Assignments), their own submitted reports, their own availability.
- **Client**: only lessons and reports belonging to their associated Students — never another family's data, never a Tutor's private notes, never Tutor pay/earnings.
- **Student**: only their own lessons, their own permitted feedback (approved reports only, per the report-visibility model in `docs/LESSON_REPORTS.md` once that exists) — the narrowest view of any role.

## Future Supabase Row Level Security

Once a real database exists (see `docs/SUPABASE_MIGRATION.md`), the same rules above are expected to be enforced twice: once in application services (as today) and once in the database itself via Postgres Row Level Security, so a bug in application code can't become a full data leak. That RLS policy design is out of scope until Supabase migration actually begins — see plan section 100.
