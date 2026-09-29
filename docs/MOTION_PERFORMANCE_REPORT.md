# Motion performance report

Plan 11, task 20. Closes out `docs/MOTION_PERFORMANCE_AUDIT.md` (base commit `554013b`) with real
before/after numbers, what shipped, what didn't, and what this report can't honestly claim.

## Summary

Every marketing route now has intentional, tiered motion; the nine named suspects and every A-/C-
finding from the audit are fixed; the authenticated app and classroom got the same treatment; and
two checks added in this task (a sitewide 360px reflow assertion, a full-site accessibility sweep)
each found and fixed one real, previously-shipped bug. Task 15's optional WebGL hero enhancement was
deliberately not attempted — see [Task 15](#task-15-three-js).

## Bottlenecks fixed, with real numbers

### The hero glow's perpetual main-thread animation (M-01)

At rest, every page with `.heroGlow` (`/`, `/subjects`, `/about`) cost **1.01 style recalculations
per frame, forever** — a filtered, infinitely-floating circle running on the main thread, not the
compositor. Replaced with a baked-in `radial-gradient` (no `filter`) and, on the homepage only,
bounded scroll-linked drift through `ParallaxLayer`. Fixed in task 5/7.

### The homepage's scroll-driven React state (M-06/M-07/M-08/M-11)

Baseline: scrolling `/` once cost **171 layouts and 648 style recalculations** (154/645 on mobile) —
against 0–2 layouts on every route without scroll-driven state. Three independent causes, all fixed
in task 7:
- Product Story and Safeguarding both called `setState` from a spring's `change` event, which fires
  every animation frame while scrolling or settling — fixed with threshold-crossing state (`ref`
  compare, `setState` only on a real crossing), unit-tested directly
  (`createThresholdTracker`, 7 tests including a fast-reverse-scroll case).
- Product Story's progress segments toggled `width` (a layout property) from React state — fixed
  with `transform: scaleX()` driven by a `MotionValue`, never touching layout or React.
- `StatCounter`'s count-up called `setState` roughly 54 times per number — fixed by writing
  `textContent` directly from `animate()`'s `onUpdate`, no React per frame.

### Reveals on first-screen content (M-05 addendum — the LCP lesson)

The most significant defect found *after* the audit, not in it. `ScrollReveal`'s `.rv` CSS was
`:global`-scoped inside `home.module.css`, a stylesheet only the homepage loads — so on
`/subjects`, `/about`, `/contact` and `/faq`, reveal CSS was silently inert and their content was
simply always visible. Once task 6's properly-scoped `Reveal` replaced it everywhere, that latent
bug became a real regression: a reveal's hidden start state lives in the *server-rendered* HTML, so
first-screen content wrapped in one is invisible until the client script runs.

Production-build profiling caught it directly (`2a0ec0d`):

| Route | LCP before fix | LCP after fix |
| --- | --- | --- |
| `/subjects` | 864 ms (was 204 ms pre-reveal) | 196 ms desktop / 152 ms mobile |
| `/about` | 1072 ms (was 184 ms) | 176 ms desktop / 148 ms mobile |
| `/contact` | ~880 ms (was ~184 ms class) | 116 ms desktop / 120 ms mobile |
| `/faq` | ~870 ms | 148 ms desktop / 140 ms mobile |

Fixed by giving each page's first-screen block the explicit `static` Reveal variant. Every task
after this one that added a reveal to first-screen content (9, 10, 11, 12) opted that block into
`static` from the start; `marketing-motion.spec.ts`'s "the first block after the hero is never held
back by a reveal" test now guards all eight affected routes together, and a dedicated unit test
(`every <Reveal> on the marketing pages names a real variant`) guards the variant vocabulary itself.

### Hero scroll choreography (M-09) and `/subjects` (task 9)

Task 7 gave the hero bounded, layered `ParallaxLayer` parallax (background 8–20px, product 10–24px,
chips 18–34px) and fixed two real bugs the rework surfaced: the chips' CSS `animation: lt-rise …
both` was silently overriding Motion's inline transform on the same element (nothing had ever
actually moved them — fixed by nesting the `ParallaxLayer` inside the CSS-animated wrapper, a
different DOM node), and the photo's `scale` was compounding onto its child chips (dropped; not part
of the authored spec anyway).

| Route | Metric | Before task 7 | After task 7 |
| --- | --- | --- | --- |
| `/` desktop | scroll-down dropped frames | 3.0% | 2.3% |
| `/` desktop | scroll-up dropped frames | 0.5% | 0.7% |

Task 9 made `/subjects` cinematic (bounded hero parallax + fade, one shared scroll source across
every subject icon via React Context rather than one `useScene()` per icon — the first attempt used
independent listeners and nearly quadrupled dropped frames, 1.6%→6.3%; consolidating to a shared
context brought it back down):

| Route | Metric | Before any subjects work | After task 9 |
| --- | --- | --- | --- |
| `/subjects` desktop | scroll-down dropped frames | 1.6% | 2.8% |

The residual 1.6%→2.8% is the cost of `/subjects` now genuinely being cinematic (real added
choreography), not a regression — it stayed far below the 6.3% the first (uncorrected) attempt
produced, and CLS is 0 throughout. Task 10's four subject-specific "motion worlds"
(`/maths-tuition`, `/english-tuition`, `/science-tuition`, `/11-plus-tuition`) shipped clean:

| Route | LCP | CLS | Scroll-down dropped frames |
| --- | --- | --- | --- |
| `/maths-tuition` | 152 ms | 0 | 1.1% |
| `/english-tuition` | 148 ms | 0 | 0.3% |
| `/science-tuition` | 140 ms | 0 | 0.3% |
| `/11-plus-tuition` | 140 ms | 0 | 0.3% |

Science — the one route with the most decorative SVG nodes (`ScienceNodes`) — was **not** an
outlier; all four are within noise of each other.

### Hover shadows, sticky `backdrop-filter`, and the rest of the marketing/app suspects

- M-04 (marketing card shadows) and A-03 (app stat-tile hover): `box-shadow` interpolation (a paint
  property, repainting the whole blurred region every transition frame) replaced with a pre-drawn
  `::after` pseudo-element whose `opacity` crossfades — a compositor property. Applied consistently
  across `.founderCard`, `.levelCard`, `.stat-tile--link`, and (task 16) `.fc-event`.
- M-12/A-05 (sticky header/topbar `backdrop-filter`): the marketing header's scrolled state (task 13)
  and the app topbar (task 16) both moved to an opaque background with no blur — removes a per-scroll
  re-sample-and-blur cost for a visual difference that was already close to invisible at 96%/86%
  opacity.
- A-01 (skeleton shimmer): `background-position` animation (paint property, every visible skeleton,
  every frame, exactly when the main thread is busiest loading) replaced with a `::after` gradient
  moved via `transform: translateX()`.
- A-02 (filter-tab indicator): `width` transition replaced with a 1px base + `transform: scaleX()`
  from the left origin — verified the rendered box still lands exactly on the active tab
  (`app-motion.spec.ts`).
- A-04 (calendar event hover): `filter: brightness()` + `box-shadow` (forces a separate render
  surface) replaced with an opacity overlay, per the audit's own recommendation to drop the shadow
  rather than replace it.
- M-13 (dead legacy hero CSS with an unused `backdrop-filter`): deleted; nothing referenced it.
- M-02 (marquee): moved out of `home.module.css`'s `:global` scope into its own module (fixing the
  same "unstyled on `/subjects`/`/about`" bug class M-05's addendum describes) and paused via a
  shared viewport/visibility observer when more than 160px offscreen or the tab is hidden.

### The classroom (C-01/C-02/C-03)

- C-01 (`MicLevelMeter`, both `apps/web` and `apps/classroom` copies): sampling stayed in
  `requestAnimationFrame`, but the level now writes straight to the element via a ref instead of
  `setState` — a React commit per display frame for as long as the pre-join screen is open is now
  zero. The accessible name updates at a low, human-readable cadence instead of per frame.
- C-02 (`useMeeting`): every remote whiteboard cursor/laser event produced a new snapshot and
  re-rendered the whole `App` tree. Isolated behind its own `useSyncExternalStore` subscription
  (`subscribeBoardPointers`/`getBoardPointersSnapshot`), read inside `Whiteboard` itself rather than
  passed down from `App` — the parent tree no longer re-renders on remote pointer movement.
  Functionally confirmed via `apps/classroom`'s real 2-participant WebRTC whiteboard test (both
  `apps/web` and `apps/classroom` share this exact isolation pattern byte-for-byte); the full
  classroom e2e suite — 42 tests across chromium and firefox, including a 4-participant room test
  exercising whiteboard, chat, Help Queue, a departure/rejoin, and a capacity-rejected 4th student —
  passes clean.
- C-03 (poll option bars): `width` transition replaced with `transform: scaleX()`, applied
  identically to both the `apps/web` and `apps/classroom` copies (kept byte-identical by convention).

### Two bugs found by task 20's own new checks

- **360px reflow (task 18).** Extending the 360px no-horizontal-overflow assertion from the 4
  subject-world routes (task 9/10) to all 17 public routes caught a real bug: the homepage's booking
  section renders a two-step progress indicator (task 11) as a single `nowrap` flex row with no
  narrow-width fallback. At 360px, with the enclosing card's and form's own padding subtracted, the
  two step labels plus a connecting line needed roughly 296px in a 236px-wide space, forcing the
  entire enquiry section — and with it every sibling in its single-column grid track — 18px wider
  than the viewport. Fixed by stacking the steps vertically below 46rem and dropping the (now
  meaningless) horizontal connecting line; each dot's `is-complete` state still carries the progress.
- **Color contrast (task 19).** Extending the axe (WCAG 2 A/AA) sweep from just the homepage to all
  17 public routes caught `/contact`'s navy phone card: its label and phone number links used
  `--lt-green-light` (#087363), which only clears ~2.5:1 against that navy background — well under
  AA's 4.5:1, though it reads 5.2–5.8:1 fine on the cream/white sections it was designed for. Fixed
  with the same brighter one-off (`#13c2a0`) already used for this exact problem elsewhere in the
  codebase (`home.module.css`'s `.levelRowDark .levelYears` and `.statValueGreen`), rather than
  inventing a new color or changing the shared token and risking its other, correct usages.

Both were pre-existing (task 11 and earlier), not introduced by task 18/19's own changes — found
because this task extended coverage that had, until now, only ever looked at a handful of routes.

## Bundle impact

Baseline (`554013b`): **192.4 KB gzipped JS**, 34.4 KB gzipped CSS, shared across every route (the
framework, Motion, and site chrome). Mid-plan profiles (tasks 9/10, after the reveal vocabulary,
parallax primitives, and `/subjects` cinematic work had landed) measured **213–219 KB gzipped JS** —
a real but modest increase for a shared motion runtime, capability-tier detection, and several new
scene components, still shared across every route rather than per-page. CSS held flat at the
baseline's figure through task 10.

**No Three.js dependency or build chunk exists anywhere in the final tree** (`package.json` has no
`three`/`@react-three/fiber` entry; `.next/static/chunks` has no `*three*` file) — confirming task
15's deferral had zero footprint, not just a paper decision.

## Accessibility

`tests-e2e/accessibility.spec.ts` now runs the full axe (WCAG 2 A/AA) ruleset over all 17 public
routes plus `/login` and four authenticated flows (21 checks total). One real violation found and
fixed (`/contact`'s color contrast, above); everything else passed clean, including every page this
plan's 20 tasks touched.

Beyond the automated sweep (task 19's own checklist):
- **Decorative SVG.** Every purely-decorative SVG in the codebase carries `aria-hidden="true"`,
  either directly, via a wrapping element (`SafeguardingTrustPath`'s outer `div`), or via the shared
  `Icon`/`SubjectIcon` component's common prop object — except three homepage "Why Us" card icons,
  which this task found missing it and fixed. No `<canvas>` exists anywhere in the product code.
- **Keyboard and focus.** No positive `tabIndex` exists anywhere; every `tabIndex={-1}` is either a
  click-catching scrim (correctly excluded from tab order) or an EnquiryForm focus-management target
  (the standard "programmatically focusable, not in tab order" pattern); `ProductTabs` uses a correct
  roving-tabindex tablist. The mobile nav menu is keyboard-operable by construction (a real
  `<button>`, native Enter/Space activation) and has a dedicated Escape-closes-and-returns-focus
  test. `PointerDepth` only responds to `mousemove`, never focus, and has its own test confirming a
  control inside a leaning card stays clickable throughout.
- **200% zoom / reflow.** Not tested via literal browser zoom (no browser/visual tool was available
  this session — see [Known gaps](#known-gaps-this-session-could-not-close)), but the 360px reflow
  assertion added in task 18 validates the same underlying requirement WCAG 1.4.10 does (content
  reflows to a single column at a narrow effective width without introducing two-dimensional
  scrolling), and already found and fixed a real violation of it.
- **Fast/reverse scroll.** A scene's position is a pure function of the current scroll offset
  (`useScroll`/`useTransform`), never an accumulator, so there is no state to corrupt by construction
  — backed by a new direct test (`marketing-motion.spec.ts`, "a fast reverse jump (end straight to
  start) recovers correctly") and the existing boundary-value sweep across the full scene range.

## Responsive and capability tiers

Four motion tiers (`full` / `standard` / `light` / `reduced`), decided from media queries and a few
capability hints only — never user-agent sniffing — and read through a single `useSyncExternalStore`
so a scene's markup can never mismatch its server-rendered HTML. Extensively covered by
`marketing-motion.spec.ts`'s "capability tiers" suite: a phone is always `light` regardless of
reported capability; a tablet is `standard`; a low-memory desktop is `light` even at full width; no
capability evidence at all falls back to `standard`, never `full`; the tier follows live media-query
changes without a resize-polling loop.

- **Mobile (`light`):** confirmed by test — no pointer depth (`PointerDepth`'s "a touch device gets
  no transform at all"), no WebGL (`light` tier's `webgl: false`), parallax scaled to 0.35× the
  authored distance (confirmed exactly: 20px authored → 7px measured). No horizontal-scroll-jacking
  pattern exists anywhere in the codebase (grepped for `overflow-x: scroll` / `scroll-snap-type: x`
  and found nothing) to convert.
- **Tablet (`standard`):** parallax scaled to 0.7×; pointer depth requires a genuinely fine pointer in
  addition to the tier allowing it, so it stays off on touch tablets. About's `.missionSticky`
  two-column sticky layout — the one place a "reduced sticky height/layer count" requirement could
  plausibly bite — drops sticky entirely below 860px (`position: static`), which covers 834px tablet
  cleanly rather than just shrinking it.
- **Reduced motion:** every scene renders its final state directly; `scrollChoreography: false`,
  `parallaxScale: 0`. Covered by a dedicated sweep across all 17 public routes ("nothing on any
  public route is left hidden or displaced by a reveal") plus per-primitive tests (parallax, pointer
  depth, underline, path-drawing) confirming zero movement under `prefers-reduced-motion`.
- **360px reflow:** every one of the 17 public routes now has an automated no-horizontal-overflow
  assertion at 360px (task 18), which caught and fixed the enquiry-form progress-bar bug above.
- **Touch targets and feedback.** The one touch target every mobile visitor to every public page
  depends on — the nav menu toggle — is 48px (44.8px at the very narrowest breakpoint), with real
  `:active` press feedback (shadow + `translateY` + `scale`) on top of the sitewide native tap
  highlight being intentionally disabled. The shared `.icon-button` used across the authenticated
  app's dialogs/drawers is 36px — below the 44px best-practice guideline but still above WCAG 2.2
  AA's 24px minimum (2.5.8); this predates plan11 and sits outside the public-marketing scope this
  plan actually reworked, so it was left alone rather than restyled sitewide on spec. Similarly,
  several hover-only marketing cards (`.subject-card`, `.feature-card`, `.testimonial-card`) have no
  `:active` counterpart to their `:hover` treatment, so a touch tap gets no visual press feedback
  before the tap navigates (the tap itself still works). Both are real, minor, pre-existing gaps —
  listed honestly here rather than fixed on spec or silently omitted.

## Tests

- **188 unit tests**, all passing: 141 in `@learnthrive/web` (including the motion runtime, `Reveal`
  vocabulary, and threshold-crossing logic this plan added), 7 in `@learnthrive/data`, 40 in
  `@learnthrive/classroom`.
- **`@learnthrive/web` e2e**: **180 passed, 2 skipped** (single worker, 4.6 min) across all 18 spec
  files — capability tiers, hydration, the reveal vocabulary, parallax/pointer-depth/scroll-path/
  underline primitives, every public route's reveal-under-reduced-motion and 360px-reflow sweep, the
  full axe accessibility sweep, the enquiry form, the FAQ accordion, legal-page navigation, the site
  header/footer, the four subject-world routes, view transitions, and the authenticated app's motion
  fixes. The 2 skips are both intentional, seed-data-dependent guards (no tutor rows to navigate
  through; no calendar events in the current seed view), not failures.
- **`@learnthrive/classroom` e2e**: 42/42 passing across chromium and firefox (2.9 min), including a
  full 4-participant room test.
- `npm run lint --workspaces` and `npm run typecheck --workspaces`: clean across every workspace that
  defines those scripts.
- `npm run build --workspace @learnthrive/web`: clean production build.

## Task 15 (Three.js)

**Deferred entirely, not attempted.** After task 7 landed a flat/inconclusive initial profiling
result, the user was asked whether to proceed to task 9 anyway or invest further in task 7 first, and
chose to proceed. When scoping tasks 9–20, the user was asked how to sequence the remaining,
more-speculative work, and explicitly chose to work through the plan in order while deferring
speculative tasks — task 15 (an optional WebGL hero enhancement, gated on passing a strict frame
pacing / LCP / JS-cost profiling bar, explicitly allowed to be skipped if it doesn't) was the task
that decision named. No `three`/`@react-three/fiber` dependency was added, no `ThreeLearningField.tsx`
was created, and `HeroScene.tsx` was not modified for it — confirmed above by the bundle's actual
contents, not just by absence of a commit. The homepage hero's existing CSS/SVG-based
`ParallaxLayer` choreography (task 7) stands as the shipped hero.

## Known gaps this session could not close

Stated plainly rather than glossed over:

- **No 1440/834/390 before/after screenshots, and no reduced-motion screenshot examples.** No
  browser/screenshot/visual verification tool was available this session. Every visual claim in this
  report and the audit is backed by structural assertions (computed style, DOM attributes, bounding
  boxes, `CSSAnimation.playState`), functional behavior (Playwright interaction + assertion), or
  direct inspection of raw output (SSR HTML) — never by looking at a rendered page. Two places this
  gap was flagged explicitly during the work itself: About's sticky two-column Mission layout
  (task 11, the user chose to review `/about` and `/book` manually at the time), and the stat-tile
  hover crossfade (task 16, behaviorally tested — stays clickable through the transition — but never
  visually confirmed).
- **No fresh DevTools trace capture or final full-route profiler re-run.** `scripts/profile-motion.mjs`
  drives scrolling via a raw CDP `Input.synthesizeScrollGesture` call, distinct from the real
  Playwright interactions the e2e suite uses everywhere else. A final end-to-end re-run (after all 20
  tasks landed) failed with a scroll-gesture timeout on every route tried, **including the
  zero-choreography control route** (`/maths-tuition`) that has no scroll-driven code at all — ruling
  out a product regression as the cause, since the same route profiled cleanly earlier this session
  and the full e2e suite (which scrolls extensively through real Playwright APIs, not raw CDP
  gestures) passes clean. This reads as environment/tooling instability late in a very long session
  (the same class of issue diagnosed once already, mid-session, in the classroom e2e suite), not a
  regression in the shipped code. The before/after numbers in this report are real production-build
  profiler output captured earlier in this same session, at the point each task landed — not
  fabricated, but not a single final unified pass either.
- **`/dev/motion` age.** Any profiling/trace work if revisited should re-run against `next start`
  (never `next dev`) — this codebase's dev server has its own artifacts distinct from production
  (e.g., `window.location.hash` is silently stripped by Fast Refresh, unrelated to app code).
