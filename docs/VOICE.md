# Study Buddy voice mode

Voice mode lets a student talk to Study Buddy and hear the answer. It is **development only**: in production the code keeps it closed (`voiceClosed()` returns `production`), because a hosted speech service is a processor for a child's voice and plan19 section 6 has not chosen one. The model choice and the measured speeds are in [VOICE_BENCHMARK.md](VOICE_BENCHMARK.md); the assistant itself is in [ASSISTANT.md](ASSISTANT.md).

## How it works

Talking is meant to be quicker than typing: the student speaks, and the question is sent when they stop. There is no second Send press.

1. The student presses the microphone button in the box ("Talk instead of typing"). That press opens a compact voice panel above the box (not a modal: the conversation stays in view and typing stays one tap away) and asks for the microphone, then and only then.
2. The browser captures with an AudioWorklet (`public/audio/capture-worklet.js`). The audio graph is built during the press, in parallel with the permission request, and kept while the panel is open, so the first words after the press are not lost (an earlier version lost about a second of speech while the worklet loaded; the live check below caught it). Each turn has its own microphone stream, stopped when the turn ends.
3. **End of turn.** An end-of-speech detector (`createEndpointer` in `src/lib/assistant/audio.ts`) follows the loudness of each ~43 ms block against an adaptive noise floor. A pause between words (under 0.9 s) does not end the turn; 0.9 s of quiet after at least 0.3 s of speech does. Eight seconds without speech stops listening; a turn longer than 30 s is ended. **Fallback:** pressing the button while listening ends the turn and sends straight away, so a noisy room or a quiet speaker never needs a Send press either.
4. The recording (16 kHz mono 16-bit WAV, built in memory) goes to `POST /api/assistant/voice/transcribe`, behind the same gates as the chat (Origin, assistant open, signed-in adult, Library access) plus an hourly cap. The sidecar returns the words, a **confidence** (the recogniser's average token probability) and the chance there was **no speech**.
5. Then, exactly once per turn (each turn has a number; a late result from a cancelled turn is ignored):
   - no words, or mostly silence: "I did not catch any words", and it listens again (twice at most, then waits for a press);
   - confidence under 0.55: **"Did I hear that right?"** with the words and **Send**, **Try again** and **Edit** (Edit puts them in the text box);
   - otherwise the words are **sent automatically** as an ordinary Study Buddy message, shown in the conversation like a typed one.
6. The question goes through the normal chat route with `voice: true`, which adds a short instruction to that turn's system prompt (at most four sentences, maths in words, no lists). All the usual safety applies; voice adds no way around it.
7. The answer is read aloud a sentence at a time as it streams (`src/lib/assistant/speech.ts` turns maths into words; `POST /api/assistant/voice/speak` returns each clip). **Read aloud** can be switched off, **Stop speaking** silences it, and pressing the button while it speaks **talks over it**: the speech stops, the answer stops arriving, and a new turn starts.
8. With **Keep listening** on (the default while the panel is open), the next turn starts by itself when the answer has been spoken; off, the panel waits for a press. Closing the panel switches everything off.

The states, always written out in the panel and announced politely: Tap to talk, Allow the microphone, Listening, Getting your words, Did I hear that right?, Study Buddy is answering, Speaking, Microphone blocked, Voice stopped. The microphone stops when a turn ends, the panel closes, the page is hidden (no recording in a background tab) or the page goes away.

If the speech service is unreachable the browser's own `speechSynthesis` reads the rest (the text never leaves the device that way). If the service is not configured at all, `/api/assistant/status` says `voice: false` and the microphone button is not shown: the screen is the full text experience.

### Measured end to end (real pieces)

`node scripts/voice-live-check.mjs --say "..."` plays synthesised speech through Chromium's fake microphone into the real page, the real detector, the sidecar's Whisper (`small.en` on the GPU) and the local model on Ollama, and times it. Five questions on 21 October 2026, on the development laptop:

| Said | Heard | End of speech to first spoken answer |
| --- | --- | --- |
| What is three quarters of twenty four? | What is three quarters of twenty-four? | 2.41 s |
| How do I factorise x squared plus five x plus six? | How to factorise x squared plus 5x plus 6. | 2.82 s |
| What is the denominator of a fraction? | What is the denominator of a fraction? | 2.55 s |
| Explain photosynthesis in simple words. | Explain photosynthesis in simple words. | 2.43 s |
| Solve two x plus seven equals nineteen. | Solve 2x plus 7 equals 19. | 2.73 s |

Median **2.55 s** against a target of 2.5 s: just over. 0.9 s of it is the silence the detector waits for to be sure the student has finished; the rest (recognition about 0.4 s, the model's first sentence, the first clip) matches the pipeline benchmark in VOICE_BENCHMARK.md. Shortening the wait to 0.7 s would meet the target, at the price of cutting off a student who pauses mid-sentence; it is one constant (`endSilenceMs`) to change after watching real students. Synthetic speech: no child, no room noise.

## What is stored

Nothing. Audio is held in memory in the browser and in the server's request for as long as the request lasts, then dropped. It is never written to disk, to storage, to a database or to a log (the routes log counters only: audio length, processing time, whether the transcript was empty). The transcript is stored only if the student sends it, as an ordinary chat message under the normal 30-day retention. The Content Security Policy is unchanged: the browser talks only to this site's own routes, and `Permissions-Policy` already allowed the microphone for the site's own pages.

## The speech sidecar (development)

`services/voice` is a small Python 3.12/3.13 program (the machine's default Python was 3.14, so `uv` fetches 3.12), deliberately separate from the Next app:

- `POST /stt` takes a 16 kHz mono WAV and returns the words (faster-whisper).
- `POST /tts` takes `{ "text": "..." }` and returns a WAV (Piper).
- `GET /health` says what is loaded. It binds to `127.0.0.1` only and may require a shared secret (`VOICE_TOKEN`).

Set it up once:

```bash
cd services/voice
uv sync
uv run python -m piper.download_voices --download-dir models en_GB-alba-medium
```

Then, in two terminals:

```bash
cd apps/web && npm run voice:dev     # the sidecar on http://127.0.0.1:8765 (loads in a few seconds; its first line says which recogniser it chose)
cd apps/web && npm run dev           # the site; ASSISTANT_PROVIDER=ollama as for Study Buddy
```

| Variable | Meaning | Default |
| --- | --- | --- |
| `VOICE_ENABLED` | `false` turns voice off. Ignored in production, where voice is closed | on (development) |
| `VOICE_PROVIDER` | `sidecar` or `mock` (tests: a fixed transcript and a silent clip) | `sidecar` |
| `VOICE_URL`, `VOICE_TOKEN` | Where the sidecar is, and its shared secret if set (the same value must be given to both) | `http://127.0.0.1:8765`, none |
| `VOICE_PORT`, `VOICE_HOST` | Sidecar: where it listens | `8765`, `127.0.0.1` |
| `VOICE_STT_DEVICE`, `VOICE_STT_MODEL`, `VOICE_STT_COMPUTE` | Sidecar: `auto` (the default) uses `small.en` on the GPU if CUDA loads (measured: 1.8% word error, about 120 ms a clip, 0.6 GB of VRAM) and `base.en` on the CPU if not (4.6%, about 550 ms). Set `cpu` or `cuda` and a model (`base.en`, `small.en`, `small`, `medium.en`) to override; compute is `float16` on the GPU and `int8` on the CPU | `auto` |
| `VOICE_TTS_VOICE` | Sidecar: a Piper voice in `services/voice/models` | `en_GB-alba-medium` |

For `cuda` on Windows: `uv pip install nvidia-cublas-cu12 nvidia-cudnn-cu12` in the sidecar's environment (the sidecar adds their folders to the DLL search path itself).

## Switching it off

`VOICE_ENABLED=false`, or stop the sidecar: the button disappears at the next page load and both routes answer 503 `voice_unavailable`. Turning the assistant off (`ASSISTANT_ENABLED=false`) turns voice off too, since voice sits behind it.

## What was not tested here

- A real microphone in a real room, real devices, Safari and Firefox (AudioWorklet and `getUserMedia` behave differently, and Firefox cannot open a 16 kHz capture context, which is why the page captures at the device's rate and resamples itself). The browser tests use Chromium's fake microphone (tone-and-silence files, so the detector, tap-to-stop, the confirm step, talk-over, a blocked microphone and a hidden page are all exercised) with the mock speech provider; the live check above uses synthesised speech with the real speech service and model. The end-of-speech detector's thresholds are therefore tuned on synthetic audio only.
- Screen readers and switch access with the voice panel. The panel was built for them (a labelled region, a polite live status line, real buttons and a checkbox, a Close that stops everything) and passes axe, but was not driven with real assistive technology.
- A child's voice, a noisy classroom and accents: the recognition benchmark is synthetic and optimistic (see the benchmark's warning).
- Echo: a speaker next to the microphone. The browser's echo cancellation is requested but not measured; pressing Talk interrupts the voice, which is the safeguard.
- A hosted speech provider for production: none chosen.

## Licences to review before any production use

The sidecar's speech output uses `piper-tts`, which is **GPL-3.0-or-later**, and the benchmark's Kokoro option pulls in GPL parts (`phonemizer`, espeak-ng). Running them as a separate local development program is not the same as shipping or hosting them in a product. The owner needs advice before any of it is used outside a developer's machine, and each Piper voice has its own licence (see its model card). The full list is in `apps/web/THIRD_PARTY_NOTICES.md`. Whisper (MIT) and faster-whisper (MIT) have no such issue.

## Deviations from the plan

- One WAV per utterance instead of a stream of chunks: utterances are a few seconds, and recognition is quick enough (about 0.4 s) that streaming would add complexity without a measured gain. The cost is no live transcript while speaking: the panel shows a level ring instead, and the words as soon as they are known.
- End of speech is an energy detector, not a model: misled by steady loud noise next to the microphone or very quiet speakers (tap to stop still sends). A model detector (Silero or WebRTC VAD) is the upgrade if real rooms show either problem.
- Full-duplex conversation (talking and listening at once, barge-in by voice alone) is not built: turn-taking is speak, answer, listen. Interrupting is a press (or Stop speaking).
- The route names are `/api/assistant/voice/transcribe` and `/api/assistant/voice/speak` rather than a single `/api/assistant/voice`.
