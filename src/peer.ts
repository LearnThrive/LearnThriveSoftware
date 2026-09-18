import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, SignalCandidate, SignalDescription } from '../shared/protocol';
import { getIceConfiguration } from './ice';
import { createLogger } from './log';
import type { LocalMedia } from './media';
import { parseStats, type CallStats, type StatsSample } from './stats';

const statsLog = createLogger('stats');

const NEGOTIATION_RETRY_MS = 3000;
const MAX_NEGOTIATION_ATTEMPTS = 3;
const MAX_ICE_RESTARTS = 2;
const STATS_INTERVAL_MS = 2500;

type SignallingSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface TrackSnapshot {
  id: string;
  enabled: boolean;
  muted: boolean;
  readyState: MediaStreamTrackState;
}

export interface DirectionDiagnostics {
  localAudio: TrackSnapshot | null;
  localVideo: TrackSnapshot | null;
  remoteAudio: TrackSnapshot | null;
  remoteVideo: TrackSnapshot | null;
  audioDirection: RTCRtpTransceiverDirection | null;
  audioCurrentDirection: RTCRtpTransceiverDirection | null;
  videoDirection: RTCRtpTransceiverDirection | null;
  videoCurrentDirection: RTCRtpTransceiverDirection | null;
}

interface PeerCallbacks {
  stream: (stream: MediaStream) => void;
  state: (connection: RTCPeerConnectionState, ice: RTCIceConnectionState, signalling: RTCSignalingState) => void;
  error: (error: unknown) => void;
  stats?: (stats: CallStats) => void;
  direction?: (diagnostics: DirectionDiagnostics) => void;
}

export class PeerSession {
  private readonly pc = new RTCPeerConnection(getIceConfiguration());
  private readonly remote = new MediaStream();
  private readonly senders = new Map<'audio' | 'video', RTCRtpSender>();
  private pendingIce: RTCIceCandidateInit[] = [];
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private negotiationTimer: ReturnType<typeof setTimeout> | undefined;
  private negotiationAttempts = 0;
  private iceRestarts = 0;
  private videoOverride: MediaStreamTrack | null = null;
  private audioOverride: MediaStreamTrack | null = null;
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  private lastStatsSample: StatsSample | null = null;

  constructor(
    readonly sessionId: string,
    private readonly initiator: boolean,
    private readonly socket: SignallingSocket,
    private readonly media: LocalMedia,
    private readonly callbacks: PeerCallbacks,
  ) {
    // Only the initiator pre-adds transceivers before any signalling. If the answerer also
    // pre-adds its own, Chrome's offer-matching in setRemoteDescription does not reuse them —
    // it creates a *second*, separate pair of (recvonly) transceivers for the offer's m-lines
    // and leaves the answerer's own pre-added, track-carrying transceivers orphaned with a null
    // mid, so the answer always declares recvonly and the answerer's camera/mic are captured
    // locally but never actually sent. That is what produced the asymmetric "one side can't see
    // the other" bug: the side that joins second (and is therefore never the initiator) could
    // never be seen by the other side. The answerer instead attaches its tracks to the
    // transceivers Chrome auto-creates once it has the offer — see `attachAnswererTracks`.
    if (initiator) {
      for (const kind of ['audio', 'video'] as const) {
        const track = media.track(kind);
        const transceiver = this.pc.addTransceiver(track ?? kind, { direction: 'sendrecv', streams: media.stream ? [media.stream] : [] });
        this.senders.set(kind, transceiver.sender);
      }
    }
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate && !this.closed) this.socket.emit('webrtc:ice-candidate', { sessionId, candidate: candidate.toJSON() });
    };
    this.pc.ontrack = ({ track }) => {
      if (!this.remote.getTrackById(track.id)) this.remote.addTrack(track);
      callbacks.stream(this.remote);
    };
    const reportState = () => {
      if (!this.closed) callbacks.state(this.pc.connectionState, this.pc.iceConnectionState, this.pc.signalingState);
    };
    this.pc.onconnectionstatechange = () => {
      reportState();
      // Refresh the debug panel the moment we connect instead of leaving it on stale "none"
      // placeholders until the next periodic poll (up to STATS_INTERVAL_MS later).
      if (this.pc.connectionState === 'connected') void this.pollStats();
      // Only the deterministic initiator ever restarts ICE, so the two sides can never
      // both start a fresh offer at once.
      if (this.pc.connectionState === 'failed' && this.initiator && !this.closed && this.iceRestarts < MAX_ICE_RESTARTS) {
        this.iceRestarts += 1;
        this.negotiate(true);
      }
    };
    this.pc.oniceconnectionstatechange = reportState;
    this.pc.onsignalingstatechange = reportState;
    if (initiator) this.negotiate(false);
    if (callbacks.stats || callbacks.direction) this.statsTimer = setInterval(() => { void this.pollStats(); }, STATS_INTERVAL_MS);
  }

  private async pollStats() {
    if (this.closed) return;
    if (this.callbacks.stats) {
      try {
        const report = await this.pc.getStats();
        if (this.closed) return;
        const { stats, sample } = parseStats(report, this.lastStatsSample);
        this.lastStatsSample = sample;
        this.callbacks.stats(stats);
      } catch (error) {
        statsLog.warn('getStats failed', error);
      }
    }
    if (!this.closed) this.callbacks.direction?.(this.getDirectionDiagnostics());
  }

  private snapshotTrack(track: MediaStreamTrack | null | undefined): TrackSnapshot | null {
    if (!track) return null;
    return { id: track.id, enabled: track.enabled, muted: track.muted, readyState: track.readyState };
  }

  /** Live track/transceiver state for the debug panel — this is what makes an asymmetric
   * "I can't see them" bug (as opposed to a negotiation failure) visible: it distinguishes
   * "no remote track", "track exists but muted/ended", and "direction never negotiated to receive". */
  getDirectionDiagnostics(): DirectionDiagnostics {
    const audioSender = this.senders.get('audio');
    const videoSender = this.senders.get('video');
    const transceivers = this.pc.getTransceivers();
    const audioTransceiver = transceivers.find((t) => t.sender === audioSender);
    const videoTransceiver = transceivers.find((t) => t.sender === videoSender);
    return {
      localAudio: this.snapshotTrack(audioSender?.track),
      localVideo: this.snapshotTrack(videoSender?.track),
      remoteAudio: this.snapshotTrack(this.remote.getAudioTracks()[0]),
      remoteVideo: this.snapshotTrack(this.remote.getVideoTracks()[0]),
      audioDirection: audioTransceiver?.direction ?? null,
      audioCurrentDirection: audioTransceiver?.currentDirection ?? null,
      videoDirection: videoTransceiver?.direction ?? null,
      videoCurrentDirection: videoTransceiver?.currentDirection ?? null,
    };
  }

  /** Overrides the outgoing video track (screen share) without renegotiating; null restores the camera. */
  setVideoOverride(track: MediaStreamTrack | null) {
    this.videoOverride = track;
    this.syncTracks();
  }

  /** Overrides the outgoing audio track (shared tab/system audio, or a mix with the microphone —
   * see ScreenShare.mixWithMicrophone) without renegotiating; null restores the plain microphone. */
  setAudioOverride(track: MediaStreamTrack | null) {
    this.audioOverride = track;
    this.syncTracks();
  }

  /** (Re)starts an offer/answer exchange. Only ever called for the deterministic initiator. */
  private negotiate(iceRestart: boolean) {
    if (!this.initiator || this.closed) return;
    this.negotiationAttempts = 0;
    this.enqueue(() => this.sendOffer(iceRestart));
  }

  private async sendOffer(iceRestart: boolean) {
    if (this.closed) return;
    this.negotiationAttempts += 1;
    const offer = await this.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
    if (this.closed) return;
    await this.pc.setLocalDescription(offer);
    if (this.closed || !this.pc.localDescription) return;
    this.socket.emit('webrtc:offer', { sessionId: this.sessionId, description: this.pc.localDescription.toJSON() });
    // The offer can arrive before the peer has finished constructing its own session and
    // be silently dropped, so resend a few times if nothing answers it.
    clearTimeout(this.negotiationTimer);
    this.negotiationTimer = setTimeout(() => {
      if (this.closed || this.pc.signalingState !== 'have-local-offer') return;
      if (this.negotiationAttempts >= MAX_NEGOTIATION_ATTEMPTS) {
        this.callbacks.error(new Error('The other participant is not responding.'));
        return;
      }
      this.enqueue(() => this.sendOffer(iceRestart));
    }, NEGOTIATION_RETRY_MS);
  }

  private enqueue(operation: () => Promise<void>) {
    this.queue = this.queue.then(async () => {
      if (!this.closed) await operation();
    }).catch((error: unknown) => { if (!this.closed) this.callbacks.error(error); });
  }

  description(payload: SignalDescription) {
    if (payload.sessionId !== this.sessionId) return;
    this.enqueue(async () => {
      const { description } = payload;
      if (description.type === 'offer' && this.initiator) return;
      if (description.type === 'answer' && (!this.initiator || this.pc.signalingState !== 'have-local-offer')) return;
      await this.pc.setRemoteDescription(description);
      clearTimeout(this.negotiationTimer);
      for (const candidate of this.pendingIce) await this.pc.addIceCandidate(candidate);
      this.pendingIce = [];
      if (description.type === 'offer') {
        if (this.senders.size === 0) this.attachAnswererTracks();
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        if (!this.closed && this.pc.localDescription) {
          this.socket.emit('webrtc:answer', { sessionId: this.sessionId, description: this.pc.localDescription.toJSON() });
        }
      }
    });
  }

  /** Attaches the answerer's own tracks to the transceivers Chrome auto-created while applying
   * the initiator's offer (see the constructor comment for why we can't pre-add our own). */
  private attachAnswererTracks() {
    for (const transceiver of this.pc.getTransceivers()) {
      const kind = transceiver.receiver.track?.kind as 'audio' | 'video' | undefined;
      if (!kind || this.senders.has(kind)) continue;
      transceiver.direction = 'sendrecv';
      const track = this.media.track(kind);
      if (track) void transceiver.sender.replaceTrack(track);
      this.senders.set(kind, transceiver.sender);
    }
  }

  candidate(payload: SignalCandidate) {
    if (payload.sessionId !== this.sessionId) return;
    this.enqueue(async () => {
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(payload.candidate);
      else if (this.pendingIce.length < 128) this.pendingIce.push(payload.candidate);
    });
  }

  /** No-ops if the answerer's senders aren't set up yet (the initiator's offer hasn't arrived) —
   * `attachAnswererTracks` reads live media state once it runs, so nothing is lost. */
  syncTracks() {
    this.enqueue(async () => {
      const audioSender = this.senders.get('audio');
      const audioTrack = this.audioOverride ?? this.media.track('audio') ?? null;
      if (audioSender && audioSender.track !== audioTrack) await audioSender.replaceTrack(audioTrack);

      const videoSender = this.senders.get('video');
      const videoTrack = this.videoOverride ?? this.media.track('video') ?? null;
      if (videoSender && videoSender.track !== videoTrack) await videoSender.replaceTrack(videoTrack);
    });
  }

  // A pure P2P mesh means every camera upload fans out to every other peer directly — capping
  // each outgoing video encode keeps a 4-person call's total upload bandwidth sane. `null` clears
  // the cap (used for an active screen share, which needs to stay legible). No-ops quietly if the
  // video sender isn't set up yet or the browser rejects the parameters (never worth surfacing to
  // the user — the call still works, just without the tuned bitrate).
  async setVideoSendBitrate(maxBitrateKbps: number | null) {
    const sender = this.senders.get('video');
    if (!sender) return;
    try {
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) parameters.encodings = [{}];
      parameters.encodings[0].maxBitrate = maxBitrateKbps != null ? maxBitrateKbps * 1000 : undefined;
      await sender.setParameters(parameters);
    } catch (error) {
      statsLog.warn('Could not apply video send bitrate parameters', error);
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.negotiationTimer);
    clearInterval(this.statsTimer);
    this.pendingIce = [];
    this.pc.ontrack = null;
    this.pc.onicecandidate = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.onsignalingstatechange = null;
    this.pc.close();
    this.remote.getTracks().forEach((track) => track.stop());
  }
}
