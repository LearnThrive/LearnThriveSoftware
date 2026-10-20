# LearnThrive Library, Subscriptions, Study Buddy (AI) and Voice Mode — Implementation Prompt (repo-specific, v1)

This replaces the earlier plan19 (OpenUI evaluation), which the owner dropped.

You are working in `D:\LearnThriveSoftware`, the LearnThrive Tuition final site (Next.js 16.3, React 19.3, TypeScript 6, monorepo: `apps/web`, `apps/classroom`, `apps/realtime`, `packages/data`, `packages/shared`, `packages/realtime`). Read `CLAUDE.md` first: use `graphify query` before raw browsing, and run `graphify update .` after changing code. Hosting is Render.

## 0. What the owner wants

- A **Library** of company-made worksheets, exam-style papers, mark schemes and notes. Enrolled students get it included. Anyone else can pay a subscription for all of it. A public information page about the Library and its subscription goes live early, before any backend exists (Phase B2).
- A **Study Buddy**: an AI assistant where students can ask for help and upload their work. During development it runs on the owner's local Ollama, and optionally on NVIDIA NIM. Claude Code chooses models by benchmarking on the owner's machine.
- A **voice mode** so a student can speak to the assistant.
- The UI components in `D:\LearnThriveSoftware\UI Components` implemented into the site (section 7).

## 1. Read this before building: five facts that change the plan

- **Accounts and a database are required.** A subscription cannot exist without sign-in and persistence. Today the signed-in portal is closed in production (`lib/portal.ts`, the development auth provider throws under `NODE_ENV=production`, data is in memory, Supabase is "future" in `docs/SUPABASE_MIGRATION.md`). So this plan includes the minimum real backend (Supabase Auth, Postgres, Storage) behind new repositories in `packages/data`, and a controlled way to open only the library and account routes while dashboards and classroom stay closed.
- **NVIDIA's free NIM API is a trial, not a production service.** NVIDIA describes the API catalog as a trial experience for evaluation and prototyping, with request limits that vary by model (commonly reported as 40 requests per minute). Production needs paid access or self-hosted NIM. Use NIM only for development and benchmarking, with synthetic data, never with real student content or uploads, and never as the production provider.
- **The owner's local Ollama cannot serve the production site on Render.** Production needs its own provider decision (a paid hosted model under a data processing agreement, or a self-hosted GPU). The assistant is built behind a provider interface and stays switched off in production until section 6 is complete.
- **Children are the audience.** The assistant and voice mode must not go to anyone under 18 until the safeguarding design, a DPIA and the safeguarding lead's approval are done (section 6). Treat that as a hard gate, not a polish item.
- **Pricing and VAT are owner and accountant decisions.** Do not invent prices. A digital subscription is not covered by the tuition VAT exemption the business may rely on for lessons.

## 2. Repo and machine facts (verify each; record any that are wrong)

- The working tree is dirty (about 180 changed files on `feature/careers`: careers, safeguarding reconfirmation, subject requests). Do not touch, revert, format or commit any of it. Work in a separate worktree from the last committed `main`, for example `git worktree add ../LearnThriveSoftware-library -b feature/library main`, and record the commit it started from.
- Reusable pieces from the careers work live in `apps/web/src/lib` (`human-check*.ts`, `rate-limit.ts`, `email.ts`, `careers-files*.ts` for file-type checking). If they are not yet in `main`, build against small interfaces and note the dependency. Do not copy-paste.
- Existing security: Content Security Policy in `lib/securityHeaders.ts` has `connect-src 'self'` (plus classroom sockets), `media-src 'self' blob:`, `img-src 'self' data: blob:`, `form-action 'self'`; Permissions-Policy already allows `camera=(self), microphone=(self)`. Public marketing pages set no cookies and use no browser storage, and the cookie and privacy pages say so. Signed-in pages will need strictly necessary session cookies; the public pages must stay cookie-free.
- Domain model: Tutor, Client (parent), Student, ClientStudentLink, TuitionAssignment (`docs/DOMAIN_MODEL.md`). Repositories in `packages/data` with an in-memory provider. Extend that pattern.
- Tests: `npm test` (node --test), `test:browser` (axe), `test:e2e` and `test:prod-smoke` (Playwright), Storybook 10. No Tailwind in `apps/web`.
- Owner's machine (checked 20 October 2026): NVIDIA GeForce RTX 3070 Laptop GPU with 8 GB VRAM, 63 GB RAM, AMD Ryzen 7 5800H (8 cores, 16 threads), about 878 GB free on D:, Node 26.10, Python 3.14.7, ffmpeg on PATH, Ollama 0.35.0 running with `qwen3.5:9b` (6.1 GB), `qwen3.8:27b` and `qwen3.8-27b-32k` (16.5 GB each, larger than VRAM, so they run partly on CPU and will be slow) and `mxbai-embed-large` (embeddings). Python 3.14 may lack wheels for speech libraries; use a separate Python 3.12 or 3.13 environment (uv or venv) for any sidecar, and record it.

## 3. Decisions already made (do not re-litigate; deviate only with measured evidence in the report)

- Library content is company-authored. Past papers from exam boards are not redistributed. Every resource carries an `authorship` field and the import script refuses a resource without it.
- Access is decided in one server function, `canAccess(account, resource)`, never in the UI. A person has access if they are enrolled (an active TuitionAssignment on their family account), or have an active paid subscription, or hold an admin grant, or the resource is a free sample. Enrolled access is included free.
- The billing account holder is an adult (18 or over). Students under 18 use a profile under a parent account and need no email of their own. Adults who are not parents can hold their own account.
- Payments: Stripe Billing with hosted Checkout and the hosted Customer Portal, in GBP. No Stripe.js on the site, so there is no new third-party script and the Content Security Policy stays as it is. Webhooks are signature-verified and idempotent. The owner sets prices in Stripe; code reads Stripe price IDs from configuration. No free trial at launch (free samples instead).
- Files live in a private storage bucket and are delivered only through short-lived signed URLs issued after `canAccess`. Every PDF download is watermarked with the downloader's name and a timestamp. Public pages list titles and descriptions only; file URLs are never public, except free samples.
- Assistant access: subscribers and enrolled students only, signed in. Not available to anonymous visitors.
- Provider interface for the assistant and for speech, selected by environment variables, with these implementations: `ollama` (local), `nim` (NVIDIA, development only), and a production slot left open (section 6). The assistant is off in production by default.
- Voice mode is push-to-talk first. Audio is never stored and never sent to a third party unless the production provider gate (section 6) is passed. The browser's built-in speech recognition is not used by default, because some browsers send that audio to the browser vendor.
- No "remember me" persistent login option and no social login enabled by default. Google or Apple sign-in appears only if the owner configures it and the privacy and cookie pages are updated first.
- Secrets (`NVIDIA_API_KEY`, Stripe keys, Supabase keys) live only in environment variables, never in the repo, logs or reports. Add them to `.env.example` without values. Never print a key.
- All new third-party packages are pinned to exact versions, justified in the report, and installed with scripts disabled unless needed.

## 4. Phases (each phase ends with green checks; stop and fix at each gate)

### Phase A — Baseline and worktree
Record `npm run lint`, `typecheck`, `npm test`, `npm run build`, route bundle sizes and Web Vitals for the home and subjects pages. Nothing in this plan may increase initial JavaScript or worsen Largest Contentful Paint or layout shift on any existing public route; all new code is in new routes or lazy chunks.

### Phase B — UI components (no backend; ships first)
Convert the nine files in `UI Components` as described in section 7, behind a dev-only route `/dev/ui-components` (404 in production) with Storybook stories. Pass axe, keyboard, reduced-motion and dark-mode checks before moving on.

### Phase B2 — Public Library and pricing information pages (no backend; can ship early)

The subscription cannot take payments until Supabase and Stripe exist, but the owner wants the information pages now. Build them so they work with no database, no sign-in and no Stripe, in the same way as the subject request and careers forms.

- Routes: `/library` (overview) and `/pricing` (plans), both public, static-friendly, cookie-free, in the marketing layout and design language. A flag, `LIBRARY_PHASE` (`info`, `enrolled`, `live`), controls what they show; default `info`.
- `/library` content, using only facts the owner has confirmed (and nothing else): what the Library is (company-made worksheets, exam-style papers, mark schemes and notes); that it is included for enrolled students; who can subscribe; the subjects and levels (Maths, English, Science and 11+, KS2 to A Level); how it will work (sign in, browse, download); a short FAQ in the existing accordion; and a clear "Coming soon" label. No document counts, no "thousands of resources", no claims about quality, results or exam-board alignment, and no sample previews unless the owner supplies real free samples. If samples exist, show two or three real previews.
- `/pricing`: the converted `PricingCard` in a "Coming soon" state. Show a price only if the owner has set one in configuration; otherwise show "Price announced at launch". No invented plan names, discounts or trial. The card's button reads "Join the waitlist" and scrolls to the form below. A short, honest note: terms, price, renewal and cancellation details will be shown in full before anyone pays. No payment, pre-order or deposit of any kind.
- Waitlist form: email address only, plus a separate unticked consent box ("Email me once when the Library launches"). Same pattern as the subject request form: human check, honeypot, minimum time, origin check and rate limit, a route at `/api/library-waitlist` that emails the owners (and a short confirmation to the person), nothing stored. Retention: kept in the mailbox until the launch email has been sent or 12 months, whichever is sooner, and deleted on request. Include a no-JavaScript email fallback and an unsubscribe line in the confirmation. The launch email is a single, one-off message to people who ticked the box.
- Navigation: add Library to the footer, link it from the subjects page and the home page where it reads naturally, and add it to the header only if the owner asks. Add both pages to the sitemap.
- No structured data for products or offers until the plans are live. No analytics.
- Privacy and legal: add the waitlist to the privacy page and to `LEGAL_REVIEW.md` using its future-change gate. The cookies page stays accurate (no cookies or storage). The owners approve all copy.
- Reuse the human-check, rate-limit and email helpers from the careers work through small interfaces; do not copy-paste.
- Tests: route tests (success, honeypot, too fast, bad origin, rate limit, human check missing, consent unticked, missing configuration, email mocked); browser checks for both pages (axe clean, no horizontal overflow at 360 px, no cookies, no storage, no third-party requests, no-JavaScript fallback); Storybook stories for the coming-soon pricing card state.
- When Phase E is complete, `/pricing` becomes the live page: the same card, with the button starting checkout and the full subscription disclosures shown. Nothing here should need rebuilding.

### Phase C — Backend foundations
- Supabase project settings documented, not created by you. Provide SQL migrations (`supabase/migrations`) and local development via the Supabase CLI. Tables: profiles, family accounts and student profiles (mapped to the existing domain model), `resources`, `resource_files`, `subscriptions`, `entitlements`, `download_events`, `consents`, `chat_sessions`, `chat_messages`, `chat_files`, `usage_counters`. Row-level security on every table; write tests that prove a user cannot read another family's rows.
- Auth: email and password plus password reset, email verification required, sensible lockout and rate limits, session cookies httpOnly, Secure, SameSite=Lax. Implement behind the existing auth abstraction so the development provider still works locally and in tests.
- Route carve-out: a new flag (for example `LIBRARY_ENABLED`) opens `/login`, `/account`, `/library` and the new API routes in production while the dashboards and classroom stay closed. Update the proxy rules and tests for exactly that and nothing else.
- Repositories in `packages/data` for the new entities with in-memory implementations for tests and development, and Supabase implementations for production. Follow `docs/SUPABASE_MIGRATION.md` and update it.

### Phase D — Library, enrolled access first
- Content model: subject, level (KS2, KS3, GCSE, A Level, 11+), exam board (where relevant), topic, type (worksheet, exam paper, mark scheme, notes), year group, tags, version, access tier (free sample, members), authorship, published date.
- Import tool `scripts/library-import.mjs`: reads a folder of PDFs plus a metadata file, validates every file with the existing file-checking code (real file type, size, no scripts), uploads to private storage and upserts rows. No admin UI in this plan.
- Pages: `/library` becomes the public catalogue (browse and search with filters, Postgres full-text search) while keeping the Phase B2 overview content above it, plus subject and topic pages, resource detail pages (public listing, gated download), and a small free-samples area. Server-rendered, accessible, using the site's design language and tokens.
- Download route: checks `canAccess`, applies the watermark, records a counter-only audit row, enforces a rate limit (default 60 downloads per hour per account, configurable) and a signed URL lifetime of 60 seconds. Terms forbid sharing and resale; add anomaly flags to the log, not DRM.
- Ship this stage to enrolled students only (no payments yet) as the first real test of auth, storage and entitlements.

### Phase E — Subscriptions and billing
- Pages: `/pricing` (the Phase B2 page, now live: the converted pricing card's button starts checkout and the full subscription disclosures are shown), `/account` (plan, renewal date, invoices link, cancel via the Stripe Customer Portal), checkout success and cancel pages.
- Routes: create-checkout (server-side redirect to Stripe), create-portal-session, webhook (signature check, idempotency keys, handles checkout completed, subscription updated and deleted, invoice paid and payment failed, refunds). Entitlements are derived from Stripe state; the database mirrors it and Stripe stays the source of truth. A reconciliation script re-syncs entitlements.
- Consumer law, built in from day one regardless of when the new subscription rules start (sources disagree: spring 2027 versus January 2027; check GOV.UK before launch): clear price including VAT if registered, billing period and automatic renewal shown before payment, easy cancellation online, renewal reminder emails, no pre-ticked boxes, an express consent and acknowledgement at checkout that digital content starts immediately and the 14-day cancellation right is lost once access begins (the wording needs legal review), refunds policy, and no drip pricing.
- Emails (Resend): welcome, receipt link, payment failed, renewal reminder, cancellation confirmation. Hand-built and escaped.
- Content readiness gate: do not switch on paid sign-up until each subject has a minimum catalogue the owners agree. Record the counts in the report.

### Phase F — Study Buddy (text and uploads), development only
Section 5.

### Phase G — Voice mode
Section 6 explains the gates; the build is in section 5.4.

### Phase H — Optional: answers grounded in the Library
Embeddings (the existing `mxbai-embed-large` works locally) stored with pgvector, built at import time. Retrieval is filtered by the user's entitlement so the assistant can never reveal members-only content to someone without access, and it quotes only short extracts. Ship only if Phases F and G pass their gates.

### Phase I — Hardening, accessibility, deployment notes
Final checks, Render environment documentation (all variables), runbook for deletion and retention, a launch checklist. Do not deploy anything.

## 5. Study Buddy and voice: design

### 5.1 Provider interface
`ChatProvider` with `stream(messages, options)`, capabilities (vision, json mode, tool use, max context), health check and timeouts, configured by `ASSISTANT_PROVIDER`, `ASSISTANT_MODEL`, `ASSISTANT_VISION_MODEL`, `ASSISTANT_BASE_URL`. Implementations: Ollama (use the native API or its OpenAI-compatible endpoint; read each model's capabilities from `ollama show` and the API instead of assuming; turn thinking mode off for latency where the model supports it; set the context size explicitly) and NVIDIA NIM (`https://integrate.api.nvidia.com/v1`, OpenAI-compatible, key from `NVIDIA_API_KEY`, backoff on rate-limit errors, development only). Allow an ordered fallback chain for development (for example Ollama then NIM), each step with its own timeout. Production uses a separate configured provider and the assistant refuses to start in production without one and without `ASSISTANT_PRODUCTION_APPROVED=true`.

### 5.2 Choosing the models (Claude Code decides, with evidence)
Build `scripts/assistant-bench.mjs`, which writes `docs/ASSISTANT_BENCHMARK.md` with the machine specification and results.

- Budget: the 8 GB GPU. Keep model weights plus context cache under about 7 GB so the desktop and the speech models have headroom. Anything larger is judged as a quality ceiling only, not for interactive use.
- Candidates: the already installed `qwen3.5:9b`; the larger Qwen models as quality ceilings (partial CPU offload); and up to three further models that fit the budget, chosen after checking the current Ollama library for text and vision models. You may pull at most three extra models with a combined size under 20 GB; list them and why. Include one small safety classifier if a suitable one exists in the Ollama library or NIM catalogue. Include NIM-hosted models for comparison (development only, synthetic prompts only).
- Evaluation set (store fixtures under `apps/web/tests/fixtures/assistant/`, synthetic only): UK-curriculum maths, English and science questions across KS2 to A Level and 11+ with a marking rubric; hints-first behaviour; refusal to complete assessed coursework; explanation quality; photographed handwritten working (for vision models); jailbreak and prompt-injection attempts; safeguarding disclosures; off-topic and adult content; maths notation.
- Measure per model: time to first token, tokens per second, total latency at median and 95th percentile, VRAM and RAM use, quality score against the rubric (a larger local model may act as judge; record that), safety pass rate, vision accuracy on the photo set.
- Decide: a default text model, a default vision model (may be the same), the context size and generation settings. Record the decision, the margins and what would change it.

### 5.3 Study Buddy behaviour and safety
- System prompt (owner-approved) says it is an AI helper, not a tutor or a person, and may be wrong. UK English, patient and plain. Hints first and a working-through approach; will not simply produce answers to assessed coursework; stays inside the offered subjects; no medical, welfare or personal advice; never asks for or stores personal details; tells users not to type names, school or addresses.
- Input and output moderation (a small classifier or rules plus the model's own refusals). Static, owner-approved responses for blocked categories.
- Safeguarding: messages indicating harm, abuse, self-harm or being unsafe trigger an immediate static supportive response that signposts to 999 in an emergency and to Childline and the NSPCC (verify the numbers and names against the official sites before publishing), and create a flag for the safeguarding lead with only the minimum necessary excerpt and an account reference. The process, the lawful basis and who sees what must be agreed by the safeguarding lead and reviewed legally before any minor uses the assistant (section 6). Build the mechanism; keep it disabled for minors until approved.
- Uploads: images (JPEG, PNG; HEIC converted or rejected with a friendly message) and PDFs; real-type checks reusing the careers file-checking code; size and page limits (defaults: 8 MB per image, 15 MB per PDF, 20 pages, three files per message); EXIF stripped; PDF text extracted, scans passed to the vision model; uploads deleted after 7 days or when the user deletes the chat, whichever is first; never used for training.
- Maths: render LaTeX with KaTeX and Markdown with sanitisation, lazy-loaded; a safe Markdown renderer with no raw HTML.
- Limits: per-user daily and per-minute caps, a queue (one local GPU), maximum input and output tokens, a kill switch (`ASSISTANT_ENABLED`) and a cost cap for hosted providers. Logging is counters only. Never log messages, uploads or audio.
- Retention (defaults, owner to confirm): chat text 30 days, then deleted; user-controlled deletion of a chat or all chats; export on request; deleting an account deletes its chats and uploads.
- UX: streaming with a stop button, labelled "AI-generated, may be wrong", copy, start a new chat, a visible delete control, accessible live region for streamed text. Place it at `/library/study-buddy` (signed in, flag-controlled), not as a floating widget on the marketing pages.

### 5.4 Voice mode pipeline (Claude Code decides, with evidence)
Interface: `SpeechToText` and `TextToSpeech` providers behind the same configuration style. Push-to-talk first; optional hands-free voice activity detection later if it benchmarks well.

- Capture in the browser with an AudioWorklet, resample to 16 kHz mono and send WAV chunks to the server, so no server-side ffmpeg is needed. Stop playback the moment the student starts speaking.
- Local development speech service: a small sidecar under `services/voice` (separate Python 3.12 or 3.13 environment, started by a script) exposing HTTP endpoints that the Next route proxies; the browser only talks to `/api/assistant/voice`, so the Content Security Policy is unchanged.
- Candidates to benchmark for speech recognition: faster-whisper and whisper.cpp (CPU and CUDA builds, `base.en`, `small.en`, a larger multilingual model if it pays off, int8 and float16), plus NVIDIA's hosted speech models in the NIM catalogue for development comparison only. Candidates for speech output: Piper (British English voices), Kokoro, and the browser's own `speechSynthesis` (runs on the device, no data leaves it) as the baseline and fallback.
- Constraints: keep VRAM free for the language model; speech recognition on CPU is acceptable if latency targets are met. Maths speech matters: test recognition of "x squared", "quadratic", "denominator", "photosynthesis", and have voice mode answer in speech-friendly wording (no LaTeX read aloud; the screen still shows the notation).
- Latency target on the owner's machine: end of speech to first audio median under 2.5 seconds (speech recognition under 0.7 s, first model token under 1.0 s, first audio chunk under 0.5 s using sentence-chunked speech output). Record actuals.
- Add `scripts/voice-bench.mjs` and `docs/VOICE_BENCHMARK.md` with word-error rate on a small set of recorded phrases (the owner records them; if none exist, generate a clearly labelled synthetic set and say so), real-time factor, memory use and the chosen configuration.
- Privacy and UX: ask for microphone permission only when the student presses the mic, show a visible "listening" state, never store audio, show the transcript so the student can correct it before sending, work with reduced motion, and provide a full text fallback.

## 6. Gates before any production exposure (all must be complete and recorded)

- **Legal and privacy for accounts and billing:** privacy page (Supabase, Stripe, email provider), cookie page (strictly necessary session cookies only after sign-in; public pages remain cookie-free), subscription terms and a content licence (no sharing or resale), consumer-rights wording, refunds, VAT treatment confirmed by the accountant, an updated `LEGAL_REVIEW.md` data-flow entry and its future-change gate.
- **AI and children:** a DPIA covering the assistant, uploads and voice; the ICO Children's Code considered point by point; the safeguarding lead (Tahasin Hasan) approves the system prompt, the blocked-category responses and the escalation process in writing; the deputy (Abdurrahman Mustafa) is named as the second contact; check whether any Online Safety Act duties apply to the service and record the answer. Until this is signed off, the assistant and voice mode stay disabled for under-18 accounts, even when everything else is live.
- **Production provider:** choose and document one. It needs a data processing agreement, clear terms on data retention, no use of inputs for training, and processing location and transfer terms compatible with UK GDPR. Record what you checked, with links and dates. NVIDIA's free NIM catalogue and the owner's local Ollama do not qualify. Voice needs its own production answer (a paid hosted speech provider under the same terms, or a self-hosted service on a GPU host). Until it exists, only the library and subscription features go live.
- **Owner approvals:** the system prompt, the blocked-category and safeguarding texts, the free-sample selection, the minimum catalogue per subject, retention periods and the pricing page copy.

## 7. UI components: how to implement the files in `UI Components`

These are Uiverse.io components (MIT licensed; attribution is appreciated, so keep the original "From Uiverse.io by …" comments and add a `docs/THIRD_PARTY_NOTICES.md` entry for each author). Leave the originals in `UI Components` untouched. Build clean React versions in `apps/web/src/components/ui/` (or the repo's existing UI folder, after checking with graphify), each with a CSS Module, tokens instead of hard-coded colours, Storybook stories and tests.

- `Chat.html` + `Chat.css` → `AiInput`: the pill input that grows on focus, with attachment buttons (take photo, add image, add file), a send button and a microphone button that opens the animated voice orb overlay. Problems in the source to fix: the voice and file toggles are hidden checkboxes with `display:none`, so they cannot be focused by keyboard (rebuild with real buttons and `aria-pressed` or `aria-expanded`); it relies on `:valid` and `required` for state; global class names (`.container`, `.c`, `.glass`, `.ai`, `.rings`) will collide with site CSS (use CSS Modules); fixed pixel sizes (300 px); hard-coded greys that fail contrast (for example #959595 on #e9e9e9); z-index 999; the orb uses several infinite animations and a heavy `backdrop-filter` (enable only on the `full` motion tier, make it static under `prefers-reduced-motion` and the lower tiers, and pause it when off-screen); text strings need replacing ("Ask Anything..." becomes a LearnThrive prompt, "Conversation Started" and "Press to cancel the conversation" become real states). Wire the buttons to real behaviour (file pickers with `accept`, camera capture on mobile, push-to-talk).
- `Radio.html` (and `Radio.css`, which despite its name contains the same HTML, not CSS) → `HubNav`: the icon menu (Home, Games, Chat, Search, Profile). There is no stylesheet for it in the folder, so write the CSS (an icon menu whose active or hovered item expands to show its label) or recreate the Uiverse style faithfully. Rename items for the signed-in area: Home, Library, Study Buddy, Search, Account (replace "Games"). Use real links in a `<nav aria-label>` with `aria-current`, labels visible on touch and keyboard focus (not hover only), the 192-pixel SVG sizes controlled by CSS, and a mobile bottom bar with a desktop side rail. Use only inside the signed-in library area, not the marketing header.
- `Login.html` + `Login.css` → `AuthCard` used on `/login` and sign-up. Fix: real `<label for>` and `id` pairs; `type="email"`, `autocomplete` values, password visibility toggle, error text tied to fields; the "Remember me" control is a radio button and persistent login is out of scope, so remove it; global selectors (`.form`, `.input`, `.p`, `.btn`, `.span`) become module classes; hard-coded blue and fonts become tokens; fixed 450 px width becomes responsive; the Google and Apple buttons only render when enabled by configuration and must follow those brands' button guidelines. Sign-up asks for adult account holder confirmation (18 or over) and links to the privacy notice and terms.
- `Sub.html` → `PricingCard`: it uses Tailwind utility classes and the repo has no Tailwind, so rebuild it with a CSS Module and tokens. Fix the "$25 /mo" placeholder (use pounds and the configured price), the "Starter" placeholder name, the `nline-flex` typo and the `aria-describedby="tier-company"` that points at nothing. The card must show price, billing period, automatic renewal, how to cancel and the cooling-off notice, with the call to action posting to the create-checkout route. Provide monthly and annual variants from configuration.
- `Pencil.html` + `Pencil.css` → `PencilLoader`: the animated pencil SVG as the loading and "thinking" indicator in the Study Buddy and library loading states. Use `useId` for the clip path id so several instances do not clash, `currentColor` and tokens for colours, `role="status"` with visually hidden text, and replace the infinite animation with a static pencil under reduced motion.
- All components work in light and dark themes, at 360 px, at 200 per cent zoom, with keyboard only, and pass axe. Add Storybook stories with their states (focused, error, loading, disabled, reduced motion).

## 8. Performance, accessibility and quality

- No increase in initial JavaScript or Largest Contentful Paint on any existing public route. Assistant, voice, KaTeX and Markdown code are lazy-loaded on the signed-in routes only. Record bundle sizes per new route.
- Axe clean on every new page and component state; keyboard-only completion of sign-up, checkout hand-off, library search and download, and a full chat; screen reader check of streamed text; reduced motion and forced colours respected; no horizontal scroll at 360 px.
- Tests: entitlement matrix (every combination of enrolled, subscribed, expired, refunded, admin grant, free sample), row-level-security tests, Stripe webhook tests with signed fixtures and duplicate-delivery tests, download route tests (no access, expired, rate limit, watermark present), file-check tests reused for uploads, provider mock tests (stream, timeout, fallback, rate-limit), moderation and safeguarding trigger tests, retention and deletion job tests, voice pipeline tests with recorded fixtures, route and kill-switch tests, Playwright journeys with a mocked auth provider. Run lint, typecheck, `npm test`, `test:browser`, `test:e2e` and `test:prod-smoke`, and keep them green. Never weaken an existing test.
- Logging counters only; no message, upload, audio or personal data in logs.

## 9. Defaults chosen on the owner's behalf (list in the report so any can be reversed)

- One all-access plan with monthly and annual billing; annual priced by the owner; no trial; free samples instead. Prices live in Stripe, never hard-coded.
- Before launch, `/library` and `/pricing` show a clear coming-soon state with no prices unless the owner supplies them, and a waitlist form that emails the owners (no database), kept until the launch email is sent or 12 months, whichever is sooner.
- Enrolment status comes from active TuitionAssignments linked to the family account, with an admin override.
- Download limit 60 per hour per account; signed URL life 60 seconds; every PDF watermarked.
- Chat text kept 30 days; uploads kept 7 days or until deleted; audio never stored.
- Assistant message caps per day set in configuration (suggested starting point 40 for subscribers and enrolled students), adjustable.
- Push-to-talk, not always-listening.
- The assistant, uploads and voice are off in production and off for under-18 accounts until section 6 is complete.

## 10. Do not

- Do not use NVIDIA's free NIM catalogue or the local Ollama for production, and do not send real student content, uploads or audio to NIM at any stage.
- Do not publish exam-board past papers or anyone else's copyrighted material in the library.
- Do not show prices, plan names, resource counts or any claim about the Library that the owner has not supplied or that is not yet true, and do not take payments, pre-orders or deposits before Phase E.
- Do not add analytics, advertising scripts, Stripe.js, cookies on public pages, or browser storage.
- Do not enable the assistant, uploads or voice for under-18 accounts before section 6 is signed off.
- Do not open the dashboards, classroom or portal in production; only the new library and account routes.
- Do not touch the uncommitted work in the main working tree, `D:\LearnThrive`, or delete anything in `UI Components`.
- Do not print, log or commit any API key or secret.

## 11. Deliverables

- Code, migrations, tests and stories for each phase, in small reviewable commits on the new branch.
- `docs/ASSISTANT_BENCHMARK.md` and `docs/VOICE_BENCHMARK.md` with the machine specification, every measured value against its target and the chosen defaults.
- `docs/LIBRARY.md` (content model, import tool, entitlement rules), `docs/BILLING.md` (Stripe setup steps for the owner, webhook events, reconciliation, test cards), `docs/ASSISTANT.md` (provider setup for Ollama and NIM, environment variables, safety design, retention) and updated `docs/SUPABASE_MIGRATION.md`, `docs/DEPLOYMENT.md` and `docs/THIRD_PARTY_NOTICES.md`.
- Updated `LEGAL_REVIEW.md`, privacy, cookie and terms drafts, flagged for owner and legal review.
- A short report listing what was built, every measured result against its target, every owner approval needed, every default chosen, what could not be tested (real Stripe live mode, real devices, Render behaviour, production provider), and the exact commands to reproduce the checks.

## Definition of done

The UI components are implemented and accessible; the public Library and pricing information pages are live in coming-soon mode with a waitlist and no backend; the library works for enrolled students end to end; subscriptions and billing work in Stripe test mode with correct entitlements, watermarked downloads and correct consumer-law wording; the Study Buddy and voice mode work locally on Ollama (with NIM as an optional development provider) with benchmark-backed model and pipeline choices; nothing from section 6 has been bypassed; no existing public page changed behaviour or performance; no new third-party scripts or public cookies exist; and every check passes.
