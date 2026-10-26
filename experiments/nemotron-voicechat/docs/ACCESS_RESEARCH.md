# What NVIDIA actually offers for Nemotron VoiceChat

Researched 26 October 2026 from NVIDIA's own pages. Every claim below is either **CONFIRMED** (read on an official page,
URL given) or **UNCONFIRMED** (not stated on any official page I could read — treat as unknown, do not build on it).

The single most important line in this document: **NVIDIA has not published a programmable, hosted full-duplex
VoiceChat endpoint that an ordinary developer can call.** The page offers an interactive experience and an early-access
request. It does not document a URL, a protocol, or an audio contract for a hosted session.

## 1. The variants

| Name | Size | Identifier NVIDIA shows | Status |
| --- | --- | --- | --- |
| NVIDIA Nemotron 3 VoiceChat | 12B | Build slug `nemotron-voicechat` | **CONFIRMED** as a Build model card; the card says "ready for early access evaluation purposes only" |
| NVIDIA NemotronLabs VoiceChat | 11B | Hugging Face `nvidia/NVIDIA-NemotronLabs-VoiceChat-11B` | **CONFIRMED** as a published model with an open licence |

Sources: <https://build.nvidia.com/nvidia/nemotron-voicechat>, <https://build.nvidia.com/nvidia/nemotron-voicechat/modelcard>,
<https://huggingface.co/nvidia/NVIDIA-NemotronLabs-VoiceChat-11B>.

Nothing in either page establishes that the two are interchangeable or share an endpoint. Do not assume they do.

## 2. Is there a hosted programmable API?

- The Build experience page presents an interactive VoiceChat demo and the words **"Apply for Early Access"**.
- The model card shows a "Free Endpoint" label and a "Get API Key" link, and names the NVIDIA API Trial Service Terms
  of Use and the NVIDIA Software and Model Evaluation License.
- **UNCONFIRMED:** whether a standard `nvapi-…` Build key unlocks a VoiceChat endpoint, whether separate approval is
  required, what the endpoint URL would be, what the wire protocol is, and how audio is carried (PCM/Opus/other).
  Neither page documents any of it.
- **UNCONFIRMED:** whether a VoiceChat NIM container or an NVCF function exists that an individual developer can deploy.

What the card *does* state about the media: input text plus user audio, `String, WAV/WebAudio`, **16 kHz** input; output
agent text, agent speech and user transcription, `String, WAV/WebAudio`, **22.05 kHz** output. Those are model-card
specifications, not a hosted transport contract.

### Measured on this machine, 26 October 2026

The experiment's own probe (`scripts/probe-access.mjs`) run against the key already configured on this laptop:

```
key accepted by NVIDIA's API base              yes (HTTP 200)
model ids visible to this key                  85
VoiceChat-specific model ids                   NONE — a valid key is not VoiceChat access
other speech-ish ids (for context)             3: nvidia/nemotron-3-nano-omni-30b-a3b-reasoning, nvidia/riva-translate-4b-instruct, nvidia/riva-translate-4b-instruct-v2
```

`https://integrate.api.nvidia.com/v1` is the only NVIDIA host this experiment touches, and it is the base URL the
repository already uses (`apps/web/src/lib/assistant/openai.ts`, `NIM_BASE_URL`). A valid key reaching 85 models, none of
which is VoiceChat, is direct evidence that **access to this model is not a matter of having a key**.

## 3. The local route (NeMo-Speech.cpp)

**CONFIRMED** from NVIDIA's repository documentation:

- The runtime is built from source with `scripts/configure.sh cuda-s2s` and `cmake --build --preset cuda-s2s`, and served
  with `nemo-speech serve --s2s-model-dir models/voicechat --s2s-max-streams 1`, listening on `localhost:8080`.
- The real-time protocol is a WebSocket at **`/v1/realtime`** (alias `/realtime`); readiness at `/v1/realtime/health`.
- Input: mono little-endian **PCM16, 16–48 kHz**, binary frames or base64 in `input_audio_buffer.append`.
- Output: base64 **PCM16 at 24 kHz** in `response.output_audio.delta`; NVIDIA's client guide uses **80 ms packets
  (1,920 samples)**.
- Session setup is a `session.update` before audio. Documented events include `session.created`, `session.updated`,
  `input_audio_buffer.speech_started`, `input_audio_buffer.speech_stopped`,
  `conversation.item.input_audio_transcription.delta`/`.completed`, `response.created`, `response.output_audio.delta`,
  `response.output_audio.done`, `response.output_audio_transcript.delta`/`.done`, `response.done`, `session.end`.
- If the local server is started with a key, `/v1` requests take `Authorization: Bearer <key>`; a WebSocket `api_key`
  query parameter also exists and NVIDIA advises against putting a long-lived key there.
- The documentation describes this as **full-duplex**, streamed both ways.

Sources: <https://github.com/NVIDIA/NeMo-Speech.cpp>, `/docs/s2s/README.md`, `/docs/api.md`, `/docs/s2s/clients.md`,
`/docs/s2s/configuration.md`, `/docs/build.md`, `/docs/server.md`.

**Important boundary:** these paths and events describe the *local* runtime. They are not a hosted NVIDIA URL. This
experiment is built to that documented contract because it is the only contract NVIDIA publishes, and because it is what
a machine that can run the model would actually serve.

### Why this machine cannot host it

| Requirement | This laptop | Source |
| --- | --- | --- |
| "at least 16 GB of GPU-accessible memory for the recommended Q4_K_M model" | RTX 3070 Laptop, **8192 MiB** | NeMo-Speech.cpp `docs/s2s/README.md`; `nvidia-smi` |
| Checkpoint to download before conversion | `model.safetensors` **44.4 GB** | Hugging Face file listing |
| CUDA toolkit (CUDA-only, source-built, not in release archives) | `nvcc` **not on PATH** | Build/release docs; this machine |
| Windows VoiceChat build | **not documented** either way — shell-based `configure.sh` flow only | `docs/build.md`, releases |

So route C is not "slow on this machine", it is **below the documented minimum**, before the 44.4 GB download and the
toolchain install are even considered. The user's instruction was explicit: do not download multi-gigabyte checkpoints or
install CUDA toolchains without approval. Neither was done.

Licences, for whoever reviews this later: NeMo-Speech.cpp is Apache-2.0; the 11B weights are under the **OpenMDW License
Agreement v1.1**, whose commercial permissions were **not** checked against the full text here (UNCONFIRMED).

## 4. What NVIDIA publishes as performance

The 11B model card reports about **450 ms** turn-taking latency, **448 ms** smooth-turn-taking and **480 ms**
user-interruption on Full-Duplex-Bench 1.0, measured on an H100. Those are model-card benchmark figures on datacentre
hardware — not measurements of the local runtime, not measurements of a hosted API, and **not comparable** with
LearnThrive AI's own 2.55 s figure without explaining the different boundaries (see PIPELINE_COMPARISON.md).

No VoiceChat latency benchmark for NeMo-Speech.cpp itself was found. The repository's own latency numbers are for ASR
and TTS, which are different pipelines.

## 5. The three routes, and what each one costs

| Route | Accessible now? | What it would take |
| --- | --- | --- |
| **A — hosted API** | **No.** No endpoint is documented to call; the key reaches no VoiceChat model id | An early-access grant, then NVIDIA's protocol documentation. Nothing here can be tested until then |
| **B — official demonstration** | **Yes**, in a browser, as a person speaking | An NVIDIA account and the early-access request. Manual, and its timings are not measurable from outside — see DEMO_TEST_PLAN.md |
| **C — local NeMo-Speech.cpp** | **No**, on this hardware | ≥16 GB GPU memory, a CUDA toolkit, a 44.4 GB download, and an undocumented Windows build |
