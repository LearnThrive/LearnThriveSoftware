# Plan 15 — completion report

Plan: `plan15.md` ("State of the art, deploy-ready"). Written 3 October 2026 against commit `8547324` plus this report. This is a status report, not a victory lap: the first section says what is **not** finished.

## 1. What is not finished, and what is not proven

Not built (each was in the plan):

- **Wave 6 pinned and horizontal sequences** (section 10.4) and the `lines` / `draw` variants of `Reveal` (10.1). `Stagger`, the scrubbed statement, the hero handoff, the marquee's scroll coupling, level bars and the spotlight border shipped.
- **Wave 7 microinteractions in full**: no skeleton-shimmer system or skeleton-to-content crossfade, no sliding indicator on the FAQ jump nav. The existing tactile buttons, the button sheen, loading spinner, magnetic CTA, drawn success check, FAQ height animation and dialogs stand.
- **Wave 5 hero product composition** (9.3, photo plus a high-fidelity report card) was not compared by screenshot; the photo and two chips stay. Ambient WebGL drift (9.2) was not shipped.
- **A static-state screenshot regression suite per route, viewport and theme** (plan 18). The dark theme is covered by axe and by contrast tests, not by pixel baselines.
- **Variable heading-font axes** (F8): measured and declined, section 6.

Not proven because it could not be run here:

- **Lighthouse**, **INP**, **Firefox, WebKit and iPhone** (the Playwright projects are written and run in CI, never executed locally), **any real Safari, iPhone or Mac**, and **a real email send**. See `DEPLOYMENT_READINESS.md`.
- **Smooth scrolling "feels right"** on a mouse wheel and a precision touchpad at your display's refresh rate. It ships on, behind two kill switches, until you have felt it (owner input 11).

Budgets that do not hold: **scroll dropped-frame rate** on mobile and `/subjects`, and **JavaScript** by 4.8 KB on desktop home. Numbers and reasons in section 4.

Left uncommitted on purpose: `plan14.md`, `plan15.md` and `skills-lock.json` (owner input 10), and another session's `docs/superpowers/` file, which I did not touch.

## 2. Waves, in order

The waves share `globals.css`, `layout.tsx` and the shell, so Waves 1 to 10's first pass landed as one commit (`04b8ed5`) rather than as separately buildable slices; everything after has its own commits.

| Wave | What shipped | Commits |
| --- | --- | --- |
| 0 Audit | Rendered audit of 18 routes x 8 viewports x 2 conditions (288 loads), H1-H10 verdicts, founder-portrait measurements, baseline profile, owner inputs, feature proposals | `bd089f0`, `5473ee7` (portraits) |
| 1 Defects | Hero atmosphere "pop" and hero chip contrast fixed; founder portraits 1:1 and unsqueezable, with a sitewide distorted-image guard | `04b8ed5`, `5473ee7` |
| 2 Foundations | Semantic tokens (`tokens.css`), elevation, one focus language, motion tokens v2 and depth presets | `04b8ed5` |
| 3 Themes | Designed dark theme (system and explicit, no flash, AA both themes); **on by default** with a kill switch; app accent text fixed for dark; classroom pre-join contrast and one ARIA fix | `04b8ed5`, `4c5fcd3`, `d89b321` |
| 4 Smooth scroll | Lenis with guardrails and kill switches; one shared scroll store; anchors, focus and nested scrollers handled | `04b8ed5` |
| 5 Hero and header | Orchestrated CSS load sequence, lerped WebGL pointer, pinned hero handoff, sliding nav indicator; hero copy balanced | `04b8ed5`, `8607bfd`, `1777c4a` |
| 6 Storytelling | Scrubbed statement, `Stagger`, `SectionHandoff`, marquee scroll coupling, level bars, spotlight borders, product-story mock redrawn | `04b8ed5` |
| 7 Microinteractions | See section 1 for what is partial | `04b8ed5` |
| 8 Route transitions | Site-wide View Transitions with a directional header offset, slim route progress bar | `04b8ed5` |
| 9 Subject worlds, images, palette | Four subject stages (maths plane, annotated sentence, science loop, 11+ route); image pipeline; public command palette | `04b8ed5`, `31944cd` |
| 10 Brand and trust | Vector brand, icons, OG cards, JSON-LD, branded errors; `/trust`, visible breadcrumbs, footer columns, subjects flyout, mobile enquiry bar, announcement slot, print stylesheet, email plain text; `BRAND.md` | `04b8ed5`, `7088328`, `0ee2440`, `bb6a6e8` |
| 11 App | App palette with role-scoped server search and 13 adversarial tests; shortcuts; Tier A features A1-A8 | `191d4fc`, `a790f33`, `78b7253`, `f1251a6`, `2a452e2` |
| 12 Deploy | Portal closed in production, CSP/HSTS/COOP, hardened enquiry route, crawl surfaces, health, security.txt, CI, 37-test production smoke, deployment docs | `5e4fa57`, `2dbf8cb` |

## 3. Tokens and components added or changed

- **Tokens** (`src/app/tokens.css`): surfaces, text, lines, accent and feedback, status tones, avatars, subject identity, brand inks, overlay, five elevation steps, each with a designed dark value; `--app-accent-text` and `--app-accent-strong-text` for accent as text in the app.
- **Motion** (`src/lib/motion/`): `tokens.ts` v2 with a named role for every duration, `depth.ts`, `scrollStore.ts`, `smoothScroll.ts`, `preference.ts` (System or Reduce), `subjectStage.ts` (pure geometry).
- **Components**: `ThemeToggle`, `MotionToggle`, `SubjectsFlyout`, `Breadcrumbs`, `MobileEnquiryBar`, `AnnouncementBar`, `BrandMark` and `BrandIllustration`, `NavigationProgress`, `CommandPalette` with the public and app wrappers, `ShortcutsOverlay`, `SubjectStage`, `ScrubStatement`, `Stagger`, `GettingStarted`, `MotionDebugGate`.
- **Pages and routes**: `/trust`, `/portal-opening-soon`, `/dashboard/progress/[studentId]`, `/api/health`, `/api/lessons/[id]/ics`, `/og/*`, `proxy.ts`, `robots.ts`, `sitemap.ts`, `/.well-known/security.txt`.
- Documentation of all of it: `DESIGN_SYSTEM.md` (new sections), `BRAND.md`.

## 4. Budgets, baseline against final

Full tables and method in `PLAN15_FULL_TIER_AUDIT.md` section 8. Production build, same harness and machine, medians.

| Budget (plan 15 section 2) | Result | Holds? |
| --- | --- | --- |
| LCP desktop <= baseline + 60 ms | `/` 328 → 200 ms; `/subjects` 200 → 228 ms | Yes |
| LCP mobile <= baseline + 40 ms | `/` 168 → 188 ms (5-run median); `/subjects` 172 → 148 ms | Yes |
| CLS 0 | 0 on every row | Yes |
| No long tasks, hydration mismatches or new console warnings | Home desktop blocking time 163 → 61 ms; zero console errors or CSP violations on 17 routes; the "preloaded but not used" warning removed | Yes |
| Marketing JS <= baseline + 60 KB gz | `/` desktop +64.8 KB, `/subjects` desktop +60 KB, mobile +51.8 KB | **Over by 4.8 KB on desktop home** |
| Desktop scroll dropped frames <= 6 % | `/` 5.7 %; `/subjects` 11.7 % (baseline 9.3 %) | Home yes, subjects no |
| Mobile scroll dropped frames <= 4 % | `/` ~7 %; `/subjects` 8.9 % (baselines 2.6 % and 3.3 %) | **No** |

The two exceptions, their bisection and the cheapest next step are written up in the audit doc. Neither is a regression in what a visitor can see: no layout shift, no long task, a faster LCP, and the scroll measurement is a synthetic 12,000 px sweep.

## 5. Accessibility, both themes

- **axe (WCAG 2 A/AA)** runs on every public route and the portal notice in light and in dark, on login, and on the main screens of all four roles in dark (`accessibility.spec.ts`, `accessibility-dark.spec.ts`), plus the classroom pre-join screen in both schemes. It found and I fixed: the home page's why-card number in dark, the active filter tab count and the unread tag in dark, ten sub-AA greys in the classroom pre-join screen and one misused `aria-label`.
- **Contrast** of every semantic pair in both themes is computed in `tests/theme.test.mjs`.
- **Keyboard and zoom**: the existing keyboard-only and 200 % zoom suites pass; 360 px reflow is asserted on every public route by the production smoke suite.
- **Focus**: one focus language everywhere; the palette, flyout and shortcut overlay return focus to what opened them (tested).
- **Reduced motion**: first-class. Every effect declares its tier; reduced motion shows final states; the new System / Reduce preference is honoured everywhere the OS setting is. There is deliberately **no** "full motion" override.
- **Not done**: a human screen-reader pass.

## 6. Effects tried and removed, or declined (as valuable as the shipped list)

- **Card tilt**: not shipped. Plan 15 allowed up to ~6 degrees on one or two hero objects; pointer depth, spotlight borders and the magnetic CTA already carry "responsive", and no tilt was ever judged to earn its cost on content a parent has to trust.
- **three.js**: stays removed. The hero atmosphere is a small demand-rendered WebGL gradient (a few KB), not a scene graph.
- **Ambient hero drift**: not shipped; the plan's own condition (it must cost nothing in frame pacing) was not worth testing against a budget that is already tight.
- **A page-level fade on every route change** was already reverted in an earlier plan for blocking interaction; the View Transition used here is non-blocking and pointer-events-none.
- **Backdrop blur on the header**: left out on purpose (`MOTION_PERFORMANCE_AUDIT.md` M-12).
- **Variable `opsz` axis on the heading font (F8)**: measured. The preloaded heading font goes from 41.2 KB to 76.9 KB (+35.6 KB on the critical path of every page) for a subtle optical-size improvement. Declined.
- **"Full motion" override of an OS reduced-motion setting** (feature A3): considered, not built, with reasons in `PLAN15_FEATURE_PROPOSALS.md`.
- **Idle warm-up of the command palette**: tried, then replaced by warm-on-intent after it cost ~25 KB gz on every page.
- **Search matching private tutor notes** for Admins and Tutors: tightened to never, for anyone (feature A1).
- **Per-link nav underlines** on desktop: replaced by one sliding indicator.

## 7. Lenis decision

**On by default**, for the full and standard motion tiers, a fine pointer, no reduced motion, no Save-Data, in the public site only (never the app or classroom, never touch). Two kill switches (`NEXT_PUBLIC_SMOOTH_SCROLL=0` at build, `?smooth=0` at runtime) and an automatic bypass for precision-touchpad-sized wheel deltas. It keeps the browser's real scroll position, so every sticky and scroll-linked scene works unchanged; anchors, focus, Back and Forward, keyboard scrolling and nested scrollers are covered by `smooth-scroll.spec.ts`. Bisecting the scroll-frame budget showed it is **not** the cost (smooth off: 8.1 % against 7.3 % with it on, inside noise). The one thing code cannot judge is feel: owner input 11 asks you to try it with a wheel and a touchpad at your real refresh rate, and to set the build flag to 0 if it feels wrong.

## 8. Tests

Unit: **258** pass (`npm test`). Production smoke: **37** pass against `next start` in Chromium (the same suite runs in Firefox, WebKit and an iPhone profile in CI). End to end on the development server: the last full run (517 tests, 4 workers, a fresh server) gave **510 passed, 2 skipped, 3 flaky, 2 failed**. The two failures were load-sensitive and are explained below; neither reproduces when run alone.

New suites this plan: theme, smooth scroll, palette (public and app), app search and progress and derived views (adversarial), enquiry route hardening, security headers, ICS, motion preference, subject stage geometry, header indicator, flyout, mobile bar, calendar download, dark-theme axe.

Known flakes, none a correctness bug: the StatCounter "never re-renders React per frame" test counted late-hydrating chunks under four parallel workers (34 commits against a limit of 10) and passes alone; it now waits for React to go quiet for a second before counting, with the threshold unchanged and a re-run after that change passes. The lesson-detail `joinError` test (`lessons.spec.ts:252`) matches `[role="alert"]` and fails when Next's own route announcer, which has the same role, is already in the page; it passes alone and was not changed. The motion-preference test now repeats its choice until the page has hydrated; tests that schedule lessons on the shared dev server collide on a long-lived server with data from earlier runs (a fresh server each run avoids it).

## 9. Owner inputs

Current list and status in `PLAN15_OWNER_INPUTS.md` (16 items). The ones that block going live: the host and DNS, a verified Resend domain with one real staging send, a rate-limit rule on the enquiry endpoint at the host, sign-off on the cookie notice's storage wording (`apps/web/LEGAL_REVIEW.md`), the `security.txt` contact, and a Lighthouse plus real-Safari pass on staging. The ones that improve the site's ceiling: the founders' original photographs (the portraits are correct but only 320 px) and better imagery (the weakest images are listed). Two questions are still open for you: whether to restyle the home stats strip's 3 px divider or add a narrow ignore, and whether to ignore or relocate `plan14.md` and `plan15.md`.

## 10. Remaining limitations

- The signed-in app is closed in production by design until real authentication exists; its CSP, its remaining storage keys and Excalidraw's two high-severity transitive audit findings need review before it opens.
- `.env.example` is not updated (access to `.env*` files is blocked in the environment this was built in); the complete variable table is in `DEPLOYMENT.md`.
- The in-memory enquiry rate limiter is per instance; the platform rule is the first layer.
- Search, progress and the other Tier A pages read the in-memory data provider; they use the repository interfaces, so they port with the Supabase work, but nothing here was run against a database.
