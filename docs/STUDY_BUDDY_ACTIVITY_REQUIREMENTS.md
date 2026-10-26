# Study Buddy activity panel: implementation requirements

## Instructions for Claude Cloud's completion review

Check the current implementation against every requirement in the original prompt below. Report each requirement as complete, incomplete, or unverified, with file references and test evidence. Do not assume that the earlier implementation checkpoint or passing unit tests prove completion.

Read [the implementation handoff](CLAUDE_CLOUD_STUDY_BUDDY_HANDOFF.md) for historical context and previously identified gaps, then verify the current code. Inspect the real interface in a browser while generation is active, including cancellation, errors, final-answer delivery, source expansion, and the absence of the duplicate composer indicator. Clearly distinguish confirmed defects from checks blocked by unavailable services or credentials. Do not run educational-quality benchmarks; the user will evaluate answer quality manually.

Finish with a clear completion verdict and a prioritised list of remaining work. This document records the acceptance criteria; it does not assert that the feature is complete.

## Original implementation prompt (verbatim)

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
The selected MiniMax M3.1 Flash or Step model should remain visible through the existing model picker and response attribution.
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