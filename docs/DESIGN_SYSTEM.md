# Design system

Plan6 section 102. A practical reference for the authenticated product's design system — what
exists, where it lives, and the rule each part is there to enforce. Not a component storybook;
read the components themselves (`apps/web/src/components/ui/`) for exact props.

The **marketing site** (`apps/web/src/app/(public)/**`) is a separate, pre-existing design system
(`app/globals.css`, `home.module.css` and friends) and isn't covered here — this document is
specifically about the authenticated product behind `/dashboard`.

## Stylesheets

Four files, loaded in this order from `app/layout.tsx`, each with one job (plan6 section 87: "one
giant UI component file" is exactly what this split avoids):

| File | Owns |
|---|---|
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
| `--app-focus-ring` | `0 0 0 3px rgb(8 115 99 / 28%)` | The one focus-visible treatment, everywhere |

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

## Components (`components/ui/`, `components/shell/`)

| Component | Rule it enforces |
|---|---|
| `Card` / `CardHeader` / `CardBody` / `StatTile` | The one surface primitive — white card on the neutral canvas, never the whole page tinted (plan6 section 30). |
| `Badge` / `StatusBadge` | One badge vocabulary for every status in the product (section 34) — see Colour above. |
| `Avatar` | Initials-only identity mark (no photo uploads anywhere), tint derived from the name so the same person reads consistently across lists. |
| `Dialog` | The one modal pattern — focus moves in and is trapped while open, returns to the trigger on close, Escape and backdrop both close it. Replaced every ad hoc `<details>` disclosure from plan5 (section 36). |
| `Field` / `FieldSet` / `FormActions` | One label/hint/error/control style for every form (section 35). |
| `EmptyState` | Purposeful empty states — what would be here, why it matters, the action that fills it. Never a bare "Tutors (0)" (section 68). |
| `Toaster` | Action feedback that survives a Server Action's redirect (the message travels as `?toast=`, stripped from the URL once shown) — never an invisible server-side-only redirect as the only feedback (section 37). |
| `SearchInput` / `FilterTabs` | Search and filtering are real URL state (`?q=`, `?filter=`), not client state that vanishes on reload — bookmarkable, shareable, survives Back. |
| `PageHeader` / `Breadcrumbs` / `BackLink` | The one page header every authenticated page uses — optional back link and breadcrumbs, eyebrow, title, description, actions — so a heading never floats without context (sections 26-28). |
| `AppShell` / `AppShellClient` | See Navigation below. |

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
