# Plan 11 — handoff (written 00:1x–00:2x BST, 2026-09-29)

Branch: `claude/dreamy-brahmagupta-key3c2`. **Not pushed** — see "Push status". Plan file: `plan11.md`
(user's upload; not in the repo). No PR opened, as instructed.

## Where it stands: Tasks 1–6 and 8 done, Task 7 partly done, Tasks 9–20 not started

| Task | State | Commit |
| --- | --- | --- |
| 1 Frame profiler / overlay / profile script / baseline | done | 161f94c |
| 2 Rendering audit | done | 3617c66 |
| 3 Shared MotionRuntime + four tiers | done | 0815d4b |
| 4 React out of mic-level frame loops | done | 3c53b0e |
| 5 Compositor-only animation | done | ea078b6 |
| 6 Reveal vocabulary | done | 2811016 |
| 8 Parallax / depth / path / underline primitives | done | 5919643 |
| 7 Harden homepage scenes | **partial** — threshold-crossing only | 2cbc0af |
| 9–20 | not started | — |

Also committed: `--trace` paint counts (187de83), LCP-element recording (2401477), contrast fixes (f7525b2),
LCP regression fix (2a0ec0d).

### Task 7 — what is and is not done
Done: Product Story and Safeguarding reach React only when the step changes (`useDiscreteProgress`,
`lib/motion/thresholds.ts`, unit-tested).
**Not done:** remove/replace the perpetual hero glow; layered bounded parallax in `HeroScene.tsx` using
`ParallaxLayer` (bg 8–20 px, product 10–24 px, chips 18–34 px); suspend ambient work offscreen; the
required **measured homepage improvement**. Do not treat Task 7 as finished, and do not expand
choreography (Tasks 9+) before that measurement exists — the plan gates on it.
Known hero defects to fix in that pass: chip `animation: lt-rise both` overrides inline transforms, so the
chips' scroll parallax has never run (needs wrapper layers, which `ParallaxLayer` provides); secondary chip
`right: -22px` clips at the page edge; the photo's `scale` compounds onto the chips because they are its children.
Homepage layouts during scroll were 171 at baseline and 207 after Task 5 — they must fall.

## Findings worth keeping (add to the audit / final report in Task 20)
1. **`ScrollReveal` was inert on /subjects, /about, /contact, /faq** on direct loads (its `.rv` CSS lived only in
   `home.module.css`). Not in the audit yet — add as a note on M-05.
2. **Making reveals work regressed LCP** on those pages (/subjects 204→864 ms, /about 184→1072 ms, /contact and
   /faq ~870 ms), because a reveal's start state is in the server HTML and hides its content until JS has run.
   Fixed by using `variant="static"` for first-screen blocks; guarded by e2e tests in `marketing-motion.spec.ts`.
   **Rule for Tasks 9–12:** first-screen content is never revealed. New pages need the same treatment.
3. Marquee CSS also lived only in `home.module.css` (unstyled on direct /subjects, /about) — fixed in Task 5.
4. Bundle: public-route JS went 192 KB (baseline) → 202 KB (Task 5) → 214 KB gz now. Not yet examined; report it
   honestly in Task 20 and look for what to lazy-load.
5. The existing axe test "marketing home" was red before this work (trust-card eyebrow 1.92:1) — fixed.

## Open problem: unexplained e2e failure
`accessibility.spec.ts › lesson detail and the calendar peek panel` fails **deterministically** as of ~23:14 UTC
(`color-contrast` on `.fc-event-main-frame > .fc-event-time`, `.fc-sticky`). It passed in this session's earlier
full-suite run and an earlier isolated axe run. No dashboard/calendar file changed in between (Task 5's
`app-dashboard.css` edit predates the passing runs), so the code is not an obvious cause. **Hypothesis only,
unverified:** it depends on the clock (seed data or "today"/past styling). Next step: run it at commit `554013b`
in the profiling worktree (or with the clock moved) to see whether it fails there too. Other results this
session: the full 104-test web e2e run passed apart from the since-fixed axe home test; after the last commit
`marketing-motion`, `frame-loops` and the other axe tests passed (46 passed, 1 failed = the calendar test).
Unit tests: 141/141. `tsc` and `eslint` clean.

## Measurements so far (production build, headless software-rendered Chromium — same-machine comparisons only)
- LCP after the reveal fix, all five routes, desktop and mobile: 116–212 ms (table in commit 2a0ec0d).
- Frame pacing is saturated at 60 Hz in headless SwiftShader, so layouts / style recalcs / script time are the
  discriminating metrics, not fps. No "locked 60/120/144" claims anywhere.
- Still missing: the 4× CPU-throttle baseline (build in scratchpad `baseline-next/`), traced paint counts, and every
  "after" number for the homepage (Task 7's gate).

## Practical notes for the next session
- Commit identity: `AlviHossain97 <alvi997@outlook.com>` via `GIT_AUTHOR_*`/`GIT_COMMITTER_*`; **no** Co-Authored-By
  or Claude-Session trailer (user's instruction).
- `apps/web/AGENTS.md`: this Next.js has breaking changes — read `node_modules/next/dist/docs/` before Next code
  (needed for Task 14, View Transitions).
- Profile: `npm run build` then `node scripts/profile-motion.mjs --label <name>` (see the script header). Use a
  separate worktree for builds so the dev server tree is not disturbed; `/home/user/LearnThriveSoftware-profile`
  is one (detached HEAD) and is safe to delete with `git worktree remove --force`.
- `pkill -f` inside a Bash command kills its own shell (exit 144) — harmless, but stage/commit in a separate call.
- Playwright: dev server on :3100, `playwright.local.config.ts` (git-excluded) points at `/opt/pw-browsers/chromium`.
- `graphify update .` (CLAUDE.md) is not possible: graphify is not installed here.

## Suggested order
Finish Task 7 (hero rework → profile `/` desktop+mobile vs `baseline.json` → commit "perf: harden homepage scroll
choreography"), resolve the calendar axe failure, then Tasks 9 → 20. Task 15 (Three.js) should end as "not
retained" unless it passes the profiling gate — say so plainly in the report.

## Push status
`git push` was refused with **403 — "Claude doesn't have GitHub access to LearnThrive/LearnThriveSoftware"** (an
authorization error, not a network fault, so retrying does not help). Fix: reconnect GitHub at
https://claude.ai/connect-github and make sure the Claude GitHub App is installed on the repository, then push:
`git push -u origin claude/dreamy-brahmagupta-key3c2`. A bundle and patch series of every commit were saved as a
fallback (see the session's final message for the paths).
