# Study Buddy voice mode

Voice mode lets a student talk to Study Buddy and hear the answer. It is **development only**: in production the code keeps it closed (`voiceClosed()` returns `production`), because a hosted speech service is a processor for a child's voice and plan19 section 6 has not chosen one. The model choice and the measured speeds are in [VOICE_BENCHMARK.md](VOICE_BENCHMARK.md); the assistant itself is in [ASSISTANT.md](ASSISTANT.md).

## How it works

1. The student opens the voice panel (the "Talk instead" button) and presses **Talk**. Only now does the browser ask for the microphone. A visible "Listening" state shows, and Talk again (or letting go of a held press) stops it. Recording stops by itself at 59 seconds.
2. The browser captures with an AudioWorklet (`public/audio/capture-worklet.js`), resamples to 16 kHz mono 16-bit and builds a WAV file in memory (`src/lib/assistant/audio.ts`). Every microphone track is stopped as soon as recording ends.
3. The WAV goes to `POST /api/assistant/voice/transcribe`. The route has the same gates as the chat (Origin check, assistant open, signed-in adult, Library access) plus an hourly cap per family, checks the audio shape before forwarding anything, and passes it to the speech sidecar. The words come back and are **shown in the panel to be checked and corrected**; nothing is sent to the model until the student presses Send.
4. The question goes through the normal chat route with `voice: true`, which adds a short instruction to that turn's system prompt: at most four sentences, maths in words, no lists. All the usual safety applies (input rules, fixed safeguarding reply, output guard, caps, retention); voice adds no way around them.
5. As the answer streams in, each settled sentence is converted to speakable words (`src/lib/assistant/speech.ts`: "x squared plus five x", never LaTeX) and sent to `POST /api/assistant/voice/speak`, which returns a WAV the browser plays with Web Audio. The first clip starts after the first sentence, not after the whole answer. The screen still shows the notation.
6. Pressing Talk while the voice is speaking, or closing the panel, stops the speech immediately **and** stops the answer arriving.

If the speech service is unreachable the browser's own `speechSynthesis` reads the rest (the text never leaves the device that way). If the service is not configured at all, `/api/assistant/status` says `voice: false` and the microphone button is not shown: the screen is the full text experience.

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

- A real microphone, real devices, Safari and Firefox (AudioWorklet and `getUserMedia` behave differently, and Firefox cannot open a 16 kHz capture context, which is why the page captures at the device's rate and resamples itself). The browser tests use Chromium's fake microphone and the mock speech provider.
- Screen readers and switch access with the voice panel. The panel was built for them (live state text, a transcript box, a Close that stops everything) but not driven with real assistive technology.
- A child's voice, a noisy classroom and accents: the recognition benchmark is synthetic and optimistic (see the benchmark's warning).
- Echo: a speaker next to the microphone. The browser's echo cancellation is requested but not measured; pressing Talk interrupts the voice, which is the safeguard.
- A hosted speech provider for production: none chosen.

## Deviations from the plan

- One WAV per utterance instead of a stream of chunks: push-to-talk utterances are a few seconds, and recognition is quick enough (see the benchmark) that streaming chunks would add complexity without a measured gain.
- Hands-free voice-activity detection was not built. It was marked optional "if it benchmarks well", and it needs false-trigger rates measured in a real room first.
- The route names are `/api/assistant/voice/transcribe` and `/api/assistant/voice/speak` rather than a single `/api/assistant/voice`.
