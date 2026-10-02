# Design system

Plan6 section 102. A practical reference for the authenticated product's design system — what
exists, where it lives, and the rule each part is there to enforce. Read the components
themselves (`apps/web/src/components/ui/`) for exact props — or browse them live in Storybook,
below.

The **marketing site** (`apps/web/src/app/(public)/**`) keeps its own expressive stylesheets
(`app/globals.css`, `home.module.css` and friends), but since plan 15 it shares this system's
*vocabulary*: both read the semantic tokens in `app/tokens.css` (surfaces, text, lines, accent,
elevation, focus, status tones), and both therefore have a dark theme. See "Plan 15 foundations"
below. The rest of this document is about the authenticated product behind `/dashboard`.

## Storybook

The reusable primitives below (`components/ui/`, `components/shell/`) each have stories at
`apps/web/.storybook/`, using `@storybook/nextjs-vite` — not the deprecated webpack-based
`@storybook/nextjs`. Run from `apps/web`:

```bash
npm run storybook          # dev server, http://localhost:6006
npm run build-storybook    # static build, output to storybook-static/ (gitignored)
```

Storybook is a *view* onto this same design system, not a second one: `.storybook/preview.tsx`
imports the product's real stylesheets in their real order (`globals.css`, `app-shell.css`,
`app-components.css`, `app-dashboard.css`, `app-auth.css`) and the same three `next/font/google`
fonts `app/layout.tsx` loads, and every story renders the actual exported component — no
Storybook-only reimplementation of a component's markup or styling. The one thing `.storybook/`
adds of its own is a small, clearly-scoped layout reset (`preview.css`'s `.sb-app-context`): it
resets `.app-shell`'s sidebar-grid `display`/`min-height` — meaningless around one isolated
component preview — while keeping every actual design-system rule that selector carries (the
`--app-*` focus ring, heading-colour inheritance). No colour, token, spacing or font value is
redefined anywhere in `.storybook/`.

Buttons (`.btn`/`.btn--primary`/`.btn--secondary`/`.btn--ghost`/`.btn--danger`) have their own
story (`UI/Buttons`) despite having no `<Button>` component to bind to — every button in the app
is a plain `<button className="btn btn--...">`, so the story documents that class vocabulary
directly rather than inventing a wrapper component Storybook-only.

## Stylesheets

Four files, loaded in this order from `app/layout.tsx`, each with one job (plan6 section 87: "one
giant UI component file" is exactly what this split avoids):

| File | Owns |
|---|---|
| `app/tokens.css` | The semantic token layer shared by marketing, app and (for focus/contrast) the classroom: surfaces, text, lines, accent, status tones, the 5-step elevation scale, the focus ring, navy texture, and the dark theme. Imported right after `globals.css`. |
| `app/globals.css` | Marketing site + a few classes the app still shares with it (`.btn`-adjacent legacy, alerts). Being wound down as pages migrate onto the app system below. |
| `app/app-shell.css` | Design tokens (`:root`), the AppShell itself — sidebar, topbar, account menu, mobile drawer, badges, buttons, icon buttons, breadcrumbs. |
| `app/app-components.css` | The reusable UI primitives — forms, Card, Dialog, EmptyState, FilterTabs, SearchInput, Toast. |
| `app/app-dashboard.css` | Page-level patterns that are too specific to be primitives — NextLessonCard, day schedules, profile headers, the calendar, the lesson peek panel, status pages, skeletons. |

## Colour

Two layers: raw palette values (`--colour-*`, defined once in `globals.css` and shared with the
marketing site), and semantic app tokens (`--app-*`, defined in `app-shell.css`'s `:root`) that
components actually use. Always reach for an `--app-*` token in new work — it's what lets the
palette move without touching every component.

| Token | Value | Use |
|---|---|---|
| `--app-canvas` | `#f4f6f8` | Page background, behind cards |
| `--app-surface` | `#ffffff` | Card/panel background |
| `--app-surface-sunken` | `#f8fafb` | Recessed areas inside a card (flush list rows, hover) |
| `--app-surface-accent` | `--colour-mint-100` | Today's calendar cell, active quick-create item |
| `--app-sidebar` | `--colour-navy-900` | Sidebar background |
| `--app-border` / `--app-border-strong` | `#e2e8ec` / `#cbd5dc` | Hairlines / stronger dividers and input borders |
| `--app-ink` | `--colour-ink` (`#16293d`) | Headings, primary text |
| `--app-text` | `#48586a` | Body text |
| `--app-muted` | `#5c6d7d` | Secondary text — descriptions, hints, subtitles, labels. Darkened from an earlier `#6b7c8c` that only cleared 4.30:1 on white; this clears 5.3:1 (WCAG AA is 4.5:1 for normal-size text — see `tests-e2e/accessibility.spec.ts`). |
| `--app-on-dark` / `--app-on-dark-muted` | `#eef4f4` / 62% | Text on the navy sidebar |
| `--app-accent` / `--app-accent-strong` | `--colour-green-700` / `-800` | Primary actions, links, focus accents |
| `--app-accent-soft` | `--colour-mint-100` | Accent-tinted background (badges, hover) |
| `--app-focus-ring` | `0 0 0 2px var(--app-surface), 0 0 0 4px var(--app-accent)` | The one focus-visible treatment, everywhere |

**One focus language** (plan 15 Wave 2). The marketing site used to have its own ring (a brown outline
in a pale-yellow halo) and the product another. Both are now the same two-tone band: a 2px accent
outline with a 2px gap (`--focus-width`, `--focus-offset`, `--focus-colour` in `tokens.css`), the
gap showing whatever surface the element sits on. It is an `outline`, not a `box-shadow`, so it
never replaces an element's own shadow, and it is >= 3:1 on every light surface (green-700 on white
is 5.6:1). Navy sections set `--focus-colour` to the mint variant (`--focus-colour-on-inverse`),
because green-700 is only 2.5:1 on navy-900; the dark theme uses mint everywhere. The product's
`--app-focus-ring` is the same band drawn as a box-shadow pair. The classroom keeps its own
high-contrast ring — correct against its dark immersive surfaces.

**Headings inherit their surface's colour.** `globals.css` styles bare `h1, h2, h3 { color:
var(--colour-ink) }`, and a rule matching an element beats an inherited value — so any heading on
a dark surface rendered dark-on-dark unless its component happened to set a colour. `app-shell.css`
restores inheritance with `.app-shell :where(h1, h2, h3) { color: inherit }`; `:where()` adds no
specificity, so it beats the bare element selector while every component rule still wins over it.
The classroom carries the equivalent guard in its own stylesheet.

Status colour is a separate, semantic vocabulary — never hardcode a status colour, use `<Badge
tone>` / `<StatusBadge status>` (`components/ui/Badge.tsx`), whose `STATUS_TONES` map is the one
place a domain status (`PLANNED`, `SUBMITTED`, …) becomes a tone (`info`, `warning`, `positive`,
`critical`, `muted`, `neutral`). Tones are semantic, not decorative — "positive" always means a
good terminal state, "warning" always means someone needs to act.

## Typography

Three typefaces, loaded once via `next/font/google` in `app/layout.tsx` and exposed as CSS
variables (`--font-bricolage`, `--font-public-sans`, `--font-ibm-plex-mono`) so every stylesheet —
including the classroom's own `styles.css` — can reference the same fonts without re-importing
them:

- **Bricolage Grotesque** (`--font-heading`) — headings.
- **Public Sans** (`--font-body` / default body font) — everything else, including the classroom
  (plan6 section 61: shared typography).
- **IBM Plex Mono** — timestamps, ids, the calendar's day-of-week labels; anything that reads as
  data rather than prose.

| Token | Size | Typical use |
|---|---|---|
| `--text-display` | `clamp(1.9rem, 2.4vw, 2.3rem)` | The rare hero-scale number (dashboard next-lesson) |
| `--text-h1` | `1.5rem` | PageHeader title |
| `--text-h2` | `1.125rem` | Card/section titles, dialog titles |
| `--text-h3` | `1rem` | Sub-headings, fieldset legends |
| `--text-body` | `0.9375rem` | Default body/paragraph/input text |
| `--text-small` | `0.8125rem` | Secondary text, hints, badges |
| `--text-label` | `0.6875rem` | Uppercase eyebrows, column headers, nav counts |

## Spacing and radii

An 8-step spacing scale (`--space-1` through `--space-7`, `0.25rem`→`3rem`) and three radii
(`--app-radius-sm` `0.5rem`, `--app-radius` `0.75rem`, `--app-radius-lg` `1rem`) — pick from these
rather than a one-off pixel value. Three shadow levels (`--app-shadow-sm/--app-shadow/
--app-shadow-lg`) follow the same principle for elevation.

## Motion (plan8)

Four durations and three easing curves, defined once in `globals.css`'s `:root` and shared by the
marketing site, the app and the classroom alike:

| Token | Value | Use |
|---|---|---|
| `--duration-instant` | `100ms` | A press releasing — `:active` states |
| `--duration-fast` | `160ms` | Hover, focus, most one-property transitions (pre-existing, kept as-is) |
| `--duration-standard` (alias of the pre-existing `--duration-medium`) | `220ms` | Dropdowns, badges, a card settling in |
| `--duration-slow` | `380ms` | Dialogs, drawers, counted numbers — bigger movements that should feel weighty, not snappy |

| Token | Curve | Use |
|---|---|---|
| `--ease-snappy` (alias of the pre-existing `--ease-out`/`--app-ease`) | `cubic-bezier(0.22, 1, 0.36, 1)` | The default — confident deceleration, no overshoot. Hover, press, most entrances. |
| `--ease-smooth` | `cubic-bezier(0.4, 0, 0.2, 1)` | Symmetric ease-in-out — crossfades, a tab underline sliding between two positions. |
| `--ease-gentle` | `cubic-bezier(0.16, 1, 0.3, 1)` | A slower, more settled ease-out for larger movements — dialogs, empty-state icons. |

**Plan 15 additions.** Three longer durations for arrivals the visitor did not trigger — never a
response to input: `--duration-emphasis` 600ms (a section-level reveal that should be noticed),
`--duration-hero` 900ms (the first screen's main objects), `--duration-cinematic` 1400ms (a whole
scene or the hero sequence's total run). Two more springs beside `surface` and `tactile` in
`src/lib/motion/tokens.ts`: `soft` (stiffness 170, damping 26 — large surfaces arriving, a hero photo
settling) and `weighty` (120/24, mass 1.25 — big panels). Staggers are a named choice
(`motionStagger.list` 80ms, `.cards` 90ms, `.editorial` 120ms) applied through one helper,
`staggerDelay(index, step, base)`, capped at six steps so a long list never waits a second; the pages
no longer hand-write `delay={i * 0.09}`. `tests/motionTokens.test.mjs` pins every duration against
its CSS custom property.

**Parallax depth presets** (`src/lib/motion/depth.ts`, the `depth` prop of `ParallaxLayer`): `accent`
(<= 48px, the default and what every existing layer uses), `scene` (<= 120px: a layer that is the
point of a scene), `cinematic` (<= 200px: a large background layer only, **full tier only** — still
everywhere else — and the layer sets `--parallax-overscan` so it can be oversized
(`inset: calc(var(--parallax-overscan) * -1) 0` inside `overflow: hidden`) and its edges never show).
The authored distance is still multiplied by the tier's `parallaxScale`.

**The tactile-press standard**, applied to every button-shaped control (`.btn`, `.dialog-trigger`,
`.icon-button`, FullCalendar's own toolbar buttons, the marketing `.btnPrimary`/`.btnSecondary`):
hover lifts `translateY(-1px)`, press drops to `scale(0.97)` (a smaller `scale(0.92)` on
`.icon-button`, since a big scale on a small square reads as a shove) at `--duration-instant` so
release feels immediate. One rule, reused everywhere, rather than each control inventing its own —
this alone is most of what makes the product feel less static (plan8 section 82).

**`useDelayedUnmount`** (`src/lib/motion/useDelayedUnmount.ts`) is the one primitive behind every
dropdown/dialog/drawer/toast that plays a reverse "closing" transition instead of the panel simply
vanishing the instant its `open` state flips to `false` — Dialog, the account menu,
QuickCreateMenu, the mobile drawer and Toaster all use it. It closes with no delay at all under
`prefers-reduced-motion`, since a reduced-motion pass must never leave an element sitting in the
DOM (and the accessibility tree) for the length of an animation that isn't actually going to run.

**`AnimatedNumber`** (`components/ui/AnimatedNumber.tsx`) counts between two values instead of
snapping — used for the topbar's notification badge. It only animates a *change within one mounted
instance*, never the first render a given instance sees: the dashboard's own stat tiles remount on
every navigation to the page, so counting up from zero on every visit would be the "annoying"
version of this plan8 section 15 explicitly rules out.

**Reduced motion** is enforced once, at the top: `globals.css`'s `@media (prefers-reduced-motion:
reduce)` block caps `animation-duration`/`transition-duration` to `0.01ms` on `*, *::before,
*::after` with `!important`, which — because `!important` beats specificity, not just source order
— silently defangs every transition/animation in every stylesheet in the document (marketing, app,
classroom) with no per-component opt-in required. The classroom's own stylesheet, ported from a
standalone app, carries a second, narrower reduced-motion block of its own for the same purpose,
which is redundant with the blanket rule but harmless. What that blanket rule *can't* reach is
anything not expressed as a CSS transition/animation — `useDelayedUnmount`'s exit timer,
`AnimatedNumber`'s requestAnimationFrame loop, the topbar's one-off bell ring — each of those
checks `prefersReducedMotion()` (`src/lib/motion/reducedMotion.ts`) directly.

**What was tried and removed.** A per-navigation page fade (`key={pathname}` on `.app-content`,
forcing every route change to replay a content-enter animation) is not in the product. It measurably
made a link/button right after navigating briefly non-actionable — a real Playwright actionability
timeout, not a cosmetic nit — which is exactly the "never delay an interaction to let a motion
effect finish" rule plan8 section 72 states outright. Removed rather than patched around; see
`AppShellClient.tsx`'s comment on the reverted `<main>` element for the specifics.

## Plan 15 foundations

### Semantic tokens (`app/tokens.css`)

Raw palette (`--colour-*`, `globals.css`) -> **semantic role** (`tokens.css`) -> component. A
component asks for what a colour is *for*; the dark theme is a second set of values for the same
names. Light values equal what the site already shipped with, role by role.

| Family | Tokens |
|---|---|
| Surfaces | `--surface-canvas` (the page), `--surface-1` (card/input), `--surface-2` (warm section tint), `--surface-3` (soft tint / card on a tint), `--surface-sunken`, `--surface-accent`, `--surface-inverse` / `-deep` / `-raised` (navy sections) |
| Text | `--fg-strong` (headings), `--fg-body`, `--fg-ink`, `--fg-muted`, `--fg-on-inverse` / `-soft` / `-muted` (on navy), `--fg-accent`, `--fg-accent-on-inverse`, `--fg-accent-bright` (large figures on navy), `--fg-error` |
| Lines | `--border-subtle`, `--border-strong`, `--border-on-inverse` |
| Accent | `--accent`, `--accent-strong`, `--accent-soft`, `--on-accent` |
| Status tones | `--tone-{neutral,muted,positive,warning,info,private}-*`, `--error-bg`: each a background/foreground pair that clears 4.5:1 in both themes |
| Identity | `--subject-{maths,english,science,eleven-plus}`, `--avatar-{a..e}-{bg,fg}` |
| Misc | `--overlay`, `--skeleton-base` / `--skeleton-sheen`, `--image-filter` |

`--text-body` / `--text-small` etc. are the product's *type sizes* (above); text *colours* are `--fg-*`
so the two never collide. The product scope (`.app-shell`, `.auth-route`) re-points the same names at
its cooler `--app-*` values, so both systems keep their character and share the vocabulary.

`scripts/tokenise-colours.py` is the property-aware converter that moved the marketing stylesheets
onto these tokens (`#fff` as a *background* is a surface that must darken; `#fff` as *text* is text on
an accent or navy fill that must stay light). Before/after counts across `globals.css`, the five
marketing CSS modules and `components/**/*.module.css`: hard-coded hex 252 -> 129, `rgb(a)` 197 -> 167,
raw `--lt-*`/`--colour-*` references 486 -> 96, semantic-token references 0 -> 543; plus every
inline `style={{ color: "#hex" }}` in the page components and the whole product stylesheet set
(status tones, avatars, alerts, skeletons, scrims). What remains is deliberate: overlays and
shadows (white/black at an alpha, correct on any theme), gradients, and always-dark surfaces
(the next-lesson card, the auth panel, the footer atmosphere) that keep their literal navy.

### Elevation

Five steps, each 2-3 stacked layers (a tight contact shadow plus soft ambient ones) tinted with the
navy, never pure black, plus a 1px inner top highlight on raised light surfaces (visible on cream,
invisible on white — correct): `--shadow-1` hairline lift (inputs, chips, rows), `-2` resting card,
`-3` hover/popover, `-4` dropdown/floating panel, `-5` dialog/drawer. The original `--shadow-sm/md/
interactive` and the product's `--app-shadow-sm/-/-lg` are now aliases of steps 2/4/3 and 1/2/4. In the
dark theme elevation is lightness + a hairline ring + deeper shadow, not a glow.

### Navy surfaces

A faint top-left radial light plus a static grain tile (`--navy-light`, `--grain`; 3.5% opacity, no
animation) on the main navy sections, so a large flat field does not band on a good display.

### Typography

`text-wrap: balance` on `h1-h4`, `text-wrap: pretty` on paragraphs/list items/quotes,
`font-optical-sizing: auto`, and `font-variant-numeric: tabular-nums` on `<time>`, `.tabular` and the
home stats. All progressive: a browser without them wraps as it always did.

### Themes (plan 15 Wave 3)

System (default) / Light / Dark. Mechanics are in `src/lib/theme.ts`: System is CSS alone
(`@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`); an explicit choice
is `html[data-theme]`, stored in `localStorage` (`lt-theme`) — never a cookie — and applied before
first paint by a tiny fixed inline script in `<head>`, so there is no flash. Everything is gated on
`html[data-themes="on"]`, set from `NEXT_PUBLIC_THEME_TOGGLE`, which is the kill switch.
`tests/theme.test.mjs` fails if the two copies of the dark block ever differ.

### Public-site interaction layer (plan 15 Waves 4-9)

Everything here is the marketing site only. Each piece names the tiers it runs on; none of it is in the
app or the classroom unless said so.

| Piece | What it is | Tiers | Where |
|---|---|---|---|
| **Smooth scrolling** | Lenis, loaded dynamically and driven from Motion's frame loop (one rAF). Keeps the browser's *real* scroll position, so `useScroll`, `position: sticky` and every scene work unchanged. Wheel notches ease (1.1s, exponential ease-out); precision-touchpad streams are handed back to the browser event by event; keyboard, find-in-page, selection autoscroll, zoom and the scrollbar stay native. In-page anchors scroll through Lenis, update the hash, **move focus to the target**, and still fire `hashchange` for the FAQ opener. Back/Forward drops any in-flight glide and adopts the browser's restored position. Paused while the mobile menu or any dialog/palette is open. Kill switches: `NEXT_PUBLIC_SMOOTH_SCROLL=0` (build) and `?smooth=0` (run time, remembered for the tab; `?smooth=1` re-enables). | full + standard, fine pointer, not reduced motion, not Save-Data; **never** the app, dashboard, classroom or touch | `components/motion/SmoothScroll.tsx`, `lib/motion/smoothScroll.ts` |
| **Shared scroll store** | One passive scroll listener: position, progress, velocity, direction, one notification per frame, nothing running at rest. `scrubProgress(y, start, end)` for scenes. The marquee quickens with scroll speed from it. | all (it is only read where used) | `lib/motion/scrollStore.ts` |
| **Hero sequence** | CSS keyframes from first paint (never JS-gated, never delaying the LCP photo): chip, headline lines rising out of masks (90ms stagger), lead, buttons, assurances, the photo settling, chips arriving; ~1.4s in total. The WebGL gradient fades in over the always-mounted static glow and follows the pointer with an eased lerp (the loop exists only while it converges). | all (WebGL: full only) | `HeroScene.tsx`, `home.module.css` |
| **Hero handoff** | On the full tier the hero is pinned (`position: sticky`, bounded by its own stack) while the marquee and stats strip slide over it; the hero copy eases up, scales to 0.96 and fades. Progress comes from the page scroll through the pin range (`usePinnedProgress`), because a pinned element's own position stops changing. | full | `HeroScene.tsx`, `lib/motion/scroll.ts` |
| **Scrubbed statement** | The home statement's words go from muted to strong as it scrolls through the viewport. Native CSS scroll-driven animation (opacity only), no JavaScript; elsewhere it is the finished sentence. | full + standard, no-preference, `@supports (animation-timeline)` | `ScrubStatement.tsx` |
| **Level bars** | Draw in as the row scrolls into view (a slide inside the clipped track: transform only, round cap preserved). | same as above | `home.module.css` |
| **Spotlight border** | One delegated `pointermove` writes `--mx/--my` on `[data-spotlight]` cards (rAF-throttled, no state); the ring is CSS. | full + fine pointer | `SpotlightPointer.tsx`, `globals.css` |
| **Route transitions** | The header is a named transition group; page content cross-fades (<=380ms), and the header's nav links add a small directional slide by their order in the menu. Never blocking: `::view-transition` is `pointer-events: none`; links are actionable the instant the page exists (K11). | full + standard; instant on light, reduced motion and unsupporting browsers | `PageTransition.tsx`, `globals.css` |
| **Command palette** | Ctrl/Cmd+K (and `/` outside a text field, and a visible Search button). An ARIA combobox/listbox on the dialog pattern; grouped, ranked results (`lib/palette/score.ts`), recents, announced result count, focus returns to the opener. The command set is a lazy chunk. The shortcut map lives in `lib/palette/shortcuts.ts`; the chord is never stolen from a form field. | all | `components/palette/`, `lib/palette/` |
| **Appearance control** | Header (one icon button cycling System/Light/Dark), footer (radio group), app account menu. | all (flag-gated) | `ThemeToggle.tsx` |

**Staggers** are `Stagger` (a container composing `Reveal`) or `staggerDelay(i, motionStagger.cards)`; never a
hand-written `delay={i * 0.09}`. **Images** go through `scripts/optimise-images.mjs`: originals in the
untracked `apps/web/assets-src/`, web-ready masters (<= 260 KB for the subject photos; the four subject
originals went from 1.2-3.8 MB to 75-200 KB) in `public/images/`, blur placeholders generated into
`src/lib/imageBlur.generated.ts`, and the subject of each photo kept in frame by `lib/imageFocus.ts`
(`object-position`). Founder portraits are rendered 1:1 at a fixed, unsqueezable size.

## Components (`components/ui/`, `components/shell/`)

| Component | Rule it enforces |
|---|---|
| `Card` / `CardHeader` / `CardBody` / `StatTile` | The one surface primitive — white card on the neutral canvas, never the whole page tinted (plan6 section 30). |
| `Badge` / `StatusBadge` | One badge vocabulary for every status in the product (section 34) — see Colour above. |
| `Avatar` | Initials-only identity mark (no photo uploads anywhere), tint derived from the name so the same person reads consistently across lists. |
| `Dialog` | The one modal pattern — focus moves in and is trapped while open, returns to the trigger on close, Escape and backdrop both close it. Replaced every ad hoc `<details>` disclosure from plan5 (section 36). Its trigger takes a `tone` (`primary` \| `secondary` \| `danger`) so a destructive flow stops presenting itself as a green primary action; it is also the only confirmation pattern in the product — never `window.confirm()`. |
| `RecordRow` / `RecordList` (`components/records/`) | The one clickable-row primitive for "a list of things you can open" — optional avatar, title, meta line, excerpt, right-hand aside, and always a chevron. This markup had been hand-written ten times across eight files, which is how it drifted: profile-page rows had no chevron while the equally clickable lesson and person rows beside them did. |
| `Field` / `FieldSet` / `FormActions` | One label/hint/error/control style for every form (section 35). |
| `EmptyState` | Purposeful empty states — what would be here, why it matters, the action that fills it. Never a bare "Tutors (0)" (section 68). Always give it an `icon`: without one the card is a paragraph floating in whitespace, and a dashboard stacking three of those reads as a page that failed to load. |
| `Toaster` | Action feedback that survives a Server Action's redirect (the message travels as `?toast=`, stripped from the URL once shown) — never an invisible server-side-only redirect as the only feedback (section 37). |
| `SearchInput` / `FilterTabs` | Search and filtering are real URL state (`?q=`, `?filter=`), not client state that vanishes on reload — bookmarkable, shareable, survives Back. |
| `PageHeader` / `Breadcrumbs` / `BackLink` | The one page header every authenticated page uses — optional back link and breadcrumbs, eyebrow, title, description, actions — so a heading never floats without context (sections 26-28). |
| `AppShell` / `AppShellClient` | See Navigation below. |

## Measure and density

Full content width is right for a list or a dashboard and wrong for everything else. Three
modifiers exist so that judgement doesn't get re-made (differently) per page:

| Class | Use |
|---|---|
| `.page--narrow` | A focused single-task page — wraps the whole page, header included. Constraining only the card leaves a 46rem form pinned to the left of a 71rem content area, with the heading above it aligned to neither; it reads as a page whose right-hand side failed to load. |
| `.card--form` | A form card on a page that also has wider content, where the page itself can't narrow. |
| `.card--empty` | A card whose entire content is an `EmptyState` — centres it and caps it at 40rem rather than stretching one sentence across the full width, and restores the generous padding that the in-card variant deliberately drops. |

`EmptyState` has two densities on purpose. The default is the compact one, for an empty section
*inside* a card that also holds other sections — at page-level padding each "nothing here" claimed
almost 300px, so three quiet sections filled a whole screen with void. `.card--empty` opts back
into the generous version, where the message really is the whole page.

## Navigation principles

- **Role-scoped, not permission-hidden.** Each role's sidebar (`lib/navigation/appNavigation.ts`)
  lists only what that role can actually do something with — an Admin-only "Tutors" link never
  appears for a Tutor, rather than appearing and 403ing (section 17's "do not expose unavailable
  modules"). `tests-e2e/navigation.spec.ts` asserts the nav's own contents per role, not just that
  a direct URL is blocked.
- **A page always says where it is.** `PageHeader`'s breadcrumbs/back-link for anything nested;
  the sidebar's own active-state (`isNavItemActive`, prefix-matching so a lesson detail page keeps
  "Lessons" highlighted) for everything else.
- **Logout can't leave the dashboard reachable via Back.** `router.replace("/")` (not `push`) plus
  `router.refresh()`, so the browser history doesn't retain an authenticated page after signing
  out (section 25).
- See `docs/INFORMATION_ARCHITECTURE.md` for the full route hierarchy and per-role navigation
  contents.

## Responsive breakpoints

No fixed device names — component-specific max-widths, largest to smallest as content genuinely
needs to change shape:

| Breakpoint | Used for |
|---|---|
| `64rem` (1024px) | Sidebar collapses to the mobile drawer; the topbar menu button appears. |
| `62rem` (992px) | Two-column layouts (profile pages, lesson detail) drop to one column. |
| `48rem` (768px) | Tablet-width tightening — grids to fewer columns, reduced padding. |
| `40rem` (640px) | Table-like rows (PersonRow, LessonRow, day schedules) stack into labelled cards instead of columns (section 83). |
| `30rem` (480px) | The lesson peek panel goes full-width; the smallest phone tightening. |

**Ask the right box.** A media query asks the window how much room there is, which is the wrong
question whenever the component doesn't get the whole window. A dashboard card in the two-column
grid is ~390px wide on a tablet whose viewport is 834px, so `48rem` never fires and the lesson
row — which spends a fixed 9.5rem on its date column and as much again on its badge and chevron —
was measured leaving 3.7px for the title. `.card` is therefore a query container, and the rows
stack on `@container (max-width: 32rem)`: below that there is no room for a title worth reading
beside those columns. The classroom's pre-join column does the same thing for the same reason.
Reach for a container query whenever a component's layout depends on its own width, and keep the
viewport queries above for things that really are about the window (the sidebar becoming a drawer).

## Role patterns

Four dashboards, one shared vocabulary (`components/dashboards/shared.tsx`): a time-of-day
`greeting()`, a `NextLessonCard` (the single most important thing on a Tutor's or Student's
dashboard), `LessonSection` (a titled card of lessons with a purposeful empty state), and
`TodaySchedule`. Each role's own dashboard component composes these differently around what that
role actually does:

- **Admin** — operational: today's schedule across the whole platform, what needs attention,
  recent activity, quick-create.
- **Tutor** — teaching: next lesson first, then reports still owed.
- **Client** — their children's lessons and progress, nothing operational.
- **Student** — their own next lesson and feedback, nothing about other students.

Every status, badge tone, and empty-state message is real — driven by the same data the page
itself queries, never a placeholder string or roadmap commentary (section 76).
