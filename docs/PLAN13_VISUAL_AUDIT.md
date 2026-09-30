# Plan 13 — Visual-System Consistency and Improvement Sweep

plan13.md tasks 6–8. Combines the homepage refinement pass (task 6), the route-by-route QA pass
(task 7, all 17 public routes at 1440×900 / 834×1112 / 390×844, plus a sample of the authenticated
app shell), and this task's own additional audit categories (typography, surfaces, motion,
imagery, responsive, product/app consistency).

**Scope covered:** all 17 public routes; a sample of the authenticated app shell (Dashboard,
Lessons, Students, Reports, Calendar, logged in as the seeded dev tutor account
`tutor@learnthrive.dev`, per `tests-e2e`'s own fixture pattern).

**Scope not covered, with reason:** the classroom surfaces (`apps/classroom`). A live classroom
session needs two simultaneous participants and a joined lesson — exactly what
`LAPTOP_PHONE_TEST.md` already exists to test manually, two devices at a time. Re-deriving that
from scratch inside a visual-documentation task would either be superficial (loading the route
with nothing to render) or duplicate that existing process; the admin account was also not
reached this pass (a sequential multi-account login was blocked by the session's own permission
classifier as it read as credential exploration, correctly by its own logic — not pursued further
since the tutor account already gave a representative sample of the app-shell visual language).

## Findings

| # | Route | Viewport/state | Category | Severity | Exact issue | Proposed fix | Fixed? |
|---|---|---|---|---|---|---|---|
| 1 | `/` (`#platform`→`#lesson-story`) | 1440×900 | Layout and spacing | high | Hard cream→navy cut between ProductTabs and ProductStoryScene, and navy→cream cut from ProductStoryScene into `#levels` — every other tone break on the page uses `SectionHandoff`, these two didn't | Add `SectionHandoff` both directions | **Fixed** (task 6, commit `8d8addd`) |
| 2 | `/` (`#enquire`) | 1440×900 | Layout and spacing | high | Enquiry section's copy column (~190px) pinned to the top of a ~1060px form column (`align-items: start`), leaving ~870px of dead cream space | `position: sticky` on the copy column, matching `/book`'s sidebar. Required moving the sticky class onto `Reveal`'s own element (its animated wrapper leaves a persistent `transform` once it finishes, which breaks sticky on a nested descendant) | **Fixed** (task 6, commit `8d8addd`) |
| 3 | `/` (`#platform`, ProductTabs Student panel) | 1440×900 | Surfaces and components | high | Student panel was a full-navy card while Parent/Tutor were white — one design system reading as two, plus internal tile colours only worked against the dark card | White card matching Parent/Tutor, navy/green kept as accents on the tiles inside instead of the whole surface | **Fixed** (task 1, commit `5bd887e`) |
| 4 | `/` (`#platform`, all three ProductTabs panels) | 1440×900 | Layout and spacing | medium | Status/pill groups (`.mockCardMeta`) were left-aligned within their card instead of centred as a group | `justify-content: center` | **Fixed** (task 1, commit `5bd887e`) |
| 5 | `/` (`#lesson-story`) | 1440×900 / 834×1112 / 390×844 | Layout and spacing | high | Sticky product stage was a fixed 420px box (~19% of viewport area occupied), reading as small UI floating in a large navy void; no persistent lesson-context chrome across the six scenes | Stage scales with viewport (clamp 460–640px, ~35% occupancy); persistent context label + Tutor/Student labels added to the device chrome; scene-swap area is `flex:1` and vertically centred; mock content sized up; grid rebalanced 11fr/9fr; beat spacing tightened 62vh/40vh → 56vh/34vh | **Fixed** (task 2, commit `4ced1f4`) |
| 6 | `/dashboard/lessons` (tutor) | 1440×900 | Surfaces and components / Layout and spacing | low / polish | A sparse-but-nonempty list (1 upcoming lesson) leaves a large blank void below it, unlike a genuinely empty list (`/dashboard/reports` with 0 items), which gets a proper `EmptyState` component (icon + message). The inconsistency is between "sparse" and "empty" handling, not a broken page | Give `LessonList` (or its page wrapper) a lighter-weight "nothing else here" treatment for sparse-but-nonempty results, consistent with `EmptyState`'s visual language | **Not fixed** — this pass's evidence is a dev-seed account with genuinely minimal data (1 lesson); a real account is unlikely to sit at exactly one item indefinitely, and reworking `LessonList`'s layout behaviour carries more risk (shared across filter tabs and possibly other list views) than a cosmetic edge case justifies without first confirming it recurs with realistic data volumes. Recorded for a future pass |
| 7 | `/11-plus-tuition` | 1440×900 | Typography / Surfaces | polish | The hero's course-summary card shows the literal text "11+" where Maths/English/Science show a pictographic icon (calculator, book, flask) | None proposed | **Intentional / no change needed** — there is no obvious universal pictograph for "11+"; the numeral functions as its own icon-like badge, and substituting a generic icon would communicate less, not more |
| 8 | `/dashboard/*` (tutor) generally | 1440×900 | Layout and spacing | — | App-shell content region keeps `min-height: 100vh` regardless of content volume, which on sparse-data pages (see #6) reads as empty space below a short list | None proposed | **Intentional / no change needed** — standard, deliberate dashboard-shell convention (`app-shell.css`): keeps the sidebar full-height and the layout stable across pages of wildly different content length, rather than a content box that visually shrinks and grows against a fixed-height sidebar |
| 9 | All 17 public routes | 1440×900, 834×1112, 390×844 | Responsive behaviour | — | Checked for horizontal overflow, clipped sticky scenes, tiny tap targets, awkward button wrapping, nav/footer imbalance | — | **Clean** — no issues found. Legal pages' data tables (e.g. `/privacy`'s lawful-bases table) were specifically checked for mobile overflow and stack cleanly with no horizontal scroll |
| 10 | Homepage, About, Subjects, subject pages, legal pages | 1440×900 | Typography | — | Checked heading-scale consistency (`.sectionTitle` and equivalents), line length, letter-spacing/uppercase eyebrow treatment | — | **Clean** — consistent across all routes checked; no orphan/widow issues observed in body copy at any viewport tested |
| 11 | Homepage, subject pages | 1440×900 | Motion | — | Checked reveal-pattern variety (not everything using the same `soft` fade), sticky-sequence pacing (ProductStoryScene, already addressed by #5), hover motion consistency on cards/buttons | — | **Clean** beyond #5 — `Reveal`'s six-variant vocabulary (soft/mask/scale/side/editorial/static) is used deliberately per content type, not uniformly, matching its own component documentation |
| 12 | Homepage, About, Subjects | 1440×900 | Imagery | — | Checked crop/aspect ratio on hero photo, founder portraits, subject card images | — | **Clean** — no awkward crops or undersized assets observed |
| 13 | `/`, `/dashboard`, `/dashboard/lessons`, `/dashboard/students`, `/dashboard/reports`, `/dashboard/calendar` | 1440×900 | Product/app consistency | — | Checked whether the authenticated app shell's surfaces (navy sidebar, white cards, green accents, radius, shadow) visually agree with the marketing site's system | — | **Clean** — the app shell reads as the same design system as marketing, not a stylistically disconnected admin skin |
| 14 | `/` | 1440×900 | Surfaces and components | — | Checked keyboard-focus ring visibility/consistency on nav links and primary CTAs | — | **Clean** — focus rings visible and consistent across the elements tested |

## Summary

- **Blocking:** 0
- **High:** 3, all fixed (rows 1, 2, 5 — task 6/task 2's fixes; row 3 also high, fixed under task 1)
- **Medium:** 1, fixed (row 4)
- **Low/polish:** 2, both left as documented judgment calls (rows 6–7), with reasons
- **Clean / no finding:** rows 8–14 — categories explicitly checked with nothing to fix

No new code changes were made under this task specifically — every fix credited above was already
committed under task 1, 2, or 6. This document is task 8's required consolidated record of what
was checked, what was found, and why remaining low-severity items were left as-is, per its
"Fix all blocking/high/medium... fix low/polish when low-risk and clearly beneficial" rule: nothing
outstanding met that bar without first observing it against more realistic data.
