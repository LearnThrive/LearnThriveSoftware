import { createHash } from "node:crypto";
import { loadTsFrom } from "./_tsLoader.mjs";

// Shared by the route tests (reconfirmation, subject request): environment control, a recorder in place of
// the email network call, a solved human check, and a JSON request builder.

export const { careersConfig } = loadTsFrom(import.meta.url, "../src/lib/careers-config.ts");
const check = loadTsFrom(import.meta.url, "../src/lib/human-check.ts");
const core = loadTsFrom(import.meta.url, "../src/lib/human-check-core.ts");

export const SECRET = "a-test-secret-that-is-at-least-thirty-two-characters-long";
export const ENV_KEYS = ["NODE_ENV", "CAREERS_OPEN_FOR_TESTING", "CAPTCHA_SECRET", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "CAREERS_EMAIL", "SUBJECT_REQUEST_EMAIL", "ENQUIRY_EMAIL", "ALLOWED_ORIGINS", "TRUSTED_PROXY_HOPS", "CLIENT_IP_HEADER"];
export const OPEN = { CAREERS_OPEN_FOR_TESTING: "1", CAPTCHA_SECRET: SECRET, RESEND_API_KEY: "re_test_key" };

/** Sets the environment (and the agreement gate) for one test and puts both back afterwards. */
export function environment(t, values) {
  const before = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const gate = careersConfig.agreementApprovedByOwner;
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) if (value !== undefined) process.env[key] = value;
  check.resetHumanCheckState();
  t.after(() => {
    for (const key of ENV_KEYS) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
    careersConfig.agreementApprovedByOwner = gate;
  });
}

let ipCounter = 100;
export const nextIp = () => `192.0.2.${(ipCounter += 1)}`;

function solve(challenge) {
  for (let n = 0; ; n += 1) {
    const solution = String(n);
    if (core.leadingZeroBits(createHash("sha256").update(core.powInput(challenge.challenge, solution)).digest()) >= challenge.bits) return solution;
  }
}

export function humanCheck() {
  const challenge = check.issuePowChallenge({ bits: 6 });
  return challenge ? { ...challenge, solution: solve(challenge) } : { kind: "pow" };
}

/** Replaces fetch with a recorder of what would be emailed. `outcomes` lists the status for each call. */
export function mockEmail(t, outcomes = []) {
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    sent.push({ url: String(url), body: JSON.parse(options.body) });
    const status = outcomes[sent.length - 1] ?? 200;
    return status === 200 ? Response.json({ id: `email-${sent.length}` }) : Response.json({ name: "internal_server_error", message: "no" }, { status });
  });
  return sent;
}

/** Captures console output (so a test can check it holds nothing personal) and silences the Resend SDK. */
export function quiet(t) {
  const lines = [];
  t.mock.method(console, "info", (line) => lines.push(String(line)));
  t.mock.method(console, "warn", (line) => lines.push(String(line)));
  t.mock.method(console, "error", () => undefined);
  return lines;
}

/** A JSON POST. `body` is merged over `base`; keys set to undefined are removed. */
export function jsonRequest(url, base, body = {}, { ip = nextIp(), headers = {} } = {}) {
  const merged = { website: "", elapsedMs: 60_000, humanCheck: humanCheck(), ...base, ...body };
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1`, ...headers },
    body: JSON.stringify(merged),
  });
}
