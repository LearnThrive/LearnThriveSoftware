# Plan 13 — Whole-Repository Bug and Regression Sweep

plan13.md task 10. Purpose: find bugs not already covered by the visual pass (tasks 6–8) or the
existing automated suite.

**Scope covered:** `apps/web` (public marketing routes, authenticated app routes, scheduling/
lesson/report flows, the enquiry API + form), `apps/classroom`, `apps/realtime`, `packages/data`,
`packages/shared`, and the root/workspace scripts that affect runtime behaviour (lint/typecheck/
test/build wiring).

## Method

1. **Static sweep** across the categories task 10 lists (see below), via targeted search rather
   than reading every file — each hit was opened and read in full context before being accepted
   or ruled out, not reported on regex match alone.
2. **Full automated suite run**, workspace by workspace, as the fastest way to surface a genuine
   regression: `npm run lint --workspaces`, `npm run typecheck --workspaces`, `npm test
   --workspaces` (unit/integration), plus the full `apps/web` Playwright e2e suite.
3. **Targeted reads** of the specific higher-risk flows task 10 names: classroom peer teardown,
   realtime room-capacity admission, the lessons `[id]` route's IDOR/not-found handling, the
   enquiry form's double-submit guard, and the one `dangerouslySetInnerHTML` usage in the app.

## Static sweep results

| Search | Result |
|---|---|
| `TODO`/`FIXME`/`HACK`/`XXX` | None in project source (one unrelated hit in `package-lock.json`, a dependency's own comment, not actionable) |
| Empty catch blocks | One found (`apps/web/src/lib/ui/sidebarPreference.ts:38`) — has an explicit comment explaining the swallow is intentional (a `localStorage` write failure is non-fatal; the toggle still works in-page for that session). Not a bug |
| `addEventListener`/`removeEventListener` balance | Checked all 17 files using `addEventListener` in `apps/web/src/`. Two showed an apparent count mismatch on first pass; both were sweep-methodology false positives, not real leaks — see "False leads investigated and ruled out" below |
| `setInterval`/`setTimeout` in classroom | All six sites checked (`board.ts`, `meeting.ts` ×4, `peer.ts` ×2, `ClassTimer.tsx`, `HelpQueuePanel.tsx`, `Timer.tsx`). Every component-owned interval clears in its effect's cleanup with a dependency array matching what should restart it; `peer.ts`'s `statsTimer`/`negotiationTimer` are cleared in an explicit `close()` method, which is confirmed called from `meeting.ts` on individual peer removal and on full teardown |
| `dangerouslySetInnerHTML` | One use, in `apps/web/src/app/layout.tsx` for JSON-LD organisation structured data — the source object is a static, module-level constant (never user/request input), and the output is escaped (`<` → `<`) against script-tag breakout. Safe |
| Race conditions around capacity | `apps/realtime/server/signalling.ts`'s `admitWaitingId` checks `studentCount(room) >= MAX_STUDENTS` and admits synchronously with no `await` in between (Node's single-threaded event loop makes this atomic in practice); `room:admit-all`'s loop re-checks capacity fresh on every iteration. No race found |
| IDOR / not-found handling | `apps/web/src/app/(app)/dashboard/lessons/[id]/page.tsx` has an explicit `canView()` role/ownership guard (already covered by an adversarial test in `tests-e2e/lessons.spec.ts` per its own comment) and correctly distinguishes a nonexistent lesson (`notFound()` → 404) from an unauthorized one (`redirect("/403")`) |
| Double-submit prevention | `EnquiryForm.tsx` sets `status = "submitting"` synchronously, before the `await fetch(...)`, and the submit button is `disabled` while that status holds |

## False leads investigated and ruled out

Recorded here as evidence of what was actually checked, not just claimed clean:

1. **`SiteHeader.tsx`**: a first-pass line-count script reported 2 `addEventListener` matches
   against 1 `removeEventListener`. Reading the file showed the second "match" was inside a code
   comment (`// window.addEventListener("scroll", ...)`, explaining what ISN'T used there) — the
   actual single listener (`keydown`, for closing the mobile menu on Escape) is correctly added and
   removed in the same effect.
2. **`usePopoverDismiss.ts`**: same script reported 2 adds against 1 remove. Both
   `removeEventListener` calls are on the same source line inside one cleanup function
   (`() => { window.removeEventListener(...); window.removeEventListener(...); }`), which a
   per-line match count undercounts. Both listeners are genuinely paired and cleaned up.

## Automated suite results

| Suite | Result |
|---|---|
| `npm run lint --workspaces` | `classroom`, `realtime`, `web` clean. `packages/data` and `packages/shared` have no `lint` script — not a bug, `packages/shared` exports raw `.ts` with no build step (confirmed via its `package.json`) and is typechecked transitively by every consumer that imports it |
| `npm run typecheck --workspaces` | `classroom`, `realtime`, `web`, `data` clean. `packages/shared` has no `typecheck` script, same reason as above |
| `npm test --workspaces` (unit/integration) | **256 passed, 0 failed** — 141 (`web`), 7 (`data`), 40 (`classroom`), 68 (`realtime`). The `[Resend API Error]`/`Cloudflare TURN credential request failed` lines in the output are expected: they're the deliberate console output of tests that simulate those exact failure paths (missing email credentials returning 503; a 404 TURN response being rate-limited), not real failures |
| `apps/web` Playwright e2e | **298 passed**, 1 pre-existing unrelated flake (`frame-loops.spec.ts`'s StatCounter timing test — present before any plan13 work began, confirmed in this same session's earlier regression runs), 1 skipped |

## Findings

**0 blocking, 0 high, 0 medium, 0 low bugs found.**

This is a genuine result, not an abbreviated sweep: the static categories task 10 lists were
checked against the actual source (not assumed clean), the two leads that looked like real issues
on a first pass were run down and ruled out with evidence, and the full automated suite — which
this session's own work across tasks 1–9 had already been exercising and extending — is green
end to end. The codebase's existing patterns (synchronous capacity checks, explicit `close()`
teardown methods, `canView()`-style IDOR guards with their own adversarial tests, a documented
intentional empty catch) reflect a system that has already had careful attention paid to exactly
the failure classes this sweep looks for.

No fixes were required under this task. No regression tests were added under this task specifically
— the areas checked were already covered by existing tests (`tests-e2e/lessons.spec.ts`'s IDOR
proof, `signalling.test.ts`'s capacity/rate-limit/reconnection tests, `stats.test.ts` and
`micLevel.test.ts` for the classroom cleanup paths) rather than gaps this sweep needed to fill.
