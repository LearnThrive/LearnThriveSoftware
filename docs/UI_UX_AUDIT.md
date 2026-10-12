# UI/UX audit of the public site (plan18)

What was looked at, what was found, what was done about it. Every public page was loaded in a real Chromium browser at
1440×900, 1280×800, 834×1112, 768×1024, 390×844 and 360×800, with reduced motion on for the screenshots and off for
the measured runs. The checks were automatic (a script that measures the rendered page) and visual (a screenshot of
every page, laid out as one image, then the suspicious areas at full size).

The signed-in app (`/dashboard`, `/classroom`, `/login`) was not touched. The site is the `(public)` route group of
`apps/web`; the screenshots in the brief show its Subjects and Careers pages.

## Pages covered

`/`, `/about`, `/subjects`, `/maths-tuition`, `/english-tuition`, `/science-tuition`, `/11-plus-tuition`, `/book`,
`/contact`, `/faq`, `/careers`, `/careers/maths-tutor`, `/careers/english-tutor`, `/careers/science-tutor`,
`/careers/11-plus-tutor`, `/careers/register-interest`, `/careers/apply`, `/careers/privacy`,
`/careers/safeguarding-agreement`, `/safeguarding`, `/safeguarding/reconfirm`, `/privacy`, `/terms`, `/tuition-terms`,
`/cookies`, `/accessibility`, `/complaints`, `/trust`, `/portal-opening-soon` and the not-found page: 30 pages, 180
loads in the first run and 180 in the last.

What the script measured on every load: horizontal overflow; text blocks with a measure under 24 or over 105
characters a line; tall narrow cards; text under 12px; touch targets; headings out of order; images that failed;
links that go to the same place as another link in the same section; controls with no accessible name; grid items
left alone on a row; content that sits on one side of the page; console errors and failed requests; layout shift;
and axe-core at WCAG 2.2 AA (tags `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`) at 1440 and 390.

## Findings

Severity: **Critical** blocks a task or breaks the page; **High** is a clear fault a visitor sees or is blocked by;
**Medium** is a real fault of less weight; **Low** is minor; **Polish** is taste. Status is as of the last run.

### The five faults reported

| Route | Component | Issue | Severity | Proposed fix | Status |
| --- | --- | --- | --- | --- | --- |
| `/subjects` | Subject section, hero card | A floating card between the text and the photograph repeated the section's heading, stage range and description, and carried "Explore Maths Tuition" while the text above it already linked to the same page as "Explore Maths in depth". Two differently worded links to one place (Content duplication, UX). The three-part header also left the columns uneven at tablet widths. | High | One link per section, worded "Explore X in depth". The card is gone from this page (it stays as the aside of each subject's own page). The header is two parts, text and photograph, side by side on a wide screen and stacked on a phone. The 11+ panel keeps its one link and sets its four areas beside its text. Same shape for Maths, English, Science and 11+. | Fixed |
| Every page | Header, mobile menu | Careers was reachable only from the footer and from page buttons (UX). | High | Careers added to the one `navigation` list that feeds the desktop header, the mobile menu and the search, so there is no second navigation component. Between FAQ and Book. Active state, focus ring and keyboard order are the existing ones. | Fixed |
| Every page | Header | Even before Careers, the six-link header overflowed between about 945 and 1000px while Login was showing. With seven links the header needs 1121px. (Responsive) | High | The menu opens from the toggle at 1120px and below (70rem). From 1121px the whole header fits on one line with 8px or more between controls (measured at 1121, 1150, 1200, 1280, 1440 and 1920). | Fixed |
| `/careers` | "The families you would be teaching" | Three reviews squeezed into narrow columns (about 24 characters a line, tall cards). The featured card's span rules never applied because the Reveal wrapper, not the card, is the grid item. (Visual, Responsive) | High | A three-column grid with the three cards across a wide screen; two columns with the navy review leading on a tablet; one column on a phone. Each card is as tall as its own text. 17px text. The wording, titles and attributions are untouched and a test compares them word for word with the data. | Fixed |
| `/subjects` | "Can't see your subject?" | The copy sat in a short column beside a much taller form, leaving most of the left column empty. (Visual) | High | One card: heading and a short line above, then the form in two columns (subject and level; email and its tick-box beside the note), the button with the person check beside it, the privacy note last. The empty column is gone, and the section is 889px tall at 1440px (it was 1055px). Same fields, labels, validation, human check, honeypot and consent text. | Fixed |
| `/careers` | Open roles | Five cards in an auto-fit grid left "Register your interest" alone on a row. Fact rows wrapped differently from card to card ("Hours" dropping under its label). (Visual, Content) | High | The four subject roles are one group (four across from 78rem, two by two below, one on a phone) and "Register your interest" is a wide card of its own beneath. Facts are two fixed columns, so a long value stays beside its label. Title, summary, facts and buttons line up across a row. Pay, employment type and links are unchanged and tested. | Fixed |

### Found by the audit

| Route | Component | Issue | Severity | Proposed fix | Status |
| --- | --- | --- | --- | --- | --- |
| Every page at desktop | Subjects flyout toggle | The 25.6px button tucked 2.4px under the Subjects link, so its usable width was 23.2px: under the 24px of WCAG 2.2 criterion 2.5.8 (axe `target-size`, serious). (Accessibility) | High | No overlap, 1.75rem wide. A test measures it, and axe now runs at WCAG 2.2 AA on every public page. | Fixed |
| Every page at desktop | Subjects flyout toggle | Its name, "Open the what we teach menu", still said "Open" while expanded. (Accessibility) | Low | "What we teach", with `aria-expanded` saying the state. | Fixed |
| `/careers/*-tutor`, `/careers/register-interest` | Hero | "Careers" (breadcrumb) and "All roles" (button) both linked to `/careers`. (Content duplication) | Medium | The breadcrumb stays, the button goes. | Fixed |
| `/careers/*-tutor`, `/careers/register-interest` | "Also open" | Three cards in the four-column roles grid left a gap on the right, and two columns at tablet left one alone. (Visual) A side effect of the roles fix, caught by the audit. | Medium | Three across from 62rem, one column below, never two and one. | Fixed |
| `/careers` | Safeguarding block | Lines of about 100 to 108 characters across a 1126px card. (Readability) | Medium | Heading and links beside the confirmed facts; the agreement's commitments in two columns; links last. Order is unchanged on a phone. | Fixed |
| `/safeguarding/reconfirm` | Form | The form ran the whole 1200px, lines of 107 to 142 characters. (Readability) | Medium | A 54rem column, the width the application form has. | Fixed |
| Not-found page, `/portal-opening-soon` | Copy | The paragraph touched the heading above it and the buttons below it. The rule that spaces it was written as a child selector, but the copy sits in a wrapper beside the picture. (Visual) | Medium | A descendant selector. | Fixed |
| `/trust` | Policy cards | Seven cards left "Tuition terms" alone on the last row at two and at three columns. (Visual) | Medium | Safeguarding leads as a banner across the row, the other six fill rows exactly. Any other count keeps the plain grid. | Fixed |
| `/faq` | Category cards | Five cards ahead of the wide last one left "Working together" alone with half the row empty on a desktop. (Visual) | Medium | The fifth takes the row, its questions in two columns like the last card's. | Fixed |
| `/` | Hero buttons | At 390 and 360px "Send an enquiry →" broke its arrow onto a second line and "How it works" onto two. (Responsive) | Medium | The buttons stack on a phone, each on one line. | Fixed |
| `/` | Product, trust and testimonial sections | They kept a 40px side gutter on a phone while every other section has 16px, which squeezed the featured quote to 17 characters a line. (Responsive) | Medium | The same 16px gutter. | Fixed |
| `/` | Four steps | Step titles were `h4` straight after an `h2`. (Accessibility) | Low | `h3`, drawn exactly as before. | Fixed |
| `/subjects` | Level cards | The four cards of a row were different heights (Science's GCSE card lists three sciences). The cards sit inside three wrappers, so none could stretch. (Visual) | Low | The wrappers pass the row's height down. | Fixed |
| Every page | Footer | The registration line was 11.5px. (Readability) | Low | 12px. | Fixed |
| Forms | Notes under the forms | Small print up to 132 characters a line. (Readability) | Low | Capped at 60ch (about 85 characters of ordinary text, because a `ch` is the width of a zero). | Fixed |
| `/careers*`, role pages | "Online applications open soon" notice (shown while applications are closed, which is how it ships) | The paragraph ran the whole 1156px banner, about 120 characters a line. (Readability) | Low | Capped at 80ch. Checked in a second dev server with the careers variable unset. | Fixed |
| Role pages at tablet width | Key facts aside | A one-line note 742px wide, 113 characters. (Readability) | Low | Capped at 60ch. | Fixed |
| `/careers*`, `/safeguarding/reconfirm` | Mobile enquiry bar | The parent's "Book a free consultation" bar followed tutors round the careers pages. (UX) | Medium | Hidden on those pages. | Fixed |

### Looked at and left alone

| Route | Item | Why |
| --- | --- | --- |
| `/faq` | Two links with no text, both to `/book`, in "Getting started" and "Special educational needs" | A false alarm of the script: they are inside closed disclosures, so they have no rendered text. They are named when the question opens. The script now skips closed disclosures. |
| `/` | Colour contrast on the product story and the reveal fades (axe, 390px) | Only while a mock card is mid-cross-fade between two beats: every failure found stepping through the story had an ancestor at 25 to 80% opacity, and none at full opacity. The stage is an `aria-hidden` illustration, and the page's reveal fades pass once they settle (a sweep of the whole page with a 1.4s pause after each step finds none). |
| Every page | The header's "Book" link and its "Book a free consultation" button both go to `/book` | The usual pairing of a labelled page link and the one filled button: they are different kinds of control, one is the page list and the other the page's single call to action, and the site's navigation test names `/book` as a primary route. Not the repeated-link fault the brief describes, which was two links of one kind inside one section. |
| `/privacy` | Two "applicant privacy notice" links to `/careers/privacy` | Same words, same place, in two different sections (the introduction and the retention section): the repeat helps a reader who arrives at either. |
| `/book`, `/` | A field alone in a row (phone, year group) | Normal for a form and it stacks on a phone. Moving the contact-method control beside the phone field would change the form's reading order for no real gain. |
| Several pages | 10.5 to 11.5px uppercase monospace labels | The site's label style: capitals with wide tracking, legible at that size. Raising them all to 12px is a design-system decision. Recorded for the owner. |
| Several pages | Hero text left, right side empty (About, Contact, FAQ, Subjects, legal pages) | The cinematic text hero. It has a clear focal point and a calm margin, not a void beside a tall block. |
| `/book`, `/contact` | Short lists in narrow sidebars read as 17 to 20 characters a line in the script | Average over lines that end early; the visual check shows ordinary wrapping. |
| Footer, inline links | Targets under 44px | WCAG 2.2 AA asks for 24px (or enough spacing); axe passes them. 44px is a best practice, not a requirement. |
| `npm run lint` | Fails in a working tree that holds a stale `storybook-static/` | That folder is build output, ignored by git, and is not in ESLint's ignore list. A clean checkout does not have it. Linting everything else is clean (two old warnings in files this work did not touch). Worth adding `storybook-static/**` to `globalIgnores` in `eslint.config.mjs`; not changed here. |

## Motion, scrolling and performance

- **Pinned scenes.** On the home page at 1440×900 the pinned hero is 1.2 viewports of scroll, the product story is 3.1
  viewports for six beats (about half a screen each), and the enquiry copy is pinned for 1.3. On a phone nothing but the
  header is pinned. That is not dead scrolling, so the motion was left as designed.
- **Sticky traps.** Apart from the header, the pinned scenes above and the parent's mobile enquiry bar, the sticky elements are
  the aside beside a role, the section list on the application form and the sidebar on `/book`. The bar leaves the footer
  uncovered (tested) and is off on the careers pages.
- **Reduced motion.** Everything is visible without scrolling or waiting; the existing motion tests all pass and the
  screenshots for this audit were taken that way.
- **Layout shift.** About 0.01 on a typical load and 0.028 at the very most, the same as before this work (the "good" limit is 0.1). No failed requests, no console errors.
- **Weight.** The work is CSS and markup only: no new image, script, font or dependency, and the image budgets in
  `tests/site.test.mjs` still pass.
- **Routes.** Every route the brief lists exists. There is no separate additional-needs page: that content is the FAQ's
  "Special educational needs" category, and it was checked there.

## Whole-site journeys

Clicked through with a real browser at 1440 and 390, no form submitted, console and network watched:

- Parent: home, Subjects, Explore Maths in depth (the only link), Book a free consultation, the booking form, Contact, FAQ (first question opens), the subject request form (Other box opens).
- Tutor: Careers in the header, the five roles, View role, the role page's one way back, Apply for this role, the application form, Register your interest, the safeguarding agreement, the reconfirmation page.
- General visitor: home, About, the footer's Safeguarding link, the safeguarding page (names the lead and a way to make contact), Contact (the email address and both phone numbers are links).
- Visitor: search finds Careers; every footer link and every header link answers; every trust link answers; the not-found page has a way home; Tab reaches Careers in the header in order.

A script also looked for anything with a pointer cursor that is not a control, and for links with no destination, on 17 pages: none.

No console errors and no failed requests, apart from the not-found page's own 404.

## Method notes

- Screenshots of the five faults before and after are kept in the session's scratch folder and are not committed.
- The audit script, the survey script and the journey script are scratch tools and are not part of the repository.
- Tests that now guard this work are listed in `docs/UI_UX_COMPLETION_REPORT.md`.
