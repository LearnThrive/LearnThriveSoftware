import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, SignalCandidate, SignalDescription } from '../shared/protocol';
import { getIceConfiguration } from './ice';
import type { LocalMedia } from './media';

type SignallingSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
interface PeerCallbacks {
  stream: (stream: MediaStream) => void;
  state: (connection: RTCPeerConnectionState, ice: RTCIceConnectionState, signalling: RTCSignalingState) => void;
  error: (error: unknown) => void;
}

export class PeerSession {
  private readonly pc = new RTCPeerConnection(getIceConfiguration());
  private readonly remote = new MediaStream();
  private readonly senders = new Map<'audio' | 'video', RTCRtpSender>();
  private pendingIce: RTCIceCandidateInit[] = [];
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    readonly sessionId: string,
    private readonly initiator: boolean,
    private readonly socket: SignallingSocket,
    private readonly media: LocalMedia,
    private readonly callbacks: PeerCallbacks,
  ) {
    for (const kind of ['audio', 'video'] as const) {
      const track = media.track(kind);
      const transceiver = this.pc.addTransceiver(track ?? kind, {
        direction: 'sendrecv',
        streams: media.stream ? [media.stream] : [],
      });
      this.senders.set(kind, transceiver.sender);
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
    this.pc.onconnectionstatechange = reportState;
    this.pc.oniceconnectionstatechange = reportState;
    this.pc.onsignalingstatechange = reportState;
    if (initiator) this.enqueue(async () => {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      if (!this.closed && this.pc.localDescription) {
        socket.emit('webrtc:offer', { sessionId, description: this.pc.localDescription.toJSON() });
      }
    });
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
      for (const candidate of this.pendingIce) await this.pc.addIceCandidate(candidate);
      this.pendingIce = [];
      if (description.type === 'offer') {
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        if (!this.closed && this.pc.localDescription) {
          this.socket.emit('webrtc:answer', { sessionId: this.sessionId, description: this.pc.localDescription.toJSON() });
        }
      }
    });
  }

  candidate(payload: SignalCandidate) {
    if (payload.sessionId !== this.sessionId) return;
    this.enqueue(async () => {
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(payload.candidate);
      else if (this.pendingIce.length < 128) this.pendingIce.push(payload.candidate);
    });
  }

  syncTracks() {
    this.enqueue(async () => {
      for (const kind of ['audio', 'video'] as const) {
        const sender = this.senders.get(kind)!;
        const track = this.media.track(kind) ?? null;
        if (sender.track !== track) await sender.replaceTrack(track);
      }
    });
  }

  close() {
    this.closed = true;
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
