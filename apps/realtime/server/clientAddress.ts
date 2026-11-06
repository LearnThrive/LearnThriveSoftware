import { isIP } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

/**
 * The visitor's address for the TURN credential limit: the same rule as the site's own limiter (apps/web/src/lib/rate-limit.ts, kept as a
 * twin because that file cannot be imported here), configured by the same two settings (docs/RENDER.md).
 *
 * Behind Render every request arrives from Render's proxy, so the connection's address is the PROXY's, and limiting on it put every visitor
 * in one bucket: two full lessons starting together could use up the allowance, and anyone who then needed the relay got none.
 *
 * NEVER TRUST A CLIENT-SUPPLIED VALUE: a visitor can send any X-Forwarded-For, and a proxy appends to it, so the left-most entry is the
 * visitor's own claim. In order:
 *   1. CLIENT_IP_HEADER, if set: that header's value, if it is a valid IP address.
 *   2. X-Forwarded-For, the entry TRUSTED_PROXY_HOPS places from the right (default 1), if it is a valid IP address.
 *   3. The connection's own address: with no forwarding header the request came straight to this server (local development, the tests).
 */
type Env = Record<string, string | undefined>;

function validAddress(value: string | string[] | undefined): string | null {
  const candidate = (Array.isArray(value) ? value[0] : value)?.trim();
  return candidate && isIP(candidate) !== 0 ? candidate : null;
}

export function clientAddress(headers: IncomingHttpHeaders, connectionAddress: string | undefined, env: Env = process.env): string {
  const named = env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (named) {
    const fromHeader = validAddress(headers[named]);
    if (fromHeader) return fromHeader;
  }

  const forwardedHeader = headers['x-forwarded-for'];
  const forwarded = Array.isArray(forwardedHeader) ? forwardedHeader.join(',') : forwardedHeader;
  if (forwarded) {
    const parsedHops = Number.parseInt(env.TRUSTED_PROXY_HOPS ?? '', 10);
    const hops = Number.isFinite(parsedHops) && parsedHops >= 0 ? parsedHops : 1;
    const entries = forwarded.split(',').map((entry) => entry.trim()).filter(Boolean);
    const picked = validAddress(entries[Math.max(0, entries.length - 1 - hops)]);
    if (picked) return picked;
  }

  return connectionAddress ?? 'unknown';
}
