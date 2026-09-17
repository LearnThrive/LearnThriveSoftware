import { io, type Socket } from 'socket.io-client';
import {
  MAX_CHAT_LENGTH, MAX_NAME_LENGTH, ROOM_PATTERN,
  type ChatMessage, type ClientToServerEvents, type Participant, type ReactionEmoji, type ServerToClientEvents,
} from '../shared/protocol';
import { classifyConnectionStatus } from './callStatus';
import { createLogger } from './log';
import { browserSupportError, listDevices, LocalMedia, mediaErrorMessage, type DeviceOption } from './media';
import { PeerSession, type DirectionDiagnostics } from './peer';
import { canShareScreen, screenShareErrorMessage, ScreenShare } from './screenShare';
import { classifyQuality, type CallStats, type ConnectionQuality } from './stats';

const mediaLog = createLogger('media');
const signallingLog = createLogger('signalling');
const peerLog = createLogger('peer');
const devicesLog = createLogger('devices');

const NOTICE_DURATION_MS = 3500;
const COPY_CONFIRMATION_MS = 2500;
const MAX_CHAT_HISTORY = 200;
const REACTION_DURATION_MS = 2200;

export interface DisplayReaction { id: number; emoji: string; mine: boolean }

export interface MeetingSnapshot {
  phase: 'prejoin' | 'joining' | 'meeting' | 'ended';
  status: string;
  error: string | null;
  mediaError: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  audio: boolean;
  video: boolean;
  screenSharing: boolean;
  screenSharePending: boolean;
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
  cameras: DeviceOption[];
  microphones: DeviceOption[];
  selectedCamera: string | undefined;
  selectedMicrophone: string | undefined;
  stats: CallStats | null;
  direction: DirectionDiagnostics | null;
  quality: ConnectionQuality;
  connectedAt: number | null;
  notice: { id: number; text: string } | null;
  chatOpen: boolean;
  messages: DisplayChatMessage[];
  unreadCount: number;
  handRaised: boolean;
  reactions: DisplayReaction[];
}

// "own" is resolved once, at the moment each message arrives, against the socket id live at
// that instant — re-deriving it later from a stored senderId would misattribute older messages
// if a non-recovered reconnect ever assigns this client a new socket id mid-meeting.
export interface DisplayChatMessage extends ChatMessage { own: boolean }

export class MeetingController {
  private snapshot: MeetingSnapshot = {
    phase: 'prejoin', status: 'Ready to join', error: null, mediaError: null,
    localStream: null, remoteStream: null, audio: false, video: false, screenSharing: false, screenSharePending: false, preparing: false,
    peer: null, roomId: '', name: '', signalling: 'disconnected', connection: 'new',
    ice: 'new', rtcSignalling: 'stable', copied: false,
    peerReconnecting: false, reconnectFailed: false,
    cameras: [], microphones: [], selectedCamera: undefined, selectedMicrophone: undefined,
    stats: null, direction: null, quality: 'unknown', connectedAt: null, notice: null,
    chatOpen: false, messages: [], unreadCount: 0, handRaised: false, reactions: [],
  };
  private listeners = new Set<() => void>();
  private readonly media = new LocalMedia(() => this.mediaChanged());
  private readonly screenShare = new ScreenShare(() => this.endScreenShare());
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private peer: PeerSession | null = null;
  private active = false;
  private actionVersion = 0;
  private copyTimeout: ReturnType<typeof setTimeout> | undefined;
  private noticeTimeout: ReturnType<typeof setTimeout> | undefined;
  private noticeSeq = 0;
  private reactionSeq = 0;
  // socket.io's Manager (`socket.io`) is a separate emitter that `socket.removeAllListeners()`
  // doesn't touch, and it can outlive a single Socket across reconnects — so this handler is
  // tracked explicitly and unregistered by hand in closeSocket().
  private reconnectFailedHandler: (() => void) | undefined;
  private readonly handleDeviceChange = () => { void this.refreshDevices(true); };

  constructor() {
    navigator.mediaDevices?.addEventListener?.('devicechange', this.handleDeviceChange);
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;

  private update(patch: Partial<MeetingSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private announce(text: string) {
    const id = ++this.noticeSeq;
    clearTimeout(this.noticeTimeout);
    this.update({ notice: { id, text } });
    this.noticeTimeout = setTimeout(() => {
      if (this.snapshot.notice?.id === id) this.update({ notice: null });
    }, NOTICE_DURATION_MS);
  }

  private mediaChanged() {
    const state = this.media.state();
    this.update({
      ...state, localStream: this.media.stream,
      selectedCamera: this.media.selectedDevice.video, selectedMicrophone: this.media.selectedDevice.audio,
    });
    this.peer?.syncTracks();
    if (this.active && this.socket?.connected) this.socket.emit('participant:media', state);
  }

  refreshDevices = async (checkSelection = false) => {
    const { cameras, microphones } = await listDevices();
    this.update({ cameras, microphones });
    if (!checkSelection) return;
    const missing: string[] = [];
    if (this.media.selectedDevice.video && !cameras.some((camera) => camera.deviceId === this.media.selectedDevice.video)) {
      delete this.media.selectedDevice.video;
      missing.push('camera');
    }
    if (this.media.selectedDevice.audio && !microphones.some((mic) => mic.deviceId === this.media.selectedDevice.audio)) {
      delete this.media.selectedDevice.audio;
      missing.push('microphone');
    }
    if (missing.length) this.update({ mediaError: `Your ${missing.join(' and ')} was disconnected. Using the default device instead.` });
  };

  switchCamera = async (deviceId: string) => {
    try { await this.media.switchDevice('video', deviceId); }
    catch (error) {
      devicesLog.warn('Camera switch failed', error);
      this.update({ mediaError: mediaErrorMessage(error, 'camera') });
    }
  };

  switchMicrophone = async (deviceId: string) => {
    try { await this.media.switchDevice('audio', deviceId); }
    catch (error) {
      devicesLog.warn('Microphone switch failed', error);
      this.update({ mediaError: mediaErrorMessage(error, 'microphone') });
    }
  };

  flipCamera = async () => {
    try { await this.media.flipCamera(); }
    catch (error) {
      devicesLog.warn('Camera flip failed', error);
      this.update({ mediaError: mediaErrorMessage(error, 'camera') });
    }
  };

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
        mediaLog.warn(`${kind} acquisition failed`, error);
        errors.push(mediaErrorMessage(error, kind === 'audio' ? 'microphone' : 'camera'));
      }
    }
    if (version === this.actionVersion) this.update({ preparing: false, status: 'Ready to join', mediaError: errors.join(' ') || null });
    void this.refreshDevices();
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
      mediaLog.warn(`${kind} acquisition failed`, error);
      if (version === this.actionVersion) this.update({ mediaError: mediaErrorMessage(error, kind === 'audio' ? 'microphone' : 'camera') });
    } finally {
      if (version === this.actionVersion) this.update({ preparing: false });
    }
  }

  toggleAudio = () => this.toggle('audio');
  toggleVideo = () => this.toggle('video');

  toggleScreenShare = async () => {
    if (this.snapshot.screenSharing) { this.endScreenShare(); return; }
    if (this.snapshot.screenSharePending) return;
    if (!canShareScreen()) { this.update({ error: 'Screen sharing is not supported in this browser.' }); return; }
    // The share picker can sit open indefinitely, so this guards against a double-click leaking
    // a second capture and against Leave firing while the picker is still up (checked below).
    const version = this.actionVersion;
    this.update({ screenSharePending: true });
    try {
      const track = await this.screenShare.start();
      if (version !== this.actionVersion || !this.active) {
        track.stop();
        this.screenShare.stop();
        return;
      }
      this.peer?.setVideoOverride(track);
      this.update({ screenSharing: true, error: null });
      this.emitScreenShare(true);
    } catch (error) {
      mediaLog.warn('Screen share failed', error);
      if (version === this.actionVersion) this.update({ error: screenShareErrorMessage(error) });
    } finally {
      if (version === this.actionVersion) this.update({ screenSharePending: false });
    }
  };

  private endScreenShare() {
    this.screenShare.stop();
    this.peer?.setVideoOverride(null);
    this.update({ screenSharing: false });
    this.emitScreenShare(false);
  }

  private emitScreenShare(sharing: boolean) {
    if (this.active && this.socket?.connected) this.socket.emit('participant:screen-share', { sharing });
  }

  toggleChat = () => {
    const open = !this.snapshot.chatOpen;
    this.update({ chatOpen: open, unreadCount: open ? 0 : this.snapshot.unreadCount });
  };

  sendChatMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_CHAT_LENGTH || !this.active || !this.socket?.connected) return;
    this.socket.emit('chat:message', { text: trimmed });
  };

  toggleHand = () => {
    if (!this.active || !this.socket?.connected) return;
    const raised = !this.snapshot.handRaised;
    this.update({ handRaised: raised });
    this.socket.emit('participant:hand', { raised });
  };

  sendReaction = (emoji: ReactionEmoji) => {
    if (!this.active || !this.socket?.connected) return;
    this.socket.emit('participant:reaction', { emoji });
    this.showReaction(emoji, true);
  };

  private showReaction(emoji: string, mine: boolean) {
    const id = ++this.reactionSeq;
    this.update({ reactions: [...this.snapshot.reactions, { id, emoji, mine }] });
    setTimeout(() => {
      this.update({ reactions: this.snapshot.reactions.filter((reaction) => reaction.id !== id) });
    }, REACTION_DURATION_MS);
  }

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
    this.update({
      phase: 'joining', status: 'Connecting…', error: null, roomId, name,
      messages: [], unreadCount: 0, chatOpen: false, handRaised: false, reactions: [],
    });
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
      signallingLog.warn('Connection failed', error.message);
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
      this.announce(`${peer.name} joined`);
      this.update({ peer, status: 'Connecting…', error: null, peerReconnecting: false });
      this.startPeer(sessionId, initiator);
    });
    socket.on('room:participant-reconnecting', () => this.update({ peerReconnecting: true }));
    socket.on('room:participant-reconnected', (peer) => {
      this.announce(`${peer.name} reconnected`);
      this.update({ peerReconnecting: false, peer });
    });
    socket.on('room:participant-left', ({ name: departedName }) => {
      this.closePeer();
      this.update({
        peer: null, status: departedName ? `${departedName} left the meeting` : 'Participant left',
        error: null, peerReconnecting: false,
      });
    });
    socket.on('participant:media', ({ id, media }) => {
      if (this.snapshot.peer?.id !== id) return;
      const previous = this.snapshot.peer.media;
      if (previous.audio && !media.audio) this.announce(`${this.snapshot.peer.name} muted their microphone`);
      if (previous.video && !media.video) this.announce(`${this.snapshot.peer.name} turned off their camera`);
      this.update({ peer: { ...this.snapshot.peer, media } });
    });
    socket.on('participant:screen-share', ({ id, sharing }) => {
      if (this.snapshot.peer?.id !== id) return;
      this.announce(sharing ? `${this.snapshot.peer.name} started sharing their screen` : `${this.snapshot.peer.name} stopped sharing their screen`);
      this.update({ peer: { ...this.snapshot.peer, screenSharing: sharing } });
    });
    socket.on('chat:message', (message) => {
      const own = message.senderId === this.socket?.id;
      const unread = this.snapshot.chatOpen || own ? this.snapshot.unreadCount : this.snapshot.unreadCount + 1;
      this.update({ messages: [...this.snapshot.messages, { ...message, own }].slice(-MAX_CHAT_HISTORY), unreadCount: unread });
    });
    socket.on('participant:hand', ({ id, raised }) => {
      if (this.snapshot.peer?.id !== id) return;
      if (raised) this.announce(`${this.snapshot.peer.name} raised their hand`);
      this.update({ peer: { ...this.snapshot.peer, handRaised: raised } });
    });
    socket.on('participant:reaction', ({ id, emoji }) => {
      if (this.snapshot.peer?.id !== id) return;
      this.showReaction(emoji, false);
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
          const patch: Partial<MeetingSnapshot> = {
            connection, ice, rtcSignalling, status,
            error: status === 'Connection failed' ? 'The media connection failed. Try reconnecting. Restrictive networks may need a TURN relay.' : null,
          };
          if (connection === 'connected' && this.snapshot.connectedAt == null) patch.connectedAt = Date.now();
          this.update(patch);
        },
        error: (error) => {
          peerLog.warn('Negotiation failed', error);
          this.update({ status: 'Connection failed', error: 'We could not establish the media connection. Try reconnecting; restrictive networks may require TURN.' });
        },
        stats: (stats) => this.update({ stats, quality: classifyQuality(stats) }),
        direction: (direction) => this.update({ direction }),
      });
      // A reconnect/replacement creates a fresh PeerSession, which otherwise wouldn't know we
      // were already sharing our screen before the interruption.
      if (this.snapshot.screenSharing) this.peer.setVideoOverride(this.screenShare.stream?.getVideoTracks()[0] ?? null);
    } catch (error) {
      peerLog.warn('Creation failed', error);
      this.update({ status: 'Connection failed', error: 'Your browser could not start the call. Try a recent browser and check your network.' });
    }
  }

  private closePeer() {
    this.peer?.close();
    this.peer = null;
    this.update({ remoteStream: null, connection: 'new', ice: 'new', rtcSignalling: 'stable', stats: null, direction: null, quality: 'unknown', connectedAt: null });
  }

  private closeSocket() {
    if (this.reconnectFailedHandler) this.socket?.io.off('reconnect_failed', this.reconnectFailedHandler);
    this.reconnectFailedHandler = undefined;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      if (socket.connected) {
        // emit() immediately followed by disconnect() can lose the leave message on the wire;
        // wait for the server's ack (with a bounded fallback) so the room is actually cleared
        // before we tear the transport down.
        let finished = false;
        const finish = () => { if (!finished) { finished = true; socket.disconnect(); } };
        socket.emit('room:leave', finish);
        setTimeout(finish, 800);
      } else {
        socket.disconnect();
      }
      socket.removeAllListeners();
    }
    this.closePeer();
  }

  private rejectJoin(message: string) {
    this.active = false;
    this.closeSocket();
    this.screenShare.stop();
    this.update({
      phase: 'prejoin', status: 'Ready to join', signalling: 'disconnected', error: message, peer: null,
      peerReconnecting: false, reconnectFailed: false, screenSharing: false, handRaised: false, reactions: [],
    });
  }

  retryConnection = () => {
    const { name, roomId } = this.snapshot;
    if (!this.active) return;
    this.active = false;
    this.closeSocket();
    this.join(name, roomId);
  };

  /** Rejoins the same room under the same name from the ended screen, skipping pre-join. */
  rejoin = () => {
    const { name, roomId } = this.snapshot;
    if (this.active || !name || !ROOM_PATTERN.test(roomId)) return;
    this.join(name, roomId);
  };

  leave = () => {
    this.active = false;
    this.actionVersion += 1;
    this.closeSocket();
    this.media.stop();
    this.screenShare.stop();
    clearTimeout(this.noticeTimeout);
    this.update({
      phase: 'ended', status: 'Meeting ended', signalling: 'disconnected', peer: null, preparing: false, error: null, mediaError: null,
      peerReconnecting: false, reconnectFailed: false, screenSharing: false,
      chatOpen: false, messages: [], unreadCount: 0, notice: null, handRaised: false, reactions: [],
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
      this.copyTimeout = setTimeout(() => this.update({ copied: false }), COPY_CONFIRMATION_MS);
    } catch {
      this.update({ error: 'Your browser could not copy the link. Copy the meeting URL from your address bar instead.' });
    }
  };

  dispose = () => {
    this.active = false;
    this.actionVersion += 1;
    clearTimeout(this.copyTimeout);
    clearTimeout(this.noticeTimeout);
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.handleDeviceChange);
    this.closeSocket();
    this.media.stop();
    this.screenShare.stop();
  };
}
