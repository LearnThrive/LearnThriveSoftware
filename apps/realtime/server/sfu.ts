import type { SfuReply } from '@learnthrive/shared/protocol';

/**
 * Cloudflare Realtime SFU, server side. The browser never sees the app secret: it asks THIS server to make each SFU call for it
 * (over its authenticated Socket.IO connection, as an acknowledged event), and this server
 *   - checks the caller owns the session it names (sessions are created here, so we know whose they are),
 *   - for a pull, checks the track was really published by someone in the caller's own room (a client cannot pull another room's media),
 *   - forwards ONLY the fields it understands (the Cloudflare request is rebuilt, never passed through),
 *   - runs every call on one session one at a time (Cloudflare rejects overlapping changes to a session), and
 *   - returns only the fields the client needs (never a header, a secret or an unknown field).
 *
 * API shapes are from Cloudflare's published OpenAPI schema (developers.cloudflare.com/realtime/sfu/https-api, realtime-api-2024-05-21):
 *   POST   /apps/{appId}/sessions/new
 *   POST   /apps/{appId}/sessions/{sessionId}/tracks/new
 *   PUT    /apps/{appId}/sessions/{sessionId}/renegotiate
 *   PUT    /apps/{appId}/sessions/{sessionId}/tracks/close
 * Limits that matter here: at most 64 tracks per call, 50 calls a second per session, an idle track is collected after 30 seconds.
 */

const BASE_URL = 'https://rtc.live.cloudflare.com/v1';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_SDP_LENGTH = 65_536;
const MAX_LOCAL_TRACKS = 8;
const MAX_REMOTE_TRACKS = 64;
const MAX_SESSIONS_PER_SOCKET = 6;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 40;
const TRACK_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const MID = /^[A-Za-z0-9_-]{1,32}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/;

export interface SessionDescription { type: 'offer' | 'answer'; sdp: string }
export interface LocalTrack { location: 'local'; mid: string; trackName: string }
export interface RemoteTrack { location: 'remote'; sessionId: string; trackName: string }
export interface TracksBody { sessionDescription?: SessionDescription; tracks: Array<LocalTrack | RemoteTrack> }
export interface CloseBody { sessionDescription?: SessionDescription; tracks: Array<{ mid: string }>; force: boolean }
export interface TrackResult { mid?: string; trackName?: string; sessionId?: string; errorCode?: string; errorDescription?: string }
export interface SfuResult {
  requiresImmediateRenegotiation: boolean;
  sessionDescription?: SessionDescription;
  tracks: TrackResult[];
  errorCode?: string;
  errorDescription?: string;
}

/** The four calls this server makes. An interface so tests (and a future provider) can stand in for Cloudflare. */
export interface SfuApi {
  newSession(): Promise<{ sessionId: string }>;
  tracks(sessionId: string, body: TracksBody): Promise<SfuResult>;
  renegotiate(sessionId: string, description: SessionDescription): Promise<SfuResult>;
  close(sessionId: string, body: CloseBody): Promise<SfuResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 256): string | undefined {
  return typeof value === 'string' && value.length <= max ? value : undefined;
}

export function parseDescription(value: unknown, type?: 'offer' | 'answer'): SessionDescription | null {
  if (!isRecord(value) || (value.type !== 'offer' && value.type !== 'answer')) return null;
  if (type && value.type !== type) return null;
  if (typeof value.sdp !== 'string' || value.sdp.length === 0 || value.sdp.length > MAX_SDP_LENGTH) return null;
  return { type: value.type, sdp: value.sdp };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Rebuilds a tracks/new body from only the fields we allow. `pullable` says whether (sessionId, trackName) is a real publication in the caller's room. */
export function parseTracksBody(body: unknown, pullable: (sessionId: string, trackName: string) => boolean): Parsed<TracksBody> {
  if (!isRecord(body) || !Array.isArray(body.tracks) || body.tracks.length === 0) return { ok: false, error: 'No tracks were named.' };
  const entries = body.tracks;
  if (!entries.every(isRecord)) return { ok: false, error: 'Invalid track.' };
  const locations = new Set(entries.map((entry) => (entry as Record<string, unknown>).location));
  if (locations.size !== 1) return { ok: false, error: 'A request names either published or pulled tracks, not both.' };

  if (locations.has('local')) {
    if (entries.length > MAX_LOCAL_TRACKS) return { ok: false, error: 'Too many tracks.' };
    const sessionDescription = parseDescription(body.sessionDescription, 'offer');
    if (!sessionDescription) return { ok: false, error: 'Publishing needs the browser\'s offer.' };
    const tracks: LocalTrack[] = [];
    for (const entry of entries as Record<string, unknown>[]) {
      const mid = text(entry.mid, 32);
      const trackName = text(entry.trackName, 64);
      if (!mid || !MID.test(mid) || !trackName || !TRACK_NAME.test(trackName)) return { ok: false, error: 'Invalid track.' };
      tracks.push({ location: 'local', mid, trackName });
    }
    if (new Set(tracks.map((track) => track.trackName)).size !== tracks.length) return { ok: false, error: 'Duplicate track name.' };
    return { ok: true, value: { sessionDescription, tracks } };
  }

  if (locations.has('remote')) {
    if (entries.length > MAX_REMOTE_TRACKS) return { ok: false, error: 'Too many tracks.' };
    if (body.sessionDescription !== undefined) return { ok: false, error: 'Pulling tracks sends no offer.' };
    const tracks: RemoteTrack[] = [];
    for (const entry of entries as Record<string, unknown>[]) {
      const sessionId = text(entry.sessionId, 128);
      const trackName = text(entry.trackName, 64);
      if (!sessionId || !SESSION_ID.test(sessionId) || !trackName || !TRACK_NAME.test(trackName)) return { ok: false, error: 'Invalid track.' };
      if (!pullable(sessionId, trackName)) return { ok: false, error: 'That track is not available in this class.' };
      tracks.push({ location: 'remote', sessionId, trackName });
    }
    return { ok: true, value: { tracks } };
  }
  return { ok: false, error: 'Invalid track.' };
}

export function parseCloseBody(body: unknown): Parsed<CloseBody> {
  if (!isRecord(body) || !Array.isArray(body.tracks) || body.tracks.length === 0 || body.tracks.length > MAX_REMOTE_TRACKS) return { ok: false, error: 'No tracks were named.' };
  const tracks: Array<{ mid: string }> = [];
  for (const entry of body.tracks) {
    const mid = isRecord(entry) ? text(entry.mid, 32) : undefined;
    if (!mid || !MID.test(mid)) return { ok: false, error: 'Invalid track.' };
    tracks.push({ mid });
  }
  if (typeof body.force !== 'boolean') return { ok: false, error: 'Invalid request.' };
  if (body.force) return { ok: true, value: { tracks, force: true } };
  const sessionDescription = parseDescription(body.sessionDescription, 'offer');
  return sessionDescription ? { ok: true, value: { tracks, force: false, sessionDescription } } : { ok: false, error: 'Closing with negotiation needs the browser\'s offer.' };
}

function toResult(raw: unknown): SfuResult {
  const data = isRecord(raw) ? raw : {};
  const description = parseDescription(data.sessionDescription);
  const tracks: TrackResult[] = Array.isArray(data.tracks)
    ? data.tracks.filter(isRecord).slice(0, MAX_REMOTE_TRACKS).map((track) => ({
      ...(text(track.mid, 32) ? { mid: text(track.mid, 32) } : {}),
      ...(text(track.trackName, 64) ? { trackName: text(track.trackName, 64) } : {}),
      ...(text(track.sessionId, 128) ? { sessionId: text(track.sessionId, 128) } : {}),
      ...(text(track.errorCode, 64) ? { errorCode: text(track.errorCode, 64) } : {}),
      ...(text(track.errorDescription, 300) ? { errorDescription: text(track.errorDescription, 300) } : {}),
    }))
    : [];
  return {
    requiresImmediateRenegotiation: data.requiresImmediateRenegotiation === true,
    ...(description ? { sessionDescription: description } : {}),
    tracks,
    ...(text(data.errorCode, 64) ? { errorCode: text(data.errorCode, 64) } : {}),
    ...(text(data.errorDescription, 300) ? { errorDescription: text(data.errorDescription, 300) } : {}),
  };
}

export interface CloudflareSfuConfig { appId: string; appSecret: string; baseUrl?: string; fetchImpl?: typeof fetch }

export function createCloudflareSfu(config: CloudflareSfuConfig): SfuApi {
  const base = `${config.baseUrl ?? BASE_URL}/apps/${encodeURIComponent(config.appId)}`;
  const fetchImpl = config.fetchImpl ?? fetch;

  async function call(method: 'POST' | 'PUT', path: string, body?: unknown): Promise<unknown> {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.appSecret}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      // Status and Cloudflare's error code only: never the request, the SDP or a header.
      const code = isRecord(json) && typeof json.errorCode === 'string' ? ` ${json.errorCode}` : '';
      throw new Error(`Cloudflare SFU answered ${response.status}${code}`);
    }
    return json;
  }

  return {
    async newSession() {
      const json = await call('POST', '/sessions/new');
      const sessionId = isRecord(json) ? text(json.sessionId, 128) : undefined;
      if (!sessionId || !SESSION_ID.test(sessionId)) throw new Error('Cloudflare SFU returned no session id');
      return { sessionId };
    },
    async tracks(sessionId, body) {
      return toResult(await call('POST', `/sessions/${encodeURIComponent(sessionId)}/tracks/new`, body));
    },
    async renegotiate(sessionId, description) {
      return toResult(await call('PUT', `/sessions/${encodeURIComponent(sessionId)}/renegotiate`, { sessionDescription: description }));
    },
    async close(sessionId, body) {
      return toResult(await call('PUT', `/sessions/${encodeURIComponent(sessionId)}/tracks/close`, body));
    },
  };
}

/** The SFU from the environment, or null when it is not configured (the classroom then falls back to the peer-to-peer mesh). */
export function sfuFromEnv(env: Record<string, string | undefined> = process.env): SfuApi | null {
  const appId = env.CLOUDFLARE_SFU_APP_ID?.trim();
  const appSecret = env.CLOUDFLARE_SFU_APP_SECRET?.trim();
  return appId && appSecret ? createCloudflareSfu({ appId, appSecret }) : null;
}

/** Runs the callbacks for one key one after another; different keys run at the same time. */
export function createKeyedQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.then(task, task);
      const tail = result.then(() => undefined, () => undefined);
      tails.set(key, tail);
      void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
      return result;
    },
  };
}

export type SfuService = ReturnType<typeof createSfuService>;

/**
 * Owns which socket created which session, the per-socket rate limit and the one-at-a-time rule. `pullable` is supplied per call by
 * the signalling server, which is the only place that knows who has published what in which room.
 */
export function createSfuService(api: SfuApi) {
  const queue = createKeyedQueue();
  const owners = new Map<string, string>();
  const created = new Map<string, number>();
  const hits = new Map<string, number[]>();

  function allow(socketId: string): boolean {
    const now = Date.now();
    const recent = (hits.get(socketId) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX) { hits.set(socketId, recent); return false; }
    recent.push(now);
    hits.set(socketId, recent);
    return true;
  }

  const fail = (error: string): SfuReply => ({ ok: false, error });

  return {
    owns(socketId: string, sessionId: unknown): boolean {
      return typeof sessionId === 'string' && owners.get(sessionId) === socketId;
    },

    /** Forget everything a socket created (it left the room). Cloudflare collects the idle sessions itself. */
    release(socketId: string) {
      for (const [sessionId, owner] of owners) if (owner === socketId) owners.delete(sessionId);
      created.delete(socketId);
      hits.delete(socketId);
    },

    async handle(socketId: string, request: unknown, pullable: (sessionId: string, trackName: string) => boolean): Promise<SfuReply> {
      if (!isRecord(request) || typeof request.op !== 'string') return fail('Invalid request.');
      if (!allow(socketId)) return fail('Too many media requests. Please slow down.');
      try {
        if (request.op === 'session.new') {
          if ((created.get(socketId) ?? 0) >= MAX_SESSIONS_PER_SOCKET) return fail('Too many media sessions for this connection.');
          created.set(socketId, (created.get(socketId) ?? 0) + 1);
          const { sessionId } = await api.newSession();
          owners.set(sessionId, socketId);
          return { ok: true, data: { sessionId } };
        }

        const sessionId = request.sessionId;
        if (typeof sessionId !== 'string' || owners.get(sessionId) !== socketId) return fail('That media session is not yours.');

        if (request.op === 'tracks.new') {
          const parsed = parseTracksBody(request.body, (id, name) => id !== sessionId && pullable(id, name));
          if (!parsed.ok) return fail(parsed.error);
          return { ok: true, data: { ...(await queue.run(sessionId, () => api.tracks(sessionId, parsed.value))) } };
        }
        if (request.op === 'renegotiate') {
          const body = isRecord(request.body) ? request.body : null;
          const description = body ? parseDescription(body.sessionDescription, 'answer') : null;
          if (!description) return fail('Invalid answer.');
          return { ok: true, data: { ...(await queue.run(sessionId, () => api.renegotiate(sessionId, description))) } };
        }
        if (request.op === 'tracks.close') {
          const parsed = parseCloseBody(request.body);
          if (!parsed.ok) return fail(parsed.error);
          return { ok: true, data: { ...(await queue.run(sessionId, () => api.close(sessionId, parsed.value))) } };
        }
        return fail('Unknown request.');
      } catch (error) {
        // The message names Cloudflare's status, never a secret, an SDP or a header; the browser is told only that it failed.
        console.error('SFU request failed:', request.op, error instanceof Error ? error.message : 'unknown error');
        return fail('The media service could not complete that request.');
      }
    },
  };
}
