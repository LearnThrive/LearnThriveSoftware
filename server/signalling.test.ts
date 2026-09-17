import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type {
  ChatMessage, ClientToServerEvents, JoinedRoom, Participant, ParticipantRole, ServerToClientEvents, WaitingParticipant,
} from '../shared/protocol';
import { createSignallingServer } from './signalling';

const DISCONNECT_GRACE_MS = 300;

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
const media = { audio: true, video: true };

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
    expect(tutorEvents[0]).toEqual({
      roomId: 'room-one', self: { id: tutor.id, name: 'Alice', media, screenSharing: false, handRaised: false, role: 'tutor' },
      peers: [], waiting: [],
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
    expect(admitted.self).toEqual({ id: student.id, name: 'Bob', media, screenSharing: false, handRaised: false, role: 'student' });
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

    const remaining = new Promise<void>((resolve) => third.once('room:participant-left', () => resolve()));
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
});
