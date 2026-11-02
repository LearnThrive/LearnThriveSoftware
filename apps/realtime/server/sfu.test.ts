import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents, JoinedRoom, ParticipantRole, ServerToClientEvents, SfuPublication, SfuReply, SfuRequest, SfuTrackInfo,
} from '@learnthrive/shared/protocol';
import { SFU_MAX_STUDENTS } from '@learnthrive/shared/protocol';
import { createSignallingServer } from './signalling';
import {
  createCloudflareSfu, createKeyedQueue, createSfuService, parseCloseBody, parseDescription, parseTracksBody, sfuFromEnv,
  type SfuApi, type SfuResult, type TracksBody,
} from './sfu';

const OFFER = { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' };
const ANSWER = { type: 'answer', sdp: 'v=0\r\n' };
const anyTrack = () => true;
const noTrack = () => false;

describe('parsing what a browser may ask the SFU to do', () => {
  it('publishing needs an offer and valid mids and names, and nothing else gets through', () => {
    const parsed = parseTracksBody({
      sessionDescription: OFFER, autoDiscover: true,
      tracks: [{ location: 'local', mid: '0', trackName: 'audio', simulcast: { preferredRid: 'h' }, bidirectionalMediaStream: true }, { location: 'local', mid: '1', trackName: 'video' }],
    }, noTrack);
    expect(parsed).toEqual({ ok: true, value: { sessionDescription: OFFER, tracks: [{ location: 'local', mid: '0', trackName: 'audio' }, { location: 'local', mid: '1', trackName: 'video' }] } });
    expect(parseTracksBody({ tracks: [{ location: 'local', mid: '0', trackName: 'audio' }] }, noTrack).ok).toBe(false);
    expect(parseTracksBody({ sessionDescription: ANSWER, tracks: [{ location: 'local', mid: '0', trackName: 'audio' }] }, noTrack).ok).toBe(false);
    expect(parseTracksBody({ sessionDescription: OFFER, tracks: [{ location: 'local', mid: '0', trackName: 'bad name!' }] }, noTrack).ok).toBe(false);
    expect(parseTracksBody({ sessionDescription: OFFER, tracks: [{ location: 'local', mid: '0', trackName: 'a' }, { location: 'local', mid: '1', trackName: 'a' }] }, noTrack).ok).toBe(false);
    expect(parseTracksBody({ sessionDescription: OFFER, tracks: Array.from({ length: 9 }, (_, i) => ({ location: 'local', mid: String(i), trackName: `t${i}` })) }, noTrack).ok).toBe(false);
  });

  it('pulling only accepts tracks the room says were published, sends no offer, and cannot mix with publishing', () => {
    const pull = { tracks: [{ location: 'remote', sessionId: 'abcdef123456', trackName: 'video' }] };
    expect(parseTracksBody(pull, anyTrack)).toEqual({ ok: true, value: { tracks: [{ location: 'remote', sessionId: 'abcdef123456', trackName: 'video' }] } });
    expect(parseTracksBody(pull, noTrack)).toMatchObject({ ok: false, error: expect.stringContaining('not available') });
    expect(parseTracksBody({ ...pull, sessionDescription: OFFER }, anyTrack).ok).toBe(false);
    expect(parseTracksBody({ tracks: [...pull.tracks, { location: 'local', mid: '0', trackName: 'audio' }] }, anyTrack).ok).toBe(false);
    expect(parseTracksBody({ tracks: [{ location: 'remote', sessionId: '../x', trackName: 'video' }] }, anyTrack).ok).toBe(false);
    expect(parseTracksBody({ tracks: [] }, anyTrack).ok).toBe(false);
  });

  it('closing and answers are checked too', () => {
    expect(parseCloseBody({ tracks: [{ mid: '2' }], force: true, extra: 1 })).toEqual({ ok: true, value: { tracks: [{ mid: '2' }], force: true } });
    expect(parseCloseBody({ tracks: [{ mid: '2' }], force: false }).ok).toBe(false);
    expect(parseCloseBody({ tracks: [{ mid: '2' }], force: false, sessionDescription: OFFER }).ok).toBe(true);
    expect(parseCloseBody({ tracks: [], force: true }).ok).toBe(false);
    expect(parseDescription({ type: 'answer', sdp: '' })).toBeNull();
    expect(parseDescription({ type: 'answer', sdp: 'x'.repeat(70_000) })).toBeNull();
    expect(parseDescription(OFFER, 'answer')).toBeNull();
  });
});

describe('the Cloudflare SFU client', () => {
  function fakeFetch(reply: (url: string, init: RequestInit) => { status: number; body: unknown }) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const { status, body } = reply(url, init);
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { calls, impl };
  }

  it('calls the documented endpoints with the secret in the Authorization header only', async () => {
    const { calls, impl } = fakeFetch((url) => (url.endsWith('/sessions/new')
      ? { status: 201, body: { sessionId: 'sess-abcdef123456' } }
      : { status: 200, body: { requiresImmediateRenegotiation: true, sessionDescription: OFFER, tracks: [{ mid: '0', trackName: 'audio', secretField: 'x' }], leak: 'no' } }));
    const api = createCloudflareSfu({ appId: 'app123', appSecret: 'shh-secret', fetchImpl: impl });
    expect(await api.newSession()).toEqual({ sessionId: 'sess-abcdef123456' });
    const body: TracksBody = { tracks: [{ location: 'remote', sessionId: 'other-abcdef12', trackName: 'audio' }] };
    const result = await api.tracks('sess-abcdef123456', body);
    await api.renegotiate('sess-abcdef123456', { type: 'answer', sdp: 'v=0\r\n' });
    await api.close('sess-abcdef123456', { tracks: [{ mid: '0' }], force: true });

    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      'POST https://rtc.live.cloudflare.com/v1/apps/app123/sessions/new',
      'POST https://rtc.live.cloudflare.com/v1/apps/app123/sessions/sess-abcdef123456/tracks/new',
      'PUT https://rtc.live.cloudflare.com/v1/apps/app123/sessions/sess-abcdef123456/renegotiate',
      'PUT https://rtc.live.cloudflare.com/v1/apps/app123/sessions/sess-abcdef123456/tracks/close',
    ]);
    for (const call of calls) {
      expect((call.init.headers as Record<string, string>).Authorization).toBe('Bearer shh-secret');
      expect(String(call.init.body ?? '')).not.toContain('shh-secret');
    }
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ sessionDescription: { type: 'answer', sdp: 'v=0\r\n' } });
    expect(result).toEqual({ requiresImmediateRenegotiation: true, sessionDescription: OFFER, tracks: [{ mid: '0', trackName: 'audio' }] });
  });

  it('a failure names Cloudflare\'s status and code, never the secret or the request', async () => {
    const { impl } = fakeFetch(() => ({ status: 406, body: { errorCode: 'conflict', errorDescription: 'x' } }));
    const api = createCloudflareSfu({ appId: 'app123', appSecret: 'shh-secret', fetchImpl: impl });
    const failure = await api.newSession().then(() => new Error('it did not fail'), (error: Error) => error);
    expect(failure.message).toBe('Cloudflare SFU answered 406 conflict');
    expect(failure.message).not.toContain('shh-secret');
  });

  it('is off unless both the app id and the secret are set', () => {
    expect(sfuFromEnv({})).toBeNull();
    expect(sfuFromEnv({ CLOUDFLARE_SFU_APP_ID: 'a' })).toBeNull();
    expect(sfuFromEnv({ CLOUDFLARE_SFU_APP_ID: 'a', CLOUDFLARE_SFU_APP_SECRET: ' ' })).toBeNull();
    expect(sfuFromEnv({ CLOUDFLARE_SFU_APP_ID: 'a', CLOUDFLARE_SFU_APP_SECRET: 'b' })).not.toBeNull();
  });
});

describe('one session is changed one call at a time', () => {
  it('runs a key\'s tasks in order, different keys together, and keeps going after a failure', async () => {
    const queue = createKeyedQueue();
    const order: string[] = [];
    const slow = (name: string, ms: number, fail = false) => () => new Promise<string>((resolve, reject) => {
      order.push(`start ${name}`);
      setTimeout(() => {
        order.push(`end ${name}`);
        if (fail) reject(new Error(name));
        else resolve(name);
      }, ms);
    });
    const results = await Promise.allSettled([queue.run('a', slow('a1', 30)), queue.run('a', slow('a2', 1, true)), queue.run('a', slow('a3', 1)), queue.run('b', slow('b1', 5))]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
    expect(order.indexOf('end a1')).toBeLessThan(order.indexOf('start a2'));
    expect(order.indexOf('end a2')).toBeLessThan(order.indexOf('start a3'));
    expect(order.indexOf('start b1')).toBeLessThan(order.indexOf('end a1'));
  });
});

function fakeSfu() {
  let sessions = 0;
  const calls: string[] = [];
  const api: SfuApi = {
    async newSession() { sessions += 1; calls.push('session'); return { sessionId: `session-${String(sessions).padStart(8, '0')}` }; },
    async tracks(sessionId, body) {
      const remote = body.tracks[0]?.location === 'remote';
      calls.push(`tracks ${sessionId} ${remote ? 'pull' : 'push'}`);
      const result: SfuResult = {
        requiresImmediateRenegotiation: remote,
        sessionDescription: remote ? { type: 'offer', sdp: 'v=0\r\n' } : { type: 'answer', sdp: 'v=0\r\n' },
        tracks: body.tracks.map((track, index) => ({ mid: String(index), trackName: track.trackName })),
      };
      return result;
    },
    async renegotiate(sessionId) { calls.push(`renegotiate ${sessionId}`); return { requiresImmediateRenegotiation: false, tracks: [] }; },
    async close(sessionId) { calls.push(`close ${sessionId}`); return { requiresImmediateRenegotiation: false, tracks: [] }; },
  };
  return { api, calls };
}

describe('the SFU service', () => {
  it('only lets the socket that created a session use it, and rate limits a socket', async () => {
    const { api } = fakeSfu();
    const service = createSfuService(api);
    const created = await service.handle('socket-a', { op: 'session.new' }, noTrack);
    expect(created).toEqual({ ok: true, data: { sessionId: 'session-00000001' } });
    const push = { op: 'tracks.new', sessionId: 'session-00000001', body: { sessionDescription: OFFER, tracks: [{ location: 'local', mid: '0', trackName: 'audio' }] } };
    expect((await service.handle('socket-a', push, noTrack)).ok).toBe(true);
    expect(await service.handle('socket-b', push, noTrack)).toEqual({ ok: false, error: 'That media session is not yours.' });
    expect((await service.handle('socket-a', { op: 'renegotiate', sessionId: 'session-00000001', body: { sessionDescription: OFFER } }, noTrack)).ok).toBe(false);
    service.release('socket-a');
    expect((await service.handle('socket-a', push, noTrack)).ok).toBe(false);

    const limited = createSfuService(api);
    const replies: SfuReply[] = [];
    for (let i = 0; i < 45; i += 1) replies.push(await limited.handle('busy', { op: 'nothing' }, noTrack));
    expect(replies.filter((reply) => !reply.ok && reply.error.includes('Too many')).length).toBe(5);
  });

  it('refuses a malformed request without calling Cloudflare, and reports a Cloudflare failure without detail', async () => {
    const { api, calls } = fakeSfu();
    const failing: SfuApi = { ...api, async tracks() { throw new Error('Cloudflare SFU answered 500'); } };
    const service = createSfuService(failing);
    await service.handle('s', { op: 'session.new' }, noTrack);
    expect((await service.handle('s', 'nonsense', noTrack)).ok).toBe(false);
    expect((await service.handle('s', { op: 'tracks.new', sessionId: 'session-00000001', body: {} }, noTrack)).ok).toBe(false);
    const quiet = console.error;
    console.error = () => undefined;
    const reply = await service.handle('s', { op: 'tracks.new', sessionId: 'session-00000001', body: { sessionDescription: OFFER, tracks: [{ location: 'local', mid: '0', trackName: 'audio' }] } }, noTrack);
    console.error = quiet;
    expect(reply).toEqual({ ok: false, error: 'The media service could not complete that request.' });
    expect(calls).toEqual(['session']);
  });
});

describe('an SFU room through real Socket.IO clients', () => {
  type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
  let server: ReturnType<typeof createSignallingServer>;
  let url: string;
  let clients: Client[];
  let sfu: ReturnType<typeof fakeSfu>;
  const media = { audio: true, video: true };

  async function start(options: Parameters<typeof createSignallingServer>[0]) {
    server = createSignallingServer({ disconnectGraceMs: 300, ...options });
    server.httpServer.listen(0, '127.0.0.1');
    await once(server.httpServer, 'listening');
    url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  }

  beforeEach(() => { clients = []; sfu = fakeSfu(); });
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

  async function joinTutor(client: Client) {
    const joined = new Promise<JoinedRoom>((resolve) => client.once('room:joined', resolve));
    client.emit('room:join', { roomId: 'room-sfu-1', name: 'Tutor', media, role: 'tutor' as ParticipantRole });
    return joined;
  }

  async function admit(tutor: Client, student: Client, name: string) {
    const waiting = new Promise<void>((resolve) => student.once('room:waiting', () => resolve()));
    student.emit('room:join', { roomId: 'room-sfu-1', name, media, role: 'student' });
    await waiting;
    const joined = new Promise<JoinedRoom>((resolve, reject) => { student.once('room:joined', resolve); setTimeout(() => reject(new Error('not admitted')), 1500); });
    tutor.emit('room:admit', { id: student.id! });
    return joined;
  }

  const request = (client: Client, payload: SfuRequest) => new Promise<SfuReply>((resolve) => client.emit('sfu:request', payload, resolve));
  const publish = (client: Client, sessionId: string, tracks: SfuTrackInfo[]) => new Promise<SfuReply>((resolve) => client.emit('sfu:publish', { sessionId, tracks }, resolve));
  async function publishCameraAndMic(client: Client) {
    const created = await request(client, { op: 'session.new' });
    if (!created.ok) throw new Error('no session');
    const sessionId = created.data.sessionId as string;
    const pushed = await request(client, { op: 'tracks.new', sessionId, body: { sessionDescription: OFFER, tracks: [{ location: 'local', mid: '0', trackName: 'audio' }, { location: 'local', mid: '1', trackName: 'video' }] } });
    expect(pushed.ok).toBe(true);
    const published = await publish(client, sessionId, [{ trackName: 'audio', kind: 'audio' }, { trackName: 'video', kind: 'video' }]);
    expect(published.ok).toBe(true);
    return sessionId;
  }

  it('tells every client the room is an SFU room with room for ten students', async () => {
    await start({ sfu: sfu.api });
    const tutor = await connect();
    const joined = await joinTutor(tutor);
    expect(joined.media).toEqual({ mode: 'sfu', maxStudents: SFU_MAX_STUDENTS });
    expect(joined.peers).toEqual([]);
  });

  it('holds a tutor and ten students and refuses an eleventh at admission', async () => {
    await start({ sfu: sfu.api });
    const tutor = await connect();
    await joinTutor(tutor);
    for (let i = 1; i <= SFU_MAX_STUDENTS; i += 1) {
      const joined = await admit(tutor, await connect(), `Student ${i}`);
      expect(joined.peers.length).toBe(i);
    }
    const extra = await connect();
    const waiting = new Promise<void>((resolve) => extra.once('room:waiting', () => resolve()));
    extra.emit('room:join', { roomId: 'room-sfu-1', name: 'Eleven', media, role: 'student' });
    await waiting;
    const result = new Promise<{ admitted: number }>((resolve) => tutor.once('room:admit-result', resolve));
    tutor.emit('room:admit', { id: extra.id! });
    expect((await result).admitted).toBe(0);
  }, 20_000);

  it('a mesh server keeps the old limit and refuses SFU calls', async () => {
    await start({ sfu: null });
    const tutor = await connect();
    const joined = await joinTutor(tutor);
    expect(joined.media).toEqual({ mode: 'mesh', maxStudents: 3 });
    expect(await request(tutor, { op: 'session.new' })).toEqual({ ok: false, error: 'Media is not available in this class.' });
  });

  it('publishes, lists and unlists tracks, and only lets a participant pull what someone else in the room published', async () => {
    await start({ sfu: sfu.api });
    const tutor = await connect();
    await joinTutor(tutor);
    const tutorSession = await publishCameraAndMic(tutor);

    const student = await connect();
    const lateJoin = new Promise<SfuPublication[]>((resolve) => student.once('sfu:publications', (payload) => resolve(payload.publications)));
    await admit(tutor, student, 'Sam');
    expect(await lateJoin).toEqual([{ participantId: tutor.id, sessionId: tutorSession, tracks: [{ trackName: 'audio', kind: 'audio' }, { trackName: 'video', kind: 'video' }] }]);

    const studentSession = (await request(student, { op: 'session.new' }));
    if (!studentSession.ok) throw new Error('no session');
    const mine = studentSession.data.sessionId as string;
    const pull = (sessionId: string, trackName: string) => request(student, { op: 'tracks.new', sessionId: mine, body: { tracks: [{ location: 'remote', sessionId, trackName }] } });
    const pulled = await pull(tutorSession, 'video');
    expect(pulled).toMatchObject({ ok: true, data: { requiresImmediateRenegotiation: true } });
    expect((await pull(tutorSession, 'screen')).ok).toBe(false);
    expect((await pull('session-99999999', 'video')).ok).toBe(false);
    expect(await request(student, { op: 'tracks.new', sessionId: tutorSession, body: { tracks: [{ location: 'remote', sessionId: tutorSession, trackName: 'video' }] } })).toEqual({ ok: false, error: 'That media session is not yours.' });

    const announced = new Promise<SfuPublication>((resolve) => tutor.once('sfu:published', resolve));
    await publishCameraAndMic(student);
    expect((await announced).participantId).toBe(student.id);
    expect((await publish(student, tutorSession, [{ trackName: 'audio', kind: 'audio' }])).ok).toBe(false);

    const gone = new Promise<{ participantId: string }>((resolve) => tutor.once('sfu:unpublished', resolve));
    const left = new Promise<{ id: string }>((resolve) => tutor.once('room:participant-left', resolve));
    const studentId = student.id;
    student.emit('room:leave', () => undefined);
    expect(await gone).toEqual({ participantId: studentId });
    expect((await left).id).toBe(studentId);
  });

  it('refuses SFU calls from a socket that has not been admitted', async () => {
    await start({ sfu: sfu.api });
    const tutor = await connect();
    await joinTutor(tutor);
    const outsider = await connect();
    expect(await request(outsider, { op: 'session.new' })).toEqual({ ok: false, error: 'Media is not available in this class.' });
    const waiting = await connect();
    const parked = new Promise<void>((resolve) => waiting.once('room:waiting', () => resolve()));
    waiting.emit('room:join', { roomId: 'room-sfu-1', name: 'Waiting', media, role: 'student' });
    await parked;
    expect((await request(waiting, { op: 'session.new' })).ok).toBe(false);
    expect(sfu.calls).toEqual([]);
  });
});
