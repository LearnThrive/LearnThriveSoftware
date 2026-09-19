# Classroom integration

Covers Phase E: how the platform (`apps/web`) hands a logged-in Tutor or Student into the
LearnThrive Classroom for a specific `Lesson`, without the classroom itself needing to know
anything about platform accounts.

> **Updated for plan6 Slice A** (single-origin convergence): the classroom UI described here now
> renders *inside* `apps/web` (`apps/web/src/features/classroom`, a direct port of the original
> `apps/classroom` source) and joins over the same origin's Socket.IO endpoint, rather than
> redirecting to a separate `apps/classroom` dev server on its own port. The trust boundary, the
> token, and everything below it are unchanged — see `docs/ARCHITECTURE.md`'s "Plan6 —
> single-origin convergence" section for what actually changed and why `apps/classroom` still
> exists as its own workspace (as the source of truth this feature is ported from, and as a
> standalone prototype `npm run dev --workspace=apps/classroom` can still run on its own).

## The trust boundary (plan section 34, 37)

`apps/classroom`/`apps/realtime` have no concept of platform identity — historically, joining is
just "type a name and a room code". Section 37 is explicit: *"Do not use obvious sequential
lesson IDs as the sole access secret. Authentication/authorisation is what secures access."*

So the two apps stay separate, and a short-lived, signed **classroom join token** is the only
thing that crosses between them:

1. `apps/web`'s `joinClassroomAction` (`apps/web/src/lib/actions/classroom.ts`) re-checks the
   full plan section 34 checklist server-side, every time, regardless of what the calling page
   already decided:
   - logged in (`requireSession()`)
   - the requester is actually the Tutor or a Student on *this* `Lesson`
   - the lesson is `ONLINE` and has a `classroomRoomId`
   - the lesson is not `CANCELLED`
   - the request falls inside the lesson's join window (see below)
2. If every check passes, it signs a token via `@learnthrive/shared/classroomToken`'s
   `signClassroomJoinToken({ roomId, lessonId, name, role, exp })` — `exp` is 5 minutes out,
   deliberately short: the token only needs to survive the redirect, not the whole lesson.
3. It redirects to `/dashboard/lessons/${lesson.id}/classroom?token=<token>` — a route inside
   `apps/web` itself (see the single-origin note above; before Slice A this redirected to a
   separate `apps/classroom` origin instead).
4. That route renders `apps/web/src/features/classroom/App.tsx`, which detects `?token=` on load
   and auto-joins (`meeting.ts`'s `join(name, roomId, role, token)`), **skipping the manual
   name/room-code form entirely** — the token is stripped from the address bar as soon as it's
   used.
5. `apps/web/server.ts`'s embedded Socket.IO server (`createSignallingServer`, the same
   `apps/realtime/server/signalling.ts` code the standalone `apps/realtime` app also runs)
   verifies the token server-side
   (`verifyClassroomJoinToken`) and, on success, uses **only the token's own `roomId`/`name`/
   `role`** for the join — never a client-declared value sent alongside it, even if one is
   present. This is what stops a modified client from claiming a different name or role than the
   one the platform actually authorized.

The pre-existing manual name/room-code entry path is left completely intact as a fallback (plan
section 36 explicitly allows a dev/test role-picker route) — `apps/realtime` picks the token
branch only when the incoming `room:join` payload actually includes a `token` field.

## Join window (plan section 35)

Configurable, not hardcoded into the authorization check itself —
`apps/web/src/lib/scheduling/joinWindow.ts`:

| | Tutor | Student |
|---|---|---|
| Opens before start | 30 minutes | 10 minutes |
| Closes after scheduled end | 30 minutes (both) | |

A Tutor gets in early to set up; a Student's window opens closer to the actual start; both stay
open a little past the scheduled end time in case a lesson overruns. Covered by
`apps/web/tests/joinWindow.test.mjs`.

## Room identity

`Lesson.classroomRoomId` (`packages/data/src/domain.ts`) — a fresh `crypto.randomUUID()`,
generated once per lesson **occurrence** at creation time (`schedulingService.ts`'s
`createLessonOrSeries`), never derived from or shared with the lesson's own id, and never reused
across occurrences of the same recurring series. Only set for `ONLINE` lessons.

## Environment variables

`.env.example` files could not be created in this pass (sandbox permissions on this tool deny
touching any `.env*` path, even a template with no real secret in it) — set these manually:

**`apps/web/.env.local`**
```
CLASSROOM_JOIN_SECRET=<any long random string>
```

`NEXT_PUBLIC_CLASSROOM_URL` is no longer read since Slice A — the classroom route is
same-origin now, so there's nothing external to point at. `CLASSROOM_JOIN_SECRET` only needs to
match a *separately deployed* `apps/realtime` if one is standing in for the embedded signalling
server (see `docs/ARCHITECTURE.md`'s production-separation note); for ordinary local development
against the single unified server, it can be left unset entirely.

If unset, `apps/web` falls back to the same hardcoded dev-only string
(`packages/shared/classroomToken.ts`'s `DEV_FALLBACK_SECRET`) so local development works
out-of-the-box with no manual setup. **This fallback is not how a real secret should be managed
in production** — see `docs/PRODUCTION_GAPS.md`.

## What's not built yet

- The classroom has no way to *tell* the platform a lesson actually happened, was joined, or ran
  long — attendance is entirely Tutor-entered on the platform after the fact (Phase F). Nothing
  auto-populates it from a real join/leave event.
- A real secrets manager for `CLASSROOM_JOIN_SECRET` in production, with rotation.

Phase F (Attendance and Lesson Logs) already built the post-class workflow this section
originally listed as future work: ending a class as Tutor returns to the Lesson page with
`?postClass=1`, prompting attendance and the report — see `docs/ATTENDANCE.md` and plan6 section
62.
