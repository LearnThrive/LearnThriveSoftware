# LearnThrive AI's local models: measured, and the selection

This is the readable result of the three-model brief's benchmark (section 13). The numbers themselves are **generated**, never
hand-written: [`docs/benchmarks/ollama-summary.md`](benchmarks/ollama-summary.md) and
[`docs/benchmarks/ollama-results.json`](benchmarks/ollama-results.json) come from `npm run ollama:bench`, and
[`docs/benchmarks/ollama-quality.json`](benchmarks/ollama-quality.json) from its `--quality-only` mode. This page explains what
those runs show and which model was chosen. Re-run the commands at the bottom rather than trusting a copy of a table.

Run: 2026-10-23, 11:55-12:02 (timings) and 14:23 (quality set). Machine: Ryzen 7 5800H, 16 CPUs, 63 GiB RAM, RTX 3070 Laptop
(8192 MiB, driver 617.42), Windows 11, Ollama 0.40.9 natively from `D:\OllamaRuntime\0.40.9`, models in `D:\OllamaModels`,
`num_ctx` 4096, `keep_alive` 30m. Nothing else was using the GPU (Docker, and so the voice sidecar, was not running).

## The selection

| Role | Selected | Digest | Where |
| --- | --- | --- | --- |
| Tutor (vision, tools, thinking) | `bonsai-2:9b`, Q2_0, 2.96 GiB | `c8b5462f8688…d388e` | RTX 3070, one model resident |
| Embeddings | `embeddinggemma-2:270m-q8_0-text`, Q8_0, 528 MB, 768 dimensions | `c21dd30c1e38…bbf` | CPU, separate process on `:11435` |
| Typed decisions | `laya:421m-typed-decisions-bf16`, 806 MB | `84a7be5dd978…4d1` | CPU, same helper process |

`qwen3.5:9b` stays installed as the rollback; `bonsai-2:4b` stays installed as the measured speed profile. Only one of them is
ever resident, and never beside the tutor.

## Why the 9B, when the 4B is faster

| | `qwen3.5:9b` | `bonsai-2:9b` | `bonsai-2:4b` |
| --- | --- | --- | --- |
| Cold load (evicted first, n=1) | 8521 ms | 7380 ms | 8314 ms |
| Warm text, first answer (n=10) | 108.8 ms | 84.3 ms | 60.1 ms |
| Photo, first answer (n=5) | 6830.5 ms | 936.2 ms | 575.3 ms |
| Photo, diagram + table (n=5) | 8767.5 ms | 1145.9 ms | 618.5 ms |
| Decode (median) | 53.1 tok/s | 86.5 tok/s | 120.5 tok/s |
| Free VRAM at the worst measured moment | 147 MiB | 2755 MiB | 4155 MiB |
| Exact-answer set (6 questions x 3 runs) | 18/18 | 18/18 | 16/18 |
| Thinking, hard proof, total (n=3) | 13000 ms | 8310 ms | 5703 ms |

The card targets **at least 1.5 GiB free under peak image work**. `qwen3.5:9b` misses it by two orders of magnitude (147 MiB
free, 7870 MiB used) and its first photo answer takes 6.8-8.8 s before a word appears; that is also the configuration whose cold
load through Docker took 215-251 s.

`bonsai-2:9b` answers a photo in about 0.9-1.1 s, keeps 2.7 GiB free, decodes at 86 tok/s, and matched Qwen on every exact-answer
question. `bonsai-2:4b` is 30-40% faster again and has 4 GiB free, but it lost two of three runs on "solve `3x - 5 = 16`" (it
answered `1`, not `7`) and misread `2√5` as `2^5` in the rotated photo. Speed that produces a wrong answer is not a win for a
tutor, so the 4B is documented as the profile to switch to when latency matters more than that arithmetic, not the default.

The remaining picture-case evidence, read by eye from the stored sample answers (one per case, not a graded set):

- `bonsai-2:9b` read `2√5 + 3√2` and `√144` correctly and gave decimal working; `bonsai-2:4b` turned `2√5` into `2^5`;
  `qwen3.5:9b` turned `2√5` into `2×5`. All three answered the arithmetic-sequence photo, the diagram (`x = 10`, Pythagoras) and
  the "check step 2" follow-up correctly.
- No answer invented labels that were not in the diagram fixture.

## What else was measured

- **Tools** (through the same executor the chat uses): 3 of 3 offered tool calls were made and completed on every model; an
  adversarial `run_shell` call was refused as `unknown_tool` on every model. Cancellation stopped after the first token, a
  missing model returned `bad_request`, and an unreachable embedding helper returned `unavailable` - each once, on each model.
- **Two requests at once**: the second waits for the first (one GPU, one answer); per-request figures are in the JSON.
- **Embeddings**: 8 chunks indexed in 7.7 s, query embedding median 19.5 ms (n=6), retrieval hit@1 6/6 and hit@4 6/6 on an
  authored set. This is a pipeline smoke test, not a claim about real Library material.
- **Typed decisions**: `laya` answered 3 of 12 held-out routes, abstaining on 9, and was right on all 3 it answered; median
  latency 29.2 ms. That abstention rate is why the routing floor is now the chosen option's own probability >= 0.30 plus a
  margin >= 0.12 over the runner-up, with deterministic routing otherwise. Its slowest calls took about 5 s (p90 4.8 s, max
  5.0 s) while it was loading; the service's 4 s budget turns those into "no decision" and the deterministic route answers, which
  is not an error.

## Headroom, stated precisely

The VRAM figures above were sampled with `nvidia-smi` while both helper models were still being served **on the GPU** by the
first version of the helper process. That was a real fault, found by comparing `/api/ps` against `nvidia-smi`: this Ollama build
reaches the card through **Vulkan**, which `CUDA_VISIBLE_DEVICES=-1` does not hide, so the "CPU" helper was taking about 800 MiB.
`scripts/ollama-local.mjs` now also sets `OLLAMA_VULKAN=0` and `GGML_VK_VISIBLE_DEVICES=-1` for the helper process, and the
helper reports `size_vram: 0` with `library=cpu` in its log while the tutor holds the card. The measured free-VRAM figures are
therefore conservative: they include a helper allocation that no longer happens.

## Lifecycle, measured through the real service and the real site

`apps/web/scripts/ollama-lifecycle-check.mjs` (→ `docs/benchmarks/lifecycle-check.json`), `ollama-browser-check.mjs`
(→ `browser-check-cold.json` / `browser-check-warm.json`) and a six-run cold-start loop (→ `cold-starts.json`). One run each unless
a count is given; these are checks that the behaviour exists, not distributions.

- **Cold starts, `bonsai-2:9b`** (evicted, then loaded with the app's options, n=6): min 5.2 s, median 5.5 s, max 5.7 s.
  `bonsai-2:4b` (n=6): median 5.3 s, but one 11.4 s outlier. Compare the 215-251 s through Docker.
- **Idle expiry**: with `keep_alive` 15 s the tutor was gone from `/api/ps` after 22 s; the next turn showed "preparing", reloaded
  and answered in 7.0 s. (The shipped `keep_alive` is 30 m; the mechanism is the same, the interval is shortened to be testable.)
- **Helpers beside the tutor**: an embedding (31 ms) and a decision call (447 ms, answered) left the tutor resident, both helper
  models reported `size_vram: 0`, and the GPU's used memory did not change (3529 → 3529 MiB).
- **PDF follow-up** ("explain question 4(b)", a generated text PDF): first turn 4.7 s, 4 chunks indexed afterwards, and the
  follow-up ("why did you factorise it that way?") answered in 3.0 s without a "reading" status, i.e. without re-reading the file.
- **Two students at once**: both answered without error (2.5 s and 1.6 s); the second waited for the generation slot.
- **Backend restart**: with the servers stopped, a turn failed in 5 ms with an honest `unavailable`; after
  `ollama-local start` the next turn answered in 6.6 s (it prepared the model first).
- **The failing case in the browser** (real site, Chromium, signed in, a generated photo of a worked arithmetic-sequence answer
  attached through the page): the page showed "Reading the picture…" then "Preparing the model…", the first words appeared at
  **8.5 s cold** and **0.67 s warm**, the answer judged part (b) correct (n = 15 gives 810 > 800, n = 14 gives 707), and no
  "That took too long" appeared. The server events were `reading` → `preparing` → text → done.

## What was not measured (do not read these as done)

- Background indexing running **at the same time** as a queued Paper Tutor job, with GPU numbers. The indexer is one file at a
  time after the answer and the helper is CPU-only; their interaction with a paper job is covered by tests, not by a timed run.
- A real scanned/mixed exam PDF (the PDF above is a generated text PDF), real student handwriting, real exam-board papers, and a
  real family's messages. Routing accuracy and retrieval quality on real content are unknown.
- Voice running concurrently with a photo turn on the GPU (the speech sidecar was not running during these measurements).
- The cold-start and lifecycle figures are single runs of each check; percentiles from 5 to 10 samples are estimates and are
  labelled as such. Cold-start n=6 per model.

## Re-running it

```bash
node scripts/ollama-local.mjs start          # GPU tutor on 11434, CPU helpers on 11435
node scripts/ollama-local.mjs warm           # load with exactly the app's num_ctx
npm run ollama:bench                         # the full suite (10/5/3 runs), writes docs/benchmarks/*
node --import tsx apps/web/scripts/ollama-bench.mjs --quality-only --quality-runs=3 \
  --models=qwen3.5:9b,bonsai-2:9b,bonsai-2:4b --out=docs/benchmarks/ollama-quality.json
npm run ollama:photo-check                   # the end-to-end picture reproduction, cold and warm
npm run ollama:lifecycle                     # idle expiry, helpers beside the tutor, PDF follow-up, two students, restart
npm run ollama:browser-check -- --cold       # the same photo through the website (dev server: launch.json "study-buddy-ollama")
```

`--quick` is a smoke run (2/1/1 runs, no cold unload) and must not be reported as a result. A custom `--out` writes its own
`-summary.md` beside it, so a partial run cannot overwrite the full suite's report.

The result JSON holds timings, counts, digests, capabilities, GPU samples and short answer excerpts only: no image bytes, no
prompt bodies, no student data. Fixtures are generated at run time with `@napi-rs/canvas`.
