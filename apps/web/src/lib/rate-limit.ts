import { isIP } from "node:net";

/**
 * In-memory sliding-window rate limiting for the careers, reconfirmation, subject-request and challenge
 * routes. Server only.
 *
 * WHAT IT IS AND IS NOT. The counts live in this process. That is correct for ONE Render instance and is
 * reset by a restart or a deploy; on several instances each would count separately. It is a second layer
 * behind the human check, the one-use challenges and the honeypot, not the only defence. docs/RENDER.md says
 * what to add (a shared store, or a rule at the edge) if the service is ever scaled out.
 *
 * Two limits apply to every request: one per visitor address, and one for the whole route. The global one
 * bounds the mailbox even if an attacker forges addresses; the price is that a flood could briefly lock real
 * visitors out, which is why the global ceilings are far above real traffic.
 */
export interface RateRule {
  max: number;
  windowMs: number;
}

export class SlidingWindowLimiter {
  private readonly perClientHits = new Map<string, number[]>();
  private globalHits: number[] = [];

  constructor(
    private readonly perClient: RateRule,
    private readonly global: RateRule,
  ) {}

  /** Returns true, and records the request, if it is within both limits; false (recording nothing) if not. */
  allow(key: string, now: number = Date.now()): boolean {
    this.globalHits = this.globalHits.filter((at) => now - at < this.global.windowMs);
    if (this.globalHits.length >= this.global.max) return false;

    const recent = (this.perClientHits.get(key) ?? []).filter((at) => now - at < this.perClient.windowMs);
    if (recent.length >= this.perClient.max) {
      this.perClientHits.set(key, recent);
      return false;
    }

    recent.push(now);
    this.perClientHits.set(key, recent);
    this.globalHits.push(now);
    if (this.perClientHits.size > 5000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    for (const [key, hits] of this.perClientHits) {
      if (hits.every((at) => now - at >= this.perClient.windowMs)) this.perClientHits.delete(key);
    }
  }

  /** For tests. */
  reset() {
    this.perClientHits.clear();
    this.globalHits = [];
  }
}

type Env = Record<string, string | undefined>;

function validAddress(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  return candidate && isIP(candidate) !== 0 ? candidate : null;
}

/**
 * The visitor's address for rate limiting. NEVER TRUST A CLIENT-SUPPLIED VALUE: a visitor can send any
 * X-Forwarded-For they like, and a proxy APPENDS to it, so the left-most entry is the visitor's own claim.
 * The entry to use is counted from the RIGHT, skipping the proxies that belong to the host.
 *
 * Render does not document which header carries the visitor's address or how many proxies sit in front of a
 * service (community reports disagree), so this is configurable and the default is the safe reading:
 *   1. CLIENT_IP_HEADER, if set (for example `true-client-ip` or `cf-connecting-ip`): that header's value,
 *      but only if it is a valid IP address. Set it once a test on the deployed service shows it is present
 *      and cannot be forged.
 *   2. Otherwise X-Forwarded-For, taking the entry TRUSTED_PROXY_HOPS places from the right (default 1: the
 *      last entry is the address the host's own proxy saw connecting, the one before it is what that
 *      first proxy reported).
 *   3. Otherwise "unknown" - every unidentifiable visitor then shares one (strict) bucket.
 * docs/RENDER.md has the check to run after deploying (send a request carrying a made-up X-Forwarded-For and
 * see which entry the service picks).
 */
export function clientAddress(headers: Headers, env: Env = process.env): string {
  const named = env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (named) {
    const fromHeader = validAddress(headers.get(named));
    if (fromHeader) return fromHeader;
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parsedHops = Number.parseInt(env.TRUSTED_PROXY_HOPS ?? "", 10);
    const hops = Number.isFinite(parsedHops) && parsedHops >= 0 ? parsedHops : 1;
    const entries = forwarded.split(",").map((entry) => entry.trim()).filter(Boolean);
    const picked = validAddress(entries[Math.max(0, entries.length - 1 - hops)]);
    if (picked) return picked;
  }

  return "unknown";
}
