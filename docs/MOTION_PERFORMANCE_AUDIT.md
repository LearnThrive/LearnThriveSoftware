# Motion & Rendering Performance Audit

plan11.md Task 2. Findings are classified `KEEP` / `OPTIMISE` / `REMOVE` / `ISOLATE` / `MEASURE FIRST`,
each with the concrete path, cost, proposed fix, and how to validate the fix. This audit directly
informs Tasks 4, 5, and 7 — it doesn't attempt to catalogue every CSS transition in the codebase,
only continuous/high-frequency work and the plan's own named suspects.

**Baseline for comparison**: `apps/web/scripts/profile-motion.mjs`, first captured 28 September
2026 (saved locally under gitignored `artifacts/motion-profile/`, not committed — re-run to
reproduce). Homepage showed the highest dropped-frame rate (~8%) of the tested routes.

---

## Named suspects (plan11.md Task 2's explicit checklist)

### 1. `.heroGlow` — REMOVE the infinite loop, keep the visual

**Where**: `apps/web/src/app/(public)/home.module.css:101-111`, and — this is the actual
finding — **the identical pattern repeated on four other pages**, each with its own copy-pasted
`@keyframes lt-float`:

- `apps/web/src/app/(public)/about/about.module.css:60-67`
- `apps/web/src/app/(public)/contact/contact.module.css:62-69`
- `apps/web/src/app/(public)/faq/faq.module.css:61-68`
- `apps/web/src/app/(public)/subjects/subjects.module.css:67-74`

**Cost**: `filter: blur(10px)` combined with `animation: lt-float 11s ease-in-out infinite` on a
380px element. A moving blurred layer generally cannot be composited as cheaply as a moving
sharp one — many browsers must re-rasterize the blur at each new position rather than just
repositioning a cached layer — and it runs *forever*, on every page load, whether or not the
element is ever scrolled past or the tab is backgrounded. This directly violates the plan's own
global constraint ("every continuing animation must pause/suspend when offscreen or when the
document is hidden") on five separate pages at once.

**Proposed fix** (Task 5/7): either (a) drop the `filter: blur()` and fake the soft edge with a
radial-gradient's own alpha falloff instead — zero rasterization cost, same visual — or (b) keep
the blur but stop the perpetual loop: settle once on load (matching the rest of each hero's
entrance choreography) rather than animating indefinitely. Given five duplicated copies of the
same `@keyframes lt-float`, this is also a real candidate for the shared motion runtime (Task 3)
to own once, rather than five independent copies drifting further apart over time.

**Validation**: re-run `profile-motion.mjs` on `/`, `/about`, `/faq` before/after; the perpetual
loop's removal should show in reduced long-task/paint activity even on pages with no other scroll
choreography (`/faq`, `/contact` currently have none of the newer scene work, so any measured
improvement there isolates this specific fix).

---

### 2. Animated card shadows — OPTIMISE

**Where**:
- `apps/web/src/app/(public)/home.module.css:402` (`.btnPrimary:hover`), `:671`
  (`.subjectCard:hover`), and several static `box-shadow` values used as hover *targets* for
  those transitions (`:300`, `:312`, `:419`, `:432`, `:441`).
- `apps/web/src/app/(public)/subjects/subjects.module.css:283` (`.card:hover`).

**Cost**: `transition: box-shadow 0.3s` on hover/press. `box-shadow` is a paint property, not a
compositor one — every frame of the 300ms transition forces a repaint of the element (and,
depending on layering, potentially more). This is real but *bounded*: it only runs while a
pointer is actively hovering/pressing a card, not continuously, so the cost is real per-interaction
but not a standing tax on the page like the hero glow above.

**Proposed fix** (Task 5): the common technique — two overlapping shadow layers (or a
pseudo-element carrying the "hover" shadow at `opacity: 0`), cross-fading `opacity` on hover
instead of interpolating the `box-shadow` value itself. Opacity is compositor-only.

**Validation**: profile a hover-heavy interaction pass (rapid hover in/out across the subject
grid) before/after; expect measurably fewer paint events in the DevTools timeline for the same
interaction.

---

### 3. Product Story progress — width animation — OPTIMISE

**Where**: `apps/web/src/components/motion/scenes/ProductStoryScene.tsx:166-167`
(`.stageDotFill`, `style={{ width: i <= activeScene ? "100%" : "0%" }}`).

**Cost**: `width` is a layout property — animating it forces layout recalculation, unlike
`transform: scaleX()`, which achieves the identical visual result on the compositor only. Low
absolute cost here (a handful of small 3px-tall bars), but a completely free fix, and exactly the
example the plan names by title.

**Proposed fix** (Task 5): `transform: scaleX(...)` with `transform-origin: left`, driven by the
same `i <= activeScene` boolean.

---

### 4. Product Story scroll → state, and 5. Safeguarding scroll → state — OPTIMISE

**Where**:
- `apps/web/src/components/motion/scenes/ProductStoryScene.tsx:117-120`
  (`useMotionValueEvent(smoothProgress, "change", ...)` → `setActiveScene(index)`)
- `apps/web/src/components/motion/scenes/SafeguardingScene.tsx:55-59` (same shape,
  `setActiveStage(index)`)

**Cost**: both call their setState **on every "change" event of a spring-smoothed motion value**
— which fires on essentially every animation frame while the spring is still settling during
scroll — even when the derived discrete index hasn't actually changed. React's own same-value
bail-out (`Object.is` check) prevents the wasted *re-render*, but the callback invocation, the
`Math.min`/`Math.floor` recomputation, and the setState call overhead still happen every frame.
Not catastrophic (the actual work per call is tiny), but exactly the pattern the plan names by
title as worth fixing.

**Proposed fix** (Task 7, exactly as specified): track the previously-emitted index in a `ref`;
only call `setActiveScene`/`setActiveStage` when the newly-computed index differs from the ref's
current value, updating the ref alongside.

---

### 6. `ScrollReveal` — OPTIMISE (not urgent)

**Where**: `apps/web/src/components/ScrollReveal.tsx`.

**Cost**: creates one `IntersectionObserver` **per component instance**, not a shared observer.
The homepage alone has 15+ `<ScrollReveal>` usages. Each observer unobserves itself immediately
after firing once, so this is a one-time setup/teardown cost per instance on mount, not a
continuous runtime cost — genuinely low-severity, but the plan's Task 6 explicitly asks for
"Motion viewport/shared observation where practical," and consolidating N observers into one
shared one (or Motion's own `whileInView`, which does exactly this internally) is a real,
if modest, win — and reduces the total object/listener count on pages with many reveals.

**Proposed fix**: Task 6's new `Reveal` primitive vocabulary should replace `ScrollReveal`'s
per-instance observer with Motion's shared viewport observation, migrated incrementally.

---

### 7. Marquee — KEEP, with one caveat

**Where**: `apps/web/src/components/Marquee.tsx` + `.lt-marquee__track` (pure CSS
`@keyframes lt-marquee`, `transform: translateX(...)`, home.module.css).

**Cost**: already compositor-only (`transform`), already pure CSS with no JS runtime loop at
all — this is close to the ideal implementation. The one real gap: it runs `infinite`, including
while scrolled far offscreen. Browsers are generally efficient about not compositing genuinely
offscreen content, but the animation timer itself keeps ticking regardless. Low priority.

**Proposed fix** (optional, low priority): pause via `animation-play-state: paused` when the
marquee leaves the viewport (IntersectionObserver-gated) or document is hidden, if profiling
shows any measurable cost — otherwise leave as-is; this is already a good implementation.

---

### 8. Skeleton shimmer — REMOVE the paint cost

**Where**: `apps/web/src/app/app-dashboard.css:182` (`@keyframes skeleton-shimmer`,
`background-position: 100% 50%` → `0 50%`).

**Cost**: `background-position` is a paint property. Every skeleton tile shown during a loading
state repaints on every animation frame for as long as it's visible. Loading states can persist
for a real, unpredictable duration (network-dependent), so this isn't as bounded as the card-hover
case above.

**Proposed fix** (Task 5, exactly as specified): replace with a translated pseudo-element
gradient (`transform: translateX(...)` sweeping across a fixed background), which is
compositor-only.

---

### 9 & 10. `MicLevelMeter` (both implementations) — REMOVE React from the frame loop

**Where**:
- `apps/web/src/features/classroom/components/MicLevelMeter.tsx:20-27`
- `apps/classroom/src/components/MicLevelMeter.tsx:20-27` (byte-for-byte identical — confirmed
  duplication, matching the documented "ported from the original apps/classroom" history)

**Cost**: this is the clearest, most severe finding in the audit. `setLevel(...)` — a React
`useState` setter — is called **inside the `requestAnimationFrame` tick itself**, meaning the
whole `MicLevelMeter` component (and, depending on how it's mounted, potentially triggers
reconciliation of parent state) re-renders at full animation-frame cadence for as long as the
microphone is active — which could be the entire duration of a lesson, not a bounded window like
the count-up animations below. The visual technique this drives is already correct
(`transform: scaleX(level)`, compositor-friendly) — only the *delivery mechanism* is wrong.

**Proposed fix** (Task 4, exactly as specified): keep the analyser sampling in the rAF loop, but
write the level to a ref pointing at the `.mic-meter-fill` DOM node and set
`ref.current.style.transform` directly, bypassing React entirely for the per-frame value. The
`aria-label`'s percentage text can still use React state, but should be throttled independently
(e.g. updated every ~300-500ms) rather than on every frame — assistive tech doesn't need
frame-accurate mic level announcements, and decoupling it removes the last reason this component
would still re-render at animation-frame cadence.

**Validation**: React DevTools Profiler (or a render-count logger) confirms zero re-renders of
`MicLevelMeter` while the level visibly animates during a live mic test.

---

## Additional findings beyond the named checklist

### 11. `filter`/`backdrop-filter` inventory — mostly KEEP

Full repo search for `filter:`/`backdrop-filter:` outside the five `.heroGlow`-pattern instances
already covered above:

- `apps/web/src/app/app-shell.css:240` and `apps/web/src/app/globals.css:429` — **static**
  `backdrop-filter: blur()` on sticky headers (app topbar, site header). One-time compositing
  cost for a fixed-position element, not animated per-frame. **KEEP.**
- `apps/web/src/app/globals.css:736` — same pattern, another sticky/overlay surface. **KEEP**,
  not independently verified as animated; worth a quick look in Task 5 but not flagged as urgent.
- `apps/web/src/app/app-dashboard.css:258` — `.fc-event:hover { filter: brightness(0.96); ... }`
  (FullCalendar event hover). Bounded to hover interaction, same cost profile as the card-shadow
  finding above. **OPTIMISE** alongside Task 16's calendar hover audit, not urgent.
- `apps/web/src/features/classroom/styles.css:80` — `.floating-reaction.mine { filter:
  drop-shadow(...) }`, combined with a **bounded** 2.2s `reaction-rise` animation (an emoji
  reaction that rises and fades once, not a loop). Bounded duration, small element, low
  frequency (one per user reaction click). **KEEP** — flagged only for completeness.

### 12. `transition: all` / global `will-change` — clean

No matches anywhere in `src/**/*.css` or `*.module.css`. Nothing to fix here; noted so this
doesn't need re-auditing in a later pass.

### 13. Raw `scroll`/`resize`/`pointermove` listeners — clean

No component attaches these directly outside the `lib/motion/` scroll/capability infrastructure
already built in plan10/11 Task 1-3, which goes through Motion's own `useScroll`/media-query
listeners rather than hand-rolled ones. Nothing to fix.

### 14. `requestAnimationFrame` inventory — mostly benign, one real finding beyond MicLevelMeter

Full repo search for `requestAnimationFrame` outside `lib/motion/frameProfiler.ts` (the profiler
itself, exempt by definition) and the two `MicLevelMeter`s (already covered above):

- `apps/web/src/components/ui/Dialog.tsx:71`, `apps/web/src/components/SiteHeader.tsx:41`,
  `apps/web/src/components/EnquiryForm.tsx:97,115` — all `requestAnimationFrame(() =>
  element.focus())`, a one-shot "wait one paint, then move focus" pattern. This is exactly the
  "benign scheduling" the plan's Task 2 explicitly says to distinguish from a real loop.
  **KEEP**, not a loop at all.
- `apps/web/src/components/ui/AnimatedNumber.tsx:43-51` and (previously audited, same shape)
  `apps/web/src/components/StatCounter.tsx` — both call `setState` inside a `tick` rAF callback,
  technically the same "React state as per-frame transport" pattern MicLevelMeter has. The
  difference is severity: both are **bounded, one-shot count-up animations** (380ms / ~900ms),
  triggered rarely (a value changing while mounted, or scrolling a stat into view once), not a
  standing loop that runs for an entire lesson's duration. **MEASURE FIRST** — technically
  imperfect against the letter of the plan's constraint, but the real-world cost is small and
  rare enough that fixing MicLevelMeter first and re-profiling before touching these is the
  better order of operations; if profiling shows no measurable cost, leave as-is rather than
  rewriting working, already-carefully-commented code for no measured benefit.

---

## Summary table

| # | Finding | Classification | Task |
|---|---|---|---|
| 1 | `.heroGlow` perpetual blur (×5 pages) | REMOVE (the loop) | 5, 7 |
| 2 | Card shadow hover transitions | OPTIMISE | 5 |
| 3 | Product Story progress `width` | OPTIMISE | 5 |
| 4 | Product Story scroll→state every tick | OPTIMISE | 7 |
| 5 | Safeguarding scroll→state every tick | OPTIMISE | 7 |
| 6 | `ScrollReveal` per-instance observers | OPTIMISE | 6 |
| 7 | Marquee (offscreen suspension only) | KEEP | — |
| 8 | Skeleton shimmer `background-position` | REMOVE (the technique) | 5 |
| 9 | `MicLevelMeter` (apps/web) | REMOVE (React from loop) | 4 |
| 10 | `MicLevelMeter` (apps/classroom) | REMOVE (React from loop) | 4 |
| 11 | `filter`/`backdrop-filter` inventory | mostly KEEP | 5 (spot-check only) |
| 12 | `transition: all` / global `will-change` | clean, nothing found | — |
| 13 | Raw scroll/resize/pointer listeners | clean, nothing found | — |
| 14 | `AnimatedNumber`/`StatCounter` rAF+setState | MEASURE FIRST | — |
