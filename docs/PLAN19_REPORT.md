# Plan 19 report: Library, subscriptions, LearnThrive AI and voice mode

Branch `feature/library` (from main `79bdfea`), 30 or so small commits. **Nothing was deployed.** Everything new is closed in production by default; the section 6 gates (legal, safeguarding, provider, owner approvals) are untouched and still open.

## What was built

| Phase | Result |
| --- | --- |
| A Baseline | Branch, motion baseline (`plan19-baseline`), repo facts checked. |
| B UI components | `AiInput`, `VoiceOrb`, `HubNav`, `AuthCard`, `PricingCard`, `PencilLoader` converted from `UI Components` with stories and tests. The originals are untouched. |
| B2 Public pages | Library and pricing information pages in coming-soon mode with a waitlist; no backend, no cookies. |
| C Backend | Supabase schema with Row Level Security (proven with PGlite), repositories on memory and Postgres with one shared contract suite, account sign-up/sign-in/reset with two session cookies, `LIBRARY_ENABLED` opening only the account and Library routes. |
| D Library | Access rules (`canAccess`), watermarked downloads from private storage with an hourly cap and counter-only audit, import tool, catalogue/search/subject/resource pages, free samples, dev seed. |
| E Billing | Stripe hosted checkout and portal, signed idempotent webhook, entitlement derived from the subscription read back from Stripe, reconciliation and grant scripts, consumer-law wording with a recorded consent, draft terms page. Fail-closed unless every gate in `docs/BILLING.md` is met. |
| F LearnThrive AI | Provider boundary (Ollama, OpenAI-compatible/NIM, fallback chain, mock), rule-based moderation and output guard, fixed safeguarding reply and flag email, uploads, queue, caps, retention job, export and deletion, the screen, and the benchmark. |
| G Voice | Speech sidecar, push-to-talk capture, transcript shown to correct, speech streamed sentence by sentence, device fallback, benchmark. |
| H Library grounding | **Not built** (optional). There is no Library content to embed yet, and the entitlement-filtered retrieval is best built and tested against the real catalogue. Design notes: embeddings with `mxbai-embed-large` (already installed) at import time into pgvector (a new migration), retrieval filtered by the caller's `canAccess`, extracts capped at a few sentences, tested by asking as a plain account for members-only content. |
| I Hardening | Full test runs, production build and smoke, Storybook build, motion profile, licences, legal drafts, docs (this report). |

## Measured results against targets

| Target | Result |
| --- | --- |
| Unit tests (`apps/web`) | 570 pass, 0 fail. `packages/data`: 164 pass. |
| `tsc --noEmit`, lint | Clean; lint 0 errors (2 warnings, both in code older than this plan: an unused import in `appSearch.ts` and one in `scripts/trace-brand.mjs`). |
| Playwright, all projects (dev servers on 3100/3101/3102) | 999 passed, 2 skipped, 3 flaky, 1 failed. The failure is `frame-loops` StatCounter, a known noisy test that passes alone. Two of the flakes (a 503 on a download) were a real race in the dev file storage when parallel workers re-seeded it: fixed (atomic writes), then 37/37 on two repeat runs. The other is `smooth-scroll` "Back from an anchor" (first-compile timing). |
| Production build and `test:prod-smoke` (3200), library-enabled spec (3201, `LIBRARY_ENABLED=true LIBRARY_PHASE=live`) | 59 passed + 11 passed. New: LearnThrive AI and voice routes answer 503, the page is a 404, a cross-site post is a 403. |
| Storybook build | Passes. It had broken on the way: the pricing card pulled in `node:crypto` through the consent hash; the hash now lives in a server-only module. |
| Model benchmark (`docs/ASSISTANT_BENCHMARK.md`) | Default `qwen3.5:9b`: first token 0.31 s (target for voice: under 1.0 s), 54 tokens/s, 5.6 GB of the 8 GB GPU, 100% of the safety prompts held by the model alone. `gemma3:4b` and `qwen3-vl:8b-instruct` answer more questions correctly (95% on the rubric) but hold only 60% and 70% of the safety prompts on their own, so they are not the default. `qwen3.8:27b` is a quality ceiling only (does not fit: 4 tokens/s). |
| Voice latency target: end of speech to first audio, median under 2.5 s (`docs/VOICE_BENCHMARK.md`) | **0.9 s** with the recogniser on the GPU (`small.en`, 1.8% word error), **1.6 s** on the CPU (`base.en`, 4.6%). Parts: recognition 0.15 / 0.59 s (target 0.7), first model token 0.35 s (target 1.0), first speech clip 0.16 / 0.20 s (target 0.5). Synthetic speech only. |
| Public pages: no change in behaviour or performance | **Not fully met, see below.** |

### Open finding: shared JavaScript on the public pages grew about 6%

The motion profile against the Phase A baseline (`plan19-baseline` to `plan19-after`) shows gzip JavaScript on `/` and `/subjects` up from 298.5 to 317.1 KB and from 296.5 to 315.2 KB (desktop; about +19 KB), and CSS up 1.4 KB, with no change in DOM size beyond 7 nodes. I built the main commit in a scratch copy and compared its home page with this branch's: 270.8 KB against 287.0 KB over 20 and 21 chunks (+16 KB, one more chunk). **I did not find the cause.** What I ruled out: the footer and page links to `/library` (setting `prefetch={false}` changed nothing, and was reverted), any framework or React change (none), and any LearnThrive AI, KaTeX, voice or billing code in the home page's chunks. The source changes that touch public pages are small (a footer link, two sentences, a `SmoothScroll` condition, a `password` type on a form field). The remaining suspects are shared chunk splitting changing because the app now has many more routes, and the Library link in the footer changing what the bundler groups. Frame timings at 1x CPU are noisy in this environment (p95 values jump between 6 and 12 ms because of refresh-rate quantisation), and LCP moved by tens of milliseconds either way, so I would not read the timing deltas as real. **Someone should bisect the extra chunk before the Library opens to the public** (build each commit from `ad73b76` on and compare the home page's chunk list), or confirm it by a bundle analyser.

## Owner approvals needed before anything opens

1. **Legal and privacy**: privacy page, cookie page, subscription terms and content licence, consumer-rights and refund wording, VAT status from the accountant, the express-consent wording. Drafts are in `apps/web/LEGAL_REVIEW.md` (accounts and billing; LearnThrive AI, uploads and voice) and `/library/terms` (404 in production until `LIBRARY_TERMS_APPROVED=true`).
2. **Prices, plan names, free-sample selection, the minimum catalogue per subject** (`LIBRARY_PRICE_*`, `LIBRARY_MIN_PER_SUBJECT`, `LIBRARY_REQUIRED_SUBJECTS`): none are set, so billing stays closed.
3. **Stripe**: account, products and prices, webhook, Stripe Tax decision, the steps in `docs/BILLING.md`.
4. **Safeguarding** (Tahasin Hasan, with Abdurrahman Mustafa as second contact): approve in writing the system prompt, the blocked-category and safeguarding texts, the moderation rules, the flag email and what is done with it. A DPIA, the ICO Children's Code review and an Online Safety Act check are still to be done.
5. **A production AI provider** (data processing agreement, no training on inputs, retention, UK-GDPR-compatible location) and a **production speech provider**. Neither exists; voice is closed in production in code until one is chosen.
6. **Licences**: `piper-tts` is GPL-3.0 and the Kokoro option pulls in more GPL parts. Fine as a separate development tool; needs advice before any production use (`apps/web/THIRD_PARTY_NOTICES.md`).
7. **Retention periods** (chat text 30 days, uploads 7 days, download audit) and **who reads safeguarding flags and for how long**.
8. **Piper voice** by ear. I could not listen; the choice among the three voices is the owner's.

## Defaults chosen on the owner's behalf (each can be reversed)

Downloads: 60 an hour per account. Chat text kept 30 days after the last message; uploads 7 days. Assistant caps: 40 messages a day, 6 a minute, hosted token budget 40,000 a day, one answer generated at a time. One all-access plan with monthly and annual prices. Entitlement: active or trialing plus 3 days' grace, past due until the paid-to date, cancelled until the period end, refunded or unpaid none. Webhook event ids kept for the idempotency window set in the migration. LearnThrive AI menu entry only when the assistant is open. Adults only until `ASSISTANT_MINORS_APPROVED`. Voice: push-to-talk only; recording capped at 59 seconds; 120 transcriptions and 600 speech clips an hour per family; the sidecar picks `small.en` on the GPU if CUDA loads, `base.en` on the CPU otherwise.

## Deviations from the plan

- Downloads are sent by the server with the watermark applied, not through a signed storage URL.
- The Content Security Policy allows Stripe's hosts in `form-action` only when billing is live (Chromium enforces `form-action` across redirects; measured).
- The catalogue sits after the overview sections on the Library page.
- PDF text extraction for uploads is best effort without a heavy dependency; scanned PDFs use their embedded images.
- Voice sends one WAV per utterance (no chunk streaming), has no hands-free mode, and uses `/api/assistant/voice/transcribe` and `/speak` instead of one route.
- Phase H not built (above).

## What could not be tested

Real Supabase (Auth emails, Storage, the pooler, the `postgres` driver against a real server: arrays, timestamps and bigints were reasoned and PGlite-tested only); real Stripe (checkout, portal, webhook signing against Stripe's own events, API versions, Stripe Tax); Render; real devices, Safari and Firefox (AudioWorklet and microphone behaviour differ), real screen readers and switch access; a real microphone and a child's voice; a production AI provider; handwriting (the vision set is typed text); the safeguarding email to a real mailbox. No Docker, Supabase CLI or `psql` was available.

## Reproduce

```bash
cd apps/web
npm test && npx tsc --noEmit -p . && npx eslint .
npx playwright test                                   # starts the dev servers on 3100, 3101 and 3102
npm run build && NODE_ENV=production npx next start -p 3200   # then, in another terminal:
npm run test:prod-smoke
LIBRARY_ENABLED=true LIBRARY_PHASE=live NODE_ENV=production npx next start -p 3201   # and
LIBRARY_ENABLED_BASE_URL=http://localhost:3201 npm run test:prod-smoke -- tests-prod/library-enabled.spec.ts
npm run build-storybook
MSYS_NO_PATHCONV=1 node scripts/profile-motion.mjs --label plan19-after --routes /,/subjects --runs 3
node scripts/compare-motion-profiles.mjs artifacts/motion-profile/plan19-baseline.json artifacts/motion-profile/plan19-after.json
cd ../../packages/data && npm test
# benchmarks (Ollama and, for voice, services/voice set up as in docs/VOICE.md)
cd ../../apps/web && npm run assistant:bench -- --models qwen3.5:9b,gemma3:4b,qwen3-vl:8b-instruct --ceiling qwen3.8:27b --guard llama-guard3:1b
npm run voice:bench -- --stt base.en/cpu,small.en/cuda
```

Guides: `docs/LIBRARY.md`, `docs/BILLING.md`, `docs/ASSISTANT.md`, `docs/VOICE.md`, `docs/AUTHENTICATION.md`, `docs/SUPABASE_MIGRATION.md`, `docs/DEPLOYMENT.md` (every variable), `docs/RETENTION_AND_DELETION.md`.
