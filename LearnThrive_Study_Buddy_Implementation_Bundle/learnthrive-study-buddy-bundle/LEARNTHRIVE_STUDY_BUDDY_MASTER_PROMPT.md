# Claude Code master implementation prompt — LearnThrive LearnThrive AI overhaul and AI Paper Tutor

## Mission and operating rules

You are the lead full-stack engineer, product designer, accessibility engineer, document-processing engineer, AI systems architect, and test engineer working **inside the existing LearnThrive repository**.

**Implement this in priority order:** (1) diagnose and repair current PDF/image document understanding; (2) redesign LearnThrive AI and fix navigation/responsiveness; (3) make voice mode genuinely conversational without manual Send; (4) only after the previous features are working, implement AI Paper Tutor: solve uploaded GCSE papers/worksheets, annotate their original PDFs with clear handwritten-style working, and later mark students' own completed papers.

Do not produce only a proposal or a mock-up. Inspect, code, run, test in the real application, iteratively fix defects, and report verified outcomes. Do not assume any technology stack, routes, services, or libraries without checking the repository. Preserve existing authentication, content, student data, chat history, retention rules, site branding, and functioning features. Prefer small, reviewable changes and incremental commits where appropriate. No unnecessary rewrites or unrelated refactors.

If the AI assistant is still partially under construction, complete independent modules and use an integration adapter/feature flags; explicitly distinguish working features from unintegrated ones. Do not pretend unsupported models, services, or tests succeeded.

## Visual reference screenshots (included with this prompt)

Inspect these three images at the start of the task:
- `01-current-study-buddy.png`: current LearnThrive AI layout. Problems apparent include enormous title, weak visual hierarchy, isolated/floating left icon navigation with a protruding active label, lots of unused space, nested chat scrolling, bland conversation cards, repeated warning badges, and the visible PDF-processing error underneath the composer.
- `02-homepage-brand-reference.png`: **actual LearnThrive design reference**. Its visual identity uses deep navy, rich teal/green, warm cream/off-white, confident typography, polished rounded surfaces, strong hierarchy and purposeful interactive details. Extend this design language into LearnThrive AI without copying the marketing landing-page layout literally.
- `03-current-voice-mode.png`: current voice modal. Transcription appears in a large editable text box, then the student must separately press Send. The interaction is too cumbersome for voice chat and the modal consumes excessive screen space.

Screenshots show symptoms, not root causes. Inspect the live app and its source before choosing fixes. You may improve on the references, but keep the LearnThrive identity coherent. Do not use generic AI-app purple gradients or build an unrelated product.

## Phase 0 — Audit, reproduction and baseline

Before edits:
1. Locate the LearnThrive AI route/components, global and local layout CSS, navigation, chat rendering, attachment/upload system, PDF extraction/OCR/vision logic, AI provider abstractions, voice/STT/TTS implementation, auth, file storage, job handling and tests.
2. Run the application locally using repository-supported commands. Determine supported browser and deployment targets.
3. Reproduce the existing reported failures with real samples. Specifically reproduce the message equivalent to **“We could not read any text or pictures in that PDF. Please take a photo of the page instead.”** Identify at which stage it fails; don't conclude all PDFs are unsupported.
4. Record baseline screenshots and important browser console/server errors. Inspect network requests and trace uploads end-to-end.
5. Draw a brief dependency map and phased change plan in your working notes, then **start implementing**.
6. Check what the app currently promises users about chat retention (screenshot shows 30 days) and upload retention (7 days). Preserve actual policy and correct any UI mismatch rather than silently changing retention.

## Phase 1 — Fix document upload and PDF understanding FIRST (blocking defect)

The current chat appears to accept images/PDFs but can fail to read PDF content. This must be solved before building paper annotation features.

Trace and fix the entire pipeline:
- Correct frontend attachment state, submit payload, MIME/type validation, size/page-count validation, server multipart handling and authentication.
- Confirm that saved file bytes are readable by the extraction service; test file pointer/stream lifetime, buffer conversion, job-worker transfer, upload-to-model request assembly, temporary-file cleanup and race conditions.
- Distinguish **text-native PDFs** (extract embedded text, reading order and page references), **scanned/image-only PDFs** (render pages to images for vision/OCR), and **mixed PDFs** (combine extraction and visual page analysis). Do not reject valid scanned PDFs simply because the text layer is empty.
- Handle photographed worksheets (JPEG/PNG) including rotation/orientation and reasonable resizing. Preserve mathematical symbols, diagrams, tables, fractions, indices and page coordinates where possible.
- Check whether the configured vision model truly accepts images. If not, use an appropriate supported model/route or transparent fallback instead of silently feeding unusable PDFs to a text-only model.
- Maintain the association among document, page number, image, extracted text, question bounding boxes and original file. Do not concatenate pages in a way that loses location/context.
- Add clear, actionable, distinct errors for encrypted/locked PDF, malformed file, excessive size/pages, extraction failure, model failure, unsupported content and timeouts. Never show a generic 'take a photo instead' for a readable PDF.
- Prevent the AI from claiming it read unseen text or diagrams. Display low-confidence or unreadable pages with a request for a clearer upload/crop, never fabricate question content.
- Secure uploads against malicious file types, denial of service and prompt injection embedded within documents. Limit memory/CPU usage and upload processing time. Preserve privacy, student ownership, deletion and retention behaviour.
- Prefer existing libraries where adequate. Research licence compatibility before adding PyMuPDF to a commercial service; consider suitable pypdf/pypdfium2/ReportLab alternatives. Choose based on actual needs, not an arbitrary dependency list.

**Mandatory regression fixtures:** digitally produced text PDF; scan-only PDF; a PDF containing both vector text and images/diagrams; multipage GCSE maths paper with fractions; JPG/PNG worksheet; rotated image; invalid or encrypted PDF; PDF with no extractable text but clear rendered questions. Write integration tests that check what data actually reaches the assistant and verify the assistant answers a known question correctly from a PDF. If a fixture fails, do not claim the defect is fixed.

## Phase 2 — Redesign LearnThrive AI to match LearnThrive quality

Use the homepage reference as a **brand system**: navy text, teal/green primary actions, cream/off-white backgrounds, consistent borders, considered typography, elegant whitespace, subtle hover/focus/motion. Extract or reuse the site's actual design tokens and components where available.

### Navigation and overall shell
- Replace the awkward floating icon rail / protruding pill with an integrated, deliberate application navigation solution (for example a collapsible app sidebar aligned to a predictable content grid). Make the chosen solution fit the existing site's navigation conventions, not just a generic clone.
- Clear hierarchy for site navigation versus LearnThrive AI local navigation. Avoid duplicating a global nav bar and a second conflicting nav system.
- Sidebar should show meaningful labels/tooltips and clear active states; work collapsed/expanded; maintain keyboard and screen-reader access. Support mobile drawer/sheet navigation without overlay collisions. Preserve all existing links and destinations.
- Make chat history searchable/usable if supported; ensure New chat, Rename/Delete, Download chats and Delete all chats behave correctly, with confirmations on destructive actions. Avoid cramming controls together.
- Use responsive desktop/tablet/mobile layouts. Test at 1440, 1024, 768, 390 and 320 CSS pixel widths.

### Main chat interface
- The giant 'LearnThrive AI' heading currently dominates the page. Replace it with a restrained page header and a clear student-friendly introductory/empty state. Put chat content first.
- Bring conversation and composer into a coherent layout with sensible widths, spacing and hierarchy. Avoid the excessive empty left and top areas visible in the screenshot.
- Eliminate confusing **double/nested scroll** and clipped content. Use one clear scrolling chat viewport with the composer visible and no obstructed bottom messages. Support long replies and scroll-to-latest behaviour without interrupting reading older messages.
- Improve role distinction and visual treatment of student and assistant messages without oversized rounded empty cards. Keep content scannable.
- Render mathematical notation (inline and display LaTeX), Markdown, ordered calculations, images and attached-file previews correctly; test overflow of long equations and code blocks.
- Show streaming states, tool/document processing, retry/error, file attachment chips, Copy, Regenerate (if appropriate) and useful follow-up actions in a tidy way.
- Keep AI fallibility and privacy messaging but **de-duplicate badges and disclaimers**. Use a compact persistent advisory and accessible explanatory link, not repetitive visual noise in every element unless required by policy.
- Keep the assistant supportive, accurate and direct. Avoid repetitive canned praise, excessively long greetings, or automatic flattery that distracts from tutoring.
- Preserve chat-history policies and UX affordances, including what is actually deleted and when.
- Make loading, no-history, attachment failure, offline state and processing state visually finished—not placeholder text.
- Thoughtful animations only; honour `prefers-reduced-motion` and avoid layout shifts.

**Do not just modify CSS in isolation.** Inspect the running result using browser automation/screenshots; compare to the brand reference; resolve broken padding, collision, dark/light contrast, overflow, responsiveness, focus state and nested scrolling. Check chat composer when the on-screen mobile keyboard is open if tools permit.

## Phase 3 — Rebuild voice mode so talking is faster than typing

The voice interface must **automatically submit a completed utterance**, instead of requiring the student to speak, watch transcription appear in a textarea, and manually click Send.

Implement an intentional voice conversation state machine: idle → requesting microphone → listening → detecting end of utterance → finalising transcript → submitting → assistant responding → ready for next utterance; include paused/cancelled/error/permission-denied states.

**Default turn behaviour:**
1. The student activates voice chat with an explicit gesture.
2. The mic permission is requested correctly. Show a clear listening state and live transcript where supported.
3. When speech ends, detect end-of-turn via reliable supported VAD/silence detection or provider speech-final events. **Wait for the final transcript** (not unstable interim text).
4. Automatically send that final transcript once as a normal LearnThrive AI message; show it in the conversation and trigger the AI response—**no second Send click**.
5. Prevent duplicate submissions, half-word cutoffs, accidental empty sends, stale microphone sessions, unintended background recording and race conditions.
6. Make it easy to interrupt/cancel before sending, stop recording, edit unusual transcripts when needed, and switch seamlessly to typing. If confidence is poor, ask for confirmation instead of auto-sending nonsense.
7. Provide fallback turn-taking: if auto end-of-speech is unreliable on a browser/device, **tap to stop should also submit automatically**. Don't require an extra Send button. Hold-to-talk may exist as an optional interaction but should not be the only interface.
8. Clearly indicate mic active/inactive, speech recognition state, privacy, permission failure and network/provider errors. Clean up microphone tracks on close, navigation and unmount.

Where existing architecture reasonably supports it, add optional read-aloud/TTS of the assistant's response with **Mute**, **Stop speaking**, and **Interrupt** controls. If full duplex/low-latency voice would need a substantial infrastructure change, do not fake it: first ship reliable hands-free **speech → final transcript → auto-send → response**. Put continuous two-way audio behind a separate documented feature flag if it cannot be reliably delivered.

Avoid large blocking modals on desktop. Use a compact, polished voice panel and a proper mobile layout consistent with the brand, including an accessible transcript and clear controls. Follow browser media/autoplay permissions. Test real browser capabilities and automate mocked speech/permission tests where possible; report which behaviours were manually tested.

## Phase 4 — AI Paper Tutor: solve and annotate a full GCSE document

Only start this phase once document ingestion, LearnThrive AI UX/nav and core voice turn-taking pass their acceptance tests. Integrate as a native LearnThrive AI tool and optionally as a student-dashboard **Practice Papers** surface, not a separate unrelated site.

### Student flow
- Student uploads **one document/job**: a GCSE exam paper, worksheet, revision booklet, practice page or homework PDF/image; it can have multiple pages and questions.
- Select **Solve entire paper**, **Solve selected questions**, or **Help me with one question**. Provide a question-selection list after extraction and allow corrections when OCR is uncertain.
- Show honest per-stage or per-question progress through a background job, with recoverable errors and the ability to continue discussing while a long paper processes.
- Return a downloadable, securely stored PDF and an in-app preview. Preserve original document, question numbering, diagrams and pagination where possible.
- Make question-by-question structured solutions available in the assistant's context so students can ask for a hint, more explanation, alternative method, or similar practice without re-uploading or re-solving the entire paper.

### Three output modes
**A. Filled original:** insert concise blue-ink handwritten-style answers/steps into appropriate whitespace in the **original** paper. Do not overwrite printed question content or pre-existing handwriting.

**B. Full worked solutions:** provide question-numbered solution pages with clear stepwise reasoning, equations, explanations and final answers.

**C. Hybrid (default):** fill original answer regions when space is adequate, put a short answer or numbered reference where space is tight, and append detailed working on subsequent pages. Do not shrink fonts until unreadable.

All modes must label output unobtrusively as **AI-generated worked solutions** and show uncertain questions as **not confidently solved**, not as confidently correct guessed answers.

### Modular processing architecture
1. **Ingest:** reuse the fixed PDF/image extraction pipeline, track pages, coordinates and question boundaries.
2. **Understand:** parse each question, mark allocation, mathematical symbols, figures/diagrams and answer regions; keep original page/crop for vision context and confidence/uncertainty states.
3. **Solve:** use LearnThrive's existing AI provider abstraction, with **local Ollama** as an initial supported option. Prefer a configurable vision-capable model for visual extraction and a maths-reasoning model for solution generation. Choose actual available models based on tests; never hardcode unsupported version names. Support future non-Ollama providers only through existing abstractions.
4. **Structure:** require schema-validated JSON for question ID, transcription, final answer, ordered LaTeX working steps, explanation, assumptions, confidence notes and verification status. Reject or retry invalid structure in a bounded way. Never allow the model to self-certify its verification.
5. **Verify:** use deterministic checks (e.g. SymPy, substitutions, numerical checks) for supported algebra, arithmetic, fractions and equivalent expressions. Check intermediate steps where reasonable. Use extra validation strategies for questions involving diagrams or prose but never confuse model consensus with proof. Flag unsupported or uncertain results for student review.
6. **Render:** LaTeX → MathJax (or an equivalent renderer) → clean SVG/vector content → PDF-compatible layers, with handwritten-style explanation font and legible informal maths font where available and correctly licensed. Preserve crisp symbols when zoomed/printed. Do not use generative images of entire exam pages: they can change mathematics.
7. **Place:** map to page-space rectangles, avoid collisions, respect page rotation/crop box and original content, measure fit, place answer and/or overflow to appended solution page. Support A4 and common exam formats. Use safe renderer sanitisation and dependency licensing checks. Evaluate PyMuPDF AGPL/commercial terms; prefer appropriate permissive components for a proprietary site unless explicitly approved.
8. **Inspect:** render generated PDFs to images, automatically assert page count/output readability, and visually inspect a representative sample to catch clipping/overlap, incorrect coordinate transforms, missing maths and lost diagrams.
9. **Deliver:** store output and structured solutions securely, associate with student/session and original document, and provide authenticated preview/download. Enforce job limits, concurrency, retention and cleanup.

### Learning-first options
Allow progressive hints (do not reveal full answer by default when asked for a hint), a plain-English explanation in accessible GCSE language, and a walkthrough of specific steps. Don't implement an elaborate gamification system unless the existing app supports it.

## Phase 5 — Mark students' completed papers (separate reliability gate)

Build this after the solver is functional and benchmarked. Students may upload a handwritten/typed completed paper and optionally an official mark scheme.

- Extract questions and **student** writing as separate, associated regions; preserve line order and diagrams. Expose uncertain recognition for student confirmation, don't silently interpret ambiguous digits/signs.
- Independently solve the paper rather than anchoring on the student's answers.
- Compare mathematical meaning and method steps, not only final-answer equality. Recognise valid alternative methods where supported.
- **With official scheme:** follow scheme-defined method/accuracy marks and accepted equivalents where correctly parsed.
- **Without official scheme:** give provisional AI-estimated marks/rubric with explicit uncertainty. Never represent an estimated score as official GCSE marking.
- Generate feedback identifying correct method, first erroneous step, likely misconception, and concrete next practice. Allow student/teacher correction or review.
- Return annotated PDF and structured review results, with cross-links into LearnThrive AI for follow-up explanations.
- Be cautious with geometry, graph drawing, written explanations and ambiguous handwriting. Escalate/flag rather than manufacture marks.

Use a separately evaluated marking dataset with human/official references. Report agreement, false negatives (correct marked wrong), OCR extraction errors and cases requiring review. The marking phase must not delay shipping the stable solver.

## Background jobs, privacy and resilience

Reuse the existing authentication, database, file storage, AI assistant tool interface, logging and queue if suitable. Otherwise introduce the minimum reliable background-job infrastructure compatible with the repository. Provide logical equivalents of upload, extract/list questions, solve selected/all, mark, job status, retrieve solution, annotated PDF download, and assistant follow-up; follow the app's existing REST/RPC conventions instead of inventing a competing API.

Support cancellable or recoverable jobs, timeouts, retry limits, bounded concurrency, GPU/CPU limits, idempotency, student-owned files and authenticated download. Keep inference providers server-side; do **not** expose Ollama publicly. Don't silently forward student data to third-party AI services when configured for local-only inference. Apply secure retention and deletion consistent with the existing LearnThrive policy, especially for children's work.

## Testing and acceptance gates — non-negotiable

**Gate 1: PDF/document bug fixed.** Students can ask LearnThrive AI about a known question in text-native, scan-only and image-containing PDFs. The assistant demonstrably receives the correct page content. An unreadable file produces a truthful actionable error. Run these checks with actual PDFs, not only mocked parsers.

**Gate 2: UI/nav coherent.** Real screenshots at desktop/tablet/mobile show an attractive, brand-consistent LearnThrive AI experience. No giant heading, disconnected nav, clipping, unreadable math, broken active states, overlapping composer, nested-scroll confusion or broken history actions. Check accessibility/focus/contrast and `prefers-reduced-motion`.

**Gate 3: Voice auto-send works.** Speak once → final transcript → **one** automatically submitted chat message → assistant reply, with no manual Send. Test silence, pauses, denial, cancellation, double events, close/reopen, typing fallback and mobile-compatible paths. Check mic cleanup.

**Gate 4: Full-paper output works.** A multi-question, multipage GCSE maths PDF returns an original-based PDF with readable answers and overflow pages as needed. Verify algebra, fractions, simultaneous equations, a word problem and a geometry/diagram question; flag unknown or wrong answers instead of inventing confidence. Visual-inspect rendered final pages.

**Gate 5: Marking properly qualified.** Completed student work produces useful, question-specific feedback; unreadable handwriting is not automatically treated as incorrect; estimates are explicitly labelled without a scheme. Compare against human/official references before claiming accuracy.

Run project lints, typechecks, unit/integration tests, browser E2E tests (e.g. Playwright if available), accessibility checks, and production build, reporting actual outputs. Never bypass failing checks by deleting tests or suppressing errors. If browser tools are not available, add repeatable screenshots/Playwright steps and identify what remained unverified. Use at least one actual student-style maths worksheet throughout.

## Deliverables and final report

Implement the code, tests, migrations/config and docs. Provide clear instructions for running services and Ollama locally, installing any worker/runtime dependencies and verifying sample PDFs. Update developer docs and user-facing error/help messages. If a model or library is not available, give the exact blocker and a tested fallback if one exists.

At the end, report in this order:
1. **What was broken and root cause** (especially PDF processing and voice sending).
2. **What changed per phase**, with paths/PRs or commits if available.
3. **Before/after screenshots** for LearnThrive AI, navigation and voice.
4. **Demonstrated end-to-end results**, including real sample input/output PDFs.
5. **Test commands, results and measured limitations**.
6. **Remaining gaps and risks**, explicitly separating implemented, partial and unimplemented features.

**Begin by inspecting the repository and the three provided screenshots. Fix existing document support, navigation, LearnThrive AI styling and voice auto-send before starting the handwriting/PDF solution renderer. Keep working through tests and real visual verification; do not stop at an architecture plan.**
