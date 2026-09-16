import { io, type Socket } from 'socket.io-client';
import { MAX_NAME_LENGTH, ROOM_PATTERN, type ClientToServerEvents, type Participant, type ServerToClientEvents } from '../shared/protocol';
import { classifyConnectionStatus } from './callStatus';
import { browserSupportError, LocalMedia, mediaErrorMessage } from './media';
import { PeerSession } from './peer';

export interface MeetingSnapshot {
  phase: 'prejoin' | 'joining' | 'meeting' | 'ended';
  status: string;
  error: string | null;
  mediaError: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  audio: boolean;
  video: boolean;
  preparing: boolean;
  peer: Participant | null;
  roomId: string;
  name: string;
  signalling: string;
  connection: string;
  ice: string;
  rtcSignalling: string;
  copied: boolean;
  peerReconnecting: boolean;
  reconnectFailed: boolean;
}

export class MeetingController {
  private snapshot: MeetingSnapshot = {
    phase: 'prejoin', status: 'Ready to join', error: null, mediaError: null,
    localStream: null, remoteStream: null, audio: false, video: false, preparing: false,
    peer: null, roomId: '', name: '', signalling: 'disconnected', connection: 'new',
    ice: 'new', rtcSignalling: 'stable', copied: false,
    peerReconnecting: false, reconnectFailed: false,
  };
  private listeners = new Set<() => void>();
  private readonly media = new LocalMedia(() => this.mediaChanged());
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private peer: PeerSession | null = null;
  private active = false;
  private actionVersion = 0;
  private copyTimeout: ReturnType<typeof setTimeout> | undefined;
  // socket.io's Manager (`socket.io`) is a separate emitter that `socket.removeAllListeners()`
  // doesn't touch, and it can outlive a single Socket across reconnects — so this handler is
  // tracked explicitly and unregistered by hand in closeSocket().
  private reconnectFailedHandler: (() => void) | undefined;

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;

  private update(patch: Partial<MeetingSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private mediaChanged() {
    const state = this.media.state();
    this.update({ ...state, localStream: this.media.stream });
    this.peer?.syncTracks();
    if (this.active && this.socket?.connected) this.socket.emit('participant:media', state);
  }

  prepareMedia = async () => {
    if (this.snapshot.preparing) return;
    const support = browserSupportError();
    if (support) { this.update({ mediaError: support }); return; }
    const version = this.actionVersion;
    this.update({ preparing: true, mediaError: null, status: 'Preparing camera…' });
    const errors: string[] = [];
    for (const kind of ['audio', 'video'] as const) {
      if (version !== this.actionVersion) return;
      try { await this.media.enable(kind); }
      catch (error) {
        console.warn(`[LearnThrive] ${kind} acquisition failed`, error);
        errors.push(mediaErrorMessage(error, kind === 'audio' ? 'microphone' : 'camera'));
      }
    }
    if (version === this.actionVersion) this.update({ preparing: false, status: 'Ready to join', mediaError: errors.join(' ') || null });
  };

  private async toggle(kind: 'audio' | 'video') {
    if (this.snapshot.preparing) return;
    if (this.media.track(kind)?.enabled) { this.media.disable(kind); return; }
    const support = browserSupportError();
    if (support) { this.update({ mediaError: support }); return; }
    const version = this.actionVersion;
    this.update({ preparing: true, mediaError: null });
    try { await this.media.enable(kind); }
    catch (error) {
      console.warn(`[LearnThrive] ${kind} acquisition failed`, error);
      if (version === this.actionVersion) this.update({ mediaError: mediaErrorMessage(error, kind === 'audio' ? 'microphone' : 'camera') });
    } finally {
      if (version === this.actionVersion) this.update({ preparing: false });
    }
  }

  toggleAudio = () => this.toggle('audio');
  toggleVideo = () => this.toggle('video');

  join = (name: string, roomId: string) => {
    if (this.active) return;
    name = name.trim();
    roomId = roomId.trim().toLowerCase();
    const support = browserSupportError();
    if (support) { this.update({ error: support }); return; }
    if (!name || name.length > MAX_NAME_LENGTH || !ROOM_PATTERN.test(roomId)) {
      this.update({ error: 'Enter your name (up to 40 characters) and a room code of 8–48 letters, numbers or hyphens.' });
      return;
    }
    this.active = true;
    this.update({ phase: 'joining', status: 'Connecting…', error: null, roomId, name });
    const url = new URL(window.location.href);
    url.pathname = '/meeting';
    url.searchParams.set('room', roomId);
    window.history.replaceState(null, '', url);
    // Intentionally no URL: HTTPS tunnels and localhost use the current origin.
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
      autoConnect: false, reconnection: true, reconnectionAttempts: 10, reconnectionDelayMax: 5000,
    });
    this.socket = socket;
    socket.on('connect', () => {
      if (!this.active) return;
      this.update({ signalling: 'connected', error: null, reconnectFailed: false });
      socket.emit('room:join', { roomId, name, media: this.media.state() });
    });
    socket.on('disconnect', () => {
      // The signalling channel dropping doesn't mean the WebRTC media connection has: leave
      // the peer connection alone and let its own state reporting reflect what's really true.
      if (!this.active) return;
      this.update({ signalling: 'disconnected' });
    });
    socket.on('connect_error', (error) => {
      console.warn('[LearnThrive] Signalling connection failed', error.message);
      if (this.active) this.update({ signalling: 'reconnecting' });
    });
    this.reconnectFailedHandler = () => {
      if (!this.active) return;
      if (this.snapshot.phase === 'joining') {
        this.rejectJoin('We could not reach the meeting server. Check your connection and try joining again.');
      } else {
        this.update({
          reconnectFailed: true, status: 'Unable to reconnect',
          error: 'We could not reconnect to the meeting server. Check your connection, then try again.',
        });
      }
    };
    socket.io.on('reconnect_failed', this.reconnectFailedHandler);
    socket.on('room:joined', (payload) => {
      this.update({ phase: 'meeting', status: payload.peer ? 'Connecting…' : 'Waiting for another participant…', error: null, peer: payload.peer });
      if (payload.peer && payload.sessionId) this.startPeer(payload.sessionId, payload.initiator);
      else this.closePeer();
    });
    socket.on('room:participant-joined', ({ peer, sessionId, initiator }) => {
      this.update({ peer, status: 'Connecting…', error: null, peerReconnecting: false });
      this.startPeer(sessionId, initiator);
    });
    socket.on('room:participant-reconnecting', () => this.update({ peerReconnecting: true }));
    socket.on('room:participant-reconnected', (peer) => this.update({ peerReconnecting: false, peer }));
    socket.on('room:participant-left', () => {
      this.closePeer();
      this.update({ peer: null, status: 'Participant left', error: null, peerReconnecting: false });
    });
    socket.on('participant:media', ({ id, media }) => {
      if (this.snapshot.peer?.id === id) this.update({ peer: { ...this.snapshot.peer, media } });
    });
    socket.on('room:full', ({ message }) => this.rejectJoin(message));
    socket.on('room:error', ({ message }) => {
      if (this.snapshot.phase === 'joining') this.rejectJoin(message);
      else this.update({ error: message });
    });
    socket.on('webrtc:offer', (payload) => this.peer?.description(payload));
    socket.on('webrtc:answer', (payload) => this.peer?.description(payload));
    socket.on('webrtc:ice-candidate', (payload) => this.peer?.candidate(payload));
    socket.connect();
  };

  private startPeer(sessionId: string, initiator: boolean) {
    if (this.peer?.sessionId === sessionId || !this.socket) return;
    this.closePeer();
    try {
      this.peer = new PeerSession(sessionId, initiator, this.socket, this.media, {
        stream: (remoteStream) => this.update({ remoteStream }),
        state: (connection, ice, rtcSignalling) => {
          const status = classifyConnectionStatus(connection, ice);
          this.update({ connection, ice, rtcSignalling, status,
            error: status === 'Connection failed' ? 'The media connection failed. Try reconnecting. Restrictive networks may need a TURN relay.' : null });
        },
        error: (error) => {
          console.warn('[LearnThrive] Peer negotiation failed', error);
          this.update({ status: 'Connection failed', error: 'We could not establish the media connection. Try reconnecting; restrictive networks may require TURN.' });
        },
      });
    } catch (error) {
      console.warn('[LearnThrive] Peer creation failed', error);
      this.update({ status: 'Connection failed', error: 'Your browser could not start the call. Try a recent browser and check your network.' });
    }
  }

  private closePeer() {
    this.peer?.close();
    this.peer = null;
    this.update({ remoteStream: null, connection: 'new', ice: 'new', rtcSignalling: 'stable' });
  }

  private closeSocket() {
    if (this.reconnectFailedHandler) this.socket?.io.off('reconnect_failed', this.reconnectFailedHandler);
    this.reconnectFailedHandler = undefined;
    this.socket?.emit('room:leave');
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.closePeer();
  }

  private rejectJoin(message: string) {
    this.active = false;
    this.closeSocket();
    this.update({
      phase: 'prejoin', status: 'Ready to join', signalling: 'disconnected', error: message, peer: null,
      peerReconnecting: false, reconnectFailed: false,
    });
  }

  retryConnection = () => {
    const { name, roomId } = this.snapshot;
    if (!this.active) return;
    this.active = false;
    this.closeSocket();
    this.join(name, roomId);
  };

  leave = () => {
    this.active = false;
    this.actionVersion += 1;
    this.closeSocket();
    this.media.stop();
    this.update({
      phase: 'ended', status: 'Meeting ended', signalling: 'disconnected', peer: null, preparing: false, error: null, mediaError: null,
      peerReconnecting: false, reconnectFailed: false,
    });
  };

  reset = () => this.update({ phase: 'prejoin', status: 'Ready to join', error: null });

  copyInvite = async (roomId = this.snapshot.roomId) => {
    if (!ROOM_PATTERN.test(roomId)) { this.update({ error: 'Create a meeting or enter a valid room code first.' }); return; }
    const url = new URL('/meeting', window.location.origin);
    url.searchParams.set('room', roomId);
    try {
      await navigator.clipboard.writeText(url.toString());
      this.update({ copied: true });
      clearTimeout(this.copyTimeout);
      this.copyTimeout = setTimeout(() => this.update({ copied: false }), 2500);
    } catch {
      this.update({ error: 'Your browser could not copy the link. Copy the meeting URL from your address bar instead.' });
    }
  };

  dispose = () => {
    this.active = false;
    this.actionVersion += 1;
    clearTimeout(this.copyTimeout);
    this.closeSocket();
    this.media.stop();
  };
}
