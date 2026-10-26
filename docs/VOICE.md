# LearnThrive AI voice mode

Voice mode lets a student talk to LearnThrive AI and hear the answer. It is **development only**: in production the code keeps it closed (`voiceClosed()` returns `production`), because a hosted speech service is a processor for a child's voice and plan19 section 6 has not chosen one. The model choice, the measured speeds and the comparison with the previous engines are in [VOICE_BENCHMARK.md](VOICE_BENCHMARK.md) and [VOICE_PARAKEET_KOKORO_MIGRATION.md](VOICE_PARAKEET_KOKORO_MIGRATION.md); the assistant itself is in [ASSISTANT.md](ASSISTANT.md).

## How it works

Talking is meant to be quicker than typing: the student speaks, and the question is sent when they stop. There is no second Send press.

1. The student presses the microphone button in the box ("Talk instead of typing"). That press opens a compact voice panel above the box (not a modal: the conversation stays in view and typing stays one tap away) and asks for the microphone, then and only then.
2. The browser captures with an AudioWorklet (`public/audio/capture-worklet.js`). The audio graph is built during the press, in parallel with the permission request, and kept while the panel is open, so the first words after the press are not lost. Each turn has its own microphone stream, stopped when the turn ends.
3. **End of turn.** An end-of-speech detector (`createEndpointer` in `src/lib/assistant/audio.ts`) follows the loudness of each ~43 ms block against an adaptive noise floor. A pause between words (under 0.9 s) does not end the turn; 0.9 s of quiet after at least 0.3 s of speech does. Eight seconds without speech stops listening; a turn longer than 30 s is ended. **Fallback:** pressing the button while listening ends the turn and sends straight away.
4. The recording (16 kHz mono 16-bit WAV, built in memory) goes to `POST /api/assistant/voice/transcribe`, behind the same gates as the chat (Origin, assistant open, signed-in adult, Library access) plus an hourly cap. The sidecar returns the words, **how many words** they are, whether there was any **speech at all** (measured from the audio), and confidence **only if the recogniser really produced one**.
5. Then, exactly once per turn (each turn has a number; a late result from a cancelled turn is ignored):
   - no words, or mostly silence: "I did not catch any words", and it listens again (twice at most, then waits for a press);
   - a **risky maths** transcription — the pairs a learner cannot recover from if the recogniser guessed wrong ("x squared" against "x cubed", "sine" against "sign", "negative three" against "three", a fraction in words) — is **never auto-sent**: it asks "Did I hear that right?" with the words and **Send**, **Try again** and **Edit**;
   - confidence under the threshold asks the same question — and that confidence is real: Parakeet's runtime reports per-word posteriors (median 0.996 on the synthetic set, `confidenceSource: "words"`). If a runtime ever answers without scores the field says `none` and the page falls back to silence, length and those risky pairs alone;
   - otherwise the words are **sent automatically** as an ordinary LearnThrive AI message, shown in the conversation like a typed one.
6. The question goes through the normal chat route with `voice: true`, which adds a short instruction to that turn's system prompt (at most four sentences, maths in words, no lists). All the usual safety applies; voice adds no way around it.
7. The answer is read aloud a sentence at a time as it streams (`src/lib/assistant/speech.ts` turns maths into words; `POST /api/assistant/voice/speak` returns each clip). **Read aloud** can be switched off, **Stop speaking** silences it, and pressing the button while it speaks **talks over it**: the speech stops, the answer stops arriving, and a new turn starts.
8. With **Keep listening** on (the default while the panel is open), the next turn starts by itself when the answer has been spoken; off, the panel waits for a press. Closing the panel switches everything off.

The states, always written out in the panel and announced politely: Tap to talk, Allow the microphone, Listening, Getting your words, Did I hear that right?, LearnThrive AI is answering, Speaking, Microphone blocked, Voice stopped. The microphone stops when a turn ends, the panel closes, the page is hidden (no recording in a background tab) or the page goes away.

If the speech service is unreachable the browser's own `speechSynthesis` reads the rest (the text never leaves the device that way). If the service is not configured at all, `/api/assistant/status` says `voice: false` and the microphone button is not shown: the screen is the full text experience.

## The engines (after the Parakeet + Kokoro migration)

| | Recogniser (speech to words) | Voice (words to speech) |
| --- | --- | --- |
| Default | **NVIDIA Parakeet CTC 1.1B**, `parakeet-ctc-1.1b.q8_0.gguf`, through [NVIDIA NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp) 0.2.0 (native, CUDA) | **Kokoro 82M v1.0**, voice `bf_emma` (British English), `kokoro-onnx` on the CPU |
| Rollback | `VOICE_STT_ENGINE=whisper` → faster-whisper `small.en` on the GPU, `base.en` on the CPU (as before the migration) | `VOICE_TTS_ENGINE=piper` → Piper, the voice on its model card |
| Fallback | automatic when the runtime or the GGUF is missing, **and `/health` says so** | automatic to Piper when Kokoro's files or its phonemiser are missing, **and `/health` says so** |

Measured on the development laptop (RTX 3070 Laptop 8 GB, Ryzen 7 5800H), 30 synthetic phrases, 7 synthetic voices, clean and at 15 dB SNR (full tables in [VOICE_BENCHMARK.md](VOICE_BENCHMARK.md)):

| Recogniser | Word error (clean / noisy) | Median per clip | VRAM while loaded |
| --- | --- | --- | --- |
| Parakeet CTC 1.1B, GPU | **1.6% / 3.0%** | **29 ms** | 1655 MB |
| Parakeet CTC 1.1B, CPU | 2.5% / 4.1% | 423 ms | — |
| whisper `small.en`, GPU (rollback) | 1.8% / 3.1% | 119 ms | 576 MB |

Parakeet is both more accurate and about four times faster here. **Kokoro is the trade-off**: its first clip takes about 750 ms for a short sentence, and effectively **real time** for a long one — a sentence whose audio lasts 2.5 s takes about as long to synthesise — against Piper's 70–160 ms. On a longer first sentence that is the difference between hearing the answer after about 1 s and after about 3–4 s (see the migration report's honest numbers). Kokoro's voice is markedly more natural, which is why it is the default; `VOICE_TTS_ENGINE=piper` restores the old speed.

## The speech sidecar (development)

`services/voice` is a small Python 3.12/3.13 program, deliberately separate from the Next app. Its engines are pluggable (`speech/select.py`); one recogniser and one synthesiser are built at startup, models stay loaded between requests, and the runtime is a child process kept alive for the life of the sidecar.

- `POST /stt` takes a 16 kHz mono WAV and returns `{ text, confidence, confidenceSource, noSpeech, processingMs, words }`.
- `POST /tts` takes `{ "text": "..." }` and returns a WAV.
- `GET /health` reports the engine that is actually loaded, the device the runtime itself reported, whether each model is loaded, the fallback and its reason, and warm-up latency. It never reports a device that was merely asked for.

```json
{"ok": true,
 "stt": {"engine": "parakeet", "model": "parakeet-ctc-1.1b.q8_0.gguf", "device": "cuda:0", "loaded": true, "warmMs": 28,
         "detail": "nemo-speech 0.2.0 (cuda:0), model parakeet-ctc-1.1b.q8_0.gguf, as a child process on 127.0.0.1:8791"},
 "tts": {"engine": "kokoro", "voice": "bf_emma", "device": "cpu", "sampleRate": 24000, "loaded": true,
         "detail": "kokoro-onnx 0.6.1, bf_emma on cpu"}}
```

### Set it up once

Models and the runtime are downloaded from their publishers and are **never committed** (`services/voice/{models,vendor}` are ignored). On Windows:

```bash
# 1. the NeMo-Speech.cpp runtime (native). Verify the SHA-256 from NVIDIA's release page before extracting, as the
#    migration report describes, into services/voice/vendor/ (the CUDA build is chosen automatically when present).
# 2. the quantised Parakeet CTC 1.1B weights (about 1.1 GB) into services/voice/models/parakeet-ctc-1.1b.q8_0.gguf
# 3. Kokoro's two files into services/voice/models/ (from the kokoro-onnx release: kokoro-v1.0.onnx, voices-v1.0.bin)
cd services/voice && uv sync
uv run python -m piper.download_voices --download-dir models en_GB-alba-medium   # only for the Piper rollback
```

The runtime can also be started on its own (`node scripts/parakeet-local.mjs start|stop|status`); the sidecar adopts one it finds already listening.

### Run it

`npm run dev` starts the site and the speech sidecar in Docker (`config/compose.yaml` → `services/voice/Dockerfile`). **The native Windows runtime cannot run inside that Linux container**, so the container reaches a runtime on the **host** at `VOICE_PARAKEET_URL` (`http://host.docker.internal:8791`, set in the compose file) and falls back to faster-whisper inside the container — saying so in `/health` — when there is no host runtime. On Linux/macOS, or with a runtime built for the container's platform, point `VOICE_PARAKEET_URL` at that instead.

Without Docker, in two terminals:

```bash
cd apps/web && npm run voice:dev     # the sidecar on http://127.0.0.1:8765 (ready in about 8 s; its first line names both engines)
node scripts/parakeet-local.mjs      # the recogniser runtime, if the sidecar did not start one itself
cd apps/web && npm run dev           # the site; it uses the sidecar already running
```

On Windows, port 8765 can be inside a reserved range; if the sidecar fails to bind, set `VOICE_PORT` to another port and `VOICE_URL` to match.

### Variables

| Variable | Meaning | Default |
| --- | --- | --- |
| `VOICE_ENABLED` | `false` turns voice off. Ignored in production, where voice is closed | on (development) |
| `VOICE_PROVIDER` | `sidecar` or `mock` (tests: a fixed transcript and a silent clip) | `sidecar` |
| `VOICE_URL`, `VOICE_TOKEN` | Where the sidecar is, and its shared secret if set (the same value must be given to both) | `http://127.0.0.1:8765`, none |
| `VOICE_PORT`, `VOICE_HOST` | Sidecar: where it listens | `8765`, `127.0.0.1` |
| `VOICE_STT_ENGINE` | Sidecar: `parakeet` or `whisper` (rollback) | `parakeet` |
| `VOICE_STT_MODEL` | Sidecar: the GGUF path or name in `services/voice/models`; a Whisper model name for whisper | `parakeet-ctc-1.1b.q8_0.gguf` |
| `VOICE_STT_DEVICE` | Sidecar: `auto` (the GPU first, then the CPU), `cuda` or `cpu`. `/health` reports what the runtime actually used | `auto` |
| `VOICE_STT_COMPUTE` | Sidecar, whisper only: `float16` on the GPU, `int8` on the CPU | engine default |
| `VOICE_PARAKEET_URL` | Sidecar: use a runtime already listening here instead of starting one (the Docker setup) | none (spawns one) |
| `VOICE_PARAKEET_HOME` | Sidecar: the extracted runtime directory when it is not under `services/voice/vendor` | best build under `vendor/` |
| `VOICE_PARAKEET_PORT` | Sidecar: the loopback port a spawned runtime listens on | `8791` |
| `VOICE_TTS_ENGINE` | Sidecar: `kokoro` or `piper` (rollback) | `kokoro` |
| `VOICE_TTS_VOICE` | Sidecar: a Kokoro voice (`bf_emma`, `bm_george`, …) or a Piper voice file | `bf_emma` |
| `VOICE_TTS_DEVICE` | Sidecar: `cpu` (measured default) or `cuda` (needs an accelerated onnxruntime; `/health` says when it is not there) | `cpu` |
| `VOICE_FALLBACK_ENABLED` | `false` makes a missing engine a hard failure instead of a reported fallback | `true` |

For `cuda` whisper on Windows: `uv pip install nvidia-cublas-cu12 nvidia-cudnn-cu12` in the sidecar's environment (the sidecar adds their folders to the DLL search path itself).

## Measured end to end (real pieces, 26 October 2026)

`node scripts/voice-live-check.mjs --say "..."` plays synthesised speech through Chromium's fake microphone into the real page, the real detector, the sidecar's **Parakeet on the GPU** and the local model on Ollama, and times it. Five questions; every one was transcribed correctly and sent by itself (1–3 ms after the transcript):

| Said | Recognition | End of speech to first spoken answer |
| --- | --- | --- |
| What is three quarters of twenty four? | 415 ms | 7.44 s (cold: first synthesis of the session) |
| Solve two x plus seven equals nineteen. | 226 ms | 4.62 s |
| What does gradient mean on a graph? | 213 ms | 4.49 s |
| the same question again (warm) | 200 ms | 4.10 s |
| the same question again (warm, different answer) | 212 ms | 4.50 s |

Median about **4.5 s**, against the pre-migration page's 2.55 s. The recognition part got faster (0.2–0.4 s against about 0.4 s) and the model's first sentence is unchanged in kind; **almost all of the added time is Kokoro synthesising the first clip on the CPU at roughly real time**, plus the first synthesis of a session being slower still. The pipeline benchmark measures the same effect on identical inputs: 3241 ms median (p95 5487) for Parakeet + Kokoro against 908 ms (p95 1191) for `small.en` + Piper. Fixes that are already in: the first spoken chunk is capped at a natural pause (`speechChunksPartial`, so a long opening sentence is not one 3-second clip), and later clips queue behind playback. The remaining lever is a faster -synthesis setting: `VOICE_TTS_ENGINE=piper` for speed, or Kokoro on a GPU onnxruntime (no room in 8 GB beside the model and Parakeet), or a shorter-and-steadier first sentence from the voice prompt.

The old headline number (2.55 s median, Whisper + Piper) is in the git history of this file and in the migration report, which also lists what was **not** re-measured.

## What is stored

Nothing. Audio is held in memory in the browser and in the server's request for as long as the request lasts, then dropped. It is never written to disk, to storage, to a database or to a log (the routes log counters only: audio length, processing time, whether the transcript was empty; the recogniser runtime's own log holds no audio either). The transcript is stored only if the student sends it, as an ordinary chat message under the normal 30-day retention. The Content Security Policy is unchanged: the browser talks only to this site's own routes, and `Permissions-Policy` already allowed the microphone for the site's own pages.

## Switching it off

`VOICE_ENABLED=false`, or stop the sidecar: the button disappears at the next page load and both routes answer 503 `voice_unavailable`. Turning the assistant off (`ASSISTANT_ENABLED=false`) turns voice off too, since voice sits behind it. To go back to the pre-migration engines:

```bash
VOICE_STT_ENGINE=whisper VOICE_TTS_ENGINE=piper   # in the sidecar's environment, then restart it
```

## What was not tested here

- A real microphone in a real room, real devices, Safari and Firefox (AudioWorklet and `getUserMedia` behave differently, and Firefox cannot open a 16 kHz capture context, which is why the page captures at the device's rate and resamples itself). The browser tests use Chromium's fake microphone (tone-and-silence files) with the mock speech provider; the live check above uses synthesised speech with the real speech service and model. The end-of-speech detector's thresholds are therefore tuned on synthetic audio only.
- Screen readers and switch access with the voice panel (built for them, passes axe, not driven with real assistive technology).
- A child's voice, a noisy classroom and accents: the recognition benchmark is synthetic and optimistic. Parakeet's punctuation restoration (NVIDIA's PnC BERT) was **not** added: Parakeet returns lower-case words with no punctuation, and guessing a question mark or a comma can change what a maths question looks like.
- Echo: a speaker next to the microphone. The browser's echo cancellation is requested but not measured; pressing Talk interrupts the voice, which is the safeguard.
- A hosted speech provider for production: none chosen.

## Licences to review before any production use

The defaults now are NVIDIA's Parakeet weights (**CC-BY-4.0**, so attribution is required) for recognition and Kokoro 82M (**Apache-2.0** weights, MIT `kokoro-onnx`, but a **GPL-3.0** phonemiser chain through `phonemizer` and espeak-ng) for speech output; the NeMo-Speech.cpp runtime is **Apache-2.0**. The rollback engines are Piper (**GPL-3.0-or-later**) and faster-whisper/Whisper (MIT). Running any of it as a developer's own separate local program is one thing; shipping or hosting it in a product is another, and the owner needs advice before any of it leaves a developer's machine. The full list, with sources, is in [apps/web/THIRD_PARTY_NOTICES.md](../apps/web/THIRD_PARTY_NOTICES.md).

## Deviations from the plan

- One WAV per utterance instead of a stream of chunks: utterances are a few seconds, and recognition is quick enough (about 0.03–0.4 s) that streaming would add complexity without a measured gain. The cost is no live transcript while speaking: the panel shows a level ring instead, and the words as soon as they are known.
- End of speech is an energy detector, not a model (Silero and WebRTC VAD were considered and not benchmarked here): misled by steady loud noise next to the microphone or very quiet speakers (tap to stop still sends).
- Full-duplex conversation (talking and listening at once, barge-in by voice alone) is not built: turn-taking is speak, answer, listen. Interrupting is a press (or Stop speaking).
- The route names are `/api/assistant/voice/transcribe` and `/api/assistant/voice/speak` rather than a single `/api/assistant/voice`.
- No punctuation restoration and no word boosting for Parakeet, both deliberately (see the module docstring in `services/voice/speech/parakeet.py`).
