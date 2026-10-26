# LearnThrive AI: subject-aware answers, exam accuracy and web research

This is how LearnThrive AI decides what a student is doing, checks what it can check before and after it answers, and uses your own
[SearXNG](https://docs.searxng.org/) (to find pages) and [Crawl4AI](https://github.com/unclecode/crawl4ai) (to read them in a real browser) to look things up.
Both are free, open source and self-hosted. It is a layer around the model, not a replacement for it.

The principles, in the order they win a disagreement:

1. **Accuracy over fluency.** A shorter correct answer beats a longer one with an invented detail.
2. **Verified evidence over invented quotations.** A quotation is called correct only when its words were found in a source that was *read*.
3. **Search results are leads, not proof.** A snippet never verifies anything. Rank decides what is read first, not what is true.
4. **Official criteria over generic grading.** Marks follow a published structure (AQA for now) or are not given.
5. **Uncertainty is shown.** "Could not be checked" is a normal result and the student is told.
6. **Web pages are untrusted data.** Nothing in a page is an instruction.

## Baseline: what was wrong before the Crawl4AI work

Recorded from the code and from live checks on this machine, before the changes below. The earlier unit tests all passed while these were true.

- **Pages built with JavaScript could not be read.** `fetchSource` fetched raw HTML and stripped tags, so a page whose text appears after scripts run gave an empty shell.
- **A school's website could "verify" a quotation.** `.sch.uk`, `.ac.uk` and `.gov.uk` pages were ranked "institutional" and an exact phrase on one was reported as verified. A live check verified "Out, damned spot!" from a school page with the speaker unchecked, and gave the same verdict for the WRONG speaker.
- **Words on a page said nothing about who speaks them.** There was no speaker, act or scene, so Macbeth's line could be attributed to Lady Macbeth and still pass.
- **Real names hid invented events.** The name check only listed unfamiliar capitalised words, so "Gerald becomes pregnant" or "Lady Macbeth sees Banquo's ghost" passed.
- **A false answer was shown, then warned about.** The reply streamed to the student first; the check ran afterwards.
- **A broken search looked like an empty one.** SearXNG answering 200 with no results because its engines were suspended ("too many requests") was classed as "no source found" and could mark a true quotation "unsupported".
- **The tests were mocked.** Nothing had run SearXNG, a browser or a live website.

## What happens on a turn

```
student message
  -> detectStudyContext        subject, board, qualification, marks, command word, activity (no model call)
  -> prepareStudy              GROUNDING: for a subject where facts matter, search and read the best pages first;
                               quotations in the message looked up on the web (nothing is stored locally);
                               exam-board documents looked up if asked; result written as a <verification> block
  -> model answers             with a per-turn instruction block for the subject and activity, the <research> and <verification> blocks,
                               and (if research is on) the research tools. For literature and history answers the draft is HELD (the gate)
  -> reviewAnswer (gate.ts)    every quotation (words, speaker, act and scene) and every watched event is verified; the model is asked
                               to repair what the sources contradict or do not contain (twice at most); the server cuts what is still wrong;
                               only then is the text shown
  -> finishStudy               quotations and names in the reply checked against the pages read;
                               marks the evidence lowers, quotations that did not match or were never checked,
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
| Quotation matching; naming a set text; grounding | `research/quotations.ts`, `research/works.ts`, `research/ground.ts` |
| Per-turn research session: budgets, repeats, verdicts | `research/verify.ts` |
| Query privacy | `research/privacy.ts` |
| The research tools the model may call | `research/tools.ts`, `tools.ts` |

## Architecture: SearXNG finds, Crawl4AI reads, the verifier decides

```
question -> classify (subject, activity)  -> SearXNG: candidate pages (search queries carry no personal details)
         -> rank by source tier           -> address checks (private ranges, credentials, ports, redirects) in the website
         -> Crawl4AI: the page read in a real browser (direct fetch if it is off or fails, with the reason recorded)
         -> the address the browser ended on is checked again -> text cleaned, instruction-like text reported and ignored
         -> evidence: excerpts for the model, plus the full text for checking the reply
         -> verifier (independent of the model): quotations, speakers, places, events -> gate -> student
```

Crawl4AI is an extraction backend only. It never searches, and none of its hosted or paid endpoints is used. Every result records HOW the text was
obtained (`via: crawl4ai | direct`) and, if the browser was tried and failed, why (`crawlNote`). A page is never reported as read when it was not.

## Subject awareness

`exam/subjects.ts` holds a profile per subject (maths, English Literature, English Language, biology, chemistry, physics, history, geography,
computer science, business/economics, modern languages, religious studies, psychology): the words that identify it and how an answer should be
reasoned. Detection scores the message (a set text or the subject's name is strong; two different topic words are enough on their own). The
**current message beats the history** (a student can change subject mid-chat; `switched` is set and the old subject's assumptions are dropped),
and **what the student sets beats a guess**. When it is not sure, the instruction block says the subject is a guess.

Nothing is added to the instructions when nothing is detected, so a greeting costs no extra tokens.

## Grounding: read first, answer second

A small local model asked for a model answer on a set text will invent a scene, a character and a quotation, and it will not reliably call a search
tool itself. So the **server** reads before the model writes (`research/ground.ts`):

1. For English Literature, history, geography, the sciences, religious studies, psychology, business and computer science (not a calculation, a
   quiz or small talk), it builds one or two searches from the work and the question's topic words. The question's wording ("model answer", "30
   marks") and any quoted passage are left out.
2. It reads the best pages (one per site, best source tier first) and keeps the sentences that say most about the topic.
3. Those excerpts go to the model in a `<research>` block, **numbered** (`- [1] ...`, `- [2] ...`), with a rule: build the answer **only** from facts,
   events, relationships and quotations in the excerpts or in the student's message; leave out or flag anything else; never invent a quotation, scene
   or character. The block also states how many searches and pages were used, so "did you use search?" has a true answer. While this runs the page
   shows "Checking sources online...".
4. After the reply, quotations the model added are checked against the pages already read (then by a search, budget allowing), and any capitalised
   name in the reply that is in none of the pages and not in the student's message is listed. Both appear under the reply.

### The model's own citations: checking a quotation against the page it names

The excerpts are numbered because the model is asked to write that number beside anything it quotes, in double square brackets
(`research/citations.ts`):

```
Lady Macbeth calls on the spirits to "unsex me here" [[cite:1]].
```

Before this, a quotation was recovered from the reply's prose and then searched for: the server never knew which source the model *meant*, only that
some page somewhere might carry the words, so a long answer's tenth quotation could only be reported as unchecked — the search budget runs out long
before an essay does. With a number attached, the quotation is checked against **that page**, which was already read this turn, so usually no search
is spent at all. `verifyQuotation` is given the cited address and tries the pages already read in that order, cited page first; a number the server
never listed is reported as UNSUPPORTED ("it is attributed to source 7, which was not one of the sources given") rather than followed.

The marker is only the model's **claim** about where the words came from. Whether the words are really there is still decided by the wording and the
source's tier, never by the model — a citation can make a quotation easier to check and cheaper to check, never verified on its own authority. A
quotation with no marker is not an error: it goes through the ordinary path (extract, search, match), so a reply that ignores the rule loses nothing.
A marker with no quotation in its sentence says nothing and is simply removed. The markers are stripped before the student sees a word of the answer,
and before anything is stored; an answer that never had one is not touched.
5. If nothing could be read (SearXNG unreachable, nothing found), the model is told research failed and the student sees "No web sources could be
   read for this answer... treat its facts, events and quotations as unverified". It never silently answers from memory as if it had checked.

The pre-reply reading and the post-reply checks cost up to about five searches and five page reads per answer (`RESEARCH_MAX_SEARCHES`,
`RESEARCH_MAX_FETCHES`), and add a few seconds before the first word.

## Quotations and facts

**Only a primary text can verify a quotation.** `verified_exact` / `verified_variant` need the words in an edition of the work (Folger, MIT, Gutenberg and the like), an
exam board's own page, or an extract the student uploaded (which is labelled as "the extract you supplied", not as an edition). A school site, a university
page, the BBC, a revision site or a forum can only give `supported_secondary`: shown to the student as "found only on secondary sites". A copyrighted
work (*An Inspector Calls*) has no primary text on the web, so its quotations are at best `supported_secondary`; nothing is copied into the repository.

**Speaker and place come from the text's structure** (`research/playText.ts`): the MIT layout (anchors per speech), a page converted to Markdown, and the
Folger layout with line numbers are read into speeches (speaker, act, scene). A quotation is found *inside a speech*, so Macbeth's words are never
verified as Lady Macbeth's because both are on the page. When the answer says who speaks a line ("Lady Macbeth says '...'", "'...' cries Macbeth") that
claim is compared with the speaker found; a mismatch is `incorrect_attribution`. If the page's layout cannot be read, the words may still be
`verified_exact` but the verdict says the speaker was **not checked**. For a public-domain play whose first pages did not include the text itself, one
further search looks for it by name.

A search that returns nothing to read is `unverifiable`, never `unsupported`: only pages that were read can show words are absent. SearXNG answering with
no results because its engines are suspended is reported as a broken search (with the engines' own reasons).

`verifyQuotation` returns one of:

| Status | Meaning |
| --- | --- |
| `verified_exact` | the words are in an authoritative, institutional, official or reputable-education (BBC, a university) page that was read |
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

## Event claims: who did what

`research/claims.ts` checks the dramatic events a reply gives to named characters against the full text of the pages read. It watches a short list of
events models invent (pregnancy, prison, an institution, a killing, suicide, a death, a ghost, drinking, a crime, a marriage, an affair, poison), only
for claims with a named subject. For each it finds who the sources say did it and compares:

| Result | Meaning |
| --- | --- |
| `supported` | a page read says this character did this |
| `contradicted` | the pages say it happened, but to someone else ("Gerald becomes pregnant": the pages say Eric) |
| `unsupported` | no page read mentions it (missing evidence, not proof of falsehood) |

Names are compared as people: "Macbeth" is not "Lady Macbeth", "Mr Birling" is not "Mrs Birling", "Eric Birling" is not "Sheila Birling". Who *sees* a
ghost is read from the grammar ("appears to Macbeth"), so Lady Macbeth being named in the same sentence does not make her the one who sees it. A character
introduced as "a character called Bertha" that no source mentions is flagged. Before a claim is called unsupported the gate makes one more targeted
search for it. The check is deliberately narrow: it cannot judge interpretation, and it can still miss an invented event that is not on the list.

### Entailment for recall: "the sources support this, in other words"

The check above is exact, and it fails in one direction that matters. A page that says **"Eric is dismissed from the works"** produces no event pattern
for the claim **"Eric is sent to prison"**, so the claim is judged UNSUPPORTED — which the gate acts on, repairing or cutting a sentence the sources do in
fact support. The wording decided it, not the facts.

So an optional stage (`research/entail.ts`) asks a model to FIND the passage: for each unsupported claim, it proposes a span copied word for word from
one of the pages that were read, and says whether that span supports the claim or shows it happened to somebody else. It is a **recall** stage, and it
is allowed to be one, because everything it proposes is checked in code before it counts:

- the span must really be in the page it names, word for word (case, punctuation and accents are not differences), so a model cannot invent support;
- it must be at least four words — a two-word "support" proves nothing;
- a `supports` span must NAME the claim's own character. The name proves nothing on its own (that is why the event check exists), but a span that
  supports "Eric is sent to prison" without mentioning Eric is not evidence about Eric;
- a `contradicts` span must name somebody else, and it is that other person that is reported;
- anything else — an unknown page or claim id, a relation it did not offer, an unreachable or slow helper, a malformed answer — is dropped, and the
  caller keeps exactly the result the exact check produced.

Only `supports` promotes a claim here. A claim the sources contradict is already an issue, and a claim that *was* supported must not become a problem
because a model read the pages differently: **the stage can only add evidence it can point at.** It cannot make a claim verified — that needs the words
of a text — and it cannot suppress a problem.

It is off by default, development only (`ASSISTANT_CLAIM_RECALL=on`, with `ASSISTANT_RECALL_MODEL`, `_BASE_URL`, `_KEEP_ALIVE`, `_TIMEOUT_MS`,
`_MAX_CLAIMS`, `_PASSAGE_CHARS`; the tutor's own model and endpoint by default, since it is the resident model that can read a sentence against a
passage). Four claims and three pages per call, with its own deadline, and every failure is an empty result. With it off, the exact checks run exactly as
they did before.

## The gate: nothing unchecked is shown first

For English Literature answers (and history model answers and essays) the draft is **held, not streamed**. `gate.ts` verifies it, asks the model to rewrite
anything the sources contradict or do not contain (at most two rewrites, thinking off, never overrunning the context window), and then cuts any sentence
that is still wrong. If nothing supported is left, the student gets an honest "I could not write an answer that I was able to check" instead. Quotations
that are merely *unchecked* (the evidence could not be fetched) are not cut: they stay and the "Check" under the answer says they are unverified.

Safeguarding replies and blocked input never reach the gate, and ordinary chat, simple calculations and other subjects stream immediately. The page shows
"Checking sources online..." while the server reads, and "Checking the answer before showing it..." while the draft is verified. If the turn is
interrupted while a draft is held, the draft is released with a plain note that it was not checked; a blocked output is never released.

### Response modes

Each turn is given a mode from the message (`responseMode` in `study.ts`), never from the model:

| Mode | When | What happens |
| --- | --- | --- |
| Fast | ordinary chat, a simple question or calculation | streamed at once; no reading, no hold; a picked hosted model does not reason |
| Verified | a question answered from sources (grounded subjects, a quotation check) | sources read first; Literature and history answers held by the gate; a picked hosted model reasons lightly |
| Advanced | a hard problem (prove, show that, simultaneous, quadratic, differentiate, stoichiometry, 6+ marks, a long multi-step calculation), an essay to mark | full reasoning for a picked hosted model; a maths, physics or chemistry answer is **held while its working is checked by calculation** |

### Checking by calculation (maths, physics, chemistry)

For an advanced STEM answer the gate also checks the working itself, with the Paper Tutor's own safe expression parser (`checks/maths.ts`; no eval, no
model): a line with no unknowns must be true (a decimal may be a rounding to the figures it is written with); a chain `A = B = C` must hold for every
value where both sides have the same unknowns (a substitution such as `v = u + at = 0 + 9.8 x 3` is not judged); and a run of equations in one unknown
must not gain a solution from one step to the next. Chemical symbol equations must balance in atoms and charge (`checks/chemistry.ts`; `2H2 + O2 -> 2H2O`,
`Cu^{2+} + 2e^- -> Cu`, hydrates, state symbols). A wrong step is sent back to the same model for repair, with the line and the reason, and the rewrite is
checked again. A step still wrong after two repairs is **named under the answer, not cut**: removing a line of working would leave a solution that skips it.
The same checks run, without holding the answer, on any other reply that contains working, and their findings go in the "Check" under it.

What it does not judge: approximations, alternatives (`x = 2 or x = 3`, `±`), inequalities, trigonometry and logarithms, calculus, units and dimensions,
word equations, and charges written ambiguously (`Fe3+` without a caret). Those are unchecked, never called wrong. Computer science code is not run.

### Evidence statuses

Every checker keeps its own detailed result, and they share one vocabulary (`checks/evidence.ts`):

| Status | Meaning | Examples |
| --- | --- | --- |
| VERIFIED | checked against primary evidence and it holds | the exact words are in the text; a line of working is right |
| SUPPORTED | a reliable source says so, but not the primary text, or the wording differs slightly | a quotation seen only on a revision site; a close variant |
| INFERRED | an interpretation or conclusion, not a checkable fact | analysis of a writer's method |
| CONTESTED | sources disagree | |
| UNSUPPORTED | looked for and not found in what was read | an invented quotation; an event no source mentions |
| CONTRADICTED | the evidence says otherwise | a wrong speaker; a misquotation; a wrong step; an unbalanced equation |
| UNVERIFIABLE | could not be checked | nothing to check against; a service down; a form the checker cannot read |

Only CONTRADICTED and UNSUPPORTED are repaired or cut. A search snippet, a revision site, or a model agreeing with itself is never VERIFIED.

### Subjects and the checks they get

| Subject (exam/subjects.ts) | Checks before and after the answer |
| --- | --- |
| English Literature | quotations verified against primary text or the student's extract, speaker and act/scene from the play's structure, event claims, invented characters; held by the gate |
| History | grounded in sources; event claims checked; model answers and essays held by the gate |
| Maths | working and arithmetic checked by calculation; advanced answers held and repaired; never searched (a calculation is checked locally) |
| Physics, Chemistry | the same calculation checks, and equations balanced (chemistry); explanations (not calculations) grounded in sources |
| Biology, Geography, Religious Studies, Psychology, Business and Economics, Computer Science | grounded in sources where facts matter; names and terms not in any source flagged; arithmetic checked |
| English Language, Modern Languages | subject strategies (quote only from the extract; agreement and tense); arithmetic checked; not searched |
| 11+ | detected as maths or English by its content; the same checks |

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
| `RESEARCH_MAX_SEARCHES` | 5 | Per answer. |
| `RESEARCH_MAX_FETCHES` | 5 | Pages read per answer. |
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

### Crawl4AI: reading the pages

Crawl4AI is the open-source self-hosted browser crawler (image pinned to `unclecode/crawl4ai:0.9.2`, the version its documentation names stable). It runs in
Docker on CPU, with a 4 GB memory limit, 2 CPUs, 1 GB shared memory, `no-new-privileges`, and its port published on `127.0.0.1:11235` only. It is started by
`npm start` beside SearXNG. It shares nothing with Ollama and uses no GPU.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CRAWL4AI_ENABLED` | on | Off: pages are fetched directly. |
| `CRAWL4AI_BASE_URL` | `http://127.0.0.1:11235` | Server-side only. |
| `CRAWL4AI_API_TOKEN` | a public development value | Sent as a Bearer token; Crawl4AI 0.9.x refuses every request except `/health` without it. Compose and the website must agree. **Production must set its own**; with only the development value the website turns the crawler off. |
| `CRAWL4AI_IMAGE` | `unclecode/crawl4ai:0.9.2` | Change deliberately. |
| `CRAWL4AI_TIMEOUT_MS` | 15000 | One page. |
| `CRAWL4AI_MAX_CONCURRENCY` | 2 | Pages read at once. |

Start, stop and check:

```bash
docker compose -f config/compose.yaml up -d crawl4ai     # or: npm start
docker compose -f config/compose.yaml stop crawl4ai
npm run research:check                                   # SearXNG, Crawl4AI, a JavaScript page, then the whole pipeline on live websites
npm run research:eval                                    # the labelled accuracy benchmark (writes docs/benchmarks/research-eval.json)
```

Troubleshooting (the website never crashes on any of these; it falls back to a direct fetch and the turn records why):

| Symptom | Cause and fix |
| --- | --- |
| `unauthorised` (HTTP 401/403) | `CRAWL4AI_API_TOKEN` differs from the one the container was started with. Recreate the container after changing it. |
| `unavailable ... ECONNREFUSED` | The container is not running (Docker off, still starting: it takes about 40 s). |
| `timeout` | The page was slow; raise `CRAWL4AI_TIMEOUT_MS` or accept the direct fetch. |
| `extraction_failed` | The page loaded but had no readable text, or the browser could not load it (a blocked address returns HTTP 400 from Crawl4AI's own address guard). |
| `bad_response` | Not JSON, or no result: check `CRAWL4AI_BASE_URL` points at Crawl4AI itself. |

**Cost.** Measured on this machine at idle after benchmark use: about 640 MB of memory and ~2% CPU for the crawler, ~170 MB for SearXNG. Reading a page in the
browser adds roughly 1 to 3 seconds per page over a direct fetch; a grounded literature answer spends about 5 to 7 seconds reading before the model starts, and the
gate adds a verification pass (and a rewrite when something is wrong) after the draft.

**Deployment.** `127.0.0.1` on a developer's laptop is not reachable from a hosted website. A hosted website needs SearXNG and Crawl4AI deployed beside it on a
private network (never on a public address), `CRAWL4AI_BASE_URL` / `SEARXNG_BASE_URL` pointing at them, and its own long random `CRAWL4AI_API_TOKEN`. Because the
crawler's browser follows redirects and scripts the website cannot see, also restrict the crawler container's outbound network (no route to your private
ranges or the cloud metadata address) with the host firewall or a dedicated network. Crawl4AI 0.9.2 itself refuses private and local addresses (observed: HTTP 400
"URL blocked (SSRF protection)" for a `host.docker.internal` address); that is a second layer, not a replacement for the first.

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

- **Crawler hardening.** The crawler is reached only from the server, with a server-side token that is never logged, put in a message, or sent to the
  browser. Only addresses that passed the website's checks are sent to it; the address it ended on is checked again and the page is discarded if it led
  somewhere private. Crawl4AI's hooks and deep-crawl options are off by default and are not used; no proxy is configured; one page per request, with a
  timeout, a concurrency cap and a response-size cap.
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

## Tests, live checks and what is NOT tested

| Layer | Command | What it proves |
| --- | --- | --- |
| Unit and mocked integration | `cd apps/web && npm test` | Logic with a fake model and fake search: statuses, the gate, claims, the crawler client's every failure path, fallback, address checks. Not evidence that any real service works. |
| Live services | `npm run research:check` | Real SearXNG, real Crawl4AI, a real JavaScript-rendered page (quotes.toscrape.com/js, a practice site made for this), and the whole pipeline on real websites. |
| Accuracy benchmark | `npm run research:eval` | Labelled quotation and event cases through the live stack. Results are written to `docs/benchmarks/research-eval.json` and depend on what the search engines return that day. A case whose search could not run is reported as not tested. |
| Real model | not run by the agent | The owner runs the real model by hand. **NOT TESTED:** model answers for the Macbeth and *An Inspector Calls* benchmark tasks, and the repair loop with a real model. |
| Essay quality (23/30) | [ESSAY_BENCHMARK_PROTOCOL.md](ESSAY_BENCHMARK_PROTOCOL.md) | **NOT TESTED.** Needs qualified teachers marking unseen tasks. The model's own marks are not evidence. |

A local JavaScript fixture website cannot be used with Crawl4AI: its own address guard refuses private addresses, and its `raw:` input does not run scripts.
That is why the JavaScript check uses a public practice site.


```bash
cd apps/web
node --test tests/researchCore.test.mjs tests/studyAccuracy.test.mjs tests/assistantCitationsRecall.test.mjs   # mock model, fake search, no network
npm run typecheck
npm run lint
```

`assistantCitationsRecall.test.mjs` covers the two stages above with no network and no real model: a citation marker is resolved to the page it names,
a marker naming a source the server never listed is reported rather than followed, the markers are stripped (and an answer without one is not touched),
and the recall stage's acceptance rules one by one — a span that is not on the page, a span under four words, a `supports` span about somebody else, an
unknown claim or page id, a slow or broken helper — each leaving the exact check's result as it was, with the real gate driving the fake stage.

`studyAccuracy.test.mjs` is the 14 regression cases: subject recognition and switching; board/marks/activity; per-subject strategy and the
no-claim rule; an exact verified quotation (and none with research off); a misquotation; snippets-are-not-proof; an unchecked quotation in the reply; prompt injection through a page;
SSRF through the tools; search down; SearXNG 403; marks capped by evidence; unmatched quotations, partial and whole-text; budgets, repeats,
privacy and rate limits.

## Limitations

- **Public search engines throttle.** SearXNG relies on engines (Google, Brave, DuckDuckGo) that suspend a client that asks too much. During benchmarking all
  of them were suspended ("too many requests") and searches returned nothing, which is now reported as a broken search and a "could not be checked" result,
  not as a failure of the quotation. Caching helps; an instance with more engines, or its own egress addresses, helps more. This is the main reliability risk.
- **Only the checks above exist.** A fabricated claim that is not a quotation and not on the watched event list is not caught by the verifier. It reduces
  risk; it does not remove it, and no claim is made that hallucination is eliminated.
- **Copyrighted works.** *An Inspector Calls* has no primary text to verify against, so its quotations top out at "found only on secondary sites" unless the
  student uploads the extract. Using sources lawfully (robots rules, paywalls, licences) is the operator's responsibility; the crawler does not bypass
  access restrictions, but it does not read robots.txt either.
- **Edition differences.** Folger and MIT editions differ in punctuation and some words; those become `verified_variant`, never silently exact.

- **The recall stage is off and unmeasured.** `ASSISTANT_CLAIM_RECALL` is not on by default and has not been run against a real model here, so the
  shipped behaviour is the exact check alone. It cannot make a claim verified, and everything it proposes is checked against the page in code, so the
  risk of turning it on is a claim wrongly *kept* (a span that really is on a page and really does name the character), not a fabricated one verified.
- **The model's citations are followed, not trusted.** A number in the reply decides which already-read page is checked first; it never decides whether
  the words are there. A fabricated citation therefore costs one wasted check against a page that was read anyway, and is reported under the answer.
- Nothing here has been run against a live SearXNG instance or a real model in this repository; the code is tested against fakes and a scripted
  model. Run `research-check.mjs` and a few real questions before relying on it.
- With research off, or SearXNG down, no quotation can be verified. A web check only finds what its sources say, and it is only as good as the pages the instance returns.
- Ranking uses host lists, not page quality. Revision sites can be wrong; that is why they can only produce "supported", never "verified".
- PDFs are read through the existing document reader; a scanned PDF with no text layer is reported as unreadable.
- Marking is AQA English Literature only. The caps use simple measures (length, quotations, context words); they stop generous marks, they do
  not judge quality. A human marker is the authority.
- A 9B local model may ignore the tools. The server-side reading and checks do not depend on it: pages are read before it answers, and the
  "Check" is added after.
- The name check is a heuristic: it lists capitalised words that are in none of the pages read, so it can miss an invented fact that uses only known
  names (a real character doing something they did not do) and can flag a real name the two pages happened not to mention. Excerpts are only as
  complete as the two pages read.
