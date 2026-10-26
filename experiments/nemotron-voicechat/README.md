# Nemotron VoiceChat experiment (isolated)

An evaluation harness for NVIDIA Nemotron VoiceChat, kept deliberately separate from LearnThrive AI. The findings are in
[RESULTS.md](RESULTS.md) — read that first; this file is how to run things.

**Start with the summary: as of 26 October 2026 there is no reachable NVIDIA VoiceChat to talk to.** No hosted
programmable endpoint is documented, the NVIDIA key already on this laptop reaches 85 models and no VoiceChat model
among them, and NVIDIA's local runtime needs at least 16 GB of GPU memory where this laptop has 8 GB. What *is* here is a
verified client, a repeatable benchmark and the evidence for those statements. [RESULTS.md](RESULTS.md) keeps "tested",
"documented but untested" and "blocked" strictly apart.

## What this is not

- Not a change to LearnThrive AI's voice pipeline. Whisper, Piper, the sidecar, its routes, its models and its settings
  are untouched: nothing in this folder imports from `apps/` or `services/`.
- Not a production integration, and not exposed to any student.
- Not a dependency: **zero packages**. The WebSocket implementation, the audio helpers and the tiny `.env` reader are in
  this folder, so nothing is added to the repository lockfile.
- Not a source of secrets: the NVIDIA key is read on the server, never sent to the browser, never printed by any script,
  never logged.

## Requirements

- **Node 22 or newer** (this was built and run on Node 26.10). No install step.
- Windows, macOS or Linux. Developed on Windows 11.
- Microphone access for the browser page (the browser asks when you press Start, and the microphone is released the
  moment you press End or close the page).
- Optional: NVIDIA's local runtime, or an approval that grants a real endpoint.

## Quick start — verify the harness with no NVIDIA access at all (recommended first)

Two terminals. Neither touches the app.

```bash
cd experiments/nemotron-voicechat

# Terminal 1: the synthetic stand-in (a protocol double, NOT NVIDIA code and NOT a model)
npm run mock

# Terminal 2: the experiment page and its proxy
npm start                 # http://127.0.0.1:3999
```

Open <http://127.0.0.1:3999>, press **Start conversation**, and speak. The page streams continuously (full duplex), the
stand-in detects a quiet stretch as the end of your turn and answers with a tone, the page plays it, and the timings
panel fills in. The log will say **STAND-IN DETECTED**, because it should: this proves the client, the proxy, the
packets and the timers, and it proves nothing about any model.

Or without a browser, from the same folder:

```bash
npm run probe                 # what is reachable, right now (exit 2 if no endpoint answered)
npm run bench -- --runs 5 --interrupt
```

## Pointing it at something real

Copy `.env.example` to `.env` (git-ignored) and set where the socket should go:

```ini
NVIDIA_API_KEY=...                    # only if the endpoint wants one; the same variable the app uses
NV_REALTIME_URL=ws://127.0.0.1:8080/v1/realtime
NV_AUTH_STYLE=header                  # none | header | query
NV_PORT=3999
```

| Setting | Meaning | Default |
| --- | --- | --- |
| `NVIDIA_API_KEY` | Sent server-side only. Never to the browser, never logged | empty |
| `NV_REALTIME_URL` | The VoiceChat WebSocket. NVIDIA documents **`/v1/realtime`** on the local runtime at `:8080` | `ws://127.0.0.1:8080/v1/realtime` |
| `NV_AUTH_STYLE` | `none` (local server without a key), `header` (`Authorization: Bearer`), `query` (`?api_key=`, discouraged) | `header` |
| `NV_PORT` | The experiment's own page and proxy | `3999` |
| `NV_MOCK_PORT` | The stand-in's port | `8080` |
| `NV_INPUT_RATE` / `NV_OUTPUT_RATE` | The documented audio contract: mono PCM16, 16–48 kHz in, 24 kHz out | `24000` |

The server applies the key and the browser never sees it. `GET /api/config` reports whether the upstream is local or
remote, whether a key is present (and its length, never its value), and which of NVIDIA's contracts it is speaking.

### Route A — hosted (needs an approval that does not exist yet)

There is no documented hosted URL. If an approval arrives, set `NV_REALTIME_URL` to it and `NV_AUTH_STYLE` to whatever
its documentation specifies, having first checked that documentation against [docs/ACCESS_RESEARCH.md](docs/ACCESS_RESEARCH.md).
**Do not guess a URL, and do not assume a text chat-completions endpoint carries duplex audio** — it does not.

### Route B — NVIDIA's own demonstration (available today, manual)

A person speaks into NVIDIA's page; nothing programmatic is involved. The script, the phrase list and the recording
template are in [docs/DEMO_TEST_PLAN.md](docs/DEMO_TEST_PLAN.md). Do not report it as an integration, and write
**Not measured** for anything you cannot time yourself.

### Route C — local NeMo-Speech.cpp (not this machine)

The documented recipe, for a machine with **≥16 GB of GPU-accessible memory** (this laptop has 8 GB, so it was not
attempted and no download was made):

```bash
git clone https://github.com/NVIDIA/NeMo-Speech.cpp
cd NeMo-Speech.cpp && git submodule update --init llama.cpp third_party/cpp-httplib
python -m pip install -r requirements.txt -r clients/voicechat/requirements.txt
python convert_model.py nvidia/NVIDIA-NemotronLabs-VoiceChat-11B --outfile models/voicechat
scripts/configure.sh cuda-s2s && cmake --build --preset cuda-s2s
build/cuda-s2s/bin/nemo-speech serve --s2s-model-dir models/voicechat --s2s-max-streams 1
```

That expects a CUDA toolkit and a ~44.4 GB checkpoint download, and no Windows VoiceChat build is documented. Ask before
doing either.

## The commands

| Command | What it does |
| --- | --- |
| `npm start` | The page and the proxy on `NV_PORT` |
| `npm run mock` | The synthetic stand-in on `NV_MOCK_PORT` (a double, not NVIDIA code) |
| `npm run probe` | Prints what is reachable: key validity, VoiceChat model ids, endpoint handshake, hardware verdict. Prints no secrets. Exit 2 if no endpoint answered |
| `npm run bench -- --runs 5 --interrupt` | Repeatable timing runs over the socket; writes `results/bench.json` |
| `node scripts/make-test-audio.mjs` | Turns the test phrases into WAVs **using the app's existing Piper sidecar**, if you have started it. Starts nothing itself |

`testcases/conversations.json` holds the phrase list for groups A–E (basic tutoring, GCSE, A-level, natural
conversation, interruptions) with what to observe in each.

## Windows notes

- Start the two terminals from the folder above; no global install and no administrator rights are needed.
- Ports used here are **3999** (the page) and **8080** (the stand-in). LearnThrive AI's own services use 3000, 5173,
  8765, 8888, 11235, 11434 and the Supabase range, so nothing collides.
- The microphone is only held while a conversation runs. If a tab is closed mid-session, the page ends the session on
  `pagehide` and releases it.
- A background tab stops repainting the level meters (the browser throttles animation frames). The counters and timings
  keep updating, because they are driven by events rather than by animation.

## Stopping, and cleaning up

```bash
# each foreground `npm start` / `npm run mock` stops with Ctrl+C
```

If you started them in the background, stop only the processes you started, by their recorded PIDs — never by matching
a name pattern. On Windows the `bash` wrapper and its node child are separate, so stop the tree:

```bash
taskkill //F //T //PID <the recorded pid>
```

Then confirm the ports are clear (a refused connection means clear):

```bash
node -e "require('net').connect({port:3999,host:'127.0.0.1'}).on('error',()=>console.log('3999 free')).on('connect',()=>console.log('3999 IN USE'))"
```

## Copyright and privacy

- The phrases in `testcases/` are ordinary school questions, written for this experiment.
- Audio the page captures is held in memory, sent to the configured endpoint and nowhere else. Nothing is written to
  disk by the page or the server; `results/` holds only what the benchmark and the export button write.
- NVIDIA's public trial **may record inputs and outputs**: speak as an adult, never send a child's voice, a real
  student's record, or anything confidential.
- Licences, for whoever reviews this later: NeMo-Speech.cpp is Apache-2.0; the 11B weights are OpenMDW-1.1 (commercial
  terms not verified here). Nothing was downloaded, so nothing was accepted.
