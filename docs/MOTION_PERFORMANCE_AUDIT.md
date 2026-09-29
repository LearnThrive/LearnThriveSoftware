# Motion and rendering performance audit

Plan 11, task 2. Audited at base commit `554013b` (the last commit before any Plan 11 work) across
`apps/web/src` and `apps/classroom/src`.

The point of this document is to decide, finding by finding, what gets fixed, what stays, and what
needs a measurement before anyone touches it — and to leave a record that later tasks can be checked
against. `docs/MOTION_PERFORMANCE_REPORT.md` (task 20) closes each finding with a before/after number.

## How this was done

- Searched the repository for: scroll / resize / pointer / wheel listeners; `requestAnimationFrame`
  and `cancelAnimationFrame`; `setInterval`; `IntersectionObserver` / `ResizeObserver` /
  `MutationObserver`; `@keyframes` and every `animation:`; every `transition:`; `transition: all`;
  animated `width` / `height` / `top` / `left` / `margin` / `padding`; `box-shadow`; `filter`;
  `backdrop-filter`; `background-position`; `will-change`; canvas and WebGL; React state written
  from frame, audio and timer callbacks.
- Read every hit rather than trusting the pattern. `requestAnimationFrame(() => el.focus())` is a
  one-shot scheduling trick, not an animation loop, and is listed separately below.
- Measured the production build of the base commit with `apps/web/scripts/profile-motion.mjs`
  (task 1). Those numbers are in [Baseline measurements](#baseline-measurements). Anything not
  measured is labelled **unmeasured** and its cost is stated as reasoning, not fact.

### Classification

| Label | Meaning |
| --- | --- |
| **KEEP** | Cheap, bounded, or already correct. Left alone, with the reason. |
| **OPTIMISE** | Worth doing; the fix is known. |
| **REMOVE** | Costs more than it is worth, or is dead. |
| **ISOLATE** | Fine in itself but does work it should not (offscreen, hidden, on the wrong tier); needs a boundary. |
| **MEASURE FIRST** | Plausibly expensive, but the fix has a visual cost, so it is measured before it is changed. |

### What was searched for and not found

- `transition: all` / `transition-property: all`: **none**, in any stylesheet or inline style.
- `will-change`: **none**. Nothing is promoted to its own layer by hint today; task 7/8 introduces it, and only
  on layers measured as hot and only while they are on screen.
- `scroll`, `resize`, `pointermove`, `mousemove`, `touchmove` or `wheel` listeners: **none**. All scroll
  work is Motion's `useScroll`, which shares one observer path.
- Canvas / WebGL: **none** in the product code.
- `background-position` animation: **one** (the skeleton shimmer, [A-01](#a-01-skeleton-shimmer-animates-background-position)).

## The nine named suspects

| Suspect | Verdict | Finding |
| --- | --- | --- |
| `.heroGlow` | **OPTIMISE** (effectively REMOVE the perpetual motion) | [M-01](#m-01-hero-glow-heroglow-on-five-pages) |
| Animated card shadows | **OPTIMISE** | [M-04](#m-04-hover-shadow-interpolation-on-cards) |
| Product Story progress width | **OPTIMISE** | [M-06](#m-06-product-story-progress-toggles-width-from-react-state) |
| Product Story scroll → state | **OPTIMISE** | [M-07](#m-07-product-story-scroll--setstate-on-every-spring-tick) |
| Safeguarding scroll → state | **OPTIMISE** | [M-08](#m-08-safeguarding-scroll--setstate-on-every-spring-tick) |
| `ScrollReveal` | **OPTIMISE** | [M-05](#m-05-scrollreveal-one-observer-and-one-timer-per-instance) |
| Marquee | **ISOLATE** | [M-02](#m-02-marquee-never-pauses-offscreen-or-hidden) |
| Skeleton shimmer | **OPTIMISE** | [A-01](#a-01-skeleton-shimmer-animates-background-position) |
| Both `MicLevelMeter` implementations | **OPTIMISE** | [C-01](#c-01-miclevelmeter-two-identical-copies-setstate-per-animation-frame) |

## Marketing site

### M-01 Hero glow (`.heroGlow`) on five pages

- **Where:** `(public)/home.module.css:102` and the same block copied into `subjects/subjects.module.css:63`,
  `about/about.module.css`, `contact/contact.module.css`, `faq/faq.module.css` (each owns a private copy).
- **What it does:** a 340–380 px circle with `filter: blur(10px)` and `animation: lt-float 11s ease-in-out infinite`
  (a 9 px vertical drift) — forever, on every page that has a hero, whether or not it is on screen.
- **Cost (measured):** at rest, every page with a hero glow does **1.01 style recalculations per frame**;
  the two pages without one do **0** ([baseline](#baseline-measurements)). The animation is not
  running on the compositor — it is a main-thread animation, on a filtered layer, on every frame, for as
  long as the tab is open. A 10 px blur on a 380 px circle at 18% opacity is also visually
  indistinguishable from a soft-edged radial gradient, so the filter buys nothing.
- **Verdict:** OPTIMISE, in practice REMOVE the perpetual motion.
- **Fix:** replace the filtered circle with a `radial-gradient` background whose soft edge is baked in (no
  `filter`), delete the infinite float, and — on the homepage only — give it bounded, scroll-linked drift
  through `ParallaxLayer` (task 7/8) so it moves *because the visitor scrolled*, never on its own.
- **Validate:** `runningAnimationsAtRest` in the profile no longer lists `lt-float`; idle
  `RecalcStyleCount` per frame drops; before/after screenshots at 1440/834/390.

### M-02 Marquee never pauses offscreen or hidden

- **Where:** `home.module.css:338-360` (`.lt-marquee`, `.lt-marquee__track`), rendered by
  `components/Marquee.tsx` on `/` and `/subjects`.
- **What it does:** `animation: lt-marquee 26s linear infinite` on `transform: translateX`. It pauses on
  hover and nothing else.
- **Cost:** low per frame — `transform` is compositor work — but it never stops. It runs while the marquee
  is scrolled far out of view and while the tab is in the background, so the page can never fully idle.
- **Also found — a visual bug.** The marquee's rules were `:global` selectors inside `home.module.css`,
  a stylesheet only the homepage loads. On a direct visit to `/subjects` or `/about` (which render the same
  `<Marquee>`) the strip was unstyled. The baseline shows it: `lt-marquee` is running on `/` and on
  neither of the other two.
- **Verdict:** ISOLATE, and fix the bug.
- **Fix:** move the styles into a CSS module owned by `Marquee` (so every page that renders it gets them);
  keep the transform animation; pause it (`data-paused`) while the marquee is more than 160 px off screen or
  the document is hidden, from the shared viewport observer and visibility listener — task 3's activity layer.
- **Validate:** e2e asserts the marquee's `CSSAnimation.playState` is `paused` when scrolled away and
  `running` when returned to; profile `runningAnimationsAtRest` at the bottom of the page.

### M-03 Hero entrance keyframes (`lt-rise`, `lt-mark`)

- **Where:** the `lt-rise` / `lt-mark` blocks in `home`, `subjects`, `about`, `contact` and `faq` modules.
- **What it does:** finite (`both`, one iteration) opacity + transform and a `scaleX` underline draw.
- **Cost:** compositor properties only; one-shot.
- **Verdict:** KEEP. (The five per-module copies of the same three keyframes are duplicated source, not
  duplicated runtime cost; CSS Modules scope each copy. Not worth a cross-module abstraction.)

### M-04 Hover shadow interpolation on cards

- **Where:** `home.module.css:402` (`.whyCard*`), `:666-690` (`.subjectCard`); `subjects.module.css:283`
  (`.levelCard`, `.levelCardDark`); `about.module.css:184`; `contact.module.css:145`; `faq.module.css:251`.
  Same pattern in the app: `app-shell.css:466` (`.stat-tile--link`).
- **What it does:** `transition: box-shadow 0.3s` between no shadow and `0 26px 44px -28px …` (a 44 px blur,
  26 px offset), together with a `translateY` lift.
- **Cost:** `box-shadow` is a paint property. Interpolating a large blurred shadow repaints its whole
  expanded region on every frame of the 300 ms transition, while the `transform` beside it is free.
  Bounded to hover, so it is a hitch, not a steady tax. **Unmeasured** (the profile does not hover cards).
- **Verdict:** OPTIMISE.
- **Fix:** draw the resting-state-invisible shadow once, on a pseudo-element, and transition its `opacity`
  (a compositor property). Cards with `overflow: hidden` (`.subjectCard`) move the clip to an inner
  wrapper so the shadow layer is not clipped.
- **Validate:** Chrome trace / paint count around a hover; no `box-shadow` in any `transition` list on a
  marketing card.

### M-05 `ScrollReveal`: one observer and one timer per instance

- **Where:** `components/ScrollReveal.tsx`; 39 call sites (`page.tsx` 21, `about` 6, `subjects` 5, `contact` 5,
  `faq` 2), several inside `.map()`, so about 29 instances render on the homepage and 18 on `/subjects`.
- **What it does:** every instance constructs its own `IntersectionObserver` (one per instance, so ~29
  observers on the homepage) and calls `setTimeout(add class, delay)`. Content is `opacity: 0` (`:global(.rv)`) until JavaScript adds `.rv--in`.
- **Cost:** dozens of observers and pending timers, each a separate registration to service on scroll;
  and content that stays invisible if the script is slow or blocked (the `<noscript>` override in the
  `(public)` layout exists for exactly that). One style, one direction, one duration for everything —
  the "generic fade-up" the plan calls out.
- **Verdict:** OPTIMISE.
- **Fix:** task 6's `Reveal` — Motion's viewport observation (shared), six variants, compositor-only
  properties. `ScrollReveal` is deleted only after every import is migrated.
- **Validate:** observer count on `/` before/after; reduced-motion test renders every variant's final
  content; the `.rv` class and the `<noscript>` workaround disappear together.
- **Addendum (task 20):** the `.rv` reveal CSS this finding describes was itself inert on
  `/subjects`, `/about`, `/contact` and `/faq` at the time of the baseline — its rules were
  `:global` selectors inside `home.module.css`, a stylesheet only the homepage loads (the same bug
  class as [M-02](#m-02-marquee-never-pauses-offscreen-or-hidden)'s marquee). Content on those four
  pages was simply always visible; the "generic fade-up" M-05 describes was only actually running on
  `/`. That masked a second, latent defect: once task 6's properly-scoped `Reveal` made reveals work
  everywhere, the first block after the hero on each of those four pages — previously just visible —
  started at `opacity: 0` in the server-rendered HTML until the script loaded, moving the page's LCP
  element behind a client-side animation. Production-build profiling caught it directly: `/subjects`
  204→864 ms, `/about` 184→1072 ms, `/contact` and `/faq` ~870 ms (`2a0ec0d`). Fixed by giving each
  page's first-screen block the explicit `static` variant; content below the fold still reveals.
  After: `/subjects` 196 ms desktop / 152 ms mobile, `/about` 176 / 148, `/contact` 116 / 120, `/faq`
  148 / 140 — at or below their pre-reveal baseline, not just recovered.
  **The lesson:** a reveal's hidden start state lives in the server-rendered HTML, so it always costs
  something until the client script runs and decides otherwise — the cost is invisible in development
  (fast refresh, warm cache) and only shows up in a *production* profile. Every task after this one
  that added a reveal to first-screen content (9, 10, 11, 12) opted that block into `static` from the
  start rather than discovering the same regression again; `marketing-motion.spec.ts`'s "the first
  block after the hero is never held back by a reveal" test guards all eight routes together.

### M-06 Product Story progress toggles `width` from React state

- **Where:** `components/motion/scenes/ProductStoryScene.tsx:171-175` (`stageDotFill`,
  `style={{ width: i <= activeScene ? "100%" : "0%" }}`), `ProductStoryScene.module.css:.stageDotFill`.
- **What it does:** six progress segments; segment *i* jumps between `0%` and `100%` width when the
  active scene changes. There is no CSS transition, so it does not animate — it snaps.
- **Cost:** `width` is a layout property, changed via React re-render. Small element, small cost, but it is
  the wrong property, and it snaps where a scroll-linked fill would read as motion.
- **Verdict:** OPTIMISE.
- **Fix:** `transform: scaleX()` with `transform-origin: left`, driven by a `MotionValue` derived from the
  scene's scroll progress — a smooth fill that never touches layout and never goes through React.
- **Validate:** no `width` written to the segment; segment fill tracks scroll progress.

### M-07 Product Story: scroll → `setState` on every spring tick

- **Where:** `ProductStoryScene.tsx:130-134` (`useMotionValueEvent(smoothProgress, "change", …)`).
- **What it does:** `smoothProgress` is a spring over scroll progress. Its `change` event fires every frame
  while scrolling and while the spring settles, and each event calls `setActiveScene(index)` — usually with
  the value it already holds.
- **Cost:** React short-circuits an identical `useState` update, so most calls do not re-render, but every
  frame still dispatches into React's scheduler, and each *real* change re-renders the whole scene
  (`AnimatePresence` subtree included). **Unmeasured** in isolation.
- **Verdict:** OPTIMISE.
- **Fix:** keep the previous discrete index in a ref; call `setActiveScene` only when the index crosses a
  threshold. Discrete state for discrete UI; nothing per frame.
- **Validate:** unit test of the threshold logic (setter called once per crossing, including fast reverse
  scroll); profile `scrollDown` `ScriptDuration` on `/`.

### M-08 Safeguarding: scroll → `setState` on every spring tick

- **Where:** `components/motion/scenes/SafeguardingScene.tsx:70-74`.
- **What / cost / fix / validate:** identical to M-07 (four stages instead of six). Same threshold-crossing
  fix. The existing hydration safeguards (state seeded to `0`, corrected after mount) must stay exactly as
  they are.

### M-09 Hero scroll choreography

- **Where:** `components/motion/scenes/HeroScene.tsx` — eight `useTransform`s off one spring-smoothed scroll
  progress, applied to the headline, lead, CTAs, the product photo (`scale` + `y`), two chips and the
  dot grid.
- **Cost:** MotionValue → style writes each frame, which is the right architecture (no React per frame).
  What is **unmeasured** is whether the large photo layer repaints or merely re-composites as it scales:
  without a promoted layer, changing `transform` from JavaScript on an unpromoted element can repaint its
  parent layer.
- **Verdict:** MEASURE FIRST.
- **Fix:** measure, then promote only what the trace shows repainting, via `will-change: transform` set
  while the hero is on screen and removed after (task 7/8). Add bounded layered parallax at the plan's
  ranges (8–20 / 10–24 / 18–34 px) scaled by tier.
- **Validate:** `scrollDown` frame stats and `LayoutCount` / `RecalcStyleCount` on `/`, 1× and 4× throttle.

### M-10 Learning-path SVG line

- **Where:** `components/motion/scenes/LearningPathScene.tsx` (`pathLength` from scroll progress).
- **Cost:** a 2 px dashed SVG line redrawn per frame; tiny.
- **Verdict:** KEEP. Moves to the shared `ScrollProgressPath` primitive in task 8 without changing behaviour.

### M-11 `StatCounter`: React state on every animation frame

- **Where:** `components/StatCounter.tsx:48-53`.
- **What it does:** on first scroll into view, counts up over 900 ms by calling `setDisplay(string)` inside a
  `requestAnimationFrame` loop — about 54 React renders for one number.
- **Verdict:** OPTIMISE (the same class of problem as C-01, on the marketing site).
- **Fix:** drive the text node directly from Motion's `animate(0, target, { onUpdate })` writing
  `textContent` — no React per frame. Keep the exact hydration-safe contract in the file's own comment
  (the server and first client render always show the real value).
- **Validate:** the served HTML still contains the real value; unit test that the loop does not call `setState`.

### M-12 Sticky header `backdrop-filter`

- **Where:** `globals.css:422-430` (`.site-header`: `position: sticky`, `background: rgb(255 255 255 / 96%)`,
  `backdrop-filter: blur(16px)`).
- **Cost:** a sticky element with a backdrop blur must re-sample and re-blur whatever scrolls beneath it on
  every scroll frame. At 96% opacity the blur is close to invisible, so the cost buys almost nothing.
  **Unmeasured.**
- **Verdict:** MEASURE FIRST, expected REMOVE.
- **Fix:** task 13 redesigns header state anyway (airy at top → compact and solid when scrolled). The
  scrolled state is an opaque background with no `backdrop-filter`.

### M-13 Dead legacy hero CSS with a `backdrop-filter`

- **Where:** `globals.css:721-737` (`.hero-image-frame__label`, `backdrop-filter: blur(10px)`), and its
  siblings `.hero-image-frame`, `.hero-subject-note`, `.live-dot`.
- **Finding:** none of these class names is referenced by any `.tsx` file. The rules ship in the global
  stylesheet and are never applied.
- **Verdict:** REMOVE (dead code).
- **Validate:** `grep` for the class names finds nothing outside the deleted block; the CSS bundle shrinks.

### M-14 `ProductTabs`, motion `Reveal`, nested `LazyMotion`

- **Where:** six components each wrap themselves in their own `<LazyMotion features={domAnimation}>`
  (`HeroScene`, `LearningPathScene`, `ProductStoryScene`, `SafeguardingScene`, `ProductTabs`,
  `motion/Reveal`).
- **Cost:** none at runtime beyond a few context providers — the `domAnimation` bundle is shared. The cost is
  architectural: no component can assume a runtime exists, and a new island has to remember to bring one.
- **Verdict:** REMOVE the nested wrappers once a shared boundary is proven (task 3's `MotionRuntime`).
- **Related:** `components/motion/Reveal.tsx` has **no call sites**. It is unused code from the Plan 9/10
  passes, superseded by task 6's `Reveal`.

### M-15 `useMotionTier` read `matchMedia` during the first client render

- **Where:** `lib/motion/capabilities.ts` (before task 3): `useState(computeTier)`.
- **Cost:** not performance — correctness. A first-render read of a browser-only API can differ from the
  server's answer; the file leaned on "the server returns full and hope". Also three tiers, not four.
- **Verdict:** OPTIMISE (task 3): one module-level store, subscribed to `matchMedia` once, read through
  `useSyncExternalStore` with a fixed server snapshot, four tiers.

### M-16 Springs on scroll progress

- **Where:** `lib/motion/scroll.ts` (`useSpring(scrollYProgress, {stiffness: 240, damping: 40, mass: 0.4})`),
  one per scene.
- **Cost:** each spring runs on Motion's shared frame loop until it settles, so a few scenes on screen means
  a few springs ticking during and just after every scroll. Cheap arithmetic; the cost is what each
  spring's output *drives* (M-09).
- **Verdict:** KEEP the smoothing (it absorbs Safari's coarser scroll steps, per the file's own note);
  MEASURE FIRST if a profile ever shows the frame loop, not the style writes, on top.

## Authenticated app

### A-01 Skeleton shimmer animates `background-position`

- **Where:** `app-dashboard.css:174-182` (`.skeleton`, `@keyframes skeleton-shimmer`); used by
  `(app)/dashboard/loading.tsx`.
- **What it does:** `background-size: 400% 100%` and an infinite `background-position` animation.
- **Cost:** `background-position` is a paint property — every skeleton on screen repaints every frame for as
  long as the page is loading. Bounded by load time, but it is exactly when the main thread is busiest.
- **Verdict:** OPTIMISE.
- **Fix:** a `::after` pseudo-element carrying the gradient, moved with `transform: translateX()`, clipped by
  the skeleton's own `overflow: hidden`. Reduced-motion rule stays.
- **Validate:** no `background-position` keyframes remain.

### A-02 Filter-tab indicator transitions `width`

- **Where:** `app-components.css:118-122` (`.filter-tabs__indicator`: `transition: transform, width, opacity`),
  positioned by `components/ui/FilterTabs.tsx`.
- **Cost:** a 2 px absolutely positioned bar; animating `width` re-lays out only itself. Negligible, but
  it is the one place the app animates a layout property for movement.
- **Verdict:** OPTIMISE (small, and consistent with the rule): `translateX` + `scaleX` from the left origin.

### A-03 Stat-tile hover shadow

- **Where:** `app-shell.css:466-472` (`.stat-tile--link`). Same shape as M-04, on a small tile.
- **Verdict:** OPTIMISE with the same pseudo-element technique, or KEEP if a paint trace shows it under
  budget — a 160 ms transition on a ~10 rem tile is far cheaper than M-04's 44 px shadows. **Unmeasured.**

### A-04 Calendar event hover: `filter` + `box-shadow`

- **Where:** `app-dashboard.css:245-260` (`.calendar-wrap .fc-event:hover { filter: brightness(0.96); box-shadow }`).
- **Cost:** per hovered event only, but FullCalendar month views hold dozens; `filter` forces a separate
  render surface for the element while it transitions.
- **Verdict:** OPTIMISE — an `::after` overlay whose `opacity` changes replaces the filter; the shadow is
  dropped in favour of the existing border/background change. **Unmeasured.**

### A-05 Sticky topbar `backdrop-filter`

- **Where:** `app-shell.css:234-242` (`.app-topbar`, `blur(10px)` over `rgb(255 255 255 / 86%)`).
- **Cost:** as M-12, over a smaller area (one topbar-height strip) but with a visible blur (86%).
  **Unmeasured.**
- **Verdict:** MEASURE FIRST. The authenticated app is "precise UI motion only"; an opaque topbar loses
  almost nothing and cannot cost anything on scroll.

### A-06 `AnimatedNumber`: React state on every animation frame

- **Where:** `components/ui/AnimatedNumber.tsx:43-49` (380 ms count between two values).
- **Verdict:** OPTIMISE — same fix as M-11 (direct text write from `animate()`), keeping the "first render is
  never animated" rule the file documents.

### A-07 Sidebar collapse transitions `max-width`

- **Where:** `app-shell.css:153-157` and `:186-190` (`.app-brand__word`, `.app-nav__label`).
- **Cost:** two short text spans re-lay out for 220 ms when the user toggles the sidebar. Rare, user-initiated.
- **Verdict:** KEEP. The alternative (measuring each label and animating a transform) is more machinery than
  a once-in-a-session toggle is worth. Revisit only if a trace shows it.

### A-08 Focus-ring and input transitions

- **Where:** `app-components.css:229, 274` and similar (`transition: border-color, box-shadow` on inputs and
  buttons).
- **Cost:** a few-pixel shadow on a small element for 160 ms on focus.
- **Verdict:** KEEP.

### A-09 Dialog, dropdown, toast, drawer

- **Where:** `components/ui/Dialog.tsx`, `Toaster.tsx`, `dashboards/QuickCreateMenu.tsx`,
  `shell/AppShellClient.tsx`, via `lib/motion/useDelayedUnmount.ts`.
- **Finding:** each unmounts after its exit animation, and reduced motion unmounts immediately; nothing keeps
  running while closed. Animations are opacity/transform keyframes (`app-pop`, `dialog-in`, `toast-in`,
  `app-drawer-in`).
- **Verdict:** KEEP. Confirmed for task 16's "stop work when closed" requirement.

### A-10 One-shot and bounded keyframes

- **Where:** `bell-ring`, `app-pop`, `stat-tile-in`, `empty-state-in`, `field-error-in`, `auth-enter`,
  `lesson-peek-in`, `toast-check-in`, and `btn-spin` (infinite, but only while a button is loading).
- **Verdict:** KEEP. All transform/opacity; none loop except the spinner, which exists only while busy.

## Classroom

Performance-first: no decorative motion is added here, only work removed.

### C-01 `MicLevelMeter`: two identical copies, `setState` per animation frame

- **Where:** `apps/web/src/features/classroom/components/MicLevelMeter.tsx` and
  `apps/classroom/src/components/MicLevelMeter.tsx` (byte-identical).
- **What it does:** an analyser sampled in `requestAnimationFrame`; every frame calls `setLevel(...)`, which
  re-renders the component, rewrites the inline `transform` and rewrites an `aria-label` containing the
  percentage.
- **Cost:** a React commit per display frame for as long as the pre-join screen is open, plus a per-frame
  change to an accessible name (`role="img"` with a changing label). The fill itself is already a
  `scaleX`, which is right.
- **Verdict:** OPTIMISE.
- **Fix:** keep sampling in rAF, but write the level straight to the element (`style.transform`) from a ref;
  keep the accessible name stable, updated at a low, human-readable cadence rather than per frame; stop the
  loop while the page is hidden. Lifecycle tests for analyser and rAF cleanup.
- **Validate:** unit tests (start/stop/hidden/unmount release every resource); no `setState` in the loop.

### C-02 `useMeeting`: every snapshot change re-renders the whole app

- **Where:** `features/classroom/useMeeting.ts` (`useSyncExternalStore(controller.subscribe, controller.getSnapshot)`),
  `meeting.ts:659-664` (`board:cursor` and `board:laser` events call `this.update({ boardPointers: … })`).
- **Cost:** every remote whiteboard pointer/laser event produces a new snapshot and re-renders `App` and
  everything not memoised beneath it, while Excalidraw is also busy. **Unmeasured** — this is task 17's
  first profile.
- **Verdict:** MEASURE FIRST, then ISOLATE (a separate subscription for high-frequency board pointers so the
  parent tree does not re-render).

### C-03 Poll option bars transition `width`

- **Where:** `features/classroom/styles.css` and `apps/classroom/src/styles.css` (`.poll-panel-option-bar`,
  `transition: width .25s`).
- **Cost:** a layout property on a bar inside a poll, changing when votes arrive. Small and infrequent.
- **Verdict:** OPTIMISE (task 17): `scaleX` from the left origin.

### C-04 Timers at visible cadence

- **Where:** `ClassTimer.tsx`, `Timer.tsx`, `HelpQueuePanel.tsx` (1 s intervals), `peer.ts` (`STATS_INTERVAL_MS = 2500`).
- **Finding:** each ticks at the rate the number visibly changes (seconds), and only while there is something
  to show (`HelpQueuePanel` stops with an empty queue; `ClassTimer` stops when paused).
- **Verdict:** KEEP.

### C-05 Classroom keyframes

- **Where:** `reaction-rise` (2.2 s, once), `tile-in`, `workspace-fade`, `timer-done` (once), and
  `timer-tick` (infinite, final ten seconds of a countdown only).
- **Verdict:** KEEP. All transform/opacity; the one loop is bounded to ten seconds by the class that
  starts it. `prefers-reduced-motion` already disables each.

### C-06 Global classroom button transition

- **Where:** `styles.css`: `button { transition: background, border-color, box-shadow, transform .16s }`.
- **Verdict:** KEEP. Small controls, 160 ms, discrete triggers.

## Benign scheduling (not animation)

| Where | What | Verdict |
| --- | --- | --- |
| `ui/Dialog.tsx:71`, `SiteHeader.tsx:41`, `EnquiryForm.tsx:97,115` | `requestAnimationFrame(() => el.focus())` — one call, moves focus after a render | KEEP |
| `api/enquiry/route.ts:43` | server-side `setInterval` that prunes a rate-limit map | KEEP (not rendering) |
| `ui/FilterTabs.tsx` | `ResizeObserver` → one `setState` when the tab row resizes | KEEP (discrete, not per frame) |
| `shell/AppShellClient.tsx`, `dashboards/QuickCreateMenu.tsx`, `ui/Dialog.tsx` | `keydown` / `pointerdown` listeners, attached only while open | KEEP |

## Baseline measurements

Captured on the unmodified base commit `554013b` with `apps/web/scripts/profile-motion.mjs`, against a
production build (`next build` + `next start`), three runs per row, medians shown. The complete JSON
(including the scroll-back-up phase and the pointer sweep) is written under the git-ignored
`apps/web/artifacts/motion-profile/`.

**Read these with the environment in mind.** The browser was headless Chromium 141 rendering in
software (SwiftShader) on a 4-core container, with a virtual 60 Hz display. Frame pacing is
therefore saturated — every row reads a 16.7 ms p95 with almost nothing dropped — so on this
machine the *discriminating* numbers are the main-thread counters (layouts, style recalculations,
script and task time). Absolute values say little about a real phone or a 144 Hz monitor; the
before/after difference on the same machine is the result. Cadence is also *inferred* from observed
frames, not read from the display, so a page that never beats 60 fps on a faster panel would read as
a healthy 60 Hz page (see `lib/motion/frameProfiler.ts`).

_baseline · Chromium 141.0.7390.37 · ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)_
_commit 554013b · 3 run(s) per row, medians · CPU throttle 1×_


### Load and size

| Route | Viewport | LCP ms | FCP ms | CLS | JS KB (gz) | CSS KB (gz) | Long tasks / blocking ms | DOM nodes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | desktop-1440x900 | 180 | 180 | 0 | 192.4 | 34.4 | 1 / 36 | 609 |
| `/subjects` | desktop-1440x900 | 204 | 144 | 0 | 192.4 | 34.4 | 0 / 0 | 352 |
| `/maths-tuition` | desktop-1440x900 | 120 | 120 | 0 | 192.4 | 34.4 | 0 / 0 | 292 |
| `/about` | desktop-1440x900 | 184 | 184 | 0 | 192.4 | 34.4 | 0 / 0 | 225 |
| `/book` | desktop-1440x900 | 136 | 136 | 0 | 192.4 | 34.4 | 0 / 0 | 259 |
| `/` | mobile-390x844 | 180 | 180 | 0 | 192.4 | 34.4 | 1 / 48 | 609 |
| `/subjects` | mobile-390x844 | 132 | 132 | 0 | 192.4 | 34.4 | 0 / 0 | 352 |
| `/maths-tuition` | mobile-390x844 | 104 | 104 | 0 | 192.4 | 34.4 | 0 / 0 | 292 |
| `/about` | mobile-390x844 | 108 | 108 | 0 | 192.4 | 34.4 | 0 / 0 | 225 |
| `/book` | mobile-390x844 | 132 | 132 | 0 | 192.4 | 34.4 | 0 / 0 | 259 |

### Scrolling down the whole page

| Route | Viewport | p95 frame ms | Dropped % | Layouts | Style recalcs | Script ms | Main-thread task ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | desktop-1440x900 | 16.8 | 0.3 | 171 | 648 | 154 | 835 |
| `/subjects` | desktop-1440x900 | 16.7 | 0 | 2 | 124 | 13 | 139 |
| `/maths-tuition` | desktop-1440x900 | 16.7 | 0 | 0 | 0 | 15 | 93 |
| `/about` | desktop-1440x900 | 16.8 | 1 | 2 | 99 | 13 | 122 |
| `/book` | desktop-1440x900 | 16.8 | 0 | 0 | 0 | 10 | 67 |
| `/` | mobile-390x844 | 16.7 | 0 | 154 | 645 | 151 | 830 |
| `/subjects` | mobile-390x844 | 16.7 | 0 | 1 | 257 | 27 | 192 |
| `/maths-tuition` | mobile-390x844 | 16.7 | 0 | 0 | 0 | 23 | 128 |
| `/about` | mobile-390x844 | 16.7 | 0 | 1 | 178 | 20 | 145 |
| `/book` | mobile-390x844 | 16.7 | 0 | 0 | 0 | 17 | 96 |

### At rest (nothing scrolling, nothing moving the pointer)

| Route | Viewport | Dropped % | Style recalcs per frame | Script ms | Animations still running |
| --- | --- | --- | --- | --- | --- |
| `/` | desktop-1440x900 | 0 | 1.01 | 6.9 | lt-float, lt-marquee |
| `/subjects` | desktop-1440x900 | 0 | 1.01 | 7 | lt-float |
| `/maths-tuition` | desktop-1440x900 | 0 | 0 | 7.4 | none |
| `/about` | desktop-1440x900 | 0 | 1.01 | 7.3 | lt-float |
| `/book` | desktop-1440x900 | 0 | 0 | 7.4 | none |
| `/` | mobile-390x844 | 0 | 1.01 | 6.8 | lt-float, lt-marquee |
| `/subjects` | mobile-390x844 | 0 | 1.01 | 6.6 | lt-float |
| `/maths-tuition` | mobile-390x844 | 0 | 0 | 6.5 | none |
| `/about` | mobile-390x844 | 0 | 1.01 | 6.3 | lt-float |
| `/book` | mobile-390x844 | 0 | 0 | 6.6 | none |

### What the baseline says

1. **The hero glow costs a style recalculation on every frame, forever.** At rest, every page that has
   one (`/`, `/subjects`, `/about`) does **1.01 style recalculations per frame**; the two pages
   without it (`/maths-tuition`, `/book`) do **0**. `lt-float` is listed as still running on exactly
   the pages that recalc. That is a main-thread animation, not the compositor-only motion a
   `transform` animation is supposed to be — which makes [M-01](#m-01-hero-glow-heroglow-on-five-pages)
   the cleanest win available.
2. **The homepage's scroll cost is React, not the browser.** One scroll down `/` performs **171
   layouts and 648 style recalculations** (154 layouts on mobile), against **0–2 layouts** on every
   other route. The pages that scroll cleanly have no scroll-driven state; the homepage has the
   Product Story and Safeguarding scenes ([M-07](#m-07-product-story-scroll--setstate-on-every-spring-tick),
   [M-08](#m-08-safeguarding-scroll--setstate-on-every-spring-tick)), the `width`-toggled progress
   segments ([M-06](#m-06-product-story-progress-toggles-width-from-react-state)), and the
   `StatCounter` count-up ([M-11](#m-11-statcounter-react-state-on-every-animation-frame)).
3. **The marquee is unstyled on a direct visit to `/subjects` and `/about`.** `/` lists
   `lt-marquee` among its running animations; `/subjects` and `/about` — which render the same
   `<Marquee>` — do not. Its rules were `:global` selectors inside `home.module.css`, a stylesheet
   only the homepage loads. This was a real visual bug, found by the profile rather than by eye
   (fixed in task 5 by giving the component its own stylesheet).
4. **Every route ships the same 192 KB of JavaScript (gzipped)** — the framework, Motion and the
   site chrome are shared — and `/` blocks the main thread for one long task at load (36 ms over
   budget on desktop, 48 ms on mobile). CLS is 0 everywhere. These are the numbers "do not
   materially regress LCP, INP or CLS" is measured against.
5. **`/maths-tuition` and `/book` are the control group**: no scroll choreography, no glow, no
   marquee, and they scroll with zero layouts and zero style recalculations. Everything above is
   what a page pays for its motion today.

## Implementation tracker

All plan11 tasks (1–20; task 15 excepted, see below) are complete as of `26b3b8c`.

| Finding | Task | Status |
| --- | --- | --- |
| M-01 hero glow | 5, 7 | done |
| M-02 marquee | 3, 5 | done |
| M-04 card shadows | 5 | done |
| M-05 `ScrollReveal` | 6 | done (see addendum above) |
| M-06 progress width | 5, 7 | done |
| M-07 / M-08 scroll → state | 7 | done |
| M-09 hero choreography | 7, 8 | done |
| M-11 / A-06 counters | 4 | done |
| M-12 / A-05 sticky `backdrop-filter` | 13, 16 | done |
| M-13 dead CSS | 5 | done |
| M-14 / M-15 runtime | 3 | done |
| A-01 skeleton | 5, 16 | done |
| A-02 / A-03 / A-04 | 16 | done |
| C-01 mic meter | 4 | done |
| C-02 `useMeeting` | 17 | done |
| C-03 poll bars | 17 | done |

Task 15 (an optional WebGL hero enhancement) was measured and deliberately not built — see
`docs/MOTION_PERFORMANCE_REPORT.md` for why. Every other task, including the two checks added this
task (the sitewide 360px reflow assertion and the full-site axe sweep, both of which found and
fixed a real bug — see the report), is done and verified by `npm run lint/typecheck/test
--workspaces`, `npm run build --workspace @learnthrive/web`, and `npm run test:e2e` for both the
`@learnthrive/web` and `@learnthrive/classroom` workspaces.
