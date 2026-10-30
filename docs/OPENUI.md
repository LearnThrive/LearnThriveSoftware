# Interactive answers (OpenUI)

LearnThrive AI can answer with a **checked, interactive interface** instead of a paragraph: a graph whose curve moves with a slider, a quiz that is marked on the page, flashcards, a process diagram, a side-by-side comparison with quotation cards, working revealed one step at a time. Beam writes the interface in [OpenUI Lang](https://www.openui.com/docs), the server checks it, and the page draws it with OpenUI's renderer using LearnThrive's own components.

This is a presentation capability inside the existing Study Buddy chat. It is not a second app, it adds no second model, and it uses only the open-source packages `@openuidev/lang-core` and `@openuidev/react-lang` (1.0.2). No OpenUI Gateway, Thesys Cloud, paid OpenUI service or other AI provider is used or needed: Beam, through Ollama Cloud, is the only model.

> **What is and is not proven.** The code, the validation, the repair path, the streaming, the drawing, the controls and the fallbacks are tested (below), with a scripted stand-in for the model. Whether **Beam writes valid interfaces reliably** has **not** been measured: there was no `OLLAMA_API_KEY` in the environment these were built in. `npm run assistant:beam-check` and `npm run assistant:openui-bench` make that measurement; run them with your key and read [OPENUI_BENCHMARK.md](OPENUI_BENCHMARK.md) before relying on it.

## How a turn works

```
student message
    |
    +-- planInterface (rules, no model): does it ask for something interactive?
    |        no  ->  an ordinary answer: Markdown + KaTeX, exactly as before
    |        yes ->  the interface path
    |
    runInterface (lib/assistant/interface.ts)
      1. Beam writes an OpenUI program        streamed to the page, drawn as it arrives, every control OFF
      2. validateInterface                    parse + size + safety + truth checks (below)
      3. not valid?  send the problems back   once (OPENUI_MAX_REPAIRS, at most 2); the draft is discarded on the page
      4. quotations -> the research layer     checks each against the real text (VERIFIED_EXACT ... UNVERIFIED)
      5. `final` event                        the checked interface replaces the draft; controls switch on; it is stored
      6. still invalid after the last repair  dropped, and the answer is given in words, saying so
```

- **Routing is not the model's call.** `lib/openui/intent.ts` decides from the message: `Quiz me…`, `flashcards`, `plot / graph y = …`, `compare A and B`, `timeline`, `diagram`, `interactively`, `revealing one step at a time`. `Explain photosynthesis` is words. `Quiz me, but just in words`, `no diagram`, `explain the graph in words` are words. Comparing two numbers is a sentence. A spoken turn and an explicit action (Paper Tutor, "look this up") never get an interface. `OPENUI_ENABLED=off` turns it off everywhere.
- **Both kinds live in one conversation.** A stored message is either plain Markdown or an interface; the history sent back to the model describes an earlier interface in one line ("LearnThrive AI showed the student an interactive interface. It said: …"), never as markers or a program.

## The stored format

An answer is an interface **only** if its content starts with OpenUI's own stored-message marker. Markdown that merely looks like a program is Markdown.

```text
]]>openui:content?library=learnthrive-study%401.0.0
root = Answer([...])
...
]]>openui:context
{ "v": 1, "verifications": [...], "sources": [...] }
]]>openui:end
```

`context` holds what the **server** checked, apart from what the model wrote: the status of each quotation and the pages that were read. It is read back defensively (`readContext`: an unknown status or a script address is dropped), so a reopened chat shows the same checked state without asking anything again. The marker is written by the server; a student's own message is stored as typed and never interpreted. See `lib/openui/format.ts`.

## The component library

One definition, two consumers: `lib/openui/schemas.ts` (zod schemas, names, descriptions; no React) is used by the server to build the prompt and the validator, and by `components/openui/library.tsx` to draw. A name that is not in the library cannot be drawn. Arguments are positional; a prop added later goes at the end with a default so a stored interface keeps drawing.

| Group | Components |
| --- | --- |
| Layout and text | `Answer` (root), `Heading`, `Text` (Markdown + `$maths$`), `Callout`, `Card`, `Tabs`/`TabPanel`, `Accordion`/`AccordionItem`, `FollowUps` |
| Data | `DataTable`, `Comparison`/`ComparisonRow`, `Timeline`/`TimelineEvent`, `Steps`/`Step`, `Checklist`, `KnowledgeOrganiser`/`OrganiserSection`, `DataChart`/`Series` (bar, line, scatter) |
| Maths | `Equation` (KaTeX), `SolutionSteps`/`SolutionStep`, `Slider`, `FunctionGraph`/`GraphFunction`/`GraphPoint`/`Param`, `NumberLine`, `Triangle`, `ProbabilityTree`/`ProbBranch`/`ProbLeaf` |
| Science | `ProcessDiagram`/`ProcessStage`, `Reaction` |
| English | `QuoteCard`, `Comparison`, `AOFeedback`/`AOItem` (labelled AI feedback, not an exam mark) |
| Revision | `Quiz`/`MultipleChoice`/`ShortAnswer`, `OpenResponse`, `Flashcards`/`Flashcard` |

Styling is LearnThrive's own tokens (`openui.module.css`): surfaces, ink, the green accent, spacing, radii and the focus ring. Nothing from `@openuidev/react-ui` is installed (it would bring its own theme, `zustand` and a chat framework); the library is defined with `@openuidev/react-lang` only.

### Where "interactive" is real

- **Graphs are drawn from formulas.** `GraphFunction("a*x^2")` is parsed by a small safe evaluator (`lib/openui/mathExpr.ts`: tokeniser, parser, allowlisted functions; no `eval`, no property access, only the variables the graph lists). The curve is **sampled from the formula**, so every point is a value the formula has; asymptotes and domain gaps break the line. A `Slider` bound to a `$variable` and a `Param` change the number and the curve is recomputed in the browser with no further request. Each graph has a "Show the values as a table" alternative and an accessible name.
- **Quizzes are marked in the page.** `lib/openui/quiz.ts` (pure, tested) separates grading from presentation: a choice is right only if it is the key; a short answer accepts a number in any usual form (`3/4`, `0.75`, `75%`, `x = 0.75`, `12 cm`) or text with case, articles and full stops ignored. A hint, "try again", a score at the end and a per-question review are built in. No request is made to any model to mark a fixed-answer question. Open written answers are **not** marked: `OpenResponse` lets the student send their answer to LearnThrive AI as an ordinary message, and the reply is labelled AI feedback.
- **Answer keys are audited.** Where a question is a plain calculation (`What is 6 × 7?`), the key is checked against the calculation before the quiz is shown; a wrong key is sent back for repair, not shown. Most questions are not plain calculations, so this catches arithmetic slips, not wrong biology. That limit is real.
- **Working is revealed step by step**, flashcards flip and count, checklists tick, tabs and accordions follow the ARIA patterns, and every control is a real, labelled, keyboard-reachable element of at least 44px.

## Validation: what must be true before a student can see an interface

`lib/openui/validate.ts`. The program is untrusted until it passes; every problem is written for the model to act on, naming the statement.

- Parses against the library with **no errors**, is **complete** (not cut off), and refers to nothing undefined. Statements defined but unused are only a note.
- **Small:** at most 20,000 characters, 300 statements, 260 components, 8 levels deep, 1,500 characters in any one string.
- **Nothing that can act:** no `Query`, no `Mutation`, no `@` call of any kind (`@OpenUrl`, `@Set`, `@Run`, `@ToAssistant`), and no markup that could run in any string (`<script>`, frames, `javascript:` addresses). `$variables` are taught only for a `Slider`'s value; anything else a program does with one is harmless, because nothing it can reach has an effect.
- **True where truth can be checked:** every formula parses, uses only `x` and its own parameters and is defined somewhere; slider ranges and steps make sense; a triangle must be possible; tables and comparisons are rectangular; chart series match their labels; probabilities add to one; a symbol equation balances (the existing chemistry checker); a quiz's key is in range, options are distinct, and the key agrees with the calculation when it can be checked.
- **Quotations:** at least two words, at most 60, and the work they come from must be named.

## Quotations: verified by the server, never by the model

A `QuoteCard`'s badge comes from the check kept with the interface (`lib/openui/verification.ts` calls the research layer's own `verifyQuotation`, which reads the text of the work and matches the words, the speaker and the place):

| Status | Meaning |
| --- | --- |
| `VERIFIED_EXACT` | the exact words were found in a primary text or an exam board's page that was read |
| `VERIFIED_VARIANT` | very close to a primary text, not word for word |
| `INCORRECT_ATTRIBUTION` | the words are in the text, but spoken by someone else or elsewhere (only from an unambiguous layout: see below) |
| `PARAPHRASE` | something close is in the sources, not these words |
| `UNVERIFIED` | everything else: only a revision site had it, no source had it, or nothing could be read. **Not** a claim that it is wrong |

With no research available, a quotation is `UNVERIFIED` with that reason. The badge is words plus an icon, never colour alone; only a confirmed quotation offers "Copy this quotation". The model is told never to call a quotation verified, and the page ignores anything it says about it. A chart or timeline uses only the data in its program; the program is checked for internal consistency, but **facts in it are not independently verified** unless they are quotations. That is a limit, not a feature.

**A false accusation found and fixed while testing (30 October 2026).** With live web research on, a correct quotation, "Out, damned spot!", was reported as "spoken by Doct (Act 5 Scene 1), not by Lady Macbeth". The loose plain-text reading of a page (a speaker is `Name.` at the start of a line) ran two speeches together on a page where `Lady M.` does not fit its pattern. `parseSpeeches` now marks each speech `structured` (MIT anchors, Folger line numbers, bold names in converted Markdown) or loose, and only a structured speaker may contradict a student; a loose one leaves the words verified and the speaker "not checked". `tests/researchAttribution.test.mjs` reproduces the page.

## Streaming, cancellation and fallback

- Events on the chat stream: `ui` with `phase` `start` (a draft begins; the page clears any earlier one), `chunk` (more program, drawn at once with controls off), `discard` (that draft failed its checks; drop it), `final` (the checked interface in stored form). If no `final` arrives, the answer is plain text.
- **Stop** ends generation, discards the draft and stores no interface. A cut-off connection is reported as an interrupted answer, as for text.
- **Invalid syntax, an unknown component, a cut-off program, a wrong key, an unsafe string** → one repair request at most (a bound, not a loop), then the draft is discarded and the answer is given in words that begin: "I could not build the interactive version, so here is the explanation in words." The raw program is never shown to a student; if drawing fails in the browser after the server accepted it, the page shows a plain-text version of what it said, with a line saying so.
- The interface path adds activity steps that are real work: *Building the interactive version*, *Checking the interface*, *Correcting the interface*, *Checking the quotations against the text*. A failed check is shown as failed.
- OpenUI, its parser and the components are a separate chunk, downloaded only when a conversation actually has an interface in it (`next/dynamic`). A text-only conversation does not load them.

## Actions and the security boundary

- **The only way out of an interface** is `host.ask(message)`: a message sent into the conversation **as the student**, through `/api/assistant/chat` with the same authentication, entitlement, input moderation, safeguarding, caps and limits as anything typed. The messages it sends are built by the page's own components from the student's own choices or the labels of fixed buttons; the server sees an ordinary user message.
- The Renderer's `onAction` accepts `continue_conversation` only (and routes it through `ask`); `open_url`, state setters, tool runs and custom actions are ignored, and the validator already rejects programs that contain them. No `toolProvider` is given, so there are no queries or mutations. The only links are the sanitised source links the server stored.
- Model output is **data**: it is parsed by OpenUI's parser, validated, and drawn by components that render strings as React text (Markdown is parsed by LearnThrive's own safe parser; KaTeX output is generated from the formula with `trust: false`). No HTML, no code, no `dangerouslySetInnerHTML` of model text.
- The model never decides authorisation: nothing in a program can reach another student's data, an account, a subscription or a payment.
- The Ollama key is read on the server only and is in a request header and nowhere else. `OLLAMA_API_KEY` appears in no client bundle, and `/api/assistant/status` names no key, model list or address.

## Honest limits

- Beam's reliability at writing these programs is **unmeasured** (above). The component list is large; a smaller model or a busier day may fail more often, and each failure costs up to two extra requests and falls back to words.
- A repair is a real extra request, counted against the per-account daily token budget.
- Educational accuracy of the *content* (a diagram's stages, a timeline's dates, a comparison's claims) rests on the model and on the evidence the research layer supplied; only quotations, formulas, answer keys that are plain calculations, probabilities and balanced equations are checked in code.
- The prompt for an interface is about 19,000 characters, roughly 5,500 tokens, for 47 components (the library, rules and three examples). It is sent on every interface turn and on every repair, and counts toward the context window and the per-account token budget.
- Beam reads text only: a photo or a scanned page cannot be turned into an interface or anything else.
- Children: unchanged. `ASSISTANT_MINORS_APPROVED` and `ASSISTANT_PRODUCTION_APPROVED` still gate it, and `ollama_cloud` is refused in production.

## Files

| Path | What |
| --- | --- |
| `lib/openui/schemas.ts` | the components (names, props, descriptions) |
| `lib/openui/library.ts` | server library, prompt, rules, tested examples |
| `lib/openui/validate.ts` | the checks above; `repairInstruction` |
| `lib/openui/mathExpr.ts`, `graph.ts`, `quiz.ts` | formula reader, curve sampling, marking and key audit |
| `lib/openui/format.ts` | stored format, checked-state context, history text |
| `lib/openui/intent.ts` | which messages ask for an interface |
| `lib/openui/verification.ts` | quotation checks as the five statuses |
| `lib/assistant/interface.ts` | the generate / validate / repair / verify loop |
| `lib/assistant/mockInterfaces.ts` | scripted interfaces for the mock provider (tests, development) |
| `components/openui/*` | library, renderer wrapper, host boundary, the components, CSS |
| `app/dev/ui-components/openui` | development preview (`#program=<base64url>`), 404 in production |

## Tests

```bash
cd apps/web
node --import tsx --test tests/openuiLibrary.test.mjs tests/openuiTurn.test.mjs tests/researchAttribution.test.mjs   # no network, no browser
npm run test:e2e:openui     # one dev server, the mock model, a real browser: graph + slider values, quiz, flashcards, steps, streaming, Stop,
                            # invalid fallback, reopen, follow-ups, layout on phone and desktop, keyboard and axe
```

The browser specs interact with the real components and check real values (the table of a graph at x = 4 for `a` = 1, 3, −1; a quiz's feedback, retry and score; the follow-up request's body; that no sideways scroll appears on a phone). They use the scripted mock, so they prove the code, not Beam. `[ui:invalid]`, `[ui:fixable]`, `[ui:truncated]`, `[ui:script]`, `[ui:action]` and `[slow]` steer it.

## Measuring Beam (needs your key)

```bash
cd apps/web
# OLLAMA_API_KEY in your environment, never in a committed file
npm run assistant:beam-check                                    # listing, stream, thinking, a tool call, web search and fetch, one interface
npm run assistant:openui-bench -- --runs 3 --render http://localhost:3101
```

`openui-bench` writes `docs/OPENUI_BENCHMARK.md` (plain Beam against Beam-generated interfaces: time to first content, total time, output tokens, first-draft validity, repairs, final success, whether a browser drew it and its controls worked, share of quotations confirmed, errors, and a cost line only if you pass `--price-out`, in £ per million output tokens) and `docs/benchmarks/openui-results.json` (every program, for a teacher to read). `--mock` checks the harness only and labels the report so. Run `--render` against a running dev server (`npm run dev`, or the one `npm run test:e2e:openui` starts on 3101 while it runs).

## Rolling back

`OPENUI_ENABLED=off` makes every answer text again with no other change. To remove the capability, delete `lib/openui`, `components/openui`, `lib/assistant/interface.ts`, `mockInterfaces.ts`, the `ui` event and the dynamic import in `StudyBuddy.tsx`, and uninstall `@openuidev/*`; stored interface messages would then show their raw marker text, so switch the setting off first and let the 30-day retention clear them, or convert them.
