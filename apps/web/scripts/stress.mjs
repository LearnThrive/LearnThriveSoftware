// Local stress test for the production build. Nothing to install: it uses Node's own http, net and child_process.
//
//   npm run build
//   node scripts/stress.mjs                       (everything, about six minutes)
//   node scripts/stress.mjs --only=pages,health   (named scenarios; --list shows them)
//   node scripts/stress.mjs --seconds=4           (shorter steps)
//
// It starts its own `next start` on port 3200 with every email setting blanked and a random CAPTCHA_SECRET, so
// no scenario can send a real email whatever a .env file holds (every form route then answers 503, which is also
// what is measured). It refuses to load anything but this machine: do not point it at the live site.
// --base=http://localhost:3300 uses a server you started yourself; --allow-remote=true overrides the guard, for
// a staging server you own and may load.
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);
const port = Number(options.port ?? 3200);
const base = new URL(options.base ?? `http://localhost:${port}`);
const seconds = Number(options.seconds ?? 8);
const only = options.only ? new Set(options.only.split(",")) : null;
const ownServer = !options.base;

if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) && options["allow-remote"] !== "true") {
  console.error(`Refusing to load ${base.host}: this tool is for your own machine. Start the production build locally.`);
  process.exit(2);
}

// ── the server under test ────────────────────────────────────────────────────────────────────────────

let server = null;

async function startServer() {
  const next = resolve(root, "../../node_modules/next/dist/bin/next");
  if (!existsSync(next) || !existsSync(resolve(root, ".next"))) throw new Error("Run `npm run build` first (and `npm install` at the repo root).");
  server = spawn(process.execPath, [next, "start", "-p", String(port)], {
    cwd: root,
    stdio: "ignore",
    env: {
      ...process.env,
      NODE_ENV: "production",
      RESEND_API_KEY: "",
      RESEND_FROM_EMAIL: "",
      ENQUIRY_EMAIL: "",
      CAREERS_EMAIL: "",
      SUBJECT_REQUEST_EMAIL: "",
      CAPTCHA_SECRET: randomBytes(32).toString("hex"),
    },
  });
  for (let i = 0; i < 60; i += 1) {
    await new Promise((done) => setTimeout(done, 500));
    if ((await send(new http.Agent(), { path: "/api/health" })).status === 200) return;
  }
  throw new Error("The server did not start.");
}

async function stopServer() {
  if (!server) return;
  const stopped = new Promise((done) => server.once("exit", done));
  server.kill();
  await Promise.race([stopped, new Promise((done) => setTimeout(done, 5000))]);
  server = null;
}

async function rssMb() {
  if (!server?.pid) return NaN;
  try {
    if (process.platform === "win32") {
      const { stdout } = await run("tasklist", ["/FI", `PID eq ${server.pid}`, "/FO", "CSV", "/NH"]);
      return Number(stdout.trim().split('","').pop().replace(/\D/g, "")) / 1024;
    }
    return Number((await run("ps", ["-o", "rss=", "-p", String(server.pid)])).stdout) / 1024;
  } catch {
    return NaN;
  }
}

// ── one request, and a closed loop of them ───────────────────────────────────────────────────────────

function send(agent, { method = "GET", path, headers = {}, body }) {
  return new Promise((resolveRequest) => {
    const started = performance.now();
    const request = http.request(
      { agent, host: base.hostname.replace(/^\[|\]$/g, ""), port: base.port, method, path, headers: { ...headers, ...(body ? { "content-length": Buffer.byteLength(body) } : {}) } },
      (response) => {
        response.on("data", () => undefined);
        response.on("end", () => resolveRequest({ status: response.statusCode, ms: performance.now() - started }));
        response.on("error", () => resolveRequest({ status: 0, ms: performance.now() - started, error: "response" }));
      },
    );
    request.setTimeout(30_000, () => request.destroy(Object.assign(new Error("timeout"), { code: "TIMEOUT" })));
    request.on("error", (error) => resolveRequest({ status: 0, ms: performance.now() - started, error: error.code ?? error.message }));
    if (body) request.write(body);
    request.end();
  });
}

const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN);

async function step(name, concurrency, durationS, make) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
  const latencies = [];
  const statuses = new Map();
  const errors = new Map();
  const rss = [await rssMb()];
  const sampler = setInterval(async () => rss.push(await rssMb()), 1000);
  const end = performance.now() + durationS * 1000;
  let n = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (performance.now() < end) {
        const result = await send(agent, make(n++));
        latencies.push(result.ms);
        statuses.set(result.status, (statuses.get(result.status) ?? 0) + 1);
        if (result.error) errors.set(result.error, (errors.get(result.error) ?? 0) + 1);
      }
    }),
  );
  clearInterval(sampler);
  agent.destroy();
  rss.push(await rssMb());
  const elapsed = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const fixed = (value, digits = 0) => (Number.isFinite(value) ? value.toFixed(digits) : "-");
  const peak = Math.max(...rss.filter(Number.isFinite));
  console.log(
    [
      name.padEnd(24),
      String(concurrency).padStart(4),
      `${fixed(latencies.length / elapsed)} req/s`.padStart(13),
      `p50 ${fixed(percentile(latencies, 50), 1)}`.padStart(11),
      `p95 ${fixed(percentile(latencies, 95), 1)}`.padStart(11),
      `p99 ${fixed(percentile(latencies, 99), 1)}`.padStart(11),
      `max ${fixed(latencies[latencies.length - 1], 0)} ms`.padStart(12),
      `rss ${fixed(rss[0])}>${fixed(peak)}>${fixed(rss[rss.length - 1])} MB`.padEnd(24),
      [...statuses].map(([status, count]) => `${status || "ERR"}:${count}`).join(" "),
      errors.size ? `errors ${[...errors].map(([code, count]) => `${code}:${count}`).join(" ")}` : "",
    ].join("  "),
  );
}

// ── scenarios ────────────────────────────────────────────────────────────────────────────────────────

let sequence = 1;
const nextIp = () => {
  const n = sequence++;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
};
// A JSON POST from a made-up address. `body` may be a Buffer built once, so a 50 MB body is not rebuilt per request.
const post = (path, body, address = nextIp()) => ({ method: "POST", path, headers: { "content-type": "application/json", "x-forwarded-for": address }, body: Buffer.isBuffer(body) ? body : JSON.stringify(body) });
const pages = ["/", "/subjects", "/careers", "/careers/maths-tutor", "/faq", "/safeguarding", "/privacy", "/about"];
const enquiry = { parentName: "Stress Test", email: "stress@example.com", phone: "", yearGroup: "Year 8", subject: "Maths", support: "A load test of the enquiry endpoint, which must not send.", contactMethod: "Email" };
const bomb = (megabytes, extra = {}) => Buffer.from(JSON.stringify({ ...extra, pad: "x".repeat(megabytes * 1024 * 1024) }));
let enquiryBomb;
let applyBomb;

async function slowClients(count, holdS) {
  const sockets = Array.from({ length: count }, () => {
    const socket = net.connect({ host: base.hostname.replace(/^\[|\]$/g, ""), port: Number(base.port) });
    socket.on("error", () => undefined);
    socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nX-Slow: "));
    return socket;
  });
  await new Promise((done) => setTimeout(done, 1000));
  const before = await rssMb();
  await step(`slow-clients (${count} held)`, 10, holdS, () => ({ path: "/api/health" }));
  const open = sockets.filter((socket) => !socket.destroyed).length;
  console.log(`${"".padEnd(24)}  ${open} of ${count} half-open connections still held after ${holdS}s; rss before ${before.toFixed(0)} MB`);
  sockets.forEach((socket) => socket.destroy());
}

// Two clients keep posting 50 MB bodies while ten others ask for the cheapest page: does one slow request hurt the rest?
async function bombVersusHealth() {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 2 });
  let running = true;
  const attackers = Array.from({ length: 2 }, async () => {
    while (running) await send(agent, post("/api/enquiry", (enquiryBomb ??= bomb(50, { ...enquiry, website: "x" }))));
  });
  await step("health, during 2 bombs", 10, 8, () => ({ path: "/api/health" }));
  running = false;
  await Promise.all(attackers);
  agent.destroy();
}

const SCENARIOS = [
  { name: "pages", note: "eight public pages, mixed", steps: [1, 10, 50, 100, 200], make: (i) => ({ path: pages[i % pages.length] }) },
  { name: "ssr-apply", note: "a page rendered per request", steps: [10, 50, 100], make: (i) => ({ path: `/careers/apply?role=maths-tutor&n=${i}` }) },
  { name: "health", note: "the cheapest route", steps: [50, 200], make: () => ({ path: "/api/health" }) },
  { name: "notfound", note: "unknown paths", steps: [50], make: (i) => ({ path: `/no-such-page-${i}` }) },
  { name: "challenge-one-client", note: "one address: 40 allowed, then 429", steps: [10], make: () => ({ path: "/api/careers/challenge", headers: { "x-forwarded-for": "198.51.100.7" } }) },
  { name: "challenge-many-clients", note: "new address each time: 600 an hour, then 429", steps: [20], make: () => ({ path: "/api/careers/challenge", headers: { "x-forwarded-for": nextIp() } }) },
  { name: "enquiry-honeypot", note: "valid body, honeypot filled: success without a send", steps: [20], make: () => post("/api/enquiry", { ...enquiry, website: "https://spam.example", elapsedMs: 30_000 }) },
  { name: "enquiry-one-client", note: "control: one address, invalid body: 5 allowed, then 429", steps: [5], make: () => post("/api/enquiry", { nope: true }, "198.51.100.9"), seconds: 3 },
  { name: "enquiry-invalid", note: "invalid body, a new made-up address each time", steps: [20], make: () => post("/api/enquiry", { nope: true }) },
  { name: "closed-forms", note: "application and reconfirmation while closed", steps: [20], make: (i) => post(i % 2 ? "/api/careers/apply" : "/api/safeguarding/reconfirm", { x: 1 }) },
  { name: "body-bomb-enquiry", note: "50 MB JSON to the enquiry route", restart: true, steps: [4], make: () => post("/api/enquiry", (enquiryBomb ??= bomb(50, { ...enquiry, website: "x" }))), seconds: 10 },
  { name: "body-bomb-apply", note: "13 MB to the closed application route", restart: true, steps: [8], make: () => post("/api/careers/apply", (applyBomb ??= bomb(13))), seconds: 10 },
  { name: "enquiry-address-flood", note: "invalid bodies from 100 000+ made-up addresses", restart: true, steps: [50], make: () => post("/api/enquiry", { nope: true }), seconds: 20 },
  { name: "slow-clients", note: "300 half-open connections while normal traffic runs", restart: true, custom: () => slowClients(300, 10) },
  { name: "bomb-vs-health", note: "does a 50 MB body slow everyone else down?", restart: true, custom: bombVersusHealth },
  { name: "soak", note: "three 30 s steps of mixed traffic: does memory settle?", restart: true, steps: [50, 50, 50], seconds: 30, make: (i) => (i % 4 === 0 ? post("/api/enquiry", { ...enquiry, website: "x", elapsedMs: 30_000 }) : { path: pages[i % pages.length] }) },
];

if (options.list) {
  for (const s of SCENARIOS) console.log(`${s.name.padEnd(24)} ${s.note}`);
  process.exit(0);
}

process.on("exit", () => server?.kill());
try {
  if (ownServer) await startServer();
  console.log(`target ${base.origin}, steps of ${seconds}s${ownServer ? ", own production server with email switched off" : ""}\n`);
  console.log("scenario                  conc       rate         p50         p95         p99          max   rss start>peak>end   statuses");
  for (const scenario of SCENARIOS) {
    if (only && !only.has(scenario.name)) continue;
    if (scenario.restart && ownServer) {
      await stopServer();
      await startServer();
    }
    console.log(`\n# ${scenario.name}: ${scenario.note}`);
    if (scenario.custom) await scenario.custom();
    else for (const concurrency of scenario.steps) await step(scenario.name, concurrency, scenario.seconds ?? seconds, scenario.make);
  }
} finally {
  await stopServer();
}
