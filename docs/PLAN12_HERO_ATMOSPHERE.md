# Hero WebGL atmosphere — the measured decision

Plan 12, task 4. Records what was built, profiled and removed, so the decision doesn't need
re-deriving later. The plan's own preferred order: CSS/SVG atmosphere, then a raw-WebGL interactive
gradient, then a Three.js scene "only if the first two cannot reach the target" — retained only if
frame pacing, LCP and JS cost stay acceptable.

## What was built

1. **Static fallback** — already existed (`.heroGlow`, `.heroDots`), unchanged. Every tier below
   `full`, and any tier without WebGL support, gets this.
2. **Raw WebGL interactive gradient** (`src/components/motion/webgl/heroGradient.ts`) — a navy/
   green/mint gradient blended by pointer position, demand-rendered (no continuous
   `requestAnimationFrame` loop; a frame draws only on pointer move, resize, or mount). One shader
   program, one buffer, created once. `full` tier only, dynamically imported (`next/dynamic`,
   `ssr: false`), DPR capped at 1.5.
3. **Three.js sparse learning network** (built, profiled, removed — see below) — 42 points and 46
   connecting lines in a seeded (deterministic) layout, representing the plan's
   student/tutor/topic/understanding/progress idea, with a slow continuous drift, pointer lean and
   scroll-linked camera. Direct `three`, not React Three Fiber: this codebase has no reconciler-
   based motion anywhere else (`ParallaxLayer`/`PointerDepth` write `MotionValue`s directly;
   `MicLevelMeter` writes refs directly), and R3F's JSX scene graph would be exactly the kind of
   extra framework layer that architecture avoids. A raw `Scene`/`Renderer`/`Camera` triple, driven
   imperatively like the gradient's own handle, fits it; R3F would not.

## The measurement

Same route (`/`), same production build methodology as `docs/PLAN12_BASELINE.md`, 3 runs per row,
`--trace`. Compared against the task-3 baseline (hero present, no WebGL atmosphere at all) captured
in that file.

| | No atmosphere (baseline) | Gradient | Three.js network |
| --- | --- | --- | --- |
| LCP desktop | 260 ms | 272 ms | 284 ms |
| LCP mobile | 268 ms | 256 ms | 248 ms |
| JS KB (gz) desktop | 216 | 220 | **348** |
| JS KB (gz) mobile | 216 | 218 | 218 |
| Scroll-down dropped % desktop | 2.3 | 3.2 | 3.8 |
| Scroll-down dropped % mobile | 0.8 | 2.5 | 2.8 |
| CLS / long tasks | 0 / 0 | 0 / 0 | 0 / 0 |

Mobile numbers barely move between the gradient and Three.js columns because neither ever loads
there — `capabilities.ts` only sets `webgl: true` on the `full` tier, and a touch/narrow viewport is
never `full` regardless of hardware, so both enhancements are desktop-only by construction. That's
also why bundle inspection matters as much as the runtime numbers: a production build's
`.next/build-manifest.json` lists neither chunk against any route (confirmed directly, by content
search, not assumed) — both are genuinely deferred past first paint, not just conditionally
rendered.

## The decision: keep the gradient, remove Three.js

`three` (`npm uninstall three @types/three`) and both Three.js-specific files
(`heroLearningField.ts`, `HeroLearningFieldAtmosphere.tsx`) were removed after this comparison, not
before it — the plan's own "never mark a visual task complete based on code review alone... profile
it" applies to the removal decision as much as to shipping something.

Reasoning against the objective gate ("frame pacing, LCP, and JS cost remain acceptable"):

- **JS cost is the deciding number.** The Three.js path adds **132 KB gzipped** to the session's
  script transfer over the no-atmosphere baseline — a 61% increase — against the gradient's **4 KB**
  for the same "interactive LearnThrive atmosphere" role. That gap has to be paid for by every
  full-tier desktop visitor, and it scales with network conditions this local profiling run doesn't
  capture (a satellite or tethered "full tier" desktop pays this in full).
- LCP and frame pacing both move in the same direction — worse with Three.js than with the
  gradient, worse with the gradient than with nothing — a small but consistent cost ladder that
  tracks the amount of GPU/JS work each option does, exactly as expected.
- No console errors, no CLS, no long tasks in either version — both are *correct*; this is not a
  case of one being broken. It's a proportionality call: 33x the JS weight for a "sparse network"
  effect whose actual visual payoff over a simpler gradient can't be judged this session (no
  browser/screenshot tool — see `docs/PLAN12_BASELINE.md`), and the plan's own gate defaults to
  removal precisely for that situation ("if the visual gain is not worth the cost" — with no way to
  weigh the gain, the cost has to carry the decision on its own, and 132 KB for a decorative layer
  doesn't clear that bar).

The gradient stays: it already delivers the plan's "LearnThrive navy/green/mint interactive
gradient" requirement (never a generic purple AI gradient), at a cost close to free, with the same
tier-gating, activity-suspension and accessibility exclusion Three.js would have needed anyway.
