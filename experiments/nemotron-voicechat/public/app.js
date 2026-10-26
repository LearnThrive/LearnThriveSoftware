/**
 * The experiment page. Full duplex, not push-to-talk: while a conversation is running the microphone streams continuously
 * and the assistant's audio plays as it arrives, so speaking over the answer is possible — that is the behaviour under test.
 *
 * Everything here is a measurement of THIS page, THIS machine and whatever endpoint it is pointed at. Nothing in this file
 * touches LearnThrive AI, its routes, its models or its settings.
 *
 * Audio contract (NVIDIA's documented LOCAL runtime contract, see docs/ACCESS_RESEARCH.md):
 *   in : mono PCM16, 16-48 kHz, base64 in `input_audio_buffer.append`
 *   out: base64 PCM16 at 24 kHz in `response.output_audio.delta`, 80 ms packets
 */
const $ = (id) => document.getElementById(id);
const PACKET_MS = 80;
const BARGE_THRESHOLD = 0.035; // microphone RMS floor: a talker must clearly beat it
const BARGE_WINDOW_MS = 150; // how long they must keep talking before it counts as an interruption
// The room is not silent, so a fixed threshold is not enough: the effective one follows the quietest recent blocks, the same
// way LearnThrive AI's own endpointer does (apps/web/src/lib/assistant/audio.ts). A fan nearby raises the floor with it.
const PLAYBACK_GRACE_MS = 250; // ignore the first moments of playback, so a speaker cannot trigger the detector on its own output

const state = {
  config: null,
  ws: null,
  ctx: null,
  stream: null,
  running: false,
  startedAt: null,
  endedAt: null,
  counters: { packetsSent: 0, packetsReceived: 0, bytesSent: 0, bytesReceived: 0, connectFailures: 0, turns: 0, interruptions: 0 },
  turns: [],
  turn: null,
  events: [],
  logs: [],
  lastLoudAt: null,
  playback: { active: false, sources: [], queued: [], nextStart: 0, startedAt: 0 },
  barge: { firstLoudAt: null },
  noise: { floor: 0.01, threshold: BARGE_THRESHOLD },
  input: { carry: new Float32Array(0), deviceRate: 0, sent: 0 },
  micLevel: 0,
  outLevel: 0,
};

const now = () => performance.now();
const ms = (value) => (value === null || value === undefined || Number.isNaN(value) ? "—" : `${Math.round(value)} ms`);
const fmt = (value, unit = "") => (typeof value === "number" ? `${value.toFixed(3)}${unit}` : "—");

function log(line, kind = "") {
  const stamp = new Date().toISOString().slice(11, 23);
  state.logs.push({ at: stamp, line, kind });
  const element = document.createElement("div");
  element.textContent = `${stamp}  ${line}`;
  if (kind === "bad") element.style.color = "#ffb3ae";
  if (kind === "good") element.style.color = "#7ee2a0";
  const box = $("log");
  box.appendChild(element);
  box.scrollTop = box.scrollHeight;
}

function status(text) {
  $("status").textContent = text;
}

function blocker(title, detail, hint) {
  $("blocker-title").textContent = title;
  $("blocker-detail").textContent = detail;
  $("blocker-hint").textContent = hint ?? "";
  $("blocker").hidden = false;
}

function clearBlocker() {
  $("blocker").hidden = true;
}

/* ------------------------------------------------------------------ audio helpers */

/** Linear-interpolation resample: good enough for a transport test, and it never throws on odd rates. */
function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const low = Math.floor(position);
    const high = Math.min(input.length - 1, low + 1);
    out[i] = input[low] + (input[high] - input[low]) * (position - low);
  }
  return out;
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

function pcm16ToBase64(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), true);
  }
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(binary);
}

function base64ToPcm16Float(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/* ------------------------------------------------------------------ turns and timings */

function beginTurn(why) {
  state.counters.turns += 1;
  state.turn = {
    turn: state.counters.turns,
    beganAt: now(),
    beganWhy: why,
    speechStartedAt: why === "speech_started" ? now() : null,
    speechStoppedAt: null,
    responseCreatedAt: null,
    firstAudioAt: null,
    transcriptDoneAt: null,
    responseDoneAt: null,
    lastLoudAt: state.lastLoudAt,
    bargeDetectedAt: null,
    stopAt: null,
    packetsInTurn: 0,
  };
  state.turns.push(state.turn);
  return state.turn;
}

/** The three boundaries worth separating, each labelled with what it actually measures. */
function turnSummary(turn) {
  if (!turn) return null;
  const first = turn.firstAudioAt;
  return {
    turn: turn.turn,
    clientBoundaryMs: first && turn.lastLoudAt ? first - turn.lastLoudAt : null,
    serverBoundaryMs: first && turn.speechStoppedAt ? first - turn.speechStoppedAt : null,
    packetDelayMs: first && turn.responseCreatedAt ? first - turn.responseCreatedAt : null,
    interruptionMs: turn.bargeDetectedAt && turn.stopAt ? turn.stopAt - turn.bargeDetectedAt : null,
    packetsInTurn: turn.packetsInTurn,
  };
}

function renderTimings() {
  const turn = state.turn;
  const summary = turnSummary(turn);
  const rows = [
    ["Connect to the endpoint", ms(state.connectMs)],
    ["Last loud block → first audio (client boundary)", ms(summary?.clientBoundaryMs)],
    ["speech_stopped → first audio (server boundary)", ms(summary?.serverBoundaryMs)],
    ["response.created → first audio (packet delay)", ms(summary?.packetDelayMs)],
    ["Interruption: detected → playback stopped", ms(summary?.interruptionMs)],
    ["Audio played of the last turn", turn?.playedMs ? ms(turn.playedMs) : "—"],
  ];
  $("timings").innerHTML = rows.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("");

  const counters = [
    ["Packets sent", String(state.counters.packetsSent)],
    ["Packets received", String(state.counters.packetsReceived)],
    ["Audio out", `${state.counters.bytesSent} B`],
    ["Audio in", `${state.counters.bytesReceived} B`],
    ["Turns", String(state.counters.turns)],
    ["Interruptions", String(state.counters.interruptions)],
    ["Connection failures", String(state.counters.connectFailures)],
  ];
  $("counters").innerHTML = counters.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("");
}

function appendTranscript(who, text, replace = false) {
  const id = `line-${who}`;
  let element = document.getElementById(id);
  if (replace || !element) {
    element = document.createElement("div");
    element.id = id;
    element.className = `line ${who}`;
    element.innerHTML = `<span class="who">${who === "user" ? "Student (the endpoint's transcript)" : "Assistant"}</span><span class="text"></span>`;
    $("transcript").appendChild(element);
    $("transcript").scrollTop = $("transcript").scrollHeight;
  }
  const target = element.querySelector(".text");
  target.textContent = replace ? text : `${target.textContent}${text}`;
}

/* ------------------------------------------------------------------ playback */

function playChunk(samples, rate) {
  if (!state.ctx) return;
  const buffer = state.ctx.createBuffer(1, samples.length, rate);
  buffer.copyToChannel(samples, 0);
  const source = state.ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(state.outGain);
  const startAt = Math.max(state.ctx.currentTime + 0.01, state.playback.nextStart);
  if (!state.playback.active) {
    state.playback.active = true;
    state.playback.startedAt = now();
  }
  source.start(startAt);
  state.playback.nextStart = startAt + buffer.duration;
  state.playback.sources.push(source);
  source.onended = () => {
    state.playback.sources = state.playback.sources.filter((candidate) => candidate !== source);
    if (!state.playback.sources.length) {
      state.playback.active = false;
      if (state.turn?.firstAudioAt) state.turn.playedMs = now() - state.turn.firstAudioAt;
    }
  };
}

function stopPlayback(reason) {
  const had = state.playback.sources.length > 0;
  for (const source of state.playback.sources) {
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
  }
  state.playback.sources = [];
  state.playback.nextStart = 0;
  state.playback.active = false;
  if (had) log(`playback stopped immediately (${reason})`);
}

/* ------------------------------------------------------------------ the socket */

function send(message) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(message));
}

function onServerEvent(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    log("the endpoint sent something that is not JSON (ignored)", "bad");
    return;
  }
  const type = message.type ?? "(no type)";
  if (type !== "response.output_audio.delta") log(`← ${type}`);
  state.events.push({ at: now(), type });

  switch (type) {
    case "session.created": {
      const model = message.session?.model ?? "unknown";
      log(`session.created — model "${model}"`, "good");
      if (/standin|synthetic/i.test(model) || /standin|synthetic/i.test(String(message.session?.note ?? ""))) {
        $("standin-badge").hidden = false;
        log("STAND-IN DETECTED: this is the synthetic test double, not NVIDIA's model. Timings describe the harness.", "bad");
      }
      status("Connected — start talking");
      break;
    }
    case "session.updated":
      log(`session.updated — the endpoint accepted the session settings`);
      break;
    case "input_audio_buffer.speech_started":
      state.turn = beginTurn("speech_started");
      $("interrupt").hidden = true;
      break;
    case "input_audio_buffer.speech_stopped":
      if (!state.turn) state.turn = beginTurn("speech_stopped");
      state.turn.speechStoppedAt = now();
      break;
    case "conversation.item.input_audio_transcription.delta":
      appendTranscript("user", message.delta ?? "");
      break;
    case "conversation.item.input_audio_transcription.completed":
      appendTranscript("user", message.transcript ?? "", true);
      break;
    case "response.created":
      if (!state.turn) state.turn = beginTurn("response.created");
      state.turn.responseCreatedAt = now();
      status("The assistant is answering");
      break;
    case "response.output_audio.delta": {
      if (!state.turn) state.turn = beginTurn("first_audio");
      if (!state.turn.firstAudioAt) state.turn.firstAudioAt = now();
      state.turn.packetsInTurn += 1;
      state.counters.packetsReceived += 1;
      const samples = base64ToPcm16Float(message.delta ?? "");
      state.counters.bytesReceived += samples.length * 2;
      playChunk(samples, message.sample_rate ?? state.config?.outputRate ?? 24000);
      status("Speaking — talk over it to test interruption");
      break;
    }
    case "response.output_audio_transcript.delta":
      appendTranscript("agent", message.delta ?? "");
      break;
    case "response.output_audio_transcript.done":
      if (state.turn) state.turn.transcriptDoneAt = now();
      appendTranscript("agent", message.transcript ?? "", true);
      break;
    case "response.output_audio.done":
      if (message.interrupted) log("the endpoint stopped speaking because it was interrupted");
      break;
    case "response.done":
      if (state.turn) state.turn.responseDoneAt = now();
      log(`turn ${state.turn?.turn ?? "?"}: ${JSON.stringify(turnSummary(state.turn))}`, "good");
      renderTimings();
      break;
    case "session.ended":
      log("the endpoint ended the session");
      break;
    case "experiment.error":
      onExperimentError(message);
      break;
    default:
      break;
  }
}

function onExperimentError(message) {
  state.counters.connectFailures += 1;
  const titles = {
    upstream_unreachable: "Blocked: no endpoint is answering",
    upstream_closed: "The endpoint closed the session",
  };
  blocker(titles[message.code] ?? "The endpoint reported an error", `${message.code}: ${message.detail ?? "(no detail)"}`, message.hint ?? "");
  log(`BLOCKED ${message.code}: ${message.detail ?? ""}`, "bad");
  renderTimings();
  status("Blocked");
}

/* ------------------------------------------------------------------ start / stop */

async function start() {
  clearBlocker();
  $("start").disabled = true;
  status("Connecting…");
  const connectedAt = now();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    $("start").disabled = false;
    blocker("Microphone blocked", String(error.message ?? error), "The experiment needs a real microphone. Grant it in the browser's site settings and start again.");
    status("Microphone blocked");
    return;
  }

  state.ctx = new AudioContext();
  await state.ctx.resume();
  state.input.deviceRate = state.ctx.sampleRate;
  await state.ctx.audioWorklet.addModule("/capture-worklet.js");

  state.outGain = state.ctx.createGain();
  state.outAnalyser = state.ctx.createAnalyser();
  state.outAnalyser.fftSize = 512;
  state.outGain.connect(state.outAnalyser);
  state.outAnalyser.connect(state.ctx.destination);

  const source = state.ctx.createMediaStreamSource(state.stream);
  const capture = new AudioWorkletNode(state.ctx, "capture", { numberOfOutputs: 1 });
  const mute = state.ctx.createGain();
  mute.gain.value = 0; // the capture node must reach the destination to be pulled; nothing is heard
  source.connect(capture);
  capture.connect(mute).connect(state.ctx.destination);
  capture.port.onmessage = (event) => onBlock(event.data);
  state.capture = capture;

  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${scheme}://${location.host}/api/realtime`);
  state.ws = ws;
  ws.onopen = () => {
    state.connectMs = now() - connectedAt;
    state.running = true;
    state.startedAt = new Date().toISOString();
    $("end").disabled = false;
    log(`socket open in ${Math.round(state.connectMs)} ms; sending session.update`, "good");
    send({
      type: "session.update",
      session: {
        audio: {
          input: { format: { type: "audio/pcm", rate: state.config?.inputRate ?? 24000 } },
          output: { format: "pcm16" },
        },
        instructions: "You are a concise voice tutor for GCSE and A-level students. Keep answers short and spoken.",
        tools: [],
      },
    });
    renderTimings();
  };
  ws.onmessage = (event) => onServerEvent(event.data);
  ws.onerror = () => {
    state.counters.connectFailures += 1;
    log("the socket reported an error", "bad");
    renderTimings();
  };
  ws.onclose = (event) => {
    log(`socket closed (code ${event.code}${event.reason ? `, ${event.reason}` : ""})`);
    if (state.running) {
      $("end").disabled = true;
      $("start").disabled = false; // an unexpected drop must not leave the page unable to try again
      state.running = false;
      stopEverything();
      // An unexpected close with no blocker already on screen is a connection failure worth naming.
      if ($("blocker").hidden && event.code !== 1000) status(`Disconnected (code ${event.code})`);
    }
    renderTimings();
  };

  $("audio-meta").textContent = `input ${state.config?.inputRate ?? "?"} Hz (captured at ${state.input.deviceRate} Hz then resampled) · output ${state.config?.outputRate ?? "?"} Hz · packets of ${PACKET_MS} ms · barge-in threshold follows the room's noise floor`;
}

/** One block of microphone audio: levels, barge-in detection, and the packet the endpoint receives. */
function onBlock(block) {
  const level = rms(block);
  state.micLevel = level;
  const at = now();
  const blockMs = (block.length / (state.input.deviceRate || 48000)) * 1000;
  // The floor drops quickly towards quiet (about 0.1 s) and climbs slowly (about 8 s), so speech itself never drags it up.
  const rate = 1 - Math.exp(-Math.max(1, blockMs) / (level < state.noise.floor ? 120 : 8000));
  state.noise.floor += (level - state.noise.floor) * rate;
  state.noise.threshold = Math.max(BARGE_THRESHOLD, state.noise.floor * 3);
  if (level > state.noise.threshold) {
    state.lastLoudAt = at;
    if (state.playback.active && state.playback.startedAt + PLAYBACK_GRACE_MS < at) {
      state.barge.firstLoudAt ??= at;
      if (at - state.barge.firstLoudAt >= BARGE_WINDOW_MS && !state.turn?.bargeDetectedAt) {
        // The guaranteed behaviour: our own playback stops, synchronously, before anything is asked of the server.
        if (state.turn) state.turn.bargeDetectedAt = state.barge.firstLoudAt;
        stopPlayback("barge-in");
        if (state.turn) state.turn.stopAt = now();
        state.counters.interruptions += 1;
        $("interrupt").hidden = false;
        log(`barge-in: stopped local playback ${Math.round((state.turn?.stopAt ?? at) - (state.barge.firstLoudAt ?? at))} ms after the student's first loud block (detection window ${BARGE_WINDOW_MS} ms)`, "good");
        if ($("ask-cancel").checked) {
          send({ type: "response.cancel" });
          log("sent response.cancel — this event is NOT documented by NVIDIA; watch what the endpoint does with it", "bad");
        }
        renderTimings();
      }
    }
  } else if (state.barge.firstLoudAt && at - state.barge.firstLoudAt > 400) {
    state.barge.firstLoudAt = null;
  }

  if (!state.running) return;
  const inputRate = state.config?.inputRate ?? 24000;
  const resampled = resample(block, state.input.deviceRate, inputRate);
  const merged = new Float32Array(state.input.carry.length + resampled.length);
  merged.set(state.input.carry, 0);
  merged.set(resampled, state.input.carry.length);
  const perPacket = Math.round((inputRate * PACKET_MS) / 1000);
  let offset = 0;
  while (merged.length - offset >= perPacket) {
    const packet = merged.subarray(offset, offset + perPacket);
    offset += perPacket;
    const audio = pcm16ToBase64(packet);
    send({ type: "input_audio_buffer.append", audio });
    state.counters.packetsSent += 1;
    state.counters.bytesSent += packet.length * 2;
  }
  state.input.carry = merged.slice(offset);
}

function stopEverything() {
  stopPlayback("stopping");
  try {
    state.capture?.port.close();
  } catch {
    /* already closed */
  }
  for (const track of state.stream?.getTracks() ?? []) track.stop();
  state.stream = null;
  state.ctx?.close();
  state.ctx = null;
  state.micLevel = 0;
  state.outLevel = 0;
  $("mic-bar").style.width = "0%";
  $("out-bar").style.width = "0%";
}

function end() {
  state.running = false;
  state.endedAt = new Date().toISOString();
  if (state.ws?.readyState === WebSocket.OPEN) {
    send({ type: "session.end" });
    log("sent session.end");
  }
  stopEverything();
  state.ws?.close(1000);
  state.ws = null;
  $("start").disabled = false;
  $("end").disabled = true;
  status("Idle — the microphone is released");
  log("conversation ended: microphone released, socket closed");
  renderTimings();
}

/* ------------------------------------------------------------------ meters and export */

let lastCountersAt = 0;

function tick() {
  // The counters follow the session live, so a running conversation is legible while it happens, not only at the end.
  if (performance.now() - lastCountersAt > 250) {
    lastCountersAt = performance.now();
    renderTimings();
  }
  $("mic-bar").style.width = `${Math.min(100, state.micLevel * 320)}%`;
  $("mic-read").textContent = `${fmt(state.micLevel)}/${fmt(state.noise.threshold)}`;
  if (state.outAnalyser) {
    const data = new Float32Array(state.outAnalyser.fftSize);
    state.outAnalyser.getFloatTimeDomainData(data);
    state.outLevel = rms(data);
  }
  $("out-bar").style.width = `${Math.min(100, state.outLevel * 320)}%`;
  $("out-read").textContent = fmt(state.outLevel);
  requestAnimationFrame(tick);
}

function exportResults() {
  const payload = {
    experiment: "LearnThrive Nemotron VoiceChat evaluation (isolated)",
    note: "Latency figures measure this browser, this machine and the endpoint it was pointed at. Audio was synthetic: no modelled speech was recognised and no answer was judged.",
    mode: state.config?.flavour,
    upstream: state.config?.upstream,
    endpointNote: state.config?.labels,
    authStyle: state.config?.authStyle,
    keyPresent: state.config?.keyPresent,
    audio: { inputRate: state.config?.inputRate, outputRate: state.config?.outputRate, packetMs: PACKET_MS, captureRate: state.input.deviceRate },
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    connectMs: state.connectMs ?? null,
    counters: state.counters,
    turns: state.turns.map((turn) => ({ ...turn, summary: turnSummary(turn) })),
    events: state.events,
    log: state.logs,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `nemotron-voicechat-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  log("exported a results file");
}

/* ------------------------------------------------------------------ start-up */

async function load() {
  const badge = $("endpoint-badge");
  try {
    state.config = await (await fetch("/api/config")).json();
  } catch (error) {
    $("endpoint-note").textContent = `Could not read /api/config: ${error.message}`;
    return;
  }
  badge.textContent = state.config.flavour === "remote" ? "remote endpoint" : "local endpoint on this machine";
  badge.className = `badge ${state.config.flavour === "remote" ? "remote" : "local"}`;
  $("endpoint-note").textContent = `${state.config.labels} Upstream: ${state.config.upstream} · auth: ${state.config.authStyle} · key ${state.config.keyPresent ? "present" : "NOT set"}.`;
  log(`configuration loaded: ${state.config.flavour} → ${state.config.upstream}`);
  renderTimings();
  requestAnimationFrame(tick);
}

$("start").addEventListener("click", () => start().catch((error) => blocker("Could not start", String(error.message ?? error), "")));
$("end").addEventListener("click", end);
$("export").addEventListener("click", exportResults);
$("clear").addEventListener("click", () => {
  $("log").innerHTML = "";
  state.logs = [];
});
$("probe").addEventListener("click", async () => {
  log("probing the endpoint (handshake only, no audio)…");
  try {
    const result = await (await fetch("/api/probe")).json();
    if (result.ok) log(`probe: handshake OK in ${result.ms} ms${result.events?.length ? `; first events: ${result.events.slice(0, 5).join(", ")}` : ""}`, "good");
    else {
      log(`probe FAILED in ${result.ms} ms: ${result.error}`, "bad");
      blocker("Blocked: no endpoint is answering", `${result.error} (tried ${result.upstream})`, "Start the stand-in (`npm run mock`) to verify this harness, or a real VoiceChat endpoint. See docs/ACCESS_RESEARCH.md for what NVIDIA does and does not document.");
    }
  } catch (error) {
    log(`probe could not run: ${error.message}`, "bad");
  }
});

window.addEventListener("pagehide", () => {
  if (state.running) end();
});

load();
