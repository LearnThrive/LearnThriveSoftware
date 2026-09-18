import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import { isDevTunnelHost } from '@learnthrive/shared/allowedHosts';
import {
  ANNOUNCEMENT_TTL_MS, MAX_ANNOUNCEMENT_LENGTH, MAX_BOARD_ELEMENT_BYTES, MAX_BOARD_ELEMENTS_PER_PAGE,
  MAX_BOARD_IMPORT_BYTES, MAX_BOARD_PAGE_NAME_LENGTH, MAX_BOARD_PAGES, MAX_BOARD_UPDATE_BATCH, MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH, MAX_POLL_OPTION_LENGTH, MAX_POLL_OPTIONS, MAX_POLL_QUESTION_LENGTH, MAX_STUDENTS,
  MIN_POLL_OPTIONS, REACTION_EMOJIS, ROOM_PATTERN, WAITING_ROOM_CAP,
} from '@learnthrive/shared/protocol';
import type {
  Announcement, BoardBackground, BoardElement, BoardPage, BoardState, ChatMessage, ClientToServerEvents,
  JoinedRoom, MediaState, Participant, ParticipantRole, PollState, PollVisibility, RoomSettings, RoomTimerState,
  ServerToClientEvents, SignalCandidate, SignalDescription, TimerMode, UnderstandingCheckState, UnderstandingStatus,
} from '@learnthrive/shared/protocol';

const CHAT_RATE_WINDOW_MS = 4000;
const CHAT_RATE_MAX_MESSAGES = 6;
const REACTION_RATE_WINDOW_MS = 4000;
const REACTION_RATE_MAX = 10;
const POLL_VOTE_RATE_WINDOW_MS = 4000;
const POLL_VOTE_RATE_MAX = 10;
const UNDERSTANDING_RATE_WINDOW_MS = 4000;
const UNDERSTANDING_RATE_MAX = 10;
// Cursor and laser-pointer broadcasts are already throttled client-side; this is just a
// server-side backstop against a misbehaving client, generous enough to never bite a real one.
const BOARD_POINTER_RATE_WINDOW_MS = 1000;
const BOARD_POINTER_RATE_MAX = 30;
// The client already throttles element-batch sends to ~120ms (src/board.ts's trailingThrottle,
// ~8/s) — this is a server-side backstop against a client that bypasses its own throttle, set
// with real headroom above that legitimate rate rather than tuned tight against it.
const BOARD_UPDATE_RATE_WINDOW_MS = 1000;
const BOARD_UPDATE_RATE_MAX = 20;
const MAX_TIMER_DURATION_MS = 4 * 60 * 60 * 1000;
const BACKGROUNDS: readonly BoardBackground[] = ['blank', 'lined', 'grid', 'dotted', 'coordinate'];

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
interface RoomPoll {
  id: string; question: string; options: { id: string; text: string }[];
  anonymous: boolean; resultsVisible: PollVisibility; open: boolean;
  votes: Map<string, string>; // participantId -> optionId
}
interface RoomUnderstandingCheck { id: string; open: boolean; responses: Map<string, UnderstandingStatus> }
interface RoomTimer { mode: TimerMode; anchorAt: number; durationMs: number | null; paused: boolean; elapsedAtPauseMs: number | null }
// Elements are keyed by id for O(1) reconciliation lookups. The server is schema-blind to
// everything on a BoardElement except id/version/versionNonce/isDeleted — see shared/protocol.ts.
interface RoomBoardPage { id: string; name: string; background: BoardBackground; elements: Map<string, BoardElement> }
interface RoomBoard { pages: RoomBoardPage[]; activePageId: string; studentsCanDraw: boolean }
interface Room {
  participants: Map<string, Participant>;
  waiting: Map<string, WaitingEntry>;
  edges: Map<string, Edge>;
  settings: RoomSettings;
  activeScreenShareId: string | null;
  poll: RoomPoll | null;
  understandingCheck: RoomUnderstandingCheck | null;
  timer: RoomTimer | null;
  board: RoomBoard;
  announcement: Announcement | null;
  announcementTimer: ReturnType<typeof setTimeout> | null;
  // A removed student's *name* (keyed lowercase for case-insensitive matching, valued with the
  // original casing for display), not their socket id — a refresh gets a new socket id, so
  // id-based tracking wouldn't catch a rejoin attempt at all. Cleared automatically when the room
  // itself is torn down (no separate cleanup needed); the tutor can also lift a single ban early
  // via room:allow-rejoin. This is a deliberately name-based, not identity-based, guard — this
  // app has no accounts, so it's trivially bypassed by rejoining under a different name, same
  // honest limitation as every other role/identity check in this codebase.
  removedNames: Map<string, string>;
}
interface SocketData { roomId?: string }
type MeetingSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

function createRoom(): Room {
  const firstPageId = randomUUID();
  return {
    participants: new Map(), waiting: new Map(), edges: new Map(),
    settings: { locked: false, studentsCanShareScreen: true, studentsCanChat: true },
    activeScreenShareId: null, poll: null, understandingCheck: null, timer: null,
    board: {
      pages: [{ id: firstPageId, name: 'Board 1', background: 'blank', elements: new Map() }],
      activePageId: firstPageId, studentsCanDraw: true,
    },
    announcement: null, announcementTimer: null, removedNames: new Map(),
  };
}

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

function parseSettingsPatch(value: unknown): Partial<RoomSettings> | null {
  if (!isRecord(value)) return null;
  const patch: Partial<RoomSettings> = {};
  for (const key of ['locked', 'studentsCanShareScreen', 'studentsCanChat'] as const) {
    if (key in value) {
      if (typeof value[key] !== 'boolean') return null;
      patch[key] = value[key];
    }
  }
  return patch;
}

function jsonByteLength(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value)); } catch { return Infinity; }
}

function parseBoardElement(value: unknown): BoardElement | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || value.id.length > 256) return null;
  if (typeof value.version !== 'number' || !Number.isFinite(value.version)) return null;
  if (typeof value.versionNonce !== 'number' || !Number.isFinite(value.versionNonce)) return null;
  if (value.isDeleted !== undefined && typeof value.isDeleted !== 'boolean') return null;
  if (jsonByteLength(value) > MAX_BOARD_ELEMENT_BYTES) return null;
  return value as BoardElement;
}

function parseBoardUpdateBatch(value: unknown): { pageId: string; elements: BoardElement[] } | null {
  if (!isRecord(value) || typeof value.pageId !== 'string') return null;
  if (!Array.isArray(value.elements) || value.elements.length === 0 || value.elements.length > MAX_BOARD_UPDATE_BATCH) return null;
  const elements: BoardElement[] = [];
  for (const raw of value.elements) {
    const element = parseBoardElement(raw);
    if (!element) return null;
    elements.push(element);
  }
  return { pageId: value.pageId, elements };
}

function parseBoardImport(value: unknown): { pageId: string; elements: BoardElement[] } | null {
  if (jsonByteLength(value) > MAX_BOARD_IMPORT_BYTES) return null;
  if (!isRecord(value) || typeof value.pageId !== 'string' || !Array.isArray(value.elements)) return null;
  if (value.elements.length > MAX_BOARD_ELEMENTS_PER_PAGE) return null;
  const elements: BoardElement[] = [];
  for (const raw of value.elements) {
    const element = parseBoardElement(raw);
    if (!element) return null;
    elements.push(element);
  }
  return { pageId: value.pageId, elements };
}

function parseBackground(value: unknown): BoardBackground | null {
  return typeof value === 'string' && (BACKGROUNDS as readonly string[]).includes(value) ? (value as BoardBackground) : null;
}

// The same version/versionNonce merge rule Excalidraw's own collaboration reference
// implementation uses: a strictly higher version always wins; on a tied version, the higher
// versionNonce wins as a deterministic tiebreaker. Never accepts a stale/equal-or-older update.
function shouldAcceptElement(existing: BoardElement | undefined, incoming: BoardElement): boolean {
  if (!existing) return true;
  if (incoming.version > existing.version) return true;
  return incoming.version === existing.version && incoming.versionNonce > existing.versionNonce;
}

function parsePollCreate(value: unknown): { question: string; options: string[]; anonymous: boolean; resultsVisible: PollVisibility } | null {
  if (!isRecord(value) || typeof value.question !== 'string' || typeof value.anonymous !== 'boolean') return null;
  const question = value.question.trim();
  if (!question || question.length > MAX_POLL_QUESTION_LENGTH) return null;
  if (value.resultsVisible !== 'always' && value.resultsVisible !== 'onClose') return null;
  if (!Array.isArray(value.options)) return null;
  const options = value.options.map((option) => (typeof option === 'string' ? option.trim() : '')).filter(Boolean);
  if (options.length < MIN_POLL_OPTIONS || options.length > MAX_POLL_OPTIONS) return null;
  if (options.some((option) => option.length > MAX_POLL_OPTION_LENGTH)) return null;
  return { question, options, anonymous: value.anonymous, resultsVisible: value.resultsVisible };
}

// Cloudflare's temporary-ICE-credential endpoint — https://developers.cloudflare.com/realtime/turn/.
// A 4-hour TTL comfortably covers one lesson plus reconnects; the client refetches proactively
// before a credential set goes stale rather than waiting for it to fail (see src/ice.ts).
const TURN_CREDENTIAL_TTL_SECONDS = 4 * 60 * 60;
const TURN_RATE_WINDOW_MS = 60_000;
const TURN_RATE_MAX = 20;

async function fetchCloudflareTurnCredentials(keyId: string, apiToken: string): Promise<unknown> {
  const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TURN_CREDENTIAL_TTL_SECONDS }),
  });
  if (!response.ok) throw new Error(`Cloudflare TURN credential request failed with status ${response.status}`);
  return response.json();
}

export function createSignallingServer(options?: { disconnectGraceMs?: number }) {
  const disconnectGraceMs = options?.disconnectGraceMs ?? 10_000;
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_request, response) => response.json({ status: 'ok' }));
  const turnRateLimiter = createRateLimiter(TURN_RATE_WINDOW_MS, TURN_RATE_MAX);
  // Temporary Cloudflare Realtime TURN credentials, generated server-side so the long-lived
  // CLOUDFLARE_TURN_KEY_ID/CLOUDFLARE_TURN_API_TOKEN pair is never exposed to a browser — only
  // the short-lived iceServers this endpoint returns are. See README.md's TURN section and
  // TURN_TESTING.md. Falls back gracefully (a 503) when the two env vars aren't configured, which
  // the client treats as "use STUN-only" rather than a hard failure — see src/ice.ts.
  app.get('/api/turn-credentials', (request, response) => {
    const keyId = process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
    const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();
    if (!keyId || !apiToken) { response.status(503).json({ error: 'TURN is not configured on this server.' }); return; }
    if (!turnRateLimiter.allow(request.ip ?? 'unknown')) { response.status(429).json({ error: 'Too many TURN credential requests. Please slow down.' }); return; }
    fetchCloudflareTurnCredentials(keyId, apiToken)
      .then((data) => { response.json({ ...(isRecord(data) ? data : {}), ttlSeconds: TURN_CREDENTIAL_TTL_SECONDS }); })
      .catch((error: unknown) => {
        console.error('Cloudflare TURN credential request failed:', error);
        response.status(502).json({ error: 'Could not generate temporary TURN credentials.' });
      });
  });
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
    // This process never handles media streams, but a whiteboard JSON import can legitimately be
    // a few MB — raised from the prototype's original 100KB (fine for pure signalling messages)
    // to comfortably fit MAX_BOARD_IMPORT_BYTES plus JSON/Socket.IO framing overhead.
    maxHttpBufferSize: 6_000_000,
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
  const pollVoteRateLimiter = createRateLimiter(POLL_VOTE_RATE_WINDOW_MS, POLL_VOTE_RATE_MAX);
  const understandingRateLimiter = createRateLimiter(UNDERSTANDING_RATE_WINDOW_MS, UNDERSTANDING_RATE_MAX);
  const boardPointerRateLimiter = createRateLimiter(BOARD_POINTER_RATE_WINDOW_MS, BOARD_POINTER_RATE_MAX);
  const boardUpdateRateLimiter = createRateLimiter(BOARD_UPDATE_RATE_WINDOW_MS, BOARD_UPDATE_RATE_MAX);

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

  function requireTutor(socket: MeetingSocket, message: string): { room: Room; roomId: string; self: Participant } | null {
    const roomId = socket.data.roomId;
    const room = roomId ? rooms.get(roomId) : undefined;
    const self = room?.participants.get(socket.id);
    if (!room || !roomId || !self || self.role !== 'tutor') { fail(socket, message); return null; }
    return { room, roomId, self };
  }

  function broadcastWaiting(room: Room) {
    const tutor = tutorOf(room);
    if (!tutor) return;
    io.to(tutor.id).emit('room:waiting-update', {
      waiting: [...room.waiting.entries()].map(([id, entry]) => ({ id, name: entry.name })),
    });
  }

  function buildPollState(room: Room, recipientId: string, recipientRole: ParticipantRole): PollState | null {
    const poll = room.poll;
    if (!poll) return null;
    const results: Record<string, number> = {};
    for (const option of poll.options) results[option.id] = 0;
    for (const optionId of poll.votes.values()) results[optionId] = (results[optionId] ?? 0) + 1;
    const showResults = recipientRole === 'tutor' || poll.resultsVisible === 'always' || !poll.open;
    const state: PollState = {
      id: poll.id, question: poll.question, options: poll.options, anonymous: poll.anonymous, open: poll.open,
      resultsVisible: poll.resultsVisible, results: showResults ? results : null,
      myVote: poll.votes.get(recipientId) ?? null, totalVotes: poll.votes.size,
    };
    if (recipientRole === 'tutor' && !poll.anonymous) {
      state.voters = [...poll.votes.entries()].map(([participantId, optionId]) => ({
        id: participantId, name: room.participants.get(participantId)?.name ?? 'Unknown', optionId,
      }));
    }
    return state;
  }

  function buildUnderstandingState(room: Room, recipientId: string, recipientRole: ParticipantRole): UnderstandingCheckState | null {
    const check = room.understandingCheck;
    if (!check) return null;
    const state: UnderstandingCheckState = { id: check.id, open: check.open, myStatus: check.responses.get(recipientId) ?? null };
    if (recipientRole === 'tutor') {
      state.responses = [...room.participants.values()]
        .filter((participant) => participant.role === 'student')
        .map((participant) => ({ id: participant.id, name: participant.name, status: check.responses.get(participant.id) ?? null }));
      const summary: Record<UnderstandingStatus, number> = { understood: 0, confused: 0, lost: 0 };
      for (const status of check.responses.values()) summary[status] += 1;
      state.summary = summary;
    }
    return state;
  }

  function buildTimerState(room: Room): RoomTimerState | null {
    if (!room.timer) return null;
    const { mode, anchorAt, durationMs, paused, elapsedAtPauseMs } = room.timer;
    return { mode, anchorAt, durationMs, paused, elapsedAtPauseMs };
  }

  // The three pieces of room state whose visibility differs per recipient (tutor sees more of
  // polls/understanding-checks than students do) — computed fresh for whoever's about to receive
  // a room:joined payload, whether from a brand-new admission, a duplicate-join resend, or a
  // reconnect resync.
  function personalizedExtras(room: Room, recipientId: string, recipientRole: ParticipantRole) {
    return {
      settings: room.settings,
      poll: buildPollState(room, recipientId, recipientRole),
      understandingCheck: buildUnderstandingState(room, recipientId, recipientRole),
      timer: buildTimerState(room),
    };
  }

  function broadcastPoll(room: Room) {
    for (const [id, participant] of room.participants) io.to(id).emit('poll:update', buildPollState(room, id, participant.role));
  }

  function broadcastUnderstanding(room: Room) {
    for (const [id, participant] of room.participants) io.to(id).emit('understanding:update', buildUnderstandingState(room, id, participant.role));
  }

  function broadcastTimer(room: Room) {
    const state = buildTimerState(room);
    for (const id of room.participants.keys()) io.to(id).emit('timer:update', state);
  }

  // Not personalized (unlike poll/understanding) — every participant sees the same board, so this
  // is embedded as-is into room:joined and broadcast as-is on any page-level change. Every page's
  // elements are included so switching pages (including a student browsing away from the tutor's
  // active page while not following) is a pure local operation, never a server round-trip.
  function buildBoardState(room: Room): BoardState {
    const elementsByPage: Record<string, BoardElement[]> = {};
    for (const page of room.board.pages) elementsByPage[page.id] = [...page.elements.values()];
    return {
      pages: room.board.pages.map((page): BoardPage => ({ id: page.id, name: page.name, background: page.background })),
      activePageId: room.board.activePageId,
      elementsByPage,
      studentsCanDraw: room.board.studentsCanDraw,
    };
  }

  function broadcastBoardPages(room: Room) {
    const pages = room.board.pages.map((page): BoardPage => ({ id: page.id, name: page.name, background: page.background }));
    for (const id of room.participants.keys()) io.to(id).emit('board:pages-update', { pages, activePageId: room.board.activePageId });
  }

  function setForceMuted(room: Room, target: Participant, forceMuted: boolean) {
    if (target.forceMuted === forceMuted) return;
    target.forceMuted = forceMuted;
    for (const id of room.participants.keys()) io.to(id).emit('participant:force-muted', { id: target.id, forceMuted });
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
    socket.emit('room:joined', { roomId, self, peers, waiting, ...personalizedExtras(room, self.id, self.role), board: buildBoardState(room), announcement: room.announcement });
    if (self.role === 'tutor') socket.emit('room:removed-list-update', { names: [...room.removedNames.values()] });
  }

  // Re-describes a still-admitted participant's existing edges plus current room-level state —
  // used both when a client resends room:join for a room it's already in, and (via the same
  // shape) to resync a participant recovering a brief disconnect, who may have missed a
  // force-mute directive, a settings change, or a poll/understanding-check/timer update while
  // offline (none of that state is touched by the disconnect/recovery machinery itself, so it's
  // never lost — only its *delivery* needs this explicit resync).
  function resendJoinedState(socket: MeetingSocket, roomId: string, room: Room) {
    const self = room.participants.get(socket.id)!;
    const peers: JoinedRoom['peers'] = [];
    for (const edge of room.edges.values()) {
      if (!edge.participantIds.includes(socket.id)) continue;
      const other = room.participants.get(otherIdOnEdge(edge, socket.id));
      if (other) peers.push({ peer: other, sessionId: edge.sessionId, initiator: edge.initiatorId === socket.id });
    }
    const waiting = self.role === 'tutor' ? [...room.waiting.entries()].map(([id, entry]) => ({ id, name: entry.name })) : [];
    socket.emit('room:joined', { roomId, self, peers, waiting, ...personalizedExtras(room, self.id, self.role), board: buildBoardState(room), announcement: room.announcement });
    if (self.role === 'tutor') socket.emit('room:removed-list-update', { names: [...room.removedNames.values()] });
  }

  // Silently drops a stale (mid-grace-period) participant so a same-role newcomer can take their
  // slot instead of being told the room/seat is full. No departure notice is sent — the
  // newcomer's own admission (which immediately follows) is what the remaining participants see.
  function evictStale(room: Room, staleId: string) {
    room.participants.delete(staleId);
    clearPending(staleId);
    chatRateLimiter.clear(staleId);
    reactionRateLimiter.clear(staleId);
    pollVoteRateLimiter.clear(staleId);
    understandingRateLimiter.clear(staleId);
    boardPointerRateLimiter.clear(staleId);
    boardUpdateRateLimiter.clear(staleId);
    if (room.activeScreenShareId === staleId) room.activeScreenShareId = null;
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
      id: waitingId, name: entry.name, media: entry.media, screenSharing: false, handRaised: false, handRaisedAt: null, role: 'student', forceMuted: false,
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
    pollVoteRateLimiter.clear(socket.id);
    understandingRateLimiter.clear(socket.id);
    boardPointerRateLimiter.clear(socket.id);
    boardUpdateRateLimiter.clear(socket.id);
    if (room.activeScreenShareId === socket.id) room.activeScreenShareId = null;
    const departing = room.participants.get(socket.id) ?? null;
    if (!room.participants.delete(socket.id)) return;
    const remainingIds = new Set<string>();
    for (const [sessionId, edge] of room.edges) {
      if (!edge.participantIds.includes(socket.id)) continue;
      room.edges.delete(sessionId);
      remainingIds.add(otherIdOnEdge(edge, socket.id));
    }

    // The tutor departing ends the class for everyone still in it — every remaining admitted
    // participant AND every still-waiting student (who today would otherwise get no signal at
    // all and just sit unadmitted forever) — instead of the ordinary per-edge "left" notice.
    // This only ever runs via an explicit leave or the grace-timer expiring (never straight from
    // the `disconnect` handler), so a brief tutor Wi-Fi blip that recovers in time never reaches
    // here — the existing connectionStateRecovery/clearPending path resolves it first.
    if (departing?.role === 'tutor') {
      for (const id of [...room.participants.keys(), ...room.waiting.keys()]) io.to(id).emit('room:ended');
      rooms.delete(roomId);
      return;
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
        // Refresh the recovering client's own view of anything that may have changed while it
        // was offline (a force-mute directive, a settings/poll/understanding-check/timer update,
        // a screen-share stop directive) — resendJoinedState is safe to call on an
        // already-admitted, already-connected client: startPeer is idempotent against an
        // unchanged sessionId, so known peers just no-op.
        resendJoinedState(socket, socket.data.roomId, room);
      } else if (!room) {
        // The room was torn down (e.g. the tutor ended the class) while this socket was offline.
        delete socket.data.roomId;
        socket.emit('room:ended');
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

      const room = rooms.get(roomId) ?? createRoom();

      if (role === 'tutor') {
        const existingTutor = tutorOf(room);
        if (existingTutor) {
          if (!pendingDisconnects.has(existingTutor.id)) {
            socket.emit('room:full', { message: 'This class already has a tutor.' });
            return;
          }
          evictStale(room, existingTutor.id);
        }
        const self: Participant = { id: socket.id, name, media, screenSharing: false, handRaised: false, handRaisedAt: null, role, forceMuted: false };
        rooms.set(roomId, room);
        admitParticipant(socket, roomId, room, self);
        return;
      }

      if (room.settings.locked) {
        socket.emit('room:full', { message: 'This class is currently locked. Please try again shortly.' });
        return;
      }

      if (room.removedNames.has(name.toLowerCase())) {
        socket.emit('room:full', { message: 'You were removed from this class by the tutor.' });
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
      const ctx = requireTutor(socket, 'Only the tutor can admit students.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.id !== 'string') return fail(socket, 'Invalid admit request.');
      // A failed admit isn't a malformed request — it's an ordinary race (the student left, or
      // the class filled up in the meantime) — so it's reported once, via room:admit-result
      // (which the client turns into a toast), not also as a room:error banner.
      const admitted = admitWaitingId(ctx.roomId, ctx.room, payload.id) ? 1 : 0;
      socket.emit('room:admit-result', { admitted, remaining: ctx.room.waiting.size });
      broadcastWaiting(ctx.room);
    });

    socket.on('room:admit-all', () => {
      const ctx = requireTutor(socket, 'Only the tutor can admit students.');
      if (!ctx) return;
      const waitingIds = [...ctx.room.waiting.keys()]; // snapshot before the loop mutates room.waiting
      let admitted = 0;
      for (const id of waitingIds) {
        if (studentCount(ctx.room) >= MAX_STUDENTS) break;
        if (admitWaitingId(ctx.roomId, ctx.room, id)) admitted += 1;
      }
      socket.emit('room:admit-result', { admitted, remaining: ctx.room.waiting.size });
      broadcastWaiting(ctx.room);
    });

    socket.on('room:deny', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can manage the waiting room.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.id !== 'string') return fail(socket, 'Invalid request.');
      const deniedSocket = io.sockets.sockets.get(payload.id);
      if (!deniedSocket || !ctx.room.waiting.has(payload.id)) return fail(socket, 'That student is no longer waiting.');
      deniedSocket.emit('room:denied');
      leaveNow(deniedSocket);
    });

    socket.on('room:settings', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can change class settings.');
      if (!ctx) return;
      const patch = parseSettingsPatch(payload);
      if (!patch) return fail(socket, 'Invalid settings update.');
      ctx.room.settings = { ...ctx.room.settings, ...patch };
      for (const id of ctx.room.participants.keys()) io.to(id).emit('room:settings-update', ctx.room.settings);
    });

    socket.on('room:mute-participant', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can mute students.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.id !== 'string') return fail(socket, 'Invalid request.');
      const target = ctx.room.participants.get(payload.id);
      if (!target || target.role !== 'student') return fail(socket, 'That student is not currently in the class.');
      setForceMuted(ctx.room, target, true);
    });

    socket.on('room:mute-all', () => {
      const ctx = requireTutor(socket, 'Only the tutor can mute students.');
      if (!ctx) return;
      for (const participant of ctx.room.participants.values()) {
        if (participant.role === 'student') setForceMuted(ctx.room, participant, true);
      }
    });

    socket.on('room:allow-unmute', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can allow a student to unmute.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.id !== 'string') return fail(socket, 'Invalid request.');
      const target = ctx.room.participants.get(payload.id);
      if (!target || target.role !== 'student') return fail(socket, 'That student is not currently in the class.');
      setForceMuted(ctx.room, target, false);
    });

    socket.on('room:remove-participant', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can remove a participant.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.id !== 'string') return fail(socket, 'Invalid request.');
      const target = ctx.room.participants.get(payload.id);
      if (!target || target.role !== 'student') return fail(socket, 'That student is not currently in the class.');
      const targetSocket = io.sockets.sockets.get(payload.id);
      if (!targetSocket) return fail(socket, 'That participant already disconnected.');
      ctx.room.removedNames.set(target.name.toLowerCase(), target.name);
      socket.emit('room:removed-list-update', { names: [...ctx.room.removedNames.values()] });
      targetSocket.emit('room:removed');
      leaveNow(targetSocket);
      // Safety net in case the removed client doesn't disconnect itself promptly, mirroring the
      // bounded-fallback pattern MeetingController's own closeSocket() already uses for leave.
      setTimeout(() => { if (targetSocket.connected) targetSocket.disconnect(true); }, 2000);
    });

    socket.on('room:allow-rejoin', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can allow a removed student to rejoin.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.name !== 'string') return fail(socket, 'Invalid request.');
      ctx.room.removedNames.delete(payload.name.toLowerCase());
      socket.emit('room:removed-list-update', { names: [...ctx.room.removedNames.values()] });
    });

    socket.on('room:stop-share', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can stop a screen share.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.id !== 'string') return fail(socket, 'Invalid request.');
      if (ctx.room.activeScreenShareId !== payload.id) return fail(socket, 'That participant is not currently sharing.');
      ctx.room.activeScreenShareId = null;
      const target = ctx.room.participants.get(payload.id);
      if (target) target.screenSharing = false;
      for (const id of ctx.room.participants.keys()) io.to(id).emit('participant:screen-share', { id: payload.id, sharing: false });
      io.to(payload.id).emit('room:stop-share');
    });

    socket.on('room:lower-hand', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can lower a hand.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.id !== 'string') return fail(socket, 'Invalid request.');
      const target = ctx.room.participants.get(payload.id);
      if (!target) return fail(socket, 'That participant is not currently in the class.');
      target.handRaised = false;
      target.handRaisedAt = null;
      // Includes the target (unlike the self-report participant:hand broadcast below) — they
      // haven't applied this optimistically themselves, so their own client needs telling too.
      for (const id of ctx.room.participants.keys()) io.to(id).emit('participant:hand', { id: payload.id, raised: false });
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
      if (payload.sharing) {
        if (room.activeScreenShareId && room.activeScreenShareId !== socket.id) {
          return fail(socket, 'Someone else is already sharing their screen.');
        }
        if (self.role === 'student' && !room.settings.studentsCanShareScreen) {
          return fail(socket, 'The tutor has turned off screen sharing for students.');
        }
        room.activeScreenShareId = socket.id;
      } else if (room.activeScreenShareId === socket.id) {
        room.activeScreenShareId = null;
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
      if (self.role === 'student' && !room.settings.studentsCanChat) return fail(socket, 'The tutor has turned off chat for students.');
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
    socket.on('chat:delete', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can delete a message.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.id !== 'string') return fail(socket, 'Invalid request.');
      // Pure relay, matching how chat itself is never stored server-side — each client filters
      // its own locally-held message list by id.
      for (const id of ctx.room.participants.keys()) io.to(id).emit('chat:message-deleted', { id: payload.id });
    });
    socket.on('chat:clear', () => {
      const ctx = requireTutor(socket, 'Only the tutor can clear the chat.');
      if (!ctx) return;
      for (const id of ctx.room.participants.keys()) io.to(id).emit('chat:cleared');
    });
    socket.on('participant:hand', (payload: unknown) => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      const self = room?.participants.get(socket.id);
      if (!room || !self || !isRecord(payload) || typeof payload.raised !== 'boolean') {
        return fail(socket, 'Invalid hand-raise update.');
      }
      self.handRaised = payload.raised;
      self.handRaisedAt = payload.raised ? Date.now() : null;
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

    socket.on('poll:create', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can start a poll.');
      if (!ctx) return;
      const parsed = parsePollCreate(payload);
      if (!parsed) return fail(socket, 'Invalid poll.');
      ctx.room.poll = {
        id: randomUUID(), question: parsed.question, options: parsed.options.map((text) => ({ id: randomUUID(), text })),
        anonymous: parsed.anonymous, resultsVisible: parsed.resultsVisible, open: true, votes: new Map(),
      };
      broadcastPoll(ctx.room);
    });
    socket.on('poll:vote', (payload: unknown) => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      const self = room?.participants.get(socket.id);
      if (!room || !self) return fail(socket, 'You are not currently in a class.');
      if (!room.poll || !room.poll.open) return fail(socket, 'There is no open poll right now.');
      if (!isRecord(payload) || typeof payload.optionId !== 'string' || !room.poll.options.some((option) => option.id === payload.optionId)) {
        return fail(socket, 'Invalid vote.');
      }
      if (!pollVoteRateLimiter.allow(socket.id)) return fail(socket, 'You are voting too quickly. Please slow down.');
      room.poll.votes.set(socket.id, payload.optionId);
      broadcastPoll(room);
    });
    socket.on('poll:close', () => {
      const ctx = requireTutor(socket, 'Only the tutor can close the poll.');
      if (!ctx) return;
      if (!ctx.room.poll) return fail(socket, 'There is no poll to close.');
      ctx.room.poll.open = false;
      broadcastPoll(ctx.room);
    });
    socket.on('poll:clear', () => {
      const ctx = requireTutor(socket, 'Only the tutor can clear the poll.');
      if (!ctx) return;
      ctx.room.poll = null;
      broadcastPoll(ctx.room);
    });

    socket.on('understanding:start', () => {
      const ctx = requireTutor(socket, 'Only the tutor can start an understanding check.');
      if (!ctx) return;
      ctx.room.understandingCheck = { id: randomUUID(), open: true, responses: new Map() };
      broadcastUnderstanding(ctx.room);
    });
    socket.on('understanding:respond', (payload: unknown) => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      const self = room?.participants.get(socket.id);
      if (!room || !self) return fail(socket, 'You are not currently in a class.');
      if (!room.understandingCheck || !room.understandingCheck.open) return fail(socket, 'There is no open understanding check right now.');
      if (!isRecord(payload) || (payload.status !== 'understood' && payload.status !== 'confused' && payload.status !== 'lost')) {
        return fail(socket, 'Invalid response.');
      }
      if (!understandingRateLimiter.allow(socket.id)) return fail(socket, 'Please slow down.');
      room.understandingCheck.responses.set(socket.id, payload.status);
      broadcastUnderstanding(room);
    });
    socket.on('understanding:end', () => {
      const ctx = requireTutor(socket, 'Only the tutor can end the understanding check.');
      if (!ctx) return;
      ctx.room.understandingCheck = null;
      broadcastUnderstanding(ctx.room);
    });

    socket.on('timer:start', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can start the timer.');
      if (!ctx) return;
      if (!isRecord(payload) || (payload.mode !== 'stopwatch' && payload.mode !== 'countdown')) return fail(socket, 'Invalid timer request.');
      let durationMs: number | null = null;
      if (payload.mode === 'countdown') {
        if (typeof payload.durationMs !== 'number' || !Number.isFinite(payload.durationMs)
          || payload.durationMs <= 0 || payload.durationMs > MAX_TIMER_DURATION_MS) {
          return fail(socket, 'Invalid timer duration.');
        }
        durationMs = payload.durationMs;
      }
      ctx.room.timer = { mode: payload.mode, anchorAt: Date.now(), durationMs, paused: false, elapsedAtPauseMs: null };
      broadcastTimer(ctx.room);
    });
    socket.on('timer:pause', () => {
      const ctx = requireTutor(socket, 'Only the tutor can pause the timer.');
      if (!ctx || !ctx.room.timer || ctx.room.timer.paused) return;
      ctx.room.timer.elapsedAtPauseMs = Date.now() - ctx.room.timer.anchorAt;
      ctx.room.timer.paused = true;
      broadcastTimer(ctx.room);
    });
    socket.on('timer:resume', () => {
      const ctx = requireTutor(socket, 'Only the tutor can resume the timer.');
      if (!ctx || !ctx.room.timer || !ctx.room.timer.paused) return;
      ctx.room.timer.anchorAt = Date.now() - (ctx.room.timer.elapsedAtPauseMs ?? 0);
      ctx.room.timer.paused = false;
      ctx.room.timer.elapsedAtPauseMs = null;
      broadcastTimer(ctx.room);
    });
    socket.on('timer:stop', () => {
      const ctx = requireTutor(socket, 'Only the tutor can stop the timer.');
      if (!ctx) return;
      ctx.room.timer = null;
      broadcastTimer(ctx.room);
    });

    socket.on('board:update', (payload: unknown) => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      const self = room?.participants.get(socket.id);
      if (!room || !self) return fail(socket, 'You are not currently in a class.');
      if (self.role === 'student' && !room.board.studentsCanDraw) return fail(socket, 'The tutor has turned off drawing for students.');
      if (!boardUpdateRateLimiter.allow(socket.id)) return fail(socket, 'You are drawing too fast — please slow down.');
      const parsed = parseBoardUpdateBatch(payload);
      if (!parsed) return fail(socket, 'Invalid whiteboard update.');
      const page = room.board.pages.find((candidate) => candidate.id === parsed.pageId);
      if (!page) return fail(socket, 'That whiteboard page no longer exists.');
      const accepted: BoardElement[] = [];
      for (const element of parsed.elements) {
        const existing = page.elements.get(element.id);
        // A brand-new (never-seen) element is dropped once the page is at capacity; an edit to an
        // element the page already holds (including marking it deleted) is always allowed, since
        // it doesn't grow the page.
        if (!existing && !element.isDeleted && page.elements.size >= MAX_BOARD_ELEMENTS_PER_PAGE) continue;
        if (shouldAcceptElement(existing, element)) {
          page.elements.set(element.id, element);
          accepted.push(element);
        }
      }
      if (accepted.length === 0) return;
      for (const id of room.participants.keys()) {
        if (id !== socket.id) io.to(id).emit('board:update', { pageId: parsed.pageId, elements: accepted });
      }
    });
    socket.on('board:cursor', (payload: unknown) => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      const self = room?.participants.get(socket.id);
      if (!room || !self || !isRecord(payload) || typeof payload.x !== 'number' || typeof payload.y !== 'number'
        || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
      if (!boardPointerRateLimiter.allow(socket.id)) return;
      for (const id of room.participants.keys()) {
        if (id !== socket.id) io.to(id).emit('board:cursor', { id: socket.id, name: self.name, x: payload.x, y: payload.y });
      }
    });
    socket.on('board:laser', (payload: unknown) => {
      const room = socket.data.roomId ? rooms.get(socket.data.roomId) : undefined;
      const self = room?.participants.get(socket.id);
      if (!room || !self || !isRecord(payload) || typeof payload.x !== 'number' || typeof payload.y !== 'number'
        || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
      if (!boardPointerRateLimiter.allow(socket.id)) return;
      // Ephemeral only — never written into board history, unlike board:update.
      for (const id of room.participants.keys()) {
        if (id !== socket.id) io.to(id).emit('board:laser', { id: socket.id, x: payload.x, y: payload.y });
      }
    });

    socket.on('board:page-create', () => {
      const ctx = requireTutor(socket, 'Only the tutor can add a whiteboard page.');
      if (!ctx) return;
      if (ctx.room.board.pages.length >= MAX_BOARD_PAGES) return fail(socket, 'This class has reached the maximum number of whiteboard pages.');
      const id = randomUUID();
      ctx.room.board.pages.push({ id, name: `Board ${ctx.room.board.pages.length + 1}`, background: 'blank', elements: new Map() });
      ctx.room.board.activePageId = id;
      broadcastBoardPages(ctx.room);
    });
    socket.on('board:page-rename', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can rename a whiteboard page.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.pageId !== 'string' || typeof payload.name !== 'string') return fail(socket, 'Invalid request.');
      const name = payload.name.trim();
      if (!name || name.length > MAX_BOARD_PAGE_NAME_LENGTH) return fail(socket, `Page names must be 1–${MAX_BOARD_PAGE_NAME_LENGTH} characters.`);
      const page = ctx.room.board.pages.find((candidate) => candidate.id === payload.pageId);
      if (!page) return fail(socket, 'That whiteboard page no longer exists.');
      page.name = name;
      broadcastBoardPages(ctx.room);
    });
    socket.on('board:page-delete', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can delete a whiteboard page.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.pageId !== 'string') return fail(socket, 'Invalid request.');
      if (ctx.room.board.pages.length <= 1) return fail(socket, 'A class must always have at least one whiteboard page.');
      const index = ctx.room.board.pages.findIndex((candidate) => candidate.id === payload.pageId);
      if (index === -1) return fail(socket, 'That whiteboard page no longer exists.');
      ctx.room.board.pages.splice(index, 1);
      if (ctx.room.board.activePageId === payload.pageId) {
        ctx.room.board.activePageId = ctx.room.board.pages[Math.max(0, index - 1)].id;
      }
      broadcastBoardPages(ctx.room);
    });
    socket.on('board:page-reorder', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can reorder whiteboard pages.');
      if (!ctx) return;
      if (!isRecord(payload) || !Array.isArray(payload.pageIds)) return fail(socket, 'Invalid request.');
      const currentIds = new Set(ctx.room.board.pages.map((page) => page.id));
      const nextIds: unknown[] = payload.pageIds;
      if (nextIds.length !== currentIds.size || !nextIds.every((id) => typeof id === 'string' && currentIds.has(id))
        || new Set(nextIds).size !== nextIds.length) {
        return fail(socket, 'Invalid page order.');
      }
      const byId = new Map(ctx.room.board.pages.map((page) => [page.id, page]));
      ctx.room.board.pages = (nextIds as string[]).map((id) => byId.get(id)!);
      broadcastBoardPages(ctx.room);
    });
    socket.on('board:page-switch', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can change the active whiteboard page.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.pageId !== 'string') return fail(socket, 'Invalid request.');
      if (!ctx.room.board.pages.some((page) => page.id === payload.pageId)) return fail(socket, 'That whiteboard page no longer exists.');
      ctx.room.board.activePageId = payload.pageId;
      broadcastBoardPages(ctx.room);
    });
    socket.on('board:background', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can change a whiteboard page’s background.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.pageId !== 'string') return fail(socket, 'Invalid request.');
      const background = parseBackground(payload.background);
      if (!background) return fail(socket, 'Invalid background.');
      const page = ctx.room.board.pages.find((candidate) => candidate.id === payload.pageId);
      if (!page) return fail(socket, 'That whiteboard page no longer exists.');
      page.background = background;
      broadcastBoardPages(ctx.room);
    });
    socket.on('board:permission', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can change whiteboard drawing permission.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.studentsCanDraw !== 'boolean') return fail(socket, 'Invalid request.');
      ctx.room.board.studentsCanDraw = payload.studentsCanDraw;
      for (const id of ctx.room.participants.keys()) io.to(id).emit('board:permission-update', { studentsCanDraw: payload.studentsCanDraw });
    });
    socket.on('board:clear', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can clear a whiteboard page.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.pageId !== 'string') return fail(socket, 'Invalid request.');
      const page = ctx.room.board.pages.find((candidate) => candidate.id === payload.pageId);
      if (!page) return fail(socket, 'That whiteboard page no longer exists.');
      page.elements.clear();
      for (const id of ctx.room.participants.keys()) io.to(id).emit('board:cleared', { pageId: payload.pageId });
    });
    socket.on('board:follow-me', () => {
      const ctx = requireTutor(socket, 'Only the tutor can ask the class to follow.');
      if (!ctx) return;
      for (const id of ctx.room.participants.keys()) {
        if (id !== socket.id) io.to(id).emit('board:follow-me');
      }
    });
    socket.on('board:import', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can import a whiteboard file.');
      if (!ctx) return;
      const parsed = parseBoardImport(payload);
      if (!parsed) return fail(socket, 'That whiteboard file is invalid, malformed, or too large.');
      const page = ctx.room.board.pages.find((candidate) => candidate.id === parsed.pageId);
      if (!page) return fail(socket, 'That whiteboard page no longer exists.');
      // An import replaces the page outright rather than merging — an omitted element means the
      // imported file doesn't include it, not that every other client should keep it around.
      page.elements.clear();
      for (const element of parsed.elements) page.elements.set(element.id, element);
      for (const id of ctx.room.participants.keys()) {
        io.to(id).emit('board:cleared', { pageId: parsed.pageId });
        if (parsed.elements.length > 0) io.to(id).emit('board:update', { pageId: parsed.pageId, elements: parsed.elements });
      }
    });

    socket.on('announce:send', (payload: unknown) => {
      const ctx = requireTutor(socket, 'Only the tutor can send an announcement.');
      if (!ctx) return;
      if (!isRecord(payload) || typeof payload.text !== 'string') return fail(socket, 'Invalid announcement.');
      const text = payload.text.trim();
      if (!text || text.length > MAX_ANNOUNCEMENT_LENGTH) return fail(socket, `Announcements must be 1–${MAX_ANNOUNCEMENT_LENGTH} characters.`);
      if (ctx.room.announcementTimer) clearTimeout(ctx.room.announcementTimer);
      const announcement: Announcement = { id: randomUUID(), text, sentAt: Date.now() };
      ctx.room.announcement = announcement;
      for (const id of ctx.room.participants.keys()) io.to(id).emit('announce:update', announcement);
      // Auto-expires so it genuinely disappears for everyone in sync, rather than each client
      // fading it out locally on its own independent timer.
      ctx.room.announcementTimer = setTimeout(() => {
        ctx.room.announcement = null;
        ctx.room.announcementTimer = null;
        for (const id of ctx.room.participants.keys()) io.to(id).emit('announce:update', null);
      }, ANNOUNCEMENT_TTL_MS);
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
