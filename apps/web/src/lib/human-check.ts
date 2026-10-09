import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { careersConfig } from "@/lib/careers-config";
import {
  leadingZeroBits,
  powInput,
  type PowChallenge,
  type TextChallenge,
} from "@/lib/human-check-core";

/**
 * Server side of the self-built human check (see human-check-core.ts for the idea). Shared by the careers
 * application, the safeguarding reconfirmation and the subject request. Server only.
 *
 * Every challenge is signed with CAPTCHA_SECRET (an HMAC), so the server holds no list of what it issued
 * and a visitor cannot invent or change one. A challenge works ONCE: the ids of those already used are kept
 * in memory until they would have expired. That is correct for a single Render instance; with several, the
 * used-set would need a shared store (docs/RENDER.md). The secret never leaves the server.
 *
 * CAPTCHA_SECRET must be at least 32 characters (use 64 hex characters: `openssl rand -hex 32`). Without a
 * valid one, production refuses to issue challenges (the forms then offer email); development and tests use
 * a random per-process secret so nothing needs configuring locally.
 */

type Env = Record<string, string | undefined>;

const MIN_SECRET_LENGTH = 32;
let ephemeralSecret: Buffer | null = null;

function secretFrom(env: Env): Buffer | null {
  const configured = env.CAPTCHA_SECRET?.trim();
  if (configured && configured.length >= MIN_SECRET_LENGTH) return Buffer.from(configured, "utf8");
  if (env.NODE_ENV === "production") return null;
  ephemeralSecret ??= randomBytes(32);
  return ephemeralSecret;
}

/** Whether challenges can be issued and verified at all (false in production without a valid secret). */
export function humanCheckAvailable(env: Env = process.env): boolean {
  return secretFrom(env) !== null;
}

function sign(secret: Buffer, parts: ReadonlyArray<string | number>): string {
  return createHmac("sha256", secret).update(parts.join("|"), "utf8").digest("base64url");
}

function signaturesMatch(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

const usedChallenges = new Map<string, number>();

function rememberUsed(id: string, expires: number, now: number) {
  usedChallenges.set(id, expires);
  for (const [key, until] of usedChallenges) if (until < now) usedChallenges.delete(key);
}

/** For tests. */
export function resetHumanCheckState() {
  usedChallenges.clear();
}

export interface IssueOptions {
  now?: number;
  env?: Env;
  bits?: number;
}

export function issuePowChallenge({ now = Date.now(), env = process.env, bits = careersConfig.humanCheck.difficultyBits }: IssueOptions = {}): PowChallenge | null {
  const secret = secretFrom(env);
  if (!secret) return null;
  const id = randomBytes(12).toString("base64url");
  const challenge = randomBytes(16).toString("hex");
  const expires = now + careersConfig.humanCheck.ttlMs;
  return { kind: "pow", id, challenge, bits, expires, signature: sign(secret, ["pow", id, challenge, bits, expires]) };
}

export function issueTextChallenge({ now = Date.now(), env = process.env }: IssueOptions = {}): TextChallenge | null {
  const secret = secretFrom(env);
  if (!secret) return null;
  const a = randomInt(2, 10);
  const b = randomInt(2, 10);
  const id = randomBytes(12).toString("base64url");
  const expires = now + careersConfig.humanCheck.ttlMs;
  return {
    kind: "text",
    id,
    question: `What is ${a} plus ${b}? Type the answer as a number.`,
    expires,
    signature: sign(secret, ["text", id, expires, a + b]),
  };
}

export type HumanCheckFailure = "missing" | "malformed" | "unavailable" | "bad-signature" | "expired" | "reused" | "bad-solution";
export type HumanCheckResult = { ok: true } | { ok: false; reason: HumanCheckFailure };

const IDENTIFIER = /^[A-Za-z0-9_-]{8,64}$/;
const SOLUTION = /^[0-9a-z]{1,32}$/;

/** Checks a submitted answer. A valid answer is spent: presenting it again fails with "reused". */
export function verifyHumanCheck(answer: unknown, { now = Date.now(), env = process.env }: { now?: number; env?: Env } = {}): HumanCheckResult {
  if (answer === undefined || answer === null) return { ok: false, reason: "missing" };
  const secret = secretFrom(env);
  if (!secret) return { ok: false, reason: "unavailable" };
  if (typeof answer !== "object") return { ok: false, reason: "malformed" };
  const a = answer as Record<string, unknown>;

  if (typeof a.id !== "string" || !IDENTIFIER.test(a.id)) return { ok: false, reason: "malformed" };
  if (typeof a.signature !== "string" || a.signature.length > 100) return { ok: false, reason: "malformed" };
  if (typeof a.expires !== "number" || !Number.isFinite(a.expires)) return { ok: false, reason: "malformed" };

  if (a.kind === "pow") {
    if (typeof a.challenge !== "string" || !/^[0-9a-f]{32}$/.test(a.challenge)) return { ok: false, reason: "malformed" };
    if (typeof a.bits !== "number" || !Number.isInteger(a.bits) || a.bits < 1 || a.bits > 32) return { ok: false, reason: "malformed" };
    if (typeof a.solution !== "string" || !SOLUTION.test(a.solution)) return { ok: false, reason: "malformed" };
    if (!signaturesMatch(sign(secret, ["pow", a.id, a.challenge, a.bits, a.expires]), a.signature)) return { ok: false, reason: "bad-signature" };
    if (now > a.expires) return { ok: false, reason: "expired" };
    if (usedChallenges.has(a.id)) return { ok: false, reason: "reused" };
    const digest = createHash("sha256").update(powInput(a.challenge, a.solution), "utf8").digest();
    if (leadingZeroBits(digest) < a.bits) return { ok: false, reason: "bad-solution" };
    rememberUsed(a.id, a.expires, now);
    return { ok: true };
  }

  if (a.kind === "text") {
    if (typeof a.answer !== "string" || a.answer.length > 8) return { ok: false, reason: "malformed" };
    if (now > a.expires) return { ok: false, reason: "expired" };
    if (usedChallenges.has(a.id)) return { ok: false, reason: "reused" };
    // One guess per question, right or wrong, so the few possible answers cannot be tried in turn.
    rememberUsed(a.id, a.expires, now);
    const given = Number.parseInt(a.answer.trim(), 10);
    if (!Number.isInteger(given) || String(given) !== a.answer.trim()) return { ok: false, reason: "bad-solution" };
    // A wrong sum and a tampered id both fail the signature; either way the answer is not accepted.
    return signaturesMatch(sign(secret, ["text", a.id, a.expires, given]), a.signature)
      ? { ok: true }
      : { ok: false, reason: "bad-solution" };
  }

  return { ok: false, reason: "malformed" };
}
