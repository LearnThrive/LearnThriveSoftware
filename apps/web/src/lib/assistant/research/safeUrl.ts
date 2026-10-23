import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Whether the server may fetch a web address on a student's behalf. A search result or a model's tool call is untrusted: its address could point at
 * the machine's own services, a cloud metadata endpoint or the home network (server-side request forgery). Every address is checked before it is
 * fetched, and again at every redirect, and a name is only allowed if EVERY address it resolves to is a public one.
 *
 * (The address of the operator's own SearXNG instance is configuration, not an untrusted address, and does not go through this check.)
 */
export type UrlVerdict = { ok: true; url: URL } | { ok: false; reason: string };
export type Resolver = (host: string) => Promise<string[]>;

export const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

const BLOCKED_NAMES = [/^localhost$/i, /\.localhost$/i, /\.local$/i, /\.internal$/i, /\.lan$/i, /\.corp$/i, /\.home$/i, /\.home\.arpa$/i, /^host\.docker\.internal$/i, /^metadata$/i, /^kubernetes(\.default)?$/i];

const v4 = (ip: string): number[] | null => {
  const parts = ip.split(".").map((p) => Number(p));
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
};

/** An IPv6 address as eight 16-bit groups, or null. Handles "::" and a trailing dotted IPv4. */
function v6(ip: string): number[] | null {
  let text = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0]!;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const four = v4(dotted[1]!);
    if (!four) return null;
    text = text.slice(0, -dotted[1]!.length) + ((four[0]! << 8) | four[1]!).toString(16) + ":" + ((four[2]! << 8) | four[3]!).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? groups : null;
}

/** True for every address that is not a public, routable one: loopback, private, link-local (the metadata address), shared, reserved, multicast, documentation. */
export function isPrivateAddress(ip: string): boolean {
  const four = v4(ip);
  if (four) {
    const [a, b, c] = four as [number, number, number, number];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)
    );
  }
  const six = v6(ip);
  if (!six) return true; // not an address we can read: not one we will trust
  const [g0, g1, g2, g3, g4, g5, g6, g7] = six as [number, number, number, number, number, number, number, number];
  if (six.every((g) => g === 0)) return true; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) return isPrivateAddress(`${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`); // ::ffff:a.b.c.d
  if (g0 === 0x64 && g1 === 0xff9b) return isPrivateAddress(`${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`); // NAT64
  if (g0 === 0x2002) return isPrivateAddress(`${g1 >> 8}.${g1 & 255}.${g2 >> 8}.${g2 & 255}`); // 6to4
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0xdb8) return true; // documentation
  return false;
}

/** Checks one address: http or https only, no embedded credentials, an ordinary port, not a local name, and a public address however the name is written. */
export async function checkUrl(raw: string, options: { resolve?: Resolver; ports?: readonly number[] } = {}): Promise<UrlVerdict> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a web address" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "only http and https addresses are fetched" };
  if (url.username || url.password) return { ok: false, reason: "an address with a login in it is not fetched" };
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!(options.ports ?? [80, 443]).includes(port)) return { ok: false, reason: "that port is not fetched" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, reason: "no host" };
  if (BLOCKED_NAMES.some((re) => re.test(host))) return { ok: false, reason: "a local or internal name is not fetched" };
  if (isIP(host)) return isPrivateAddress(host) ? { ok: false, reason: "a private or local address is not fetched" } : { ok: true, url };
  // The URL parser has already turned 2130706433, 0x7f.1 and 017700000001 into dotted quads, which isIP caught above; what is left is a name.
  if (!host.includes(".")) return { ok: false, reason: "a single-label name is not fetched" };
  let addresses: string[];
  try {
    addresses = await (options.resolve ?? defaultResolver)(host);
  } catch {
    return { ok: false, reason: "the name did not resolve" };
  }
  if (addresses.length === 0) return { ok: false, reason: "the name did not resolve" };
  if (addresses.some((a) => isPrivateAddress(a))) return { ok: false, reason: "the name points at a private or local address" };
  return { ok: true, url };
}
