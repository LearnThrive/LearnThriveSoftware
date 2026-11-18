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
- Screenshots are named `<role>__<route>__<width>__<theme>.jpg`. 77 role/route pairs, 616 images per set; 330 axe runs.

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
| F01 | Admin · student/tutor profile, careers, assignment detail, purge and login panels · all | `admin__dashboard-admin-students-student-ayaan-ahmed__1440__light` | Helper paragraphs render at full body size and ink colour beside small muted text: two type sizes fighting in one panel | `.muted` is used in 8 files but never defined | open |
| F02 | Admin/Tutor · Meetings, My subjects, Schedule a lesson (repeat days) · all | `tutor__dashboard-tutor-subjects__375__light` | Bare browser checkboxes (13px targets), no spacing, browser-default fieldset border and legend on My subjects | `.checkbox-row` is never defined; `fieldset.field` / `legend.field__label` keep browser defaults | open |
| F03 | All roles · every form in the app · 375 | `admin__dashboard-meetings__375__light`, `admin__dashboard-admin-billing-client-sarah-ahmed__375__light` | Form buttons stack and centre on phones, with an extra 1.75rem gap above them, unlike every other control | The marketing site's `.form-actions` (globals.css, incl. its mobile column rule) leaks into app forms | open |
| F04 | All roles · dashboards · all | `admin__dashboard__1440__light` | Card actions ("View all", "Calendar") are 11px — smaller than the text around them | `.btn--sm` uses `--text-label` (11px) | open |
| F05 | Admin · Tutor checks, Billing · all | `admin__dashboard-admin-vetting__1440__light` | Stat-tile hints that are full sentences render as letter-spaced uppercase labels — hard to read | `.stat-tile__hint` is styled as an eyebrow label | open |
| F06 | Admin/Tutor · lesson detail Attendance · all | `tutor__dashboard-lessons-lesson-gcse-maths-completed__1440__light` | Unstyled browser select (black border, no radius) beside styled buttons | App control styles only apply inside `.field`/`.form`; this select is in neither | open |
| F07 | All roles · Calendar · 375 (and toolbar at all widths) | `admin__dashboard-calendar__375__light`, `…__1440__light` | View and prev/next buttons each fully rounded and butted together (doubled borders); events spill into the next day's cell and are cut mid-glyph; 20px inner padding squeezes the month grid on phones | FullCalendar button groups get the per-button radius with `!important`; event harness not clipped; one padding for all widths | open |
| F08 | Admin · forms with a warning message · all | n/a (code) | Form messages have square corners | `.form-message` uses `--app-radius-md`, which does not exist | open |
| F09 | All roles · Tutor checks, parent Home/Fees, Billing rules, lesson pages · all | `admin__dashboard-admin-vetting__1440__light`, `parent__dashboard__375__light`, `parent__dashboard-billing__375__light` | Consecutive cards touch with no gap | Pages render fragments straight into `<main>`; spacing between top-level blocks depended on each block remembering its own margin | open |
| F10 | Admin · student and tutor profiles · all | `admin__dashboard-admin-students-student-ayaan-ahmed__1440__light` | The destructive "Purge" panel sits above Details, Attendance and Tuition assignments — weak hierarchy, the irreversible action is the most prominent thing in the column | Card order in the page | open |
| F11 | Admin · tutor profile (and student/client at narrow widths) · 375 | `admin__dashboard-admin-tutors-tutor-jamie-patel__375__light` | Profile header buttons are drawn on top of the person's name; meta separators orphaned one per line | `.profile-header__identity` has `flex: 1` (basis 0) so it never wraps below the actions | open |
| F12 | Admin · lesson detail · all | `admin__dashboard-lessons-lesson-gcse-maths-upcoming__375__light` | Lesson chat card shows an empty white strip while it loads | The chat panel renders nothing until its first fetch returns: no loading state | open |
| F13 | All roles · sidebar · all | `admin__dashboard__1440__light`, `tutor__…__1440__light` | Same icon for different destinations: Calendar/Meetings, Tutors/Tutor checks, Clients/Billing, Activity/Concerns/Raise a concern, Lessons/My subjects, Reports/Fees, Settings/Roles | Nav items reuse a small icon set | open |
| F14 | All roles · card headers · all | `parent__dashboard__375__light`, `tutor__dashboard__768__light` | Card action sits higher than a title with no description; at 375 the actions run off the card | `.card__header` aligns to flex-start and never wraps | open |
| F15 | Parent · Children · 375 | `parent__dashboard-children__375__light` | "View calendar" overflows the card and the page scrolls sideways by 50px | Same as F14 | open |
| F16 | Tutor · Availability · 375 | `tutor__dashboard-tutor-availability__375__light` | Time range breaks over three lines; Remove button is cut off (page overflows 5px) | `.availability-row` never wraps; time can break | open |
| F17 | Admin · Applications (8 tabs), any filter tabs · 375 | `admin__dashboard-admin-careers__375__light` | Tabs wrap onto three rows | `.filter-tabs` wraps instead of scrolling on narrow screens | open |
| F18 | All roles · everywhere · 375 | manifest `smallTargets` | Touch targets under 44px: icon buttons 36px, buttons 38px, small buttons 32px, tabs, inputs, nav links | One control size for every pointer | open |
| F19 | Admin/Tutor/Parent/Student · Reports, Lessons, Notifications, Activity… empty · 768+ | `admin__dashboard-reports__1440__light` | An empty list's card shrinks to 40rem and floats centred under left-aligned tabs and heading — reads as off-centre | `.card--empty { max-width: 40rem; margin-inline: auto }` | open |
| F20 | All roles · card bodies with text then a button (Settings dev data, report PDF download, purge/login panels) · all | `admin__dashboard-settings__1440__light`, `tutor__dashboard-lessons-lesson-gcse-maths-completed__1440__light` | Buttons sit flush against the paragraph above them | Card bodies have no flow spacing between children | open |
| F21 | All roles · account menu · all | axe | `aria-required-children`: the `role="menu"` holds the profile header and theme radios | Non-menu content inside the menu element | open |
| F22 | Admin · Settings · 1440 | `admin__dashboard-settings__1440__light` | Three narrow columns: values wrap to three lines, one card stranded on a second row | `.settings-grid` minimum 22rem fits three columns at 1440 | open |
| F23 | Parent · Fees empty statement · all | `parent__dashboard-billing__375__light` | Dollar-sign icon on a sterling statement | Icon choice | open |
| F24 | All roles · classroom pre-join · 375 | `admin__classroom-lab__375__light` | "…visible to you.Your camera…" runs together; device status squeezed to three lines beside an empty bar | The `<br>` is hidden on phones with no space before it; `.device-status` capped at 155px | open |
| F25 | Dashboard loading skeleton, lesson detail alerts | n/a (code) | Inline `style` padding/margins duplicating tokens | One-off inline styles | open |
| F26 | Student · lesson classroom link before it opens · all | `student__dashboard-lessons-lesson-gcse-maths-upcoming-classroom__1440__light` | "The classroom is not open yet" is shown in the red error style | The same slot carries real join failures | open |
| F27 | Parent/Student · Library link · all | `student__library__1440__light` | The sidebar's "Library" opens the public marketing page: the app shell (sidebar, account menu) disappears | The Library catalogue lives in the public route group | open |
| F28 | All roles · LearnThrive AI · 375 | `student__library-ai__375__light` | Only the loader shows at first paint | Client-rendered page; the capture waits ~1s | open |
| F29 | Admin · assignment detail · 375 | `admin__dashboard-admin-assignments-assignment-gcse-maths-ayaan__375__light` | Three stat tiles leave one orphan on a second row | Auto-fit grid with three items at two columns | open |
