# Study Buddy: subject-aware answers, exam accuracy and web research

This is how Study Buddy decides what a student is doing, checks what it can check before and after it answers, and (optionally) uses your own
[SearXNG](https://docs.searxng.org/) instance to look things up. It is a layer around the model, not a replacement for it.

The principles, in the order they win a disagreement:

1. **Accuracy over fluency.** A shorter correct answer beats a longer one with an invented detail.
2. **Verified evidence over invented quotations.** A quotation is called correct only when its words were found in a source that was *read*.
3. **Search results are leads, not proof.** A snippet never verifies anything. Rank decides what is read first, not what is true.
4. **Official criteria over generic grading.** Marks follow a published structure (AQA for now) or are not given.
5. **Uncertainty is shown.** "Could not be checked" is a normal result and the student is told.
6. **Web pages are untrusted data.** Nothing in a page is an instruction.

## What happens on a turn

```
student message
  -> detectStudyContext        subject, board, qualification, marks, command word, activity (no model call)
  -> prepareStudy              quotations in the message looked up on the web (nothing is stored locally);
                               exam-board documents looked up if asked; result written as a <verification> block
  -> model answers             with a per-turn instruction block for the subject and activity, the <verification> block,
                               and (if research is on) the research tools
  -> finishStudy               marks the evidence lowers, quotations that did not match or were never checked,
                               plainly wrong sums, sources read -> a short "Check" under the reply
```

Everything in `prepareStudy` and `finishStudy` is deterministic server code. A failure in either costs the extra checks, never the answer.
Spoken (voice) turns skip both to stay quick.

| Part | File |
| --- | --- |
| The two entry points the chat service calls | `apps/web/src/lib/assistant/study.ts` |
| Subject profiles (what each subject needs from an answer) | `exam/subjects.ts` |
| Context detection (subject, board, qualification, marks, activity, switching) | `exam/context.ts` |
| The per-turn instruction block | `exam/strategies.ts` |
| Practice marking frame, evidence caps, the "Marking check" note | `exam/marking.ts` |
| Post-answer checks | `exam/qa.ts` |
| SearXNG client (JSON API, every outcome a status) | `research/searxng.ts` |
| Source ranking by tier | `research/ranking.ts` |
| Fetching a page safely (redirects re-checked, byte cap, PDF) | `research/fetchSource.ts`, `research/safeUrl.ts`, `research/htmlText.ts` |
| Quotation matching; naming a set text | `research/quotations.ts`, `research/works.ts` |
| Per-turn research session: budgets, repeats, verdicts | `research/verify.ts` |
| Query privacy | `research/privacy.ts` |
| The research tools the model may call | `research/tools.ts`, `tools.ts` |

## Subject awareness

`exam/subjects.ts` holds a profile per subject (maths, English Literature, English Language, biology, chemistry, physics, history, geography,
computer science, business/economics, modern languages, religious studies, psychology): the words that identify it and how an answer should be
reasoned. Detection scores the message (a set text or the subject's name is strong; two different topic words are enough on their own). The
**current message beats the history** (a student can change subject mid-chat; `switched` is set and the old subject's assumptions are dropped),
and **what the student sets beats a guess**. When it is not sure, the instruction block says the subject is a guess.

Nothing is added to the instructions when nothing is detected, so a greeting costs no extra tokens.

## Quotations and facts

`verifyQuotation` returns one of:

| Status | Meaning |
| --- | --- |
| `verified_exact` | the words are in an authoritative, institutional or official page that was read |
| `verified_variant` | the same passage, with a difference (a modernised spelling, a dropped word); the real wording is shown |
| `supported_secondary` | seen only on a revision or general site, or only in a search snippet. **Not confirmed.** |
| `paraphrase_or_misquote` | something close is in the sources read, but not these words |
| `unsupported` | not found in the sources read (this does not prove the quotation is wrong) |
| `unverifiable` | nothing could be checked (search off, down, rate limited, or no page could be read) |

Matching ignores capitals, punctuation, curly quotes, line breaks and `...` for a stretch left out; it allows a one-letter difference in longer
words for the `variant` result.

**Nothing is stored.** No text of any play, poem or book is held in the code, and no list of facts about one. `research/works.ts` only recognises a
title or a character's name so a search can name the work. Every quotation is therefore checked against a page found by search, and with research
switched off, or SearXNG unreachable, a quotation is `unverifiable` and the student is told so. That is deliberate: the tutor has to use sources.

`verifyClaim` returns passages from pages that were read, with their source tier. It never returns "true".

## Searching: SearXNG

SearXNG is the operator's own metasearch instance. It answers "which pages might help"; the research layer reads and ranks them.

### Environment variables

Web research is **always on**: there is no on/off setting. Every variable below is optional. See `docs/ENVIRONMENT.md` for the generated table.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SEARXNG_BASE_URL` | `http://127.0.0.1:8888` | Where SearXNG runs. Server-side only; never sent to the browser. |
| `SEARXNG_TIMEOUT_MS` | 8000 | One search. |
| `SEARXNG_MAX_RESULTS` | 8 | Results kept. |
| `SEARXNG_CACHE_TTL_SECONDS` | 3600 | Identical searches and pages already read are reused (0 = no cache). |
| `RESEARCH_MAX_SEARCHES` | 3 | Per answer. |
| `RESEARCH_MAX_FETCHES` | 3 | Pages read per answer. |
| `RESEARCH_FETCH_MAX_BYTES` | 1500000 | Per page or PDF. |
| `RESEARCH_PER_MINUTE` | 10 | Searches per account per minute. |
| `SEARXNG_SECRET`, `SEARXNG_IMAGE` | a development value, `searxng/searxng:latest` | Used only by the container in `config/compose.yaml`. |

### Running an instance

`npm start` (and `npm run services:up`) start the `searxng` container with the other services, on `127.0.0.1:8888` only. Nothing needs setting.
To start just that one:

```bash
docker compose -f config/compose.yaml up -d searxng
```

If the container is not running (Docker is off, or you run your own instance elsewhere and set `SEARXNG_BASE_URL`), a turn still answers and says what
could not be checked. The container's secret key defaults to a fixed development value, which is safe only because the port is bound to
`127.0.0.1`; set `SEARXNG_SECRET` to a long random value if that ever changes.

**The setting that matters:** SearXNG answers every API request with **HTTP 403** unless `json` is listed under `search.formats` in its
`settings.yml`. `config/searxng/settings.yml` already has it. If you run your own instance, add:

```yaml
search:
  formats:
    - html
    - json
```

Pin a released image tag (`SEARXNG_IMAGE`) before relying on it. The shipped settings turn SearXNG's public limiter off because the instance is
private to this machine and the website does its own limiting; turn it on (it needs Valkey) if you ever expose the instance.

### Checking a real instance

```bash
node apps/web/scripts/research-check.mjs
node apps/web/scripts/research-check.mjs --query "AQA GCSE English Literature specification"
```

It makes one real search and prints the HTTP outcome, the number of results, the hosts, and the fix for a 403, a 429, a non-JSON answer or no
results. Nothing in the test suite calls it. **No result from a real SearXNG instance is recorded in this repository**: the tests below use fakes.

### What the model can call (only when research is on)

`search_web`, `fetch_source`, `verify_quotation`, `verify_claim`, `find_exam_specification`, `find_mark_scheme`. They are read-only and bounded by
the turn's budget. `fetch_source` opens **only an address that a search in the same turn returned**, so the model cannot make the server open an
address it invented. The official-document tools return only links on an exam board's own site that came back from the search; a link is never
guessed.

### Source ranking

Tiers by host (fixed lists in `research/ranking.ts`, nudged by the purpose of the search): official exam board and regulator, authoritative text
(Folger, Gutenberg, a university), institutional (`.gov.uk`, `.ac.uk`), reputable education (BBC, Oak, Khan), revision, general, and low (forums,
essay mills). At most two results from one site are kept. A page from a low tier is not read for a quotation check.

## Safety

- **Server-side request forgery.** Every address is checked before it is fetched *and at every redirect*: http/https only, no credentials, ports
  80/443 only, no local or internal names, no IP in a private, loopback, link-local (including the cloud metadata address), shared or reserved
  range in any spelling (decimal, hex, octal, IPv6, IPv4-mapped), and a name is allowed only if **every** address it resolves to is public.
  The operator's own SearXNG address is configuration and is not put through this check.
- **Prompt injection.** A page becomes plain text (scripts, hidden elements, zero-width and bidirectional control characters removed); the
  assistant's own markers are defused; instruction-like phrases are *reported* in the turn's notes and the page is read as data. Only short
  extracts of matched words or closest sentences reach the model, wrapped as data with a reminder that they are not instructions.
- **Privacy.** Queries are built from a quoted phrase, the work and the author, or a short phrase the model wrote after personal details (email,
  phone, postcode, address, "my name is...", school names) are removed. A pasted passage is refused as a query.
- **Cost and abuse.** Per-answer search and page budgets, per-account rate limit, repeats cost nothing, identical searches and pages are cached,
  responses are size-capped, and every network call has a timeout.
- **Failure.** SearXNG off, down, slow, rate limited, returning non-JSON or 403 never fails the answer. The student is told what could not be checked.

## Marking

Practice marking of English Literature essays follows AQA's published GCSE structure: Shakespeare and the modern text 34 marks (AO1 12, AO2 12,
AO3 6, AO4 4); the 19th-century novel and poetry 30 (AO1-AO3). Other boards and A-level are not encoded: without a known board and total the
tutor gives feedback by the objectives and asks before giving a mark.

The model writes the feedback and states a mark per objective (`AO1: 9/12`). The **server** then caps each mark by what the essay's evidence
supports and shows every reduction with its reason: very short answers, no quotations, at least half the quotations not matched to the text,
nothing linking context to the question, a whole-text question answered from one part. A mark is only ever lowered. The note always says it is
practice feedback, not an official mark, a grade or a prediction. No grade boundaries are stated.

## Tests

```bash
cd apps/web
node --test tests/researchCore.test.mjs tests/studyAccuracy.test.mjs   # mock model, fake search, no network
npm run typecheck
npm run lint
```

`studyAccuracy.test.mjs` is the 14 regression cases: subject recognition and switching; board/marks/activity; per-subject strategy and the
no-claim rule; an exact verified quotation (and none with research off); a misquotation; snippets-are-not-proof; an unchecked quotation in the reply; prompt injection through a page;
SSRF through the tools; search down; SearXNG 403; marks capped by evidence; unmatched quotations, partial and whole-text; budgets, repeats,
privacy and rate limits.

## Limitations

- Nothing here has been run against a live SearXNG instance or a real model in this repository; the code is tested against fakes and a scripted
  model. Run `research-check.mjs` and a few real questions before relying on it.
- With research off, or SearXNG down, no quotation can be verified. A web check only finds what its sources say, and it is only as good as the pages the instance returns.
- Ranking uses host lists, not page quality. Revision sites can be wrong; that is why they can only produce "supported", never "verified".
- PDFs are read through the existing document reader; a scanned PDF with no text layer is reported as unreadable.
- Marking is AQA English Literature only. The caps use simple measures (length, quotations, context words); they stop generous marks, they do
  not judge quality. A human marker is the authority.
- A 9B local model may ignore the tools. The server-side checks do not depend on it: quotations are verified before it answers, and the
  "Check" is added after.
