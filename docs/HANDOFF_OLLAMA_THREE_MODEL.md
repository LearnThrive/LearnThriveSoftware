# Handoff: the three-model Ollama brief (for DeepSeek V4.1 Flash)

Written 2026-10-23 by the previous model (Claude) when its usage limit was near. Read this first, then the brief itself:
`D:\LearnThriveSoftware\LearnThrive_Ollama_Three_Model_Claude_Code_Prompt.md` (untracked, do not commit it; same for
`LearnThrive_Production_Completion_Claude_Code_Prompt.md`). The owner's request was only: "implement" that brief.

## Rules of working (from the owner and from memory files; follow them)

- Work **solo**. Do not spawn agents or workflows (the owner said they use too much usage).
- Repo `D:\LearnThriveSoftware`, branch `feature/production-completion`. **Nothing is pushed; do not push, do not open a PR, never force anything.**
- Commit as `AlviHossain97 <alvi997@outlook.com>` with **no `Co-Authored-By` or other trailer**. Stage specific paths, never `git add -A`
  (the two brief `.md` files at the repo root and `apps/web/tsconfig.json`, which `next dev` edits by itself, must stay out of commits).
- Windows 11, Git Bash. **The Bash tool collapses double backslashes and mangles heredocs containing quotes/backticks**: write patch scripts
  with the Write tool (to the scratchpad dir) and run them with `node`; edit with the Edit tool. Working files are CRLF (autocrlf); patch scripts
  should normalise `\r\n` to `\n`, edit, then restore.
- Never print secrets. Never touch the hosted Supabase project `learnthrive-prod`. Do not touch billing/account work.
- Verify before claiming: report real measured numbers only; mark anything not run as untested. No fabricated benchmarks.
- Keep the owner's earlier work: authentication, entitlements, learner/guardian permissions, voice, documents, Paper Tutor, the durable paper jobs and marker
  (see `docs/PRODUCTION_COMPLETION_LEDGER.md`).
- After code changes run, from `apps/web`: `npx tsc --noEmit`, `node --test tests/*.test.mjs` (736 pass at last count), `npx eslint src scripts tests` (0 errors).
  `packages/data`: `npx tsx --test src/*.test.ts` (280 pass, 1 skipped). Playwright's own dev servers fail to start while the owner's `npm run dev` holds the
  Next lock; verify UI with the in-app browser via `preview_start` (launch configs in `.claude/launch.json`, e.g. `study-buddy-mock` on :3110; dev admin login
  `admin@learnthrive.dev` / `dev-admin-pass` is a local development account).
- When editing `scripts/env-registry.mjs`, regenerate the docs: `node apps/web/scripts/env-docs.mjs --write` (a test compares `docs/ENVIRONMENT.md` to it).

## The machine (measured 2026-10-23)

- Windows 11 (10.0.26340), Ryzen 7 5800H, 63.3 GB RAM, **RTX 3070 Laptop, 8192 MiB dedicated VRAM**, driver 617.42, on AC, power plan Ultimate Performance.
- Disk: C: 373 GB free, D: 850 GB free. Models live in `D:\OllamaModels` (`OLLAMA_MODELS` env var). Docker Desktop is installed and was running.
- Installed Ollama app: `C:\Users\alvi9\AppData\Local\Programs\Ollama\ollama.exe`, **version 0.35.0** (this is the rollback). Docker's `ollama/ollama:0.35.0` image also existed.
- `qwen3.5:9b` (digest `56671c2ab938...`, 6.55 GB file) is the current model. Latest official Ollama is **v0.40.9** (published 2026-10-22).

## What has been done so far

1. Committed the pending earlier work (`1b62b10`): picture timeouts (`ASSISTANT_PICTURE_FIRST_TOKEN_MS` 240 s / `ASSISTANT_PICTURE_TOTAL_MS` 360 s), clearer timeout text in
   `StudyBuddy.tsx`, and a background warm-up in `scripts/dev-services.mjs`. **That warm-up is wrong and must be replaced** (see finding 3).
2. Read the brief, and read these files completely: `assistant/{types,ollama,chain,providers,runtime,queue,service,config,uploads}.ts`, part of `documents.ts`.
3. **Baseline measured** (Docker Ollama 0.35.0, `qwen3.5:9b`, `num_ctx 8192`, `think:false`, via `scratchpad/baseline.mjs`; script is in
   `C:\Users\alvi9\AppData\Local\Temp\claude\D--LearnThriveSoftware\debf001c-0cb5-4bb2-b111-1872522d975e\scratchpad\baseline.mjs`, recreate if gone):
   - first request after a "warm-up": wall 251 s, load 193 s, prompt eval 36 s (a **reload**, see finding 3)
   - warm text: first visible 0.3-0.4 s, 34-40 tok/s
   - first photo (643 prompt tokens): prompt eval 6.5 s, first visible 7.4 s; same photo again 0.22 s (prompt cache); text follow-up about the photo 0.35 s
   - two concurrent requests: the second waits for the first (5.4 s to first token)
   - GPU while loaded: ~7.4 GiB used of 8 (Docker Ollama 5.6 GB + voice sidecar ~1 GB + desktop), only ~600 MiB free
4. Verified the candidate tags exist in the registry (HTTP 200): `bonsai-2:9b`, `laya:421m-typed-decisions-bf16`, `embeddinggemma-2:270m-q8_0-text`. **Not yet pulled.**
5. Downloaded the official Windows build `ollama-windows-amd64.zip` v0.40.9 to `D:\OllamaRuntime\ollama-0.40.9-windows-amd64.zip`, **SHA-256 verified**
   (`c35019c9...ea0b`, matches the GitHub release digest), extracted to `D:\OllamaRuntime\0.40.9\` (`ollama.exe` + `lib\`). `ollama.exe --version` client says 0.40.9.
   The installed 0.35.0 app is untouched (rollback).
6. **Stopped the Docker Ollama container** (`docker compose -f config/compose.yaml stop ollama`) and ran `docker update --restart=no learnthrive-ollama-1` so it does
   not grab port 11434 again. The `learnthrive-voice-1` container (whisper on GPU) and the Supabase stack are still running. At the last check nothing listened
   on 11434 and VRAM used was ~1 GiB (voice + desktop), 6996 MiB free. **No native Ollama server is running yet.**
7. Fetched and read the official docs (use `curl -sL https://docs.ollama.com/<path>.md`):
   - **System One** `POST /v1/systemone`: body `{model, state (string or JSON), images?, questions: {name: {type: "choice"|"noul"|"score", instructions, criteria}}, keep_alive?}`;
     choice criteria is an object of option -> description (2 to 255 options); `noul` is yes/no with optional `criteria: {true,false}`; `score` criteria is an ordered array (2 to 10).
     Response `{model, answers: {name: {type, choice, probabilities, confidence}}, usage: {input_tokens, output_tokens}}`. **No streaming, no tools, no num_ctx/num_gpu/temperature/num_predict.**
     Local text+schema must fit 64 KiB and the loaded context; input is never truncated. Needs Ollama >= 0.35.0 (the laya library page says >= 0.40.0). Supports `keep_alive`.
     The exact `noul` and `score` answer shapes were not seen yet; discover them empirically after pulling laya.
   - **Thinking**: `/api/show` returns a top-level `thinking: {values: [...], default}`; `values` can be booleans or level strings; `[false]` means unsupported; `think` request field can be
     true/false/null/a level string. Chat returns `message.thinking` separately from `message.content`.
   - **Tool calling**: assistant message carries `tool_calls: [{function: {name, arguments}}]`; the result goes back as `{role: "tool", tool_name, content}`.

## Key findings so far (use these in the write-up; they answer the brief's "reproduce the timeout")

1. **The model load is slow because Docker bind-mounts `D:\OllamaModels` through WSL's Windows-drive mount** (`config/compose.yaml`, `OLLAMA_MODELS_DIR`). llama.cpp mmaps the 5 GB file
   over that mount: cold load measured **215 s** (and two other loads were aborted after 4+ minutes). The container log shows `Load failed ... timed out waiting for llama-server to start: context canceled`.
   Running Ollama **natively on Windows from `D:\OllamaModels`** should fix it. Not yet measured natively: do that measurement (cold load of `qwen3.5:9b` and of the new models).
2. The app's first-answer timer (45 s text) starts before `/api/chat`, so it spans model load plus prompt/image evaluation, and the owner's photo request ("check my working" on an arithmetic-sequence
   photo) failed with "That took too long". My earlier fix only lengthened picture limits; the brief explicitly says not to just raise timeouts.
3. **Context/option changes force a reload.** The previous warm-up sent `keep_alive` but not `num_ctx`; `/api/ps` showed the model loaded, yet the app's first request (`num_ctx 8192`) triggered a
   full 193 s reload. **A warm-up must send exactly the load-affecting options the real requests use** (`num_ctx`, `keep_alive`, flash-attention/KV settings, `num_parallel` is server-level).
   `scripts/dev-services.mjs` currently spawns a warm-up with no `num_ctx`: fix it (or replace it with the shared warm-up manager below).
4. `service.ts` re-attaches the earlier turn's files on every follow-up (a follow-up with no new files re-reads/renders them), so images are re-sent and the prompt cache prefix breaks. Measure and reduce.
5. Capability lookups are cached forever, including failures (`ollama.ts` `shown` map): a transient failure becomes a permanent "no vision".
6. `OllamaProvider` never sends `keep_alive`, ignores `thinking`/`tool_calls` chunks (no activity signal, no tool round trip), and drops Ollama's duration metrics.

## What remains (the whole implementation; nothing below is built yet)

Follow the brief's sections 3 to 14. Concrete plan and design decisions I had settled on:

A. **Serving arrangement (Windows).** Native GPU server from `D:\OllamaRuntime\0.40.9\ollama.exe serve` on `127.0.0.1:11434` with process env
   `OLLAMA_MODELS=D:\OllamaModels`, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_KEEP_ALIVE=30m` (benchmark flash attention / `q8_0` KV cache as experiments only). Helper server on
   `127.0.0.1:11435` with `CUDA_VISIBLE_DEVICES=-1` (scoped to that process only), same `OLLAMA_MODELS`, for the embedding and decision models; verify it uses no VRAM and does not evict the tutor.
   Write `scripts/ollama-local.mjs` (start / stop / status / warm; prevent duplicate listeners; detached; PID files under `.ollama-local/` which must be git-ignored) and make
   `scripts/dev-services.mjs` prefer it over the Docker `ollama` service (keep Docker as a fallback, and keep the voice container). Voice stays in Docker and uses ~1 GB VRAM: count it in headroom.
   Target >= 1.5 GiB free VRAM at peak image requests.
B. **Pull models** (authorised by the brief): `bonsai-2:9b`, `bonsai-2:4b`, `embeddinggemma-2:270m-q8_0-text`, `laya:421m-typed-decisions-bf16`. Record digest, size, format, quantisation,
   capabilities from `/api/show`, and check with `ollama --version` on the new binary. If Bonsai's backend is unsupported on this CUDA machine, fall back per the brief (`qwen3.5:4b-q4_K_M`).
   Keep `qwen3.5:9b` installed (rollback), never resident together with the new tutor.
C. **Provider changes** (`apps/web/src/lib/assistant/`): extend `types.ts` (tool role and `tool_calls` on messages; chunks for `activity` (thinking / tool call), `tool_call`, `metrics`; options for
   `keepAlive`, `think` (bool or level), `tools`, staged deadlines); rewrite `ollama.ts` stream to parse `message.thinking`, `message.tool_calls`, convert `*_duration` ns to ms, send `keep_alive`, keep
   `num_ctx` consistent; capability cache keyed by endpoint/model/digest with a short retryable failure cache; read `thinking.values/default` from `/api/show`. Keep `FallbackProvider` (`chain.ts`) working
   and keep the mock provider (`mock.ts`) for tests. **No hosted fallback in the local profile.**
D. **Staged deadlines** in `service.ts`/provider: queue wait, model readiness/load, prefill, first activity, first visible answer, tool time, idle stream, and one absolute whole-turn deadline that tool rounds
   and retries do not reset. Use a shared **warm-up manager** (`globalThis` singleton, one in-flight warm-up per endpoint/model/options) called at service start (`dev-services`) and before a turn when `/api/ps`
   shows the model not resident; emit an honest "preparing model" event only when evidenced. Preserve cancellation and queue-permit release (see `queue.ts`). Never fabricate percentages.
E. **Tool calling**: bounded round trip (2-3 rounds) through the provider interface; read-only allowlist grounded in the repo: `get_question_region` (authorised uploaded document question/page text),
   `search_document` (retrieval), `check_calculation` (reuse `apps/web/src/lib/paper/maths.ts` / `mathsEvidence.ts`). Arguments can never name another learner/file: the server resolves the owner/files from the
   authenticated actor. Validate sizes, treat results as untrusted data. Test vision, tools, thinking singly and together; do not claim they work together without that test.
F. **Embeddings**: `POST /api/embed` adapter (batching, finite vector and dimension validation, model-appropriate prefixes verified from the model's own page/modelfile), on the helper endpoint.
   Authorised chunk index only if none exists (none does; the `0002` migration comment mentions a pgvector placeholder that was never created): new migration `0014` (server-only, RLS forced, owner/client/student
   scoped, cascade with the source `chat_files`, store `model`, `digest`, `dimension`, `chunk_config_version`, embedding as `real[]`; cosine in app code over owner-filtered candidates) with memory+SQL repos and a
   contract test in `packages/data/src/testing/libraryContract.ts` style; chunk on question boundaries using `apps/web/src/lib/paper/questions.ts` structure; index in the background with a low-priority bounded queue;
   exact question-label lookup before semantic search; reject oversized input explicitly. Add the migration to `packages/data/src/schema.test.ts` (`EXPECTED_TABLES`, `FORCED_TABLES`, migration list) and
   `apps/web/scripts/supabase-verify.mjs`. Retention: follow `docs/RETENTION_AND_DELETION.md` (uploads 7 days).
G. **Decision model** (`/v1/systemone` adapter, direct HTTP, no SDK): compact intent set (general chat, explain a question, search authorised material, solve a paper, clarify). Explicit UI actions and file
   metadata win; only ambiguous routes call it; validate probabilities; on timeout/unavailable/low confidence use deterministic routing or the plain tutor path. It must never decide auth, billing, consent,
   file ownership, tool authorisation, safeguarding or correctness. Keep its input tiny (the laya tag lists `num_ctx=1024`: verify the loaded context with `/api/ps`).
H. **Config/registry**: add role-specific env vars (embed/decision model + base URL + keep-alive, thinking policy, stage timeouts, image budgets, headroom target) in
   `config.ts` and `apps/web/scripts/env-registry.mjs` (regenerate `docs/ENVIRONMENT.md`). Initial profile per the brief: `ASSISTANT_MODEL=bonsai-2:9b`, `ASSISTANT_VISION_MODEL=bonsai-2:9b`, `ASSISTANT_CONTEXT=4096`,
   `ASSISTANT_CONCURRENCY=1`; this is only a candidate until measured. Replace the two picture timeout variables I added with the staged budgets (keep working names documented or remove cleanly, with tests updated).
I. **Image pipeline**: `documents.ts` already resizes photos (`photoLongSide` 1600) and renders pages (`renderLongSide` 1400, `imagesPerMessage` 3). Benchmark ~1024-1400 px; stop re-sending earlier files on follow-ups
   (store a per-file text transcription/provenance and only re-attach a crop when needed); keep original source.
J. **Benchmark runner** `apps/web/scripts/ollama-bench.mjs` (+ `package.json` script `ollama:bench`): generate original fixtures at run time with `@napi-rs/canvas` (no copyrighted papers, no student data);
   profiles qwen3.5:9b vs bonsai-2:9b vs bonsai-2:4b (qwen3.5:4b only if warranted); cases listed in brief section 13 (cold/warm text and photo, follow-up, two concurrent, thinking on a hard question, a real and a
   disallowed tool call, PDF follow-up, idle-then-request, cancel, missing model, helper failure, restart, retrieval hit-rate with known relevant chunks, held-out routing set). At least 10 warm runs per interactive case and
   several cold starts; report counts; record digests, context, VRAM (sample `nvidia-smi --query-gpu=memory.used,memory.free,temperature.gpu,power.draw,utilization.gpu --format=csv`), CPU/RAM. Write sanitised results
   to `docs/benchmarks/ollama-results.json` and a readable `docs/OLLAMA_BENCHMARK.md`. Select the winner by quality + headroom + latency, not size.
K. **End-to-end proof** of the original failure: send a non-sensitive photo of a worked arithmetic-sequence answer (generate one with `@napi-rs/canvas`) through the real chat route against the new stack, cold
   and warm, and show no timeout; capture the structured timing log (privacy-safe: no images/base64/transcripts).
L. **Docs and rollback**: `docs/OLLAMA_THREE_MODEL.md` (selected models + digests + placement, contexts, VRAM headroom, latencies, the reproduced cause and verification, setup/warm-up/status/stop commands,
   **rollback to the installed 0.35.0 app and `qwen3.5:9b` / the Docker compose Ollama**, limitations). Update `docs/ASSISTANT.md` and `README.md` start-up text. If the GPU/benchmarks cannot be completed, mark them
   untested explicitly and give exact local commands.

## Useful commands

```
# versions / state
D:\OllamaRuntime\0.40.9\ollama.exe --version
curl -s http://127.0.0.1:11434/api/ps ; curl -s http://127.0.0.1:11434/api/tags
nvidia-smi --query-gpu=memory.used,memory.free,temperature.gpu,power.draw,utilization.gpu --format=csv
docker ps ; docker compose -f config/compose.yaml stop ollama   # Docker Ollama is stopped, restart=no

# start the new native server by hand (PowerShell), model dir reused:
$env:OLLAMA_MODELS="D:\OllamaModels"; $env:OLLAMA_NUM_PARALLEL="1"; $env:OLLAMA_KEEP_ALIVE="30m"; Start-Process D:\OllamaRuntime\0.40.9\ollama.exe -ArgumentList serve -WindowStyle Hidden
# helper (CPU only, scoped env):
$env:CUDA_VISIBLE_DEVICES="-1"; $env:OLLAMA_HOST="127.0.0.1:11435"; Start-Process D:\OllamaRuntime\0.40.9\ollama.exe -ArgumentList serve -WindowStyle Hidden
```

Use the **0.40.9 `ollama.exe` client** for `pull` against the matching server (`$env:OLLAMA_HOST` selects the endpoint). Before starting the native server, confirm nothing else listens on 11434
(`netstat -ano | findstr :11434`); the owner's installed Ollama tray app, if running, would conflict.

## Honest status at handoff

Done: baseline (Docker/qwen), root-cause evidence for the slow load, runtime downloaded and verified, Docker Ollama stopped. **Not done: no models pulled, no native server started, no application code for the three
roles, tools, retrieval, decision, deadlines, scripts, benchmarks or docs.** The repo has no uncommitted changes from this task (only the owner's untracked brief files and Next's `tsconfig.json` edit). Report the
trade-offs and any blockers honestly in the final write-up; do not present untested models as selected.
