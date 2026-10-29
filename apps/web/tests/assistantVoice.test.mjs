import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { environment, quiet } from "./_routeHelpers.mjs";

// Phase G: the voice routes (gates, the audio check, caps, the speech-service client) and the voice-mode prompt.

const h = loadTsFrom(import.meta.url, "../src/lib/assistant/handlers.ts");
const vh = loadTsFrom(import.meta.url, "../src/lib/assistant/voiceHandlers.ts");
const voice = loadTsFrom(import.meta.url, "../src/lib/assistant/voice.ts");
const cfgLib = loadTsFrom(import.meta.url, "../src/lib/assistant/config.ts");
const speech = loadTsFrom(import.meta.url, "../src/lib/assistant/speech.ts");
const trust = loadTsFrom(import.meta.url, "../src/lib/assistant/voiceTrust.ts");
const audio = loadTsFrom(import.meta.url, "../src/lib/assistant/audio.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");
const { MemoryLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const { MemoryAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/memoryAuth.ts");
const { SignInLockout } = loadTsFrom(import.meta.url, "../src/lib/account/lockout.ts");
const session = loadTsFrom(import.meta.url, "../src/lib/account/session.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

const ENV = { NODE_ENV: "development", ASSISTANT_PROVIDER: "mock", VOICE_PROVIDER: "mock" };
const NOW = new Date("2026-10-21T10:30:00Z");

/** A 16 kHz mono 16-bit WAV of `seconds` of silence (or another shape, to test the check). */
function wav({ seconds = 1, rate = 16000, channels = 1, bits = 16 } = {}) {
  const samples = Math.round(seconds * rate) * channels;
  const out = new Uint8Array(44 + samples * (bits / 8));
  const v = new DataView(out.buffer);
  const put = (at, s) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  put(0, "RIFF"); v.setUint32(4, out.length - 8, true); put(8, "WAVE"); put(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * (bits / 8), true); v.setUint16(32, channels * (bits / 8), true); v.setUint16(34, bits, true);
  put(36, "data"); v.setUint32(40, samples * (bits / 8), true);
  return out;
}

async function world(t, { env = ENV } = {}) {
  environment(t, {});
  const lines = quiet(t);
  session.resetSessionCache();
  const store = new InMemoryLibraryStore();
  const auth = new MemoryAccountAuth({ onUserCreated: (u) => store.seedProfile({ id: u.id, displayName: u.displayName, email: u.email }) });
  const account = { backend: "memory", auth, store, lockout: new SignInLockout(), outbox: auth.outbox, memory: store };
  const seen = [];
  const mock = new MockProvider({ delayMs: 0 });
  const provider = { id: "recording", capabilities: (m) => mock.capabilities(m), health: (s) => mock.health(s), stream: (messages, options) => (seen.push(messages), mock.stream(messages, options)) };
  const assistant = { config: cfgLib.assistantConfig(env), provider, queue: new GenerationQueue(1, 4), uploads: new MemoryLibraryStorage(), hosted: false, flag: undefined };
  const runtime = voice.buildVoice(voice.voiceConfig(env));

  async function person(enrolled = true) {
    const email = `p${Math.random().toString(36).slice(2)}@example.com`;
    await auth.signUp({ email, password: "correct horse battery staple", displayName: "Pat", adultConfirmed: true });
    const map = new Map();
    const jar = { get: (n) => map.get(n), set: (n, v) => map.set(n, v), delete: (n) => map.delete(n) };
    const opened = await auth.verifyEmailLink(auth.outbox.findLast((m) => m.to === email).tokenHash, "signup");
    session.setSessionCookies(jar, opened.tokens, {});
    await store.accounts.ensureClient(opened.user.id);
    if (enrolled) store.seedAssignment(store.seedStudent(opened.user.id), "ACTIVE");
    return { jar };
  }
  const deps = (jar, over = {}) => ({ rt: account, jar, assistant, voice: runtime, env, now: () => NOW, ...over });
  const audio = (bytes, init = {}) => new Request("http://localhost:3100/api/assistant/voice/transcribe", { method: "POST", headers: { "content-type": "audio/wav", ...(init.headers ?? {}) }, body: bytes });
  const speak = (body, init = {}) => new Request("http://localhost:3100/api/assistant/voice/speak", { method: "POST", headers: { "content-type": "application/json", ...(init.headers ?? {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { store, deps, person, audio, speak, seen, lines, assistant };
}

test("the audio check accepts 16 kHz mono 16-bit WAV and refuses everything else before it is sent anywhere", () => {
  assert.deepEqual(voice.inspectWav(wav({ seconds: 1.5 })), { audioMs: 1500 });
  assert.equal(voice.inspectWav(wav({ rate: 44100 })), null, "wrong sample rate");
  assert.equal(voice.inspectWav(wav({ channels: 2 })), null, "stereo");
  assert.equal(voice.inspectWav(wav({ bits: 8 })), null, "8-bit");
  assert.equal(voice.inspectWav(wav({ seconds: 61 })), null, "longer than a minute");
  assert.equal(voice.inspectWav(new Uint8Array(10)), null);
  assert.equal(voice.inspectWav(new TextEncoder().encode("RIFF....WAVEjunkjunkjunkjunkjunkjunkjunkjunkjunkjunk")), null);
  assert.equal(voice.inspectWav(wav({ seconds: 0 })), null, "no audio at all");
});

test("transcribe: a transcript comes back, bad audio is 422, and nothing is logged but counters", async (t) => {
  const w = await world(t);
  const p = await w.person();
  const ok = await vh.handleTranscribe(w.audio(wav({ seconds: 2 })), w.deps(p.jar));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { text: "Factorise x squared plus five x plus six", confidence: 0.92, confidenceSource: "tokens", noSpeech: 0.02 });
  const short = await vh.handleTranscribe(w.audio(wav({ seconds: 0.5 })), w.deps(p.jar));
  assert.equal((await short.json()).confidence, 0.3, "the mock is unsure of a very short recording, so the confirm path can be tested");
  assert.equal(ok.headers.get("cache-control"), "no-store");
  const bad = await vh.handleTranscribe(w.audio(wav({ rate: 8000 })), w.deps(p.jar));
  assert.equal(bad.status, 422);
  assert.equal((await bad.json()).code, "bad_audio");
  assert.doesNotMatch(w.lines.join("\n"), /Factorise|five x/, "the transcript is never logged");
});

test("both voice routes share the chat's gates: sign-in, Library access, origin, kill switches and production", async (t) => {
  const w = await world(t);
  const p = await w.person();
  const signedOut = { get: () => undefined, set() {}, delete() {} };
  assert.equal((await vh.handleTranscribe(w.audio(wav()), w.deps(signedOut))).status, 401);
  assert.equal((await vh.handleSpeak(w.speak({ text: "Hello." }), w.deps(signedOut))).status, 401);
  const free = await w.person(false);
  assert.equal((await vh.handleTranscribe(w.audio(wav()), w.deps(free.jar))).status, 403);
  const evil = { headers: { origin: "https://evil.example" } };
  assert.equal((await vh.handleTranscribe(w.audio(wav(), evil), w.deps(p.jar))).status, 403);
  assert.equal((await vh.handleSpeak(w.speak({ text: "Hello." }, evil), w.deps(p.jar))).status, 403);

  for (const [name, over] of [
    ["voice switched off", { env: { ...ENV, VOICE_ENABLED: "false" } }],
    ["assistant off", { env: { ...ENV, ASSISTANT_ENABLED: "false" } }],
    ["no speech runtime", { voice: null }],
    ["production, even with everything on", { env: { NODE_ENV: "production", ASSISTANT_ENABLED: "true", ASSISTANT_PRODUCTION_APPROVED: "true", ASSISTANT_PROVIDER: "custom", ASSISTANT_BASE_URL: "https://x.example", ASSISTANT_API_KEY: "k", VOICE_ENABLED: "true" } }],
  ]) {
    const a = await vh.handleTranscribe(w.audio(wav()), w.deps(p.jar, over));
    assert.equal(a.status, 503, name);
    assert.equal((await vh.handleSpeak(w.speak({ text: "Hello." }), w.deps(p.jar, over))).status, 503, name);
  }
});

test("speak: a short text becomes audio; empty, long and malformed requests are refused", async (t) => {
  const w = await world(t);
  const p = await w.person();
  const ok = await vh.handleSpeak(w.speak({ text: "Try the next step." }), w.deps(p.jar));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "audio/wav");
  assert.ok((await ok.arrayBuffer()).byteLength > 44);
  for (const body of [{ text: "" }, { text: "x".repeat(601) }, { nope: 1 }, "not json"]) assert.equal((await vh.handleSpeak(w.speak(body), w.deps(p.jar))).status, 400, JSON.stringify(body).slice(0, 30));
});

test("each family has an hourly cap, counted per hour", async (t) => {
  const w = await world(t);
  const p = await w.person();
  const limit = voice.VOICE_LIMITS.sttPerHour;
  for (let i = 0; i < limit; i += 1) assert.equal((await vh.handleTranscribe(w.audio(wav({ seconds: 0.1 })), w.deps(p.jar))).status, 200);
  const over = await vh.handleTranscribe(w.audio(wav({ seconds: 0.1 })), w.deps(p.jar));
  assert.equal(over.status, 429);
  assert.equal(over.headers.get("retry-after"), "600");
  const later = await vh.handleTranscribe(w.audio(wav({ seconds: 0.1 })), w.deps(p.jar, { now: () => new Date(NOW.getTime() + 3_600_000) }));
  assert.equal(later.status, 200);
  assert.equal((await vh.handleSpeak(w.speak({ text: "Still allowed." }), w.deps(p.jar))).status, 200, "speaking has its own counter");
});

test("a transcript is sent by itself only when it is neither unsure nor easy to mishear", () => {
  // A measured confidence decides first, exactly as the panel always did.
  assert.deepEqual(trust.judgeTranscript({ text: "What is a fraction?", confidence: 0.9 }), { send: true, ask: false, why: null });
  assert.deepEqual(trust.judgeTranscript({ text: "What is a fraction?", confidence: 0.4 }), { send: false, ask: true, why: "unsure" });
  // Maths that could be the wrong member of a pair (the brief's list) is held to the higher bar...
  assert.deepEqual(trust.judgeTranscript({ text: "Factorise x cubed plus five x", confidence: 0.7 }), { send: false, ask: true, why: "ambiguous" });
  // ...and passes only with a high measured confidence.
  assert.deepEqual(trust.judgeTranscript({ text: "Factorise x cubed plus five x", confidence: 0.95 }), { send: true, ask: false, why: null });
  // With no measured confidence at all, an ambiguous maths question is never sent unseen.
  assert.deepEqual(trust.judgeTranscript({ text: "Solve two x minus seven equals nineteen", confidence: null }), { send: false, ask: true, why: "ambiguous" });
  assert.deepEqual(trust.judgeTranscript({ text: "Find the sine of thirty", confidence: null }), { send: false, ask: true, why: "ambiguous" });
  // An ordinary sentence with no score still goes (the silence check has already passed).
  assert.deepEqual(trust.judgeTranscript({ text: "Explain photosynthesis in simple words", confidence: null }), { send: true, ask: false, why: null });
  assert.equal(trust.ambiguousMaths("What is fifteen times fifty?"), "a number that sounds like another");
  assert.equal(trust.ambiguousMaths("What is a denominator?"), "a fraction read aloud");
  assert.equal(trust.ambiguousMaths("Where is my homework?"), null);
});

test("config: voice is development only, needs the assistant, and names its provider", () => {
  assert.equal(voice.voiceClosed(ENV), null);
  assert.equal(voice.voiceClosed({ ...ENV, VOICE_ENABLED: "false" }), "disabled");
  assert.equal(voice.voiceClosed({ ...ENV, ASSISTANT_ENABLED: "false" }), "assistant_closed");
  assert.equal(voice.voiceClosed({ ...ENV, VOICE_PROVIDER: "carrier-pigeon" }), "no_provider");
  assert.equal(voice.voiceClosed({ ...ENV, NODE_ENV: "production" }), "production");
  assert.equal(voice.voiceConfig({}).baseUrl, "http://127.0.0.1:8765");
  assert.equal(voice.voiceConfig({ VOICE_PROVIDER: "mock" }).provider, "mock");
});

test("the speech-service client sends the token, maps its errors and never throws a raw one", async () => {
  const calls = [];
  const reply = (status, body, headers = {}) => async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { status, headers });
  };
  const ok = new voice.SidecarSpeech("http://voice.local:8765/", "secret", reply(200, JSON.stringify({ text: " two plus two ", audioMs: 1200, processingMs: 300 })));
  assert.deepEqual(await ok.transcribe(wav()), { text: "two plus two", audioMs: 1200, processingMs: 300, confidence: 1, confidenceSource: "tokens", noSpeech: 0 }, "an older service without scores is trusted");
  const scored = new voice.SidecarSpeech("http://voice.local:8765", null, reply(200, JSON.stringify({ text: "hm", audioMs: 400, processingMs: 90, confidence: 0.41, confidenceSource: "words", noSpeech: 0.7 })));
  assert.deepEqual(await scored.transcribe(wav()), { text: "hm", audioMs: 400, processingMs: 90, confidence: 0.41, confidenceSource: "words", noSpeech: 0.7 });
  // A recogniser that says it cannot measure a confidence (Parakeet without per-word scores) must not be turned into a confident 1.
  const unscored = new voice.SidecarSpeech("http://voice.local:8765", null, reply(200, JSON.stringify({ text: "what is x cubed", audioMs: 900, processingMs: 120, confidence: null, confidenceSource: "none", noSpeech: 0 })));
  const heard = await unscored.transcribe(wav());
  assert.equal(heard.confidence, null);
  assert.equal(heard.confidenceSource, "none");
  assert.equal(calls[0].url, "http://voice.local:8765/stt");
  assert.equal(calls[0].init.headers["x-voice-token"], "secret");
  assert.equal(calls[0].init.headers["Content-Type"], "audio/wav");

  const spoken = new voice.SidecarSpeech("http://voice.local:8765", null, reply(200, new Uint8Array([1, 2, 3])));
  assert.deepEqual([...(await spoken.speak("Hello."))], [1, 2, 3]);
  assert.equal(calls.at(-1).init.headers["x-voice-token"], undefined);

  const code = async (fetchImpl, run) => {
    try {
      await run(new voice.SidecarSpeech("http://x", null, fetchImpl));
      return "no error";
    } catch (error) {
      return error instanceof voice.VoiceError ? error.code : `raw: ${error}`;
    }
  };
  assert.equal(await code(reply(400, "{}"), (s) => s.transcribe(wav())), "bad_audio");
  assert.equal(await code(reply(500, "{}"), (s) => s.transcribe(wav())), "unavailable");
  assert.equal(await code(reply(200, "not json"), (s) => s.transcribe(wav())), "unavailable");
  assert.equal(await code(async () => { throw new TypeError("fetch failed"); }, (s) => s.speak("Hello.")), "unavailable");
  assert.equal(await code(async () => { throw new DOMException("t", "TimeoutError"); }, (s) => s.speak("Hello.")), "timeout");
  const controller = new AbortController();
  controller.abort();
  assert.equal(await code(async () => { throw new DOMException("a", "AbortError"); }, (s) => s.speak("Hello.", controller.signal)), "aborted");
});

test("status says whether the microphone should appear, and a voice-mode question adds the spoken-wording prompt for that turn only", async (t) => {
  const w = await world(t);
  const p = await w.person();
  const status = async (over) => (await (await h.handleStatus(new Request("http://localhost:3100/api/assistant/status"), w.deps(p.jar, over))).json());
  assert.equal((await status()).voice, true);
  assert.equal((await status({ voice: null })).voice, false);
  assert.equal((await status({ env: { ...ENV, VOICE_ENABLED: "false" } })).voice, false);

  const ask = async (extra) => {
    const response = await h.handleChat(new Request("http://localhost:3100/api/assistant/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "What is a fraction?", adultAck: true, ...extra }) }), w.deps(p.jar));
    await response.text();
  };
  await ask({});
  await ask({ voice: true });
  const systems = w.seen.map((m) => m[0].content);
  assert.equal(systems.length, 2);
  assert.ok(!systems[0].includes(speech.VOICE_PROMPT_ADDENDUM), "typed chat: unchanged");
  assert.ok(systems[1].endsWith(speech.VOICE_PROMPT_ADDENDUM), "voice chat: the spoken-wording addendum");
});

test("browser audio: blocks are resampled to 16 kHz without losing the tone, and the WAV is what the server accepts", () => {
  // One second of a 440 Hz tone at the usual 48 kHz microphone rate, in blocks like the worklet's.
  const rate = 48000;
  const tone = Float32Array.from({ length: rate }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate));
  const blocks = [];
  for (let at = 0; at < tone.length; at += 2048) blocks.push(tone.slice(at, at + 2048));
  const out = audio.resampleTo16k(blocks, rate);
  assert.equal(out.length, 16000);
  assert.ok(Math.abs(audio.peak(out) - 0.5) < 0.05, `peak ${audio.peak(out)}`);
  // Zero crossings per second ~ twice the frequency: the pitch survived.
  let crossings = 0;
  for (let i = 1; i < out.length; i += 1) if (out[i - 1] < 0 !== out[i] < 0) crossings += 1;
  assert.ok(Math.abs(crossings - 880) <= 4, `crossings ${crossings}`);

  assert.equal(audio.resampleTo16k([new Float32Array(160)], 16000).length, 160, "already 16 kHz: untouched");
  assert.equal(audio.resampleTo16k([new Float32Array(441)], 44100).length, 160);
  assert.equal(audio.resampleTo16k([new Float32Array(80)], 8000).length, 160, "a slow device is interpolated up");
  assert.equal(audio.peak(new Float32Array(1000)), 0, "silence has no peak");

  const wavBytes = audio.encodeWav16k(out);
  assert.deepEqual(voice.inspectWav(wavBytes), { audioMs: 1000 }, "the server accepts exactly what the browser makes");
  assert.equal(new DataView(wavBytes.buffer).getInt16(44 + 2 * 1, true) !== 0, true);
  const clipped = audio.encodeWav16k(Float32Array.from([2, -2]));
  const view = new DataView(clipped.buffer);
  assert.equal(view.getInt16(44, true), 32767);
  assert.equal(view.getInt16(46, true), -32768);
});

test("end of speech: a pause between words does not end the turn, a silence does; noise alone and an endless recording stop", () => {
  const blocks = (ep, level, ms) => { const events = []; for (let t = 0; t < ms; t += 43) { const e = ep.push(level, 43); if (e !== "none") events.push(e); } return events; };
  // Quiet room, then a sentence with a short pause in it, then silence.
  const ep = audio.createEndpointer();
  assert.deepEqual(blocks(ep, 0.004, 600), []);
  assert.deepEqual(blocks(ep, 0.12, 700), ["speech_started"]);
  assert.deepEqual(blocks(ep, 0.004, 400), [], "a 400 ms pause between words is not the end");
  assert.deepEqual(blocks(ep, 0.1, 500), []);
  assert.deepEqual(blocks(ep, 0.004, 1000), ["utterance_end"]);
  assert.deepEqual(blocks(ep, 0.2, 500), [], "after the end it reports nothing more (no second send)");

  // A click is not speech: nothing starts, and after the wait it gives up.
  const click = audio.createEndpointer({ noSpeechMs: 2000 });
  assert.deepEqual(blocks(click, 0.3, 86), []);
  assert.deepEqual(blocks(click, 0.003, 2100), ["no_speech"]);
  assert.equal(click.heardSpeech, false);

  // A noisy room raises the floor: steady noise is not speech, speech well above it is.
  const noisy = audio.createEndpointer({ noSpeechMs: 60_000 });
  assert.deepEqual(blocks(noisy, 0.03, 3000), [], "steady noise at 0.03 is not speech");
  assert.deepEqual(blocks(noisy, 0.2, 500), ["speech_started"]);

  // The floor adapts in time, not per block, so the same sound gives the same result whatever the block size (a 2048-sample
  // block is 43 ms at 48 kHz, 128 ms at 16 kHz): a held sound is speech for its first 2.5 s, and ends as "background" well before 30.
  for (const size of [2.67, 43, 128]) {
    const held = audio.createEndpointer();
    const events = [];
    let ended = null;
    for (let t = 0; t < 10_000 && ended === null; t += size) {
      const e = held.push(0.28, size);
      if (e !== "none") events.push(e);
      if (e === "utterance_end") ended = t;
    }
    assert.equal(events[0], "speech_started");
    assert.ok(ended > 2500 && ended < 6000, `${size} ms blocks: a held sound became background after ${Math.round(ended)} ms`);
  }

  const endless = audio.createEndpointer({ maxMs: 2000 });
  assert.deepEqual(blocks(endless, 0.2, 2100), ["speech_started", "too_long"]);
  assert.ok(Math.abs(audio.rms(Float32Array.from([0.5, -0.5, 0.5, -0.5])) - 0.5) < 1e-9);
});

test("a whole message is read in pieces the speech route accepts, without losing its last words", () => {
  // One sentence far longer than one request: the read-aloud button must cut it at word boundaries, not drop its end.
  const long = `${Array.from({ length: 200 }, () => "word").join(" ")}. Final sentence.`;
  const pieces = speech.speechChunksWhole(long, 300);
  assert.ok(pieces.length > 1);
  assert.ok(pieces.every((p) => p.length <= 300), "each request stays under the route's 600-character limit");
  assert.equal(pieces.join(" "), long);
  assert.ok(pieces.at(-1).endsWith("Final sentence."), "the end of the message is still spoken");
  assert.deepEqual(speech.speechChunksWhole(""), []);
});
