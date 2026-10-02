# LearnThrive brand guide (internal)

How the brand is used on the website and in the app, written from what the code actually does (plan 15 Wave 10). Internal: it is guidance for whoever builds or writes for LearnThrive, not a published identity manual. Where a rule below is a recommendation the code does not enforce, it says so. The owner has not formally signed off a brand guide; treat the numbers marked *recommended* as defaults to confirm.

Related: [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) (tokens, components, motion), [PLAN15_OWNER_INPUTS.md](PLAN15_OWNER_INPUTS.md).

## 1. The logo

**What it is.** The mark is an open book with a growth arrow, set beside a two-colour wordmark: "Learn" in the ink colour, "Thrive" in the brand green, "Tuition" small and spaced beneath. The mark is a vector, redrawn from the original raster by `scripts/trace-brand.mjs` and rendered inline by `components/brand/BrandMark.tsx`; the lockup is `components/Brand.tsx`. Never recreate either by hand or from the old PNGs (they are gone).

**Files** (`apps/web/public/brand/`): `learnthrive-mark.svg`, `learnthrive-mark-light.svg` (for dark grounds), `learnthrive-mark-mono.svg`, `learnthrive-logo.svg`, `learnthrive-logo-light.svg`. The icon set (`favicon.ico`, `icon.svg`, `apple-icon.png`, `public/icons/*.png` including the maskable) is generated from the mark by `scripts/make-icons.mjs`; regenerate, never edit.

**Colour.** The mark has two inks, exposed as `--brand-ink` and `--brand-green` so one component is correct everywhere:

| Surface | `--brand-ink` | `--brand-green` |
| --- | --- | --- |
| Light site (default) | `#112c4b` | `#14864b` |
| Dark theme, and any navy surface (footer, app sidebar, auth panel, classroom header) | `#eef4f8` | `#5fd08e` |
| Monochrome (`-mono.svg`) | one colour, for single-colour print and embossing | |

Do not recolour outside those pairs, add a shadow, outline or gradient, rotate, stretch or place the mark on a busy photograph.

**Clear space** *(recommended)*: keep a margin of at least half the mark's height on every side. The header and footer lockups already do.

**Minimum size** *(recommended)*: the full lockup no narrower than 7 rem (about 112 px), the mark alone no smaller than 20 px wide. Below that use the favicon artwork. The header uses a 3.15 rem × 2.7 rem mark.

**Social and metadata.** Each public page has a generated 1200 × 630 brand card (`app/og/[[...slug]]/route.tsx`): navy field, mint rule, the page's own eyebrow and title, the wordmark. Social cards are always the light brand look, in both themes. Structured data points at `/icons/icon-512.png`.

## 2. Colour roles

Use roles, never raw values: a component asks for `--surface-1`, not `#ffffff`. The semantic tokens are in `src/app/tokens.css`, with every dark value declared next to its light one; the raw palette stays in `globals.css`.

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `--surface-canvas` | white | `#0a1a2b` | the page |
| `--surface-1` | white | `#0f2740` | cards, panels, inputs |
| `--surface-2` / `--surface-3` | warm cream tints | deeper navy steps | alternating sections |
| `--surface-inverse` | navy 900 | `#061321` | hero, footer, navy sections |
| `--fg-strong` | ink | near-white | headings |
| `--fg-body` / `--fg-ink` | slate | cool grey | paragraphs |
| `--fg-muted` | muted slate | muted cool grey | captions, hints (always ≥ 4.5:1) |
| `--fg-accent` | green 800 | `#6fd3a8` | links, eyebrows, labels on a light/dark surface |
| `--fg-accent-on-inverse` | mint `#8ed2ad` | mint | the same role on navy |
| `--accent` / `--accent-strong` | green 700 / 800 | `#0b866f` / `#0a7a65` | filled buttons, bands (text on them is `--on-accent`, white) |
| `--border-subtle` / `--border-strong` | warm hairlines | navy hairlines | edges, inputs |

In the signed-in app the same names resolve to a cooler, greyer set (`--app-*`): the product is deliberately calmer than the marketing site. Accent as **text** in the app uses `--app-accent-text` (it must stay AA on the dark surfaces, where the accent fill is darker).

**Status** is carried by tone pairs (`--tone-positive`, `-warning`, `-critical`, `-info`, `-private`, `-neutral`, `-muted`), each a background and foreground that clear 4.5:1 in both themes; tone means what the status *means*, never decoration, and never carries meaning by colour alone (always a word or icon too).

**Subjects** each have an identity colour used for icons, hero accents and tinted sections: Maths green, English amber, Science blue, 11+ violet (`--sp-*`, `--subject-*`). They identify a subject; they are not status colours.

**Contrast** is a rule, not a taste: AA everywhere in both themes, measured at the worst frame of any moving background. `tests/theme.test.mjs` computes the pairs; axe runs in both themes (`tests-e2e/accessibility*.spec.ts`).

## 3. Type roles

Three families, all self-hosted by `next/font` (nothing is requested from a font service at runtime):

| Role | Family | Weights | Use |
| --- | --- | --- | --- |
| Headings and the wordmark | Bricolage Grotesque | 600, 700, 800 | page and section titles, card titles, the pull-quote |
| Body and interface | Public Sans | 400–700 | everything else: paragraphs, buttons, navigation, forms |
| Labels and figures | IBM Plex Mono | 400, 500 | eyebrows, captions, attributions, tabular figures |

Rules: headings use tight tracking and balanced wrapping (`text-wrap: balance`), body copy `pretty`; numerals that line up in columns or counters use `tabular-nums`; eyebrows are small mono capitals with generous letter-spacing; never set body copy in the heading face or headings in mono. Minimum body size 16 px (labels may go to 12 px in mono, never lower).

## 4. Motion principles

Motion explains hierarchy or creates continuity; it is never decoration, and the site's job is to feel fast and trustworthy rather than animated. The tokens and tiers are in DESIGN_SYSTEM.md; the brand-level rules:

1. **Earn it.** Use the motion headroom where it earns attention (the hero, chapter transitions, the subject pages), not on every card. Do not replace one monoculture with another.
2. **Never delay a response.** A control answers at once (≤ 160 ms). The long durations (600–1400 ms) are only for arrivals the visitor did not trigger.
3. **Compositor only.** Animate `transform` and `opacity` (a test enforces it for keyframes).
4. **Reduced motion is first-class.** The page is complete without any motion; `prefers-reduced-motion` and the in-site setting give final states, no spatial movement.
5. **Tiers.** Every effect declares which of full / standard / light / reduced it runs on and asks capability questions rather than device names. Smooth scrolling is marketing-site, fine-pointer only.
6. **Calm where it matters.** Safeguarding, FAQ, legal, trust, book and contact pages get the quietest treatment on the site.

## 5. Imagery

- **Never distort.** Photographs keep their aspect ratio at every width (`tests-e2e/images.spec.ts` fails the build on a stretched image). Portraits are square, fixed-size and never squeezed; faces are kept in frame by the focal points in `lib/imageFocus.ts`.
- **Optimised and calm.** Originals are processed by `scripts/optimise-images.mjs` (never commit originals; `assets-src/` is ignored). Photographs sit slightly back in the dark theme (a flat brightness/contrast step, never a colour shift).
- **Real over stock.** Generic stock reads as stock. Founder and tutor photographs should be the real people, at least 1200 px square. The current weakest images are listed in the owner-inputs file; replace them rather than restyle them.
- **Illustration** comes from the subject motifs and the mark (the 404, error and "Portal opening soon" pages share one graphic language: `components/brand/BrandIllustration.tsx`). One icon family, one stroke weight (`Icon.tsx`, `SubjectIcon`).
- **Alt text** describes what is shown and why it matters; purely decorative images and all background motifs are `aria-hidden`.

## 6. Voice and microcopy

LearnThrive sounds like a calm, capable teacher writing to a parent: warm, plain, specific.

- **British English** everywhere (organise, programme, maths, colour), typographic quotes and dashes, `1 November 2026` dates, 24-hour times with a time zone where it matters, pounds as `£`.
- **Say what is true and can be shown.** No superlatives the site cannot evidence ("the best", "guaranteed results"), no invented figures, testimonials, accreditations or vetting claims. Where something is missing, build the structure and leave the gap (see owner inputs). The numbers the site does use ("40+ students", "1:1", "Y1–A2") appear identically everywhere they appear.
- **Short and concrete.** Lead with what the parent wants to know. One idea per sentence. Verbs on buttons ("Book a free consultation", "Send enquiry"), never "Submit" or "Click here".
- **Errors and empty states** say what happened and what to do next, without blame or jargon ("We could not send your enquiry right now. Please try again shortly."), and say what was *not* done ("Your enquiry has not been sent yet"). They are never cute.
- **Safeguarding, privacy, complaints and terms** are written for a worried reader: plain, complete, no marketing tone, and changed only with the owner's and a reviewer's approval. Do not edit legal wording while polishing copy.
- **People.** Refer to the student by name or "your child"; never assume a family shape; use the pronouns a person gives you, otherwise they/them.
- **Never in public pages:** placeholder text, "coming soon" roadmap promises, lorem ipsum, internal jargon (tiers, tokens, plan numbers).
