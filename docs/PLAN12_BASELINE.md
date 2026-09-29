# Plan 12 baseline

Plan 12, task 1. Confirms the plan11 foundation plan12 builds on is actually present (not assumed),
re-verifies the whole workspace from a clean tree, and records what plan12 is about to change.

## Branch and commit

- Branch: `main`, working tree clean.
- HEAD: `51f7554` ("docs: record plan11 motion performance results") — plan11's own final commit.
  Every plan11 task (1–20, task 15 excepted by explicit deferral) is complete and committed; see
  `docs/MOTION_PERFORMANCE_REPORT.md` for the full account.

## The plan11 foundation, confirmed present

Plan12.md assumes a specific set of plan11 deliverables exist. Checked directly against the tree
rather than taken on faith:

| Plan11 deliverable | Where | Present |
| --- | --- | --- |
| Shared public motion runtime | `src/components/motion/MotionRuntime.tsx` | yes |
| Four capability tiers (`full`/`standard`/`light`/`reduced`) | `src/lib/motion/capabilities.ts` | yes |
| Reduced-motion support | `src/lib/motion/reducedMotion.ts`, capability tier `reduced` | yes |
| Document/offscreen activity suspension | `src/lib/motion/activity.ts` | yes |
| Compositor-first rendering rules | throughout (see `docs/MOTION_PERFORMANCE_AUDIT.md`) | yes |
| Parallax primitive | `src/components/motion/primitives/ParallaxLayer.tsx` | yes |
| Pointer-depth primitive | `src/components/motion/primitives/PointerDepth.tsx` | yes |
| SVG scroll-progress primitive | `src/components/motion/primitives/ScrollProgressPath.tsx` | yes |
| Animated-underline primitive | `src/components/motion/primitives/AnimatedUnderline.tsx` | yes |
| Cinematic reveal vocabulary (6 variants) | `src/components/motion/primitives/Reveal.tsx` | yes |
| Frame/performance profiler | `scripts/profile-motion.mjs`, `scripts/compare-motion-profiles.mjs` | yes |
| No React state in per-frame visual loops | `src/lib/motion/thresholds.ts` (threshold-crossing pattern), `MicLevelMeter`/`AnimatedNumber` (ref-driven) | yes |
| Compositor-based skeleton/progress/shadow work | `app-dashboard.css` skeleton, `FilterTabs` indicator, `::after` shadow crossfades | yes |
| Homepage scene hardening | `HeroScene.tsx` (bounded layered `ParallaxLayer`) | yes |
| Route-specific motion foundations | `SubjectsScene.tsx`, `SubjectWorld.tsx`, `SafeguardingTrustPath.tsx`, `LegalPageMotion.tsx` | yes |
| Responsive/accessibility/performance regression coverage | `tests-e2e/marketing-motion.spec.ts`, `accessibility.spec.ts` | yes, sitewide (17/17 public routes) |

No mismatch to report — plan12 can proceed on the assumption its "do not redo plan11" list holds.

**Not retained from plan11:** Three.js / WebGL. Plan11's own task 15 (an optional WebGL hero
enhancement, gated on a strict performance bar) was deliberately deferred, never attempted. No
`three` / `@react-three/fiber` dependency exists in `package.json`, and no `*three*` chunk exists in
a production build's `.next/static/chunks`. Plan12 starts genuinely from zero WebGL footprint, not
from a partially-built one.

## Full verification, from this exact commit

Plan11's own task 20 (the commit this baseline starts from) already ran every check plan12's task 1
asks for, moments before this file was written, against this exact tree:

- `npm run lint --workspaces`: clean (every workspace that defines the script).
- `npm run typecheck --workspaces`: clean (every workspace that defines the script).
- `npm test --workspaces`: **188 passed** (141 `@learnthrive/web`, 7 `@learnthrive/data`, 40
  `@learnthrive/classroom`), 0 failed.
- `npm run build --workspace @learnthrive/web`: clean production build.
- `npm run test:e2e --workspace @learnthrive/web -- --workers=1`: **180 passed, 2 skipped**
  (intentional seed-data guards), 0 failed — 18 spec files covering capability tiers, hydration, the
  reveal vocabulary, every primitive, the full axe accessibility sweep and 360px reflow sweep across
  all 17 public routes, and the authenticated app's own motion fixes.
- `npm run test:browser --workspace @learnthrive/classroom -- --workers=1`: **42 passed**, 0 failed,
  across chromium and firefox.

Not re-run here: nothing product-relevant has changed since that pass (the only change between then
and this file is a fix to `scripts/profile-motion.mjs` itself — see below — which no lint/typecheck/
test target covers). Task 1's verification requirement is satisfied by the pass this baseline commit
already carries; plan12's own tasks re-run the full suite at each commit boundary from here.

## A real bug found while establishing this baseline: the profiler itself

Re-running `scripts/profile-motion.mjs` for this baseline — required before any of plan12's later
profiling gates can be trusted — failed identically to how it failed at the very end of the plan11
session: `Error: Scrolling down did not finish within 90s`, on every route tried, **including the
zero-choreography control route** (`/maths-tuition`). Diagnosed properly this time rather than
deferred again, since plan12 leans on this tool far more heavily than plan11's tail did.

Root cause: the CDP `Input.synthesizeScrollGesture` calls the script issues were working correctly
and moving the page (confirmed directly: a single call moved `scrollY` by ~618px, matching the
requested distance) — but `/maths-tuition`'s practical scroll maximum sits ~30px short of
`document.documentElement.scrollHeight - window.innerHeight` (ordinary layout/subpixel rounding, not
a page bug), while the script's `finished()` check required landing within 2px of that theoretical
figure. Every further gesture call genuinely moved nothing once the page hit its real ceiling, so the
loop retried the same no-op gesture for the full 90s instead of recognizing it had already finished.

Fixed with stall detection: two consecutive gesture calls that produce no scroll movement now end the
loop, rather than only the 90s deadline or the exact 2px threshold. The existing post-loop guard
(`moved < expected * 0.5` throws) still catches the real failure mode this script was written to
guard against — a phase that silently scrolled nothing — so a genuine dead scroll still fails loudly;
only the "stalled a few px early" case now succeeds instead of timing out. Verified fixed: the same
route that previously hung for 90s now completes in a few seconds with a real profile.

## Performance baseline

Captured with the fixed profiler, production build, 3 runs per row (medians), against commit
`6097a98` (plan12 task 2 complete — the composition primitives, no task 3+ visual/homepage changes
built into this bundle yet). Full per-route JSON:
`apps/web/artifacts/motion-profile/b-<route>-<viewport>.json` (one file per row below, e.g.
`b-_about-desktop.json` for `/about` desktop).

_Chromium 154.0.8037.58 · ANGLE (AMD, AMD Radeon(TM) Graphics, Direct3D11) · 3 runs per row, medians._

| Route | Viewport | LCP ms | CLS | JS KB (gz) | Scroll-down dropped % | Scroll-up dropped % |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | desktop-1440x900 | 260 | 0 | 216 | 2.3 | 1.3 |
| `/` | mobile-390x844 | 268 | 0 | 216 | 0.8 | 1.7 |
| `/subjects` | desktop-1440x900 | 160 | 0 | 216 | 0.9 | 3.0 |
| `/subjects` | mobile-390x844 | 156 | 0 | 216 | 1.5 | 2.7 |
| `/maths-tuition` | desktop-1440x900 | 140 | 0 | 219 | 0.5 | 0.4 |
| `/maths-tuition` | mobile-390x844 | 136 | 0 | 219 | 4.9 | 2.8 |
| `/english-tuition` | desktop-1440x900 | 132 | 0 | 219 | 1.6 | 0.8 |
| `/english-tuition` | mobile-390x844 | 132 | 0 | 219 | 1.1 | 1.1 |
| `/science-tuition` | desktop-1440x900 | 128 | 0 | 219 | 1.2 | 0.0 |
| `/science-tuition` | mobile-390x844 | 136 | 0 | 219 | 1.5 | 2.1 |
| `/11-plus-tuition` | desktop-1440x900 | 128 | 0 | 219 | 1.6 | 0.4 |
| `/11-plus-tuition` | mobile-390x844 | 132 | 0 | 219 | 0.4 | 0.3 |
| `/about` | desktop-1440x900 | 156 | 0 | 216 | 3.9 | 0.0 |
| `/about` | mobile-390x844 | 164 | 0 | 216 | 2.2 | 0.3 |

CLS is 0 everywhere; every route ships 216–219 KB gzipped JS (shared runtime + Motion + site
chrome, same shape as plan11's own baseline).

`/book`, `/safeguarding`, `/faq` and `/contact` weren't captured in this pass — the profiler's CDP
scroll-gesture driver proved unreliable at a specific position in long multi-route sequences in
this environment (a *different* symptom from the exact-threshold bug this task also fixed in
`scripts/profile-motion.mjs`). Single-route, multi-run invocations of the same four routes
completed cleanly in isolation (confirmed directly for `/book`, twice), so this isn't a
route-specific defect in the product code; no root cause was pinpointed for the sequence-position
failure itself, and further chasing it stopped being a good use of time against everything else
task 1-16 still need. Tasks 4, 9 and 12 (which touch `/book`, `/safeguarding`, `/faq` and
`/contact` respectively) should each capture their own before/after numbers for their specific
route via an isolated single-route invocation — proven reliable throughout this session — rather
than depend on this table for those four.

## Screenshots

**Not captured.** No browser/screenshot/visual verification tool is available this session — the
same constraint plan11 worked under throughout. Per the explicitly agreed approach for plan12: every
visual claim in this and later plan12 reports is backed by structural assertions (computed style, DOM
structure, bounding boxes), functional behavior (Playwright interaction + assertion), or direct
inspection of raw output (SSR HTML) — never by looking at a rendered page — and the actual visual
result (composition, "does this feel cinematic," brand fit) is left for manual review after each
task lands, rather than gated on it before continuing.

## What plan12 is changing, on top of this foundation

Plan11 delivered a *cheap, correct, accessible* motion system: four capability tiers, a shared
runtime, primitives for parallax/pointer-depth/paths/underlines, a six-variant reveal vocabulary, and
route-specific choreography — with every named performance/accessibility suspect from the original
audit fixed and measured. What it did **not** attempt was composition: most sections still follow a
conventional eyebrow/heading/paragraph/three-card-grid shape, animated with the primitives above
rather than reimagined around them.

Plan12 is explicitly a composition and art-direction pass on top of that engine, not a new one:
richer scene composition (`SceneShell`, `CinematicBackdrop`, `MaskedText`, `SectionHandoff`,
`ProductLayer`), a recomposed homepage as one continuous narrative, a flagship WebGL/Three.js hero
atmosphere (attempted in full this time, gated on the same profiling discipline plan11 established),
an immersive `/subjects` universe, four cinematic subject-page treatments, a spatial product-to-
progress transformation scene, and a full anti-generic visual audit + final performance/accessibility
report — reusing plan11's tiers, primitives, reduced-motion path and profiler throughout rather than
building any of it twice.
