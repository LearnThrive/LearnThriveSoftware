# Plan 15 — Wave 0: rendered full-tier audit

Plan15 section 3. The first time this site has been looked at **rendered, in the full motion tier,
from a production build** (docs/PLAN12_BASELINE.md and PLAN12_VISUAL_QA.md had no browser; plan 13's
audit looked at pages in the reduced tier the owner's machine was forcing). Everything below is
something a browser did, not something inferred from source — except where a line says otherwise.

Screenshots, frame sequences and raw JSON live in `artifacts/plan15/` (gitignored by the
repo-wide `artifacts/` rule, so they stay on this machine; the numbers that matter are copied
into this file). Before/after proof for Wave 1 is at the bottom.

## 1. Setup, and why it is valid

| | |
| --- | --- |
| Build | `next build` (production), served by `next start -p 3200`. Dev mode is not used for any public-route number. The authenticated shell needs `NODE_ENV=development` (the dev auth provider refuses production by design, K18), so it was captured against `npm run dev` on 3100 and is flagged as dev. |
| Browser | Playwright Chromium (headed-equivalent, GPU-backed: ANGLE/D3D11, AMD Radeon), 16 logical cores. The machine's display reports 165 Hz (WMI), but headless Chromium cannot confirm the refresh rate it actually renders at. |
| Reduced condition | `reducedMotion: "reduce"` → `matchMedia("(prefers-reduced-motion: reduce)").matches === true`, tier `reduced` (the look the owner has been judging, K4). |
| Full condition | `reducedMotion: "no-preference"` → `matches === false`. Tier read from `<html data-motion-tier>` on every load. |
| Tier by width (full condition) | 1920 / 1440 / 1280 / 1101 / 1024 → **`full`**; 834 → `standard`; 390 / 360 → `light`. So 1024-1920 really exercises the full tier (≥1024, fine pointer + hover, 16 cores, memory ≥ 4); the 834 and phone widths exercise `standard` and `light`, which is what those devices would get. |
| Coverage | 18 routes × 8 viewports (1920×1080, 1440×900, 1280×800, 1101×800, 1024×768, 834×1112, 390×844, 360×740) × 2 conditions = **288 page loads**, each scrolled top to bottom in wheel ticks. Viewport-by-viewport frames saved at 1440×900 and 390×844 (reduced and full). Authenticated shell: 4 dev roles × 2 viewports × 2 conditions = **148 loads** across 6-12 routes per role. |

Not done in this pass, said plainly so nothing below is read as covering it: GIF recordings (frame
sequences stand in for the hero load), a hands-on feel test with a mouse wheel / precision
touchpad / Safari / 120-144 Hz display (a human has to do that — listed in
`PLAN15_OWNER_INPUTS.md`), a throttled mid-range-Android profile (profile runs use 1× CPU; the
4× throttled run is part of each wave's gate), and a hover-everything / open-every-menu manual pass
(the existing Playwright specs cover keyboard, menus, accordions, tabs, the enquiry form's error and
success states and axe; they are re-run at every wave gate rather than re-done by eye here).

## 2. Automated sweep results (all 288 public loads)

| Check | Result |
| --- | --- |
| Console **errors** / uncaught page errors | **0** across all 288 loads |
| Failed or 4xx/5xx responses | **0** |
| Horizontal overflow (scrollWidth > clientWidth), every route, every viewport incl. 360 | **0** |
| Hydration mismatches | none observed |
| Console **warnings** | 20 loads: 16× Chrome's "resource was preloaded using link preload but not used within a few seconds" for `chunks/…css` (finding F7); 4× WebGL driver "GPU stall due to ReadPixels", which only appears when a screenshot reads the canvas back — a capture artefact, not a page behaviour |
| Stretched images (object-fit fill/none at a different aspect ratio) | none sitewide. The only images that failed any geometry check were the cover-cropped ones listed in F4 and the founders (F1) |

| Route | Loads | Console errors | Overflow | Page height @1440 (px) |
| --- | --- | --- | --- | --- |
| `/` | 16 | 0 | 0 | 12132 |
| `/subjects` | 16 | 0 | 0 | 3643 |
| `/maths-tuition` | 16 | 0 | 0 | 4123 |
| `/english-tuition` | 16 | 0 | 0 | 4241 |
| `/science-tuition` | 16 | 0 | 0 | 4213 |
| `/11-plus-tuition` | 16 | 0 | 0 | 4128 |
| `/about` | 16 | 0 | 0 | 3098 |
| `/book` | 16 | 0 | 0 | 2528 |
| `/contact` | 16 | 0 | 0 | 2101 |
| `/faq` | 16 | 0 | 0 | 4078 |
| `/safeguarding` | 16 | 0 | 0 | 4685 |
| `/accessibility` | 16 | 0 | 0 | 2730 |
| `/privacy` | 16 | 0 | 0 | 5638 |
| `/terms` | 16 | 0 | 0 | 4108 |
| `/cookies` | 16 | 0 | 0 | 3604 |
| `/complaints` | 16 | 0 | 0 | 2638 |
| `/tuition-terms` | 16 | 0 | 0 | 2789 |
| `/login` | 16 | 0 | 0 | 900 |

The authenticated shell (dev server, all four roles, both motion conditions, 1440 and 390): 0 console
errors or warnings, 0 overflow, every route resolved to the URL requested (no stray redirects). It is
visually consistent and calm; the seeded data is thin, so lists are mostly empty states (plan13
finding #6 territory, owned by Wave 11).

## 3. About page — founder portraits (owner-reported): K14 CONFIRMED, worse than described

Measured before any change, production build, full tier (the reduced tier is identical). The sources
are 320×320 squares. `natural` is the browser's *density-corrected* `naturalWidth` for the srcset
variant it chose (the file on disk is 320×320; the browser picked the 96 px variant because it was
drawing a ~40 px image).

| Viewport | Tier | Founder | img box (w×h) | wrapper box | object-fit / position | aspect shown / source | crop X / Y | scale vs source |
|---|---|---|---|---|---|---|---|---|
| 1920 | full | Abdurrahman | 60×253 | 60×253 | cover / 50% 28% | 0.236 / 1 | **76%** / 0% | 0.63× |
| 1920 | full | Tahasin | 52×253 | 52×253 | cover / 50% 22% | 0.206 / 1 | **79%** / 0% | 0.55× |
| 1440 | full | Abdurrahman | 42×253 | 42×253 | cover / 50% 28% | 0.168 / 1 | **83%** / 0% | 0.45× |
| 1440 | full | Tahasin | 37×253 | 37×253 | cover / 50% 22% | 0.147 / 1 | **85%** / 0% | 0.39× |
| 1280 | full | Abdurrahman | 37×253 | 37×253 | cover / 50% 28% | 0.145 / 1 | **86%** / 0% | 0.39× |
| 1101 | full | Abdurrahman | 30×253 | 30×253 | cover / 50% 28% | 0.120 / 1 | **88%** / 0% | 0.32× |
| 1024 | full | Abdurrahman | 50×253 | 50×253 | cover / 50% 28% | 0.197 / 1 | **80%** / 0% | 0.53× |
| 834 | standard | Abdurrahman | 39×253 | 39×253 | cover / 50% 28% | 0.154 / 1 | **85%** / 0% | 0.41× |
| 390 | light | Abdurrahman | 304×253 | 304×253 | cover / 50% 28% | 1.20 / 1 | 0% / **17%** | 1.56× |
| 360 | light | Abdurrahman | 274×253 | 274×253 | cover / 50% 28% | 1.08 / 1 | 0% / 8% | 1.52× |

(Full 8-viewport × 2-founder table: `artifacts/plan15/baseline/about-before-table.md`; the 18-width
sweep from 320 to 2560 is in `about-portraits.json`. Tahasin's numbers track Abdurrahman's.)

Plan15 guessed "tall, narrow, soft, tightly cropped". The real defect is more severe: **at every width
from 561 px to 2560 px each portrait is a sliver 26–83 px wide and 253 px tall** — 67–90% of the photo
cropped away; the faces are barely visible at all. Cause confirmed exactly as K14 described: the
`ParallaxLayer` wrapper is the real flex item of `.founderCardInner`, so `flex: none` on the `<img>` did
nothing, and with only the image's percentage `max-width: 100%` to measure itself by, the wrapper's
min-content collapses and the bio column squeezes it flat. Below 560 px the card stacks, the 4:3
frame fits, and the portrait is merely cropped 8-25% and upscaled ~1.5× (also soft).

## 4. Hypotheses H1-H10 — verdicts

| # | Verdict | Evidence |
| --- | --- | --- |
| **H1** hero atmosphere "pop" | **CONFIRMED** | Frame sequence at 120 ms intervals (`artifacts/plan15/baseline/hero-seq/`): at ~370 ms the hero's left half is flat navy (static `.heroGlow` + dots); by ~930 ms it is a teal gradient wash. There is no fade — the lazy WebGL canvas replaces the static glow outright. Visible, and it is the first thing a visitor sees. → Wave 1 §5.2 |
| **H2** tier jump on hydration | **Not reproduced as a visible hitch** | The only tier-dependent first-viewport change is the WebGL mount (that *is* H1). ParallaxLayer `from` offsets are 0, so scale 0.7 → 1.0 moves nothing at scroll 0; PointerDepth is inert until the pointer moves. A reload at a mid-page scroll position would shift layers by ≤ 0.3 × (≤ 14-34 px); not measured as a hitch. The WebGL part is handled in Wave 1 §5.3 together with H1. |
| **H3** reveals flash / dead on client nav | **Not reproduced** | Client navigation `/` → `/subjects`, sampled every 80 ms: 0 of the 2 in-view reveal elements were hidden at any sample. "Same fade-up everywhere" is a design observation (see bar scores), not a defect. |
| **H4** transform left on a Reveal wrapper breaks `position: sticky` | **Not reproduced** | Walked every `position: sticky` element's ancestors on `/`, `/about`, `/subjects`, `/safeguarding`, `/book`, `/faq`, `/maths-tuition` after scrolling the whole page: no ancestor has a non-`none` transform or a `will-change: transform`. |
| **H5** `scroll-behavior: smooth` vs scenes/anchors | **Partly confirmed (polish)** | Anchors land correctly: `#how` and `#enquire` end with the target 84 px from the top, under the 69 px header. But the hero's "Send an enquiry" (`#enquire`) is a ~9,000 px native smooth scroll that was still moving at 1.4 s, running through every reveal on the way; and focus does not move to the target (`document.activeElement` stays `BODY`). Relevant to Wave 4 (Lenis anchors must move focus). |
| **H6** marquee | **Not a defect** | Verified earlier this session (36 px/s, loops with no gap at 1920, pauses on hover/focus and when offscreen, static under reduced motion). |
| **H7** ProductStoryScene pacing | **Confirmed (medium)** | The sticky mock panel is mostly empty navy with two grey boxes labelled "Video" and "Whiteboard" in the middle of the lesson stage; it reads as a wireframe, and the step copy beside it scrolls past a mostly static panel. Pacing is fine; fidelity is not. → Wave 6 |
| **H8** mobile "light" tier alive or broken? | **Fine, not broken** | 390×844 frames: hero, stats, three differentiators, how-it-works, subjects all render and read well; light tier is visually almost identical to reduced (tiny parallax). "Alive" is the wrong bar here; it is clean and stable. |
| **H9** app interactions | **Partly checked** | Dashboards, calendar, lists captured for all 4 roles with real animations running (dev): no console output, no overflow, nothing mid-transition left broken. Dialogs/dropdowns/toasts are exercised by the existing `app-motion`, `navigation`, `lessons` specs; FullCalendar is visually fine in the light theme. |
| **H10** contrast over moving layers at the worst frame | **CONFIRMED for the hero chip** | Hero text hidden, pointer moved to 7 positions, gradient re-rendered, background sampled in each text box: chip (mint 11 px mono) worst case **2.7:1** against the brightest teal pixel in its box (its faint navy backing helps but was not enough to prove ≥ 4.5); h1 white 4.74:1 (large text, passes 3:1); lead 5.03:1; assurances 5.9:1; secondary button 9.5:1. → Wave 1 §5.5 |

## 5. Findings

Severity: blocker / high / medium / polish. "Tier" is where it shows.

| ID | Route · viewport · tier | What was seen | Sev | Suspected cause | Fix | Status |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | `/about` · 561-2560 · all | Founder portraits are 26-83 × 253 px slivers; 67-90% of each photo cropped | **blocker** | Flex item is the parallax wrapper; `flex:none` on the img does nothing; 3:4 frame forced on 1:1 sources | Square frame on the wrapper, `fill` image, container-query layout, geometry tests | **Fixed — `5473ee7`** |
| F2 | `/` · ≥1024 · full | Hero left half jumps from flat navy to a teal gradient at ~0.5-0.9 s with no fade (H1) | high | WebGL branch replaces the static glow | Keep glow mounted, fade canvas in after first frame | **Fixed** (`04b8ed5`): the WebGL layer crossfades in over the static glow |
| F3 | `/` · ≥1024 · full | Hero chip text 2.7:1 over the gradient's brightest pixel (H10) | high (a11y) | Mint text on a translucent backing over a moving teal wash | Stronger navy chip backing; re-measure at worst frame | **Fixed** (`04b8ed5`): navy backing, chip text measured >= 7:1 at the worst pointer position |
| F4 | `/`, `/subjects` · all · all | Subject cards crop 52-87% of their photos (668×132 strips from 3:2 and 2:3 sources; 11+ is a portrait photo shown as a strip). Hero photo crops 41% horizontally. | medium | Fixed-height card banners using `object-fit: cover` on originals of other ratios | Re-crop deliberately in the image pipeline | **Fixed** (`04b8ed5`): subject cards use each photo's own aspect and focal point; originals optimised |
| F5 | `/maths-tuition` · ≥1024 · full | The coordinate curve runs behind the hero lead paragraph | polish | Subject-world background not kept out of the text column | Route it around the copy in the worlds rebuild | **Fixed** (`1777c4a`): the maths hero curve fades out over the text column |
| F6 | `/` · all | ProductStoryScene mock UI is a near-empty panel with two grey placeholder boxes (H7) | medium | Mock built from minimal primitives | Higher-fidelity lesson/report mock from real product components | **Fixed** (`04b8ed5`): the product-story mock is now six small, honest drawings of real features |
| F7 | 16 of 20 loads · prod | Console warning: a `chunks/…css` file preloaded but not used (it contains the shared public layout CSS incl. `MotionDebugOverlay`'s) | polish | Preload hint for a stylesheet that is already applied/used differently | Investigate in perf pass; budget says no new warnings | **Fixed** (`1777c4a`): the debug overlay and its stylesheet are out of production builds |
| F8 | all | Heading font loads as three static weights (600/700/800); no `opsz`/`wdth` axes | medium | `next/font` called with `weight: [...]` | Variable axes if payload allows | **Measured, not shipped**: adding the `opsz` axis makes the preloaded heading font 76.9 KB instead of 41.2 KB (+35.6 KB on the critical path) for a subtle optical-size gain |
| F9 | all | Raster logos (292 KB / 134 KB), `favicon.svg` only (no .ico / apple-touch / PNG icons); single static OG image | medium | Never vectorised | Vector brand system | **Fixed** (`04b8ed5`): vector mark and wordmark, full icon set, per-page OG cards |
| F10 | `/` · all | Hero "Send an enquiry" triggers a ~9,000 px smooth scroll > 1.4 s; focus is not moved to the target (H5) | polish | Native `scroll-behavior: smooth` | Lenis scrollTo + focus move | **Fixed** (`04b8ed5`): anchors glide with Lenis, update the hash and move focus |
| F11 | app · dev only | Next.js dev indicator overlaps the sidebar "Collapse" label | polish (dev only) | Next dev overlay; absent in production | none | n/a |
| F12 | `/` · 1440 | Lower-left of the hero (below the assurances) is ~300 px of empty navy; copy and photo are not balanced vertically | polish | Copy column shorter than the photo | Hero composition in Wave 5 | **Fixed** (`1777c4a`): the hero copy is centred against the photo |

`MotionDebugOverlay` is mounted in the public layout in production but renders nothing unless
`?motionDebug=1` **and** a build-time opt-in are both present, so it is not reachable on a default
production build; its CSS still ships (part of F7's chunk). Reviewed again in Wave 12.

## 6. What looks better in motion than static (the layer worth investing in)

- **The hero gradient**, once it is there: the teal wash adds depth the flat navy lacks. The *arrival* of
  it is the defect (F2), not the effect.
- **Subject worlds**: `/maths-tuition` in the full tier gets a drawn coordinate curve over a grid that the
  static version lacks entirely; the subject pages otherwise look the same in both conditions, which
  means the worlds currently add little (and F5 notes the curve crossing the copy).
- **Hero load**: the staggered rise of chip → headline → lead → buttons → assurances → floating chips
  over ~1 s reads as assembled, not faded, and does not delay the LCP element.

Nothing observed looks *worse* in motion than static, apart from F2/F3/F5.

## 7. Bar scores (Section 4) — 1-5

Judgement from rendered screenshots (1440 and 390, reduced and full) and the measurements above; not
a metric. These drive wave priority.

| Criterion | Home | Subjects + subject pages | About | Trust / legal / FAQ | Book + contact | Authenticated app |
| --- | --- | --- | --- | --- | --- | --- |
| 1 Typographic confidence | 4 | 3 | 3 | 3 | 3 | 3 |
| 2 Depth with restraint | 3 | 3 | 2 | 2 | 3 | 3 |
| 3 Motion with narrative | 3 | 3 | 2 | 3 | 2 | 2 |
| 4 Perceived performance | 4 | 4 | 4 | 4 | 4 | 3 (dev) |
| 5 One system | 2 | 2 | 2 | 2 | 2 | 3 |
| 6 State completeness | 3 | 3 | 3 | 3 | 3 | 4 |
| 7 Imagery craft | 2 | 2 | **1** (F1) | n/a | n/a | n/a |
| 8 Responsive parity | 4 | 4 | 4 | 4 | 4 | 4 |
| 9 Accessibility as visible quality | 3 (F3) | 3 | 3 | 4 | 3 | 4 |
| 10 Zero rough edges | 4 | 4 | **1** (F1) | 4 | 4 | 4 |
| 11 Institutional credibility | 3 | 3 | 2 | 3 | 3 | 3 |

Lowest-scoring, in priority order: **imagery craft** (F1 and F4), **one system** (two focus
languages, hard-coded colours, no semantic tokens, no dark theme — K6/K7), **depth** and **motion with
narrative** on the content-led pages, **institutional credibility** (raster logos, single OG image,
no trust hub).

## 8. Performance baseline for this plan

(`scripts/profile-motion.mjs`, production build on :3200, 3 runs per row, medians. Filled in below.)

`node scripts/profile-motion.mjs --label p15q-<route> --routes <route> --viewports desktop,mobile --runs 3
--base-url http://localhost:3200` against the production build of the tree as it stood at the start of
the audit (before the founder fix). Quiet machine (no other work while it ran), median of 3, Chromium
with GPU (ANGLE/D3D11).

| Route | Viewport | LCP ms | CLS | JS KB (gz) | Scroll-down dropped % | Scroll-up dropped % | Long tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | desktop-1440x900 | 328 | 0 | 227 | 2.9 | 0.8 | 0 |
| `/` | mobile-390x844 | 168 | 0 | 225 | 2.6 | 1.9 | 0 |
| `/subjects` | desktop-1440x900 | 200 | 0 | 230 | 9.3 | 5.0 | 0 |
| `/subjects` | mobile-390x844 | 172 | 0 | 225 | 3.3 | 2.2 | 0 |

Reading it: **this machine is not the plan12 machine.** docs/PLAN12_BASELINE.md recorded `/` at LCP 260
ms and 216 KB gz JS; the same tree today measures 328 ms and 227 KB (the JS grew with the plan 12-13
work that landed after that baseline). Plan15's budgets say "baseline + 60 ms desktop / + 40 ms mobile",
so the reference for this plan is the table above (today, this machine), not the plan12 figures. Also
`/subjects` desktop already drops 9.3% of frames on scroll-down here, above the plan's 6% target, before
any plan 15 work: that is the number later waves are measured against, not a regression to attribute to
them. (The profiler's scroll-gesture driver stalled on `/about` and `/maths-tuition` in this session,
the failure PLAN12_BASELINE.md already documents for long sequences; those two rows are measured at the
end of the plan from single-route runs instead.)

## 9. Wave 1 proof — founder portraits

Before: section 3. After (same script, same viewports, dev server on :3100; production numbers match):

| Viewport | Tier | Frame | Aspect shown / source | Crop X / Y | Scale vs source |
| --- | --- | --- | --- | --- | --- |
| 1920 · 1440 · 1280 · 1101 · 1024 | full | 200×200 | 1 / 1 | 0% / 0% | 0.99× |
| 834 | standard | 200×200 | 1 / 1 | 0% / 0% | 0.99× |
| 390 · 360 · 320 | light | 200×200 (192 pre-reveal) | 1 / 1 | 0% / 0% | 0.95-0.99× |

All 18 widths between 320 and 2560 measured: aspect 1.00, crop 0%, frame ≥ 190 px, no horizontal
overflow. Screenshots: `artifacts/plan15/after-wave-1/about-founders-{1440,1101,834,390}.png`.
New tests in `apps/web/tests-e2e/images.spec.ts` (8 viewports + frame-is-sized-element + a sitewide
stretched-image guard over all 17 public routes); the founder tests fail against the previous markup
(verified by stashing the fix) and pass against the new.

Remaining about the portraits: the files are 320×320. On a 2× screen a 200 px frame needs 400 px, so
they are ~1.25× upscaled in device pixels — acceptable and not larger, but not premium. The 1200×1200
originals the owner needs to supply are listed in `docs/PLAN15_OWNER_INPUTS.md`.

## 8. After: the final measurements

Same harness, same machine, production build served by `next start`, 3 runs per row (medians), measured on the
final code (commit `8547324`). Baseline is the quiet re-run taken at the start (commit `5473ee7`).

| Route | Viewport | LCP ms | CLS | JS KB gz | Scroll-down dropped frames | Long tasks / blocking ms |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | desktop 1440x900 | 328 → **200** | 0 → 0 | 227.1 → 291.9 (+64.8) | 2.9 % → 5.7 % | 1 / 163 → 1 / 61 |
| `/` | mobile 390x844 | 168 → **188** (5-run median; one 3-run set had a 332 outlier) | 0 → 0 | 225.3 → 277.1 (+51.8) | 2.6 % → ~7 % (5 runs: 4.6 to 9.4) | 1 / 48 → 1 / 181 (one run) |
| `/subjects` | desktop | 200 → 228 | 0 → 0 | 230 → 290 (+60) | 9.3 % → 11.7 % | 0 → 0 |
| `/subjects` | mobile | 172 → **148** | 0 → 0 | 225.3 → 277.1 (+51.8) | 3.3 % → 8.9 % | 0 → 0 |

How these read against the budgets (plan 15 section 2):

- **LCP** holds on every row (desktop budget +60 ms, mobile +40 ms; the home page is 128 ms *faster* on desktop). **CLS is 0** everywhere.
- **JavaScript** is at or just over the +60 KB gz line on desktop (+64.8 KB home, +60 KB subjects) and under it on mobile. The figure counts everything the page transferred in the window, including route chunks that Next prefetches for visible links (the subject pages' stages are part of that), and Lenis, the theme and motion preference, the flyout and the mobile bar. A first version also loaded the ~25 KB command palette at idle on every page; it is now fetched on intent, which is what brought it from +78 KB to +65 KB. **Exception recorded: +4.8 KB over budget on the home page on desktop.**
- **Dropped frames while scrolling** are the budget that does not hold. Desktop home is 5.7 % (budget 6 %), but mobile home (~7 %) and the subjects page (8.9 % mobile) are over 4 %, against a baseline that was already 9.3 % for desktop `/subjects`. Switching smooth scrolling off, hiding the WebGL canvas, un-pinning the hero, disabling scroll-driven CSS animation and freezing the marquee's scroll-speed coupling each moved the number by about one point or less, inside run-to-run noise (single runs of the same build range from 4.6 to 9.4 %); no single effect accounts for it. Style recalculation during the scroll is up about 30 % and the DOM is 27 % larger (945 nodes against 740: the footer sitemap, flyout, brand SVG and so on). **Exception recorded**, with the cheapest next step: `content-visibility: auto` on the long below-the-fold sections, which was not attempted because it interacts with find-in-page, anchors and the scroll-linked scenes and needs its own test pass.
- The measurement is a programmatic scroll of a ~12,000 px page at 166 Hz on a desktop GPU with an emulated phone viewport; it is a comparison tool, not a phone.
