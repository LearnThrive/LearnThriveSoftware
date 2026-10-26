# Nemotron VoiceChat evaluation — results

Run 26 October 2026 on the LearnThrive development laptop (Ryzen 7 5800H, 64 GB RAM, RTX 3070 Laptop 8 GB, driver
617.42, Windows 11, Node 26.10). Nothing was downloaded, no CUDA toolkit was installed, no file of LearnThrive AI was
modified, and nothing was committed.

## The headline, without softening it

**The experiment did not achieve a spoken conversation with Nemotron VoiceChat, because there is nothing to connect to.**
No NVIDIA-hosted full-duplex endpoint is documented for an ordinary developer, the NVIDIA key already configured on this
laptop reaches 85 model ids and **none of them is VoiceChat**, and NVIDIA's own local runtime requires at least 16 GB of
GPU-accessible memory against this machine's 8 GB.

What the work did produce is everything the brief allows for in that case: an **isolated, dependency-free harness that is
verified end to end**, a **repeatable benchmark**, **hard evidence of the two blockers**, a **ready manual test script**
for route B, and a **comparison and recommendation** (§7, §8).

| Route | Status | Evidence |
| --- | --- | --- |
| **A — hosted API** | **Blocked** | Key valid (HTTP 200) on NVIDIA's documented API base, 85 model ids visible, **0 VoiceChat ids**. No endpoint URL, protocol or auth contract is published to call |
| **B — official demonstration** | **Reachable, manual, not run here** | NVIDIA's Build page offers an interactive experience behind "Apply for Early Access". A human must speak into it; script and recording template in [docs/DEMO_TEST_PLAN.md](docs/DEMO_TEST_PLAN.md) |
| **C — local NeMo-Speech.cpp** | **Blocked by hardware** | Documented requirement: "at least 16 GB of GPU-accessible memory". This GPU: 8,192 MiB. Plus a 44.4 GB checkpoint and a CUDA toolkit (`nvcc` absent) |

## 1. Successfully tested (with the evidence)

These are real measurements of real code, and each one has a number or an artefact behind it.

### 1.1 The access blockers, measured rather than assumed

`npm run probe`:

```
key accepted by NVIDIA's API base              yes (HTTP 200)
model ids visible to this key                  85
VoiceChat-specific model ids                   NONE — a valid key is not VoiceChat access
other speech-ish ids (for context)             3: nvidia/nemotron-3-nano-omni-30b-a3b-reasoning, nvidia/riva-translate-4b-instruct, nvidia/riva-translate-4b-instruct-v2
documented GPU memory requirement              16 GB (Q4_K_M profile)
official checkpoint size to download           44.4 GB before conversion
nvidia-smi reports                              NVIDIA GeForce RTX 3070 Laptop GPU, 8192 MiB, 617.42
verdict                                        8.0 GB — BELOW the documented 16 GB requirement
CUDA toolkit (nvcc)                            NOT on PATH
```

The 85-and-zero counts come from NVIDIA's own `https://integrate.api.nvidia.com/v1/models` — the same base URL this
repository already uses for NIM (`apps/web/src/lib/assistant/openai.ts`). The key was never printed; the probe reports
its length only.

### 1.2 The harness, verified against a synthetic stand-in

`npm run bench -- --runs 5 --interrupt`, through the experiment's proxy, five runs, all five succeeded:

| Metric | Result |
| --- | --- |
| Last packet → first audio (client boundary) | **median 937 ms**, p95 992 ms |
| `speech_stopped` → first audio (the endpoint's own turn boundary) | median 187 ms, p95 207 ms |
| `response.created` → first audio (packet delay alone) | median 125 ms, p95 128 ms |
| Connect (through the proxy) | median 3 ms, p95 16 ms |
| Endpoint yielded after the user talked over it | median **280 ms**, p95 281 ms (5 of 5 runs) |
| Audio contract actually delivered | **24,000 Hz, 1,920 samples per packet, 80 ms** — exactly NVIDIA's documented shape |
| Failures | 0 |

**These numbers describe this machine and this harness, not a model.** They are valuable because they *reconcile* with the
stand-in's own configured delays: 700 ms of quiet ends the turn → `speech_stopped`, +60 ms `response.created`, +120 ms to
the first audio packet = **~880 ms**, and 880 + 60 for the observed `speech_stopped` → first audio of 180 ms gives the
measured 887–992 ms. The harness therefore adds only a few milliseconds and misses no event, which is what a benchmark
has to be able to show before its numbers mean anything about a real endpoint.

The 280 ms yield is the stand-in's own minimum-speech gate (it counts an interruption only after ~300 ms of speech), so
it measures that gate, not a model's barge-in latency — which remains **not measured**.

### 1.3 The browser client, driven for real

In the preview browser against the stand-in, with a real microphone:

- The page loaded with **no console errors and no failed requests**.
- A WebSocket opened from the page through the proxy and received `session.created` (the proxy, the header-based auth
  path and the browser path all work).
- `Start conversation` acquired the microphone, built the audio graph, loaded the AudioWorklet, and opened the session
  (9.1 s on the first run, which included the permission prompt and the first worklet load).
- Capture ran at **48 kHz** and was resampled to the documented 24 kHz in 80 ms packets.
- A full turn completed: **59 packets sent (96,000 B)**, turn detected, **25 audio packets returned (226,560 B)**,
  transcript deltas and `.done` received, and the reply scheduled for playback.
- The three timing boundaries were computed live: `speechStopped → first audio` **196.5 ms**, `response.created →
  first audio` **126.7 ms**, `packetsInTurn` 25 — matching the stand-in's configured 60 + 120 ms, and agreeing with the
  Node benchmark run above (187 ms / 125 ms) to within a packet.
- The **STAND-IN DETECTED** badge appeared, as designed, so nobody can mistake a synthetic run for the model.

### 1.4 What a live microphone, left running, revealed

The session above was then left open and idle for roughly five minutes while other checks ran, still streaming the room's
microphone. Its final counters, read before ending it:

```
Packets sent 3409   Packets received 691   Audio out 13,090,560 B   Audio in 2,653,440 B
Turns 46            Interruptions 9        Connection failures 0
```

Three honest readings of that, and one of them is a warning:

- **Reliability: good.** 3,409 packets sent across many turns with **zero connection failures** and no dropped session.
- **The barge-in path does fire end to end** — the detector, the synchronous local stop and the counter all worked nine
times with a live microphone. What I **cannot** claim is that each was a deliberate human interruption: nobody spoke
into the microphone on purpose during that window.
- **The warning: 46 turns and 9 interruptions in five minutes of an empty room is a false-trigger rate, not a feature.**
The room's microphone (with the browser's automatic gain control on) crosses the adaptive threshold on its own. This is
exactly the risk `docs/VOICE.md` already documents for the app's energy-based endpointer, and it is not a Nemotron
finding — it is a client-threshold finding. Any integration would need those thresholds tuned against a real room and a
real voice, and this experiment's defaults should not be read as tuned.

### 1.4 Isolation held

No file of LearnThrive AI was read at runtime by the experiment, none was modified, no service of the app was started or
stopped, and no package was added (this folder has no dependencies at all). Ports used: 3999 and 8080 only.

## 2. Supported by documentation, NOT tested

Stated clearly, because these are the parts a reader might otherwise assume were exercised.

| Documented behaviour | Source | Why it was not tested |
| --- | --- | --- |
| True full-duplex conversation with the model | NeMo-Speech.cpp `docs/s2s/README.md`, model card | Needs a ≥16 GB GPU, a 44.4 GB model and a CUDA build; not attempted on an 8 GB laptop |
| Barge-in / user interruption, model-side | 11B model card (480 ms on Full-Duplex-Bench 1.0) | Never reached a live model. The *client's* stop is implemented; the *stand-in's* yield was measured at 1 ms; neither is evidence about Nemotron |
| `session.update` / `input_audio_buffer.append` / `response.output_audio.delta` event contract | `docs/api.md`, `docs/s2s/clients.md` | Implemented and verified against a stand-in that follows the same shapes; not verified against NVIDIA's own server |
| Audio: PCM16 in at 16–48 kHz, PCM16 out at 24 kHz in 80 ms packets | same | Verified as the shape the stand-in delivers, not as what NVIDIA's server delivers |
| Recognition of maths phrases (`two x`, `x squared`, `three x cubed`) | — | Requires a live model and a real voice |
| Answer correctness at GCSE and A-level | — | Same |
| Model-card latency: **~450 ms** turn-taking, 448 ms smooth-turn-taking, 480 ms interruption, on an H100 | model card | NVIDIA's own hardware; not measurable from here, and not comparable with anything measured on this laptop |
| Local-server auth via `Authorization: Bearer` and the WebSocket `api_key` parameter | `docs/api.md` | The header path is implemented and used by the proxy; it has not been seen accepted by NVIDIA's local server |

## 3. Blocked

**Route A, by access.** Not a key problem: the key works and reaches 85 models, none of them VoiceChat. The Build page
says *"Apply for Early Access"* and the model card says *"ready for early access evaluation purposes only"*; neither
documents a URL or a wire protocol. **Unconfirmed** (see [docs/ACCESS_RESEARCH.md](docs/ACCESS_RESEARCH.md)): whether a
standard key suffices, whether approval is required, what the endpoint is, and how audio would be carried.

**Route C, by hardware and cost.** Below the documented minimum, with a 44.4 GB download and an absent CUDA toolkit in
front of it, and no documented Windows VoiceChat build. Per the brief, none of that was attempted without approval.

**Route B, by it being manual.** Reachable in principle; it is a person speaking into NVIDIA's page. It was not run here,
and it cannot yield latency or resource numbers at all.

## 4. Unsupported, and deliberately not attempted

- Writing to LearnThrive AI's voice pipeline, its routes, its models, its env or its deployment. The experiment shares
  nothing with the app.
- Any student-facing exposure. The page is loopback-only by default and serves synthetic audio.
- Downloading the 44.4 GB checkpoint, installing a CUDA toolkit, changing a GPU driver, or altering the existing Ollama
  setup.
- Guessing an NVIDIA URL, parameter, SDK call or model id. Where NVIDIA does not document it, this report says so.
- Assuming a text chat-completions endpoint carries duplex audio. It does not.

## 5. Benchmarks — measured here, versus Not measured

| Metric asked for | Result |
| --- | --- |
| First spoken response latency (Nemotron) | **Not measured** — no endpoint |
| Turn-taking latency (Nemotron) | **Not measured** — no endpoint |
| Interruption latency (Nemotron) | **Not measured** — no endpoint |
| Transcription accuracy (Nemotron) | **Not measured** — no endpoint |
| Mathematical recognition / answer accuracy (Nemotron) | **Not measured** — no endpoint |
| Conversation continuity (Nemotron) | **Not measured** — no endpoint |
| Audio naturalness (Nemotron) | **Not measured** — nothing was ever heard; route B is where a person could judge this |
| Connection failures | **0 of 5** bench runs and 11 browser/proxy sessions against the stand-in. Counter for this metric is built into the page and the bench output |
| Resource usage (Nemotron) | **Not measured** — it runs on someone else's hardware |
| Harness/turn boundaries (this machine, synthetic audio) | **Measured**: 937 ms median last-packet→first-audio, 187 ms server boundary, 125 ms packet delay, 3 ms connect, 280 ms stand-in yield — see §1.2 |
| LearnThrive AI's existing pipeline (for comparison) | **Already measured** in `docs/VOICE.md` / `docs/VOICE_BENCHMARK.md`: 908 ms pipeline-internal median, 2.55 s as a student experiences it, 1.8% word error, 72–98 ms first speech chunk. Not re-run for this experiment |

Two caveats on the harness numbers. The audio sent was a **synthetic tone**, so no recognition or answer quality is
implied. And the browser's "last loud block → first audio" figure (2275 ms in the observed run) is only meaningful in a
live room: with a quiet microphone the last loud block is stale, which is why the endpoint's own `speech_stopped`
boundary (196–317 ms) is the figure to trust.

## 6. Interesting things found along the way

- **A valid NVIDIA key is not access.** 85 models, zero VoiceChat. Anyone planning this work should establish that
  distinction before planning anything else.
- **A full-duplex client must not stop sending.** The first version of the stand-in ended a turn when packets stopped, so
  a browser streaming room silence never finished a turn: it looked as if the model had gone deaf. Real full-duplex
  servers must decide the turn from the *signal*, not from the packet stream — a detail that matters for anyone building
  against such an endpoint, and one that was caught here only because a real microphone was driven through the page.
- **Energy thresholds need the room.** A fixed barge-in threshold of 0.035 was below this quiet room's idle noise
  (0.04 measured). The experiment now follows the app's own approach and tracks an adaptive floor. This also matches the
  honest warning `docs/VOICE.md` already carries about energy-based detectors.
- **NVIDIA's local contract is OpenAI-Realtime-shaped**, but only the shapes are documented as shared. The experiment
  therefore sends only documented events; the one event it can optionally send that NVIDIA does not document
  (`response.cancel`) sits behind an unchecked box, labelled as unconfirmed.

## 7. Comparison with LearnThrive AI's pipeline

The full comparison, with the boundary arithmetic made explicit, is in
[docs/PIPELINE_COMPARISON.md](docs/PIPELINE_COMPARISON.md). In short:

- **NVIDIA's ~450 ms must not be compared with LearnThrive's 2.55 s.** One is a model's turn-taking latency on an H100;
  the other is a five-stage cascade on a laptop that includes a deliberate 0.9 s silence wait, a recogniser, a separate
  9B model and a local voice.
- **More natural**: Nemotron, by architecture (full duplex against turn-based), not by measurement.
- **Hears maths better**: unknown. LearnThrive AI has a number (1.8% word error, synthetic audio, optimistically); there
  is no equivalent for Nemotron, and the maths phrases were never sent to it.
- **Better for tutoring a child**: not a clean win either way. The cascade is auditable — the transcript exists as text
  before anything is generated, so "Did I hear that right?" and the safeguarding prompt sit in the path, audio never
  leaves the machine, and voice mode is closed in production. A full-duplex model is faster and more natural but puts a
  black box between the student and the answer, on a trial endpoint that may record inputs.

## 8. Recommendation

**Do not pursue integration now. Re-open it only when both of these are true:**

1. **Access exists.** An NVIDIA approval or a documented hosted endpoint that answers a handshake for an ordinary key.
   The moment it does, this harness is already pointed at the right contract: set `NV_REALTIME_URL`, run `npm run probe`,
   then `npm run bench` and speak into the page.
2. **The maths is judged.** A teacher listens to the model answer group B and C phrases and signs off that GCSE and
   A-level answers are correct, and hears the maths phrases recognised properly. Fluency is not evidence for either.

Until then, the sensible position is the one the project already holds: keep the measured, auditable cascade, keep voice
mode development-only, and treat a hosted speech processor as the open decision it is.

**If it is pursued later**, the architecture this evidence suggests is the voice layer only: Nemotron-style full duplex
for hearing and speaking, with reasoning left to a separate model behind LearnThrive AI's own gates — not a replacement
of the existing pipeline. That is an assessment, not work done here.

**What was not attempted, and why**: no checkpoint download, no CUDA install, no driver change, no modification of the
existing Ollama setup, no changes to the app, no commits. Each of those was either explicitly out of bounds or genuinely
required approval first.

## 9. Definition of success, assessed honestly

The brief set success as *being able to experience a Nemotron VoiceChat conversation through an official demo or a
working local client, and to make an evidence-based decision*. Assessed:

- A working local client, or a hosted integration: **not achieved** — the endpoint is inaccessible and the hardware is
  below the documented minimum. Per the brief, this is **not** to be claimed as success.
- Route B, the official demonstration: **reachable but not run in this session.** It is the shortest supported next
  step, and it needs a person and possibly an approval, not code.
- The evidence-based decision: **achieved, and it is a clear "not yet"**, with the blockers measured rather than
  assumed, and a harness ready to use the day access appears.

## 10. Reproduce

```bash
cd experiments/nemotron-voicechat
npm run probe                                  # the blockers, and the hardware verdict
npm run mock                                   # terminal 1
npm start                                      # terminal 2, then open http://127.0.0.1:3999
npm run bench -- --runs 5 --interrupt          # writes results/bench.json
```

Then stop only your own processes by PID, and confirm 3999 and 8080 are clear (see the README).
