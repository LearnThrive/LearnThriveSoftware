# Claude Cloud handoff: Study Buddy live activity and complete answers

Prepared 26 October 2026. Continue the existing implementation; do not restart it.

## Repository and checkpoint

- Repository: https://github.com/LearnThrive/LearnThriveSoftware (the configured older `AlviHossain97` GitHub URL redirects here).
- Start from the latest `main`. Implementation checkpoint: `a0441bc` (`feat(study-buddy): checkpoint live activity panel and guarded delivery`). It was committed and successfully pushed to `origin/main` before this handoff was written.
- Original local working branch: `feature/production-completion`. Its previous tip was `a095e30`, already present on GitHub main. Main was advanced without rewriting history.
- The checkpoint preserves all substantive changes found in Claude's working tree: 27 files, 1,153 insertions and 159 deletions. Codex audited and checkpointed the implementation; it did not finish or rewrite the feature.
- 484 unrelated files differed only in CRLF/LF endings; their repository LF endings were restored. Existing content edits were preserved. A leftover `.main-wt/apps/web/node_modules` junction was excluded locally, not committed. No secrets, dependencies, build output, or local runtime files were added.
- Only the GitHub `origin` remote was pushed. The separately configured GitLab remote was not updated.

## Assessment

The main implementation is present and passes focused backend/data checks. It is a working checkpoint, not acceptance-complete. The largest outstanding work is end-to-end validation of the real chat lifecycle, tightening complete-answer delivery and failure semantics, and documenting the feature. Do not equate the passing tests below with all requirements being satisfied.

The user's full original request is included at the end of this file. It is the acceptance specification. Do not run educational-quality benchmarks; the user will evaluate answer quality manually.

## What is already implemented

| Area | Existing implementation |
| --- | --- |
| Activity events | `apps/web/src/lib/assistant/activity.ts`: typed activity records, stable step IDs, an event queue, `withActivity` to yield events during asynchronous work, sanitised source metadata, bounded serialisation and parsing. |
| Backend integration | `service.ts` extends `ChatEvent`, instruments upload reading and generation, and wraps `prepareStudy` and `reviewAnswer` in `withActivity`. `study.ts` adds classification and input-quotation checks. `research/verify.ts` instruments searches and page reads, including Crawl4AI/direct provenance. `gate.ts` records checks and repairs. |
| Answer handling | Gated drafts are withheld until review. Interrupted held drafts are no longer emitted or stored. A review exception yields `UNCHECKED_WITHHELD`. The appended `Sources read` prose was removed from `finishStudy`. Existing gate selection includes advanced STEM working as well as selected literature/history tasks. |
| Frontend | `ActivityPanel.tsx` and `activity.module.css` render progress, source links, completion/failure/stopped states, native keyboard-operable expansion, automatic collapse on completion, and reduced-motion styling. `StudyBuddy.tsx` keeps activity with the assistant message, consumes activity events, settles running steps and restores saved records. |
| Duplicate indicator | The stray footer was the `<p ref={busyRef} role="status" className={styles.busy}>` in `components/ui/AiInput.tsx`, which rendered three dots and `Thinking`. Claude removed that JSX, refs/motion hooks and its CSS, rather than hiding it. The separate old `StudyBuddy.tsx` thinking block and `.thinking` rule were also removed; the new panel is rendered inside the assistant article. |
| Persistence | Optional `activity` message metadata exists in the memory/SQL stores, is returned by `handlers.ts`, and is supported by `supabase/migrations/0016_chat_message_activity.sql`. Records are bounded to 6,000 characters. |
| Tests/demo | Ten new deterministic activity tests in `assistantActivity.test.mjs`; updated route, accuracy, data contract/schema and AiInput browser assertions. Development gallery at `/dev/ui-components/activity-panel` with pending, running, verifying, done, limited, failed, stopped and calculation fixtures. |

## Verification performed by Codex

All commands below ran on the implementation checkpoint's substantive source contents. No educational-quality benchmark or paid model evaluation was run.

1. From `apps/web`:

   ```sh
   node --test tests/assistantActivity.test.mjs tests/assistantService.test.mjs tests/assistantRoutes.test.mjs tests/studyAccuracy.test.mjs
   ```

   **PASS: 77 tests.** Includes real-time event delivery using a blocked fake search, fetched-source correspondence, no rejected-draft text, interrupted-draft withholding, cancellation and metadata sanitisation. These use scripted providers and fake search/page responses.

2. From `packages/data`:

   ```sh
   npx --no-install tsx --test src/schema.test.ts src/libraryMemory.test.ts src/librarySql.test.ts
   ```

   **PASS: 120 tests.** Includes migration application/reapplication, in-memory and PGlite contracts, activity persistence and bounds. This does not apply the migration to a live Supabase database.

3. From the repository root:

   ```sh
   npm run typecheck --workspace=apps/web
   npm run lint --workspace=apps/web
   ```

   **Typecheck passed. Lint passed with zero errors and four unused-variable warnings:** `readFileSync` in `scripts/trace-brand.mjs`, `known` in `research/claims.ts`, `AppSearchKind` in `lib/search/appSearch.ts`, and `scanPdf` in `tests/assistantService.test.mjs`. The `claims.ts` warning is in a file changed by this checkpoint.

4. Browser smoke inspection used Python Playwright with installed Microsoft Edge in headless mode against a temporary Next development server on port 3120. The default Python Playwright Chromium binary was unavailable; Edge succeeded. **Passed:**

   - The actual development gallery rendered all fixture states with no page errors.
   - Completed activity was initially collapsed; keyboard Enter expanded it, revealed two source links and collapsed it again.
   - The gallery had no horizontal page overflow at 1280px and 360px with light/dark theme attributes.
   - OS reduced motion left no infinite animations on the gallery.
   - The real `AiInput` busy fixture had no `Thinking` label or extra `p[role=status]`; Send remained disabled and the form retained `aria-busy=true`.
   - A rendered gallery screenshot was inspected. The temporary screenshot and ad-hoc script are local audit artifacts, not repository dependencies.

   **Limit:** this was component-gallery testing, not an authenticated Study Buddy conversation with live generation. It did not prove the full composer layout, one-panel-per-turn, dynamic completion collapse, interruption, conversation switching or actual DeepSeek/Step behaviour in the chat. The dedicated existing Playwright suites and production build were not run.

5. `git diff --cached --check` passed before the implementation commit. The temporary server's generated `tsconfig.json` entries were removed; the temporary server was stopped.

## Remaining work, in priority order

### 1. Make complete-answer delivery meet the specification

Confirmed by inspection: after `reviewAnswer` resolves, `service.ts` emits the answer in 240-character `delta` chunks. It then awaits `finishStudy` and may emit another text suffix. The client appends each delta immediately. Rejected drafts are protected, but a single complete final reveal after *all* checks is not guaranteed.

For gated/advanced responses, assemble the final approved text, including any necessary limitation/check suffix, before releasing it. Use a suitable final-answer event or client buffering so delivery is atomic at the UI. Keep ordinary chat streaming quickly. Add tests that cover suffix-generating checks as well as a repaired draft. Review gate coverage for source-heavy academic subjects beyond the current selected literature/history cases; do not indiscriminately gate small talk.

### 2. Correct failure/completion semantics and test them

Confirmed by inspection:

- `StudyBuddy.tsx` treats a clean `reader.read()` EOF as done unless an error was received/thrown; it does not require a terminal `done` event. A truncated connection can therefore settle the panel as completed. Track successful protocol completion and treat premature EOF as an interruption.
- `ActivityPanel.tsx` returns `Research and verification completed` when any page-read step is done, even if a verification step failed. Its `Checks completed` path likewise tests check-kind presence rather than successful check state. Make the summary reflect the actual outcome, including a failed review after a successful read.
- Restored activity in `fromApi` always uses phase `done`; evaluate whether failure/stop outcomes need persisted lifecycle metadata rather than only a step list.
- `prepareStudy` exceptions are swallowed into `study = null`, which makes `gated` false. Check that a preparation failure cannot turn a response that must be verified into unchecked streaming. A running step left by an exception can also reach `closeAll("done")` if generation otherwise succeeds.

Add targeted regression coverage before fixing these paths. Exercise Stop during search, page reading, generation and verification; disconnected streams; unavailable services; conversation switching; and model switching. Do not claim these scenarios are already browser-verified.

### 3. Complete live activity coverage

Confirmed by inspection: `searchUploads` is awaited without an activity wrapper. `runTool` and `finishStudy` can perform research/checks but are also awaited directly. Their activity can remain queued until a later drain rather than reach the browser while work runs. Inspect those paths and add actual-operation instrumentation with live draining and cancellation. Avoid invented steps.

Review source-label safety as well as clickable URLs: `ResearchSession.fetchPage` builds `Reading <hostname>` from the input URL before `safeSource` is applied to the result. Ensure blocked/internal addresses cannot appear in running or failed labels. Verify behaviour when a source URL requires a query string, since `safeSource` currently strips every query and truncates long URLs. Preserve privacy without presenting misleading or broken source links.

### 4. Finish browser and provider coverage

- `apps/web/src/app/dev/ui-components/activity-panel/page.tsx` references `tests-e2e/ui-activity-panel.spec.ts`, but that test file does not exist in this checkpoint. Add it and test actual running-to-done transitions, not only static fixtures.
- Extend actual Study Buddy browser tests to inspect a pending assistant message while a controlled backend operation is held open. Assert exactly one progress interface inside that assistant article, no footer indicator, one appropriate screen-reader announcer, and stable composer/disclaimer/privacy layout.
- Test completed expansion and restored history; errors, Stop and stream disconnects; mobile/light/dark/reduced motion; attachments, camera, voice controls, model picker and send/Stop controls.
- `A10` in `assistantActivity.test.mjs` runs two scripted mock providers; its name does not establish real DeepSeek and Step 5 coverage. Exercise both provider selections through the common pipeline with suitable mocks, and perform live smoke verification only where credentials/services are available. Do not run answer-quality benchmarks.
- Check narration leakage in the educational answer. Removing `Sources read` does not itself prevent model-written research narration.

### 5. Persistence, deployment and documentation

- Migration `0016_chat_message_activity.sql` is committed and tested in PGlite, but live application was not checked or performed. Apply/verify it through the project's normal migration workflow before using activity persistence against an existing database. SQL only omits the new column for messages without activity; researched messages need the migration.
- Add the missing Activity panel section to `docs/ASSISTANT.md` (the migration already references it). Document event lifecycle, source metadata, retention, buffering and safe failure behaviour.
- Review remaining lint warnings in touched code, run the relevant browser suites and production build, then report precisely what was verified and what still needs the user's environment.

## Practical continuation

Read repository `CLAUDE.md` and `apps/web/AGENTS.md` first. Preserve the existing LearnThrive design and safeguarding rules. Existing scripts are in the root and workspace `package.json` files. `apps/web/playwright.config.ts` defines dev/mock test servers on 3100–3103; the library-open project hosts Study Buddy on 3101. Follow its setup rather than introducing a new testing stack.

Do not treat the local audit's temporary paths, installed browser or credentials as available in Claude Cloud. Install dependencies using the lockfile in the cloud environment, use supported Node as declared in the manifests, and record unavailable live services honestly. Continue from this checkpoint, address the remaining acceptance gaps, run focused verification, and explain the original `AiInput` footer removal in the final report.

## Original user implementation prompt (verbatim)

LearnThrive Study Buddy — Live AI Activity Panel, Complete Answer Delivery and UI Cleanup
Implement a polished, ChatGPT/Claude-inspired activity experience in LearnThrive Study Buddy.
The current implementation displays generic loading states such as "Checking sources online..." and may present research narration or an appended "Sources read" section inside the answer.
Replace this with a proper, live activity timeline that communicates what Study Buddy is genuinely doing while it prepares the answer.
Additionally, fix the duplicated thinking animation currently appearing underneath the chat composer.
1. Required experience
When a student submits a question:

1. Display a compact activity panel inside the assistant's pending message.
2. Update it live using actual backend events.
3. Show meaningful actions such as question analysis, source search, webpage retrieval, document reading, evidence verification, calculation checks and answer preparation, but only when those actions genuinely occur.
4. Show the actual sources accessed, with clickable links where permitted.
5. Present short, understandable high-level process summaries where supported.
6. Keep raw model reasoning and private chain-of-thought hidden.
7. For verified and advanced responses, withhold the draft until validation completes, then reveal one complete answer.
8. Automatically collapse the completed activity panel to a compact "Research and verification completed" row.
9. Allow students to expand it again to inspect the research process and sources.
10. Keep simple conversations fast, without forcing unnecessary research or buffering.

2. Architecture
Inspect and extend the existing:

* `apps/web/src/lib/assistant/service.ts`
* `apps/web/src/lib/assistant/study.ts`
* `apps/web/src/lib/assistant/handlers.ts`
* `apps/web/src/components/study-buddy/StudyBuddy.tsx`
* Existing Study Buddy CSS modules and research components.

The current `ChatEvent` union already supports generic status events.
Extend it with structured, typed activity events rather than generating artificial progress messages.
Instrument the actual SearXNG, Crawl4AI, evidence-retrieval, verification and response-generation operations.
Ensure progress events can reach the frontend while research operations are running, rather than only after `prepareStudy` has returned.
Use a safe asynchronous progress callback or event-queue design compatible with the existing streaming transport.
Avoid blocking the event stream until the entire research phase has finished.
3. Frontend activity interface
Create a refined activity panel that follows LearnThrive's current visual language.
Use appropriate icons, subtle animations, step completion indicators and concise status labels.
Support:

* Light and dark modes.
* Desktop and mobile layouts.
* Keyboard navigation.
* Screen readers.
* Respect for reduced-motion settings.
* Responsive layouts without overflowing the chat.

Avoid excessive animations, fabricated percentages, rapidly changing statuses and unnecessary technical jargon.
The selected MiniMax M3.1 Flash or Step model should remain visible through the existing model picker and response attribution. (DeepSeek V4.1 Flash, named in the original brief, was replaced on 26 October 2026: NVIDIA lists it but it never answers.)
Do not display raw reasoning tokens from either NVIDIA model.
The panel must show verified actions and concise process information, not pretend to reveal the model's internal thoughts.
4. Remove the duplicate thinking animation below the composer
This is a mandatory UI fix based on the attached screenshot.
Currently, Study Buddy displays two separate indicators during generation:

1. A primary animation inside the assistant's message, showing text such as "Working through it...".
2. A stray secondary thinking animation directly underneath the chat composer, displaying three animated dots and the label "Thinking".

Remove the second indicator completely.
Expected behaviour
There must be only one visible AI activity indicator, located inside the assistant's message area.
All processing statuses must appear through that single activity interface.
Do not render a separate thinking indicator:

* Below the chat input.
* Inside the composer footer.
* Between the composer and the privacy notice.
* Anywhere else outside the assistant's message.

Implementation requirements
Inspect `StudyBuddy.tsx`, its CSS modules and any child components responsible for the composer and loading states.
Identify the exact JSX or component generating the secondary "Thinking" animation.
Remove the duplicate UI rendering at its source.
Do not merely hide it using CSS if its obsolete component, state or accessibility announcements would remain active.
If the same loading state drives both indicators, refactor it so that the assistant-message activity panel is the single source of visual progress.
Preserve all necessary backend progress events.
Preserve existing functionality
Do not remove or damage:

* The main assistant-message activity animation.
* The Stop generation button.
* The chat input and composer.
* The camera, image and file upload controls.
* The voice control.
* The send button.
* The existing model picker.
* The AI disclaimer.
* The Privacy link.
* Accessibility announcements.
* Cancellation behaviour.

The privacy disclaimer should remain properly positioned underneath the composer.
When the duplicate indicator is removed, ensure no unnecessary empty space remains.
The composer must not jump around or shift excessively as generation starts and stops.
Expected visual layout
While Study Buddy is working:

```
LearnThrive AI

  [Activity animation]
  Working through it...

  Searching sources...
  Verifying evidence...

-------------------------------------

           [ Stop ]

  [ Attach ] [ Ask about your work ] [ Send ]

  AI-generated answers may contain mistakes.
  Privacy
```

There must be no additional "Thinking" animation underneath the input.
After generation:

* The main activity indicator changes to its completed state.
* The final response appears.
* The Stop button disappears.
* The composer returns to its normal state.
* No orphaned spinner remains visible.

5. Complete answer delivery
For source-heavy academic questions and advanced reasoning tasks, buffer the candidate answer server-side while it is generated and verified.
Do not reveal draft text that may later be rejected or rewritten.
Only display the approved final answer after the accuracy gate has completed.
If verification fails or the request times out, use the existing safe fallback policy, clearly communicate the limitation, and do not misrepresent unchecked content as verified.
Avoid releasing a known-unverified draft merely because processing was interrupted.
Move the automatically appended "Sources read" section into structured source metadata associated with the activity panel.
Preserve useful citations in the final response.
Do not contaminate the educational answer with commentary such as "I'll now search the web" or "Let me check some quotations."
Keep the activity panel and the educational response separate in both the UI and the data model.
6. Activity state management
Use one consistent state model for the assistant's activity lifecycle.
Suggested states include:

* Pending
* Searching
* Reading
* Reasoning
* Verifying
* Generating
* Completed
* Failed
* Cancelled

Only display states for activities that actually occur.
Ensure that:

1. A new user message starts one activity session.
2. Backend events update that session.
3. The UI does not create duplicate loading indicators.
4. The activity panel survives normal component rerenders.
5. Completion clears temporary loading states.
6. Errors clear temporary loading states.
7. User cancellation stops active animations correctly.
8. Switching conversations does not leave an orphaned activity indicator.
9. Model switching does not introduce duplicate loaders.
10. The composer remains stable during the entire process.

Avoid maintaining separate competing loading states in the composer and message components.
7. Persistence and safety
Associate activity records and verified source metadata with the correct assistant message where persistence is appropriate.
Preserve privacy, student permissions, retention rules and safeguarding requirements.
Never persist private model reasoning, secrets or unnecessary raw webpage data.
Sanitise source URLs and display text.
Do not reveal internal service addresses or private search queries.
Handle cancellation, disconnected streams, failed crawls and unavailable providers cleanly.
8. Testing requirements
Run technical tests to verify:

* Activity events correspond to actual backend operations.
* Sources shown were genuinely accessed.
* No invented activity is displayed.
* The panel updates while processing.
* The complete verified answer appears once.
* No intermediate draft leaks.
* The activity panel collapses and expands correctly.
* Both MiniMax M3.1 Flash and Step 5 use the same activity interface.
* The duplicate "Thinking" animation underneath the composer is completely removed.
* Exactly one visual activity indicator appears during generation.
* No duplicate screen-reader status announcements occur.
* The composer does not leave unnecessary blank space.
* Stop and cancellation clear activity states.
* No orphaned spinner remains after completion or errors.
* Light and dark mode layouts remain correct.
* Mobile layouts work without overlapping elements.
* Existing voice, chat, document, safeguarding and tutoring features are unaffected.

Use browser-based testing to inspect the actual interface while generation is active.
Do not rely solely on code inspection or unit tests.
Capture or inspect the real rendered states to confirm that the stray indicator has disappeared.
Do not run educational-quality benchmarks. I will manually evaluate the answers.
Final instructions
Implement, test and refine this feature directly in the existing LearnThriveSoftware codebase.
The desired outcome is an AI experience where students can follow Study Buddy's actual research and verification activity inside the assistant message and then receive a clean, complete answer.
There must be no duplicate thinking animation below the chat composer.
Maintain the existing LearnThrive design language, preserve all current functionality and remove the duplicate at its source rather than relying on superficial CSS hiding.
Finish by explaining which component produced the stray animation, what was changed, and how its removal was verified.
One additional UX detail I would keep: the activity panel should remain expandable after Study Buddy finishes. That way, students can revisit which sources it consulted without having the research process clutter the actual educational answer. Implement all of this
