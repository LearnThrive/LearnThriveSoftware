import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import { MAX_CHAT_LENGTH, MAX_NAME_LENGTH, ROOM_PATTERN } from '../shared/protocol';
import type {
  ChatMessage, ClientToServerEvents, JoinedRoom, MediaState, Participant,
  ServerToClientEvents, SignalCandidate, SignalDescription,
} from '../shared/protocol';

const CHAT_RATE_WINDOW_MS = 4000;
const CHAT_RATE_MAX_MESSAGES = 6;

interface Room {
  participants: Map<string, Participant>;
  sessionId: string | null;
}
interface SocketData { roomId?: string }
type MeetingSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMedia(value: unknown): MediaState | null {
  if (!isRecord(value) || typeof value.audio !== 'boolean' || typeof value.video !== 'boolean') return null;
  return { audio: value.audio, video: value.video };
}

function parseCandidate(value: unknown): RTCIceCandidateInit | null {
  if (!isRecord(value) || typeof value.candidate !== 'string' || value.candidate.length > 8192) return null;
  if (value.sdpMid != null && (typeof value.sdpMid !== 'string' || value.sdpMid.length > 128)) return null;
  if (value.sdpMLineIndex != null && (
    typeof value.sdpMLineIndex !== 'number' || !Number.isInteger(value.sdpMLineIndex)
    || value.sdpMLineIndex < 0 || value.sdpMLineIndex > 65535
  )) return null;
  if (value.usernameFragment != null && (
    typeof value.usernameFragment !== 'string' || value.usernameFragment.length > 256
  )) return null;
  return {
    candidate: value.candidate,
    ...(value.sdpMid !== undefined ? { sdpMid: value.sdpMid as string | null } : {}),
    ...(value.sdpMLineIndex !== undefined ? { sdpMLineIndex: value.sdpMLineIndex as number | null } : {}),
    ...(value.usernameFragment !== undefined ? { usernameFragment: value.usernameFragment as string | null } : {}),
  };
}

export function createSignallingServer(options?: { disconnectGraceMs?: number }) {
  const disconnectGraceMs = options?.disconnectGraceMs ?? 10_000;
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_request, response) => response.json({ status: 'ok' }));
  const httpServer = createServer(app);
  const allowedOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
  const tunnelHost = process.env.TUNNEL_HOST?.trim();
  if (tunnelHost && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(tunnelHost)) {
    allowedOrigins.add(`https://${tunnelHost.toLowerCase()}`);
  }
  const acceptsOrigin = (origin: string | undefined) => !origin || allowedOrigins.has(origin);
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    // This process only handles small signalling messages; never media streams.
    maxHttpBufferSize: 100_000,
    cors: { origin: (origin, callback) => callback(null, acceptsOrigin(origin)) },
    allowRequest: (request, callback) => callback(null, acceptsOrigin(request.headers.origin)),
    pingInterval: 10_000,
    pingTimeout: 10_000,
    // Lets a briefly-dropped transport resume with the same socket.id/data instead of
    // looking like a new participant; leaveNow() still runs if it never comes back.
    connectionStateRecovery: {},
  });
  const rooms = new Map<string, Room>();
  const pendingDisconnects = new Map<string, { roomId: string; timer: ReturnType<typeof setTimeout> }>();
  const chatRateLimits = new Map<string, number[]>();

  function fail(socket: MeetingSocket, message: string) {
    socket.emit('room:error', { message });
  }

  function allowChatMessage(socketId: string): boolean {
    const now = Date.now();
    const recent = (chatRateLimits.get(socketId) ?? []).filter((sentAt) => now - sentAt < CHAT_RATE_WINDOW_MS);
    if (recent.length >= CHAT_RATE_MAX_MESSAGES) { chatRateLimits.set(socketId, recent); return false; }
    recent.push(now);
    chatRateLimits.set(socketId, recent);
    return true;
  }

  function clearPending(socketId: string) {
    const pending = pendingDisconnects.get(socketId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    pendingDisconnects.delete(socketId);
    return true;
  }

  function sendJoined(socket: MeetingSocket, roomId: string, room: Room) {
    const self = room.participants.get(socket.id)!;
    const peer = [...room.participants.values()].find((participant) => participant.id !== socket.id) ?? null;
    const payload: JoinedRoom = {
      roomId, self, peer, sessionId: room.sessionId,
      initiator: !!peer && room.participants.keys().next().value === socket.id,
    };
    socket.emit('room:joined', payload);
  }

  function leaveNow(socket: MeetingSocket) {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    delete socket.data.roomId;
    void socket.leave(`meeting:${roomId}`);
    clearPending(socket.id);
    chatRateLimits.delete(socket.id);
    const room = rooms.get(roomId);
    if (!room || !room.participants.delete(socket.id)) return;
    room.sessionId = null;
    if (room.participants.size === 0) {
      rooms.delete(roomId);
    } else {
      for (const id of room.participants.keys()) io.to(id).emit('room:participant-left');
    }
  }

  function pairedRoom(socket: MeetingSocket, sessionId: unknown) {
    const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
    if (!room || !room.participants.has(socket.id) || room.participants.size !== 2
      || typeof sessionId !== 'string' || !room.sessionId || sessionId !== room.sessionId) {
      fail(socket, 'This connection is no longer active.');
      return null;
    }
    return room;
  }

  function relayDescription(socket: MeetingSocket, kind: 'offer' | 'answer', payload: unknown) {
    if (!isRecord(payload)) return fail(socket, 'Invalid connection message.');
    const room = pairedRoom(socket, payload.sessionId);
    if (!room) return;
    const initiator = room.participants.keys().next().value === socket.id;
    const description = payload.description;
    if (initiator !== (kind === 'offer') || !isRecord(description) || description.type !== kind
      || typeof description.sdp !== 'string' || description.sdp.length === 0 || description.sdp.length > 65_536) {
      return fail(socket, 'Invalid connection message.');
    }
    const message: SignalDescription = {
      sessionId: room.sessionId!, description: { type: kind, sdp: description.sdp },
    };
    // Recipients come only from server membership, never a client-supplied target.
    for (const id of room.participants.keys()) {
      if (id !== socket.id) io.to(id).emit(kind === 'offer' ? 'webrtc:offer' : 'webrtc:answer', message);
    }
  }

  io.on('connection', (socket) => {
    if (socket.recovered && socket.data.roomId) {
      const room = rooms.get(socket.data.roomId);
      if (room?.participants.has(socket.id) && clearPending(socket.id)) {
        const self = room.participants.get(socket.id)!;
        const peer = [...room.participants.values()].find((participant) => participant.id !== socket.id);
        if (peer) io.to(peer.id).emit('room:participant-reconnected', self);
      }
    }

    socket.on('room:join', (payload: unknown) => {
      if (!isRecord(payload) || typeof payload.roomId !== 'string' || !ROOM_PATTERN.test(payload.roomId)
        || typeof payload.name !== 'string' || payload.name.length > 256
        || !payload.name.trim() || payload.name.trim().length > MAX_NAME_LENGTH
        // eslint-disable-next-line no-control-regex
        || /[\u0000-\u001f\u007f]/u.test(payload.name)) {
        return fail(socket, 'Enter a valid room code and a display name of 1–40 characters.');
      }
      const media = parseMedia(payload.media);
      if (!media) return fail(socket, 'Invalid microphone or camera status.');
      const roomId = payload.roomId;
      if (socket.data.roomId) {
        if (socket.data.roomId !== roomId) return fail(socket, 'Leave your current meeting before joining another.');
        const existing = rooms.get(roomId);
        if (existing) sendJoined(socket, roomId, existing);
        return;
      }
      const room = rooms.get(roomId) ?? { participants: new Map<string, Participant>(), sessionId: null };
      if (room.participants.size >= 2) {
        // A participant only sits here mid-grace-period after an unplanned disconnect;
        // a newcomer displaces that stale slot instead of being told the room is full.
        const stale = [...room.participants.keys()].find((id) => pendingDisconnects.has(id));
        if (stale) {
          clearPending(stale);
          room.participants.delete(stale);
          room.sessionId = null;
        } else {
          socket.emit('room:full', { message: 'This meeting already has two participants.' });
          return;
        }
      }
      const self: Participant = { id: socket.id, name: payload.name.trim(), media, screenSharing: false };
      room.participants.set(socket.id, self);
      rooms.set(roomId, room);
      socket.data.roomId = roomId;
      void socket.join(`meeting:${roomId}`);
      if (room.participants.size === 2) room.sessionId = randomUUID();
      // The responder learns its session before the initiator can create an offer.
      sendJoined(socket, roomId, room);
      if (room.sessionId) {
        for (const id of room.participants.keys()) {
          if (id !== socket.id) io.to(id).emit('room:participant-joined', {
            peer: self, sessionId: room.sessionId, initiator: true,
          });
        }
      }
    });

    socket.on('participant:media', (payload: unknown) => {
      const media = parseMedia(payload);
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      const self = room?.participants.get(socket.id);
      if (!media || !room || !self) return fail(socket, 'Invalid participant update.');
      self.media = media;
      for (const id of room.participants.keys()) {
        if (id !== socket.id) io.to(id).emit('participant:media', { id: socket.id, media });
      }
    });
    socket.on('participant:screen-share', (payload: unknown) => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      const self = room?.participants.get(socket.id);
      if (!room || !self || !isRecord(payload) || typeof payload.sharing !== 'boolean') {
        return fail(socket, 'Invalid screen-share update.');
      }
      self.screenSharing = payload.sharing;
      for (const id of room.participants.keys()) {
        if (id !== socket.id) io.to(id).emit('participant:screen-share', { id: socket.id, sharing: payload.sharing });
      }
    });
    socket.on('chat:message', (payload: unknown) => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      const self = room?.participants.get(socket.id);
      if (!room || !self) return fail(socket, 'You are not currently in a meeting.');
      if (!isRecord(payload) || typeof payload.text !== 'string' || payload.text.length > MAX_CHAT_LENGTH * 4) {
        return fail(socket, 'Invalid chat message.');
      }
      const text = payload.text.trim();
      if (!text || text.length > MAX_CHAT_LENGTH) return fail(socket, `Messages must be 1–${MAX_CHAT_LENGTH} characters.`);
      if (!allowChatMessage(socket.id)) return fail(socket, 'You are sending messages too quickly. Please slow down.');
      // Plain text only: no markdown/HTML is ever interpreted server-side or client-side.
      const message: ChatMessage = { id: randomUUID(), senderId: socket.id, name: self.name, text, timestamp: Date.now() };
      for (const id of room.participants.keys()) io.to(id).emit('chat:message', message);
    });
    socket.on('webrtc:offer', (payload) => relayDescription(socket, 'offer', payload));
    socket.on('webrtc:answer', (payload) => relayDescription(socket, 'answer', payload));
    socket.on('webrtc:ice-candidate', (payload: unknown) => {
      if (!isRecord(payload)) return fail(socket, 'Invalid connection candidate.');
      const room = pairedRoom(socket, payload.sessionId);
      if (!room) return;
      const candidate = parseCandidate(payload.candidate);
      if (!candidate) return fail(socket, 'Invalid connection candidate.');
      const message: SignalCandidate = { sessionId: room.sessionId!, candidate };
      for (const id of room.participants.keys()) {
        if (id !== socket.id) io.to(id).emit('webrtc:ice-candidate', message);
      }
    });
    socket.on('room:leave', () => leaveNow(socket));
    socket.on('disconnect', () => {
      const roomId = socket.data.roomId;
      const room = roomId ? rooms.get(roomId) : undefined;
      if (!room || !room.participants.has(socket.id)) return;
      const peer = [...room.participants.values()].find((participant) => participant.id !== socket.id);
      if (peer) io.to(peer.id).emit('room:participant-reconnecting');
      const timer = setTimeout(() => {
        pendingDisconnects.delete(socket.id);
        leaveNow(socket);
      }, disconnectGraceMs);
      pendingDisconnects.set(socket.id, { roomId: roomId!, timer });
    });
  });

  return { httpServer, io, rooms };
}
