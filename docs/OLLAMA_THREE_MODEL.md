# LearnThrive AI's three local Ollama roles

The owner's brief (23 October 2026) asked for three local model roles, a fix for the picture-question timeout that was not
"raise every timeout", and measurements on the actual laptop. This is the runbook for what was built, what was measured, and how to
put the previous arrangement back.

Measured numbers live in [OLLAMA_BENCHMARK.md](OLLAMA_BENCHMARK.md) and the generated
`docs/benchmarks/{ollama-results,ollama-quality}.json`; they are produced by the runner, never hand-copied. The end-to-end photo
reproduction is `docs/benchmarks/photo-check.json`.

## What runs, and where

| Role | Model (tag) | Endpoint | Placement | Why |
| --- | --- | --- | --- | --- |
| Tutor: vision, tools, thinking | `bonsai-2:9b` (digest `c8b5462f8688…`), selected by measurement: [OLLAMA_BENCHMARK.md](OLLAMA_BENCHMARK.md) | `http://127.0.0.1:11434` | RTX 3070 (Vulkan backend), one model resident, one answer at a time | the only role that generates student-facing text |
| Embeddings | `embeddinggemma-2:270m-q8_0-text` (digest `c21dd30c1e38…`) | `http://127.0.0.1:11435` | CPU: `OLLAMA_VULKAN=0` plus the `*_VISIBLE_DEVICES=-1` variables, scoped to that process; verified `size_vram: 0` | retrieval is a background convenience; it must never evict the tutor |
| Typed decisions | `laya:421m-typed-decisions-bf16` (digest `84a7be5dd978…`) | `http://127.0.0.1:11435` | CPU, the same helper process | routing one ambiguous message, never rights or correctness |

Two processes, not one scheduler. The reason is in the API: `/v1/systemone` and `/api/embed` do **not** accept `num_gpu`, so CPU
placement can only be scoped to a process. Forking also means a helper call cannot evict the tutor, which the one-GPU Docker
scheduler did.

One measurement is worth recording here because it was wrong at first: this Ollama build (0.40.9 on Windows) reaches the RTX 3070
through **Vulkan**, and `CUDA_VISIBLE_DEVICES=-1` does not hide a Vulkan device. The helper was still taking about 800 MiB of VRAM
(`nvidia-smi` 4555 MiB used with the tutor resident, 1024 MiB after unloading the tutor, 210 MiB with both unloaded) even though it
was documented as CPU-only. Setting `OLLAMA_VULKAN=0` (and `GGML_VK_VISIBLE_DEVICES=-1`) on the helper process fixes it: its log
now says `inference compute id=cpu library=cpu`, `/api/ps` reports `size_vram: 0` for both helper models, and the card holds only
the tutor. Both helper models stay resident (`OLLAMA_MAX_LOADED_MODELS=2` for that process) so an embedding call and a routing call
do not evict each other.

Both servers are the same binary and the same model directory:

```
D:\OllamaRuntime\0.40.9\ollama.exe    # verified Windows build (official release, SHA-256 checked)
D:\OllamaModels                       # OLLAMA_MODELS, reused: nothing downloaded twice
```

The installed Ollama 0.35.0 tray application is untouched and remains the rollback. Docker's `ollama/ollama:0.35.0` service is
stopped (`restart=no`), and remains the second rollback.

## Start, stop, status, warm up

```bash
node scripts/ollama-local.mjs start            # GPU tutor on 11434 + CPU helper on 11435
node scripts/ollama-local.mjs status           # versions, what is resident (with ctx and VRAM), GPU, roles installed
node scripts/ollama-local.mjs warm             # load with EXACTLY the app's num_ctx, plus both helpers
node scripts/ollama-local.mjs stop             # stops only the recorded process trees
node scripts/ollama-local.mjs pull              # download whichever of the three roles is missing
npm run ollama:local -- start                  # the same, from the repository root
```

`npm run dev` (via `scripts/dev-services.mjs`) starts the native runtime itself and prepares the models in the background.
Docker is used only for the voice sidecar and the local Supabase stack; Docker's Ollama is a fallback when no native runtime
answers. The speech sidecar stays on the GPU and its ~1 GiB is counted in the headroom figures.

Environment is scoped per process, not set globally:

```
main:   OLLAMA_MODELS=D:\OllamaModels  OLLAMA_HOST=127.0.0.1:11434  OLLAMA_NUM_PARALLEL=1  OLLAMA_MAX_LOADED_MODELS=1  OLLAMA_KEEP_ALIVE=30m
helper: the same, but CUDA_VISIBLE_DEVICES=-1  HIP_VISIBLE_DEVICES=-1  GGML_VK_VISIBLE_DEVICES=-1  OLLAMA_VULKAN=0
        OLLAMA_HOST=127.0.0.1:11435  OLLAMA_MAX_LOADED_MODELS=2
```

Flash attention and a `q8_0` KV cache were treated as experiments only: neither is enabled by default, because neither was shown
to help this model/backend on this card.

## Why the picture question timed out (reproduced cause)

Four separate faults overlapped. None of them is "the model is too big", and every one was measured:

1. **The cold load was slow because of the container's model mount, not the model.** Docker bind-mounted `D:\OllamaModels` into
   WSL, and llama.cpp memory-mapped a 5 GB file across the Windows-drive mount. The previous baseline measured a **215 s cold
   load** (and 251 s for the reload below); the container log showed `timed out waiting for llama-server to start`. Running
   natively from the same directory, the benchmark measured a **8.5 s** cold load for `qwen3.5:9b` (evicted first, then loaded
   with the app's options). That is a two-order-of-magnitude difference, and it is the root cause.
2. **The app's first-answer timer started before `/api/chat`.** A 45 s timer therefore covered the load *and* image evaluation,
   so a cold start could never succeed even when nothing was wrong with the request. The service now prepares the model before
   the turn starts (bounded and shown honestly as "preparing"), and the turn's clocks begin when the request is sent.
3. **The old warm-up loaded the model at a different context.** It sent `keep_alive` but not `num_ctx`; `/api/ps` showed the
   model resident, yet the first real request (`num_ctx 8192`) forced a **193 s reload**. The shared warm-up now sends exactly the
   options a turn sends, and the benchmark's first case shows the remaining one-off cost (the first request after a load pays
   prompt-evaluation initialisation; subsequent requests do not).
4. **Follow-up turns re-read and re-sent the earlier pages.** Every follow-up without a new file re-read the PDF, re-rendered its
   pages and re-sent up to three large images, breaking the prompt cache and paying the image cost again. What a document said is
   now stored once (`chat_files.extracted_text`), reused on later turns, and only an explicit "look at the diagram" re-renders a
   single page.

A fifth fault was found while benchmarking, and fixed here: **thinking spent the whole output budget.** With `num_predict 700`, a
hard question produced ~700 thinking tokens and no answer at all (first visible answer: never). Thinking now has its own extra
budget (`ASSISTANT_THINKING_TOKENS`, 600) on top of the answer's, within the same absolute turn deadline.

## How the service uses the three roles

The selected tutor is `bonsai-2:9b`: it matched `qwen3.5:9b` on the exact-answer set (18/18), answered a photo in 0.9-1.1 s
instead of 6.8-8.8 s, and left 2.7 GiB of VRAM free where Qwen left 147 MiB. `bonsai-2:4b` stays installed as the measured speed
profile (16/18 on the same set; it answered `1` rather than `7` on one equation), and `qwen3.5:9b` stays as the rollback. The
comparison is in [OLLAMA_BENCHMARK.md](OLLAMA_BENCHMARK.md).

The order in `assistant/service.ts` is the security order:

1. length, per-minute and per-day caps (an attempt counts);
2. the chat is looked up by the signed-in family and learner (never by an id from the request);
3. input moderation: a safeguarding match gets fixed words, a flag and **no model call**;
4. the uploads: a fresh file is read once; an earlier file reuses its stored reading;
5. routing: the explicit action and file metadata win, then a compact deterministic route; the decision model is asked **only**
   for an ambiguous text-only follow-up, with a 4 s timeout and a probability/margin floor;
6. retrieval: the family's own chunks only, with explicit question/page labels looked up exactly first;
7. the tutor, prepared first if it is not resident, then streamed with staged deadlines;
8. a bounded tool round trip (at most `ASSISTANT_MAX_TOOL_ROUNDS`, default 2), each tool executed by the server;
9. the answer is stored, and only then is "done" sent.

The decision model never decides authentication, entitlement, guardian consent, file ownership, tool permission, safeguarding or
whether an answer is correct. Those are server policy before and after it runs. A helper failure returns null and routing continues
deterministically, so a router outage is not a chat outage.

### Tools (read-only allowlist)

| Tool | What it can read | What it cannot do |
| --- | --- | --- |
| `search_authorised_material` | the family's own chunks of this chat's uploads | name a file or learner; read anything else |
| `get_question_region` | a named page/question from those same uploads | guess a region that is not stored |
| `check_calculation` | the existing bounded maths checker (`paper/maths.ts`) | evaluate arbitrary code, run a shell or fetch a URL |

Arguments are validated (type, length, finite numbers) and results are defused, labelled and size-limited before they go back into
the conversation. A tool result is data, never an instruction. A tool call is ignored once text has started, so two answers can
never be stitched together.

### Staged deadlines (defaults)

| Stage | Default | Meaning |
| --- | --- | --- |
| `ASSISTANT_STAGE_QUEUE_MS` | 20 s | waiting for the single generation slot (visible as a queue position) |
| `ASSISTANT_STAGE_LOAD_MS` | 180 s | making a non-resident model resident, shown as "preparing" |
| `ASSISTANT_STAGE_FIRST_ACTIVITY_MS` | 60 s (90 s image) | first thinking/tool/text event after the request |
| `ASSISTANT_STAGE_FIRST_ANSWER_MS` | 45 s (90 s image) | first visible word; thinking does not stop this clock |
| `ASSISTANT_STAGE_IDLE_MS` | 30 s (45 s image) | longest silence between events once activity started |
| `ASSISTANT_STAGE_TOOL_MS` | 60 s | one tool execution |
| `ASSISTANT_STAGE_TURN_MS` | 180 s (240 s image) | the whole turn, absolute: tool rounds and retries never reset it |

`ASSISTANT_PICTURE_FIRST_TOKEN_MS` and `ASSISTANT_PICTURE_TOTAL_MS` still work as aliases for the image first-answer and
whole-turn budgets, so an existing `.env.local` keeps its meaning.

### Retrieval

`supabase/migrations/0014_chat_retrieval.sql` adds `chat_files.extracted_text`/`pages` and `chat_file_chunks` (owner-scoped,
RLS forced, no API grants, cascade with the file). Chunks follow the paper's question starts and are bounded at 1200 characters
with 150 overlap. Vectors are `real[]`, cosine is computed in application code over candidates the repository has already filtered
by family **and** learner, and a chunk records the embedding model, digest, dimension and chunking version so a query is never
compared with a different model's vectors.

- EmbeddingGemma 2 prefixes are applied in the adapter, not by callers: queries `task: search result | query: `, documents
  `title: <label> | text: `. The modelfile adds none, which is what Ollama's own package page says too.
- An over-long input is refused (`truncate: false` and an explicit size check), never silently cut.
- Indexing runs one file at a time after the answer, so it cannot starve uploads, the UI or voice.
- A photo is **not** indexed: text the server never read would be invented content. A PDF's own text is.
- Deleting the upload (7 days, or with the chat) removes its chunks; nothing outlives its source.

### Typed decisions, as measured

The `/v1/systemone` adapter was verified against the real model on 0.40.9. Shapes observed:

```
choice -> { type, choice, probabilities: {option: p}, confidence }
noul   -> { type, noul: p }                 (probability of "yes"; no confidence field)
score  -> { type, score, legend, probabilities, confidence }
```

Laya's five-way probabilities on this laptop top out around 0.3-0.5, so the original 0.55 floor abstained on every held-out
example. The policy is now **the chosen option's own probability ≥ 0.30 and a margin of ≥ 0.12 over the runner-up**; anything
else falls back to deterministic routing. Accuracy on the held-out set is reported in
[OLLAMA_BENCHMARK.md](OLLAMA_BENCHMARK.md), including any case the model gets wrong; the route is a workflow hint only, so a wrong
route changes which extra context is offered, not what the server permits.

## Verification

- Protocol tests (`apps/web/tests/assistantRoles.test.mjs`): thinking as activity (not the answer), tool-call parsing and native
  tool-result shape, keep-alive and exact context, capability-cache recovery after a failed lookup, warm-up deduplication,
  embedding prefix/batch/vector validation, decision shape validation and abstention, routing fallback, chunking and exact labels,
  the tool allowlist and the maths checker, staged budgets, the "preparing" status, one real tool round, the "reading" status for
  a fresh upload, the status route probing each role instead of reporting configuration, and a follow-up that reuses the stored
  reading instead of re-sending pages.
- Data contract tests (`packages/data/src/testing/libraryContract.ts`, run against memory and PGlite): chunks are the owner's,
  replace cleanly, come back as numbers, and are removed with their file; `0014` is in the migration and RLS test lists.
- Runtime placement, measured on this laptop: `node scripts/ollama-local.mjs status` after `warm` shows the tutor loaded on
  `:11434` and both helper models on `:11435`; `nvidia-smi` holds the tutor only, and the helper's `/api/ps` reports
  `size_vram: 0` with `library=cpu` in `.ollama-local/helper.log`. Before the `OLLAMA_VULKAN=0` fix the same check showed the
  helper on Vulkan0 and ~800 MiB of VRAM.
- `apps/web/scripts/ollama-lifecycle-check.mjs` and `ollama-browser-check.mjs` (`npm run ollama:lifecycle`, `npm run ollama:browser-check`):
  idle expiry, helpers beside the tutor, a PDF follow-up, two students, a backend restart, and the failing photo through the real
  website, cold and warm (`docs/benchmarks/{lifecycle-check,browser-check-cold,browser-check-warm,cold-starts}.json`).
- `docs/benchmarks/photo-check.json`: the owner's failing picture question through the real service, cold and warm, with the
  structured timings (no image, no transcript). See [OLLAMA_BENCHMARK.md](OLLAMA_BENCHMARK.md).

## Rollback

1. `node scripts/ollama-local.mjs stop` (stops only the two recorded process trees).
2. Restore the Docker service: `docker update --restart=always learnthrive-ollama-1` then
   `docker compose -f config/compose.yaml up -d ollama`.
3. In `apps/web/.env.local`, set `ASSISTANT_MODEL=qwen3.5:9b`, `ASSISTANT_VISION_MODEL=qwen3.5:9b`,
   `ASSISTANT_CONTEXT=8192`, `ASSISTANT_RETRIEVAL=off`, `ASSISTANT_DECISION=off`, and remove the `ASSISTANT_EMBED_*`,
   `ASSISTANT_DECISION_*`, `ASSISTANT_STAGE_*`, `ASSISTANT_THINKING*` and `ASSISTANT_IMAGE_*` values you added.
4. `qwen3.5:9b` was never removed, and was not resident alongside the new tutor: nothing to re-download.
5. Migration `0014` is additive. Leaving it in place is safe (the app ignores it with retrieval off). Dropping the index means
   `drop table public.chat_file_chunks; alter table public.chat_files drop column extracted_text, drop column pages;` and removing
   `0014_chat_retrieval.sql` from the migration list. Do that only on a database you control (never the hosted project).
6. The installed Ollama 0.35.0 application is untouched; the new runtime lives entirely under `D:\OllamaRuntime`.

## Limitations, stated plainly

- This is a development-only local profile. `config.ts` still refuses Ollama in production; nothing here makes the laptop a
  public AI server, and both endpoints are loopback-only.
- The measured numbers are from this laptop, with the voice container and desktop running. They are not transferable.
- The decision model is a small classifier on CPU. Its abstention policy is deliberately conservative; when in doubt the chat
  behaves exactly as before, without it.
- Photos are not transcribed for the index. A follow-up that needs a diagram re-renders one page from the original upload.
- Handwriting, rotated pages and unusual symbols remain a model-quality question, not a latency one; the benchmark records
  whether an answer was produced, not whether it deserved full marks.
- Retrieval quality is measured on a small authored set (8 chunks, 6 queries), which is a smoke test of the pipeline, not a
  claim about real Library content.
- The helper models share system RAM with the app and the database. On this 64 GB machine that is comfortable; on a smaller
  machine the helper could compete with the app, and the answer is to run the helpers on demand, not to shrink the tutor.
