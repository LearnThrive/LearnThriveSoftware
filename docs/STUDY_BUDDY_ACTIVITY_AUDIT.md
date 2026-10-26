# Study Buddy activity panel: audit against the acceptance requirements

Audit of [the implementation requirements](STUDY_BUDDY_ACTIVITY_REQUIREMENTS.md), carried out 26 October 2026 on `main` at `a2099f8`.
Method: read the implementation, ran the focused test suites, the typecheck/lint gates and the project's own browser suites (Playwright, dev
servers with the mock provider), and recorded what could not be exercised here. Nothing was changed by this audit.

The historical handoff this audit was asked to read first is [CLAUDE_CLOUD_STUDY_BUDDY_HANDOFF.md](CLAUDE_CLOUD_STUDY_BUDDY_HANDOFF.md); its five
remaining-work items are re-checked at the end.

## Verdict

**Complete for the activity panel, the complete-answer delivery and the removal of the duplicate indicator: every requirement below is met in the
code and covered by tests, including the browser-level ones.** Two things keep the *whole* original prompt short of full acceptance:

1. **The live research path has never been seen in a browser here** (blocked, not an unknown defect): no Docker, so no SearXNG and no Crawl4AI.
   The activity panel's real-source behaviour — a page actually read, its clickable link, the expansion a student opens afterwards — is verified
   only against fixtures and scripted fetchers, never against a real search service.
2. **One voice-turn accessibility overlap is unverified** (see "Findings"): with the voice panel open, two polite status regions can hold words at
   once. Low severity, no test covers it, and it is a decision rather than a fault.

No other confirmed defect was found. The duplicate "Thinking" animation is gone at its source, not hidden.

## Requirement-by-requirement

### 1. Required experience

| # | Requirement | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Compact activity panel inside the assistant's pending message | Complete | The answer's own message carries it: `StudyBuddy.tsx:535` (one `activity` view per turn), rendered at `StudyBuddy.tsx:1064`, inside the assistant `article`. Browser: `study-buddy-activity.spec.ts` ("one progress interface, inside the answer") asserts exactly one `section[aria-label="What LearnThrive AI did for this answer"]`, and that it sits inside the answer article. |
| 2 | Updated live from actual backend events | Complete | `activity.ts:113` (`ActivityLog`), `activity.ts:177` (`withActivity` yields a step WHILE the work runs), consumed at `StudyBuddy.tsx:623`. Live delivery proven by `assistantActivity.test.mjs` A4 (a search step arrives while the search promise is still unresolved) and `assistantDelivery.test.mjs` D5 (same for a tool round); the bench spec moves a turn one event at a time. |
| 3 | Meaningful actions, only when they genuinely occur | Complete | Kinds are recorded only by the code doing the work: `study.ts:134` (analyse), `service.ts:378` and `:520` (upload reading/search), `research/verify.ts:205` (search), `:249` (page read), `gate.ts:211` (verify), `:212` (calculate), `:233` (repair), `service.ts:511` (write). `assistantActivity.test.mjs` A3: small talk shows no research, a calculation shows no search, and with research off no source appears; A1 asserts the exact kind sequence. |
| 4 | The actual sources accessed, with clickable links where permitted | Complete for the data and link rules; **Unverified for a real search service** | `activity.ts:96` `safeSource` (public http(s) only, no login, no fragment, tracking/search/secret parameters dropped, never cut part-way), `activity.ts:65` `publicHost`; links rendered at `ActivityPanel.tsx` with `target="_blank" rel="noopener noreferrer"`. Tests: A2 (every shown source was really fetched; a failed page is shown as failed with no link), A9, D7 (a refused page is never named), D8 (address parameters kept, tracking dropped), and the bench test that opens the list by keyboard and follows the link. **Blocked here:** the e2e servers run with no search service, so the browser runs show the honest "Sources could not be reached" state, not real links. |
| 5 | Short, understandable high-level summaries | Complete | `ActivityPanel.tsx:47` `headline`, with the words used only when true of the steps; state matrix asserted in `ui-activity-panel.spec.ts` ("every state says only what is true of its steps"): completed needs a page read and no failed check, otherwise "Sources read, but some checks could not finish" / "Research completed" / "Sources could not be reached" / "Could not finish checking". No invented percentages anywhere in the panel. |
| 6 | Raw model reasoning and chain-of-thought stay hidden | Complete | `openai.ts:14-15`: a hosted model's `reasoning_content`/`reasoning` is never yielded, stored or shown. `assistantActivity.test.mjs` A10 asserts the stored record carries no `reasoning/thinking/chain`. A step's text is fixed server-side wording (`activity.ts` `plainLabel`). |
| 7 | For verified and advanced answers, withhold the draft and reveal one complete answer | Complete | `service.ts:479-484` (held), `:633-690` (gate and repairs), `:720` a single `{ type: "delta", whole: true }` after every check, including the notes the checks add (`:693`, `:703`). `assistantDelivery.test.mjs` D1: exactly one delta, marked whole, containing the check note, stored exactly as delivered. A5: no delta ever carried the rejected draft. Browser: `study-buddy-activity.spec.ts` records every state of the answer text with a `MutationObserver` and asserts every state shown was already complete. |
| 8 | The finished panel collapses to one compact row | Complete | `ActivityPanel.tsx:76-79` folds on running → finished; bench test asserts `aria-expanded="false"` and the hidden step list after "Finish". |
| 9 | Expandable again afterwards | Complete | Same component, the student's own open state is kept; the e2e spec reopens a finished panel and, after a reload, opens the restored one again. |
| 10 | Simple conversations stay fast | Complete | Ordinary answers stream with `gated` false (`service.ts:584`, `:628`, plus the length and check suffixes at `:696` and `:711`) and hold nothing; `D2` asserts several deltas, none marked whole. Research is planned only when it should be (`study.ts` `planStudy`), and small talk records no research at all (A3). Browser: "ordinary chat is not held and not given a panel when it is over". |

### 2. Architecture

Complete. The work extends the files the prompt names — `service.ts`, `study.ts`, `handlers.ts`, `StudyBuddy.tsx` and the Study Buddy components —
with a typed contract rather than invented status strings: `activity.ts` defines `ActivityKind`, `ActivitySource`, `ActivityStep`, `ActivityEvent`
and the `ActivityLog`. Structured `activity` events are added to the `ChatEvent` union (`service.ts:65-73`), the real operations are instrumented
(SearXNG search, page fetch through Crawl4AI or direct, evidence retrieval, verification, repair, generation, upload reading), and progress reaches
the page while the work runs through `withActivity` (`activity.ts:177`) rather than after `prepareStudy` returns. The stream is never blocked on the
research phase: the turn runs inside the queue and events are drained as they are produced (`service.ts:730-760`). A4 and D5 are the regression
tests for exactly this.

### 3. Frontend activity interface

Complete, with one verification gap.

- Icons, step marks and concise labels: `ActivityPanel.tsx` (lucide icons per kind, a still dot for the running step, checks for done, alert for
  failed).
- Light and dark, desktop and mobile, keyboard, screen readers, reduced motion, no overflow: `ui-activity-panel.spec.ts` runs axe on every state in
  both colour schemes, opens the panel with Enter and closes it with Space, asserts the panel is *not* a live region, checks 360 px and 1280 px with
  everything open, and asserts nothing loops under reduced motion. `study-buddy-activity.spec.ts` repeats a subset in the real chat, at 360 px, and
  with the OS reduced-motion setting.
- One moving thing only: the ring in the panel heading (`activity.module.css`), asserted at most one infinite animation.
- No fabricated percentages, no rapidly changing statuses, no technical jargon: fixed server-side wording; the panel never shows a query, a page's
  text or an internal address.
- The selected model stays visible: the answer carries "Answered by …" (`StudyBuddy.tsx:1062`) and the picker is disabled for the duration of a turn
  (`StudyBuddy.tsx:963-975`). **Gap:** no browser assertion covers the model picker itself (its behaviour is covered by `assistantModels.test.mjs`).

### 4. The duplicate thinking animation below the composer

Complete. The stray element was the busy footer in `components/ui/AiInput.tsx` — the `<p ref={busyRef} role="status" className={styles.busy}>` line
that drew three dots and "Thinking" under the box. It was removed at its source: the JSX, its refs, its motion wiring and its CSS rule are gone
(`AiInput.tsx` has no busy-line markup and `AiInput.module.css` has no `busy` rule), and the old `StudyBuddy` thinking block and `.thinking` rule are
gone from `study-buddy.module.css` too. What remains in `AiInput` is the busy *state*, used only to disable Send and to set `aria-busy="true"` on the
form — no rendered indicator and no status region of its own.

Evidence: `ui-ai-input.spec.ts` ("busy blocks sending and shows no indicator of its own": no "Thinking" text, no `p[role="status"]`, Send disabled,
form `aria-busy`) and `study-buddy-activity.spec.ts` (no element with the text "Thinking" anywhere on the page while a turn is running or done; of
the status regions, only the page's one polite announcer has words; the panel has no `aria-live`/`role=status`/`role=alert`; at most one looping
animation in the whole page). Composer stability (the requirement that it must not jump) is asserted by comparing the box's and the disclaimer's
bounding boxes before and during a turn, to within 1 px.

One `"Thinking"` label does still exist in `AiInput.tsx:65-70` (`STATE_TEXT`) and is rendered at `:543` — but that is the voice overlay's own state
label, inside the modal voice dialog, not under the composer; it is not the removed indicator.

### 5. Complete answer delivery

Complete. The draft is buffered server-side, checked, and released once (`service.ts:720`); a failed check yields `UNCHECKED_WITHHELD` instead of the
draft (`gate.ts`), an interrupted held draft is neither sent nor stored (A6, D4, and `service.ts:822-825`), and a stop releases nothing. The
automatically appended "Sources read" prose is gone; sources live as structured metadata on the panel (`activity.ts` `ActivitySource`, persisted with
the message) and useful citations stay in the answer text. Flight-logs narration ("I'll now search the web") is not added by the server and the e2e
spec asserts the delivered answer contains none. The implementation note is in [ASSISTANT.md](ASSISTANT.md) (the "Activity panel" section).

### 6. Activity state management

Complete. One state model: per-step `running` / `done` / `failed` (`activity.ts`) plus a turn phase `running` / `done` / `failed` / `stopped`
(`ActivityPanel.tsx`), covering the suggested pending, searching, reading, reasoning, verifying, generating, completed, failed and cancelled states.
The ten required properties:

1. a new message starts one activity session — `StudyBuddy.tsx:535`; 2. backend events update it — `:623`; 3. no duplicate loaders — §4 above; 4. it
survives rerenders — updates are patched into the message by id (`:537`); 5. completion clears temporary states — `:681` `settle(...)`; 6. errors do
too — same call with `failed`; 7. Stop stops the animations — `settle(..., "stopped")` plus the browser assertions that nothing loops; 8. switching
conversations leaves no orphan — New chat is disabled while a turn runs and a new chat starts clean (both asserted in the e2e spec); 9. model switching
introduces no duplicate loader — the picker is disabled for the turn (`:963-975`); 10. the composer stays put — bounding-box assertions.

### 7. Persistence and safety

Complete in code; **live application of the migration is unverified**. Activity is stored on the assistant message itself (`migrations/0016_chat_message_activity.sql`, `serializeActivity` bounded to 6,000 characters and 24 steps, write-steps and running steps dropped), read back and re-checked
field by field (`parseActivityRecord`), returned by `handlers.ts:319-323` with `activityOutcome` when the turn did not complete, and shown by
`StudyBuddy` (`fromApi`). Because it lives with the message, retention and deletion follow the message's own rules (deleting a chat or the account
takes the activity with it). Sanitisation: A8 (hostile stored record: markup, control characters, `javascript:`, `127.0.0.1`, tokens and credentials
all stripped), A9, D7, D8. No reasoning, no secrets, no raw page text is persisted. PGlite applies and re-applies the migration in
`packages/data/src/schema.test.ts`; it has **not** been applied to a live Supabase database here.

### 8. Testing requirements

| Requirement | Evidence |
| --- | --- |
| Activity events correspond to real operations; sources were genuinely accessed | A1, A2, D7 (fixtures and scripted fetchers) |
| No invented activity | A3 (small talk, a calculation, research off) |
| The panel updates while processing | A4, D5, and the bench's event-by-event live turn |
| The complete verified answer appears once | D1, A5, and the browser MutationObserver test |
| No intermediate draft leaks | A5, A6, D4 |
| Collapses and expands correctly | Bench keyboard test, e2e reopen and restored-history test |
| MiniMax M3.1 Flash and Step 5 use the same interface | `assistantDelivery.test.mjs` D10 (both provider profiles through the common pipeline: same steps, same single delivery, no reasoning shown or stored) plus `assistantModels.test.mjs` |
| The "Thinking" line is gone; exactly one indicator | §4 evidence |
| No duplicate screen-reader announcements | Panel is not a live region; one non-empty polite region in the chat while working (voice-off case; see Findings) |
| No unnecessary blank space; composer stable | Composer bounding-box assertions |
| Stop and cancellation clear activity states; no orphaned spinner | A7, D4, e2e Stop tests, spinner counts |
| Light and dark; mobile without overlap | axe in both schemes; 360 px and 320 px layout tests |
| Existing voice, chat, document, safeguarding and tutoring features unaffected | `study-buddy.spec.ts`, `study-buddy-voice.spec.ts`, `ui-ai-input.spec.ts` — 59 browser tests, all passing |

## Commands run

All on `main` at `a2099f8`, 26 October 2026.

| Command | Result |
| --- | --- |
| `apps/web`: `node --test tests/assistantActivity.test.mjs tests/assistantDelivery.test.mjs tests/assistantService.test.mjs tests/assistantRoutes.test.mjs tests/studyAccuracy.test.mjs` | **PASS, 92 tests, 0 failures** |
| `packages/data`: `npx --no-install tsx --test src/schema.test.ts src/libraryMemory.test.ts src/librarySql.test.ts` | **PASS, 120 tests** (includes migration application/reapplication and activity persistence bounds) |
| `apps/web`: `npx tsc --noEmit` | **PASS**, no errors |
| `apps/web`: `npm run lint` | **0 errors, 4 warnings**: `readFileSync` in `scripts/trace-brand.mjs`, `question` in `src/lib/assistant/research/claims.ts:131` (a file this feature touched), `AppSearchKind` in `src/lib/search/appSearch.ts`, `scanPdf` in `tests/assistantService.test.mjs` |
| `apps/web`: `npx playwright test tests-e2e/study-buddy-activity.spec.ts tests-e2e/ui-activity-panel.spec.ts --reporter=list` | **27 passed** (12 in the real chat on the mock-provider server, 15 on the component bench). No test needed a retry. |
| `apps/web`: `npx playwright test tests-e2e/study-buddy.spec.ts tests-e2e/study-buddy-voice.spec.ts tests-e2e/ui-ai-input.spec.ts --reporter=list` | **59 passed**. No retries. |

Not run: any educational-quality benchmark (the requirements say the user judges answer quality manually), the production build (`npm run build`),
and any test that needs a real search service or a live database. The live hosted-model turns were run later, on the owner's instruction (see the hosted-model section below): Step 5 Preview answers, DeepSeek V4.1 Flash does not — and has since been replaced by MiniMax M3.1 Flash.

## Checks blocked by this environment

- **SearXNG and Crawl4AI are unavailable** (no Docker daemon): so a real search, a real page read, a real clickable source and the expansion a
  student opens afterwards could not be inspected in a browser. The e2e servers deliberately run without a search service, so the browser runs show
  the honest "Sources could not be reached" state instead.
- **Live hosted models: one works, one does not answer.** A first draft of this audit said the key was missing: that was wrong.
  `NVIDIA_API_KEY` is set in the Windows user environment and read from there (`models.ts:155-159`; only `apps/web/.env` was checked, and it holds the
  enquiry, Groq, Resend and Stripe values). With `ASSISTANT_NIM_MODELS` unset, a development server offers both MiniMax M3.1 Flash and Step 5 Preview in the
  picker. Both were then run for real with `ASSISTANT_NIM_UPLOADS=on`:
  - **Step 5 Preview works end to end.** A streamed turn with an uploaded PNG (a synthetic "42") answered `42` in 12 s in the service and 26 s in the
    browser, with the panel's "Looked at what you sent / Reading what you sent / 1 picture ready to look at" row, the stored answer, `generatedBy`
    `nim:stepfun-ai/step-5-preview`, and the hosted quota charged.
  - **DeepSeek V4.1 Flash never answers; it was replaced by MiniMax M3.1 Flash** (26 October 2026). Its id is in NVIDIA's catalogue (`GET /v1/models`, 85 models) and it was the id `models.ts` sent, but the
    endpoint emits no first chunk at all: 90 s streaming with a plain body, 300 s earlier, and both the thinking-off (`chat_template_kwargs: {thinking: false}`)
    and thinking-on request shapes. Step 5 answers in 1.0 s from the same key and the same host, so this is the provider, not the request shape, the id
    or the key. The app already fails honestly on it: `provider_error` / `timeout`, the drafting answer removed, an alert shown, nothing stored.
  - **MiniMax M3.1 Flash was verified live after taking DeepSeek's place** (26 October 2026, `minimaxai/minimax-m3.1-flash`). NVIDIA's catalogue offers it under
    that exact id; a streamed request answers in about half a second, and it names its own effort levels (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`,
    `max` — a refused value comes back as that list), so the profile passes the service's effort straight through. The real pipeline (`sendMessage`) with an
    uploaded PNG passed 10/10 checks in 2 s, and both models together passed 20/20: image in the provider's request, the "Reading what you sent / 1 picture
    ready to look at" step, the stored answer, `generatedBy = nim:minimaxai/minimax-m3.1-flash`, the hosted quota charged, and `42` read off the picture.
    In the browser (`tests` harness, dev admin): 14/14 in 2 s, attributed "Answered by MiniMax M3.1 Flash", panel row and detail correct, no alert, and the
    request carried `model=minimax-m3.1-flash` with the file id. DeepSeek no longer appears in the picker.
  - **A reasoning-effort picker was added beside the model picker** (26 October 2026). Each model offers only the levels it honours, `Auto`
    first: MiniMax all seven, Step 5 `minimal` up to `max` but not `none` (asked for none it writes its thinking into the answer). The chosen
    level travels as the request's `effort`, is refused with 400 `bad_effort` when the chosen model does not offer it, and falls back to Auto
    when a model switch leaves it unsupported. Verified live: 21/21 through the real pipeline across `xhigh`, `none` and `max` with an uploaded
    image, and 13/13 in the browser — per-model level lists, both pickers, the request body carrying `effort`, and no sideways scroll at 380 px
    (two pickers in the header had overflowed by 44 px until the phone-width header learned to wrap).
  - Answer quality is still the owner's to judge; every call spends the trial credits. Scripted-provider coverage (D10) remains what proves the two
    profiles share one pipeline.
- **No live database**, so migration `0016` is verified only in PGlite, never applied.

## Findings

1. **Confirmed, low severity — two polite live regions can hold words at once during a voice turn.** The page's one announcer
   (`StudyBuddy.tsx:1095`, fed by the first running step of each kind at `:629`) and the voice panel's own title, which is `role="status"`
   `aria-live="polite"` (`VoicePanel.tsx`) and reads "LearnThrive AI is answering…" while a turn is in flight, are both non-empty then. The
   guarantee the requirements ask for ("no duplicate screen-reader status announcements") is asserted only with voice off
   (`study-buddy-activity.spec.ts` counts `[role="status"]:not(:empty)` = 1), and the voice specs assert nothing about it. Either keep the voice
   strip out of the polite region while the assistant is answering, or add the assertion so the behaviour is chosen rather than accidental.
2. **Stale comments left behind by the removal.** `src/components/ui/AiInput.module.css:164` still heads its section "Attached files, errors, busy
   line"; `tests-e2e/ui-ai-input.spec.ts:520` still refers to "the 'Thinking' dots on the page behind the modal". Both describe a line that no longer
   exists. No behaviour depends on them.
3. **Verification gaps (no defect found).** (a) The model picker has no browser assertion anywhere, including its disabled state during a turn.
   (b) A restored *stopped* or *failed* panel is covered at the API level (`assistantRoutes.test.mjs`) and as a bench fixture, but no browser test
   reloads a chat whose turn was stopped and checks that it says "Stopped". (c) The live research path in a real browser (finding 4 above).
4. **Uncommitted local edit, not made by this audit:** the title of `docs/CLAUDE_CLOUD_STUDY_BUDDY_HANDOFF.md` reads "…live activity canand
   complete answers". It is one word in one line, left as found.

## The handoff's remaining work, re-checked

| Item | State now |
| --- | --- |
| 1. Make complete-answer delivery meet the specification | **Done.** One `whole` delta after every check, notes included (`service.ts:693-721`); D1 asserts a single delta and that the stored answer equals it; the browser test asserts no partial state was ever displayed. |
| 2. Correct failure and completion semantics | **Done.** `StudyBuddy.tsx:554-586` requires the closing event and treats a premature EOF as `INTERRUPTED`; `headline` no longer says "completed" without a successful read *and* check; a stopped or failed turn is persisted with its outcome and read back (`handlers.ts:319-323`, `assistantRoutes.test.mjs`); a preparation failure still gates the answer (D3) and a step it had started ends as `failed`, never `done` (D3b). Browser coverage: cut-off stream, server error, Stop. |
| 3. Complete live activity coverage | **Done.** Upload search wrapped and drained (`service.ts:377-388`), tool rounds and post-draft checks wrapped in `withActivity` (`:606`, `:703`), a refused page named only if public (`research/verify.ts:245-256`), and `safeSource` now keeps the query a page needs while dropping tracking, search and secret parameters (D8). |
| 4. Finish browser and provider coverage | **Mostly done.** `tests-e2e/ui-activity-panel.spec.ts` now exists and tests transitions, not only fixtures; `study-buddy-activity.spec.ts` holds a turn open with the mock's `[slow]` marker and asserts one indicator, no footer indicator, one announcer, a stable composer, expansion, restored history, errors, Stop, a cut-off stream, a phone and both colour schemes; D10 covers both hosted model profiles. Still open: the model picker assertion, a restored stopped turn in a browser. A live smoke of the hosted models has since been run: Step 5 Preview
answers with an upload, DeepSeek V4.1 Flash never answers (both recorded below); DeepSeek has since been swapped for MiniMax M3.1 Flash in the model table. |
| 5. Persistence, deployment and documentation | **Partly done.** The migration exists and is tested in PGlite; the Activity panel section is in `docs/ASSISTANT.md` (including the honest note that reading real pages was not exercised in a browser). Open: applying `0016` to a real database, the four lint warnings (one in a file this feature touched), and the production build. |

## Prioritised remaining work

1. Decide the voice-turn live-region overlap above, and add the assertion either way.
2. Run the live research path in a browser once Docker is available: search, page read, a real source link, the expansion after the answer.
3. ~~Smoke both hosted models in the real chat.~~ **Run.** Step 5 Preview passes an uploaded-image turn in the service and in the browser; DeepSeek V4.1
   Flash is dead at the provider (no first chunk in 90-300 s, from the same key that answers for Step 5). **Settled:** DeepSeek V4.1 Flash was replaced by
   **MiniMax M3.1 Flash** (`minimaxai/minimax-m3.1-flash`) on 26 October 2026 — see that model's live verification below.
4. Apply migration `0016` through the project's normal workflow, then reopen a researched chat and confirm the panel returns.
5. Close the small verification gaps: a browser assertion for the model picker, and a restored stopped/failed turn in a browser.
6. Tidy: the two stale comments and the four lint warnings; then run the production build.
