import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The browser half of the Cloudflare SFU (src/features/classroom/sfu.ts), driven with a fake RTCPeerConnection and a fake server. This
// proves our own sequencing and bookkeeping against Cloudflare's documented call order. It does NOT prove anything about the real
// Cloudflare service or a real browser: that needs the app id and secret and real devices (docs/LAUNCH_CHECKLIST.md 3.13).
const { SfuMedia } = loadTsFrom(import.meta.url, "../src/features/classroom/sfu.ts");

class FakeStream {
  tracks = [];
  addTrack(track) { this.tracks.push(track); }
  removeTrack(track) { this.tracks = this.tracks.filter((entry) => entry !== track); }
  getTracks() { return [...this.tracks]; }
}

class FakePc {
  static all = [];
  constructor(configuration) {
    this.configuration = configuration;
    this.transceivers = [];
    this.localDescription = null;
    this.connectionState = "new";
    this.closed = false;
    this.ontrack = null;
    this.onconnectionstatechange = null;
    FakePc.all.push(this);
  }
  addTransceiver(track, init) {
    const sender = { track, parameters: { encodings: [] }, async replaceTrack(next) { this.track = next; }, getParameters() { return this.parameters; }, async setParameters(next) { this.parameters = next; } };
    const transceiver = { mid: null, sender, direction: init.direction };
    this.transceivers.push(transceiver);
    return transceiver;
  }
  async createOffer() { return { type: "offer", sdp: `offer-with-${this.transceivers.length}` }; }
  async setLocalDescription(description) {
    this.transceivers.forEach((transceiver, index) => { transceiver.mid ??= String(index); });
    this.localDescription = description;
  }
  async setRemoteDescription(description) {
    if (description.type !== "offer") return;
    // Our fake server encodes the pulled tracks in the offer; a real browser creates receiving transceivers and fires ontrack.
    for (const { mid, kind, id } of JSON.parse(description.sdp)) {
      const transceiver = { mid, sender: {}, receiver: {} };
      this.transceivers.push(transceiver);
      this.ontrack?.({ track: { kind, id }, transceiver });
    }
  }
  async createAnswer() { return { type: "answer", sdp: "the-answer" }; }
  close() { this.closed = true; }
  fire(state) { this.connectionState = state; this.onconnectionstatechange?.(); }
}

function world(options = {}) {
  FakePc.all = [];
  const log = [];
  let sessions = 0;
  let pulls = 0;
  const inFlight = new Map();
  let maxInFlight = 0;
  const failFirstPullOf = options.failFirstPullOf ?? null;
  let failedOnce = false;
  const published = [];
  const transport = {
    async request(request) {
      log.push(`${request.op}${request.sessionId ? ` ${request.sessionId}` : ""}`);
      const current = (inFlight.get(request.sessionId) ?? 0) + 1;
      inFlight.set(request.sessionId, current);
      maxInFlight = Math.max(maxInFlight, current);
      await new Promise((resolve) => setTimeout(resolve, 2)); // lets overlapping calls really overlap if nothing serializes them
      inFlight.set(request.sessionId, current - 1);
      if (request.op === "session.new") { sessions += 1; return { sessionId: `session-${sessions}` }; }
      if (request.op === "tracks.new") {
        const tracks = request.body.tracks;
        if (tracks[0].location === "local") {
          return { requiresImmediateRenegotiation: false, sessionDescription: { type: "answer", sdp: "sfu-answer" }, tracks: tracks.map((t) => ({ mid: t.mid, trackName: t.trackName })) };
        }
        const returned = tracks.map((t) => {
          pulls += 1;
          const bad = failFirstPullOf && t.sessionId === failFirstPullOf && !failedOnce;
          return bad ? { trackName: t.trackName, errorCode: "not_found" } : { mid: `m${pulls}`, trackName: t.trackName, sessionId: t.sessionId };
        });
        if (returned.some((r) => r.errorCode)) failedOnce = true;
        const good = returned.filter((r) => r.mid);
        return {
          requiresImmediateRenegotiation: good.length > 0,
          sessionDescription: { type: "offer", sdp: JSON.stringify(good.map((r) => ({ mid: r.mid, kind: r.trackName, id: `${r.sessionId}-${r.trackName}` }))) },
          tracks: returned,
        };
      }
      return {};
    },
    async publish(sessionId, tracks) { log.push(`publish ${sessionId}`); published.push({ sessionId, tracks }); },
  };
  const streams = new Map();
  const events = [];
  const callbacks = {
    stream: (id, stream) => {
      events.push(`stream ${id} ${stream ? stream.getTracks().length : "none"}`);
      if (stream) streams.set(id, stream);
      else streams.delete(id);
    },
    connection: (state) => events.push(`connection ${state}`),
    error: (error) => events.push(`error ${error.message}`),
  };
  const placeholders = [];
  const deps = {
    createPeerConnection: (configuration) => new FakePc(configuration),
    createStream: () => new FakeStream(),
    placeholder: (kind) => {
      const track = { kind, placeholder: true };
      placeholders.push(track);
      return { track, stop() { track.stopped = true; } };
    },
    retryDelayMs: 5,
  };
  const local = { audio: options.audio, video: options.video };
  const media = new SfuMedia(transport, { track: (kind) => local[kind] }, callbacks, deps);
  return { media, log, events, streams, published, placeholders, local, maxInFlight: () => maxInFlight };
}

const real = () => ({ audio: { kind: "audio", real: true }, video: { kind: "video", real: true } });
const pub = (participantId, sessionId) => ({ participantId, sessionId, tracks: [{ trackName: "audio", kind: "audio" }, { trackName: "video", kind: "video" }] });
const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
// Waits until `done()` is true or `ms` passes, then returns either way, so the assertions after it judge the result. A fixed wait
// was not enough on a loaded Windows machine (timers tick at about 15 ms there), where three joiners queued one call at a time
// had not all landed after 150 ms (clean-checkout gate, 6 Nov 2026).
const settleUntil = async (done, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) await settle(10);
};

test("start: one send-only audio and one send-only video, offered with the browser's mids, then announced to the room", async () => {
  const w = world(real());
  await w.media.start();
  assert.deepEqual(w.log, ["session.new", "tracks.new session-1", "publish session-1"]);
  const [pc] = FakePc.all;
  assert.equal(pc.configuration.bundlePolicy, "max-bundle");
  assert.deepEqual(pc.transceivers.map((t) => [t.direction, t.mid, t.sender.track.real]), [["sendonly", "0", true], ["sendonly", "1", true]]);
  assert.deepEqual(w.published, [{ sessionId: "session-1", tracks: [{ trackName: "audio", kind: "audio" }, { trackName: "video", kind: "video" }] }]);
  assert.equal(w.placeholders.length, 0, "a real camera and microphone need no placeholder");
});

test("with no camera or microphone it publishes placeholders so Cloudflare does not collect the tracks, and a real track replaces one in place", async () => {
  const w = world();
  await w.media.start();
  assert.deepEqual(w.placeholders.map((t) => t.kind).sort(), ["audio", "video"]);
  const [pc] = FakePc.all;
  assert.ok(pc.transceivers.every((t) => t.sender.track.placeholder));
  const camera = { kind: "video", real: true };
  w.local.video = camera;
  w.media.syncTracks();
  await settle();
  assert.equal(pc.transceivers[1].sender.track, camera);
  assert.equal(pc.transceivers[0].sender.track.placeholder, true, "the microphone is still the placeholder");
  assert.equal(FakePc.all.length, 1, "no renegotiation, no new connection");
});

test("a screen share replaces the outgoing video in place and ending it restores the camera", async () => {
  const camera = { kind: "video", id: "camera" };
  const w = world({ audio: { kind: "audio" }, video: camera });
  await w.media.start();
  const [pc] = FakePc.all;
  const screen = { kind: "video", id: "screen" };
  w.media.syncTracks({ video: screen });
  await settle();
  assert.equal(pc.transceivers[1].sender.track, screen);
  w.media.syncTracks({ video: null });
  await settle();
  assert.equal(pc.transceivers[1].sender.track, camera);
});

test("subscribe: pulls the other participant's tracks into a receive-only session and answers Cloudflare's offer", async () => {
  const w = world(real());
  await w.media.start();
  w.log.length = 0;
  w.media.subscribe(pub("tutor", "tutor-session"));
  await settle();
  assert.deepEqual(w.log, ["session.new", "tracks.new session-2", "renegotiate session-2"]);
  const stream = w.streams.get("tutor");
  assert.ok(stream, "the tutor has a stream");
  assert.deepEqual(stream.getTracks().map((t) => t.kind).sort(), ["audio", "video"]);
  assert.equal(FakePc.all.length, 2, "one connection to send, one to receive");
});

test("several joiners at once are pulled one call at a time on the one session", async () => {
  const w = world(real());
  await w.media.start();
  w.media.subscribe(pub("a", "sess-a1234567"));
  w.media.subscribe(pub("b", "sess-b1234567"));
  w.media.subscribe(pub("c", "sess-c1234567"));
  await settleUntil(() => w.streams.size >= 3);
  await settle(); // the last joiner's renegotiation follows its stream; let it land so the overlap check sees it
  assert.equal(w.maxInFlight(), 1, "never two overlapping changes to one session");
  assert.deepEqual([...w.streams.keys()].sort(), ["a", "b", "c"]);
  assert.equal(w.log.filter((line) => line === "session.new").length, 2, "one publish session, one receive session, however many people");
});

test("a repeat of the same publication does not pull twice; a new publication replaces the old tracks", async () => {
  const w = world(real());
  await w.media.start();
  w.media.subscribe(pub("a", "sess-a1234567"));
  await settle();
  w.media.subscribe(pub("a", "sess-a1234567"));
  await settle();
  assert.equal(w.log.filter((line) => line.startsWith("tracks.new session-2")).length, 1);
  w.media.subscribe(pub("a", "sess-a7654321"));
  await settle();
  assert.equal(w.log.filter((line) => line.startsWith("tracks.close")).length, 1, "the old tracks were closed");
  assert.equal(w.log.filter((line) => line.startsWith("tracks.new session-2")).length, 2);
  assert.ok(w.streams.get("a"));
});

test("unsubscribe closes the pulled tracks (forced, no negotiation) and drops the stream", async () => {
  const w = world(real());
  await w.media.start();
  w.media.subscribe(pub("a", "sess-a1234567"));
  await settle();
  w.log.length = 0;
  w.media.unsubscribe("a");
  await settle();
  assert.deepEqual(w.log, ["tracks.close session-2"]);
  assert.equal(w.streams.has("a"), false);
  assert.ok(w.events.includes("stream a none"));
});

test("a track that is not ready yet is tried once more shortly, and a stream appears when it works", async () => {
  const w = world({ ...real(), failFirstPullOf: "sess-late1234" });
  await w.media.start();
  w.media.subscribe(pub("late", "sess-late1234"));
  await settle(200);
  assert.ok(w.streams.get("late"), "the second attempt delivered the tracks");
  assert.equal(w.log.filter((line) => line.startsWith("tracks.new session-2")).length, 2);
});

test("a failed send connection is rebuilt with a new session and re-announced, and gives up after three rebuilds", async () => {
  const w = world(real());
  await w.media.start();
  FakePc.all[0].fire("connected");
  assert.equal(w.events.at(-1), "connection connected");
  FakePc.all[0].fire("failed");
  await settle(80);
  assert.equal(w.published.length, 2, "published again into a new session");
  assert.notEqual(w.published[0].sessionId, w.published[1].sessionId);
  assert.equal(FakePc.all[0].closed, true);
  for (let i = 0; i < 4; i += 1) { FakePc.all.at(-1).fire("failed"); await settle(60); }
  assert.equal(w.events.at(-1), "connection failed");
});

test("a failed receive connection pulls everyone again into a new session", async () => {
  const w = world(real());
  await w.media.start();
  w.media.subscribe(pub("a", "sess-a1234567"));
  w.media.subscribe(pub("b", "sess-b1234567"));
  await settle(100);
  const receiver = FakePc.all[1];
  receiver.fire("failed");
  await settle(120);
  assert.equal(receiver.closed, true);
  assert.deepEqual([...w.streams.keys()].sort(), ["a", "b"]);
  assert.ok(FakePc.all.length >= 3);
});

test("the video cap is applied to the sender and cleared with null", async () => {
  const w = world(real());
  await w.media.start();
  await w.media.setVideoSendBitrate(700);
  assert.equal(FakePc.all[0].transceivers[1].sender.parameters.encodings[0].maxBitrate, 700_000);
  await w.media.setVideoSendBitrate(null);
  assert.equal(FakePc.all[0].transceivers[1].sender.parameters.encodings[0].maxBitrate, undefined);
});

test("close ends both connections, stops the placeholders and ignores late work", async () => {
  const w = world();
  await w.media.start();
  w.media.subscribe(pub("a", "sess-a1234567"));
  await settle();
  w.media.close();
  assert.ok(FakePc.all.every((pc) => pc.closed));
  assert.ok(w.placeholders.every((track) => track.stopped));
  const before = w.events.length;
  w.media.subscribe(pub("b", "sess-b1234567"));
  await settle();
  assert.equal(w.events.length, before);
});
