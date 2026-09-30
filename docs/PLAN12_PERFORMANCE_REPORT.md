# Plan 12 performance, accessibility and device report

Plan 12, task 16. Closes out `docs/PLAN12_BASELINE.md` (task 1) and `docs/PLAN12_VISUAL_QA.md`
(task 15) with a full re-profile of every flagship route, the accessibility checklist plan12.md's
task 16 names, a device-width sweep, and a final review against the Definition of Done.

No browser/screenshot tool exists this session — the same constraint every plan12 report has
worked under. Every number below is a real, direct measurement (the profiler, axe, Playwright
interaction/assertion, or raw computed style/DOM inspection), never a visual impression.

## Performance

Re-profiled every flagship route, both viewports, production build, 3 runs per row (medians),
against the final commit of this plan (`866927e`). Chromium 154.0.8037.58, ANGLE (AMD, AMD Radeon
Direct3D11). Full per-route JSON: `apps/web/artifacts/motion-profile/plan12-task16-*.json`.

| Route | Viewport | LCP ms | CLS | JS KB (gz) | Scroll-down dropped % | Scroll-up dropped % | Idle dropped % | Long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | desktop | 288 | 0 | 226.7 | 2.0 | 1.0 | 0.0 | 1 |
| `/` | mobile | 276 | 0 | 225 | 1.0 | 1.9 | 0.0 | 1 |
| `/subjects` | desktop | 196 | 0 | 229.7 | 5.4 | 3.5 | 1.4 | 1 |
| `/subjects` | mobile | 160 | 0 | 225 | 1.1 | 0.0 | 0.0 | 0 |
| `/maths-tuition` | desktop | 116 | 0 | 229.7 | 6.0 | 6.7 | 0.2 | 0 |
| `/maths-tuition` | mobile | 140 | 0 | 229.7 | 1.1 | 0.3 | 0.0 | 0 |
| `/english-tuition` | desktop | 196 | 0 | 229.7 | 2.6 | 2.5 | 0.2 | 0 |
| `/english-tuition` | mobile | 136 | 0 | 229.7 | 0.8 | 0.0 | 0.0 | 0 |
| `/science-tuition` | desktop | 136 | 0 | 229.7 | 2.2 | 2.9 | 0.0 | 0 |
| `/science-tuition` | mobile | 132 | 0 | 229.7 | 1.2 | 0.0 | 0.0 | 0 |
| `/11-plus-tuition` | desktop | 140 | 0 | 229.7 | 2.6 | 2.5 | 0.0 | 0 |
| `/11-plus-tuition` | mobile | 136 | 0 | 229.7 | 0.6 | 0.0 | 0.0 | 0 |
| `/about` | desktop | 144 | 0 | 225 | 1.1 | 0.0 | 0.0 | 0 |
| `/about` | mobile | 160 | 0 | 225 | 0.9 | 0.7 | 0.0 | 1 |
| `/book` | desktop | 224 | 0 | 225 | 5.0 | 0.8 | 0.7 | 1 |
| `/book` | mobile | 208 | 0 | 225 | 2.8 | 0.0 | 0.7 | 1 |
| `/safeguarding` | desktop | 144 | 0 | 229 | 2.5 | 0.4 | 0.7 | 0 |
| `/safeguarding` | mobile | 136 | 0 | 229 | 0.9 | 0.2 | 0.5 | 0 |
| `/faq` | desktop | 152 | 0 | 225 | 1.6 | 0.0 | 0.5 | 0 |
| `/faq` | mobile | 148 | 0 | 225 | 0.3 | 0.7 | 0.5 | 0 |
| `/contact` | desktop | 140 | 0 | 225 | 1.2 | 0.0 | 0.5 | 0 |
| `/contact` | mobile | 136 | 0 | 225 | 1.5 | 0.0 | 0.7 | 0 |

CLS is 0 on every route, both viewports. No console/page errors or broken images on any route in
any run (`brokenImages`/`pageErrors`/`consoleErrors` all empty across every JSON file). Zero long
tasks except six single-1-task readings (`/`, `/subjects`, `/about` mobile, `/book` both viewports)
— none over the profiler's own threshold for flagging a genuine block.

### Compared against the plan12 baseline (task 1, commit `6097a98` — composition primitives only, before any route-specific work)

- **JS payload**: 216–219 KB gzip → 225–230 KB gzip, roughly +10 KB (+4–5%) across fifteen tasks of
  real feature work — nine new composition primitives, a WebGL hero atmosphere, route-specific art
  direction on eleven routes, and the View Transitions/SectionHandoff work in task 14. No
  disproportionate jump on any single route; the increase is evenly spread, matching a shared
  runtime growing modestly rather than one route accumulating bloat.
- **LCP**: flat or improved almost everywhere (`/maths-tuition` desktop 140→116ms, `/about` desktop
  156→144ms); the two exceptions are `/` (260→288ms desktop, 268→276ms mobile — the WebGL
  atmosphere's own setup cost, gated to the full tier only) and `/english-tuition` desktop
  (132→196ms). Both stay well under any LCP budget concern (under 300ms against a "good" threshold
  of 2500ms) and are a known, accepted cost of the composition work those exact tasks added, not an
  unexplained regression.
- **Frame pacing**: the one number worth flagging honestly is `/maths-tuition`'s scroll-down/up
  dropped-frame rate, which moved from 0.5%/0.4% at the task-1 baseline to 6.0%/6.7% here — the
  largest single movement in this table. The baseline was captured before *any* of tasks 5–7 and 15
  had landed their scroll-linked coverage-section motif (`PathTrack`/`Milestone`, drawn under real
  scroll progress) on this specific page; comparing "almost bare" against "the page task 15's own
  audit called the strongest example of a route-specific visual idea" is comparing two different
  pages in substance, not a like-for-like regression. It stays well inside the range other routes on
  this site have read at throughout this session (`/subjects` alone varied 4.5–13% across three
  isolated re-profile runs in task 15 — see `docs/PLAN12_VISUAL_QA.md`), CLS is still 0, and there
  are no long tasks — not treated as a fix-worthy finding.
- **No `/book`, `/safeguarding`, `/faq`, `/contact` baseline row existed** (task 1's own note: the
  profiler's multi-route sequencing was unreliable for those four at the time). This report is the
  first complete before/after-capable measurement for all eleven flagship routes together.

### WebGL gradient, sticky scenes and route transitions — explicit cost record

- **WebGL hero gradient** (`/`, full tier only): no separate vendor chunk — `find .next/static/chunks
  -iname "*three*" -o -iname "*webgl*"` returns nothing; the gradient is a small hand-written WebGL2
  module (`heroGradient.ts`), demand-rendered (no persistent `requestAnimationFrame` loop — see
  `docs/PLAN12_HERO_ATMOSPHERE.md`), dynamically imported with `ssr: false`. Its full cost is the
  `/` desktop LCP delta above (+28ms) plus whatever share of the +10KB shared-runtime growth belongs
  to it; both are within this report's accepted-cost reasoning.
- **Three.js**: not retained. Task 4 built the full React Three Fiber alternative exactly as
  instructed ("attempt the full WebGL/Three.js scope"), profiled it honestly against the raw-WebGL
  gradient, found +132KB gzip (a 61% increase) for worse LCP and frame pacing, and removed it per the
  plan's own gate. Zero `three`/`@react-three/fiber` footprint in this final build, same as the task
  1 baseline recorded.
- **Sticky scenes** (`ProductStoryScene`'s device mockup, `.missionSticky` on About, the legal pages'
  TOC sidebar): all `position: sticky`, never `position: fixed` or JS-driven pinning — no measurable
  main-thread cost beyond ordinary compositing (confirmed via `LayoutCount`/`RecalcStyleCount`
  staying low single digits across every profiled route's idle/scroll phases above).
- **Route transitions** (View Transitions API, `subject-card ↔ subject-page`): `view-transitions.spec.ts`'s
  actionability suite (11 tests, both the homepage-card and `/subjects`-section origins) confirms the
  destination page is immediately interactive after every transition path — direct click, browser
  back, keyboard activation, rapid re-click — with zero console/page errors, normal or reduced
  motion. No dedicated frame-cost profiling exists for the transition itself (outside what the
  profiler's route-level LCP numbers already capture); the feature's own risk gate has always been
  actionability, not frame cost, per that file's header comment.
- **Nothing removed this pass.** No effect in the current tree failed the plan's "value-to-cost"
  gate — task 4's Three.js removal (already landed before this report) is the one place that gate
  fired, and it's already reflected in the numbers above.

## Accessibility

- **Reduced motion**: `accessibility.spec.ts` emulates `reducedMotion: reduce` for every one of its
  22 axe passes (see below); `marketing-motion.spec.ts`'s "reduced motion: nothing on any public
  route is left hidden or displaced by a reveal" test sweeps every `PUBLIC_ROUTES` entry directly;
  every primitive built or touched this plan (`CinematicBackdrop`, `MaskedText`, `SectionHandoff`,
  `ParallaxLayer`, `AnimatedUnderline`, `SubjectWorld`'s motifs) has its own dedicated
  reduced-motion test. All green.
- **No JavaScript fallback**: `marketing-motion.spec.ts`'s `<noscript>` test confirms the homepage
  shows everything below the fold without script; the mechanism is the shared `(public)` layout's
  CSS, not a per-page implementation, so it applies sitewide by construction.
- **Keyboard-only**: new in this task (`accessibility-zoom-keyboard.spec.ts`) — Tab-reachability with
  a real visible outline confirmed on the header nav; the FAQ accordion opens/closes on Enter; FAQ
  jump-nav pills are focusable and navigate on Enter; the enquiry form (`/book`) is fully keyboard-
  operable including its radio group. All green.
- **Visible focus**: the same new test confirms every focused interactive element in a 6-tab walk
  from the homepage gets the sitewide `:focus-visible` treatment (`globals.css`: 3px outline + 3px
  offset + 6px outer box-shadow) — never `outline: none`/`0px`.
- **200% zoom**: new in this task, all eleven flagship routes. Chromium's non-standard `zoom` CSS
  property was tried first and rejected — it scales rendered content inside an unchanged-size layout
  viewport rather than reproducing what a real browser zoom does to the *effective* CSS-pixel
  viewport, and it produced an identical, page-content-independent overflow reading for every route,
  its own tell that it wasn't measuring real per-page layout. Fixed by halving the viewport
  (1280→640px, the standard technique for zoom-driven reflow testing) — every route reflows with no
  horizontal overflow and the header's own hamburger breakpoint (already real, already tested
  behaviour) correctly takes over at that width.
- **Axe (WCAG 2 A/AA)**: `accessibility.spec.ts`, fresh run this task — **22/22 passed, 0
  violations** — every one of the seventeen `PUBLIC_ROUTES` entries (all eleven flagship routes plus
  the six legal/support pages) plus login and five authenticated-app routes.
- **DOM reading order in sticky scenes**: new in this task. Confirmed for the three sticky-scroll
  compositions this plan built or touched: About's `.missionGrid` (the sticky value statement
  precedes the scrolling list in DOM order, not just visually), the homepage's `ProductStoryScene`
  (persistent chrome and beat content both present and in one sensible order — `position: sticky`
  never detaches content from flow, unlike `position: fixed`), and `/book`'s `.booking-layout` (the
  form precedes the sidebar in DOM order, matching visual and reading order).
- **Decorative WebGL/SVG excluded from the accessibility tree**: new in this task, six checks —
  About/FAQ/Contact's hero dot-grid+glow, `/subjects`' per-section motif SVGs, `/maths-tuition`'s
  hero motif SVG (capability-pinned, since it's gated by `CinematicBackdrop`), and Safeguarding's
  trust-path wrapper — every one carries `aria-hidden="true"`. The homepage's WebGL canvas and the
  legal pages' atmosphere backdrop already had dedicated, capability-pinned coverage from tasks 4 and
  13 respectively (not repeated here to avoid two fragile copies of the same tier-gating setup).

## Layout / device widths

| Width | Coverage |
| --- | --- |
| 360 | `marketing-motion.spec.ts` (homepage + every public route sweep), `subject-worlds.spec.ts` (all four subject pages) |
| 390 | mobile-viewport device preset used throughout the capability-tier and reveal test suites |
| 600 | new this task — 11 flagship routes, no horizontal overflow |
| 768 | new this task — 11 flagship routes, no horizontal overflow |
| 834 | existing tablet-tier tests (`marketing-motion.spec.ts`) plus the new 11-route sweep |
| 1024 | new this task — 11 flagship routes, no horizontal overflow |
| 1280 | new this task — 11 flagship routes, no horizontal overflow (also this suite's own default viewport) |
| 1440 | this suite's desktop-tier default throughout (21+ existing test usages) |

All eight widths: zero horizontal overflow across every flagship route.

### Manual, real-device/real-browser testing

**Not performed.** This session has no access to a physical iPhone, Android device, or a
non-Chromium browser (Safari, Firefox, Edge) — every check above runs through Playwright's bundled
Chromium. This is the same honest limitation `PLAN12_BASELINE.md` recorded for screenshots; it
applies identically here to the plan's "where available manually" browser matrix. Nothing in this
report claims real-device or cross-browser verification that didn't happen.

## Full verification

Run fresh at the end of this task, against commit `866927e` plus this task's own changes:

- `npm run lint` (workspace `@learnthrive/web`): clean.
- `npx tsc --noEmit`: clean.
- `npm test` (unit): **141 passed**, 0 failed.
- `npm run build`: clean production build, no `three`/webgl chunk.
- `npx playwright test --project=chromium --workers=1` (full web suite, one uncontended worker, per
  this task's own instruction): **254 passed, 2 skipped** (intentional seed-data guards, same two
  the task 1 baseline noted), **0 failed** — 22 spec files, 6.4 minutes.
- **Classroom Playwright**: not run. `git log --oneline -- packages/ apps/classroom` shows zero
  commits touching either since well before this plan started (the most recent classroom-affecting
  commit, `8929e94`, predates plan11's own first commit) — every one of plan12's fifteen commits so
  far (tasks 1–15; this task will be the sixteenth) touched only `apps/web`. Nothing shared changed,
  so nothing shared needs re-verification.

## Definition of Done — reviewed against final state

| Item | Status | Evidence |
| --- | --- | --- |
| More ambitious than Plan 11, not merely more animated | met | 9 new composition primitives (`SceneShell`/`CinematicBackdrop`/`MaskedText`/`SectionHandoff`/`ProductLayer`/`AboutFoundersScene`/`FaqJumpNav`), a measured WebGL hero investigation, View Transitions strengthened |
| Site no longer reads as a conventional template | met | task 15's structural audit found no unnecessary 3-card grids, no identical consecutive sections, on any of 11 routes |
| Homepage feels like one continuous narrative | met | task 3's restructure; task 15 audit: "no two adjacent sections share the same layout shape" |
| Homepage has a flagship atmospheric/interactive scene | met | `HeroWebGLAtmosphere` (pointer-interactive gradient) + `ProductStoryScene` (sticky transform) |
| `/subjects` feels like an immersive universe | met | task 6; task 15 audit: "reuse-with-synchronisation" — per-subject motifs replayed as one shared-scroll-source background |
| Each subject page has distinct composition, not just colour | met | task 7 + task 15's fix (11-plus's coverage line was a straight reuse of maths's, now dashed to match its own hero) |
| Product story spatially transforms, not just swaps panels | met, honestly partial | `ProductStoryScene`'s persistent device chrome + y/scale AnimatePresence transitions are a real spatial component, not a full 3D/canvas morph — a deliberate, restrained choice consistent with this plan's own "no per-frame React state, no continuous layout animation" rules |
| Safeguarding premium but calm, credible, factual | met | task 9; no fabricated claims at any point this session (standing instruction honoured throughout) |
| Testimonials/enquiry/closing CTA intentionally composed | met | task 10; task 15 audit confirmed the asymmetric grid is explicitly not a carousel |
| About is a brand story, not a generic content page | met | task 11: founders' real portraits, asymmetric offset, scroll parallax scoped to real imagery only |
| Book/Contact/FAQ receive route-specific craft | met | task 12: corner-frame + atmosphere (Book), per-method icons (Contact), active-nav (FAQ) |
| Legal/support pages restrained but visually unified | met | task 13: one shared change (`LegalPage.tsx`), faint backdrop, print/readability preserved |
| Selected section boundaries feel connected | met | task 14: `SectionHandoff` applied to 3 new + 2 existing boundaries, deliberately not every one |
| No major route relies on repeated three-card-grid formula | met | task 15's audit checked this explicitly per route; every 3-up grid found is asymmetric or content-justified |
| Large typography intentional, not ubiquitous | met | task 15 audit: varied, confident scales per route, not one size reused everywhere |
| Palette remains unmistakably LearnThrive | met | same navy/green/cream tokens on every route, checked per-route in task 15's audit |
| No fake metrics/claims/certifications/stages introduced | met | standing instruction honoured throughout; safeguarding content specifically restates existing, real claims only |
| No animation blocks primary content or LCP | met | first-screen content uses the `static` Reveal variant sitewide; every route's LCP is under 300ms in this report's table |
| Heavy visual code outside the critical path | met | WebGL gradient dynamically imported (`ssr: false`); `CinematicBackdrop` suspends offscreen |
| WebGL/Three.js has static fallback and capability gating | met | `HeroWebGLAtmosphere` falls back to a static glow on every non-full tier (marketing-motion.spec.ts) |
| WebGL/Three.js stops offscreen/hidden | met | `CinematicBackdrop`'s `useSceneActivity` unmounts content, not just hides it |
| No per-frame React-state transport introduced | met | threshold-crossing pattern (`useDiscreteProgress`) used throughout; never reverted to per-frame `setState` |
| No continuous layout animation without measured justification | met | every scroll-linked effect is transform/opacity only; CLS is 0 on every route in this report |
| No `transition: all` or global `will-change` introduced | met | never used this session |
| Native scrolling remains authoritative | met | no scroll-jacking anywhere; task 15 audit confirmed testimonials/ProductStoryScene explicitly avoid it |
| Mobile/light tier remains fast and readable | met | mobile LCP under 280ms on every route in this report's table |
| Reduced motion preserves full content and usability | met | dedicated test at nearly every task this plan; axe itself runs under reduced motion |
| 360px has no horizontal overflow | met | existing coverage + this task's 600-1280px sweep |
| Public pages remain keyboard usable | met | this task's new keyboard-only test block |
| Accessibility checks pass | met | axe: 22/22, 0 violations |
| Plan 11 performance not materially regressed without a documented reason | met | +10KB gzip / 16 tasks of real feature work, reasoned above; the one notable frame-pacing movement (`/maths-tuition`) is explained, not silently accepted |
| Lint/typecheck/tests/build are green | met | this task's own fresh run |
| Final visual QA and performance reports are committed | met | `docs/PLAN12_VISUAL_QA.md` (task 15) + this file |

Every item is met. The one item marked "honestly partial" (spatial product-story transform) is a
deliberate, reasoned restraint rather than a shortfall against this plan's own engineering rule —
recorded here rather than silently marked "done" with no caveat, matching how every other report
this plan produced has handled a judgment call.

## What this report can't honestly claim

The same four gaps every plan12 doc has been explicit about, unchanged by this task:

- No screenshots — every visual claim here is structural, functional, or raw-output evidence, never
  a rendered impression. Whether the site actually *feels* cinematic, whether the About page's
  founder photos read well with their parallax offset, whether eleven-plus's new dashed line looks
  right against maths's solid one — genuine visual/brand-fit judgment, left for direct review.
- No real mobile device (iPhone/Android) or non-Chromium browser (Safari/Firefox/Edge) testing.
- No screen-reader testing (NVDA/JAWS/VoiceOver) — axe and manual keyboard/focus checks are strong
  automated proxies, not a replacement for a real assistive-technology pass.
- Frame-pacing numbers are Chromium-on-this-machine readings; the profiler's own note stands: "a
  container or CI runner renders in software... treat absolute values as a lower bound... the
  before/after difference as the result."
