import type { SfuPublication, SfuRequest, SfuTrackInfo } from '@learnthrive/shared/protocol';
import { createLogger } from './log';

const sfuLog = createLogger('sfu');

/**
 * The browser half of the Cloudflare SFU (docs/LAUNCH_CHECKLIST.md 3.13). Replaces the peer-to-peer mesh (peer.ts) when the server says a
 * room is an SFU room: every participant sends ONE copy of their camera and microphone to Cloudflare and pulls everyone else's from it.
 *
 *   publisher session   one RTCPeerConnection, two send-only transceivers (audio, video), published once on join. A camera or screen
 *                       share swaps the video track in place with replaceTrack, exactly as the mesh did, so nothing renegotiates.
 *   subscriber session  a second RTCPeerConnection that only receives. Each other participant's two tracks are pulled by
 *                       (their sessionId, their trackName); Cloudflare answers with an offer, which we answer.
 *
 * The browser never talks to Cloudflare: every call goes to our server over Socket.IO (`transport.request`), which holds the app
 * secret and checks the track belongs to this room. Cloudflare changes one session one call at a time, so each session has its own
 * queue here (and the server has one too).
 *
 * A publisher track with no packets is collected by Cloudflare after 30 seconds, so a participant with no camera or microphone sends a
 * silent audio track and a black video track (placeholders) until a real one exists; muting only disables the real track, which still
 * sends black frames and silence.
 */

export type SfuConnection = 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface SfuTransport {
  /** Sends one SFU request through the server and resolves with the data, or rejects with the server's message. */
  request: (request: SfuRequest) => Promise<Record<string, unknown>>;
  /** Tells the room which tracks this participant published into which session. */
  publish: (sessionId: string, tracks: SfuTrackInfo[]) => Promise<void>;
}

export interface SfuCallbacks {
  /** A participant's stream. The SAME object is updated as their tracks arrive, so a <video> attached to it keeps playing. */
  stream: (participantId: string, stream: MediaStream | null) => void;
  connection: (state: SfuConnection) => void;
  error: (error: unknown) => void;
}

export interface SfuLocalMedia { track(kind: 'audio' | 'video'): MediaStreamTrack | undefined }

export interface SfuDeps {
  /** ICE servers (STUN plus the short-lived Cloudflare TURN credentials): meeting.ts passes getIceConfiguration from ice.ts. */
  iceConfiguration?: () => RTCConfiguration;
  /** Nothing is sent to Cloudflare until this settles (meeting.ts passes the TURN credential fetch, so the first connections can use them). */
  ready?: Promise<unknown>;
  createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection;
  createStream?: () => MediaStream;
  placeholder?: (kind: 'audio' | 'video') => { track: MediaStreamTrack; stop: () => void };
  retryDelayMs?: number;
}

const AUDIO: SfuTrackInfo = { trackName: 'audio', kind: 'audio' };
const VIDEO: SfuTrackInfo = { trackName: 'video', kind: 'video' };
const MAX_RESTARTS = 3;

/** A track that always sends something. Used only when there is no real camera or microphone. */
export function createPlaceholderTrack(kind: 'audio' | 'video'): { track: MediaStreamTrack; stop: () => void } {
  if (kind === 'video') {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext('2d');
    let flip = false;
    const paint = () => {
      if (!context) return;
      context.fillStyle = flip ? '#000000' : '#010101';
      context.fillRect(0, 0, canvas.width, canvas.height);
      flip = !flip;
    };
    paint();
    // A canvas stream only emits a frame when the canvas changes, so a near-invisible change every second keeps packets flowing.
    const timer = setInterval(paint, 1000);
    const track = canvas.captureStream(1).getVideoTracks()[0];
    return { track, stop: () => { clearInterval(timer); track.stop(); } };
  }
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const source = context.createConstantSource();
  source.offset.value = 0;
  source.connect(destination);
  source.start();
  const track = destination.stream.getAudioTracks()[0];
  return { track, stop: () => { track.stop(); void context.close(); } };
}

interface Publisher { pc: RTCPeerConnection; sessionId: string; audio: RTCRtpSender; video: RTCRtpSender }
interface Subscriber { pc: RTCPeerConnection; sessionId: string }

export class SfuMedia {
  private publisher: Publisher | null = null;
  private subscriber: Subscriber | null = null;
  private subscriberReady: Promise<Subscriber> | null = null;
  private readonly wanted = new Map<string, SfuPublication>();
  private readonly pulledMids = new Map<string, string[]>();
  private readonly midOwner = new Map<string, { participantId: string; kind: 'audio' | 'video' }>();
  private readonly streams = new Map<string, MediaStream>();
  private readonly placeholders = new Map<'audio' | 'video', { track: MediaStreamTrack; stop: () => void }>();
  private publisherQueue: Promise<unknown> = Promise.resolve();
  private subscriberQueue: Promise<unknown> = Promise.resolve();
  private audioOverride: MediaStreamTrack | null = null;
  private videoOverride: MediaStreamTrack | null = null;
  private maxBitrateKbps: number | null = null;
  private publisherState: SfuConnection = 'connecting';
  private subscriberState: SfuConnection | null = null;
  private restarts = { publisher: 0, subscriber: 0 };
  private closed = false;

  constructor(
    private readonly transport: SfuTransport,
    private readonly media: SfuLocalMedia,
    private readonly callbacks: SfuCallbacks,
    private readonly deps: SfuDeps = {},
  ) {}

  // ---- serialization: one queue per session ------------------------------------------------------------------------------------

  private enqueue(which: 'publisher' | 'subscriber', task: () => Promise<void>): Promise<void> {
    const run = async () => {
      await this.deps.ready;
      if (!this.closed) await task();
    };
    const next = (which === 'publisher' ? this.publisherQueue : this.subscriberQueue).then(run, run);
    const tail = next.catch((error: unknown) => { if (!this.closed) { sfuLog.warn(`${which} task failed`, error); this.callbacks.error(error); } });
    if (which === 'publisher') this.publisherQueue = tail;
    else this.subscriberQueue = tail;
    return next;
  }

  private newPeerConnection(): RTCPeerConnection {
    const base = this.deps.iceConfiguration?.() ?? { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] };
    const configuration: RTCConfiguration = { ...base, bundlePolicy: 'max-bundle' };
    return this.deps.createPeerConnection ? this.deps.createPeerConnection(configuration) : new RTCPeerConnection(configuration);
  }

  private async newSession(): Promise<string> {
    const data = await this.transport.request({ op: 'session.new' });
    if (typeof data.sessionId !== 'string') throw new Error('The media service did not return a session.');
    return data.sessionId;
  }

  private placeholderFor(kind: 'audio' | 'video'): MediaStreamTrack {
    let entry = this.placeholders.get(kind);
    if (!entry) {
      entry = (this.deps.placeholder ?? createPlaceholderTrack)(kind);
      this.placeholders.set(kind, entry);
    }
    return entry.track;
  }

  private outgoing(kind: 'audio' | 'video'): MediaStreamTrack {
    const override = kind === 'audio' ? this.audioOverride : this.videoOverride;
    return override ?? this.media.track(kind) ?? this.placeholderFor(kind);
  }

  // ---- publishing --------------------------------------------------------------------------------------------------------------

  /** Opens the publisher session and publishes camera and microphone. Resolves when the room has been told. */
  start(): Promise<void> {
    return this.enqueue('publisher', () => this.publish());
  }

  private async publish(): Promise<void> {
    this.setPublisherState('connecting');
    const sessionId = await this.newSession();
    const pc = this.newPeerConnection();
    try {
      const audio = pc.addTransceiver(this.outgoing('audio'), { direction: 'sendonly' });
      const video = pc.addTransceiver(this.outgoing('video'), { direction: 'sendonly' });
      await pc.setLocalDescription(await pc.createOffer());
      const offer = pc.localDescription;
      if (!offer || audio.mid == null || video.mid == null) throw new Error('Your browser could not prepare its media connection.');
      const result = await this.transport.request({
        op: 'tracks.new', sessionId,
        body: {
          sessionDescription: { type: 'offer', sdp: offer.sdp },
          tracks: [{ location: 'local', mid: audio.mid, trackName: AUDIO.trackName }, { location: 'local', mid: video.mid, trackName: VIDEO.trackName }],
        },
      });
      const failed = firstTrackError(result);
      const answer = result.sessionDescription as RTCSessionDescriptionInit | undefined;
      if (failed || !answer) throw new Error(failed ?? 'The media service did not accept your camera and microphone.');
      await pc.setRemoteDescription(answer);
      pc.onconnectionstatechange = () => this.onPublisherState(pc);
      this.publisher = { pc, sessionId, audio: audio.sender, video: video.sender };
      await this.applyBitrate();
      await this.transport.publish(sessionId, [AUDIO, VIDEO]);
      this.onPublisherState(pc);
    } catch (error) {
      pc.close();
      throw error;
    }
  }

  private onPublisherState(pc: RTCPeerConnection) {
    if (this.closed || this.publisher?.pc !== pc) return;
    const state = pc.connectionState;
    if (state === 'connected') { this.restarts.publisher = 0; this.setPublisherState('connected'); }
    else if (state === 'failed') { this.setPublisherState('reconnecting'); void this.restartPublisher(); }
    else if (state === 'disconnected') this.setPublisherState('reconnecting');
    else this.setPublisherState('connecting');
  }

  private async restartPublisher() {
    if (this.closed) return;
    if (this.restarts.publisher >= MAX_RESTARTS) { this.setPublisherState('failed'); return; }
    this.restarts.publisher += 1;
    const old = this.publisher;
    this.publisher = null;
    old?.pc.close();
    // The server replaces our previous publication when we publish again, and tells everyone to pull the new one.
    await this.enqueue('publisher', () => this.publish()).catch(() => { if (!this.closed) this.setPublisherState('failed'); });
  }

  /** Swaps the outgoing tracks in place (camera on/off, a device switch, a screen share starting or stopping). No renegotiation. */
  syncTracks(overrides?: { audio?: MediaStreamTrack | null; video?: MediaStreamTrack | null }) {
    if (overrides && 'audio' in overrides) this.audioOverride = overrides.audio ?? null;
    if (overrides && 'video' in overrides) this.videoOverride = overrides.video ?? null;
    void this.enqueue('publisher', async () => {
      const publisher = this.publisher;
      if (!publisher) return;
      const audio = this.outgoing('audio');
      const video = this.outgoing('video');
      if (publisher.audio.track !== audio) await publisher.audio.replaceTrack(audio);
      if (publisher.video.track !== video) await publisher.video.replaceTrack(video);
    });
  }

  /** Caps the outgoing video encode; null clears the cap (an active screen share stays legible). Best effort. */
  async setVideoSendBitrate(kbps: number | null) {
    this.maxBitrateKbps = kbps;
    await this.applyBitrate();
  }

  private async applyBitrate() {
    const sender = this.publisher?.video;
    if (!sender) return;
    try {
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) parameters.encodings = [{}];
      parameters.encodings[0].maxBitrate = this.maxBitrateKbps != null ? this.maxBitrateKbps * 1000 : undefined;
      await sender.setParameters(parameters);
    } catch (error) {
      sfuLog.warn('Could not apply the video bitrate cap', error);
    }
  }

  // ---- subscribing -------------------------------------------------------------------------------------------------------------

  /** Pull (or re-pull) everything someone published. Safe to call again for the same publication. */
  subscribe(publication: SfuPublication): void {
    const existing = this.wanted.get(publication.participantId);
    if (existing?.sessionId === publication.sessionId && this.pulledMids.has(publication.participantId)) return;
    this.wanted.set(publication.participantId, publication);
    void this.enqueue('subscriber', async () => {
      if (this.wanted.get(publication.participantId) !== publication) return; // replaced or removed while waiting its turn
      if (this.pulledMids.has(publication.participantId)) await this.closePulled(publication.participantId);
      await this.pull([publication]);
    });
  }

  /** Stop pulling a participant who left (or whose publication was replaced). */
  unsubscribe(participantId: string): void {
    this.wanted.delete(participantId);
    void this.enqueue('subscriber', () => this.closePulled(participantId));
  }

  private async ensureSubscriber(): Promise<Subscriber> {
    if (this.subscriber) return this.subscriber;
    this.subscriberReady ??= (async () => {
      const sessionId = await this.newSession();
      const pc = this.newPeerConnection();
      pc.ontrack = (event) => this.onRemoteTrack(event);
      pc.onconnectionstatechange = () => this.onSubscriberState(pc);
      const subscriber = { pc, sessionId };
      this.subscriber = subscriber;
      return subscriber;
    })().finally(() => { this.subscriberReady = null; });
    return this.subscriberReady;
  }

  private async pull(publications: SfuPublication[]): Promise<void> {
    const wanted = publications.filter((publication) => this.wanted.get(publication.participantId)?.sessionId === publication.sessionId);
    if (wanted.length === 0) return;
    const subscriber = await this.ensureSubscriber();
    const tracks = wanted.flatMap((publication) => publication.tracks.map((track) => ({ location: 'remote', sessionId: publication.sessionId, trackName: track.trackName })));
    const owners = new Map<string, { participantId: string; kind: 'audio' | 'video' }>();
    for (const publication of wanted) for (const track of publication.tracks) owners.set(`${publication.sessionId}/${track.trackName}`, { participantId: publication.participantId, kind: track.kind });

    const result = await this.transport.request({ op: 'tracks.new', sessionId: subscriber.sessionId, body: { tracks } });
    const returned = Array.isArray(result.tracks) ? result.tracks as Array<Record<string, unknown>> : [];
    const retry: SfuPublication[] = [];
    // Record who owns each mid BEFORE applying the offer: the tracks arrive (ontrack) while setRemoteDescription runs.
    for (const publication of wanted) {
      const mids: string[] = [];
      let failed = false;
      for (const track of publication.tracks) {
        const entry = returned.find((candidate) => candidate.trackName === track.trackName && (candidate.sessionId === undefined || candidate.sessionId === publication.sessionId))
          ?? returned.find((candidate) => candidate.trackName === track.trackName);
        const owner = owners.get(`${publication.sessionId}/${track.trackName}`);
        if (!entry || typeof entry.mid !== 'string' || entry.errorCode || !owner) { failed = true; continue; }
        mids.push(entry.mid);
        this.midOwner.set(entry.mid, owner);
      }
      if (mids.length) this.pulledMids.set(publication.participantId, [...(this.pulledMids.get(publication.participantId) ?? []), ...mids]);
      if (failed) retry.push(publication);
    }
    const offer = result.sessionDescription as RTCSessionDescriptionInit | undefined;
    if (result.requiresImmediateRenegotiation === true && offer) {
      await subscriber.pc.setRemoteDescription(offer);
      await subscriber.pc.setLocalDescription(await subscriber.pc.createAnswer());
      const answer = subscriber.pc.localDescription;
      if (!answer) throw new Error('Your browser could not answer the media service.');
      await this.transport.request({ op: 'renegotiate', sessionId: subscriber.sessionId, body: { sessionDescription: { type: 'answer', sdp: answer.sdp } } });
    }
    // A pull can fail for a track whose publisher is still finishing: try those once more shortly, then give up quietly.
    if (retry.length) {
      const delay = this.deps.retryDelayMs ?? 1500;
      setTimeout(() => {
        if (this.closed) return;
        const again = retry.filter((publication) => this.wanted.get(publication.participantId)?.sessionId === publication.sessionId && !this.pulledMids.has(publication.participantId));
        if (again.length) void this.enqueue('subscriber', () => this.pull(again));
      }, delay);
    }
  }

  private onRemoteTrack(event: RTCTrackEvent) {
    const mid = event.transceiver.mid;
    const owner = mid ? this.midOwner.get(mid) : undefined;
    if (!owner || this.closed) return;
    let stream = this.streams.get(owner.participantId);
    if (!stream) {
      stream = this.deps.createStream ? this.deps.createStream() : new MediaStream();
      this.streams.set(owner.participantId, stream);
    }
    for (const old of stream.getTracks().filter((track) => track.kind === owner.kind)) stream.removeTrack(old);
    stream.addTrack(event.track);
    this.callbacks.stream(owner.participantId, stream);
  }

  private async closePulled(participantId: string): Promise<void> {
    const mids = this.pulledMids.get(participantId);
    this.pulledMids.delete(participantId);
    for (const [mid, owner] of this.midOwner) if (owner.participantId === participantId) this.midOwner.delete(mid);
    const stream = this.streams.get(participantId);
    if (stream) for (const track of stream.getTracks()) stream.removeTrack(track);
    this.streams.delete(participantId);
    this.callbacks.stream(participantId, null);
    const subscriber = this.subscriber;
    if (!mids?.length || !subscriber) return;
    try {
      await this.transport.request({ op: 'tracks.close', sessionId: subscriber.sessionId, body: { tracks: mids.map((mid) => ({ mid })), force: true } });
    } catch (error) {
      sfuLog.warn('Could not close pulled tracks', error); // Cloudflare collects idle tracks itself; nothing the person needs to see.
    }
  }

  private onSubscriberState(pc: RTCPeerConnection) {
    if (this.closed || this.subscriber?.pc !== pc) return;
    const state = pc.connectionState;
    this.subscriberState = state === 'connected' ? 'connected' : state === 'failed' ? 'reconnecting' : state === 'disconnected' ? 'reconnecting' : 'connecting';
    if (state === 'connected') this.restarts.subscriber = 0;
    if (state === 'failed') void this.restartSubscriber();
    this.report();
  }

  /** A failed receive connection: build a new session and pull everyone again. */
  private async restartSubscriber() {
    if (this.closed) return;
    if (this.restarts.subscriber >= MAX_RESTARTS) { this.subscriberState = 'failed'; this.report(); return; }
    this.restarts.subscriber += 1;
    await this.enqueue('subscriber', async () => {
      const old = this.subscriber;
      this.subscriber = null;
      old?.pc.close();
      const everyone = [...this.wanted.values()];
      for (const participantId of [...this.pulledMids.keys()]) {
        this.pulledMids.delete(participantId);
        this.streams.delete(participantId);
        this.callbacks.stream(participantId, null);
      }
      this.midOwner.clear();
      await this.pull(everyone);
    }).catch(() => { if (!this.closed) { this.subscriberState = 'failed'; this.report(); } });
  }

  // ---- state and teardown ------------------------------------------------------------------------------------------------------

  private setPublisherState(state: SfuConnection) {
    this.publisherState = state;
    this.report();
  }

  private report() {
    const states = [this.publisherState, ...(this.subscriberState ? [this.subscriberState] : [])];
    const worst = states.includes('failed') ? 'failed' : states.includes('reconnecting') ? 'reconnecting' : states.includes('connecting') ? 'connecting' : 'connected';
    if (!this.closed) this.callbacks.connection(worst);
  }

  close() {
    this.closed = true;
    if (this.publisher) { this.publisher.pc.onconnectionstatechange = null; this.publisher.pc.close(); }
    if (this.subscriber) { this.subscriber.pc.onconnectionstatechange = null; this.subscriber.pc.ontrack = null; this.subscriber.pc.close(); }
    this.publisher = null;
    this.subscriber = null;
    for (const entry of this.placeholders.values()) entry.stop();
    this.placeholders.clear();
    this.streams.clear();
    this.wanted.clear();
    this.pulledMids.clear();
    this.midOwner.clear();
  }
}

function firstTrackError(result: Record<string, unknown>): string | null {
  if (typeof result.errorCode === 'string') return `The media service refused your media (${result.errorCode}).`;
  const tracks = Array.isArray(result.tracks) ? result.tracks as Array<Record<string, unknown>> : [];
  const bad = tracks.find((track) => typeof track.errorCode === 'string');
  return bad ? `The media service refused your ${String(bad.trackName ?? 'media')} (${String(bad.errorCode)}).` : null;
}
