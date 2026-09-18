import { createLogger } from './log';

const iceLog = createLogger('ice');

interface CachedTurn { iceServers: RTCIceServer[]; expiresAt: number }
let cached: CachedTurn | null = null;
let inFlight: Promise<void> | null = null;

// Refresh a little before the credential's actual TTL expires, not right at the deadline — a
// margin against clock skew and in-flight requests that started just before expiry.
const REFRESH_MARGIN_SECONDS = 120;

async function refreshTurnCredentials(): Promise<void> {
  try {
    const response = await fetch('/api/turn-credentials');
    if (!response.ok) throw new Error(`status ${response.status}`);
    const data = await response.json() as { iceServers?: RTCIceServer | RTCIceServer[]; ttlSeconds?: number };
    if (!data.iceServers) throw new Error('missing iceServers in response');
    const iceServers = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
    const ttlSeconds = Math.max(0, (data.ttlSeconds ?? 3600) - REFRESH_MARGIN_SECONDS);
    cached = { iceServers, expiresAt: Date.now() + ttlSeconds * 1000 };
  } catch (error) {
    // Expected and unremarkable when no Cloudflare TURN key is configured on this server (the
    // endpoint replies 503) — logged only in development so a production console doesn't fill up
    // with a permanent, known condition. Either way, getIceConfiguration() below falls back to
    // public STUN, which still lets many networks connect directly.
    if (import.meta.env.DEV) iceLog.warn('Temporary TURN credentials unavailable; continuing STUN-only.', error);
    cached = null;
  }
}

// Kicks off (or reuses an in-flight) credential fetch whenever the cache is empty or stale.
// Callers don't need to await this for calling connect() to still work — a peer connection
// created before it resolves just falls back to STUN-only for that connection; this exists so
// *later* peer connections in the same session (a second/third participant joining, or a
// reconnect) pick up fresh, non-expired credentials rather than ones fetched once at page load.
export function ensureFreshTurnCredentials(): Promise<void> {
  if (cached && Date.now() < cached.expiresAt) return Promise.resolve();
  if (!inFlight) inFlight = refreshTurnCredentials().finally(() => { inFlight = null; });
  return inFlight;
}

/** VITE_ configuration is browser-visible; TURN credentials should be short-lived — see
 * ensureFreshTurnCredentials for the temporary Cloudflare-issued ones this also uses when available. */
export function getIceConfiguration(): RTCConfiguration {
  const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
  if (cached) iceServers.push(...cached.iceServers);
  // A manual/self-hosted TURN override for testing against a specific known service, independent
  // of (and additive to) the Cloudflare temporary-credential path above.
  const urls = import.meta.env.VITE_TURN_URL?.split(',').map((url: string) => url.trim()).filter(Boolean);
  if (urls?.length && import.meta.env.VITE_TURN_USERNAME && import.meta.env.VITE_TURN_CREDENTIAL) {
    iceServers.push({ urls, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL });
  }
  // ?forceTurn=1 forces every candidate pair through a relay, so a real call only succeeds if
  // TURN is actually configured and working — see TURN_TESTING.md.
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const forceTurn = new URLSearchParams(search).get('forceTurn') === '1';
  return { iceServers, ...(forceTurn ? { iceTransportPolicy: 'relay' as const } : {}) };
}
