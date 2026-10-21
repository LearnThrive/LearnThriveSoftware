#!/usr/bin/env node
/**
 * Checks an environment against docs/ENVIRONMENT.md (plan20 section 8): for every variable the site reads, is it missing, absent
 * (optional), present and well-formed, or malformed (wrong prefix, too short, the wrong kind of key, a URL for the wrong place)?
 *
 *   node scripts/check-env.mjs                        the local environment: process.env plus apps/web/.env if it exists
 *   node scripts/check-env.mjs --env production       what Render's environment should look like (process.env only)
 *   node scripts/check-env.mjs --file path/to/.env    a different file (read, never printed)
 *
 * IT NEVER PRINTS A VALUE. Each line says the variable's name and a verdict ("present", "too short (24)", "a service_role key in the
 * anon slot", "points at the hosted Supabase project"), never the text of the value or of the file. Length and kind are all it shows.
 *
 * The rule that protects production: in a LOCAL environment, any value that points at the hosted Supabase project (a *.supabase.co or
 * *.supabase.com host, the project reference, or a legacy key issued for a hosted project) is a failure, because with the three
 * Supabase variables present the site would use real Supabase, and a local file must only ever reach the local stack. Set
 * CHECK_ENV_ALLOW_HOSTED=1 to accept it deliberately, for one run.
 *
 * Exit status: 0 nothing wrong (warnings allowed), 1 at least one MISSING, MALFORMED, FORBIDDEN or HOSTED, 2 it could not run.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BY_NAME, GROUPS, HOSTED_REFS, REGISTRY } from "./env-registry.mjs";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "host.docker.internal"]);
const isHostedHost = (host) => /(^|\.)supabase\.(co|com|net)$/i.test(host);

/** The payload of a JWT (no signature check: only to see what KIND of key it is), or null. */
export function jwtPayload(value) {
  const parts = value.split(".");
  if (parts.length !== 3 || !value.startsWith("eyJ")) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Does this value point at the hosted project? Looks at hosts, the project reference and JWT claims; returns a category, never the value. */
export function pointsAtHosted(value) {
  if (!value) return null;
  if (HOSTED_REFS.some((ref) => value.includes(ref))) return "the hosted project's reference";
  const url = parseUrl(value);
  if (url && isHostedHost(url.hostname)) return "a hosted Supabase host";
  const jwt = jwtPayload(value);
  if (jwt && typeof jwt.ref === "string" && jwt.iss !== "supabase-demo") return "a key issued for a hosted project";
  return null;
}

// Each check returns null (well-formed) or a short description of the problem. It never includes the value.
const CHECKS = {
  text: () => null,
  "node-env": (v) => (["development", "test", "production"].includes(v) ? null : "must be development, test or production"),
  url: (v) => (/^https?:$/.test(parseUrl(v)?.protocol ?? "") ? null : "not an http(s) URL"),
  "url-https-prod": (v, c) => {
    const u = parseUrl(v);
    if (!u || !/^https?:$/.test(u.protocol)) return "not an http(s) URL";
    if (c.mode === "production" && (u.protocol !== "https:" || LOCAL_HOSTS.has(u.hostname))) return "must be the public https address in production";
    return null;
  },
  origins: (v, c) => {
    for (const origin of v.split(",").map((s) => s.trim()).filter(Boolean)) {
      const u = parseUrl(origin);
      if (!u || !/^https?:$/.test(u.protocol) || u.pathname !== "/" || u.search || origin.endsWith("/")) return "each entry must be an origin like https://example.com (no path, no trailing slash)";
      if (c.mode === "production" && (u.protocol !== "https:" || LOCAL_HOSTS.has(u.hostname))) return "production origins must be https and public";
    }
    return null;
  },
  email: (v) => (/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(v) ? null : "not a single email address"),
  "header-name": (v) => (/^[a-z0-9-]+$/i.test(v) ? null : "not a header name"),
  "true-only": (v) => (v === "true" ? null : "must be exactly true (anything else is treated as off)"),
  "true-or-false": (v) => (v === "true" || v === "false" ? null : "must be true or false"),
  price: (v) => (/^\d+(\.\d{1,2})?$/.test(v) ? null : "pounds as a number, like 9.99, with no currency sign"),
  provider: (v, c) => {
    const list = v.split(",").map((s) => s.trim());
    if (!list.every((p) => ["ollama", "nim", "custom", "mock"].includes(p))) return "must be ollama, nim, custom, mock or a comma list of them";
    if (c.mode === "production" && !(list.length === 1 && list[0] === "custom")) return "in production only custom qualifies (ollama, nim and mock never do)";
    return null;
  },
  "supabase-url": (v, c) => {
    const u = parseUrl(v);
    if (!u) return "not a URL";
    if (LOCAL_HOSTS.has(u.hostname)) return c.mode === "production" ? "a local address cannot be used in production" : null;
    if (!isHostedHost(u.hostname)) return "not a Supabase address";
    return u.protocol === "https:" && /^[a-z0-9]{20}\.supabase\.co$/.test(u.hostname) ? null : "a hosted project URL looks like https://<20 letters or digits>.supabase.co";
  },
  "anon-key": (v) => {
    if (v.startsWith("sb_secret_")) return "a secret key (sb_secret_) in the publishable slot";
    if (v.startsWith("sb_publishable_")) return v.length >= 30 ? null : `too short (${v.length}) for a publishable key`;
    const jwt = jwtPayload(v);
    if (!jwt) return "not a publishable key (sb_publishable_...) or a legacy anon JWT";
    return jwt.role === "anon" ? null : `a ${String(jwt.role)} key in the anon slot (the publishable key must be the anon one)`;
  },
  "service-key": (v) => {
    if (v.startsWith("sb_publishable_")) return "a publishable key in the secret slot";
    if (v.startsWith("sb_secret_")) return v.length >= 30 ? null : `too short (${v.length}) for a secret key`;
    const jwt = jwtPayload(v);
    if (!jwt) return "not a secret key (sb_secret_...) or a legacy service_role JWT";
    return jwt.role === "service_role" ? null : `a ${String(jwt.role)} key in the service_role slot`;
  },
  "database-url": (v, c) => {
    const u = parseUrl(v);
    if (!u || !/^postgres(ql)?:$/.test(u.protocol)) return "not a postgresql:// URL";
    if (!u.username || !u.password) return "missing the user or the password";
    if (c.mode === "production") {
      if (LOCAL_HOSTS.has(u.hostname)) return "a local address cannot be used in production";
      if (isHostedHost(u.hostname) && u.port !== "6543") return "use the transaction pooler (port 6543), not the direct connection";
      if (decodeURIComponent(u.username).split(".")[0] === "postgres") return "connect as the narrow learnthrive_server role, not postgres (scripts/create-server-role.mjs)";
    }
    return null;
  },
  "stripe-secret": (v) => (/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/.test(v) ? null : "must be sk_test_/sk_live_ or a restricted rk_ key"),
  "stripe-webhook": (v) => (v.split(",").every((s) => /^whsec_[A-Za-z0-9]{10,}$/.test(s.trim())) ? null : "must be whsec_... (two, comma separated, while rotating)"),
};

function runCheck(spec, value, context) {
  const [kind, ...args] = spec.split(":");
  if (CHECKS[kind]) return CHECKS[kind](value, context);
  if (kind === "prefix") return value.startsWith(args[0]) && value.length >= 20 ? null : value.startsWith(args[0]) ? `too short (${value.length})` : `must start with ${args[0]}`;
  if (kind === "min") return value.length >= Number(args[0]) && !/\s/.test(value) ? null : /\s/.test(value) ? "contains whitespace" : `too short (${value.length}; at least ${args[0]})`;
  if (kind === "int") {
    const n = Number(value);
    return Number.isInteger(n) && n >= Number(args[0]) && n <= Number(args[1]) ? null : `must be a whole number from ${args[0]} to ${args[1]}`;
  }
  if (kind === "flag") return value === args[0] ? null : `must be ${args[0]} (or unset)`;
  if (kind === "enum") return args[0].split(",").includes(value) ? null : `must be one of ${args[0]}`;
  return null;
}

/** Reads NAME=VALUE lines. Comments and blank lines are skipped; one pair of surrounding quotes is removed. Values stay in memory. */
export function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let value = m[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}

/**
 * The verdicts for an environment. `mode` is "local" or "production". Returns { rows, failures, warnings } where each row is
 * { name, group, status, note } and status is one of: ok, absent, MISSING, MALFORMED, FORBIDDEN, HOSTED, HELD, SET.
 */
export function checkEnvironment(env, { mode = "local" } = {}) {
  const allowHosted = env.CHECK_ENV_ALLOW_HOSTED === "1";
  const context = { mode };
  const supabaseTriple = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "DATABASE_URL"];
  const usesRealSupabase = supabaseTriple.some((n) => (env[n] ?? "").trim());
  const rows = [];
  for (const entry of REGISTRY) {
    const value = (env[entry.name] ?? "").trim();
    const present = value !== "";
    const row = (status, note = "") => rows.push({ name: entry.name, group: entry.group, status, note });
    const never = entry.production === "unset";
    const requiredHere = mode === "production" ? entry.production === "required" : usesRealSupabase && supabaseTriple.concat("SUPABASE_SERVICE_ROLE_KEY").includes(entry.name);

    if (!present) {
      if (requiredHere) row("MISSING", mode === "production" ? "required in production" : "needed: the Supabase variables go together");
      else row(entry.held && mode === "production" ? "HELD" : "absent", entry.held && mode === "production" ? "unset, as it should stay until the owner flips it" : "");
      continue;
    }
    if (mode === "production") {
      if (never) {
        row("FORBIDDEN", "must not be set in production");
        continue;
      }
      if (entry.held) {
        row("SET", "set: confirm the owner approved this switch");
        continue;
      }
    }
    if (mode === "local" && !allowHosted) {
      const hosted = pointsAtHosted(value);
      if (hosted) {
        row("HOSTED", `points at ${hosted}: a local environment must only reach the local stack (CHECK_ENV_ALLOW_HOSTED=1 overrides, once)`);
        continue;
      }
    }
    const problem = runCheck(entry.check, value, context);
    if (problem) row("MALFORMED", problem);
    else row("ok", entry.secret ? `present (${value.length} characters)` : "present");
  }
  const failures = rows.filter((r) => ["MISSING", "MALFORMED", "FORBIDDEN", "HOSTED"].includes(r.status)).length;
  const warnings = rows.filter((r) => r.status === "SET").length;
  return { rows, failures, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const mode = option("--env") ?? "local";
  if (!["local", "production"].includes(mode)) {
    console.error("--env takes local or production.");
    process.exit(2);
  }
  let env = { ...process.env };
  const here = dirname(fileURLToPath(import.meta.url));
  const file = option("--file") ?? (mode === "local" ? join(here, "..", ".env") : null);
  let source = "the environment";
  if (file && existsSync(file)) {
    env = { ...parseEnvFile(readFileSync(file, "utf8")), ...process.env }; // the shell wins over the file
    source = "the environment and a .env file (its contents are not shown)";
  } else if (option("--file")) {
    console.error(`No file at the path given for --file.`);
    process.exit(2);
  }
  const { rows, failures, warnings } = checkEnvironment(env, { mode });
  console.log(`Checking ${source} as a ${mode} environment. Values are never printed.\n`);
  for (const [group, title] of GROUPS) {
    console.log(title);
    for (const r of rows.filter((x) => x.group === group)) {
      if (r.status === "absent" && !args.includes("--all")) continue;
      console.log(`  ${r.status.padEnd(9)} ${r.name.padEnd(32)} ${r.note}`);
    }
  }
  const unknown = Object.keys(env).filter((n) => /^(SUPABASE|DATABASE|STRIPE|ASSISTANT|LIBRARY|VOICE|NEXT_PUBLIC)_/.test(n) && !BY_NAME.has(n));
  if (unknown.length) console.log(`\nVariables with a site prefix that are not in the registry (check the spelling): ${unknown.join(", ")}`);
  console.log(`\n${failures} problem(s), ${warnings} warning(s). Use --all to list the variables that are not set.`);
  process.exit(failures > 0 ? 1 : 0);
}
