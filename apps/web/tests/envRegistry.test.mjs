import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkEnvironment, jwtPayload, parseEnvFile, pointsAtHosted } from "../scripts/check-env.mjs";
import { renderEnvironmentDoc } from "../scripts/env-docs.mjs";
import { BY_NAME, REGISTRY } from "../scripts/env-registry.mjs";

// plan20 section 8: the registry of environment variables against the code, the generated document, the validator (which must never
// print a value) and the rule that no secret can reach the browser. Nothing here reads a real .env file or a real key.

const WEB = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(WEB, "..", "..");

function walk(dir, accept, out = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "dist", "storybook-static", "test-results", ".git", "__pycache__", ".venv"].includes(name) || name.startsWith(".next-")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, accept, out);
    else if (accept(full)) out.push(full);
  }
  return out;
}
const isTest = (file) => /(\.test\.|\.spec\.|[\\/]tests?[\\/]|tests-e2e|[\\/]testing[\\/])/.test(file);
const read = (file) => readFileSync(file, "utf8");

/** Every environment variable a non-test source file reads, with a file that reads it. */
function variablesRead() {
  const found = new Map();
  const add = (name, file) => name && !found.has(name) && found.set(name, relative(REPO, file));
  const code = [
    ...walk(join(WEB, "src"), (f) => /\.(ts|tsx)$/.test(f) && !isTest(f)),
    ...walk(join(WEB, "scripts"), (f) => f.endsWith(".mjs") && !/env-registry|check-env|env-docs|realstack/.test(f)),
    join(WEB, "server.ts"),
    join(WEB, "next.config.ts"),
    join(REPO, "scripts", "dev-services.mjs"),
    ...walk(join(REPO, "packages"), (f) => /\.(ts|mjs)$/.test(f) && f.includes(`${sep}src${sep}`) && !isTest(f)),
    ...walk(join(REPO, "apps", "realtime", "server"), (f) => f.endsWith(".ts") && !isTest(f)),
  ];
  for (const file of code) {
    const text = read(file);
    for (const m of text.matchAll(/\b(?:process\.env|env)\.([A-Z][A-Z0-9_]{2,})/g)) add(m[1], file);
    for (const m of text.matchAll(/\b(?:process\.env|env)\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g)) add(m[1], file);
    for (const m of text.matchAll(/\bhas\(\s*["']([A-Z][A-Z0-9_]+)["']\s*\)/g)) add(m[1], file);
  }
  // PATH is the operating system's, read by the speech sidecar only to add CUDA libraries to it.
  for (const file of [join(REPO, "services", "voice", "server.py")]) for (const m of read(file).matchAll(/os\.environ\.get\(\s*"([A-Z][A-Z0-9_]+)"/g)) if (m[1] !== "PATH") add(m[1], file);
  for (const m of read(join(REPO, "config", "compose.yaml")).matchAll(/\$\{([A-Z][A-Z0-9_]+)/g)) add(m[1], join(REPO, "config", "compose.yaml"));
  return found;
}

test("every environment variable the code reads is in the registry (so it is documented, checked and classified)", () => {
  const missing = [...variablesRead()].filter(([name]) => !BY_NAME.has(name)).map(([name, file]) => `${name} (read in ${file})`);
  assert.deepEqual(missing, [], "add each to apps/web/scripts/env-registry.mjs, then run `npm run env:docs`");
});

test("every registry entry is read somewhere, or is an operator-only or test-only setting that says so", () => {
  const read_ = variablesRead();
  // Read by shell scripts, the CLI, the Playwright config or by hand rather than by a source file this scan covers.
  const elsewhere = new Set(["CAREERS_OPEN_FOR_TESTING", "SUPABASE_DB_PASSWORD", "DATABASE_ADMIN_URL", "LEARNTHRIVE_SERVER_PASSWORD", "SUPABASE_LOCAL", "SUPABASE_LOCAL_SERIAL", "CHECK_ENV_ALLOW_HOSTED", "VITE_TURN_URL", "VITE_TURN_USERNAME", "VITE_TURN_CREDENTIAL", "LEARNTHRIVE_DOCKER", "OLLAMA_MODELS", "VOICE_HOST", "VOICE_PORT", "VOICE_STT_DEVICE", "VOICE_STT_MODEL", "VOICE_STT_COMPUTE", "VOICE_TTS_VOICE", "VOICE_PARAKEET_HOME", "VOICE_PARAKEET_PORT", "VOICE_TTS_DEVICE", "NEXT_PUBLIC_MOTION_DEBUG", "NEXT_PUBLIC_THEME_TOGGLE", "NEXT_PUBLIC_SMOOTH_SCROLL", "DISCONNECT_GRACE_MS", "CHROME_PATH", "CI", "STRIPE_API_VERSION"]);
  const unused = REGISTRY.map((v) => v.name).filter((name) => !read_.has(name) && !elsewhere.has(name));
  assert.deepEqual(unused, [], "a variable nothing reads should be removed from the registry");
});

test("the registry is well formed: unique names, known groups, secrets never public, held and never-set flags consistent", () => {
  const names = REGISTRY.map((v) => v.name);
  assert.equal(new Set(names).size, names.length, "no duplicates");
  for (const v of REGISTRY) {
    assert.match(v.name, /^[A-Z][A-Z0-9_]+$/);
    assert.ok(v.purpose.length > 10, v.name);
    if (v.name.startsWith("NEXT_PUBLIC_")) assert.equal(v.secret, false, `${v.name} is shipped to the browser, so it cannot be a secret`);
    if (v.name.startsWith("NEXT_PUBLIC_") && v.name !== "NEXT_PUBLIC_TURN_CREDENTIAL") assert.doesNotMatch(v.name, /SECRET|PASSWORD|TOKEN|SERVICE|PRIVATE/);
    if (v.held) assert.match(v.production, /^unset/, `${v.name}: a held switch stays unset in production`);
  }
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "DATABASE_ADMIN_URL", "LEARNTHRIVE_SERVER_PASSWORD", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY", "CAPTCHA_SECRET", "ASSISTANT_API_KEY", "VOICE_TOKEN"]) assert.equal(BY_NAME.get(name).secret, true, `${name} is a secret`);
  for (const name of ["SUPABASE_URL", "SUPABASE_ANON_KEY"]) assert.equal(BY_NAME.get(name).secret, false, `${name} identifies the project and grants nothing beyond what anyone has`);
  // The hosted-project switches stay closed unless the owner flips them.
  for (const name of ["LIBRARY_ENABLED", "NEXT_PUBLIC_APP_PORTAL_ENABLED", "ASSISTANT_ENABLED", "ASSISTANT_PRODUCTION_APPROVED", "PAPER_TUTOR_ENABLED", "PAPER_MARKER_ENABLED"]) assert.equal(BY_NAME.get(name).held, true, name);
});

test("docs/ENVIRONMENT.md is exactly what the registry generates (run `npm run env:docs` after changing it)", () => {
  assert.equal(read(join(REPO, "docs", "ENVIRONMENT.md")).replace(/\r\n/g, "\n"), renderEnvironmentDoc().replace(/\r\n/g, "\n"));
});

// ---- the validator -----------------------------------------------------------------------------------------------------------------

const LEGACY = (claims) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signaturepart`;
const ANON_JWT = LEGACY({ iss: "supabase-demo", role: "anon" });
const SERVICE_JWT = LEGACY({ iss: "supabase-demo", role: "service_role" });
const HOSTED_ANON = LEGACY({ iss: "supabase", ref: "abcdefghijklmnopqrst", role: "anon" });
const PUB = `sb_publishable_${"A".repeat(24)}`;
const SECRET = `sb_secret_${"B".repeat(24)}`;
const status = (env, mode, name) => checkEnvironment(env, { mode }).rows.find((r) => r.name === name);

test("local: the local stack's values are fine, and each wrong kind of value is named without being shown", () => {
  const local = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: PUB, SUPABASE_SERVICE_ROLE_KEY: SECRET, DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" };
  assert.equal(checkEnvironment(local).failures, 0);
  assert.equal(checkEnvironment({ ...local, SUPABASE_ANON_KEY: ANON_JWT, SUPABASE_SERVICE_ROLE_KEY: SERVICE_JWT }).failures, 0, "the legacy keys are accepted too");
  // The classic mistakes.
  assert.match(status({ ...local, SUPABASE_ANON_KEY: SERVICE_JWT }, "local", "SUPABASE_ANON_KEY").note, /service_role key in the anon slot/);
  assert.match(status({ ...local, SUPABASE_ANON_KEY: SECRET }, "local", "SUPABASE_ANON_KEY").note, /secret key .* in the publishable slot/);
  assert.match(status({ ...local, SUPABASE_SERVICE_ROLE_KEY: PUB }, "local", "SUPABASE_SERVICE_ROLE_KEY").note, /publishable key in the secret slot/);
  assert.match(status({ ...local, SUPABASE_SERVICE_ROLE_KEY: ANON_JWT }, "local", "SUPABASE_SERVICE_ROLE_KEY").note, /anon key in the service_role slot/);
  assert.equal(status({ ...local, SUPABASE_ANON_KEY: "short" }, "local", "SUPABASE_ANON_KEY").status, "MALFORMED");
  assert.equal(status({ ...local, DATABASE_URL: "not a url" }, "local", "DATABASE_URL").status, "MALFORMED");
  assert.equal(status({ ...local, DATABASE_URL: "postgresql://postgres@127.0.0.1:54322/postgres" }, "local", "DATABASE_URL").status, "MALFORMED", "no password");
  // The three Supabase variables go together: any one switches the site to real Supabase.
  assert.equal(status({ SUPABASE_URL: "http://127.0.0.1:54321" }, "local", "DATABASE_URL").status, "MISSING");
  assert.equal(status({}, "local", "DATABASE_URL").status, "absent", "none of them: the in-memory site, nothing is wrong");
});

test("local: anything that points at the hosted project fails, in every kind of variable, unless deliberately allowed", () => {
  const hostedUrl = "https://abcdefghijklmnopqrst.supabase.co";
  const cases = {
    SUPABASE_URL: hostedUrl,
    DATABASE_URL: "postgresql://postgres.abcdefghijklmnopqrst:pw-pw-pw-pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres",
    SUPABASE_ANON_KEY: HOSTED_ANON,
    ASSISTANT_BASE_URL: "https://db.vwsjvdpkgjhwmqmufmrh.supabase.co/x",
    NEXT_PUBLIC_SITE_URL: "https://vwsjvdpkgjhwmqmufmrh.supabase.co",
  };
  for (const [name, value] of Object.entries(cases)) {
    const row = status({ [name]: value }, "local", name);
    assert.equal(row.status, "HOSTED", `${name}: ${row.note}`);
    assert.ok(!row.note.includes(value) && !row.note.includes("abcdefghijklmnopqrst"), "the verdict names a category, not the host or the ref");
  }
  assert.equal(status({ SUPABASE_URL: hostedUrl, CHECK_ENV_ALLOW_HOSTED: "1" }, "local", "SUPABASE_URL").status, "ok", "the explicit override");
  assert.equal(pointsAtHosted("http://127.0.0.1:54321"), null);
  assert.equal(pointsAtHosted(ANON_JWT), null, "the local demo keys carry no project reference");
  assert.ok(pointsAtHosted(HOSTED_ANON));
});

test("production: required variables, forbidden ones, held switches, the pooler and the narrow role", () => {
  const good = { NODE_ENV: "production", SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", SUPABASE_ANON_KEY: PUB, SUPABASE_SERVICE_ROLE_KEY: SECRET, DATABASE_URL: "postgresql://learnthrive_server.abcdefghijklmnopqrst:pw-pw-pw-pw-pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres", RESEND_API_KEY: `re_${"x".repeat(30)}`, RESEND_FROM_EMAIL: "hello@example.com", ENQUIRY_EMAIL: "info@example.com", CAPTCHA_SECRET: "c".repeat(40) };
  const base = checkEnvironment(good, { mode: "production" });
  assert.equal(base.failures, 0, JSON.stringify(base.rows.filter((r) => ["MISSING", "MALFORMED", "FORBIDDEN"].includes(r.status))));
  assert.equal(base.warnings, 0);
  assert.equal(status(good, "production", "LIBRARY_ENABLED").status, "HELD");
  assert.equal(status({}, "production", "SUPABASE_URL").status, "MISSING");
  assert.equal(status({ ...good, STRIPE_FAKE: "1" }, "production", "STRIPE_FAKE").status, "FORBIDDEN");
  assert.equal(status({ ...good, DATABASE_ADMIN_URL: "postgresql://postgres:x@h:5432/p" }, "production", "DATABASE_ADMIN_URL").status, "FORBIDDEN", "operator-only values do not belong on the server");
  assert.equal(status({ ...good, LEARNTHRIVE_SERVER_PASSWORD: "p".repeat(40) }, "production", "LEARNTHRIVE_SERVER_PASSWORD").status, "FORBIDDEN");
  assert.equal(status({ ...good, LIBRARY_ENABLED: "true" }, "production", "LIBRARY_ENABLED").status, "SET", "a held switch that is set is flagged for the owner's confirmation");
  assert.equal(checkEnvironment({ ...good, LIBRARY_ENABLED: "true" }, { mode: "production" }).warnings, 1);
  assert.match(status({ ...good, DATABASE_URL: "postgresql://postgres.abcdefghijklmnopqrst:pw-pw-pw-pw-pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres" }, "production", "DATABASE_URL").note, /narrow learnthrive_server role/);
  assert.match(status({ ...good, DATABASE_URL: "postgresql://learnthrive_server:pw-pw-pw-pw-pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres" }, "production", "DATABASE_URL").note, /transaction pooler/);
  assert.match(status({ ...good, DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db" }, "production", "DATABASE_URL").note, /local address/);
  assert.match(status({ ...good, SUPABASE_URL: "http://127.0.0.1:54321" }, "production", "SUPABASE_URL").note, /local address/);
  assert.match(status({ ...good, ASSISTANT_PROVIDER: "ollama_cloud" }, "production", "ASSISTANT_PROVIDER").note, /only custom qualifies/);
  assert.match(status({ ...good, NEXT_PUBLIC_SITE_URL: "http://example.com" }, "production", "NEXT_PUBLIC_SITE_URL").note, /https/);
});

test("the validator never prints a value, a key or a host, in any verdict", () => {
  const secrets = { SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"Z9".repeat(14)}`, DATABASE_URL: "postgresql://postgres:hunter2-hunter2@127.0.0.1:54322/postgres", RESEND_API_KEY: "re_SuperSecretValueThatMustNeverShowUp1", CAPTCHA_SECRET: "tooShortSecret", STRIPE_SECRET_KEY: "not-a-stripe-key-but-sensitive", SUPABASE_ANON_KEY: "wrong-kind-of-value-in-here" };
  for (const mode of ["local", "production"]) {
    const output = JSON.stringify(checkEnvironment(secrets, { mode }).rows);
    for (const value of Object.values(secrets)) assert.ok(!output.includes(value), `${mode}: a value leaked into the report`);
    assert.ok(!output.includes("hunter2") && !output.includes("SuperSecretValue") && !output.includes("Z9Z9"), mode);
  }
});

test("parsing a .env file: pairs, comments, quotes and export are understood; nothing else", () => {
  const parsed = parseEnvFile(["# a comment", "", "A=1", "export B = two", 'C="quoted value"', "D='single'", "  # E=hidden", "not a pair", "F=has=equals"].join("\n"));
  assert.deepEqual(parsed, { A: "1", B: "two", C: "quoted value", D: "single", F: "has=equals" });
  assert.equal(jwtPayload("not.a.jwt"), null);
  assert.equal(jwtPayload(ANON_JWT).role, "anon");
});

// ---- no secret in the browser -------------------------------------------------------------------------------------------------------

test("no client-side module reads a secret variable or imports the server's database, storage or account runtime", () => {
  const secrets = REGISTRY.filter((v) => v.secret).map((v) => v.name);
  const clientFiles = walk(join(WEB, "src"), (f) => /\.(ts|tsx)$/.test(f) && !isTest(f)).filter((f) => {
    const text = read(f);
    return /^\s*["']use client["']/m.test(text.slice(0, 400)) || /[\\/]src[\\/](components|features|hooks)[\\/]/.test(f);
  });
  assert.ok(clientFiles.length > 50, "found the client modules");
  const offences = [];
  for (const file of clientFiles) {
    const text = read(file);
    for (const name of secrets) if (new RegExp(`\\b${name}\\b`).test(text)) offences.push(`${relative(REPO, file)} mentions ${name}`);
    for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) {
      if (/(^|\/)(lib\/db|lib\/library\/storage|lib\/account\/runtime|lib\/billing\/(runtime|stripe|config))$/.test(m[1]) || m[1] === "postgres" || m[1] === "stripe") offences.push(`${relative(REPO, file)} imports ${m[1]}`);
    }
  }
  assert.deepEqual(offences, []);
});

test("the only variables Next.js can inline into a browser bundle (NEXT_PUBLIC_*) are all non-secret", () => {
  for (const v of REGISTRY.filter((x) => x.name.startsWith("NEXT_PUBLIC_"))) assert.equal(v.secret, false, v.name);
  // next.config.ts must not copy a secret into the client with the `env` option.
  const config = read(join(WEB, "next.config.ts"));
  assert.doesNotMatch(config, /\benv\s*:\s*\{[^}]*(SERVICE_ROLE|DATABASE_URL|SECRET|PASSWORD)/s);
});
