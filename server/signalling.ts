import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import { isDevTunnelHost } from '../shared/allowedHosts';
import {
  MAX_CHAT_LENGTH, MAX_NAME_LENGTH, MAX_STUDENTS, REACTION_EMOJIS, ROOM_PATTERN, WAITING_ROOM_CAP,
} from '../shared/protocol';
import type {
  ChatMessage, ClientToServerEvents, JoinedRoom, MediaState, Participant, ParticipantRole,
  ServerToClientEvents, SignalCandidate, SignalDescription,
} from '../shared/protocol';

const CHAT_RATE_WINDOW_MS = 4000;
const CHAT_RATE_MAX_MESSAGES = 6;
const REACTION_RATE_WINDOW_MS = 4000;
const REACTION_RATE_MAX = 10;

function createRateLimiter(windowMs: number, max: number) {
  const hits = new Map<string, number[]>();
  return {
    allow(id: string): boolean {
      const now = Date.now();
      const recent = (hits.get(id) ?? []).filter((sentAt) => now - sentAt < windowMs);
      if (recent.length >= max) { hits.set(id, recent); return false; }
      recent.push(now);
      hits.set(id, recent);
      return true;
    },
    clear(id: string) { hits.delete(id); },
  };
}

// One RTCPeerConnection edge between two already-admitted participants. A room with up to 4
// admitted participants (1 tutor + 3 students) can have up to 6 of these (a full mesh).
interface Edge { sessionId: string; participantIds: [string, string]; initiatorId: string }
// A student who has joined but not yet been let in by the tutor. Keyed by socket id in
// Room.waiting; Map insertion order gives FIFO for free, so no separate ordering field is kept.
interface WaitingEntry { name: string; media: MediaState }
interface Room {
  participants: Map<string, Participant>;
  waiting: Map<string, WaitingEntry>;
  edges: Map<string, Edge>;
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

function parseRole(value: unknown): ParticipantRole | null {
  return value === 'tutor' || value === 'student' ? value : null;
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
  const acceptsOrigin = (origin: string | undefined) => {
    if (!origin) return true;
    if (allowedOrigins.has(origin)) return true;
    // Same ephemeral-subdomain allowance as vite.config.ts's allowedHosts, so a fresh Quick
    // Tunnel/Tailscale session works without editing .env; still requires HTTPS and an exact
    // known suffix, never a bare wildcard.
    try {
      const url = new URL(origin);
      return url.protocol === 'https:' && isDevTunnelHost(url.hostname);
    } catch {
      return false;
    }
  };
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
  const chatRateLimiter = createRateLimiter(CHAT_RATE_WINDOW_MS, CHAT_RATE_MAX_MESSAGES);
  const reactionRateLimiter = createRateLimiter(REACTION_RATE_WINDOW_MS, REACTION_RATE_MAX);

  function fail(socket: MeetingSocket, message: string) {
    socket.emit('room:error', { message });
  }

  function clearPending(socketId: string) {
    const pending = pendingDisconnects.get(socketId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    pendingDisconnects.delete(socketId);
    return true;
  }

  function tutorOf(room: Room): Participant | undefined {
    for (const participant of room.participants.values()) if (participant.role === 'tutor') return participant;
    return undefined;
  }

  function studentCount(room: Room): number {
    let count = 0;
    for (const participant of room.participants.values()) if (participant.role === 'student') count += 1;
    return count;
  }

  function otherIdOnEdge(edge: Edge, socketId: string): string {
    return edge.participantIds[0] === socketId ? edge.participantIds[1] : edge.participantIds[0];
  }

  function broadcastWaiting(room: Room) {
    const tutor = tutorOf(room);
    if (!tutor) return;
    io.to(tutor.id).emit('room:waiting-update', {
      waiting: [...room.waiting.entries()].map(([id, entry]) => ({ id, name: entry.name })),
    });
  }

  // Admits a participant already cleared to join (role/capacity checks are the caller's
  // responsibility). Creates one edge to every already-admitted participant, with the existing
  // participant on each edge always the initiator — the same rule the old code re-derived from
  // room-wide Map order, now stored once per edge at creation time instead. Re-deriving it from
  // room order breaks with 3+ participants: an edge between two students who joined after the
  // tutor would have neither end equal to "the first id in the room," so neither could ever
  // become the initiator and that edge would never negotiate.
  function admitParticipant(socket: MeetingSocket, roomId: string, room: Room, self: Participant) {
    const peers: JoinedRoom['peers'] = [];
    for (const [otherId, other] of room.participants) {
      const sessionId = randomUUID();
      room.edges.set(sessionId, { sessionId, participantIds: [otherId, self.id], initiatorId: otherId });
      io.to(otherId).emit('room:participant-joined', { peer: self, sessionId, initiator: true });
      peers.push({ peer: other, sessionId, initiator: false });
    }
    room.participants.set(self.id, self);
    socket.data.roomId = roomId;
    void socket.join(`meeting:${roomId}`);
    const waiting = self.role === 'tutor' ? [...room.waiting.entries()].map(([id, entry]) => ({ id, name: entry.name })) : [];
    socket.emit('room:joined', { roomId, self, peers, waiting });
  }

  // Re-describes a still-admitted participant's existing edges — used only when a client resends
  // room:join for a room it's already in (e.g. a page that didn't realize it had already joined).
  function resendJoinedState(socket: MeetingSocket, roomId: string, room: Room) {
    const self = room.participants.get(socket.id)!;
    const peers: JoinedRoom['peers'] = [];
    for (const edge of room.edges.values()) {
      if (!edge.participantIds.includes(socket.id)) continue;
      const other = room.participants.get(otherIdOnEdge(edge, socket.id));
      if (other) peers.push({ peer: other, sessionId: edge.sessionId, initiator: edge.initiatorId === socket.id });
    }
    const waiting = self.role === 'tutor' ? [...room.waiting.entries()].map(([id, entry]) => ({ id, name: entry.name })) : [];
    socket.emit('room:joined', { roomId, self, peers, waiting });
  }

  // Silently drops a stale (mid-grace-period) participant so a same-role newcomer can take their
  // slot instead of being told the room/seat is full. No departure notice is sent — the
  // newcomer's own admission (which immediately follows) is what the remaining participants see.
  function evictStale(room: Room, staleId: string) {
    room.participants.delete(staleId);
    clearPending(staleId);
    chatRateLimiter.clear(staleId);
    reactionRateLimiter.clear(staleId);
    for (const [sessionId, edge] of room.edges) {
      if (edge.participantIds.includes(staleId)) room.edges.delete(sessionId);
    }
  }

  function admitWaitingId(roomId: string, room: Room, waitingId: string): boolean {
    const entry = room.waiting.get(waitingId);
    if (!entry || studentCount(room) >= MAX_STUDENTS) return false;
    const waitingSocket = io.sockets.sockets.get(waitingId);
    if (!waitingSocket) { room.waiting.delete(waitingId); return false; } // gone for good; clean up, don't count as admitted
    room.waiting.delete(waitingId);
    const newParticipant: Participant = {
      id: waitingId, name: entry.name, media: entry.media, screenSharing: false, handRaised: false, role: 'student',
    };
    admitParticipant(waitingSocket, roomId, room, newParticipant);
    return true;
  }

  function leaveNow(socket: MeetingSocket) {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    delete socket.data.roomId;
    void socket.leave(`meeting:${roomId}`);
    clearPending(socket.id);
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.waiting.delete(socket.id)) {
      if (room.participants.size === 0 && room.waiting.size === 0) rooms.delete(roomId);
      else broadcastWaiting(room);
      return;
    }

    chatRateLimiter.clear(socket.id);
    reactionRateLimiter.clear(socket.id);
    const departing = room.participants.get(socket.id) ?? null;
    if (!room.participants.delete(socket.id)) return;
    const remainingIds = new Set<string>();
    for (const [sessionId, edge] of room.edges) {
      if (!edge.participantIds.includes(socket.id)) continue;
      room.edges.delete(sessionId);
      remainingIds.add(otherIdOnEdge(edge, socket.id));
    }
    for (const id of remainingIds) io.to(id).emit('room:participant-left', { id: socket.id, name: departing?.name ?? null });
    if (room.participants.size === 0 && room.waiting.size === 0) rooms.delete(roomId);
  }

  function edgeFor(socket: MeetingSocket, sessionId: unknown): { edge: Edge; otherId: string } | null {
    const roomId = socket.data.roomId;
    const room = roomId ? rooms.get(roomId) : undefined;
    const edge = room && typeof sessionId === 'string' ? room.edges.get(sessionId) : undefined;
    if (!room || !room.participants.has(socket.id) || !edge || !edge.participantIds.includes(socket.id)) {
      fail(socket, 'This connection is no longer active.');
      return null;
    }
    return { edge, otherId: otherIdOnEdge(edge, socket.id) };
  }

  function relayDescription(socket: MeetingSocket, kind: 'offer' | 'answer', payload: unknown) {
    if (!isRecord(payload)) return fail(socket, 'Invalid connection message.');
    const ctx = edgeFor(socket, payload.sessionId);
    if (!ctx) return;
    const initiator = ctx.edge.initiatorId === socket.id;
    const description = payload.description;
    if (initiator !== (kind === 'offer') || !isRecord(description) || description.type !== kind
      || typeof description.sdp !== 'string' || description.sdp.length === 0 || description.sdp.length > 65_536) {
      return fail(socket, 'Invalid connection message.');
    }
    const message: SignalDescription = { sessionId: ctx.edge.sessionId, description: { type: kind, sdp: description.sdp } };
    // The recipient comes only from the server-held edge, never a client-supplied target.
    io.to(ctx.otherId).emit(kind === 'offer' ? 'webrtc:offer' : 'webrtc:answer', message);
  }

  io.on('connection', (socket) => {
    if (socket.recovered && socket.data.roomId) {
      const room = rooms.get(socket.data.roomId);
      if (room?.waiting.has(socket.id)) {
        clearPending(socket.id);
      } else if (room?.participants.has(socket.id) && clearPending(socket.id)) {
        const self = room.participants.get(socket.id)!;
        for (const edge of room.edges.values()) {
          if (edge.participantIds.includes(socket.id)) io.to(otherIdOnEdge(edge, socket.id)).emit('room:participant-reconnected', self);
        }
      }
    }

    socket.on('room:join', (payload: unknown) => {
      if (!isRecord(payload) || typeof payload.roomId !== 'string' || !ROOM_PATTERN.test(payload.roomId)
        || typeof payload.name !== 'string' || payload.name.length > 256
        || !payload.name.trim() || payload.name.trim().length > MAX_NAME_LENGTH
        // eslint-disable-next-line no-control-regex
        || /[ -]/u.test(payload.name)) {
        return fail(socket, 'Enter a valid room code and a display name of 1–40 characters.');
      }
      const media = parseMedia(payload.media);
      if (!media) return fail(socket, 'Invalid microphone or camera status.');
      const role = parseRole(payload.role);
      if (!role) return fail(socket, 'Invalid role.');
      const roomId = payload.roomId;
      const name = payload.name.trim();

      if (socket.data.roomId) {
        if (socket.data.roomId !== roomId) return fail(socket, 'Leave your current meeting before joining another.');
        const existing = rooms.get(roomId);
        if (existing?.participants.has(socket.id)) resendJoinedState(socket, roomId, existing);
        else if (existing?.waiting.has(socket.id)) socket.emit('room:waiting', { roomId });
        return;
      }

      const room = rooms.get(roomId) ?? { participants: new Map<string, Participant>(), waiting: new Map(), edges: new Map() };

      if (role === 'tutor') {
        const existingTutor = tutorOf(room);
        if (existingTutor) {
          if (!pendingDisconnects.has(existingTutor.id)) {
            socket.emit('room:full', { message: 'This class already has a tutor.' });
            return;
          }
          evictStale(room, existingTutor.id);
        }
        const self: Participant = { id: socket.id, name, media, screenSharing: false, handRaised: false, role };
        rooms.set(roomId, room);
        admitParticipant(socket, roomId, room, self);
        return;
      }

      // Students always wait for the tutor to admit them, even if a seat is already free —
      // capacity is enforced at admission time (room:admit/room:admit-all), not here.
      if (room.waiting.size >= WAITING_ROOM_CAP) {
        socket.emit('room:full', { message: 'The waiting room is full right now. Please try again shortly.' });
        return;
      }
      room.waiting.set(socket.id, { name, media });
      rooms.set(roomId, room);
      socket.data.roomId = roomId;
      void socket.join(`meeting:${roomId}`);
      socket.emit('room:waiting', { roomId });
      broadcastWaiting(room);
    });

    socket.on('room:admit', (payload: unknown) => {
      const roomId = socket.data.roomId;
      const room = roomId ? rooms.get(roomId) : undefined;
      const self = room?.participants.get(socket.id);
      if (!room || !roomId || !self || self.role !== 'tutor') return fail(socket, 'Only the tutor can admit students.');
      if (!isRecord(payload) || typeof payload.id !== 'string') return fail(socket, 'Invalid admit request.');
      const admitted = admitWaitingId(roomId, room, payload.id) ? 1 : 0;
      if (admitted === 0) fail(socket, 'That student is no longer waiting, or the class is full.');
      socket.emit('room:admit-result', { admitted, remaining: room.waiting.size });
      broadcastWaiting(room);
    });

    socket.on('room:admit-all', () => {
      const roomId = socket.data.roomId;
      const room = roomId ? rooms.get(roomId) : undefined;
      const self = room?.participants.get(socket.id);
      if (!room || !roomId || !self || self.role !== 'tutor') return fail(socket, 'Only the tutor can admit students.');
      const waitingIds = [...room.waiting.keys()]; // snapshot before the loop mutates room.waiting
      let admitted = 0;
      for (const id of waitingIds) {
        if (studentCount(room) >= MAX_STUDENTS) break;
        if (admitWaitingId(roomId, room, id)) admitted += 1;
      }
      socket.emit('room:admit-result', { admitted, remaining: room.waiting.size });
      broadcastWaiting(room);
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
      if (!chatRateLimiter.allow(socket.id)) return fail(socket, 'You are sending messages too quickly. Please slow down.');
      // Plain text only: no markdown/HTML is ever interpreted server-side or client-side.
      const message: ChatMessage = { id: randomUUID(), senderId: socket.id, name: self.name, text, timestamp: Date.now() };
      for (const id of room.participants.keys()) io.to(id).emit('chat:message', message);
    });
    socket.on('participant:hand', (payload: unknown) => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      const self = room?.participants.get(socket.id);
      if (!room || !self || !isRecord(payload) || typeof payload.raised !== 'boolean') {
        return fail(socket, 'Invalid hand-raise update.');
      }
      self.handRaised = payload.raised;
      for (const id of room.participants.keys()) {
        if (id !== socket.id) io.to(id).emit('participant:hand', { id: socket.id, raised: payload.raised });
      }
    });
    socket.on('participant:reaction', (payload: unknown) => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      const self = room?.participants.get(socket.id);
      if (!room || !self) return fail(socket, 'You are not currently in a meeting.');
      if (!isRecord(payload) || typeof payload.emoji !== 'string' || !(REACTION_EMOJIS as readonly string[]).includes(payload.emoji)) {
        return fail(socket, 'Invalid reaction.');
      }
      if (!reactionRateLimiter.allow(socket.id)) return fail(socket, 'You are sending reactions too quickly. Please slow down.');
      for (const id of room.participants.keys()) {
        if (id !== socket.id) io.to(id).emit('participant:reaction', { id: socket.id, emoji: payload.emoji });
      }
    });
    socket.on('webrtc:offer', (payload) => relayDescription(socket, 'offer', payload));
    socket.on('webrtc:answer', (payload) => relayDescription(socket, 'answer', payload));
    socket.on('webrtc:ice-candidate', (payload: unknown) => {
      if (!isRecord(payload)) return fail(socket, 'Invalid connection candidate.');
      const ctx = edgeFor(socket, payload.sessionId);
      if (!ctx) return;
      const candidate = parseCandidate(payload.candidate);
      if (!candidate) return fail(socket, 'Invalid connection candidate.');
      const message: SignalCandidate = { sessionId: ctx.edge.sessionId, candidate };
      io.to(ctx.otherId).emit('webrtc:ice-candidate', message);
    });
    socket.on('room:leave', (ack?: unknown) => {
      leaveNow(socket);
      if (typeof ack === 'function') ack();
    });
    socket.on('disconnect', () => {
      const roomId = socket.data.roomId;
      const room = roomId ? rooms.get(roomId) : undefined;
      if (!room) return;
      if (room.waiting.has(socket.id)) {
        const timer = setTimeout(() => { pendingDisconnects.delete(socket.id); leaveNow(socket); }, disconnectGraceMs);
        pendingDisconnects.set(socket.id, { roomId: roomId!, timer });
        return;
      }
      if (!room.participants.has(socket.id)) return;
      for (const edge of room.edges.values()) {
        if (edge.participantIds.includes(socket.id)) io.to(otherIdOnEdge(edge, socket.id)).emit('room:participant-reconnecting', { id: socket.id });
      }
      const timer = setTimeout(() => { pendingDisconnects.delete(socket.id); leaveNow(socket); }, disconnectGraceMs);
      pendingDisconnects.set(socket.id, { roomId: roomId!, timer });
    });
  });

  return { httpServer, io, rooms };
}
