import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type { ChatMessage, ClientToServerEvents, JoinedRoom, Participant, ServerToClientEvents } from '../shared/protocol';
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

  async function join(client: Client, name: string, roomId = 'room-one') {
    const result = new Promise<JoinedRoom>((resolve) => client.once('room:joined', resolve));
    client.emit('room:join', { roomId, name, media });
    return result;
  }

  it('admits the first participant as waiting, pairs the second, and rejects a third', async () => {
    const first = await connect();
    const firstEvents: JoinedRoom[] = [];
    first.on('room:joined', (payload) => firstEvents.push(payload));
    first.emit('room:join', { roomId: 'room-one', name: '  Alice  ', media });
    await expect.poll(() => firstEvents.length, { timeout: 500 }).toBe(1);
    expect(firstEvents[0]).toEqual({
      roomId: 'room-one', self: { id: first.id, name: 'Alice', media, screenSharing: false },
      peer: null, sessionId: null, initiator: false,
    });

    const peerEvent = new Promise<Parameters<ServerToClientEvents['room:participant-joined']>[0]>(
      (resolve) => first.once('room:participant-joined', resolve),
    );
    const second = await connect();
    const paired = await join(second, 'Bob');
    const announced = await peerEvent;
    expect(paired.peer?.id).toBe(first.id);
    expect(paired.initiator).toBe(false);
    expect(paired.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(announced).toEqual({
      peer: { id: second.id, name: 'Bob', media, screenSharing: false },
      sessionId: paired.sessionId, initiator: true,
    });

    const third = await connect();
    const full = new Promise<Parameters<ServerToClientEvents['room:full']>[0]>(
      (resolve) => third.once('room:full', resolve),
    );
    third.emit('room:join', { roomId: 'room-one', name: 'Charlie', media });
    expect(await full).toEqual({ message: 'This meeting already has two participants.' });
    expect(server.rooms.size).toBe(1);
  });

  it('makes a duplicate join idempotent and requires leaving before changing rooms', async () => {
    const first = await connect();
    await join(first, 'Alice');
    const second = await connect();
    const paired = await join(second, 'Bob');
    const announcements: unknown[] = [];
    second.on('room:participant-joined', (payload) => announcements.push(payload));
    const duplicate = await join(first, 'Different name');
    expect(duplicate.self.name).toBe('Alice');
    expect(duplicate.sessionId).toBe(paired.sessionId);
    expect(duplicate.initiator).toBe(true);
    const error = new Promise((resolve) => first.once('room:error', resolve));
    first.emit('room:join', { roomId: 'room-two', name: 'Alice', media });
    await error;
    expect(server.rooms.size).toBe(1);
    expect(announcements).toEqual([]);
  });

  it('cleans up departure, gives a replacement a new session, and deletes empty rooms', async () => {
    const first = await connect();
    await join(first, 'Alice');
    const second = await connect();
    const original = await join(second, 'Bob');
    const left = new Promise<void>((resolve) => first.once('room:participant-left', resolve));
    second.disconnect();
    await left;
    const third = await connect();
    const replacement = await join(third, 'Charlie');
    expect(replacement.peer?.id).toBe(first.id);
    expect(replacement.sessionId).not.toBe(original.sessionId);
    const staleError = new Promise((resolve) => first.once('room:error', resolve));
    first.emit('webrtc:offer', { sessionId: original.sessionId!, description: { type: 'offer', sdp: 'v=0\r\n' } });
    await staleError;
    const remaining = new Promise<void>((resolve) => third.once('room:participant-left', resolve));
    first.emit('room:leave', () => {});
    await remaining;
    third.emit('room:leave', () => {});
    await expect.poll(() => server.rooms.size).toBe(0);
  });

  it('announces a participant as reconnecting before the grace period elapses, then leaving if they do not return', async () => {
    const first = await connect();
    await join(first, 'Alice');
    const second = await connect();
    await join(second, 'Bob');
    const reconnecting = new Promise<void>((resolve) => first.once('room:participant-reconnecting', resolve));
    const left = new Promise<void>((resolve) => first.once('room:participant-left', resolve));
    second.disconnect();
    await reconnecting;
    await left;
  });

  it('recovers a briefly dropped connection without losing the pairing or notifying a departure', async () => {
    const first = await connect();
    await join(first, 'Alice');
    const second = await connectRecoverable();
    const original = await join(second, 'Bob');
    const secondId = second.id;
    const reconnecting = new Promise<void>((resolve) => first.once('room:participant-reconnecting', resolve));
    const reconnected = new Promise<Participant>((resolve) => first.once('room:participant-reconnected', resolve));
    const left = () => { throw new Error('should not have announced a departure for a recovered connection'); };
    first.once('room:participant-left', left);
    second.io.engine.close();
    await reconnecting;
    await reconnected;
    expect(second.connected).toBe(true);
    expect(second.id).toBe(secondId);
    expect(second.recovered).toBe(true);
    const candidate = new Promise((resolve) => second.once('webrtc:ice-candidate', resolve));
    first.emit('webrtc:ice-candidate', {
      sessionId: original.sessionId!,
      candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host' },
    });
    await candidate;
    first.off('room:participant-left', left);
  });

  it('lets a newcomer take a stale disconnected slot immediately instead of waiting out the grace period', async () => {
    const first = await connect();
    await join(first, 'Alice');
    const second = await connect();
    await join(second, 'Bob');
    const reconnecting = new Promise<void>((resolve) => first.once('room:participant-reconnecting', resolve));
    second.disconnect();
    await reconnecting;
    const third = await connect();
    const replacement = await join(third, 'Charlie');
    expect(replacement.peer?.id).toBe(first.id);
    expect(server.rooms.get('room-one')?.participants.size).toBe(2);
  });

  it('relays offers, answers, ICE, and media only to the paired participant', async () => {
    const first = await connect();
    await join(first, 'Alice');
    const second = await connect();
    const paired = await join(second, 'Bob');
    const unrelated = await connect();
    await join(unrelated, 'Dara', 'room-two');
    const unrelatedSignals: unknown[] = [];
    unrelated.onAny((event, payload) => unrelatedSignals.push({ event, payload }));
    const offerPayload = { sessionId: paired.sessionId!, description: { type: 'offer' as const, sdp: 'v=0\r\n' } };
    const offer = new Promise((resolve) => second.once('webrtc:offer', resolve));
    first.emit('webrtc:offer', { ...offerPayload, target: unrelated.id, roomId: 'room-two' } as typeof offerPayload);
    expect(await offer).toEqual(offerPayload);
    const answerPayload = { sessionId: paired.sessionId!, description: { type: 'answer' as const, sdp: 'v=0\r\n' } };
    const answer = new Promise((resolve) => first.once('webrtc:answer', resolve));
    second.emit('webrtc:answer', answerPayload);
    expect(await answer).toEqual(answerPayload);
    const icePayload = { sessionId: paired.sessionId!, candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 } };
    const candidate = new Promise((resolve) => second.once('webrtc:ice-candidate', resolve));
    first.emit('webrtc:ice-candidate', icePayload);
    expect(await candidate).toEqual(icePayload);
    const state = new Promise((resolve) => second.once('participant:media', resolve));
    first.emit('participant:media', { audio: false, video: false });
    expect(await state).toEqual({ id: first.id, media: { audio: false, video: false } });
    const duplicate = await join(first, 'Alice');
    expect(duplicate.self.media).toEqual({ audio: false, video: false });
    expect(unrelatedSignals).toEqual([]);
  });

  it('acknowledges room:leave only after the departure has actually been processed', async () => {
    const first = await connect();
    await join(first, 'Alice');
    const acked = new Promise<void>((resolve) => first.emit('room:leave', resolve));
    await acked;
    expect(server.rooms.size).toBe(0);
  });

  it('relays screen-share state only to the paired participant', async () => {
    const first = await connect();
    await join(first, 'Alice');
    const second = await connect();
    await join(second, 'Bob');
    const outsider = await connect();
    await join(outsider, 'Dara', 'room-two');
    const outsiderSignals: unknown[] = [];
    outsider.onAny((event, payload) => outsiderSignals.push({ event, payload }));
    const sharing = new Promise((resolve) => second.once('participant:screen-share', resolve));
    first.emit('participant:screen-share', { sharing: true });
    expect(await sharing).toEqual({ id: first.id, sharing: true });
    expect(outsiderSignals).toEqual([]);
  });

  it('relays chat messages to everyone in the room, including the sender, but not other rooms', async () => {
    const first = await connect();
    await join(first, 'Alice');
    const second = await connect();
    await join(second, 'Bob');
    const outsider = await connect();
    await join(outsider, 'Dara', 'room-two');
    const outsiderMessages: unknown[] = [];
    outsider.on('chat:message', (message) => outsiderMessages.push(message));
    const fromFirst = new Promise<ChatMessage>((resolve) => first.once('chat:message', resolve));
    const fromSecond = new Promise<ChatMessage>((resolve) => second.once('chat:message', resolve));
    first.emit('chat:message', { text: '  Hello there  ' });
    const [selfEcho, peerCopy] = await Promise.all([fromFirst, fromSecond]);
    expect(selfEcho).toEqual(peerCopy);
    expect(selfEcho.senderId).toBe(first.id);
    expect(selfEcho.name).toBe('Alice');
    expect(selfEcho.text).toBe('Hello there');
    expect(typeof selfEcho.id).toBe('string');
    expect(typeof selfEcho.timestamp).toBe('number');
    expect(outsiderMessages).toEqual([]);
  });

  it('rejects empty, oversized, malformed, and out-of-room chat messages, and rate-limits spam', async () => {
    const first = await connect();
    await join(first, 'Alice');
    const outsider = await connect();
    const outsiderError = new Promise((resolve) => outsider.once('room:error', resolve));
    outsider.emit('chat:message', { text: 'hi' });
    await outsiderError;

    for (const payload of [{ text: '   ' }, { text: 'x'.repeat(501) }, {}, { text: 123 }, null]) {
      const error = new Promise((resolve) => first.once('room:error', resolve));
      first.emit('chat:message', payload as Parameters<ClientToServerEvents['chat:message']>[0]);
      expect(await error).toHaveProperty('message');
    }

    const received: unknown[] = [];
    first.on('chat:message', (message) => received.push(message));
    for (let i = 0; i < 6; i += 1) first.emit('chat:message', { text: `message ${i}` });
    const limited = new Promise((resolve) => first.once('room:error', resolve));
    first.emit('chat:message', { text: 'one too many' });
    expect(await limited).toHaveProperty('message');
    await expect.poll(() => received.length, { timeout: 500 }).toBe(6);
  });

  it('rejects signals from outsiders and from the wrong negotiating role', async () => {
    const first = await connect();
    await join(first, 'Alice');
    const second = await connect();
    const paired = await join(second, 'Bob');
    const outsider = await connect();
    const payload = { sessionId: paired.sessionId!, description: { type: 'offer' as const, sdp: 'v=0\r\n' } };
    for (const client of [second, outsider]) {
      const error = new Promise((resolve) => client.once('room:error', resolve));
      client.emit('webrtc:offer', payload);
      expect(await error).toHaveProperty('message');
    }
    const wrongAnswer = new Promise((resolve) => first.once('room:error', resolve));
    first.emit('webrtc:answer', { ...payload, description: { type: 'answer', sdp: 'v=0\r\n' } });
    await wrongAnswer;
  });

  it('validates untrusted join, media, SDP, and candidate payloads', async () => {
    const first = await connect();
    const invalidJoins = [
      null, {}, { roomId: '../bad', name: 'Alice', media },
      { roomId: 'room-one', name: '', media },
      { roomId: 'room-one', name: 'x'.repeat(41), media },
      { roomId: 'room-one', name: 'Alice', media: { audio: 'yes', video: true } },
    ];
    for (const payload of invalidJoins) {
      const error = new Promise((resolve) => first.once('room:error', resolve));
      first.emit('room:join', payload as Parameters<ClientToServerEvents['room:join']>[0]);
      expect(await error).toHaveProperty('message');
      expect(server.rooms.size).toBe(0);
    }
    await join(first, 'Alice');
    const second = await connect();
    const paired = await join(second, 'Bob');
    const invalidSignals = [
      { sessionId: paired.sessionId, description: { type: 'answer', sdp: 'v=0' } },
      { sessionId: paired.sessionId, description: { type: 'offer', sdp: 'x'.repeat(65_537) } },
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
    first.emit('webrtc:ice-candidate', { sessionId: paired.sessionId!, candidate: { candidate: 'x'.repeat(8193) } });
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
