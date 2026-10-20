# The LearnThrive Library

Living document for the Library programme (`plan19.md`). Phase B2, the public information pages and the waitlist, is built. Everything else is not built yet, and the sections marked **To be filled** are placeholders for the engineers who build those phases: extend this file as you go, and keep it true.

## Purpose

A Library of company-made worksheets, exam-style papers, mark schemes and notes. Enrolled students get it included. Anyone else will be able to pay a subscription for all of it. Until accounts and billing exist, two public pages and a waitlist tell people it is coming.

## What the owner has confirmed

These are the only claims the public pages may make about the Library. Do not add to them without the owner:

- The Library holds company-made worksheets, exam-style papers, mark schemes and notes.
- It is included for enrolled students.
- A paid subscription for anyone else is planned.
- It is coming soon.

The plan (`plan19.md`, Phase B2) also allows the pages to say, because they are facts about scope and not claims about quality:

- The subjects and levels: Maths, English, Science and 11+ Preparation (the site's own subject list), Key Stage 2 to A Level.
- How it will work: sign in, browse and download, and that none of this is open yet.

Also decided by the plan (`plan19.md`, sections 3 and 9), none of which is built yet unless stated: content is company-authored and exam-board past papers are not redistributed; access is decided in one server function, `canAccess(account, resource)`; subjects and levels are Maths, English, Science and 11+, KS2 to A Level; payments will be Stripe Billing with hosted Checkout, in pounds, and prices live in Stripe; there is no free trial (free samples instead); the billing account holder is an adult. **The owner has not supplied prices, plan names, document counts, sample previews or a launch date.** The pages show none of them, and make no claim about quality, results or exam-board alignment.

## Phases and status

| Phase | What | Status |
| --- | --- | --- |
| A | Baseline and branch | Not yet recorded here |
| B | UI components from `UI Components/` (`/dev/ui-components`) | In progress, not complete |
| **B2** | **Public `/library` and `/pricing` pages and the waitlist (no backend)** | **Built** |
| C | Backend foundations (Supabase Auth, Postgres, Storage) | Not yet |
| D | Library with enrolled access first | Not yet |
| E | Subscriptions and billing (Stripe) | Not yet |
| F | Study Buddy (text and uploads), development only | Not yet |
| G | Voice mode | Not yet |
| H | Answers grounded in the Library (optional) | Not yet |
| I | Hardening, accessibility, deployment notes | Not yet |

Nothing may take a payment, a pre-order or a deposit before Phase E. The gates in `plan19.md` section 6 (legal, AI and children, production provider, owner approvals) must be complete before any production exposure of accounts, billing or the assistant.

## The `LIBRARY_PHASE` flag

`LIBRARY_PHASE` is `info`, `enrolled` or `live`. It defaults to `info`, and so does anything missing or unrecognised (`src/lib/library-config.ts`). It is read when the site is built, so a change needs a redeploy.

| Value | What it does today |
| --- | --- |
| `info` | The coming-soon information pages and the waitlist. This is the only behaviour that exists. |
| `enrolled` | Reserved for Phase D (enrolled students sign in and download). **Today it behaves as `info`.** |
| `live` | Reserved for Phase E (subscriptions). **Today it behaves as `info`.** |

Phases D and E change `libraryShows()` in `library-config.ts` and its test as they turn the other values on. Until then, do not tell the owner that setting `enrolled` or `live` does anything.

## Public routes

| Route | What it is |
| --- | --- |
| `/library` | Overview: what the Library is, who it is for, the subjects and levels, how it will work, a short FAQ, a clear "Coming soon" label and the waitlist form. Public, static, no cookies, no browser storage. |
| `/pricing` | The pricing card in a coming-soon state ("Price announced at launch" unless the owner has set a price) with the waitlist form below it. No payment of any kind. |
| `POST /api/library-waitlist` | The waitlist. An email address and a separate unticked consent box ("Email me once when the Library launches"). Same guards as `/api/subject-request` (origin check, rate limit, human check, honeypot, minimum time). Emails the owners and sends the person a short confirmation with a removal line. **Stores nothing.** Without JavaScript, and when the route answers 503, the pages offer an email link to the site address instead. |

The waitlist's data flow, retention (the mailbox until the launch email has been sent or 12 months, whichever is sooner; deleted on request), lawful basis (consent) and the open questions for the owners are in `apps/web/LEGAL_REVIEW.md` ("Library waitlist (plan19 phase B2)") and `docs/RETENTION_AND_DELETION.md`. The privacy and cookie pages describe it; they say the form sets no cookies, uses no browser storage and contacts no outside service.

## Environment variables

Full table in `docs/DEPLOYMENT.md`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `LIBRARY_PHASE` | `info` | See above. Build-time. |
| `LIBRARY_PRICE_MONTHLY` | unset | Pounds, display only, for example `9.99`. Shown only if valid; otherwise "Price announced at launch". Build-time. |
| `LIBRARY_PRICE_ANNUAL` | unset | Pounds, display only, for example `99`. Same rules. Build-time. |
| `LIBRARY_WAITLIST_EMAIL` | `ENQUIRY_EMAIL`, then the site address | Where waitlist sign-ups are delivered. |

The waitlist also needs the variables every form needs: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CAPTCHA_SECRET` (without them the route answers 503 "email us") and, for a staging host, `ALLOWED_ORIGINS`. No secret appears in the repo or in logs.

## How to run the checks

From `apps/web`:

```bash
npm run lint
npm run typecheck
npm test                                  # all unit and route tests (node --test)
node --test tests/libraryWaitlist.test.mjs   # the waitlist route and helpers only
npm run build                             # the pages are static: prices and phase are read here
```

Browser checks for the information pages (axe, no horizontal scroll at 360 px, no cookies, storage or third-party requests, the no-JavaScript fallback) are Playwright specs in `tests-e2e/` and run against the dev server:

```bash
npx playwright test tests-e2e/<spec>.ts --reporter=line --retries=0
npm run test:e2e          # the whole suite
npm run test:prod-smoke   # against a production build (next start)
```

Do not weaken or delete an existing test. If a copy change breaks an assertion, change the assertion minimally and keep its meaning.

## Content model

**To be filled by Phase D.** Resource fields (including the mandatory `authorship` field, which the import script refuses to omit), subjects, levels, free samples, and where files live (a private storage bucket, delivered only through short-lived signed URLs, every PDF watermarked).

## Import tool

**To be filled by Phase D.** How company-made content is imported, validated and published.

## Entitlement rules

**To be filled by Phases D and E.** `canAccess(account, resource)`: access if enrolled (an active TuitionAssignment on the family account), or with an active paid subscription, or by admin grant, or if the resource is a free sample. The entitlement matrix and the tests for it go here.
