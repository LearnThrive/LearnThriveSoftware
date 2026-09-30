# Plan 13 — Legacy Marketing Content Parity Matrix

plan13.md task 3. Compares marketing/legal **content** (not implementation, styling, or
components) between the legacy reference repo and the current site, across every area task 3
lists. Content only, never code — see "Rules" below.

- **Legacy source:** `D:\LearnThrive` (repo `LearnThriveTuition`) — read-only reference, never
  modified.
- **Current/target:** `D:\LearnThriveSoftware\apps\web`

## Rules followed

- Compare content, not implementation.
- Where the two repos conflict on a fact, the current site's facts win — the legacy version is
  marked superseded, not ported.
- Legal/compliance pages (Privacy, Cookies, Terms, and the legal FAQ category) are never
  auto-copied from legacy, even where wording differs. Differences there are marked **Needs
  verification** only, for a human to confirm with the business.
- Claims that read as testimonials, stats, awards, or credentials with no evidence of being real
  are marked **Needs verification**, never ported on trust.
- Nothing resembling an SEN diagnosis, therapy, medical assessment, or clinical claim is ported.
- Only `Missing → Port` items are candidates for Task 5.

## Summary

- ~130 distinct content items reviewed across 22 areas.
- **Missing → Port candidates: 2** — the "Special educational needs" FAQ category (task 4, already
  scoped), and the "Helpful to include" enquiry checklist missing specifically from `/book` (it
  already exists on `/contact`).
- **Needs verification: 11** — 5 legal-page/legal-FAQ items (flagged per the legal rule above, no
  content actually differs in most of these — see below), the 5 testimonials (no evidence trail in
  either repo), and the homepage's "reply within 24 hours" promise (present only in current, not a
  legacy carryover, but unverified as an operational commitment).
- **Obsolete (do not port): 3** — the legacy "prepares a draft email on your device" enquiry
  description, found in FAQ/Privacy/Cookies/Terms. The current site's real flow (submits directly,
  confirmation email follows) has already superseded this everywhere it appeared; flagged here only
  so it's never reintroduced (see task 9's stale-copy guard).
- Everything else — About, Subjects overview, all four subject pages (Maths/English/Science/11+),
  Contact, homepage core copy, Safeguarding, metadata, navigation/footer, testimonial data, the
  legal FAQ category itself — is already present and unchanged, in most cases because both repos
  currently share near-identical `site.ts`/`faqs.ts`/`legal-faqs.tsx` content.

Statuses used below: **Present**, **Present but intentionally updated**, **Missing**, **Obsolete**,
**Needs verification**.

---

## Homepage

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| Hero copy, marquee (Primary/KS3/GCSE/A-Level/11+/SATS), "three things we won't compromise on", "four steps", "four subjects", stage-by-stage levels, stats strip | `src/app/page.tsx` | `apps/web/src/app/(public)/page.tsx` | Present | Keep |
| — (no legacy equivalent) | — | "Every tutor is DBS-checked" trust section | — | New in current, no action |
| — (data existed but was never rendered on the legacy homepage) | `src/lib/site.ts` testimonials | homepage testimonials section (3 of 5 shown) | — | New surface of existing data, no action |
| — (no legacy equivalent) | — | "See it in action" product platform section, sticky lesson story | — | New in current, no action |
| "We'll reply within 24 hours — no pressure, no obligation" | not present on legacy homepage | homepage enquiry section | Needs verification | Confirm this is an actual current operational commitment before treating it as settled fact |

## About

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| Hero, "Why we started LearnThrive", both founder bios (Abdurrahman Mustafa, Tahasin Hasan), mission statement, CTA | `src/app/about/page.tsx` | `apps/web/src/app/(public)/about/page.tsx` | Present | Keep |

## Subjects (overview)

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| Hero, jump links, marquee, Maths/English/Science level cards, Science GCSE breakdown, 11+ Preparation card, CTA | `src/app/subjects/page.tsx` | `apps/web/src/app/(public)/subjects/page.tsx` | Present | Keep |
| Early years / KS1 callout | `src/app/subjects/page.tsx` | `/subjects` | Present | Keep (already confirmed present, not a gap) |

## Maths / English / Science / 11+

Both repos drive all four subject pages from the same `subjectLandingPages` config in `site.ts`,
diffed in full: hero copy, "how we support" items, stage-by-stage coverage, spotlight sections, and
CTAs are word-for-word identical (config only differs in unrelated fields — company number, tutor
login URL).

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| All Maths/English/Science/11+ page content | `src/lib/site.ts` (`subjectLandingPages`) | `apps/web/src/lib/site.ts` | Present | Keep |

## FAQ

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| "Getting started" (4 Qs) | `src/lib/faqs.ts` | `apps/web/src/lib/faqs.ts` | Present but intentionally updated | Keep — see obsolete row below for the one changed answer |
| "Lessons and learning" (4 Qs) | same | same | Present | Keep |
| "Subjects and stages" (4 Qs) | same | same | Present | Keep |
| **"Special educational needs" category — 5 Qs**: sen-support-available, sen-lesson-adaptations, sen-diagnosis-required, sen-sharing-information, sen-changing-approach | `src/lib/faqs.ts` lines 124–163 | missing | **Missing** | **Port** (task 4) — verified content has no diagnostic/medical/therapeutic claims |
| "Working together" (4 Qs) | same | same | Present | Keep |
| "Legal and compliance" category (`legalFaqs`) | same | same | Present | Keep |
| "How do I get started..." answer: "...prepares an email on your device for you to review and send." | `src/lib/faqs.ts` line 31 | rewritten, describes real submission flow | **Obsolete** | Do not port — already fixed in current |

## Book

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| Hero: "Tell us how we can support your child" | `src/app/book/page.tsx` | `apps/web/src/app/(public)/book/page.tsx` | Present but intentionally updated | Keep — current intro is shorter, not a gap |
| **"Helpful to include" checklist** (year group, subject(s), challenges/goals, preferred contact method) | `src/app/book/page.tsx` | missing from `/book` specifically (equivalent exists on `/contact`) | **Missing** | **Port** — same guidance already lives on `/contact` (`guidanceItems` in `contact/page.tsx`), reuse it on `/book`'s sidebar rather than duplicating new copy |
| "Your information is safe" note | same | `/book` "What happens to your details?" | Present but intentionally updated | Keep — current wording is more accurate |
| "A few details to get started" intro copy | same | same | Present | Keep |
| — (no legacy equivalent) | — | "What happens next?" 3-step list | — | New in current, no action |

## Contact

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| Hero, Email/Phone cards, "What to include in an enquiry" checklist, CTA | `src/app/contact/page.tsx` | `apps/web/src/app/(public)/contact/page.tsx` | Present | Keep |

## Safeguarding

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| All 6 sections: student welfare, safe online tuition, parents/guardians, raising a concern, urgent/independent help (999, NSPCC 0808 800 5000, Childline 0800 1111, GOV.UK report-abuse link), further guidance (DfE, NSPCC, "Working Together to Safeguard Children") | `src/app/safeguarding/page.tsx` | `apps/web/src/app/(public)/safeguarding/page.tsx` | Present | Keep — word-for-word identical |
| — (no legacy equivalent) | — | "Tutor recruitment and DBS checks" section | — | New in current, no action |

## Privacy

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| All 10 sections (who we are, information handled, purposes/lawful bases table, children's information, sharing, retention/security, rights, complaints, changes) | `src/app/privacy/page.tsx` | `apps/web/src/app/(public)/privacy/page.tsx` | Needs verification | Legal content — human must confirm with the business before any change; do not auto-port |
| "...prepares a draft email on your device. The website does not send or store the answers." | `src/app/privacy/page.tsx` | rewritten to describe the real submission flow | **Obsolete** | Do not port — already fixed in current; flagged only for task 9's stale-copy guard |

## Cookies

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| All 7 sections (what cookies are, current use, hosting/requests, external links, why no banner, browser controls, changes) | `src/app/cookies/page.tsx` | `apps/web/src/app/(public)/cookies/page.tsx` | Needs verification | Legal content — structurally identical, human should confirm |
| "...prepares a draft email on your device and does not use cookies..." | `src/app/cookies/page.tsx` | rewritten | **Obsolete** | Do not port — already fixed |

## Terms

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| All 7 sections (website information, enquiries/bookings, acceptable use, content/IP, external services, availability/rights, questions/changes) | `src/app/terms/page.tsx` | `apps/web/src/app/(public)/terms/page.tsx` | Needs verification | Legal content — structurally identical, human should confirm |
| "The consultation form prepares an email draft on your device..." | `src/app/terms/page.tsx` | rewritten | **Obsolete** | Do not port — already fixed |

## Navigation / footer

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| Header nav structure, footer links/company info | `src/components/{SiteHeader,SiteFooter}.tsx` | `apps/web/src/components/shell/*` | Present | Keep |

## Metadata

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| Per-route titles/descriptions, OpenGraph defaults | `src/lib/metadata.ts` + per-page `metadata` exports | `apps/web/src/lib/metadata.ts` + equivalents | Present | Keep |

## Assets/images

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| Logo and marketing imagery | `public/` | `apps/web/public/` | Present | Keep — current site uses its own asset set; no legacy image found without a current equivalent |

## Testimonials

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| 5 testimonials: Mohammed M (Y6), James H (Y9), Aisha K (GCSE), Daniel P (Y8), Emma R (Y8) | `src/lib/site.ts` | `apps/web/src/lib/site.ts` (identical array) | Present | Keep — data identical; legacy never rendered them anywhere, current now shows 3 of 5 on the homepage |
| All 5 testimonials, as a set | both | both | Needs verification | Named endorsements attributed to real parents with no permission/evidence trail visible in either codebase. The legal FAQ's own "testimonial-permissions" entry requires LearnThrive to hold evidence for each — flag for business confirmation, do not treat as safe by default |

## Age/stage coverage

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| "Year 1 to A-Level", Primary/KS3/GCSE/A-Level/SATS/11+ (homepage); "KS2 to A Level" (subject pages); early years/KS1 callout (subjects overview) | multiple | identical in current | Present | Keep |
| Homepage claims "from Year 1" / early years while the structured subject-page data says "KS2 to A Level" | both repos, unchanged | both repos, unchanged | Needs verification | Pre-existing inconsistency in **both** repos, not a legacy-vs-current gap — worth flagging to the business since Year 1/2 is only covered via an ad hoc callout, not structured data. Not a task 5 action item |

## Support statements

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| Per-subject "how we support" statements, trust points/learning features, values (Clarity, Encouragement, Partnership, Progress) | `src/lib/site.ts` | `apps/web/src/lib/site.ts` | Present | Keep |

## Enquiry guidance

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| "What should I include in an enquiry?" FAQ answer | `src/lib/faqs.ts` | identical | Present | Keep |
| Guidance checklist — Contact page | both | both | Present | Keep |
| Guidance checklist — Book page | `src/app/book/page.tsx` | missing on current `/book` | **Missing** | **Port** (same item as under "Book" above) |
| EnquiryForm consent text | `src/components/EnquiryForm.tsx` | `apps/web/src/components/EnquiryForm.tsx` | Present | Keep |
| "Prepares a draft email"/"review and send" flow description | multiple legacy files | replaced across FAQ/Privacy/Cookies/Terms/Book | **Obsolete** | Do not port — consolidated with the three Obsolete rows above |

## Safeguarding guidance

Fully covered under "Safeguarding" above — every legacy guidance item (999, NSPCC, Childline,
GOV.UK, DfE, "Working Together to Safeguard Children", NSPCC tutor guidance, "do not wait for a
response from LearnThrive") is present verbatim in current. No gaps.

## Legal FAQ content

| Legacy content | Legacy source | Final equivalent | Status | Action |
|---|---|---|---|---|
| All 13 entries: data controller/company info, information storage & access, why info is processed (incl. health/SEND sensitivity guidance), retention schedule, data subject requests, data breaches, ICO registration, bookings/payments/cancellations (24hr notice, 7-day termination, 14-day cooling-off), safeguarding-concern handling, online tuition rules, tutor checks/DBS, lesson recordings (not recorded by default), testimonial permissions | `src/lib/legal-faqs.tsx` (369 lines) | `apps/web/src/lib/legal-faqs.tsx` | Needs verification | File is byte-for-byte identical between repos. Flagged per the legal rule regardless — no content differs, no action needed beyond business awareness that "proposed"/"working policy" qualifiers (safeguarding responsibilities, retention schedule, cancellation policy) are still provisional per the source file's own comment |

---

## Action items for Task 5

Only two `Missing → Port` items survive the rules above:

1. **"Special educational needs" FAQ category** — scoped in full by task 4; not part of task 5.
2. **"Helpful to include" checklist on `/book`** — reuse the existing `guidanceItems` array/copy
   already present on `/contact` (`apps/web/src/app/(public)/contact/page.tsx`), surfaced in
   `/book`'s sidebar. Not a new content item, no duplication risk — same guidance, second surface.
