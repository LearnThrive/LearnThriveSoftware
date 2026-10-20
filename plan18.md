
# LearnThrive Marketing Website — Comprehensive UI/UX Correction, Visual Consistency & Quality Audit

You are acting as a **senior frontend engineer, product designer, UX architect, accessibility specialist, and visual QA engineer**.

**Execution model:** Claude Code Sonnet 5.5 Max.

Your assignment is to thoroughly inspect, correct, refine, and verify the LearnThrive Tuition marketing website.

This is an **implementation task, not merely a review or planning exercise**. Make the necessary code changes, test them, inspect the result in a real browser, and continue fixing issues until the acceptance criteria are satisfied.

## Repositories

**Primary target:** `LearnThrive/LearnThriveTuition`

**Design reference:** `LearnThrive/LearnThriveSoftware`

Use the existing marketing website as the implementation baseline. The completed public-facing design language in LearnThriveSoftware is your reference for visual consistency.

Never copy obsolete code or overwrite unrelated functionality.

If the local repository differs from GitHub, inspect its current state first and preserve uncommitted work.

---

# Phase 1 — Establish the baseline

Before modifying anything:

1. Inspect the repository's Git status, branch, recent commits and package scripts.
2. Identify the components, routes and styles responsible for the reported issues.
3. Start the marketing website locally.
4. Open the website using the available browser automation or Claude Desktop browser integration.
5. Inspect the affected sections at desktop, tablet and mobile sizes.
6. Take baseline screenshots or record the current visual state.
7. Identify the actual root cause of each issue before implementing a fix.

Do not guess selectors or file paths. Locate the real implementations.

Avoid making broad changes to global CSS until you understand their impact.

**Important:** The screenshots supplied by the user are evidence of defects. Treat them as examples of the quality problems to eliminate across the site, not as an exhaustive issue list.

---

# Phase 2 — Fix the known issues

## Issue 1: Duplicate subject navigation links

**Location:** All Subjects page, including Maths, English, Science and 11+.

### Problem

Each subject section contains two different links to the same subject-detail page.

For example, Maths currently has:

- “Explore Maths in depth”
- “Explore Maths Tuition”

Both lead to the same destination.

This duplicates the same action without providing a different user journey.

### Required outcome

Each subject section should have **one clear primary navigation action** to its detailed page.

You must:

1. Inspect every subject section and find all duplicate same-destination CTAs.
2. Remove the redundant action while retaining a clear, prominent route to the subject-detail page.
3. Reconsider the floating information card if removing its CTA leaves it with no useful purpose.
4. Either:
   - retain the card as meaningful non-clickable information;
   - simplify or integrate its content into the main composition; or
   - remove/rework it if it unnecessarily repeats the heading, stage range and description.

Choose the cleanest visual solution based on actual browser inspection.

### Design requirements

- No pointless second CTA.
- No awkward empty space where a link or card was removed.
- Preserve valuable subject information.
- Maintain an aesthetically balanced image/text composition.
- Keep consistent patterns across Maths, English, Science and 11+.
- Do not remove useful independent navigation elsewhere.
- Do not break existing subject routes or SEO content.
- Do not replace two duplicate links with two differently worded links going to the same destination.

**Success:** Each subject section has one intentional, unambiguous path to its subject page and feels visually complete.

## Issue 2: Careers must appear in the main navigation

### Problem

Careers is currently difficult to discover because it is accessible through the footer rather than the main navigation.

### Required outcome

Add a clearly labelled **Careers** link to the website's primary navigation.

Requirements:

- Use the actual existing Careers route.
- Integrate it into the desktop navigation naturally.
- Include Careers in the mobile navigation.
- Preserve the current navigation's design language.
- Keep links and spacing balanced.
- Ensure the header does not become overcrowded at tablet widths.
- Use the existing active/hover/focus states.
- Preserve accessibility and keyboard navigation.
- Keep the footer Careers link if it remains useful.

Do not introduce a second navigation component or create a duplicate route.

Check whether the Careers page itself contains suitable onward navigation to roles and the application process.

**Success:** Careers is easy to discover from any public page on desktop and mobile.

## Issue 3: Parent testimonials/reviews are too narrow

**Location:** Careers page — “The families you would be teaching”.

### Problem

The three testimonial cards are significantly narrower than the space available.

This creates:

- excessively frequent text wrapping;
- extremely tall cards;
- poor reading comfort;
- unbalanced use of the section's horizontal space;
- unnecessary visual density within the cards;
- large unused space elsewhere.

### Required outcome

Redesign the existing testimonial **layout**, not the testimonials themselves.

Investigate the section container, grid, card width constraints and typography.

Requirements:

- Give the cards sufficient width for natural paragraph reading.
- Use the available container width more intelligently.
- Create a balanced three-card layout on large screens if appropriate.
- Allow responsive two-column or single-column arrangements where they work better.
- Avoid narrow text columns and excessive card heights.
- Maintain sensible spacing between quotation marks, headings, review text and attribution.
- Allow cards to have natural heights instead of forcing awkward equal heights when content lengths differ.
- Preserve comfortable line-height and type size.
- Maintain balanced padding and a consistent visual hierarchy.
- Keep the navy/white contrast and LearnThrive styling.
- Prevent card clipping and overflow.

**Never rewrite, fabricate, embellish or remove reviews merely to make the cards fit.**

Use typography and layout to solve the problem.

**Success:** Reviews are readable, spacious, polished, visually balanced and comfortable at every viewport.

## Issue 4: Excessive empty space in subject requests

**Location:** “Can't see your subject?” section.

### Problem

The text occupies a small area on the left, while a much taller form occupies the right.

The remaining left side becomes an enormous blank area.

This looks unfinished and reduces the section's perceived quality.

### Required outcome

Recompose the section so its content and form feel deliberately integrated.

Investigate:

- section height;
- grid alignment;
- column distribution;
- form width;
- empty space;
- form internal spacing;
- placement of introductory copy;
- responsive stacking;
- excessive top/bottom padding.

Potential approaches include:

- a better-balanced form/content grid;
- improved vertical positioning of the explanatory copy;
- a narrower but more intentional section composition;
- grouping the supporting copy and form more closely;
- a more compact form if the current control spacing is unnecessarily large;
- a refined background or structural layout that makes the space purposeful.

**Do not fill the empty area with meaningless decorative elements.**

### Preserve functionality

The form must continue to support:

- selecting subject and level;
- identifying whether the requester is a parent/guardian or student;
- optional additional information;
- email notifications/opt-in where applicable;
- validation;
- spam protection;
- submission;
- consent/privacy information;
- errors and success messages.

Do not change the API contract or weaken validation to simplify the layout.

Do not introduce dark patterns or automatically opt users into notifications.

**Success:** The section looks intentionally designed, with no giant accidental void and no loss of functionality.

## Issue 5: Uneven Careers open-role layout

**Location:** Careers page — “Where you could teach”.

### Problem

The current composition has four role cards on the first row and one card alone on the second row.

The isolated fifth card leaves the grid looking unfinished.

### Required outcome

Rework the job-role grid into a balanced, intentional composition.

The existing categories include:

- Maths Tutor
- English Tutor
- Science Tutor
- 11+ Preparation Tutor
- Register your interest / Any subject

Importantly, **Register your interest is not quite the same thing as an individual subject vacancy**.

Consider treating it as a distinctive full-width or spanning recruitment CTA after the four subject-specific role cards.

For example:

**Desktop**

- Four actual tutor roles presented as a balanced group.
- A visually distinct “Register your interest” section beneath them, intentionally spanning the available width.

Alternatively, a responsive 3+2 arrangement is acceptable if it genuinely looks better.

The choice must be informed by the browser, not arbitrary grid mathematics.

### Requirements

- No lonely orphaned card.
- Consistent widths, spacing and visual hierarchy.
- The register-interest option remains prominent.
- All role descriptions remain accurate.
- Existing application links and detail pages continue working.
- Preserve actual salary/rate and employment information without inventing or modifying terms.
- Keep layouts clean at 1440px, tablet and mobile widths.
- The final layout should look intentionally composed.

**Success:** Careers roles feel structured, trustworthy and visually finished.

---

# Phase 3 — Comprehensive website-wide UI/UX investigation

The issues above are examples of a broader problem.

You must inspect the **entire marketing website** and proactively find other defects, inconsistencies and improvements.

Do not stop at the five known issues.

Do not perform a superficial scan of the homepage.

## 3.1 Every route

Discover the real route manifest and inspect every public route, including:

- Homepage
- About
- Subjects
- Individual subject pages
- Careers
- Individual role detail pages
- Tutor application routes
- Contact
- Booking/enquiry
- FAQ
- Safeguarding
- SEN/additional-needs content
- Privacy
- Terms
- Cookies
- Accessibility
- Complaints
- 404 and relevant error states

Only test routes that actually exist. Identify any missing or broken expected routes.

## 3.2 Layout and composition

Find issues involving:

- excessive whitespace;
- cramped content;
- excessively narrow cards;
- overly wide text blocks;
- uneven grids;
- orphaned cards;
- duplicated sections or actions;
- inconsistent content widths;
- awkward asymmetry;
- oversized containers with too little content;
- misaligned columns;
- broken visual hierarchy;
- inconsistent gutters;
- abrupt section transitions;
- poor use of available screen space;
- elements that appear stranded or disconnected;
- sections that look unfinished.

Pay particular attention to desktop layouts that waste large areas of the viewport.

Do not treat whitespace itself as a defect. It is a defect when it disrupts hierarchy, reading flow or compositional balance.

## 3.3 Repeated/duplicate UX

Audit for:

- multiple CTAs leading to the same destination within the same decision context;
- duplicate navigation;
- unnecessary repeated descriptions;
- redundant cards;
- multiple controls with indistinguishable purposes;
- unnecessary intermediate clicks;
- visually clickable elements that do nothing;
- ambiguous link labels;
- competing primary actions.

Simplify the experience wherever the repeated elements provide no meaningful value.

## 3.4 Typography

Investigate:

- text wrapping too frequently;
- overly small body text;
- poor line lengths;
- inconsistent heading scales;
- missing hierarchy;
- inconsistent font weight;
- oversized headings relative to content;
- awkward orphaned lines;
- cramped paragraphs;
- inconsistent alignment;
- poor contrast.

The site should feel cohesive across all pages.

## 3.5 Components and design language

Compare equivalent components across routes.

Check:

- buttons;
- cards;
- pills;
- badges;
- navigation links;
- form fields;
- accordions;
- role cards;
- testimonials;
- subject cards;
- CTAs;
- icons;
- borders;
- shadows;
- corner radii;
- hover states;
- focus states;
- loading states;
- success/error states.

Equivalent UI should look and behave consistently unless there is a purposeful distinction.

Do not enforce uniformity so rigidly that every page loses its own visual character.

## 3.6 Responsive design

Test at least:

- 1440 × 900
- 1280 × 800
- 834 × 1112
- 768 × 1024
- 390 × 844
- 360 × 800

Also check at intermediate widths where layouts transition.

Investigate:

- broken grid columns;
- awkward card stacking;
- oversized gaps;
- tiny mobile text;
- clipped elements;
- images cropping important subjects;
- nav collisions;
- long button labels wrapping badly;
- horizontal overflow;
- forms extending beyond screen width;
- fixed/sticky elements covering content;
- inconsistent mobile padding;
- content disappearing at breakpoints.

A desktop fix is not complete unless it also works on tablet and mobile.

## 3.7 Accessibility and usability

Check WCAG 2.2 AA principles where applicable, including:

- colour contrast;
- keyboard navigation;
- logical focus order;
- visible focus indicators;
- semantic headings;
- link purpose;
- form labels;
- error associations;
- touch targets;
- reduced motion;
- zoom to 200%;
- text reflow;
- screen-reader semantics;
- alt text;
- active-state clarity.

Fix actual accessibility defects discovered.

Do not sacrifice accessibility for visual polish.

## 3.8 Motion and scrolling

Review every animated or sticky section.

Look for:

- excessive dead scrolling;
- elements animating too slowly;
- content remaining invisible unnecessarily;
- abrupt motion transitions;
- animation interfering with reading;
- inconsistent hover movement;
- sticky traps;
- layout shifts;
- laggy scroll;
- animations continuing offscreen.

Preserve the established LearnThrive cinematic motion language, but remove effects that actively harm the experience.

## 3.9 Functional UX

Exercise interactive elements, including:

- all visible links;
- navigation dropdowns/mobile menu;
- buttons;
- forms;
- selects;
- validation;
- accordions;
- filters;
- role links;
- applications;
- subject requests;
- confirmation states.

Check browser console and failed network requests.

Fix broken links, incorrect destinations, dead controls and obvious runtime regressions.

Avoid submitting real applications or enquiries during testing. Use mocked/dev-safe environments and non-deliverable test data.

---

# Phase 4 — Audit first, implement immediately afterwards

Create:

`docs/UI_UX_AUDIT.md`

For each finding record:

| Route | Component | Issue | Severity | Proposed fix | Status |
| ----- | --------- | ----- | -------- | ------------ | ------ |

Severity:

- Critical
- High
- Medium
- Low
- Polish

Categories:

- Visual
- UX
- Accessibility
- Responsive
- Functional
- Performance
- Content duplication

**Do not stop after creating this document.**

Implement the fixes.

Prioritise:

1. Broken experiences and accessibility problems.
2. The five specific user-reported issues.
3. High-impact layout/UX problems.
4. Repeated visual inconsistencies.
5. Low-risk polish that clearly improves quality.

Do not implement speculative changes that create new problems.

---

# Phase 5 — Implementation rules

1. Preserve the existing LearnThrive brand.
2. Preserve the completed cinematic design direction.
3. Do not rebuild the site from scratch.
4. Do not introduce new dependencies unless clearly justified.
5. Do not change business policies or factual claims.
6. Do not fabricate testimonials.
7. Do not weaken form validation or security.
8. Do not modify unrelated authenticated software functionality.
9. Do not remove useful content to make layouts appear cleaner.
10. Do not introduce placeholder elements or fake content.
11. Do not hardcode desktop-only solutions.
12. Do not use fixed heights to hide fundamental layout problems.
13. Do not add redundant CTA buttons to compensate for weak composition.
14. Do not add excessive animations or decorative clutter.
15. Do not use `!important` as a general fix strategy.
16. Do not add `transition: all` or permanent `will-change` everywhere.
17. Reuse existing design tokens and shared components.
18. Refactor component architecture only when necessary.
19. Preserve uncommitted user work.
20. Avoid destructive Git operations.

Prefer small, maintainable, production-quality changes that make the site more coherent.

---

# Phase 6 — Live browser verification

After each coherent group of changes:

1. Reload the affected page in the running application.
2. Inspect the entire modified section.
3. Compare against the initial screenshot/state.
4. Interact with the affected controls.
5. Test desktop.
6. Test tablet.
7. Test mobile.
8. Check console and network errors.
9. Fix regressions.
10. Run focused automated tests.

Then continue to the next group.

**Never mark a visual fix complete based solely on source inspection.**

If browser automation is unavailable, explicitly say so in the completion report and perform all feasible automated/static checks. Do not pretend browser verification occurred.

---

# Phase 7 — Automated regression coverage

Discover the repository's actual package manager and scripts. Use those rather than assuming command names.

Run all relevant:

- TypeScript checks
- ESLint
- Unit tests
- Integration tests
- Playwright/browser tests
- Production build

Add targeted regression coverage for the reported defects.

Tests should verify at minimum:

### Subjects

- Each subject section has one primary explore action.
- The action leads to the correct subject page.
- No obsolete duplicate CTA remains.
- Subject content remains accessible.

### Navigation

- Careers exists in desktop navigation.
- Careers exists in mobile navigation.
- Both link to the correct route.
- Keyboard and focus behaviour remain correct.

### Testimonials

- Cards fit within the container.
- No horizontal overflow.
- Text remains readable across breakpoints.

### Subject requests

- Form remains functional.
- Controls remain labelled.
- Validation and submission remain unchanged.
- Desktop and mobile layouts don't overflow.

### Open roles

- No orphaned final card on desktop.
- Register-interest action remains available.
- All job detail links remain correct.

Do not replace meaningful assertions with snapshots that merely approve a broken layout.

---

# Phase 8 — Final whole-site quality pass

After implementing all improvements, perform a second complete audit.

This time inspect the final result from a first-time visitor's perspective.

Test these journeys:

**Parent journey**

Homepage → Subjects → Individual subject → FAQ → Book/Contact

**Tutor journey**

Homepage → Careers → Available roles → Role detail → Application/interest

**General visitor journey**

Homepage → About → Safeguarding → Contact

Ask:

- Is the next action clear?
- Is navigation discoverable?
- Is anything confusing or repetitive?
- Does any section feel unfinished?
- Are there pages that visually feel like a different website?
- Is the spacing consistently intentional?
- Is content readable?
- Is anything unnecessarily difficult to find?
- Are calls to action meaningful rather than duplicated?
- Does the website feel polished on desktop and mobile?

Fix any newly discovered in-scope issues before stopping.

---

# Phase 9 — Final completion report

Create:

`docs/UI_UX_COMPLETION_REPORT.md`

Include:

1. Root causes of the five reported problems.
2. Exact implementation changes.
3. Other UI/UX defects discovered.
4. Improvements made across the wider website.
5. Routes and viewport sizes inspected.
6. Screenshots or before/after descriptions.
7. Accessibility findings and fixes.
8. Functional issues found and fixed.
9. Test commands and results.
10. Any remaining issues, with specific reasons they were not fixed.

Commit work in coherent checkpoints, where repository workflow permits.

Do not commit temporary screenshots, build outputs or test artifacts unless explicitly required.

---

# Non-negotiable definition of done

The task is complete only when:

- [ ] Duplicate same-destination subject CTAs are removed or meaningfully consolidated.
- [ ] All subject layouts remain visually balanced.
- [ ] Careers appears prominently in desktop navigation.
- [ ] Careers is accessible in mobile navigation.
- [ ] Parent reviews have comfortable reading widths.
- [ ] The subject-request section no longer has excessive accidental empty space.
- [ ] Subject-request functionality remains intact.
- [ ] Open-role cards have an intentional, balanced layout.
- [ ] The register-interest option is prominent rather than orphaned.
- [ ] Every public route has been reviewed for equivalent problems.
- [ ] Meaningful visual/UX inconsistencies have been fixed.
- [ ] No new broken links or dead controls.
- [ ] No new horizontal overflow at 360px.
- [ ] Keyboard navigation works.
- [ ] Reduced-motion behaviour works.
- [ ] No new browser console errors.
- [ ] Relevant accessibility checks pass.
- [ ] Lint and typecheck pass.
- [ ] Tests pass.
- [ ] Production build passes.
- [ ] Final site has been inspected interactively in a real browser.
- [ ] Audit and completion report are written.

## Final execution instruction

**Do not ask me to approve obvious fixes one by one.**

Use engineering and design judgement within the constraints above.

Do not stop at research, planning, partial implementation, or a list of recommendations.

Carry the task through to implementation, browser verification, regression testing, and a final quality pass.

The goal is not just to repair the five screenshots.

**The goal is to eliminate the same classes of UI/UX defects throughout the LearnThrive marketing website and make the entire experience feel cohesive, intentional, accessible, and professionally finished.**
