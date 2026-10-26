# Migration report: Whisper + Piper → Parakeet CTC 1.1B + Kokoro 82M

Date: 26 October 2026. Machine: the development laptop only (Windows 11, Ryzen 7 5800H, RTX 3070 Laptop 8 GB, 64 GB RAM). This report is the record of what was installed, what was measured, what was NOT measured, and whether the new pipeline is genuinely ready as the **local development** default. It is deliberately not an advert: the headline result is that recognition improved on both accuracy and speed, while **speech output became noticeably slower to start** in exchange for a more natural voice.

Related: [VOICE.md](VOICE.md) (how voice works, how to set it up), [VOICE_BENCHMARK.md](VOICE_BENCHMARK.md) (generated tables), [../apps/web/THIRD_PARTY_NOTICES.md](../apps/web/THIRD_PARTY_NOTICES.md) (licences).

## 1. What was installed, exactly

| Piece | Exact artefact | How it was verified |
| --- | --- | --- |
| Recogniser runtime | NVIDIA NeMo-Speech.cpp **0.2.0**, `nemo-speech-0.2.0-windows-x86_64-cuda.zip`, extracted to `services/voice/vendor/nemo-speech/nemo-speech-0.2.0-windows-x86_64-cuda/` | Archive SHA-256 `9ffe5e842c39a7d3211f3b2c3b3aa1bca8c0b2455d96d961ed5f22ec5108f98d`, recorded in `vendor/check.sha256` and matched before extraction. The CPU archive `nemo-speech-windows-cpu.zip` (SHA-256 `82c80451086e86194aba9af19f800da77cd66d1c28d993d0efceffd6cdb49bb8`) is extracted beside it as the no-CUDA fallback. |
| Recogniser weights | `nemo-speech`'s quantised conversion of **`nvidia/parakeet-ctc-1.1b`**: `parakeet-ctc-1.1b.q8_0.gguf`, 1 178 100 960 bytes, in `services/voice/models/` | SHA-256 `6584fc0fdacf1c220401ea4c3a1d5b44454b655c141cb8672178072c203d92b8`. The runtime is served by NVIDIA's own program; nothing was converted here. |
| Speech output | **Kokoro 82M v1.0** weights `kokoro-v1.0.onnx` (325 532 387 bytes) and `voices-v1.0.bin` (28 214 398 bytes) from the `kokoro-onnx` release, plus the `kokoro-onnx` 0.6.1 Python package | Downloaded from the package's release; not re-hashed (no published digest was checked — a gap, see §10). |
| Rollback engines | faster-whisper (Whisper `small.en`/`base.en`/`small`/`medium.en`) and Piper `en_GB-alba-medium`, exactly as before the migration | Unchanged files, unchanged code path. |

Neither the runtime nor any model is committed: `services/voice/{vendor,models}` are ignored, and `node scripts/parakeet-local.mjs` starts the runtime from the extracted folder.

## 2. Runtime selected, and why

- **NeMo-Speech.cpp, not Riva/NIM and not a Python framework.** It is NVIDIA's own lightweight native runtime for Parakeet, it is one binary plus DLLs, and it exposes an OpenAI-compatible `/v1/audio/transcriptions` on loopback. Riva/NIM would have needed containers and a much larger GPU footprint than this 8 GB laptop has.
- **Parakeet CTC 1.1B, not RNNT/TDT 1.1B.** The CTC checkpoint is the one NVIDIA ships a quantised GGUF for in this runtime, and the measured accuracy on the school-maths set is strong (below). The RNNT/TDT variants were not benchmarked: nothing here showed them to be needed, and the runtime's documented model support made CTC the supported path on Windows.
- **Kokoro through `kokoro-onnx` on the CPU**, because the ONNX graph is 325 MB, the CPU has room, and the GPU has none (see §4).
- **Punctuation restoration deliberately not added.** Parakeet CTC returns lower-case words without punctuation. NVIDIA's documented upgrade is PnC BERT, which means another checkpoint and another conversion step; guessing a question mark or a comma could change what a maths question looks like, and the app sends the words to a tutor that is robust to a missing "?". The words are returned exactly as recognised, with only the first letter capitalised.
- **Word boosting deliberately not sent.** `speech_contexts`/`prompt` boosting is documented to apply to flashlight CTC decoding, not greedy CTC without a language model: sending it would have looked like vocabulary help and done nothing.

## 3. How the models are loaded and cached

- The sidecar (`services/voice/server.py`, via `speech/select.py`) builds **one** recogniser and **one** synthesiser at startup. Nothing is loaded per request.
- Parakeet: `speech/parakeet.py` spawns `nemo-speech serve --asr-model … --device cuda:0` **once** as a child process on `127.0.0.1:8791`, waits for its `/ready`, reads the device **the runtime reports** (not the flag it was asked for), makes one silent warm-up call, and keeps the process for the life of the sidecar. `VOICE_PARAKEET_URL` makes it adopt a runtime someone else started (this is how the Docker sidecar reaches the Windows host binary), and `stop()` kills only a child it started.
- Kokoro: `speech/kokoro.py` loads the ONNX session once and synthesises "Ready." as a warm-up, and reports the `kokoro-onnx` version and voice in `/health`.
- Measured cold start of the whole sidecar: **ready in 8.3 s** (runtime spawn + model load 5.7 s, Kokoro ~2 s), warm recognition 28 ms per `/health`.
- The fallback is never silent: when the runtime or the GGUF is missing, the sidecar builds faster-whisper instead and records `fallback: { from: "parakeet", reason: … }` in `/health` (same for Kokoro → Piper). `VOICE_FALLBACK_ENABLED=false` turns that into a hard failure.

## 4. GPU and CPU allocation (the 8 GB question)

Configuration chosen: **A** — Parakeet on the GPU, Kokoro on the CPU, the tutor model (Ollama) on the GPU.

| Measurement | Value |
| --- | --- |
| Parakeet VRAM while loaded | **1655 MB** (runtime-reported device `cuda:0`) |
| Tutor model plus Parakeet plus desktop, during the pipeline benchmark | **7952 MiB of 8192 used**, i.e. no headroom |
| Parakeet sidecar RSS growth | 3 MB (the model lives in the child process) |
| Kokoro | CPU only; the ONNX session's memory is inside the sidecar process |

Configuration **B** is available and measured: `VOICE_STT_DEVICE=cpu` runs the same GGUF on the CPU at 2.5% word error and **423 ms** median per clip (against 29 ms on the GPU), freeing the GPU for the tutor. That is the honest second choice when something else needs the card. Configurations **C** (offload/quantise further) and **D** (hosted tutor) were not needed and not measured: the migration must not change the tutor's provider.

Nothing here claims a GPU that was not used: `/health` reports the runtime's own answer, and the CPU run says `cpu`.

## 5. Benchmark results

Full tables: [VOICE_BENCHMARK.md](VOICE_BENCHMARK.md); raw JSON in `docs/benchmarks/`. **All speech is synthetic** (text-to-speech voices, 30 school-maths-and-science phrases, 7 voices, clean and at 15 dB SNR): recognition scores are optimistic and no child's voice was used.

Recognition (same clips for every engine):

| Engine | Device | WER clean | WER noisy | Terms found | Median | p95 | Real-time factor | VRAM | Load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Parakeet CTC 1.1B** | cuda:0 | **1.6%** | **3.0%** | 94.2% | **29 ms** | 56 ms | 0.011 | 1655 MB | 5.7 s |
| **Parakeet CTC 1.1B** | cpu | 2.5% | 4.1% | 90.9% | 423 ms | 581 ms | 0.147 | — | 6.8 s |
| whisper `small.en` (rollback) | cuda | 1.8% | 3.1% | 97.4% | 119 ms | 141 ms | 0.043 | 576 MB | 0.8 s |
| whisper `base.en` (rollback) | cuda | 4.3% | 5.9% | 96.1% | 61 ms | 78 ms | 0.022 | 283 MB | 0.5 s |

Speech output, engine alone (first chunk = "Good question. Let us look at it.", median of 5 after warm-up):

| Engine | Voice | First chunk | Longer (86 chars) |
| --- | --- | --- | --- |
| Piper | `en_GB-alba-medium` | 98 ms | 116 ms |
| Piper | `en_GB-jenny_dioco-medium` | 72 ms | — |
| Kokoro | `bf_emma` | **750 ms** | 1 812 ms |
| Kokoro | `bm_george` | 849 ms | — |

Whole pipeline, end of speech → first spoken audio, the tutor (`qwen3.5:9b`) answering real voice-mode prompts, same phrases for both rows:

| Configuration | Recognition | Tutor first token | First sentence ready | First speech clip | **Total median** | p95 | VRAM in use |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Parakeet + Kokoro (new)** | 124 ms | 567 ms | 1 066 ms | **2 049 ms** | **3 241 ms** | 5 487 ms | 7 952 MB |
| whisper `small.en` + Piper (old, from git) | 151 ms | 354 ms | 595 ms | 162 ms | **908 ms** | 1 191 ms | 7 317 MB |
| whisper `base.en` + Piper (old, from git) | 588 ms | 370 ms | 722 ms | 204 ms | 1 610 ms | 1 716 ms | 6 601 MB |

Live page, Chromium's fake microphone, the real routes, Parakeet on the GPU (five utterances; each one transcribed correctly and sent by itself within 1–3 ms):

| Said | Recognition | End of speech → first spoken clip |
| --- | --- | --- |
| What is three quarters of twenty four? | 415 ms | 7 441 ms (cold: first synthesis of the session) |
| Solve two x plus seven equals nineteen. | 226 ms | 4 622 ms |
| What does gradient mean on a graph? | 213 ms | 4 488 ms |
| same question again (warm) | 200 ms | 4 098 ms |
| same question again (warm, different answer) | 212 ms | 4 504 ms |

**The trade-off, plainly.** Recognition is faster and more accurate than before (0.03 s on the GPU; the pipeline's own recognition step 124 ms against 151 ms). Speech output is the regression: Kokoro on this CPU synthesises at roughly real time, so a first sentence whose audio lasts 2.5 s costs about 2.5 s before the student hears anything, against Piper's ~0.1 s. Time to first audio therefore went from **~0.9 s to ~3.2 s** in the controlled pipeline benchmark and about **4.5 s** in the live page (which includes the 0.9 s end-of-turn wait, the tutor's own first sentence, and one cold synthesis). Partial mitigations already in the code: the first spoken chunk is capped at a natural pause (so a very long opening sentence is not one 3-second clip), and later chunks are synthesised while the previous one plays. Remaining options, in order of cost: `VOICE_TTS_ENGINE=piper` (instant, less natural), a GPU `onnxruntime` for Kokoro (no room in 8 GB beside the tutor and Parakeet), or asking the voice prompt for a shorter first sentence.

## 6. Mathematical and science transcription

On the synthetic set Parakeet found **94.2%** of the maths and science terms (whisper `small.en`: 97.4%), with word error 1.6% clean — the best clean score measured. Its misses are ordinary and instructive, not maths-specific:

- said "i am stuck on question four of my homework" → heard "i'm stuck on question four of my homework" (a spelling contract, not an error of meaning);
- said "how do i round four point six seven to one decimal place" → heard "how do **around** four point six seven to one decimal place";
- said "please explain pathetic fallacy" → heard "please explain **prophetic** fallacy".

Per-voice word error on the same clips: 1.2% (Kokoro `bf_emma`) to 3.9% (Piper `jenny_dioco`) — the synthetic speaker matters more than the engine difference between Parakeet and `small.en`.

Because a tutor mishearing "squared" as "cubed" is worse than a slower send, the page now keeps a **risky-maths confirmation** even when confidence is high: an utterance containing "squared/cubed", "sine/sign", "negative/minus", spelled-out fractions or "fifteen/fifty" is never auto-sent; it asks "Did I hear that right?" with Send, Try again and Edit. Ordinary phrasing still auto-sends (measured: transcript → sent in 1–3 ms).

## 7. Confidence: what the runtime really provides

The runtime's `verbose_json` answer carries **per-word confidences** (and mean token posteriors). The adapter averages the words when it can, and reports `confidenceSource` as `words` or `none` — it never invents `1.0`. Measured on the clean synthetic set: median word confidence 0.996 (cuda) and 0.994 (cpu); the field is present, so the confidence-based confirmation in the page stays enabled rather than being replaced by a guess. If a runtime ever answers without scores, the page simply relies on silence, length and the risky-maths pairs.

## 8. Voice quality findings

A person still has to judge this by ear; what can be said from the migration is: `bf_emma`, the highest-graded British English Kokoro voice, is the default (configurable with `VOICE_TTS_VOICE`; `bm_george` measured too, 849 ms first chunk), Piper's `en_GB-alba-medium` remains one setting away, and the maths-to-speech layer that decides how `x²`, `dy/dx`, `f'(x)`, `√25`, `\sin θ`, limits, integrals and sums are said aloud was extended and is covered by tests (including new readings: `\sin \theta` → "sine theta", `f'(x)` → "f prime (x)", `\lim_{x \to 0}` → "the limit as x approaches 0", `\int_0^1` → "the integral from 0 to 1 of …", `\sum_{n=1}^{10} n` → "the sum from n equals 1 to 10 of n"). The displayed answer keeps its notation; only the spoken form is words.

## 9. Known issues and deliberate omissions

1. **First-clip latency** (§5) — the single real regression. Quantified rather than hidden.
2. **No punctuation from Parakeet** — no PnC BERT; sentences reach the tutor unpunctuated (the migration's acceptance tests accept this).
3. **8 GB is tight** — the measured pipeline peak was 7 952 MiB of 8 192. Anything else large on the GPU will push the tutor into system memory.
4. **The Docker sidecar cannot run the runtime** — it is a native Windows binary; the container reaches the host at `host.docker.internal:8791` and falls back to Whisper (saying so in `/health`) when there is nothing there. A Linux container on a Linux host would need a runtime built for it.
5. **Windows port 8765 can be reserved** — the sidecar then exits with `WinError 10013`; set `VOICE_PORT`/`VOICE_URL` to another port.
6. **Unit tests never load a real engine** — and now they cannot by accident: `tests/test_speech.py` installs guards that fail loudly if a test reaches the real `ParakeetCtc` or `WhisperRecogniser` (an early version of the file started a real runtime and left it running; that is how the guard came to exist).
7. **Synthetic speech only** — no child's voice, no classroom noise, no accents; the VAD question (Silero/WebRTC) was considered and **not** benchmarked here.
8. **Kokoro files were not checksum-verified** (no published digest was checked) — the only artefact in this migration without one.

## 10. Licensing implications

| Component | Licence | Consequence |
| --- | --- | --- |
| NVIDIA NeMo-Speech.cpp 0.2.0 | Apache-2.0 | Permissive; keep the notice. Its build bundles NVIDIA CUDA runtime libraries with their own terms. |
| `nvidia/parakeet-ctc-1.1b` weights (Q8 GGUF conversion) | **CC-BY-4.0** | Commercial use allowed **with attribution** to NVIDIA; the attribution is recorded in `THIRD_PARTY_NOTICES.md`. |
| Kokoro 82M v1.0 weights | Apache-2.0 (model card; it states its training audio was permissive/public-domain or synthetic from closed models) | Permissive; keep the notice. |
| `kokoro-onnx` 0.6.1 | MIT | Permissive. |
| `phonemizer` 3.4.0, `espeakng-loader` 0.2.4 (bundles espeak-ng) | **GPL-3.0** | Still the reason the sidecar must be treated as a separate local development program: shipping or hosting it needs advice. Replacing Kokoro's phonemiser with a permissive one is the future fix if Kokoro is ever productised. |
| Piper 1.8.0 (rollback), faster-whisper/Whisper (rollback) | GPL-3.0-or-later / MIT | Unchanged from before. |

**Production voice remains closed.** Nothing here changes hosting, privacy, safeguarding or the processor decision that plan19 section 6 reserves to the owner; the new engines are a local development default only.

## 11. Rollback procedure

```bash
# in the sidecar's environment (services/voice/.env or the compose file), then restart it:
VOICE_STT_ENGINE=whisper VOICE_TTS_ENGINE=piper      # both engines of the pre-migration pipeline
VOICE_STT_ENGINE=whisper                             # recognition only (Piper stays off Kokoro automatically if its files are missing)
VOICE_FALLBACK_ENABLED=false                         # make a missing engine a hard failure instead of a reported fallback
```

`GET /health` after a rollback names the engine that is running and, when a fallback happened, what was tried and why. No site code, route or test depends on which engine answers: the frontend only learns what `/health` and `/stt` honestly report.

## 12. Commands used, and their results

| Command | Result |
| --- | --- |
| `cd services/voice && uv run python -m unittest discover -s tests` | **17 tests, OK, 4.9 s** (engine selection, fallback reporting, HTTP adapter against a stand-in server, audio, transcript parsing, first-chunk chunking of speech text). No test loads a real model. |
| `cd services/voice && uv run python bench.py --phrases …/voice-phrases.json --out docs/benchmarks/voice-engines.json --merge --only parakeet…/cuda,parakeet…/cpu` | Wrote the two Parakeet rows merged with the existing whisper/Piper/Kokoro rows: 1.6%/29 ms on the GPU, 2.5%/423 ms on the CPU, 420 and 60 clips. |
| `cd apps/web && npm run voice:bench -- --skip-engines --stt parakeet/cuda --model qwen3.5:9b --runs 6` | Wrote `docs/benchmarks/voice-pipeline.json` and regenerated `docs/VOICE_BENCHMARK.md`: 3 241 ms median, p95 5 487 ms, VRAM 7 952 MB. |
| `VOICE_PORT=8766 uv run python server.py` then `curl /health` | `stt parakeet, device cuda:0, loaded, warmMs 28`; `tts kokoro bf_emma cpu, loaded`; ready in 8.3 s. |
| `node scripts/voice-live-check.mjs --base http://localhost:3111 --voice http://127.0.0.1:8766 --say "…"` × 5 | Every question transcribed correctly, auto-sent in 1–3 ms, first clip 4.1–7.4 s (table in §5). Chromium's fake microphone, the real page, the real sidecar, real Parakeet, real Kokoro, real Ollama. |
| `cd apps/web && npm run test` | **934 tests, 0 failures** (30.9 s), including the new speech/chunking, voice-trust and environment-registry tests. |
| `cd apps/web && npm run env:docs` | Regenerated `docs/ENVIRONMENT.md` (and `.env.example` names only) with the new sidecar variables. |

Known failing or skipped checks: none were skipped silently. The Playwright browser suite was **not** run in full for this migration (it uses `VOICE_PROVIDER=mock`); the live check above exercises the same UI with the real engines, which is the stricter test. No human listening test was performed, and the Kokoro files were not checksum-verified.

## 13. Is the new pipeline ready as the local development default?

**Recognition: yes.** Parakeet CTC 1.1B is more accurate than `small.en` on the same synthetic set (1.6% against 1.8% clean, 3.0% against 3.1% noisy), four times faster per clip, keeps its model loaded, reports its real device, and falls back to the previous engine with a visible reason. It is the default (`VOICE_STT_ENGINE=parakeet`, rollback one variable away).

**Speech output: yes, as the default, with the latency trade-off declared.** Kokoro is the more natural voice the brief asked for and is now `VOICE_TTS_ENGINE=kokoro` with `bf_emma`; it costs ~2.3 s more time-to-first-audio in the pipeline benchmark and about 2 s more on the live page than Piper did. That is a real user-visible cost, so it is recorded here, in [VOICE.md](VOICE.md) and in the generated benchmark, and Piper stays one variable away. If the owner decides the speed matters more than the voice for real students, the rollback is a single setting — no code change, no redeploy.

**Definition of done from the brief** (open the app, talk, get an answer, interrupt, continue, close) was exercised by the live check with the new engines: the questions were transcribed, sent automatically, answered by the tutor, spoken by Kokoro, and the panel's states (Listening, Speaking, "Listening…" again after an answer while Keep listening is on) behaved as before. What remains human is the listening judgement: whether `bf_emma`'s voice and the extra second or two are the right trade for LearnThrive's students.
