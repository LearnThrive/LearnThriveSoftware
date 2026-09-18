import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type {
  BoardElement, ChatMessage, ClientToServerEvents, JoinedRoom, Participant, ParticipantRole,
  PollState, RoomTimerState, ServerToClientEvents, UnderstandingCheckState, WaitingParticipant,
} from '../shared/protocol';
import { createSignallingServer } from './signalling';

const DISCONNECT_GRACE_MS = 300;

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
const media = { audio: true, video: true };
const DEFAULT_SETTINGS = { locked: false, studentsCanShareScreen: true, studentsCanChat: true };

describe('signalling through real Socket.IO clients', () => {
  let server: ReturnType<typeof createSignallingServer>;
  let url: string;
  let clients: Client[];

  beforeEach(async () => {
    server = createSignallingServer({ disconnectGraceMs: DISCONNECT_GRACE_MS });
    clients = [];
    server.httpServer.listen(0, '127.0.0.1');
    await once(server.httpServer, 'listening');
    url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    clients.forEach((client) => client.disconnect());
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  });

  async function connect(origin?: string, extra?: { reconnection?: boolean; reconnectionDelay?: number; reconnectionDelayMax?: number }) {
    const client: Client = io(url, {
      transports: ['websocket'],
      reconnection: false,
      ...(origin ? { extraHeaders: { Origin: origin } } : {}),
      ...extra,
    });
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
    });
    return client;
  }

  // Reconnects fast enough to land well inside DISCONNECT_GRACE_MS, simulating a brief network blip.
  async function connectRecoverable() {
    return connect(undefined, { reconnection: true, reconnectionDelay: 10, reconnectionDelayMax: 20 });
  }

  function requestJoin(client: Client, name: string, role: ParticipantRole, roomId = 'room-one') {
    client.emit('room:join', { roomId, name, media, role });
  }

  // The very first participant in a room is always the tutor in these tests unless noted.
  async function joinTutor(client: Client, name: string, roomId = 'room-one') {
    const result = new Promise<JoinedRoom>((resolve) => client.once('room:joined', resolve));
    requestJoin(client, name, 'tutor', roomId);
    return result;
  }

  // Students always land in the waiting room first — they need an explicit admit to get in.
  async function joinStudent(client: Client, name: string, roomId = 'room-one') {
    const result = new Promise<{ roomId: string }>((resolve) => client.once('room:waiting', resolve));
    requestJoin(client, name, 'student', roomId);
    return result;
  }

  // Joins `student` as a student (or, if already waiting, harmlessly re-confirms it — the server
  // treats a duplicate join from a still-waiting socket as an idempotent resend) and has `tutor`
  // admit them, resolving once the student actually receives room:joined.
  async function admit(tutor: Client, student: Client, name = 'Bob', roomId = 'room-one') {
    const waiting = new Promise<{ roomId: string }>((resolve) => student.once('room:waiting', resolve));
    requestJoin(student, name, 'student', roomId);
    await waiting;
    const joined = new Promise<JoinedRoom>((resolve) => student.once('room:joined', resolve));
    tutor.emit('room:admit', { id: student.id! });
    return joined;
  }

  it('admits the tutor immediately; a student waits until the tutor admits them', async () => {
    const tutor = await connect();
    const tutorEvents: JoinedRoom[] = [];
    tutor.on('room:joined', (payload) => tutorEvents.push(payload));
    requestJoin(tutor, '  Alice  ', 'tutor');
    await expect.poll(() => tutorEvents.length, { timeout: 500 }).toBe(1);
    const firstPageId = tutorEvents[0].board.activePageId;
    expect(tutorEvents[0]).toEqual({
      roomId: 'room-one', self: { id: tutor.id, name: 'Alice', media, screenSharing: false, handRaised: false, handRaisedAt: null, role: 'tutor', forceMuted: false },
      peers: [], waiting: [], settings: DEFAULT_SETTINGS, poll: null, understandingCheck: null, timer: null,
      board: {
        pages: [{ id: firstPageId, name: 'Board 1', background: 'blank' }],
        activePageId: firstPageId, elementsByPage: { [firstPageId]: [] }, studentsCanDraw: true,
      },
      announcement: null,
    });

    const waitingUpdate = new Promise<{ waiting: WaitingParticipant[] }>((resolve) => tutor.once('room:waiting-update', resolve));
    const student = await connect();
    const waiting = await joinStudent(student, 'Bob');
    expect(waiting).toEqual({ roomId: 'room-one' });
    expect(await waitingUpdate).toEqual({ waiting: [{ id: student.id, name: 'Bob' }] });

    const peerAnnounced = new Promise<Parameters<ServerToClientEvents['room:participant-joined']>[0]>(
      (resolve) => tutor.once('room:participant-joined', resolve),
    );
    const admitted = await admit(tutor, student);
    expect(admitted.self).toEqual({ id: student.id, name: 'Bob', media, screenSharing: false, handRaised: false, handRaisedAt: null, role: 'student', forceMuted: false });
    expect(admitted.peers).toEqual([{ peer: tutorEvents[0].self, sessionId: admitted.peers[0].sessionId, initiator: false }]);
    expect(admitted.peers[0].sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await peerAnnounced).toEqual({ peer: admitted.self, sessionId: admitted.peers[0].sessionId, initiator: true });
  });

  it('rejects a second tutor, but lets a genuinely new tutor reclaim a stale (grace-period) slot', async () => {
    const first = await connect();
    await joinTutor(first, 'Alice');

    const intruder = await connect();
    const full = new Promise<Parameters<ServerToClientEvents['room:full']>[0]>((resolve) => intruder.once('room:full', resolve));
    requestJoin(intruder, 'Mallory', 'tutor');
    expect(await full).toEqual({ message: 'This class already has a tutor.' });

    first.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the disconnect handler register the grace timer
    const replacement = await connect();
    const rejoined = await joinTutor(replacement, 'Alice again');
    expect(rejoined.self.role).toBe('tutor');
  });

  it('Admit All admits only up to the 3-student capacity, in join order, and reports the remainder', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const students = await Promise.all(['Bob', 'Cate', 'Dee', 'Eve'].map(async (name) => {
      const client = await connect();
      await joinStudent(client, name);
      return client;
    }));

    const joinedOrder: string[] = [];
    for (const student of students) student.once('room:joined', () => joinedOrder.push(student.id!));
    const result = new Promise<{ admitted: number; remaining: number }>((resolve) => tutor.once('room:admit-result', resolve));
    tutor.emit('room:admit-all');
    expect(await result).toEqual({ admitted: 3, remaining: 1 });
    await expect.poll(() => joinedOrder.length, { timeout: 500 }).toBe(3);
    expect(joinedOrder).toEqual(students.slice(0, 3).map((s) => s.id));

    const fourthAdmit = new Promise<{ admitted: number; remaining: number }>((resolve) => tutor.once('room:admit-result', resolve));
    tutor.emit('room:admit', { id: students[3].id! });
    expect(await fourthAdmit).toEqual({ admitted: 0, remaining: 1 });
    expect(server.rooms.get('room-one')?.participants.size).toBe(4);
  });

  it('makes a duplicate join idempotent for both an admitted participant and a waiting one', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await joinStudent(student, 'Bob');

    const duplicateWaiting = new Promise<{ roomId: string }>((resolve) => student.once('room:waiting', resolve));
    requestJoin(student, 'Different name', 'student');
    await duplicateWaiting; // still waiting, no admission happened, and no second waiting-room entry was created
    expect(server.rooms.get('room-one')?.waiting.size).toBe(1);

    const admitted = await admit(tutor, student);
    const duplicateJoined = new Promise<JoinedRoom>((resolve) => tutor.once('room:joined', resolve));
    requestJoin(tutor, 'Different name', 'tutor');
    const resent = await duplicateJoined;
    expect(resent.self.name).toBe('Alice');
    expect(resent.peers).toEqual([{ peer: admitted.self, sessionId: admitted.peers[0].sessionId, initiator: true }]);

    const error = new Promise((resolve) => tutor.once('room:error', resolve));
    requestJoin(tutor, 'Alice', 'tutor', 'room-two');
    await error;
    expect(server.rooms.size).toBe(1);
  });

  it('cleans up departure, gives a replacement a fresh edge, and deletes empty rooms', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    const original = await admit(tutor, student);
    const studentId = student.id; // captured before disconnect() clears it client-side
    const left = new Promise<{ id: string; name: string | null }>((resolve) => tutor.once('room:participant-left', resolve));
    student.disconnect();
    expect(await left).toEqual({ id: studentId, name: 'Bob' });

    const third = await connect();
    const replacement = await admit(tutor, third);
    expect(replacement.peers[0].sessionId).not.toBe(original.peers[0]?.sessionId);
    const staleError = new Promise((resolve) => tutor.once('room:error', resolve));
    tutor.emit('webrtc:offer', { sessionId: original.peers[0]?.sessionId ?? 'stale', description: { type: 'offer', sdp: 'v=0\r\n' } });
    await staleError;

    // The tutor leaving now ends the class for everyone still in it (room:ended), not the
    // per-participant room:participant-left notice — see the tutor-departure cascade test below.
    const remaining = new Promise<void>((resolve) => third.once('room:ended', () => resolve()));
    tutor.emit('room:leave', () => {});
    await remaining;
    third.emit('room:leave', () => {});
    await expect.poll(() => server.rooms.size).toBe(0);
  });

  it('announces a participant as reconnecting (with id) before the grace period elapses, then leaving if they do not return', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);
    const studentId = student.id; // captured before disconnect() clears it client-side
    const reconnecting = new Promise<{ id: string }>((resolve) => tutor.once('room:participant-reconnecting', resolve));
    const left = new Promise<{ id: string; name: string | null }>((resolve) => tutor.once('room:participant-left', resolve));
    student.disconnect();
    expect(await reconnecting).toEqual({ id: studentId });
    expect(await left).toEqual({ id: studentId, name: 'Bob' });
  });

  it('recovers a briefly dropped connection without losing the pairing or notifying a departure', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connectRecoverable();
    const original = await admit(tutor, student);
    const studentId = student.id;
    const reconnecting = new Promise<void>((resolve) => tutor.once('room:participant-reconnecting', () => resolve()));
    const reconnected = new Promise<Participant>((resolve) => tutor.once('room:participant-reconnected', resolve));
    const left = () => { throw new Error('should not have announced a departure for a recovered connection'); };
    tutor.once('room:participant-left', left);
    student.io.engine.close();
    await reconnecting;
    await reconnected;
    expect(student.connected).toBe(true);
    expect(student.id).toBe(studentId);
    expect(student.recovered).toBe(true);
    const candidate = new Promise((resolve) => student.once('webrtc:ice-candidate', resolve));
    tutor.emit('webrtc:ice-candidate', {
      sessionId: original.peers[0].sessionId,
      candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host' },
    });
    await candidate;
    tutor.off('room:participant-left', left);
  });

  it('recovers a briefly dropped connection for a participant still in the waiting room, without dropping their place in the queue', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connectRecoverable();
    await joinStudent(student, 'Bob');
    const studentId = student.id;
    student.io.engine.close();
    await new Promise((resolve) => setTimeout(resolve, DISCONNECT_GRACE_MS / 2));
    await expect.poll(() => student.connected, { timeout: 2000 }).toBe(true);
    expect(student.id).toBe(studentId);
    expect(student.recovered).toBe(true);
    // Still in the queue well after the old grace period would have expired if it hadn't applied.
    await new Promise((resolve) => setTimeout(resolve, DISCONNECT_GRACE_MS));
    expect(server.rooms.get('room-one')?.waiting.has(studentId!)).toBe(true);
    const joined = await admit(tutor, student);
    expect(joined.self.name).toBe('Bob');
  });

  it('the waiting room has its own abuse-prevention cap, independent of the 3-student capacity', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    for (let i = 0; i < 10; i += 1) {
      const client = await connect();
      await joinStudent(client, `Student ${i}`);
    }
    const eleventh = await connect();
    const full = new Promise<Parameters<ServerToClientEvents['room:full']>[0]>((resolve) => eleventh.once('room:full', resolve));
    requestJoin(eleventh, 'One too many', 'student');
    expect(await full).toEqual({ message: 'The waiting room is full right now. Please try again shortly.' });
    expect(server.rooms.get('room-one')?.waiting.size).toBe(10);
  });

  it('a 3-participant mesh negotiates every edge independently, and a signal never leaks to the third participant', async () => {
    const tutor = await connect();
    const tutorJoined = await joinTutor(tutor, 'Alice');
    const studentA = await connect();
    const aJoined = await admit(tutor, studentA, 'Bob');
    const studentB = await connect();
    const bJoined = await admit(tutor, studentB, 'Cate');

    // Every participant now has exactly 2 edges (one to each of the other two).
    expect(tutorJoined.peers).toEqual([]); // tutor joined alone; its edges arrive later via room:participant-joined
    expect(aJoined.peers).toHaveLength(1); // A only saw the tutor at admission time
    expect(bJoined.peers).toHaveLength(2); // B saw both the tutor and A, since both were already admitted

    const edgeTutorA = aJoined.peers[0].sessionId;
    const edgeTutorB = bJoined.peers.find((p) => p.peer.id === tutor.id)!.sessionId;
    const edgeAB = bJoined.peers.find((p) => p.peer.id === studentA.id)!.sessionId;
    expect(new Set([edgeTutorA, edgeTutorB, edgeAB]).size).toBe(3);

    const aOnAnySignal: unknown[] = [];
    studentA.onAny((event, payload) => { if (event.startsWith('webrtc:')) aOnAnySignal.push({ event, payload }); });

    // Tutor<->B offer must reach B, and must never reach A.
    const bOffer = new Promise((resolve) => studentB.once('webrtc:offer', resolve));
    tutor.emit('webrtc:offer', { sessionId: edgeTutorB, description: { type: 'offer', sdp: 'v=0\r\n' } });
    await bOffer;

    // A<->B: A was admitted first (before B), so A is the initiator on this edge, not B.
    const bOfferFromA = new Promise((resolve) => studentB.once('webrtc:offer', resolve));
    studentA.emit('webrtc:offer', { sessionId: edgeAB, description: { type: 'offer', sdp: 'v=0\r\n' } });
    await bOfferFromA;

    expect(aOnAnySignal.filter((entry) => (entry as { event: string }).event === 'webrtc:offer' && JSON.stringify(entry).includes(edgeTutorB))).toEqual([]);
  });

  it('relays offers, answers, ICE, and media only to the specific other participant on that edge', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    const paired = await admit(tutor, student);
    const unrelated = await connect();
    await joinTutor(unrelated, 'Dara', 'room-two');
    const unrelatedSignals: unknown[] = [];
    unrelated.onAny((event, payload) => unrelatedSignals.push({ event, payload }));
    const sessionId = paired.peers[0].sessionId;
    const offerPayload = { sessionId, description: { type: 'offer' as const, sdp: 'v=0\r\n' } };
    const offer = new Promise((resolve) => student.once('webrtc:offer', resolve));
    tutor.emit('webrtc:offer', offerPayload);
    expect(await offer).toEqual(offerPayload);
    const answerPayload = { sessionId, description: { type: 'answer' as const, sdp: 'v=0\r\n' } };
    const answer = new Promise((resolve) => tutor.once('webrtc:answer', resolve));
    student.emit('webrtc:answer', answerPayload);
    expect(await answer).toEqual(answerPayload);
    const icePayload = { sessionId, candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 } };
    const candidate = new Promise((resolve) => student.once('webrtc:ice-candidate', resolve));
    tutor.emit('webrtc:ice-candidate', icePayload);
    expect(await candidate).toEqual(icePayload);
    const state = new Promise((resolve) => student.once('participant:media', resolve));
    tutor.emit('participant:media', { audio: false, video: false });
    expect(await state).toEqual({ id: tutor.id, media: { audio: false, video: false } });
    const duplicate = await new Promise<JoinedRoom>((resolve) => { tutor.once('room:joined', resolve); requestJoin(tutor, 'Alice', 'tutor'); });
    expect(duplicate.self.media).toEqual({ audio: false, video: false });
    expect(unrelatedSignals).toEqual([]);
  });

  it('acknowledges room:leave only after the departure has actually been processed', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const acked = new Promise<void>((resolve) => tutor.emit('room:leave', resolve));
    await acked;
    expect(server.rooms.size).toBe(0);
  });

  it('relays hand-raise, reaction, and screen-share state to admitted participants only, never to a waiting student or another room', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const studentA = await connect();
    await admit(tutor, studentA);
    const studentB = await connect(); // stays in the waiting room — must never receive relayed events
    await joinStudent(studentB, 'Cate');
    const outsider = await connect();
    await joinTutor(outsider, 'Dara', 'room-two');
    const waitingSignals: unknown[] = [];
    studentB.onAny((event, payload) => waitingSignals.push({ event, payload }));
    const outsiderSignals: unknown[] = [];
    outsider.onAny((event, payload) => outsiderSignals.push({ event, payload }));

    const raised = new Promise((resolve) => studentA.once('participant:hand', resolve));
    tutor.emit('participant:hand', { raised: true });
    expect(await raised).toEqual({ id: tutor.id, raised: true });

    const reaction = new Promise((resolve) => tutor.once('participant:reaction', resolve));
    studentA.emit('participant:reaction', { emoji: '👍' });
    expect(await reaction).toEqual({ id: studentA.id, emoji: '👍' });

    const sharing = new Promise((resolve) => studentA.once('participant:screen-share', resolve));
    tutor.emit('participant:screen-share', { sharing: true });
    expect(await sharing).toEqual({ id: tutor.id, sharing: true });

    expect(waitingSignals).toEqual([]);
    expect(outsiderSignals).toEqual([]);
  });

  it('relays chat to every admitted participant including the sender, never to a waiting student or another room', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const studentA = await connect();
    await admit(tutor, studentA);
    const studentB = await connect();
    await joinStudent(studentB, 'Cate');
    const outsider = await connect();
    await joinTutor(outsider, 'Dara', 'room-two');
    const waitingMessages: unknown[] = [];
    studentB.on('chat:message', (message) => waitingMessages.push(message));
    const outsiderMessages: unknown[] = [];
    outsider.on('chat:message', (message) => outsiderMessages.push(message));
    const fromTutor = new Promise<ChatMessage>((resolve) => tutor.once('chat:message', resolve));
    const fromStudent = new Promise<ChatMessage>((resolve) => studentA.once('chat:message', resolve));
    tutor.emit('chat:message', { text: '  Hello there  ' });
    const [selfEcho, peerCopy] = await Promise.all([fromTutor, fromStudent]);
    expect(selfEcho).toEqual(peerCopy);
    expect(selfEcho.senderId).toBe(tutor.id);
    expect(selfEcho.name).toBe('Alice');
    expect(selfEcho.text).toBe('Hello there');
    expect(typeof selfEcho.id).toBe('string');
    expect(typeof selfEcho.timestamp).toBe('number');
    expect(waitingMessages).toEqual([]);
    expect(outsiderMessages).toEqual([]);
  });

  it('rejects empty, oversized, malformed, and out-of-room chat messages, and rate-limits spam', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const outsider = await connect();
    const outsiderError = new Promise((resolve) => outsider.once('room:error', resolve));
    outsider.emit('chat:message', { text: 'hi' });
    await outsiderError;

    for (const payload of [{ text: '   ' }, { text: 'x'.repeat(501) }, {}, { text: 123 }, null]) {
      const error = new Promise((resolve) => tutor.once('room:error', resolve));
      tutor.emit('chat:message', payload as Parameters<ClientToServerEvents['chat:message']>[0]);
      expect(await error).toHaveProperty('message');
    }

    const received: unknown[] = [];
    tutor.on('chat:message', (message) => received.push(message));
    for (let i = 0; i < 6; i += 1) tutor.emit('chat:message', { text: `message ${i}` });
    const limited = new Promise((resolve) => tutor.once('room:error', resolve));
    tutor.emit('chat:message', { text: 'one too many' });
    expect(await limited).toHaveProperty('message');
    await expect.poll(() => received.length, { timeout: 500 }).toBe(6);
  });

  it('relays only known reaction emoji, rejects unknown ones, and rate-limits spam', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    const reaction = new Promise((resolve) => student.once('participant:reaction', resolve));
    tutor.emit('participant:reaction', { emoji: '👍' });
    expect(await reaction).toEqual({ id: tutor.id, emoji: '👍' });

    const rejected = new Promise((resolve) => tutor.once('room:error', resolve));
    tutor.emit('participant:reaction', { emoji: '<script>alert(1)</script>' });
    expect(await rejected).toHaveProperty('message');

    const received: unknown[] = [];
    student.on('participant:reaction', (payload) => received.push(payload));
    for (let i = 0; i < 9; i += 1) tutor.emit('participant:reaction', { emoji: '🎉' });
    const limited = new Promise((resolve) => tutor.once('room:error', resolve));
    tutor.emit('participant:reaction', { emoji: '🎉' });
    expect(await limited).toHaveProperty('message');
    await expect.poll(() => received.length, { timeout: 500 }).toBe(9);
  });

  it('rejects signals from outsiders and from the wrong negotiating role', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    const paired = await admit(tutor, student);
    const outsider = await connect();
    const sessionId = paired.peers[0].sessionId;
    const payload = { sessionId, description: { type: 'offer' as const, sdp: 'v=0\r\n' } };
    for (const client of [student, outsider]) {
      const error = new Promise((resolve) => client.once('room:error', resolve));
      client.emit('webrtc:offer', payload);
      expect(await error).toHaveProperty('message');
    }
    const wrongAnswer = new Promise((resolve) => tutor.once('room:error', resolve));
    tutor.emit('webrtc:answer', { ...payload, description: { type: 'answer', sdp: 'v=0\r\n' } });
    await wrongAnswer;
  });

  it('validates untrusted join, media, SDP, and candidate payloads', async () => {
    const first = await connect();
    const invalidJoins = [
      null, {}, { roomId: '../bad', name: 'Alice', media, role: 'tutor' },
      { roomId: 'room-one', name: '', media, role: 'tutor' },
      { roomId: 'room-one', name: 'x'.repeat(41), media, role: 'tutor' },
      { roomId: 'room-one', name: 'Alice', media: { audio: 'yes', video: true }, role: 'tutor' },
      { roomId: 'room-one', name: 'Alice', media, role: 'wizard' },
      { roomId: 'room-one', name: 'Alice', media },
    ];
    for (const payload of invalidJoins) {
      const error = new Promise((resolve) => first.once('room:error', resolve));
      first.emit('room:join', payload as Parameters<ClientToServerEvents['room:join']>[0]);
      expect(await error).toHaveProperty('message');
      expect(server.rooms.size).toBe(0);
    }
    await joinTutor(first, 'Alice');
    const second = await connect();
    const paired = await admit(first, second);
    const sessionId = paired.peers[0].sessionId;
    const invalidSignals = [
      { sessionId, description: { type: 'answer', sdp: 'v=0' } },
      { sessionId, description: { type: 'offer', sdp: 'x'.repeat(65_537) } },
      { sessionId: '', description: { type: 'offer', sdp: 'v=0' } },
    ];
    for (const payload of invalidSignals) {
      const error = new Promise((resolve) => first.once('room:error', resolve));
      first.emit('webrtc:offer', payload as Parameters<ClientToServerEvents['webrtc:offer']>[0]);
      expect(await error).toHaveProperty('message');
    }
    const invalidMedia = new Promise((resolve) => first.once('room:error', resolve));
    first.emit('participant:media', { audio: 'yes', video: false } as unknown as typeof media);
    await invalidMedia;
    const invalidIce = new Promise((resolve) => first.once('room:error', resolve));
    first.emit('webrtc:ice-candidate', { sessionId, candidate: { candidate: 'x'.repeat(8193) } });
    await invalidIce;
  });

  it('accepts local browser origins and rejects unapproved origins', async () => {
    expect((await connect('http://localhost:5173')).connected).toBe(true);
    expect((await connect('http://127.0.0.1:5173')).connected).toBe(true);
    await expect(connect('https://unrelated.example')).rejects.toBeDefined();
  });

  it('accepts HTTPS Cloudflare Quick Tunnel and Tailscale hostnames without needing TUNNEL_HOST, but not over plain HTTP', async () => {
    expect((await connect('https://deutsche-handed-videos-his.trycloudflare.com')).connected).toBe(true);
    expect((await connect('https://my-laptop.tailnet-name.ts.net')).connected).toBe(true);
    await expect(connect('http://deutsche-handed-videos-his.trycloudflare.com')).rejects.toBeDefined();
    await expect(connect('https://evil-trycloudflare.com')).rejects.toBeDefined();
  });

  it('locks and unlocks a room; rejects a new student join while locked without affecting existing participants', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    const settingsUpdate = new Promise<typeof DEFAULT_SETTINGS>((resolve) => tutor.once('room:settings-update', resolve));
    tutor.emit('room:settings', { locked: true });
    expect(await settingsUpdate).toEqual({ ...DEFAULT_SETTINGS, locked: true });

    const outsider = await connect();
    const full = new Promise<{ message: string }>((resolve) => outsider.once('room:full', resolve));
    requestJoin(outsider, 'Mallory', 'student');
    expect(await full).toEqual({ message: 'This class is currently locked. Please try again shortly.' });
    expect(tutor.connected && student.connected).toBe(true);

    const unlocked = new Promise<typeof DEFAULT_SETTINGS>((resolve) => tutor.once('room:settings-update', resolve));
    tutor.emit('room:settings', { locked: false });
    expect(await unlocked).toEqual(DEFAULT_SETTINGS);
    await joinStudent(outsider, 'Mallory again');
  });

  it('denies a waiting student, who is notified and removed from the queue', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    const joinWaitingUpdate = new Promise((resolve) => tutor.once('room:waiting-update', resolve));
    await joinStudent(student, 'Bob');
    await joinWaitingUpdate; // drain the join-triggered update so it can't be mistaken for the deny's own

    const denied = new Promise<void>((resolve) => student.once('room:denied', () => resolve()));
    const waitingUpdate = new Promise<{ waiting: unknown[] }>((resolve) => tutor.once('room:waiting-update', resolve));
    tutor.emit('room:deny', { id: student.id! });
    await denied;
    expect(await waitingUpdate).toEqual({ waiting: [] });
    expect(server.rooms.get('room-one')?.waiting.size).toBe(0);
  });

  it('force-mutes a student and lets the tutor allow them to unmute again', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    const mutedOnTutor = new Promise<{ id: string; forceMuted: boolean }>((resolve) => tutor.once('participant:force-muted', resolve));
    const mutedOnStudent = new Promise<{ id: string; forceMuted: boolean }>((resolve) => student.once('participant:force-muted', resolve));
    tutor.emit('room:mute-participant', { id: student.id! });
    expect(await mutedOnTutor).toEqual({ id: student.id, forceMuted: true });
    expect(await mutedOnStudent).toEqual({ id: student.id, forceMuted: true });

    const allowed = new Promise<{ id: string; forceMuted: boolean }>((resolve) => student.once('participant:force-muted', resolve));
    tutor.emit('room:allow-unmute', { id: student.id! });
    expect(await allowed).toEqual({ id: student.id, forceMuted: false });
  });

  it('mutes all current students at once, never the tutor', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const studentA = await connect();
    await admit(tutor, studentA, 'Bob');
    const studentB = await connect();
    await admit(tutor, studentB, 'Cate');

    // Everyone (including studentB) receives BOTH broadcasts — one per muted student — so
    // studentB must be filtered by id rather than matched via a single `.once`.
    const onB: { id: string; forceMuted: boolean }[] = [];
    studentB.on('participant:force-muted', (payload: { id: string; forceMuted: boolean }) => onB.push(payload));
    const mutedA = new Promise<{ id: string; forceMuted: boolean }>((resolve) => studentA.once('participant:force-muted', resolve));
    tutor.emit('room:mute-all');
    expect(await mutedA).toEqual({ id: studentA.id, forceMuted: true });
    await expect.poll(() => onB.some((event) => event.id === studentB.id), { timeout: 500 }).toBe(true);
    expect(onB.find((event) => event.id === studentB.id)).toEqual({ id: studentB.id, forceMuted: true });
    expect(server.rooms.get('room-one')?.participants.get(tutor.id!)?.forceMuted).toBe(false);
  });

  it('rejects moderation and class-settings actions from a non-tutor', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    const actions: Array<() => void> = [
      () => student.emit('room:settings', { locked: true }),
      () => student.emit('room:mute-participant', { id: tutor.id! }),
      () => student.emit('room:mute-all'),
      () => student.emit('room:allow-unmute', { id: tutor.id! }),
      () => student.emit('room:remove-participant', { id: tutor.id! }),
      () => student.emit('room:stop-share', { id: tutor.id! }),
      () => student.emit('room:lower-hand', { id: tutor.id! }),
      () => student.emit('room:admit', { id: 'whoever' }),
      () => student.emit('room:admit-all'),
      () => student.emit('room:deny', { id: 'whoever' }),
      () => student.emit('chat:delete', { id: 'whatever' }),
      () => student.emit('chat:clear'),
      () => student.emit('poll:create', { question: 'q', options: ['a', 'b'], anonymous: false, resultsVisible: 'always' }),
      () => student.emit('poll:close'),
      () => student.emit('poll:clear'),
      () => student.emit('understanding:start'),
      () => student.emit('understanding:end'),
      () => student.emit('timer:start', { mode: 'stopwatch', durationMs: null }),
      () => student.emit('timer:pause'),
      () => student.emit('timer:resume'),
      () => student.emit('timer:stop'),
    ];
    for (const act of actions) {
      const error = new Promise((resolve) => student.once('room:error', resolve));
      act();
      expect(await error).toHaveProperty('message');
    }
  });

  it('arbitrates screen-share ownership: rejects a second concurrent sharer, and the tutor can force-stop the active share', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const studentA = await connect();
    await admit(tutor, studentA, 'Bob');
    const studentB = await connect();
    await admit(tutor, studentB, 'Cate');

    const sharingOnTutor = new Promise((resolve) => tutor.once('participant:screen-share', resolve));
    studentA.emit('participant:screen-share', { sharing: true });
    expect(await sharingOnTutor).toEqual({ id: studentA.id, sharing: true });

    const rejected = new Promise((resolve) => studentB.once('room:error', resolve));
    studentB.emit('participant:screen-share', { sharing: true });
    expect(await rejected).toEqual({ message: 'Someone else is already sharing their screen.' });

    const stoppedOnA = new Promise<void>((resolve) => studentA.once('room:stop-share', () => resolve()));
    const stoppedBroadcast = new Promise((resolve) => tutor.once('participant:screen-share', resolve));
    tutor.emit('room:stop-share', { id: studentA.id! });
    await stoppedOnA;
    expect(await stoppedBroadcast).toEqual({ id: studentA.id, sharing: false });

    const sharingOnTutor2 = new Promise((resolve) => tutor.once('participant:screen-share', resolve));
    studentB.emit('participant:screen-share', { sharing: true });
    expect(await sharingOnTutor2).toEqual({ id: studentB.id, sharing: true });
  });

  it('clears screen-share ownership when the sharer leaves, so someone else can share afterwards', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const studentA = await connect();
    await admit(tutor, studentA, 'Bob');
    const studentB = await connect();
    await admit(tutor, studentB, 'Cate');

    await new Promise<void>((resolve) => { tutor.once('participant:screen-share', () => resolve()); studentA.emit('participant:screen-share', { sharing: true }); });
    expect(server.rooms.get('room-one')?.activeScreenShareId).toBe(studentA.id);

    studentA.emit('room:leave', () => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.rooms.get('room-one')?.activeScreenShareId).toBeNull();

    const sharingOnTutor = new Promise((resolve) => tutor.once('participant:screen-share', resolve));
    studentB.emit('participant:screen-share', { sharing: true });
    expect(await sharingOnTutor).toEqual({ id: studentB.id, sharing: true });
  });

  it('releases screen-share ownership when the sharer disconnects unexpectedly (grace period expiry), not just an explicit leave', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    await new Promise<void>((resolve) => { tutor.once('participant:screen-share', () => resolve()); student.emit('participant:screen-share', { sharing: true }); });
    expect(server.rooms.get('room-one')?.activeScreenShareId).toBe(student.id);

    student.disconnect();
    await expect.poll(() => server.rooms.get('room-one')?.activeScreenShareId, { timeout: 2000 }).toBeNull();
  });

  it('releases screen-share ownership immediately when the sharer is removed by the tutor', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    await new Promise<void>((resolve) => { tutor.once('participant:screen-share', () => resolve()); student.emit('participant:screen-share', { sharing: true }); });
    expect(server.rooms.get('room-one')?.activeScreenShareId).toBe(student.id);

    tutor.emit('room:remove-participant', { id: student.id! });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.rooms.get('room-one')?.activeScreenShareId).toBeNull();
  });

  it('gates student screen-share and chat behind room settings, without restricting the tutor', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    const settingsUpdate = new Promise((resolve) => student.once('room:settings-update', resolve));
    tutor.emit('room:settings', { studentsCanShareScreen: false, studentsCanChat: false });
    await settingsUpdate;

    const shareRejected = new Promise((resolve) => student.once('room:error', resolve));
    student.emit('participant:screen-share', { sharing: true });
    expect(await shareRejected).toEqual({ message: 'The tutor has turned off screen sharing for students.' });

    const chatRejected = new Promise((resolve) => student.once('room:error', resolve));
    student.emit('chat:message', { text: 'hello' });
    expect(await chatRejected).toEqual({ message: 'The tutor has turned off chat for students.' });

    const tutorShareOk = new Promise((resolve) => student.once('participant:screen-share', resolve));
    tutor.emit('participant:screen-share', { sharing: true });
    expect(await tutorShareOk).toEqual({ id: tutor.id, sharing: true });
    const tutorChatOk = new Promise((resolve) => student.once('chat:message', resolve));
    tutor.emit('chat:message', { text: 'hello from tutor' });
    await tutorChatOk;
  });

  it('removes a participant immediately, bypassing the disconnect grace period', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);
    const studentId = student.id;

    const removed = new Promise<void>((resolve) => student.once('room:removed', () => resolve()));
    const left = new Promise<{ id: string; name: string | null }>((resolve) => tutor.once('room:participant-left', resolve));
    tutor.emit('room:remove-participant', { id: studentId! });
    await removed;
    expect(await left).toEqual({ id: studentId, name: 'Bob' });
    expect(server.rooms.get('room-one')?.participants.has(studentId!)).toBe(false);
  });

  it('cascades a tutor\'s departure into room:ended for every remaining participant and every still-waiting student', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);
    const waitingStudent = await connect();
    await joinStudent(waitingStudent, 'Cate');

    const endedForStudent = new Promise<void>((resolve) => student.once('room:ended', () => resolve()));
    const endedForWaiting = new Promise<void>((resolve) => waitingStudent.once('room:ended', () => resolve()));
    tutor.emit('room:leave', () => {});
    await endedForStudent;
    await endedForWaiting;
    expect(server.rooms.size).toBe(0);
  });

  it('a lone tutor leaving with nobody else behaves exactly as before (no notifications, room just deleted)', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const acked = new Promise<void>((resolve) => tutor.emit('room:leave', resolve));
    await acked;
    expect(server.rooms.size).toBe(0);
  });

  it('resyncs force-muted state and settings to a participant recovering a brief disconnect', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connectRecoverable();
    await admit(tutor, student);
    const studentId = student.id!; // captured before disconnect clears it client-side

    const resynced = new Promise<JoinedRoom>((resolve) => student.once('room:joined', resolve));
    // Wait for the server's own disconnect signal (not a fixed sleep) before mutating state, so
    // the mutation deterministically lands in the offline gap regardless of how fast the client's
    // own reconnection attempt happens to race it.
    const reconnecting = new Promise<void>((resolve) => tutor.once('room:participant-reconnecting', () => resolve()));
    student.io.engine.close();
    await reconnecting;
    tutor.emit('room:mute-participant', { id: studentId });
    tutor.emit('room:settings', { studentsCanChat: false });

    await expect.poll(() => student.connected, { timeout: 2000 }).toBe(true);
    expect(student.recovered).toBe(true);
    const payload = await resynced;
    expect(payload.self.forceMuted).toBe(true);
    expect(payload.settings.studentsCanChat).toBe(false);
  });

  it('runs a poll end to end: creating, voting (including changing a vote), and closing, honouring visibility', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    const pollOnStudent = new Promise<PollState | null>((resolve) => student.once('poll:update', resolve));
    tutor.emit('poll:create', { question: 'Ready for a quiz?', options: ['Yes', 'No'], anonymous: false, resultsVisible: 'onClose' });
    const initial = await pollOnStudent;
    expect(initial?.question).toBe('Ready for a quiz?');
    expect(initial?.options).toHaveLength(2);
    expect(initial?.results).toBeNull(); // hidden from the student until close, per resultsVisible:'onClose'
    expect(initial?.myVote).toBeNull();

    const yesId = initial!.options.find((option) => option.text === 'Yes')!.id;
    const noId = initial!.options.find((option) => option.text === 'No')!.id;

    const afterVote = new Promise<PollState | null>((resolve) => student.once('poll:update', resolve));
    student.emit('poll:vote', { optionId: yesId });
    expect((await afterVote)?.myVote).toBe(yesId);

    // Changing a vote before close overwrites, doesn't add a second vote.
    const afterRevote = new Promise<PollState | null>((resolve) => student.once('poll:update', resolve));
    student.emit('poll:vote', { optionId: noId });
    const revoted = await afterRevote;
    expect(revoted?.myVote).toBe(noId);
    expect(revoted?.totalVotes).toBe(1);

    const closedOnStudent = new Promise<PollState | null>((resolve) => student.once('poll:update', resolve));
    tutor.emit('poll:close');
    const closed = await closedOnStudent;
    expect(closed?.open).toBe(false);
    expect(closed?.results).toEqual({ [yesId]: 0, [noId]: 1 }); // now visible post-close
  });

  it('keeps anonymous poll voters hidden even from the tutor', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    const onStudent = new Promise<PollState | null>((resolve) => student.once('poll:update', resolve));
    tutor.emit('poll:create', { question: 'Anonymous?', options: ['A', 'B'], anonymous: true, resultsVisible: 'always' });
    const initial = await onStudent;
    const optionId = initial!.options[0].id;

    const onTutor = new Promise<PollState | null>((resolve) => tutor.once('poll:update', resolve));
    student.emit('poll:vote', { optionId });
    const tutorView = await onTutor;
    expect(tutorView?.voters).toBeUndefined();
    expect(tutorView?.results?.[optionId]).toBe(1);
  });

  it('runs an understanding check: the tutor sees live per-student status and an aggregate, each student sees only their own', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const studentA = await connect();
    await admit(tutor, studentA, 'Bob');
    const studentB = await connect();
    await admit(tutor, studentB, 'Cate');

    const onA = new Promise<UnderstandingCheckState | null>((resolve) => studentA.once('understanding:update', resolve));
    const onBStart = new Promise<UnderstandingCheckState | null>((resolve) => studentB.once('understanding:update', resolve));
    tutor.emit('understanding:start');
    const aInitial = await onA;
    expect(aInitial?.myStatus).toBeNull();
    expect(aInitial?.responses).toBeUndefined();
    expect(aInitial?.summary).toBeUndefined();
    await onBStart;

    const onTutor = new Promise<UnderstandingCheckState | null>((resolve) => tutor.once('understanding:update', resolve));
    const onB = new Promise<UnderstandingCheckState | null>((resolve) => studentB.once('understanding:update', resolve));
    studentA.emit('understanding:respond', { status: 'confused' });
    const tutorView = await onTutor;
    expect(tutorView?.responses).toEqual([
      { id: studentA.id, name: 'Bob', status: 'confused' },
      { id: studentB.id, name: 'Cate', status: null },
    ]);
    expect(tutorView?.summary).toEqual({ understood: 0, confused: 1, lost: 0 });

    const bView = await onB;
    expect(bView?.myStatus).toBeNull(); // B never responded, and never sees A's response
    expect(bView?.responses).toBeUndefined();
  });

  it('starts, pauses, resumes, and stops a class timer via state-transition broadcasts, not a per-second tick', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    const started = new Promise<RoomTimerState | null>((resolve) => student.once('timer:update', resolve));
    tutor.emit('timer:start', { mode: 'countdown', durationMs: 60_000 });
    const state = await started;
    expect(state).toMatchObject({ mode: 'countdown', durationMs: 60_000, paused: false });

    const ticks: unknown[] = [];
    student.onAny((event) => { if (event === 'timer:update') ticks.push(event); });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(ticks).toEqual([]); // no per-second broadcast — only state transitions

    const paused = new Promise<RoomTimerState | null>((resolve) => student.once('timer:update', resolve));
    tutor.emit('timer:pause');
    expect((await paused)?.paused).toBe(true);

    const resumed = new Promise<RoomTimerState | null>((resolve) => student.once('timer:update', resolve));
    tutor.emit('timer:resume');
    expect((await resumed)?.paused).toBe(false);

    const stopped = new Promise<RoomTimerState | null>((resolve) => student.once('timer:update', resolve));
    tutor.emit('timer:stop');
    expect(await stopped).toBeNull();
  });

  it('deletes a chat message and clears the chat via relay only, with no server-side storage', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    const deleted = new Promise<{ id: string }>((resolve) => student.once('chat:message-deleted', resolve));
    tutor.emit('chat:delete', { id: 'some-message-id' });
    expect(await deleted).toEqual({ id: 'some-message-id' });

    const cleared = new Promise<void>((resolve) => student.once('chat:cleared', () => resolve()));
    tutor.emit('chat:clear');
    await cleared;
  });

  it("lowers a student's raised hand, notifying the student too", async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    await new Promise<void>((resolve) => { tutor.once('participant:hand', () => resolve()); student.emit('participant:hand', { raised: true }); });
    expect(server.rooms.get('room-one')?.participants.get(student.id!)?.handRaised).toBe(true);

    const loweredOnStudent = new Promise((resolve) => student.once('participant:hand', resolve));
    const loweredOnTutor = new Promise((resolve) => tutor.once('participant:hand', resolve));
    tutor.emit('room:lower-hand', { id: student.id! });
    expect(await loweredOnStudent).toEqual({ id: student.id, raised: false });
    expect(await loweredOnTutor).toEqual({ id: student.id, raised: false });
  });

  function makeElement(id: string, overrides: Partial<BoardElement> = {}): BoardElement {
    return { id, version: 1, versionNonce: 1, type: 'rectangle', x: 0, y: 0, ...overrides };
  }

  it('a tutor draws and every student receives the update, keyed to the right page', async () => {
    const tutor = await connect();
    const joined = await joinTutor(tutor, 'Alice');
    const pageId = joined.board.activePageId;
    const studentA = await connect();
    await admit(tutor, studentA, 'Bob');
    const studentB = await connect();
    await admit(tutor, studentB, 'Cate');

    const onA = new Promise((resolve) => studentA.once('board:update', resolve));
    const onB = new Promise((resolve) => studentB.once('board:update', resolve));
    const element = makeElement('el-1');
    tutor.emit('board:update', { pageId, elements: [element] });
    expect(await onA).toEqual({ pageId, elements: [element] });
    expect(await onB).toEqual({ pageId, elements: [element] });
  });

  it('a student draws when permitted, and is blocked once the tutor disables student drawing', async () => {
    const tutor = await connect();
    const joined = await joinTutor(tutor, 'Alice');
    const pageId = joined.board.activePageId;
    const student = await connect();
    await admit(tutor, student);

    const onTutor = new Promise((resolve) => tutor.once('board:update', resolve));
    const element = makeElement('el-1');
    student.emit('board:update', { pageId, elements: [element] });
    expect(await onTutor).toEqual({ pageId, elements: [element] });

    const permissionUpdate = new Promise((resolve) => student.once('board:permission-update', resolve));
    tutor.emit('board:permission', { studentsCanDraw: false });
    expect(await permissionUpdate).toEqual({ studentsCanDraw: false });

    const blocked = new Promise((resolve) => student.once('room:error', resolve));
    student.emit('board:update', { pageId, elements: [makeElement('el-2')] });
    expect(await blocked).toEqual({ message: 'The tutor has turned off drawing for students.' });
    // The tutor themselves is never subject to the students-only permission gate.
    const onStudent = new Promise((resolve) => student.once('board:update', resolve));
    tutor.emit('board:update', { pageId, elements: [makeElement('el-3')] });
    await onStudent;
  });

  it('a new join and a reconnecting participant both receive the current board snapshot', async () => {
    const tutor = await connect();
    const joined = await joinTutor(tutor, 'Alice');
    const pageId = joined.board.activePageId;
    tutor.emit('board:update', { pageId, elements: [makeElement('el-1')] });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const student = await connectRecoverable();
    const studentJoined = await admit(tutor, student);
    expect(studentJoined.board.elementsByPage[pageId]).toEqual([makeElement('el-1')]);

    const resynced = new Promise<JoinedRoom>((resolve) => student.once('room:joined', resolve));
    const reconnecting = new Promise<void>((resolve) => tutor.once('room:participant-reconnecting', () => resolve()));
    student.io.engine.close();
    await reconnecting;
    tutor.emit('board:update', { pageId, elements: [makeElement('el-2')] });

    await expect.poll(() => student.connected, { timeout: 2000 }).toBe(true);
    const payload = await resynced;
    expect(payload.board.elementsByPage[pageId]).toEqual(
      expect.arrayContaining([makeElement('el-1'), makeElement('el-2')]),
    );
  });

  it('creates, renames, and switches the active whiteboard page', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    const created = new Promise<{ pages: { id: string; name: string; background: string }[]; activePageId: string }>(
      (resolve) => student.once('board:pages-update', resolve),
    );
    tutor.emit('board:page-create');
    const afterCreate = await created;
    expect(afterCreate.pages).toHaveLength(2);
    const newPageId = afterCreate.activePageId;
    expect(newPageId).not.toBe(afterCreate.pages[0].id);

    const renamed = new Promise((resolve) => student.once('board:pages-update', resolve));
    tutor.emit('board:page-rename', { pageId: newPageId, name: 'Warm-up' });
    expect(await renamed).toEqual({
      pages: [expect.objectContaining({ name: 'Board 1' }), { id: newPageId, name: 'Warm-up', background: 'blank' }],
      activePageId: newPageId,
    });

    const firstPageId = afterCreate.pages[0].id;
    const switched = new Promise((resolve) => student.once('board:pages-update', resolve));
    tutor.emit('board:page-switch', { pageId: firstPageId });
    expect(await switched).toMatchObject({ activePageId: firstPageId });
  });

  it('rejects a stale element update (equal or older version/versionNonce) but accepts a newer one', async () => {
    const tutor = await connect();
    const joined = await joinTutor(tutor, 'Alice');
    const pageId = joined.board.activePageId;
    const student = await connect();
    await admit(tutor, student);

    const v2 = makeElement('el-1', { version: 2, versionNonce: 5, x: 10 });
    await new Promise<void>((resolve) => { student.once('board:update', () => resolve()); tutor.emit('board:update', { pageId, elements: [v2] }); });

    // Same version, lower versionNonce — must be rejected, never broadcast.
    const staleEvents: unknown[] = [];
    student.on('board:update', (payload) => staleEvents.push(payload));
    tutor.emit('board:update', { pageId, elements: [makeElement('el-1', { version: 2, versionNonce: 1, x: 99 })] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(staleEvents).toEqual([]);
    expect(server.rooms.get('room-one')?.board.pages[0].elements.get('el-1')).toEqual(v2);

    // A genuinely newer version is accepted.
    const v3 = makeElement('el-1', { version: 3, versionNonce: 1, x: 20 });
    const accepted = new Promise((resolve) => student.once('board:update', resolve));
    tutor.emit('board:update', { pageId, elements: [v3] });
    expect(await accepted).toEqual({ pageId, elements: [v3] });
  });

  it('clears a whiteboard page tutor-only, wiping it for everyone', async () => {
    const tutor = await connect();
    const joined = await joinTutor(tutor, 'Alice');
    const pageId = joined.board.activePageId;
    const student = await connect();
    await admit(tutor, student);
    tutor.emit('board:update', { pageId, elements: [makeElement('el-1')] });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const rejected = new Promise((resolve) => student.once('room:error', resolve));
    student.emit('board:clear', { pageId });
    expect(await rejected).toEqual({ message: 'Only the tutor can clear a whiteboard page.' });
    expect(server.rooms.get('room-one')?.board.pages[0].elements.size).toBe(1);

    const clearedOnStudent = new Promise((resolve) => student.once('board:cleared', resolve));
    tutor.emit('board:clear', { pageId });
    expect(await clearedOnStudent).toEqual({ pageId });
    expect(server.rooms.get('room-one')?.board.pages[0].elements.size).toBe(0);
  });

  it('changes a page background, tutor-only', async () => {
    const tutor = await connect();
    const joined = await joinTutor(tutor, 'Alice');
    const pageId = joined.board.activePageId;
    const student = await connect();
    await admit(tutor, student);

    const updated = new Promise((resolve) => student.once('board:pages-update', resolve));
    tutor.emit('board:background', { pageId, background: 'grid' });
    expect(await updated).toEqual({ pages: [{ id: pageId, name: 'Board 1', background: 'grid' }], activePageId: pageId });
  });

  it("relays a tutor's Follow Me nudge and cursor/laser pointer positions to everyone else, but not back to the sender", async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    const followed = new Promise<void>((resolve) => student.once('board:follow-me', () => resolve()));
    const tutorNeverGetsItsOwn = new Promise((resolve) => { tutor.once('board:follow-me', () => resolve('got-own')); setTimeout(() => resolve('none'), 100); });
    tutor.emit('board:follow-me');
    await followed;
    expect(await tutorNeverGetsItsOwn).toBe('none');

    const cursorSeen = new Promise((resolve) => student.once('board:cursor', resolve));
    tutor.emit('board:cursor', { x: 12, y: 34 });
    expect(await cursorSeen).toEqual({ id: tutor.id, name: 'Alice', x: 12, y: 34 });

    const laserSeen = new Promise((resolve) => student.once('board:laser', resolve));
    tutor.emit('board:laser', { x: 5, y: 6 });
    expect(await laserSeen).toEqual({ id: tutor.id, x: 5, y: 6 });
  });

  it('rejects whiteboard moderation actions from a non-tutor', async () => {
    const tutor = await connect();
    const joined = await joinTutor(tutor, 'Alice');
    const pageId = joined.board.activePageId;
    const student = await connect();
    await admit(tutor, student);

    const actions: Array<() => void> = [
      () => student.emit('board:page-create'),
      () => student.emit('board:page-rename', { pageId, name: 'x' }),
      () => student.emit('board:page-delete', { pageId }),
      () => student.emit('board:page-reorder', { pageIds: [pageId] }),
      () => student.emit('board:page-switch', { pageId }),
      () => student.emit('board:background', { pageId, background: 'grid' }),
      () => student.emit('board:permission', { studentsCanDraw: false }),
      () => student.emit('board:clear', { pageId }),
      () => student.emit('board:follow-me'),
      () => student.emit('board:import', { pageId, elements: [] }),
    ];
    for (const act of actions) {
      const error = new Promise((resolve) => student.once('room:error', resolve));
      act();
      expect(await error).toHaveProperty('message');
    }
  });

  it('deletes a page (falling back to a sensible active page) but refuses to delete the last remaining page', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');

    const created = new Promise<{ pages: { id: string }[]; activePageId: string }>((resolve) => tutor.once('board:pages-update', resolve));
    tutor.emit('board:page-create');
    const { pages, activePageId: secondPageId } = await created;
    const firstPageId = pages[0].id;

    const afterDelete = new Promise<{ pages: unknown[]; activePageId: string }>((resolve) => tutor.once('board:pages-update', resolve));
    tutor.emit('board:page-delete', { pageId: secondPageId });
    expect(await afterDelete).toEqual({ pages: [expect.objectContaining({ id: firstPageId })], activePageId: firstPageId });

    const refused = new Promise((resolve) => tutor.once('room:error', resolve));
    tutor.emit('board:page-delete', { pageId: firstPageId });
    expect(await refused).toEqual({ message: 'A class must always have at least one whiteboard page.' });
  });

  it('imports a whiteboard file, replacing the page outright rather than merging', async () => {
    const tutor = await connect();
    const joined = await joinTutor(tutor, 'Alice');
    const pageId = joined.board.activePageId;
    const student = await connect();
    await admit(tutor, student);
    tutor.emit('board:update', { pageId, elements: [makeElement('old-el')] });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const clearedOnStudent = new Promise((resolve) => student.once('board:cleared', resolve));
    const updateOnStudent = new Promise((resolve) => student.once('board:update', resolve));
    const imported = [makeElement('imported-1'), makeElement('imported-2')];
    tutor.emit('board:import', { pageId, elements: imported });
    await clearedOnStudent;
    expect(await updateOnStudent).toEqual({ pageId, elements: imported });

    const page = server.rooms.get('room-one')?.board.pages.find((candidate) => candidate.id === pageId);
    expect([...page!.elements.keys()].sort()).toEqual(['imported-1', 'imported-2']);
  });

  it('a 4-participant board (1 tutor + 3 students) all converge on the same drawn element', async () => {
    const tutor = await connect();
    const joined = await joinTutor(tutor, 'Alice');
    const pageId = joined.board.activePageId;
    const students = await Promise.all(['Bob', 'Cate', 'Dee'].map(async (name) => {
      const client = await connect();
      await admit(tutor, client, name);
      return client;
    }));

    const element = makeElement('shared-el');
    const receipts = Promise.all(students.map((student) => new Promise((resolve) => student.once('board:update', resolve))));
    tutor.emit('board:update', { pageId, elements: [element] });
    for (const receipt of await receipts) expect(receipt).toEqual({ pageId, elements: [element] });
  });

  it("a brief tutor network drop shows the student 'reconnecting', not an ended class, and recovers cleanly within the grace period", async () => {
    const tutor = await connectRecoverable();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    const reconnecting = new Promise<void>((resolve) => student.once('room:participant-reconnecting', () => resolve()));
    const neverEnded = () => { throw new Error('should not have ended the class for a transient tutor network drop'); };
    student.once('room:ended', neverEnded);
    tutor.io.engine.close();
    await reconnecting;

    const reconnected = new Promise<void>((resolve) => student.once('room:participant-reconnected', () => resolve()));
    await expect.poll(() => tutor.connected, { timeout: 2000 }).toBe(true);
    await reconnected;
    student.off('room:ended', neverEnded);

    // The class is still very much alive: a poll started by the "recovered" tutor still reaches the student.
    const pollOnStudent = new Promise((resolve) => student.once('poll:update', resolve));
    tutor.emit('poll:create', { question: 'Still here?', options: ['Yes', 'No'], anonymous: false, resultsVisible: 'always' });
    await pollOnStudent;
    expect(server.rooms.has('room-one')).toBe(true);
  });

  it('resyncs an active poll, understanding check, and timer — not just settings/mute — to a reconnecting participant', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connectRecoverable();
    await admit(tutor, student);

    tutor.emit('poll:create', { question: 'Ready?', options: ['Yes', 'No'], anonymous: false, resultsVisible: 'always' });
    tutor.emit('understanding:start');
    tutor.emit('timer:start', { mode: 'stopwatch', durationMs: null });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const resynced = new Promise<JoinedRoom>((resolve) => student.once('room:joined', resolve));
    const reconnecting = new Promise<void>((resolve) => tutor.once('room:participant-reconnecting', () => resolve()));
    student.io.engine.close();
    await reconnecting;

    await expect.poll(() => student.connected, { timeout: 2000 }).toBe(true);
    const payload = await resynced;
    expect(payload.poll?.question).toBe('Ready?');
    expect(payload.understandingCheck).not.toBeNull();
    expect(payload.timer?.mode).toBe('stopwatch');
  });

  it('sends a tutor announcement to every participant, tutor-only, and a new one replaces the last', async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const student = await connect();
    await admit(tutor, student);

    const rejected = new Promise((resolve) => student.once('room:error', resolve));
    student.emit('announce:send', { text: 'not allowed' });
    expect(await rejected).toEqual({ message: 'Only the tutor can send an announcement.' });

    const firstOnStudent = new Promise<{ id: string; text: string; sentAt: number } | null>((resolve) => student.once('announce:update', resolve));
    tutor.emit('announce:send', { text: 'You have 5 minutes remaining.' });
    const first = await firstOnStudent;
    expect(first?.text).toBe('You have 5 minutes remaining.');

    const secondOnStudent = new Promise<{ id: string; text: string } | null>((resolve) => student.once('announce:update', resolve));
    tutor.emit('announce:send', { text: 'Open question 4.' });
    const second = await secondOnStudent;
    expect(second?.text).toBe('Open question 4.');
    expect(second?.id).not.toBe(first?.id);
  });

  it("orders raised hands by time raised and clears handRaisedAt on lower — the Help Queue's ordering key", async () => {
    const tutor = await connect();
    await joinTutor(tutor, 'Alice');
    const studentA = await connect();
    await admit(tutor, studentA, 'Bob');
    const studentB = await connect();
    await admit(tutor, studentB, 'Cate');

    studentB.emit('participant:hand', { raised: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    studentA.emit('participant:hand', { raised: true });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const room = server.rooms.get('room-one')!;
    const a = room.participants.get(studentA.id!)!;
    const b = room.participants.get(studentB.id!)!;
    expect(a.handRaisedAt).toBeGreaterThan(b.handRaisedAt!);

    tutor.emit('room:lower-hand', { id: studentB.id! });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(room.participants.get(studentB.id!)!.handRaisedAt).toBeNull();
    expect(room.participants.get(studentA.id!)!.handRaisedAt).not.toBeNull();
  });

  it('never leaks whiteboard updates or cursor/laser positions to a different room', async () => {
    const tutor = await connect();
    const joined = await joinTutor(tutor, 'Alice');
    const pageId = joined.board.activePageId;
    const outsider = await connect();
    await joinTutor(outsider, 'Dara', 'room-two');
    const outsiderSignals: unknown[] = [];
    outsider.onAny((event, payload) => outsiderSignals.push({ event, payload }));

    tutor.emit('board:update', { pageId, elements: [makeElement('el-1')] });
    tutor.emit('board:cursor', { x: 1, y: 2 });
    tutor.emit('board:laser', { x: 3, y: 4 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(outsiderSignals).toEqual([]);
  });

  it('rejects an oversized announcement and a malformed whiteboard update batch rather than crashing', async () => {
    const tutor = await connect();
    const joined = await joinTutor(tutor, 'Alice');
    const pageId = joined.board.activePageId;

    const announceRejected = new Promise((resolve) => tutor.once('room:error', resolve));
    tutor.emit('announce:send', { text: 'x'.repeat(201) });
    expect(await announceRejected).toEqual({ message: 'Announcements must be 1–200 characters.' });

    const boardRejected = new Promise((resolve) => tutor.once('room:error', resolve));
    // Missing version/versionNonce — cast past the wire type since this is deliberately malformed.
    tutor.emit('board:update', { pageId, elements: [{ id: 'el-1' }] } as Parameters<ClientToServerEvents['board:update']>[0]);
    expect(await boardRejected).toEqual({ message: 'Invalid whiteboard update.' });

    const batchRejected = new Promise((resolve) => tutor.once('room:error', resolve));
    tutor.emit('board:update', { pageId, elements: Array.from({ length: 201 }, (_, i) => makeElement(`el-${i}`)) }); // over MAX_BOARD_UPDATE_BATCH
    expect(await batchRejected).toEqual({ message: 'Invalid whiteboard update.' });

    // The room survives all of the above — a subsequent valid update still works.
    const student = await connect();
    await admit(tutor, student);
    const acceptedOnStudent = new Promise((resolve) => student.once('board:update', resolve));
    tutor.emit('board:update', { pageId, elements: [makeElement('el-ok')] });
    expect(await acceptedOnStudent).toEqual({ pageId, elements: [makeElement('el-ok')] });
  });

  it('reports TURN as unconfigured (503) rather than crashing when no Cloudflare credentials are set', async () => {
    const previousKeyId = process.env.CLOUDFLARE_TURN_KEY_ID;
    const previousApiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    delete process.env.CLOUDFLARE_TURN_API_TOKEN;
    try {
      const response = await fetch(`${url}/api/turn-credentials`);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'TURN is not configured on this server.' });
    } finally {
      if (previousKeyId !== undefined) process.env.CLOUDFLARE_TURN_KEY_ID = previousKeyId;
      if (previousApiToken !== undefined) process.env.CLOUDFLARE_TURN_API_TOKEN = previousApiToken;
    }
  });

  it('reports TURN as unavailable (502) with a clean message — never the raw Cloudflare response — when credentials are configured but rejected', async () => {
    const previousKeyId = process.env.CLOUDFLARE_TURN_KEY_ID;
    const previousApiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
    // Deliberately bogus, obviously-fake credentials — a real network call to Cloudflare that we
    // expect it to reject, proving the failure-mapping path end to end rather than just the 503
    // "not configured" shortcut above.
    process.env.CLOUDFLARE_TURN_KEY_ID = 'not-a-real-key-id-0000000000000000';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'not-a-real-api-token-0000000000000000';
    try {
      const response = await fetch(`${url}/api/turn-credentials`);
      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body).toEqual({ error: 'Could not generate temporary TURN credentials.' });
      // The client-visible error must never include Cloudflare's own response body/headers.
      expect(JSON.stringify(body)).not.toMatch(/cloudflare/i);
    } finally {
      if (previousKeyId !== undefined) process.env.CLOUDFLARE_TURN_KEY_ID = previousKeyId; else delete process.env.CLOUDFLARE_TURN_KEY_ID;
      if (previousApiToken !== undefined) process.env.CLOUDFLARE_TURN_API_TOKEN = previousApiToken; else delete process.env.CLOUDFLARE_TURN_API_TOKEN;
    }
  }, 15_000);

  it('rate-limits repeated TURN credential requests from the same client (429) once past the per-minute cap', async () => {
    const previousKeyId = process.env.CLOUDFLARE_TURN_KEY_ID;
    const previousApiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
    // The 503 "not configured" short-circuit runs before the rate limiter, so unconfigured
    // credentials would never exercise it — use (bogus) configured credentials instead, which
    // still reach the rate limiter first on every request per server/signalling.ts's handler order.
    process.env.CLOUDFLARE_TURN_KEY_ID = 'not-a-real-key-id-0000000000000000';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'not-a-real-api-token-0000000000000000';
    try {
      // TURN_RATE_MAX is 20/min in server/signalling.ts; 21 rapid requests from the same client
      // should tip the 21st into 429 — and the 429 check runs before the (real, slower) Cloudflare
      // call, so it stays fast regardless of the bogus credentials above.
      const statuses: number[] = [];
      for (let i = 0; i < 21; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- must be sequential to hit the same rate-limit window deterministically
        const response = await fetch(`${url}/api/turn-credentials`);
        statuses.push(response.status);
      }
      expect(statuses[20]).toBe(429);
      expect(statuses.slice(0, 20).every((status) => status === 502)).toBe(true);
    } finally {
      if (previousKeyId !== undefined) process.env.CLOUDFLARE_TURN_KEY_ID = previousKeyId; else delete process.env.CLOUDFLARE_TURN_KEY_ID;
      if (previousApiToken !== undefined) process.env.CLOUDFLARE_TURN_API_TOKEN = previousApiToken; else delete process.env.CLOUDFLARE_TURN_API_TOKEN;
    }
  }, 60_000);
});
