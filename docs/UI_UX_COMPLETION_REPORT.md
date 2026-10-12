# UI/UX completion report (plan18)

The five faults in the brief are fixed, each checked in a real browser at six widths and each guarded by tests. The
audit of every public page found more, and all of those worth fixing are fixed. What was found is in
`docs/UI_UX_AUDIT.md`; this report says what caused the five faults, what changed, what was checked and what is left.

Work is in two commits and a documentation commit on `feature/careers`:

1. the five reported faults, with their tests;
2. the corrections the whole-site audit found, with their tests;
3. the audit and this report.

The signed-in app was not touched. No business fact, price, policy or review changed. No new dependency.

## 1. The five faults: cause and fix

### 1.1 Two links to one subject page (`/subjects`)

**Cause.** The subject hero card added in the careers work sat between each section's text and its photograph. It
repeated the section's heading, stage range and description, and carried "Explore Maths Tuition" while the text above
it already said "Explore Maths in depth" to the same page. Two differently worded links to one place, and a three-part
header that left the columns uneven at tablet widths.

**Fix.** One link per section, "Explore X in depth", the same shape for Maths, English, Science and 11+. The card is
gone from this page and stays on each subject's own page, where it is the aside of the hero. A section is two parts, text
and photograph, side by side on a wide screen (the photograph first for English) and stacked, text first, on a phone.
The 11+ panel keeps its one link and sets its four areas in a two-by-two beside its text. A test fails if any section
has two links to the same place.

### 1.2 Careers in the main navigation

**Cause.** `navigation` in `src/lib/site.ts` did not list `/careers`; it was reachable from the footer and from page
buttons only.

**Fix.** One line in that list, which the desktop header, the mobile menu and the search all read, so there is no
second navigation component. It sits between FAQ and Book and uses the existing active, focus and keyboard behaviour.
The search finds it for "tutor jobs", "apply" and similar. The header was the harder part: the six-link header already
overflowed between about 945 and 1000px while Login was showing, and seven links need 1121px. The menu now opens from
the toggle at 1120px and below; from 1121px the whole header fits on one line with 8px or more between controls
(measured at 1121, 1150, 1200, 1280, 1440 and 1920). The parent's mobile "Book a free consultation" bar is hidden on
the careers pages, where it does not belong.

### 1.3 Narrow reviews (`/careers`, "The families you would be teaching")

**Cause.** The grid had six columns and the cards carried `grid-column: span 2` (the navy one `span 3`), but each card
sits inside a `Reveal` wrapper, and the wrapper is the grid item, so the spans never applied. The three wrappers took one
sixth of the row each and the right half stayed empty, which is what the screenshot showed.

**Fix.** A three-column grid, the three cards across the whole container, each as tall as its own text (`align-items:
start`). Below 70rem the navy review leads on its own row and the other two sit under it; below 40rem it is one column.
The text is 17px. The reviews are untouched: a test compares them with the data word for word.

### 1.4 The empty column (`/subjects`, "Can't see your subject?")

**Cause.** A two-column grid: a short column of copy beside a form much taller than it, so the column under the copy was
empty.

**Fix.** One card. The heading and a short line sit on top. The form below is in two columns: subject and level; then the
email address with its tick-box beside the note; then the button with the person check beside it; the privacy note last.
Phones get one column in the order the questions are asked. Fields, labels, validation, the human check, the honeypot,
the consent wording and the endpoint are unchanged, and the existing form tests all pass. The section is 889px tall at
1440px (it was 1055px).

### 1.5 The orphaned card (`/careers`, "Where you could teach")

**Cause.** `repeat(auto-fit, minmax(17rem, 1fr))` with five cards in a 1200px container gives four columns and one card
alone on the next row. The facts were `display: flex; flex-wrap: wrap`, so a long value (the hours) dropped under its
label and the rows stopped lining up from card to card.

**Fix.** The four subject roles are one group: four across from 78rem, two by two below that, one column on a phone.
"Register your interest" is a wide card of its own beneath, because it is an open invitation and not a fifth vacancy. On
a tablet it spans the width of the two columns; on a phone it is one more card. Facts are two fixed columns (label and
value), so a long value stays beside its label, and where the browser has CSS subgrid the title, summary, facts and
buttons line up across a row. Pay (£10 an hour per student), self-employed status, hours wording and every link are
unchanged, and a test reads them from each card.

## 2. What changed, by area

Source (`apps/web/src`):

- **Navigation and header:** `lib/site.ts` (Careers in `navigation`), `lib/palette/publicCommands.ts` (search keywords,
  no separate Careers entry), `app/globals.css` (header breakpoints 59rem to 70rem, flyout breakpoint to match),
  `components/MobileEnquiryBar.tsx` (hidden on `/careers*` and `/safeguarding/reconfirm`).
- **Subjects page:** `app/(public)/subjects/page.tsx` and `subjects.module.css` (two-part sections, the 11+ panel,
  the drawn path's offset, the 11+ label's contrast), `components/SubjectHeroCard.tsx` (the card on a subject's own page
  only) and `SubjectHeroCard.module.css` (deleted, its rules were only for the card in the section).
- **Subject request:** `components/SubjectRequestSection.tsx`, `SubjectRequestForm.tsx`, `SubjectRequestForm.module.css`,
  and `forms/Fields.tsx` with `forms/forms.module.css` (an inline radio group).
- **Careers hub:** `app/(public)/careers/page.tsx`, `components/careers/CareersBlocks.tsx` (the wide card),
  `components/careers/careers.module.css` (roles, facts, subgrid), `app/globals.css` (the reviews grid).

Audit corrections:

- **Header:** `SubjectsFlyout.tsx` and `globals.css` (the toggle is 1.75rem wide and no longer tucked under the link;
  its name is "What we teach").
- **Role pages:** `careers/[slug]/page.tsx` (one way back in the hero, the "Also open" strip), `careers.module.css`.
- **Careers hub:** `careers/page.tsx` and `careers.module.css` (the safeguarding block, the closed notice, the aside note).
- **Reconfirmation:** `ReconfirmForm.tsx` and `apply/apply.module.css` (a 54rem column), `forms/forms.module.css`
  (a 60ch limit on small print).
- **Other pages:** `faq/faq.module.css` (the fifth category takes its row), `globals.css` (the trust hub banner, the
  not-found paragraph, the footer line at 12px), `home.module.css` (hero buttons stack on a phone, the three sections
  that kept a 40px gutter), `LearningPathScene.tsx` (step titles as `h3`), `subjects.module.css` (level cards one height).

Tests are listed in section 8.

## 3. Other defects the audit found

Eighteen in all, none reported in the brief; the table is in `docs/UI_UX_AUDIT.md`. The ones a visitor would notice:

- A control in every desktop header kept only 23.2px of its width clear, under the 24px of WCAG 2.2 (2.5.8), because it
  tucked under its neighbour.
- The not-found page and the portal notice had no space between their heading, paragraph and buttons: a selector that
  matched nothing.
- `/trust` left one policy alone on its last row; `/faq` left a category alone with half its row empty.
- Role pages linked to the careers hub twice in the hero, and their "Also open" strip left a gap or an orphan.
- On a phone the home page's two hero buttons broke their own labels over two lines, and three home sections kept a 40px
  gutter while the rest had 16px, which squeezed the featured quote to 17 characters a line.
- The reconfirmation form and the careers safeguarding block ran 100 to 140 characters a line.

## 4. Wider improvements

- The automated accessibility check now runs at WCAG 2.2 AA (tags `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`) on every
  public page, and `/trust` and `/portal-opening-soon` are in the sweeps. It had been 2.0 A/AA, which has no target-size rule.
- A sweep checks that none of 25 public pages is wider than the screen at 360, 390, 834 and 1440px.
- Layout rules are tests, not screenshots: heights, columns, rows that fill, order, measure. A layout that is wrong
  cannot be approved by accepting a new snapshot, because there are none.

## 5. What was inspected

- **Pages (30):** `/`, `/about`, `/subjects`, the four subject pages, `/book`, `/contact`, `/faq`, `/careers`, the four
  role pages and `/careers/register-interest`, `/careers/apply`, `/careers/privacy`, `/careers/safeguarding-agreement`,
  `/safeguarding`, `/safeguarding/reconfirm`, `/privacy`, `/terms`, `/tuition-terms`, `/cookies`, `/accessibility`,
  `/complaints`, `/trust`, `/portal-opening-soon` and the not-found page.
- **Widths:** 1440×900, 1280×800, 834×1112, 768×1024, 390×844 and 360×800: two full runs of 180 loads each (one after the five
  faults were fixed, one after the audit's corrections), a run of the six careers pages (36 loads) with applications
  closed, and a visual survey of every page at 1440, 834 and 390.
- **Themes:** light and dark for the sections that changed.
- **Applications closed.** That is how the site ships, until the safeguarding agreement is approved, and the dev server
  used for the tests opens the forms. A second dev server with the careers variable unset was used for the careers hub,
  a role page, the application page and the reconfirmation page, at 1440, 1100, 834 and 390px.
- **Journeys** with real clicks at 1440 and 390, no form submitted: a parent (home, Subjects, Maths, Book, Contact, FAQ,
  the subject request), a tutor (Careers in the header, a role, Apply, Register your interest, the agreement, the
  reconfirmation page) and a visitor (search, every header, footer and trust link, the not-found page, Tab order).

## 6. Before and after

Heights of the sections as screenshotted at 1440px (pixels):

| Section | Before | After |
| --- | --- | --- |
| Maths section on `/subjects` | 587 | 549 |
| English section | 587 | 548 |
| 11+ panel | 685 | 493 |
| "Can't see your subject?" | 1055 | 889 |
| Roles on `/careers` | 1497 | 1172 |
| "The families you would be teaching" | 1168 | 818 |

The reviews were each about 190px wide (a sixth of the container) and are now about 380px. The request form's empty
column and the orphaned role card are gone, and no subject section has two links to its page.

## 7. Accessibility and functional findings

- One real WCAG 2.2 failure, the flyout toggle's target size, fixed and now tested on every public page.
- The flyout toggle's name said "Open" when expanded; it is "What we teach" with `aria-expanded` giving the state.
- A heading level was skipped on the home page (an `h4` after an `h2`); fixed.
- Keyboard order, focus rings and the active state of the new Careers link are the existing ones, and are tested; the
  mobile menu closes on Escape and returns focus to its button as before.
- Reduced motion: unchanged, and every test of it passes.
- No broken internal link, no console error and no failed request on any of the 30 pages, apart from the not-found page's
  own 404. Layout shift is about 0.01 on a typical load and 0.028 at most, as before.
- axe still reports colour contrast on the product story at 390px, but only while one of its mock cards is part-way
  through a scroll cross-fade (every failing element had an ancestor at 25 to 80% opacity), and the stage is an
  `aria-hidden` illustration. At rest nothing fails.

## 8. Tests and results

Tests added or changed for this work:

- `tests-e2e/subjects-layout.spec.ts` (replaces `subjects-hero-cards.spec.ts`): one link per section and where it goes,
  no repeated card, text before photograph, the layouts at eight widths, the drawn path never through text, the 11+ label's
  contrast, the card still on each subject's own page, and (audit) the level cards one height.
- `tests/site.test.mjs`: the navigation list is exactly the expected routes, Careers among them.
- `tests-e2e/site-header-footer.spec.ts`: Careers in the desktop header and the mobile menu, by keyboard, marked current
  on the careers pages, the header fitting from 1121px and the menu below it.
- `tests-e2e/enquiry-bar.spec.ts`: the parent's bar stays off the careers pages.
- `tests-e2e/careers.spec.ts`: the roles (four across, two by two, the facts, the terms, no overflow), the families (three
  across, the tablet order, a phone, the real words), and (audit) the role page's one way back, the "Also open" strip and
  the safeguarding block.
- `tests-e2e/subject-request.spec.ts`: the request section's layout and that nothing overflows with the Other box open.
- `tests-e2e/subjects-flyout.spec.ts`: the toggle is at least 24px each way and clear of its link.
- `tests-e2e/safeguarding-reconfirm.spec.ts`: the form is a readable column.
- `tests-e2e/site-layout.spec.ts` (new): nothing wider than the screen on 25 pages at four widths; the trust hub, the FAQ
  categories, the not-found and portal pages' spacing, the home hero buttons, the home section gutters, the step headings.
- `tests-e2e/accessibility.spec.ts`: WCAG 2.2 AA on every public page.

Commands, run from `apps/web`:

```bash
npx tsc --noEmit
npx eslint . --ignore-pattern "storybook-static/**"
npm test
npx playwright test
npm run build
npm run test:prod-smoke
```

Results (final tree):

- `npx tsc --noEmit`: no errors.
- `npx eslint . --ignore-pattern "storybook-static/**"`: 0 errors and 2 old warnings, in `scripts/trace-brand.mjs` and
  `src/lib/search/appSearch.ts`, which this work did not touch.
- `npm test`: 402 of 402 pass.
- `npx playwright test`, 790 tests, last full run on a fresh server with nothing else running: **786 pass, 2 are skipped
  and 1 fails**. The one that fails is `frame-loops.spec.ts`, "StatCounter ... never re-renders React per frame". It
  fails in exactly the same way on the code from before this work (a full run of that code: 667 pass, the same one fails,
  2 skipped), and it passes on its own (nine of nine). It counts React commits, and a dev server that is compiling other
  pages for the other workers adds commits. One test of this work flickered in that run: the home hero buttons'
  alignment was measured while the page was still rising into place. It now measures both buttons in one call and passes
  24 of 24 repeats; the header tests' wait for a first-visit page compile was lengthened from 5 to 15 seconds. The specs
  touched after that run (layout, header, flyout, subjects, careers: 160 tests) were run again and pass.
- Two earlier full runs shared the machine with other jobs, or reused a server that already held lessons made by an earlier
  partial run, and so failed some app tests (lessons) that pass alone and in the clean run. They are not counted above.
- `npm run build`: succeeds, 89 pages generated, no warnings.
- `npm run test:prod-smoke`, 48 tests against `next start` (the shipped state, with applications closed): 48 pass.

## 9. Left alone, and why

- **10.5 to 11.5px uppercase monospace labels** across the site: it is the site's label style, and raising them is a
  design-system decision. The one place they carried a sentence (the footer's registration line) is now 12px.
- **Text-led heroes** with the right side empty (About, Contact, FAQ, Subjects, the legal pages): the cinematic hero,
  with a focal point, not a void beside a tall block.
- **A field alone in a row** in the booking and enquiry forms: normal for a form, and it stacks on a phone.
- **`npm run lint` fails in a working tree that holds a stale `storybook-static/` folder.** It is build output ignored by
  git and absent from ESLint's ignore list, so a clean checkout is fine. Everything else lints clean, apart from two old
  warnings in files this work did not touch. Adding `storybook-static/**` to `globalIgnores` would make it pass here too.
- **The browser suite cannot run with applications closed**, because the dev server that serves it opens the forms. The
  shipped, closed state is covered for content and 360px overflow by the production smoke suite, and its layouts were
  checked by hand in a second dev server. A Playwright project that runs the careers pages with the variable unset would
  make the layout checks permanent.
- **Screenshots and scratch tools** (the audit, the survey, the journeys) are not committed.

## 10. Commits

On `feature/careers`, not pushed:

- `60b4943` Careers in the main navigation, one link per subject section, balanced roles, readable families, compact subject request
- `6c8995b` Corrections from the whole-site audit of the public pages
- the commit that adds this report, `docs/UI_UX_AUDIT.md` and the note in `docs/CAREERS_COMPLETION_REPORT.md`

`plan18.md`, `CAREERS_PLAN.md`, `CAREERS_PROMPT.md`, `apps/web/scripts/stress.mjs` and `docs/mirofish/` are still untracked,
as they were.
