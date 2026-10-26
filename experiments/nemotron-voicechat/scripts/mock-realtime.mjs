#!/usr/bin/env node
/**
 * THE STAND-IN — not NVIDIA code, not the model. Read this before you believe any number it produces.
 *
 * This server exists so the experiment's client, its proxy and its benchmark harness can be verified without any NVIDIA
 * access. It speaks the event shapes NVIDIA documents for the LOCAL NeMo-Speech.cpp runtime (`/v1/realtime`,
 * session.update, PCM16 base64 deltas — sources in docs/ACCESS_RESEARCH.md) and answers with a synthesised tone plus
 * canned text. It is a protocol double, not a tutor.
 *
 * Two things it deliberately mimics, because the client depends on them:
 *   - A continuous stream is normal. A full-duplex client sends audio the whole time, including room silence, so the
 *     turn ends on a quiet stretch of signal (an energy VAD with an adaptive floor), never on packets merely stopping.
 *   - Talking over it makes it yield, immediately.
 *
 * Therefore: every latency measured against this server measures THIS MACHINE AND THIS HARNESS, not a Nemotron model.
 * RESULTS.md keeps those two apart.
 *
 *   node scripts/mock-realtime.mjs [--port 8080] [--ttfb-ms 60] [--first-packet-ms 120] [--packet-ms 80] [--silence-ms 700]
 */
import http from "node:http";
import { attach } from "../lib/ws.mjs";
import { speechLike, rmsOfPcm16, toPcm16 } from "../lib/pcm.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? Number(argv[at + 1]) : fallback;
};
const PORT = arg("port", Number(process.env.NV_MOCK_PORT ?? 8080));
const RATE = arg("rate", Number(process.env.NV_OUTPUT_RATE ?? 24000));
const PACKET_MS = arg("packet-ms", 80);
const TTFB_MS = arg("ttfb-ms", 60);
const FIRST_PACKET_MS = arg("first-packet-ms", 120);
const SILENCE_MS = arg("silence-ms", 700); // quiet signal for this long ends the turn
const MIN_SPEECH_MS = arg("min-speech-ms", 300);
const REPLY_PACKETS = arg("reply-packets", 25); // about 2 s of audio
const FLOOR_MIN = 0.02; // the same idea as LearnThrive AI's own endpointer (apps/web/src/lib/assistant/audio.ts)

const A_REPLY = "Three quarters of twenty-four is eighteen, because twenty-four divided by four is six, and three sixes are eighteen.";

const sessions = new Set();
let nextSession = 1;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/v1/realtime/health" || url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, standin: true, rate: RATE, packetMs: PACKET_MS, silenceMs: SILENCE_MS, note: "synthetic tone, not a model" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not_found", hint: "the WebSocket lives at /v1/realtime" }));
});

attach(server, ["/v1/realtime", "/realtime"], (conn) => {
  const session = createSession(conn);
  sessions.add(session);
  conn.on("close", () => {
    session.stop();
    sessions.delete(session);
  });
});

function createSession(conn) {
  const id = `standin-${nextSession++}`;
  const state = {
    streaming: false,
    turn: 0,
    floor: 0.01,
    speechMs: 0,
    speaking: false,
    lastLoudAt: 0,
    packets: 0,
    audioMs: 0,
    streamTimers: [],
    startedAt: 0,
  };
  const now = () => Date.now();

  const emit = (type, extra = {}) => {
    if (conn.closed) return;
    conn.sendJson({ type, ...extra });
  };

  const stream = (turn) => {
    state.streaming = true;
    state.turn = turn;
    state.startedAt = now();
    const text = A_REPLY;
    const words = text.split(" ");
    let wordAt = 0;
    const push = (delay, work) => state.streamTimers.push(setTimeout(work, delay));
    push(TTFB_MS, () => {
      emit("response.created", { response: { id: `resp-${turn}`, created_at: state.startedAt } });
      for (let packet = 0; packet < REPLY_PACKETS; packet += 1) {
        push(FIRST_PACKET_MS + packet * PACKET_MS, () => {
          if (!state.streaming || state.turn !== turn) return; // talking over it: the model yields at once
          const chunk = speechLike({ seconds: PACKET_MS / 1000, rate: RATE, seed: packet + turn });
          emit("response.output_audio.delta", { delta: toPcm16(chunk).toString("base64"), sample_rate: RATE, packet_ms: PACKET_MS });
          if (packet % 6 === 0 && wordAt < words.length) {
            emit("response.output_audio_transcript.delta", { delta: `${words.slice(wordAt, wordAt + 3).join(" ")} ` });
            wordAt += 3;
          }
          if (packet === REPLY_PACKETS - 1) {
            emit("response.output_audio_transcript.done", { transcript: text });
            emit("response.output_audio.done", {});
            emit("response.done", { response: { id: `resp-${turn}`, status: "completed" } });
            state.streaming = false;
          }
        });
      }
    });
  };

  const stopStreaming = () => {
    const wasStreaming = state.streaming;
    state.streaming = false;
    for (const timer of state.streamTimers) clearTimeout(timer);
    state.streamTimers = [];
    if (wasStreaming) {
      emit("response.output_audio.done", { interrupted: true });
      emit("response.done", { response: { id: `resp-${state.turn}`, status: "interrupted" } });
    }
  };

  const endTurn = () => {
    if (!state.speaking) return;
    state.speaking = false;
    state.speechMs = 0;
    const durationMs = state.audioMs;
    state.packets = 0;
    state.audioMs = 0;
    emit("input_audio_buffer.speech_stopped", { audio_ms: durationMs });
    // A transcript of a synthetic tone would be an invention. It says so, in the transcript.
    emit("conversation.item.input_audio_transcription.completed", { transcript: "(a synthetic tone was received: this stand-in cannot transcribe)" });
    stream(now());
  };

  // The turn ends on a quiet stretch of signal, not on packets stopping — the client streams continuously, as a
  // full-duplex client should.
  const ticker = setInterval(() => {
    if (state.speaking && state.lastLoudAt && now() - state.lastLoudAt >= SILENCE_MS) endTurn();
  }, 100);

  emit("session.created", { session: { id, model: "standin-synthetic-tone", note: "NOT NVIDIA code" } });

  conn.on("message", (data, isBinary) => {
    if (isBinary) return; // the experiment sends JSON text frames only
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      emit("error", { code: "bad_json" });
      return;
    }
    if (message.type === "session.update") {
      emit("session.updated", { session: { id, audio: message.session?.audio ?? null } });
      return;
    }
    if (message.type === "input_audio_buffer.append") {
      const bytes = Buffer.from(message.audio ?? "", "base64");
      const blockMs = (bytes.length / 2 / RATE) * 1000;
      const level = rmsOfPcm16(bytes);
      // The floor falls quickly to quiet and rises slowly, exactly as the app's own endpointer does.
      const rate = 1 - Math.exp(-Math.max(1, blockMs) / (level < state.floor ? 120 : 8000));
      state.floor += (level - state.floor) * rate;
      const loud = level > Math.max(FLOOR_MIN, state.floor * 3);

      if (loud) {
        state.speechMs += blockMs;
        state.lastLoudAt = now();
        if (!state.speaking && state.speechMs >= MIN_SPEECH_MS) {
          state.speaking = true;
          if (state.streaming) {
            // The user kept talking while the assistant spoke: a real full-duplex model yields, and so does this.
            console.log(`[stand-in] barge-in after ${now() - state.startedAt} ms of streaming; yielding`);
            stopStreaming();
          }
          emit("input_audio_buffer.speech_started", {});
        }
      } else if (state.speaking && state.lastLoudAt && now() - state.lastLoudAt >= SILENCE_MS) {
        endTurn();
      }
      state.packets += 1;
      state.audioMs += blockMs;
      return;
    }
    if (message.type === "session.end") {
      emit("session.ended", {});
      conn.close(1000);
      return;
    }
    if (message.type === "response.cancel") {
      // NOT a documented NVIDIA event: kept only so an experimenter can see what a server does with it.
      stopStreaming();
      return;
    }
    emit("error", { code: "unknown_event", type: message.type });
  });

  return { ...state, stop: () => clearInterval(ticker) };
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[stand-in] SYNTHETIC TONE STAND-IN listening on ws://127.0.0.1:${PORT}/v1/realtime (health: http://127.0.0.1:${PORT}/v1/realtime/health)`);
  console.log(`[stand-in] This is not NVIDIA code and not a model. Timings measured against it describe this harness.`);
  console.log(`[stand-in] output ${RATE} Hz, ${PACKET_MS} ms packets, ${TTFB_MS} ms to response.created, +${FIRST_PACKET_MS} ms to first packet, turn ends after ${SILENCE_MS} ms of quiet signal`);
});

process.on("SIGINT", () => {
  for (const session of sessions) session.stop();
  server.close(() => process.exit(0));
});
