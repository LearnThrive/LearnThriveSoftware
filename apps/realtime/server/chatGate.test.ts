import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { ChatMessage, ClientToServerEvents, JoinedRoom, ServerToClientEvents } from '@learnthrive/shared/protocol';
import { SERVICE_SIGNATURE_HEADER, SERVICE_TIMESTAMP_HEADER, signClassroomJoinToken, verifyServiceRequest } from '@learnthrive/shared/classroomToken';
import { chatGateFromEnv, type ChatGate, type ChatGateRequest, type ChatGateResult } from './chatGate';
import { createSignallingServer } from './signalling';

// The lesson chat's gate (docs/LESSON_CHAT.md): the classroom server asks apps/web before anything reaches the room.

describe('chatGateFromEnv', () => {
  it('is off when CLASSROOM_WEB_URL is not set, and refuses an address that is not https (localhost excepted)', () => {
    expect(chatGateFromEnv({})).toBeNull();
    expect(chatGateFromEnv({ CLASSROOM_WEB_URL: '   ' })).toBeNull();
    expect(() => chatGateFromEnv({ CLASSROOM_WEB_URL: 'http://example.com' })).toThrow(/https/);
    expect(() => chatGateFromEnv({ CLASSROOM_WEB_URL: 'not a url' })).toThrow(/address/);
    expect(chatGateFromEnv({ CLASSROOM_WEB_URL: 'http://localhost:3000' })).not.toBeNull();
    expect(chatGateFromEnv({ CLASSROOM_WEB_URL: 'https://www.example.com' })).not.toBeNull();
  });

  it('posts the lesson, the account and the text to the web app, signed over that exact body', async () => {
    let seen: { url: string; headers: Record<string, string>; body: string } | null = null;
    const gate = chatGateFromEnv({ CLASSROOM_WEB_URL: 'https://www.example.com' }, (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, body: String(init.body) };
      return new Response(JSON.stringify({ ok: true, message: { id: 'm1', name: 'Tutor', text: 'hi', createdAt: '2026-11-16T16:10:00.000Z' } }), { status: 200 });
    }) as unknown as typeof fetch)!;
    const result = await gate.send({ lessonId: 'lesson-1', userId: 'acct-1', text: 'hi' });
    expect(result).toEqual({ ok: true, message: { id: 'm1', name: 'Tutor', text: 'hi', createdAt: '2026-11-16T16:10:00.000Z' } });
    expect(seen!.url).toBe('https://www.example.com/api/internal/lesson-chat');
    expect(JSON.parse(seen!.body)).toEqual({ lessonId: 'lesson-1', userId: 'acct-1', text: 'hi' });
    // The web app can verify it, and a changed body or a stale time fails.
    const ts = seen!.headers[SERVICE_TIMESTAMP_HEADER]!;
    const sig = seen!.headers[SERVICE_SIGNATURE_HEADER]!;
    expect(verifyServiceRequest(seen!.body, ts, sig)).toBe(true);
    expect(verifyServiceRequest(seen!.body.replace('hi', 'ho'), ts, sig)).toBe(false);
    expect(verifyServiceRequest(seen!.body, ts, sig, Number(ts) + 120_000)).toBe(false);
    expect(verifyServiceRequest(seen!.body, ts, 'x'.repeat(sig.length))).toBe(false);
    expect(verifyServiceRequest(seen!.body, 'nope', sig)).toBe(false);
  });

  it("passes on the web app's own refusal, hides a server failure's detail, and never throws", async () => {
    const reply = (status: number, body: unknown) => chatGateFromEnv({ CLASSROOM_WEB_URL: 'http://localhost:3000' }, (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch)!;
    expect(await reply(403, { ok: false, error: 'Messages can only be sent once the lesson has started.' }).send({ lessonId: 'l', userId: 'u', text: 't' })).toEqual({ ok: false, message: 'Messages can only be sent once the lesson has started.' });
    const failed = await reply(500, { error: 'stack trace with a database password' }).send({ lessonId: 'l', userId: 'u', text: 't' });
    expect(failed).toEqual({ ok: false, message: 'The lesson chat is not available right now. Please try again.' });
    expect(await reply(200, { ok: true, message: { id: 5 } }).send({ lessonId: 'l', userId: 'u', text: 't' })).toMatchObject({ ok: false });
    const down = chatGateFromEnv({ CLASSROOM_WEB_URL: 'http://localhost:3000' }, (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch)!;
    expect(await down.send({ lessonId: 'l', userId: 'u', text: 't' })).toMatchObject({ ok: false });
  });
});

describe('chat through real Socket.IO clients, with the gate', () => {
  type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
  const media = { audio: true, video: true };
  let server: ReturnType<typeof createSignallingServer>;
  let url: string;
  let clients: Client[];
  let calls: ChatGateRequest[];
  let answer: (request: ChatGateRequest) => Promise<ChatGateResult>;
  const gate: ChatGate = { send: (request) => { calls.push(request); return answer(request); } };

  async function start(options: Parameters<typeof createSignallingServer>[0]) {
    server = createSignallingServer({ disconnectGraceMs: 300, ...options });
    server.httpServer.listen(0, '127.0.0.1');
    await once(server.httpServer, 'listening');
    url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  }

  beforeEach(() => {
    clients = [];
    calls = [];
    answer = async (request) => ({ ok: true, message: { id: 'stored-1', name: 'Stored Name', text: request.text, createdAt: '2026-11-16T16:10:00.000Z' } });
  });
  afterEach(async () => {
    clients.forEach((client) => client.disconnect());
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  });

  async function connect(): Promise<Client> {
    const client: Client = io(url, { transports: ['websocket'], reconnection: false });
    clients.push(client);
    await new Promise<void>((resolve, reject) => { client.once('connect', () => resolve()); client.once('connect_error', reject); });
    return client;
  }
  const token = (over: { role: 'tutor' | 'student'; name: string; uid?: string | null; lessonId?: string }) =>
    signClassroomJoinToken({ roomId: 'room-one', lessonId: over.lessonId ?? 'lesson-1', name: over.name, role: over.role, exp: Date.now() + 60_000, ...(over.uid === null ? {} : { uid: over.uid ?? `acct-${over.name}` }) });

  async function tutorIn(over: Partial<Parameters<typeof token>[0]> = {}) {
    const tutor = await connect();
    const joined = new Promise<JoinedRoom>((resolve) => tutor.once('room:joined', resolve));
    tutor.emit('room:join', { roomId: 'room-one', name: 'x', role: 'student', media, token: token({ role: 'tutor', name: 'Tutor', ...over }) });
    await joined;
    return tutor;
  }
  async function studentIn(tutor: Client, over: Partial<Parameters<typeof token>[0]> = {}) {
    const student = await connect();
    const waiting = new Promise((resolve) => student.once('room:waiting', resolve));
    student.emit('room:join', { roomId: 'room-one', name: 'x', role: 'tutor', media, token: token({ role: 'student', name: 'Student', ...over }) });
    await waiting;
    const joined = new Promise<JoinedRoom>((resolve) => student.once('room:joined', resolve));
    tutor.emit('room:admit', { id: student.id! });
    await joined;
    return student;
  }
  const errorOf = (client: Client) => new Promise<string>((resolve) => client.once('room:error', (e) => resolve(e.message)));
  const nothingWithin = async (client: Client, ms = 250) => {
    let got = false;
    client.once('chat:message', () => { got = true; });
    await new Promise((resolve) => setTimeout(resolve, ms));
    return !got;
  };

  it('a message is sent only after the gate says yes, using the lesson and account from the VERIFIED token, and what the gate stored is what the room sees', async () => {
    await start({ chatGate: gate });
    const tutor = await tutorIn();
    const student = await studentIn(tutor);
    const seen = new Promise<ChatMessage>((resolve) => student.once('chat:message', resolve));
    // The client names a different lesson and person in the payload: neither is used.
    (tutor as unknown as Socket).emit('chat:message', { text: '  Photograph question 3  ', lessonId: 'lesson-OTHER', userId: 'acct-someone-else', role: 'admin' });
    const message = await seen;
    expect(calls).toEqual([{ lessonId: 'lesson-1', userId: 'acct-Tutor', text: 'Photograph question 3' }]);
    expect(message).toMatchObject({ id: 'stored-1', senderId: tutor.id, name: 'Stored Name', text: 'Photograph question 3', timestamp: Date.parse('2026-11-16T16:10:00.000Z') });
  });

  it("the gate's refusal reaches only the sender, with its reason, and nothing is relayed (too early, too late, cancelled, not in this lesson)", async () => {
    await start({ chatGate: gate });
    const tutor = await tutorIn();
    const student = await studentIn(tutor);
    const reasons = ['Messages can only be sent once the lesson has started.', 'The lesson has ended, so messages can no longer be sent.', 'This lesson was cancelled, so there is no chat.', 'You are not part of this lesson, so you cannot message in it.'];
    for (const reason of reasons) {
      answer = async () => ({ ok: false, message: reason });
      const refused = errorOf(student);
      const silent = nothingWithin(tutor);
      student.emit('chat:message', { text: 'hello' });
      expect(await refused).toBe(reason);
      expect(await silent).toBe(true);
    }
    expect(calls.length).toBe(reasons.length);
  });

  it('a gate that fails or throws is a refusal, never a message', async () => {
    await start({ chatGate: gate });
    const tutor = await tutorIn();
    const student = await studentIn(tutor);
    answer = async () => { throw new Error('boom'); };
    // A throwing gate is the gate's bug, but the room must still hear nothing and the sender is told.
    const refused = errorOf(student);
    const silent = nothingWithin(tutor);
    student.emit('chat:message', { text: 'hello' });
    expect(await refused).toMatch(/not available|try again/i);
    expect(await silent).toBe(true);
  });

  it('only a socket that joined through a lesson link can chat: a manual join, and a token with no account, are refused without asking the gate', async () => {
    await start({ chatGate: gate });
    const tutor = await tutorIn();
    const manual = await connect();
    const waiting = new Promise((resolve) => manual.once('room:waiting', resolve));
    manual.emit('room:join', { roomId: 'room-one', name: 'Walk-in', role: 'student', media });
    await waiting;
    const admitted = new Promise<JoinedRoom>((resolve) => manual.once('room:joined', resolve));
    tutor.emit('room:admit', { id: manual.id! });
    await admitted;
    const refused = errorOf(manual);
    manual.emit('chat:message', { text: 'hi' });
    expect(await refused).toMatch(/only available in a lesson/i);

    const noUid = await studentIn(tutor, { uid: null, name: 'Old Token' });
    const refusedToo = errorOf(noUid);
    noUid.emit('chat:message', { text: 'hi' });
    expect(await refusedToo).toMatch(/only available in a lesson/i);
    expect(calls).toEqual([]);
  });

  it('nobody edits or deletes a message: delete and clear are refused for the tutor too, and relay nothing', async () => {
    await start({ chatGate: gate });
    const tutor = await tutorIn();
    const student = await studentIn(tutor);
    const silent = nothingWithin(student);
    let deleted = false;
    let cleared = false;
    (student as unknown as Socket).on('chat:message-deleted', () => { deleted = true; });
    (student as unknown as Socket).on('chat:cleared', () => { cleared = true; });
    const first = errorOf(tutor);
    tutor.emit('chat:delete', { id: 'any' });
    expect(await first).toMatch(/cannot be deleted/);
    const second = errorOf(tutor);
    tutor.emit('chat:clear');
    expect(await second).toMatch(/cannot be cleared/);
    expect(await silent).toBe(true);
    expect(deleted || cleared).toBe(false);
    // A student cannot either.
    const third = errorOf(student);
    student.emit('chat:delete', { id: 'any' });
    expect(await third).toMatch(/cannot be deleted/);
  });

  it('the tutor can still turn chat off for students, and that is checked before the gate', async () => {
    await start({ chatGate: gate });
    const tutor = await tutorIn();
    const student = await studentIn(tutor);
    tutor.emit('room:settings', { studentsCanChat: false });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const refused = errorOf(student);
    student.emit('chat:message', { text: 'hello' });
    expect(await refused).toMatch(/turned off chat/);
    expect(calls).toEqual([]);
  });

  it('with no gate, production allows no chat at all, and development keeps the unsaved relay for trying the classroom alone', async () => {
    const before = process.env.NODE_ENV;
    const manualTutor = async () => {
      const tutor = await connect();
      const joined = new Promise<JoinedRoom>((resolve) => tutor.once('room:joined', resolve));
      tutor.emit('room:join', { roomId: 'room-one', name: 'Alice', role: 'tutor', media });
      await joined;
      return tutor;
    };
    try {
      process.env.NODE_ENV = 'production';
      await start({ chatGate: null });
      const tutor = await manualTutor();
      const refused = errorOf(tutor);
      tutor.emit('chat:message', { text: 'hi' });
      expect(await refused).toMatch(/not available/);
      clients.forEach((client) => client.disconnect());
      clients = [];
      await new Promise<void>((resolve) => server.io.close(() => resolve()));

      process.env.NODE_ENV = 'test';
      await start({ chatGate: null });
      const dev = await manualTutor();
      const echoed = new Promise<ChatMessage>((resolve) => dev.once('chat:message', resolve));
      dev.emit('chat:message', { text: 'hi' });
      expect((await echoed).text).toBe('hi');
    } finally {
      process.env.NODE_ENV = before;
    }
  });
});
