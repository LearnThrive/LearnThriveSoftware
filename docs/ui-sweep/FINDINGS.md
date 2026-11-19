# UI sweep — findings

Scope: everything a signed-in person sees (the app shell and every page for Admin, Tutor, Parent and Student, the calendar, lessons,
reports, Library and LearnThrive AI, settings, empty, error and loading states, and the classroom). The marketing pages are out of scope.
Presentation only: no behaviour, permission, route, data or copy-meaning changes.

## How this was captured

- `apps/web/scripts/ui-sweep.mjs <before|after>` signs in as each development account (in-memory seed data only) and screenshots every
  route at 375, 768, 1440 and 2560px wide, in light and dark, with reduced motion. It also records horizontal overflow, small touch
  targets at 375px and an axe-core WCAG 2 A/AA run at 375 and 1440px for every route, in both themes.
- **Synthetic data only.** The development seed names its demo people after real testers, and the parent Fees page shows the company's
  real bank account. The script reads both from source and replaces them in the page (same length and initials for names, obviously
  fake bank values) before every screenshot, and skips any screenshot in which one survives. No name or bank value is written in this
  folder. `docs/ui-sweep/before/` and `after/` are gitignored; only this file is committed.
- Screenshots are named `<role>__<route>__<width>__<theme>.jpg`. 77 role/route pairs and 602 images per set; 306 axe runs.

## Baseline (before)

- axe: **1 violation type** — `aria-required-children` on the account menu (all roles, both themes).
- Horizontal overflow at 375px: **2 routes** — parent Children (+50px), tutor Availability (+5px).
- Undersized touch targets at 375px: on every route (icon buttons 36px, buttons 38px, small buttons 32px, tabs ~33px, native checkboxes 13px).
- Lint 0 errors (10 pre-existing warnings, all in tests), type-check clean.

## Findings

Status: **Fixed** (root cause addressed), **Left** (with the reason), **Owner** (a decision for the owner).
Screenshot names are relative to `before/` and `after/`.

| ID | Where (role · route · width) | Screenshot | Defect | Root cause | Status |
|----|------------------------------|------------|--------|-----------|--------|
| F01 | Admin · student/tutor profile, careers, assignment detail, purge and login panels · all | `admin__dashboard-admin-students-student-ayaan-ahmed__1440__light` | Helper paragraphs render at full body size and ink colour beside small muted text: two type sizes fighting in one panel | `.muted` is used in 8 files but never defined | **Fixed** — `.muted` defined once (small, muted) in app-components.css |
| F02 | Admin/Tutor · Meetings, My subjects, Schedule a lesson (repeat days) · all | `tutor__dashboard-tutor-subjects__375__light` | Bare browser checkboxes (13px targets), no spacing, browser-default fieldset border and legend on My subjects | `.checkbox-row` is never defined; `fieldset.field` / `legend.field__label` keep browser defaults | **Fixed** — `.checkbox-row` defined (44px rows on phones); `fieldset.field`/`legend.field__label` reset |
| F03 | All roles · every form in the app · 375 | `admin__dashboard-meetings__375__light`, `admin__dashboard-admin-billing-client-sarah-ahmed__375__light` | Form buttons stack and centre on phones, with an extra 1.75rem gap above them, unlike every other control | The marketing site's `.form-actions` (globals.css, incl. its mobile column rule) leaks into app forms | **Fixed** — `.app-shell .form-actions` restores a left-aligned, wrapping row at every width |
| F04 | All roles · dashboards · all | `admin__dashboard__1440__light` | Card actions ("View all", "Calendar") are 11px — smaller than the text around them | `.btn--sm` uses `--text-label` (11px) | **Fixed** — `.btn--sm` keeps `--text-small` |
| F05 | Admin · Tutor checks, Billing · all | `admin__dashboard-admin-vetting__1440__light` | Stat-tile hints that are full sentences render as letter-spaced uppercase labels — hard to read | `.stat-tile__hint` is styled as an eyebrow label | **Fixed** — hint is sentence case at `--text-small` |
| F06 | Admin/Tutor · lesson detail Attendance · all | `tutor__dashboard-lessons-lesson-gcse-maths-completed__1440__light` | Unstyled browser select (black border, no radius) beside styled buttons | App control styles only apply inside `.field`/`.form`; this select is in neither | **Fixed** — `.app-content select:not([class])` gets the control styling |
| F07 | All roles · Calendar · 375 (and toolbar at all widths) | `admin__dashboard-calendar__375__light`, `…__1440__light` | View and prev/next buttons each fully rounded and butted together (doubled borders); events spill into the next day's cell and are cut mid-glyph; 20px inner padding squeezes the month grid on phones | FullCalendar button groups get the per-button radius with `!important`; event harness not clipped; one padding for all widths | **Fixed** — segmented groups, events clipped to their day (time keeps its width, title ellipsis), phone padding; on phones month cells show the start time with the title visually hidden (still read out, and shown on tap) |
| F08 | Admin · forms with a warning message · all | n/a (code) | Form messages have square corners | `.form-message` uses `--app-radius-md`, which does not exist | **Fixed** — uses `--app-radius` |
| F09 | All roles · Tutor checks, parent Home/Fees, Billing rules, lesson pages · all | `admin__dashboard-admin-vetting__1440__light`, `parent__dashboard__375__light`, `parent__dashboard-billing__375__light` | Consecutive cards touch with no gap | Pages render fragments straight into `<main>`; spacing between top-level blocks depended on each block remembering its own margin | **Fixed** — one zero-specificity rhythm rule for `.app-content` children |
| F10 | Admin · student and tutor profiles · all | `admin__dashboard-admin-students-student-ayaan-ahmed__1440__light` | The destructive "Purge" panel sits above Details, Attendance and Tuition assignments — weak hierarchy, the irreversible action is the most prominent thing in the column | Card order in the page | **Fixed** — student, tutor and client pages: details first, login next, purge last |
| F11 | Admin · tutor profile (and student/client at narrow widths) · 375 | `admin__dashboard-admin-tutors-tutor-jamie-patel__375__light` | Profile header buttons are drawn on top of the person's name; meta separators orphaned one per line | `.profile-header__identity` has `flex: 1` (basis 0) so it never wraps below the actions | **Fixed** — `.profile-header__identity { flex: 1 1 18rem }` |
| F12 | Admin · lesson detail · all | `admin__dashboard-lessons-lesson-gcse-maths-upcoming__375__light` | Lesson chat card shows an empty white strip while it loads | The chat panel renders nothing until its first fetch returns: no loading state | **Fixed** — "Loading messages…" status until the first fetch returns |
| F13 | All roles · sidebar · all | `admin__dashboard__1440__light`, `tutor__…__1440__light` | Same icon for different destinations: Calendar/Meetings, Tutors/Tutor checks, Clients/Billing, Activity/Concerns/Raise a concern, Lessons/My subjects, Reports/Fees, Settings/Roles | Nav items reuse a small icon set | **Fixed** — six new nav icons (meetings, vetting, roles, billing, concerns, subjects) |
| F14 | All roles · card headers · all | `parent__dashboard__375__light`, `tutor__dashboard__768__light` | Card action sits higher than a title with no description; at 375 the actions run off the card | `.card__header` aligns to flex-start and never wraps | **Fixed** — `.card__header` centres and wraps; `.card__action` wraps |
| F15 | Parent · Children · 375 | `parent__dashboard-children__375__light` | "View calendar" overflows the card and the page scrolls sideways by 50px | Same as F14 | **Fixed** — by F14 (overflow 50px → 0) |
| F16 | Tutor · Availability · 375 | `tutor__dashboard-tutor-availability__375__light` | Time range breaks over three lines; Remove button is cut off (page overflows 5px) | `.availability-row` never wraps; time can break | **Fixed** — row wraps, time never breaks (overflow 5px → 0) |
| F17 | Admin · Applications (8 tabs), any filter tabs · 375 | `admin__dashboard-admin-careers__375__light` | Tabs wrap onto three rows | `.filter-tabs` wraps instead of scrolling on narrow screens | **Fixed** — tab strip scrolls sideways below 40rem |
| F18 | All roles · everywhere · 375 | manifest `smallTargets` | Touch targets under 44px: icon buttons 36px, buttons 38px, small buttons 32px, tabs, inputs, nav links | One control size for every pointer | **Fixed** for controls — 44px buttons, icon buttons, tabs, inputs, selects, checkbox rows, menu items and nav links below 40rem or on coarse pointers. **Left:** calendar day-number links (each sits in a ≥45×78px day cell) and inline text links (WCAG 2.5.8 inline exception); the Library page is marketing chrome (out of scope) |
| F19 | Admin/Tutor/Parent/Student · Reports, Lessons, Notifications, Activity… empty · 768+ | `admin__dashboard-reports__1440__light` | An empty list's card shrinks to 40rem and floats centred under left-aligned tabs and heading — reads as off-centre | `.card--empty { max-width: 40rem; margin-inline: auto }` | **Fixed** — `.card--empty` keeps full width; the message stays centred and capped at 42ch |
| F20 | All roles · card bodies with text then a button (Settings dev data, report PDF download, purge/login panels) · all | `admin__dashboard-settings__1440__light`, `tutor__dashboard-lessons-lesson-gcse-maths-completed__1440__light` | Buttons sit flush against the paragraph above them | Card bodies have no flow spacing between children | **Fixed** — zero-specificity flow spacing inside `.card__body` |
| F21 | All roles · account menu · all | axe | `aria-required-children`: the `role="menu"` holds the profile header and theme radios | Non-menu content inside the menu element | **Fixed** — `role="menu"` now wraps only the two menu items (tests still find `menu`/`menuitem`) |
| F22 | Admin · Settings · 1440 | `admin__dashboard-settings__1440__light` | Three narrow columns: values wrap to three lines, one card stranded on a second row | `.settings-grid` minimum 22rem fits three columns at 1440 | **Fixed** — `.settings-grid` minimum 26rem (two columns at 1440) |
| F23 | Parent · Fees empty statement · all | `parent__dashboard-billing__375__light` | Dollar-sign icon on a sterling statement | Icon choice | **Fixed** — `ReceiptPoundSterling` on Fees, Billing and the Billing nav item |
| F24 | All roles · classroom pre-join · 375 | `admin__classroom-lab__375__light` | "…visible to you.Your camera…" runs together; device status squeezed to three lines beside an empty bar | The `<br>` is hidden on phones with no space before it; `.device-status` capped at 155px | **Fixed** — space before the hidden `<br>` (both classroom copies); device status takes the free width |
| F25 | Dashboard loading skeleton, lesson detail alerts | n/a (code) | Inline `style` padding/margins duplicating tokens | One-off inline styles | **Fixed** — `.skeleton-card` class; the lesson alerts and five `detail-list` inline margins removed (see F30) |
| F26 | Student · lesson classroom link before it opens · all | `student__dashboard-lessons-lesson-gcse-maths-upcoming-classroom__1440__light` | "The classroom is not open yet" is shown in the red error style | The same slot carries real join failures | **Left** — the same alert slot carries genuine join failures; picking a tone per message would need the page to know which error it has, which is a behaviour change |
| F27 | Parent/Student · Library link · all | `student__library__1440__light` | The sidebar's "Library" opens the public marketing page: the app shell (sidebar, account menu) disappears | The Library catalogue lives in the public route group | **Owner** — fixing this means moving the Library catalogue into the signed-in route group or changing where the nav item points: a route/navigation restructure, which the brief says to ask about first |
| F28 | All roles · LearnThrive AI · 375 | `student__library-ai__375__light` | Only the loader shows at first paint | Client-rendered page; the capture waits ~1s | **Left** — not a defect: the page is client-rendered and shows a centred loader for well under a second; at 1440 it renders fully |
| F29 | Admin · assignment detail · 375 | `admin__dashboard-admin-assignments-assignment-gcse-maths-ayaan__375__light` | Three stat tiles leave one orphan on a second row | Auto-fit grid with three items at two columns | **Left** — forcing three columns at 375px makes each tile ~100px wide; the wrap is the lesser evil and only appears on a three-tile page |
| F30 | All roles · Details cards (lesson, student, assignment, login) · all | `admin__dashboard-settings__1440__light` | Extra gap above the first row of a details list | `.detail-list` always had a top margin, so five pages patched it with an inline `marginTop: 0` | **Fixed** — margin only when something precedes it; inline overrides removed |
| F31 | All roles · classroom join form · dark | `admin__classroom-lab__375__dark` | The classroom's text inputs turn navy on its light page | The product's `.field input` rule (higher specificity) matches the classroom's own `.field` | **Fixed** — `.app .field input` restores the classroom's own input style |
| F32 | Admin/Tutor · Meetings invite list · 375 | `admin__dashboard-meetings__375__light` | With 44px rows the sixth invitee sat below the list's scroll fold | Introduced by F18; `.meeting-people` capped at 16rem | **Fixed** — 21rem cap on phones |
| F33 | All roles · every screen · all | n/a (code) | Token drift: four font weights (500/600/**650**/700) written as numbers; `999px`, `0.3rem` and `5px` radii; off-scale sizes for stat numbers (1.75rem and 2rem for the same role), the bell count, avatars and timeline titles; spacing literals beside the `--space-*` scale; raw colours in the next-lesson and sign-in gradients | The scale existed but had no tokens for weights, pills, small radii or figures, so components wrote values by hand | **Fixed** — weight, `--text-figure`, `--text-micro`, `--app-radius-xs`, `--app-radius-pill`, `--app-feature-*` and `--app-hover-veil` tokens; every literal in the product stylesheets replaced; 650 folded into 600 and 0.4/0.45/0.55rem onto `--space-2`; documented in docs/DESIGN_SYSTEM.md. **Left:** badge-internal micro padding (below `--space-1`), the brand-mark inks, the next-lesson button's 35% white border, and the sign-in page's phone headline size (not a signed-in screen) |
| F34 | Admin/Tutor · family billing, tutor rates, tutor profile, student profile, lesson detail · all | scan `manifest-*.json` | More than one primary button on one screen: family billing 5, tutor rates 11 (one per row), tutor profile 3, student profile 2, lesson detail 2 | Each card's form used the primary style for its own submit | **Fixed** — the page's main step stays primary (Issue statement, Schedule lesson, Start a report); everything else is secondary; Complete lesson is primary only once it can be pressed. Re-scan: every screen has at most one primary. Screens with none are read-only pages, which is deliberate |

## After

Same script, same routes, same widths and themes (`docs/ui-sweep/after/`), re-captured after the token pass and the primary-action fixes (F33, F34).

| Check | Before | After |
|-------|--------|-------|
| axe WCAG 2 A/AA violations (306 runs, 77 role/route pairs, 375 + 1440, light + dark) | 4 (`aria-required-children`) | **0** |
| Routes with horizontal overflow at 375px | 2 (parent Children +50px, tutor Availability +5px) | **0** |
| Undersized targets counted at 375px (all routes, both themes) | 2,304 | 1,069 — the rest are calendar day numbers, inline text links and the marketing Library page (F18) |
| Screenshots skipped because a real value survived masking | 0 | 0 |
| Screens with more than one visible primary action (375 + 1440) | 6 | **0** (F34) |

Accessibility notes: every control keeps the existing two-tone focus ring (`--app-focus-ring`); contrast is checked by axe in both themes;
icon-only buttons already carry labels (no axe `button-name` failures); reduced motion is honoured by the existing blanket rule in
globals.css plus the per-component rules, and nothing added here animates.

Not covered by the capture: careers application and concern detail pages (the seed has no applications or concerns, so there was no
detail page to open); the live classroom call screen (needs two real media devices; the pre-join screen and dev lab were captured).

## Owner decisions

1. **F27 — Library inside the app.** The sidebar's "Library" leaves the signed-in shell for the public marketing page. Keep, or move the
   catalogue into the signed-in route group (a route change).
2. **Development seed uses real names.** The in-memory seed names its demo people after the real owners and testers. They are masked in
   these screenshots; renaming them in the seed would make every future screenshot, demo and test log safe by default.

## Verification

Run on branch `ui-sweep` after the last change.

| Check | Result |
|-------|--------|
| `npm run lint` | 0 errors; the same 10 warnings as before the sweep (unused variables in test files) |
| `npm run typecheck` | Clean in all four workspaces |
| `npm test` | All pass: web 1,207/1,207; the other workspaces 585 with 1 skip that predates the sweep |
| `apps/web` Playwright (`npx playwright test`, 1,104 tests) | Full run with 4 workers: 1,052 passed, 29 flaky (passed on retry), 22 failed, all timeouts or stale navigations while four dev servers compiled on this machine. Re-run of those 22 with one worker (`--last-failed --workers=1`): **all pass** (one voice test on its retry). No test or selector was changed. |
| `apps/classroom` Playwright (`npm run test:browser`) | 36 passed, 6 failed (3 tests × 2 browsers). **Pre-existing:** "delete a chat message" and "full 4-participant room" fail the same way with `main`'s classroom files; "Admit All" passes on its own. Not caused by this sweep (whose only classroom changes are one space and one phone-width CSS rule). |
| `npm run build` | Passes |

`graphify update .` was not run: this checkout has no `graphify-out/` graph to update.

### After the token pass and primary-action fixes (F33, F34)

| Check | Result |
|-------|--------|
| `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` | All pass (lint: 0 errors, the same 10 warnings; unit: 1,207 + 585, 1 pre-existing skip) |
| Playwright specs covering the changed screens and global layout (accessibility, accessibility-dark, accessibility-zoom-keyboard, accounts, fees, lessons, safeguarding, people, navigation, corrections, app-motion, app-palette; 159 tests, 2 workers) | 154 passed, 2 skipped, 3 timed out. With one worker, two of those pass. The third, `lessons.spec.ts:301`, passes every assertion but takes ~35s against the 30s local limit, and takes the same ~35s on the code from before F33/F34 (commit `179acf6`); CI's limit is 90s. Not caused by these changes. |
| Full 1,104-test suite | Not re-run after F33/F34 (it takes about an hour here); it passed after the earlier fixes, as recorded above. |
