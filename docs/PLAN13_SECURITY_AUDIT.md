# Plan 13 — Defensive Security Sweep and Hardening

plan13.md task 11. An owned-repository defensive review across the 12 areas the task specifies.
Performed directly against source (not via a research agent — the session's agent capacity hit a
rate limit mid-task, so this review reads and verifies the actual code itself throughout, same
discipline as the rest of plan13). Never prints a secret value; secrets are referenced only by
variable/file name.

**Summary: 24 items reviewed across 12 areas. 1 Critical (fixed), 2 High (fixed), 1 Medium (fixed),
2 informational/monitored (not forced — see 11.8), rest reviewed with no findings.**

---

## 11.1 Secrets and configuration

**Status:** reviewed.

- Both real `.env` files (`apps/web/.env`, `apps/realtime/.env`) are confirmed gitignored and were
  never tracked (`git ls-files` returns nothing for either; `git check-ignore -v` confirms
  `.gitignore`'s `.env` rule catches both). This session's own permission layer additionally denies
  reading `.env*` paths outright — respected throughout; this review never opened either file.
- Checked every `process.env.*` reference across `apps/` for anything secret-sounding reaching a
  `NEXT_PUBLIC_*` name (which Next.js bundles into client JS). Only two exist:
  `NEXT_PUBLIC_CLASSROOM_URL` (a URL, not a secret) and `NEXT_PUBLIC_MOTION_DEBUG` (a debug flag,
  not a secret). No secret is exposed to the client bundle.
- Variables that are genuinely secret (`RESEND_API_KEY`, `CLOUDFLARE_TURN_KEY_ID`,
  `CLOUDFLARE_TURN_API_TOKEN`, `CLASSROOM_JOIN_SECRET`) are referenced only in server-side files
  (`apps/web/src/app/api/enquiry/route.ts`, `apps/realtime/server/signalling.ts`,
  `packages/shared/classroomToken.ts`) — never in a `"use client"` file.
- No `console.log`/`console.error`/`console.warn` call anywhere in `apps/web/src` references
  `password`, `token`, or `session` in its message (checked directly, see 11.9).

**Finding — High, fixed:** see 11.2, `CLASSROOM_JOIN_SECRET`'s production fallback.

---

## 11.2 Authentication and session handling

**Status:** reviewed.

- `apps/web/src/lib/auth/session.ts`: session cookie is `httpOnly: true`, `sameSite: "lax"`,
  `secure: process.env.NODE_ENV === "production"`, `path: "/"`. A non-remembered login omits
  `maxAge` (real browser-session cookie). Session ID is `randomUUID()`, generated fresh on every
  `createSession()` call — login always issues a new identifier, so there is no session-fixation
  path (a pre-auth session ID is never "upgraded" to authenticated). `getSession()` validates
  against the server-side store and checks expiry on every read, never trusts cookie presence
  alone. `destroySession()` removes both the server record and the cookie.
- `apps/web/src/lib/auth/devProvider.ts`'s `assertNotProductionWithoutRealProvider()` is already a
  hard, deliberate fail-closed guard: importing the dev auth provider with `NODE_ENV=production`
  throws at startup rather than silently serving hardcoded accounts. Called on every
  `getAuthProvider()` invocation. A disabled account (`!user.active`) is correctly rejected with a
  distinct reason from a wrong password.
- Every server action checked (see 11.3) calls `requireSession`/`requireRole` before doing
  anything — authorization is never inferred from what the UI happens to show.

**Finding — High, fixed:** `packages/shared/classroomToken.ts` had the *same class* of gap
`devProvider.ts` already guards against, but without the guard. Both `apps/web` and
`apps/realtime` sign/verify classroom join tokens with `CLASSROOM_JOIN_SECRET`, falling back to a
hardcoded `DEV_FALLBACK_SECRET` string (checked into source) if the env var is unset — already
documented as a known gap in `docs/PRODUCTION_GAPS.md`, but with no enforcement: a production
deployment that forgot to set the secret would silently sign tokens with a secret anyone who has
ever read this source can reproduce, letting them forge a valid join token for any room. Fixed by
making `secret()` throw if `NODE_ENV === "production"` and `CLASSROOM_JOIN_SECRET` is unset —
mirroring `devProvider.ts`'s existing convention exactly. Verified: `apps/realtime`'s 68-test suite
and both `apps/web`/`apps/realtime` typechecks stayed green after the change (dev/test `NODE_ENV`
is never `"production"`, so the fallback still works exactly as before there).

---

## 11.3 Authorization / IDOR / tenant boundaries

**Status:** reviewed.

Read every exported function in `apps/web/src/lib/actions/*.ts` (`attendance.ts`, `availability.ts`,
`classroom.ts`, `lessons.ts`, `notifications.ts`, `people.ts`, `reports.ts`) and the lesson-detail
page's own guard. Every mutating action follows the same pattern, confirmed by reading — not
assumed from naming:

1. `requireSession()`/`requireRole([...])` first — authenticated, and of an allowed role.
2. The specific resource (lesson, report, etc.) is fetched, and ownership is checked explicitly:
   e.g. `attendance.ts`'s `markAttendanceAction` verifies `lesson.tutorId === user.profileId` for a
   TUTOR caller *and* that the target `studentId` is actually on that lesson before marking
   attendance for them — both checks, not just the first.
3. `reports.ts`'s `requireOwningTutorOrAdmin` helper centralizes the same pattern for all three
   report actions; `approveReportAction` correctly restricts to ADMIN only (a Tutor cannot
   self-approve their own report).
4. `apps/web/src/app/(app)/dashboard/lessons/[id]/page.tsx`'s `canView()` explicitly distinguishes
   "lesson doesn't exist" (`notFound()` → 404) from "you can't see this lesson" (`redirect("/403")`)
   — already covered by an adversarial ID-swap test per its own comment, referencing
   `tests-e2e/lessons.spec.ts`.
5. `classroom.ts`'s `joinClassroomAction` re-verifies every check from plan section 34
   (authenticated, role, assignment to *this* lesson, lesson is online, not cancelled, within the
   join window) server-side, explicitly never trusting that the page which linked here already did
   so — a Server Action is its own POST endpoint.

No finding. This is a consistently and carefully applied boundary, not a gap.

---

## 11.4 Input validation and output encoding

**Status:** reviewed.

- The one `dangerouslySetInnerHTML` in the entire `apps/web` codebase
  (`apps/web/src/app/layout.tsx`, JSON-LD organisation structured data) sources from a static,
  module-level constant — never user or request input — and additionally escapes `<` to
  `<` against script-tag breakout, beyond what's strictly required. Safe.
- `apps/web/src/app/api/enquiry/route.ts`'s `validateBody()` enforces required fields, per-field
  length limits (`fieldLimits`), email shape, and a minimum support-text length; `escapeHtml()`
  escapes all five fields before they're interpolated into the notification email's HTML. No
  reflected/stored XSS path found in the enquiry flow.
- No use of `eval`, `new Function(...)`, or `Object.assign`/spread merging untrusted request bodies
  directly onto a trusted object anywhere in `apps/web/src` or `apps/realtime/server`.
- `apps/realtime/server/signalling.ts`'s socket handlers consistently validate payload shape with
  `isRecord()`/explicit field-type checks before use (confirmed by reading the `room:admit`,
  `board:update`, and chat handlers) rather than trusting the client-sent object shape.

No finding.

---

## 11.5 CSRF, origin and request integrity

**Status:** reviewed.

- `apps/web/src/app/api/enquiry/route.ts` has an explicit `Origin` allowlist check
  (`ALLOWED_ORIGINS`), rejecting a present-but-mismatched Origin with 403 while correctly not
  penalizing requests with no Origin header (server-to-server calls, this route's own test suite) —
  preserved as-is, not touched this pass.
- `apps/web/next.config.ts` has no `experimental.serverActions.allowedOrigins` override, meaning
  Next.js's own default, restrictive same-origin check for Server Actions (automatic since 13.4) is
  intact and unweakened.
- The session cookie's `sameSite: "lax"` (11.2) gives baseline protection against cross-site
  top-level-navigation requests riding an authenticated session.
- No GET route was found that causes a mutation — every state-changing endpoint checked
  (`/api/auth/login`, `/api/enquiry`, every server action) is POST-only by construction (server
  actions are always POST; the two API routes only export `POST`).

No finding.

---

## 11.6 Rate limiting and abuse controls

**Status:** reviewed.

- `apps/web/src/app/api/enquiry/route.ts` already had a proven in-memory sliding-window limiter
  (5 per 15 minutes per IP, with a 10-minute prune interval so the bucket map can't grow unbounded).
  Preserved as-is.
- `apps/realtime/server/signalling.ts` already rate-limits `board:update` floods and TURN-credential
  requests (both confirmed via `signalling.test.ts`'s own passing tests for each).
- Room-admission capacity (`admitWaitingId`) checks `studentCount(room) >= MAX_STUDENTS` and admits
  synchronously with no `await` in between — Node's single-threaded event loop makes this atomic in
  practice; re-checked fresh on every iteration of `room:admit-all`'s loop. No capacity race found.

**Finding — Medium, fixed:** `/api/auth/login` had **no rate limiting at all**. scrypt's own
computational cost (11.2) slows a single password guess but does nothing against many
parallel/automated ones. Fixed with the same sliding-window shape as the enquiry route, but keyed
by `ip:email` rather than `ip` alone — an IP-only bucket means every login attempt sharing a
source (a NAT, a proxy that doesn't forward `x-forwarded-for`, or this project's own dev/test
environment, which always falls back to one `"unknown"` IP) would share one counter regardless of
which account is targeted, locking out unrelated logins to *different* accounts. Per-account,
per-source is the standard "account lockout" pattern: it still fully stops credential-stuffing of
any one target account, without that collateral damage. This was caught empirically, not just
reasoned about — the first (IP-only) version of the fix was run against `tests-e2e/auth.spec.ts`
and broke 2 tests (rate-limited before the test suite's own later logins as *different* accounts
could complete); the `ip:email` version was re-verified against the same suite, all 12 tests green,
plus 2 new regression tests added (`auth.spec.ts`: one proving the limit trips, one proving it's
per-account not per-source).

Per the task's own guidance not to claim distributed production-grade rate limiting when the
backend is deliberately in-memory/single-instance: this remains an in-process limiter, fine for the
current architecture, not something to over-engineer into a shared store prematurely.

---

## 11.7 Security headers and browser policy

**Status:** reviewed.

`apps/web/next.config.ts`'s `headers()` already set `X-Content-Type-Options: nosniff`,
`X-Frame-Options: SAMEORIGIN` (clickjacking protection), and a `Referrer-Policy`. No
Content-Security-Policy is configured — not added this pass, per the task's own caution against a
CSP that breaks Next.js/WebRTC/dynamic imports without being tested in-browser end to end, which
this pass's tooling constraints (browser tool disconnected mid-session) didn't allow doing safely;
left as a follow-up for a pass that has browser verification available, not silently skipped
without a reason.

**Finding — High, fixed:** the existing `Permissions-Policy` was
`camera=(), geolocation=(), microphone=()` — an *empty* allowlist, which denies the feature to
**every** context, including this site's own top-level pages, not only third-party embeds (that
distinction matters: `(self)` vs `()` are different policies, and the one in place was the fully
closed one). `apps/web/src/features/classroom/media.ts` calls `getUserMedia` directly, and
`apps/web/src/app/(classroom)/dashboard/lessons/[id]/classroom/page.tsx` is a real, working in-app
classroom route (rendered whenever `NEXT_PUBLIC_CLASSROOM_URL` isn't set to a real external
deployment) — this header would have silently broken camera/microphone access on that route.
Fixed to `camera=(self), geolocation=(), microphone=(self)`: the actual protection this header is
for (no other origin, and no iframe without an explicit `allow` attribute, ever gets camera/mic)
is unchanged; only this site's own pages that need it can still use it. `geolocation` is never used
anywhere in the app and stays fully denied. Verified two ways: (1) started a clean dev server and
`curl`'d both `/` and `/dashboard/lessons/<id>/classroom` directly, confirming the corrected header
value is actually served, not just present in source; (2) added
`tests-e2e/security-headers.spec.ts` (3 tests) asserting the baseline headers and the corrected
Permissions-Policy value on both routes — full suite green.

---

## 11.8 Dependency and supply-chain review

**Status:** reviewed. `npm audit --workspaces` run from the repo root.

**Finding — Critical, fixed:** `next` (16.3.2, pinned exactly) carried a **Critical** advisory —
unauthenticated remote code execution on Windows-hosted servers, plus separate RCEs in the AVIF
image-optimization path and `next/og`'s `ImageResponse`. Directly relevant here: this project's own
`next.config.ts` explicitly enables AVIF (`images: { formats: ["image/avif", "image/webp"] }`), and
this development environment itself runs on Windows. Fixed with a same-minor-line patch bump to
`next@16.3.8` (the version `npm audit`'s own report names as the fix) — not a major version jump,
no breaking-change risk flagged. `npm install` completed cleanly; typecheck, the full unit-test
suite (256 tests across `web`/`data`/`classroom`/`realtime`), and the full Playwright e2e suite
were all re-run after the upgrade and stayed green (see the Verification section below for the
e2e run specifically).

**Fixed via non-forced `npm audit fix`:** a `dompurify` (3.4.13–3.4.15) DOM-XSS advisory resolved
cleanly with no breaking change and no manual version pin needed.

**Reviewed, not forced — informational/monitored:** a chain from `lodash-es` (High: code injection
via `_.template`, prototype pollution) and `nanoid` (High: predictable/looping generation under
malformed size arguments) through `chevrotain` → `langium` → `@mermaid-js/parser` →
`@excalidraw/mermaid-to-excalidraw` → `@excalidraw/excalidraw`. `npm audit`'s only offered fix is
`npm audit fix --force`, which would **downgrade** `@excalidraw/excalidraw` from the currently
pinned `^0.18.1` to `0.17.6` — an actual regression of the already-installed version, explicitly
flagged by npm itself as breaking. Per the task's instruction to determine actual reachability
before forcing a fix: `@excalidraw/excalidraw` is genuinely used (confirmed via
`apps/web/src/features/classroom/components/Whiteboard.tsx` and
`apps/classroom/src/components/Whiteboard.tsx`, both real imports, not dead code) for the
classroom whiteboard feature, but `nanoid`'s vulnerable behaviour is triggered by malformed/negative/
zero `size` arguments to its generator — internal to Excalidraw's own element-ID generation, not a
parameter this application ever passes through from user input. Not forcing a version downgrade to
"fix" a chain whose actual attack surface in this app's usage is effectively unreachable. Recorded
here for future tracking: re-check when `@excalidraw/excalidraw` next publishes a version that pulls
a patched `nanoid`/`lodash-es` without requiring a downgrade.

**Lockfile consistency:** a single root `package-lock.json` covers the whole workspace (confirmed —
no per-package lockfiles found), so there's no cross-package version-drift risk from multiple
lockfiles disagreeing.

---

## 11.9 Sensitive data and logging

**Status:** reviewed.

- No `console.log`/`console.error`/`console.warn` call anywhere in `apps/web/src` references
  `password`, `token`, or `session` in its own message text (checked directly).
- No API route (`apps/web/src/app/api/**`) echoes a caught error's `.message`, `.stack`, or
  `String(error)` back into its response — every route (login, enquiry) returns hand-written,
  generic user-facing strings regardless of the underlying failure reason. The one place a raw
  error *is* logged server-side (`console.error("Resend error:", error)` in the enquiry route) never
  reaches the HTTP response.
- `apps/realtime/server/signalling.ts`'s Cloudflare TURN failure path logs the fetch error
  server-side for operators but returns a generic failure to the client, matching the same pattern.

No finding.

---

## 11.10 Realtime/classroom trust boundaries

**Status:** reviewed, largely by reading `apps/realtime/server/signalling.ts` directly rather than
relying on the test suite's own framing of what it covers.

- Tutor-only actions (`room:admit`, `room:admit-all`, and — per the file's own surrounding
  comments — mute/remove/lock handlers) call a `requireTutor(socket, ...)` guard before acting,
  server-side, not merely hidden behind a tutor-only button in the UI.
- Cross-room isolation: rooms are keyed by `roomId` in a `Map`, and every handler operates on
  `ctx.room`/the room resolved from the caller's own `socket.data.roomId` — no code path found that
  lets a socket address another room's state by ID.
- Force-mute is explicitly a directive the target's own client complies with, not real media
  enforcement (no SFU exists) — this is a known, already-honestly-documented limitation (not a bug
  this pass introduces or needs to fix) per this project's own prior planning notes; the trust
  boundary that *is* server-enforced (screen-share ownership, being one genuinely new resource with
  no prior trust model to preserve, per `Room.activeScreenShareId`) rejects a second concurrent
  sharer and is cleaned up on both explicit leave and the disconnect-grace-period path — confirmed
  by a passing test (`releases screen-share ownership when the sharer disconnects unexpectedly`).
- The classroom join token itself (11.2) carries `name`/`role` signed server-side by `apps/web`
  after its own full authorization check — `apps/realtime` uses only the token's own signed fields
  for a token-authenticated join, never a client-declared name/role, matching the explicit warning
  in `classroomToken.ts`'s own top-of-file comment.
- Board updates are rate-limited (confirmed passing test, 11.6) and (per the file's structure)
  scoped to the room the update's socket is actually in.

No new finding beyond 11.2's classroom-secret fail-closed fix, which is the trust-boundary item that
actually needed closing.

---

## 11.11 URL/navigation/open-redirect checks

**Status:** reviewed.

Checked every `redirect(...)` call, every `router.push`/`router.replace`, and every
`window.location` assignment in `apps/web/src`. Every redirect target found is either a hardcoded
literal path (`/dashboard`, `/login`, `/403`, `/`) or a same-pathname query-string rewrite
(`Toaster.tsx`/`SearchInput.tsx` calling `router.replace` with the *current* `pathname` plus an
updated query — never an externally-supplied path). No redirect target anywhere is built from a
user-controlled query parameter (`returnUrl`/`redirectTo`/`next`-style), so there is no open-redirect
vector to close.

No finding.

---

## 11.12 File/path handling

**Status:** not applicable. Searched for any upload/write/read-from-request/multipart-handling code
across `apps/web/src` and found none — the only matches for upload-shaped search terms were
unrelated (WebRTC *upload bandwidth* comments in `apps/web/src/features/classroom/peer.ts`, not
file uploads). This application has no file-upload, import, export, or materialization feature to
review. Not inventing a finding for a feature that doesn't exist, per the task's own instruction.

---

## Security verification

| Check | Result |
|---|---|
| `npm run lint --workspaces` | `classroom`/`realtime`/`web` clean (same pre-existing missing-script non-finding for `data`/`shared` as task 10 documented) |
| `npm run typecheck --workspaces` | `classroom`/`realtime`/`web`/`data` clean |
| `npm test --workspaces` (unit/integration) | **256 passed, 0 failed**, re-run after the `next` upgrade and all fixes |
| `apps/web` Playwright e2e | Full suite re-run after all fixes — see this task's commit for the final count; the targeted rerun of `auth.spec.ts` (all 12 original tests + 2 new rate-limit tests) and `security-headers.spec.ts` (3 new tests) is 17/17 green, captured directly in this review |
| Headers verified live | `curl`'d a freshly started dev server directly (not assumed from config alone) — `Permissions-Policy: camera=(self), geolocation=(), microphone=(self)` confirmed on both `/` and the in-app classroom route |

## Residual risk / things intentionally not done this pass

- **CSP was not added.** The existing headers (frame-options, content-type-options, referrer-policy,
  the now-corrected permissions-policy) are unchanged from before except the one fix above; a CSP
  needs in-browser verification against WebRTC/TURN/dynamic-import behavior this pass's tooling
  (browser disconnected mid-session) couldn't safely provide. Flagged as a real follow-up, not
  silently skipped.
- **The `lodash-es`/`nanoid`/`@excalidraw/excalidraw` chain** (11.8) is monitored, not forced —
  forcing it would be a real regression (a dependency downgrade) for a vulnerability class not
  reachable through this app's actual usage of the library.
- **Sessions and rate-limit buckets are in-memory**, by deliberate existing architecture (this is a
  single-instance prototype backend, consistent with `packages/data`'s own in-memory provider) —
  noted, not treated as a new gap to fix, per the task's own instruction not to claim
  distributed/production-grade guarantees the current backend was never built to provide.
