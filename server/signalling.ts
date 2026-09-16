import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import { MAX_NAME_LENGTH, ROOM_PATTERN } from '../shared/protocol';
import type {
  ClientToServerEvents, JoinedRoom, MediaState, Participant,
  ServerToClientEvents, SignalCandidate, SignalDescription,
} from '../shared/protocol';

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

export function createSignallingServer() {
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
  });
  const rooms = new Map<string, Room>();

  function fail(socket: MeetingSocket, message: string) {
    socket.emit('room:error', { message });
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

  function leave(socket: MeetingSocket) {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    delete socket.data.roomId;
    void socket.leave(`meeting:${roomId}`);
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
    socket.on('room:join', (payload: unknown) => {
      if (!isRecord(payload) || typeof payload.roomId !== 'string' || !ROOM_PATTERN.test(payload.roomId)
        || typeof payload.name !== 'string' || payload.name.length > 256
        || !payload.name.trim() || payload.name.trim().length > MAX_NAME_LENGTH
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
        socket.emit('room:full', { message: 'This meeting already has two participants.' });
        return;
      }
      const self: Participant = { id: socket.id, name: payload.name.trim(), media };
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
    socket.on('room:leave', () => leave(socket));
    socket.on('disconnect', () => leave(socket));
  });

  return { httpServer, io, rooms };
}
