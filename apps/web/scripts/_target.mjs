/**
 * Which database a script is about to touch, and the rules that depend on it (plan20). Shared by the scripts that change a
 * database. It only ever looks at the HOST of a connection string: nothing here prints, returns or logs a password or a key.
 *
 *   describeTarget(url)            -> { host, port, user, local, hosted }   (no password)
 *   refuseUnlessLocal(url, action) exits with an error unless the database is on this machine (reset, truncate, wipe)
 *   confirmHosted({ url, host, ... }) for a hosted database: the operator must pass --host <the host> AND type it back
 *
 * "Local" is this machine only (localhost, 127.0.0.1, ::1, host.docker.internal). "Hosted" is anything on supabase.co / supabase.com
 * (the direct host db.<ref>.supabase.co and the pooler aws-*.pooler.supabase.com). Anything else (a host that is neither) is
 * treated as hosted for confirmation purposes: it is not this machine, so it is somebody's real database.
 */
import { createInterface } from "node:readline/promises";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal", "0.0.0.0"]);

export function describeTarget(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("That is not a database URL (expected postgresql://user:password@host:port/database).");
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const local = LOCAL_HOSTS.has(host) || LOCAL_HOSTS.has(`[${host}]`);
  const hosted = /(^|\.)supabase\.(co|com|net)$/.test(host);
  return { host, port: parsed.port || "5432", user: decodeURIComponent(parsed.username || ""), local, hosted: hosted || !local };
}

/** For anything that deletes data in bulk: refuses unless the database is on this machine. Never takes an override. */
export function refuseUnlessLocal(url, action) {
  const target = describeTarget(url);
  if (!target.local) {
    console.error(`Refusing to ${action}: the database host "${target.host}" is not this machine. This action only runs against the local stack.`);
    process.exit(3);
  }
  return target;
}

/**
 * For an action that is allowed on a real database but must be deliberate: the operator passes --host <host> (it must be the
 * connection's own host) and types the host again at a prompt. A local database needs neither.
 */
export async function confirmHosted({ url, args, action }) {
  const target = describeTarget(url);
  if (target.local) return target;
  const given = args.includes("--host") ? args[args.indexOf("--host") + 1] : undefined;
  if (!given || given.toLowerCase() !== target.host) {
    console.error(`This would ${action} on ${target.host}, which is not this machine.\nPass --host ${target.host} to say that is what you mean.`);
    process.exit(3);
  }
  if (!process.stdin.isTTY) {
    console.error("A hosted database needs a person at the keyboard to type the host to confirm; this is not an interactive terminal.");
    process.exit(3);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const typed = (await rl.question(`About to ${action} on ${target.host}.\nType the host again to confirm: `)).trim().toLowerCase();
  rl.close();
  if (typed !== target.host) {
    console.error("That did not match. Nothing was changed.");
    process.exit(3);
  }
  return target;
}

/** The value of a --flag, or undefined. */
export function option(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}
