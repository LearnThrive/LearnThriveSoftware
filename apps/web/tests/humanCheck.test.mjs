import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The self-built human check: a signed, expiring, one-use SHA-256 proof of work, and a signed short sum as a
// fallback. Solved here with node:crypto, the same hash the browser's Web Worker computes.

const core = loadTsFrom(import.meta.url, "../src/lib/human-check-core.ts");
const check = loadTsFrom(import.meta.url, "../src/lib/human-check.ts");

const SECRET = "a-test-secret-that-is-at-least-thirty-two-characters-long";
const env = { CAPTCHA_SECRET: SECRET, NODE_ENV: "test" };
const BITS = 8; // quick to solve in a test

function solve(challenge, bits) {
  for (let n = 0; n < 10_000_000; n += 1) {
    const solution = String(n);
    const digest = createHash("sha256").update(core.powInput(challenge, solution), "utf8").digest();
    if (core.leadingZeroBits(digest) >= bits) return solution;
  }
  throw new Error("no solution found");
}

function answerFor(challenge, overrides = {}) {
  return { ...challenge, solution: solve(challenge.challenge, challenge.bits), ...overrides };
}

test.beforeEach(() => check.resetHumanCheckState());

test("leadingZeroBits counts zero bits from the start of a hash", () => {
  assert.equal(core.leadingZeroBits(Uint8Array.from([0xff])), 0);
  assert.equal(core.leadingZeroBits(Uint8Array.from([0x80])), 0);
  assert.equal(core.leadingZeroBits(Uint8Array.from([0x40])), 1);
  assert.equal(core.leadingZeroBits(Uint8Array.from([0x01])), 7);
  assert.equal(core.leadingZeroBits(Uint8Array.from([0x00, 0x00, 0x10])), 19);
  assert.equal(core.leadingZeroBits(Uint8Array.from([0x00, 0x00])), 16);
});

test("a correct solution is accepted once, and only once", () => {
  const challenge = check.issuePowChallenge({ env, bits: BITS });
  assert.equal(challenge.kind, "pow");
  assert.equal(challenge.bits, BITS);
  const answer = answerFor(challenge);
  assert.deepEqual(check.verifyHumanCheck(answer, { env }), { ok: true });
  assert.deepEqual(check.verifyHumanCheck(answer, { env }), { ok: false, reason: "reused" });
});

test("a wrong solution is refused, and does not spend the challenge", () => {
  const challenge = check.issuePowChallenge({ env, bits: 16 });
  const good = solve(challenge.challenge, challenge.bits);
  let bad = "1";
  while (bad === good || core.leadingZeroBits(createHash("sha256").update(core.powInput(challenge.challenge, bad)).digest()) >= 16) bad = String(Number(bad) + 1);
  assert.deepEqual(check.verifyHumanCheck({ ...challenge, solution: bad }, { env }), { ok: false, reason: "bad-solution" });
  assert.deepEqual(check.verifyHumanCheck({ ...challenge, solution: good }, { env }), { ok: true });
});

test("an expired challenge is refused", () => {
  const issuedAt = 1_000_000;
  const challenge = check.issuePowChallenge({ env, bits: BITS, now: issuedAt });
  const answer = answerFor(challenge);
  assert.deepEqual(check.verifyHumanCheck(answer, { env, now: challenge.expires + 1 }), { ok: false, reason: "expired" });
  assert.deepEqual(check.verifyHumanCheck(answer, { env, now: challenge.expires - 1 }), { ok: true });
});

test("a tampered challenge, difficulty, expiry, id or signature is refused", () => {
  const challenge = check.issuePowChallenge({ env, bits: BITS });
  const answer = answerFor(challenge);
  const other = check.issuePowChallenge({ env, bits: BITS });
  const attempts = [
    { ...answer, bits: 1 }, // an easier puzzle than was issued
    { ...answer, expires: answer.expires + 60_000 },
    { ...answer, challenge: other.challenge },
    { ...answer, id: other.id },
    { ...answer, signature: other.signature },
    { ...answer, signature: answer.signature.slice(0, -2) + "AA" },
  ];
  for (const attempt of attempts) {
    const result = check.verifyHumanCheck(attempt, { env });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "bad-signature");
  }
  assert.deepEqual(check.verifyHumanCheck(answer, { env }), { ok: true }, "the genuine answer still works");
});

test("an answer signed with a different secret is refused", () => {
  const challenge = check.issuePowChallenge({ env: { ...env, CAPTCHA_SECRET: `${SECRET}-other-instance` }, bits: BITS });
  const result = check.verifyHumanCheck(answerFor(challenge), { env });
  assert.deepEqual(result, { ok: false, reason: "bad-signature" });
});

test("missing, malformed and hostile input is refused without throwing", () => {
  for (const input of [undefined, null]) assert.deepEqual(check.verifyHumanCheck(input, { env }), { ok: false, reason: "missing" });
  const challenge = check.issuePowChallenge({ env, bits: BITS });
  const answer = answerFor(challenge);
  const malformed = [
    "text",
    42,
    {},
    { ...answer, kind: "other" },
    { ...answer, id: "x" },
    { ...answer, id: 5 },
    { ...answer, signature: 5 },
    { ...answer, expires: "soon" },
    { ...answer, expires: Number.NaN },
    { ...answer, challenge: "not hex" },
    { ...answer, bits: 0 },
    { ...answer, bits: 99 },
    { ...answer, bits: 8.5 },
    { ...answer, solution: "../../" },
    { ...answer, solution: "" },
    { ...answer, solution: "9".repeat(40) },
  ];
  for (const input of malformed) assert.equal(check.verifyHumanCheck(input, { env }).ok, false, JSON.stringify(input).slice(0, 80));
});

test("the text fallback: the right sum is accepted once; a wrong sum is refused and spends the question", () => {
  const question = check.issueTextChallenge({ env });
  assert.equal(question.kind, "text");
  const [, a, b] = /What is (\d+) plus (\d+)\?/.exec(question.question);
  const sum = String(Number(a) + Number(b));
  const base = { kind: "text", id: question.id, expires: question.expires, signature: question.signature };
  assert.deepEqual(check.verifyHumanCheck({ ...base, answer: sum }, { env }), { ok: true });
  assert.deepEqual(check.verifyHumanCheck({ ...base, answer: sum }, { env }), { ok: false, reason: "reused" });

  const second = check.issueTextChallenge({ env });
  const [, c, d] = /What is (\d+) plus (\d+)\?/.exec(second.question);
  const wrong = String(Number(c) + Number(d) + 1);
  const secondBase = { kind: "text", id: second.id, expires: second.expires, signature: second.signature };
  assert.equal(check.verifyHumanCheck({ ...secondBase, answer: wrong }, { env }).ok, false);
  assert.deepEqual(check.verifyHumanCheck({ ...secondBase, answer: String(Number(c) + Number(d)) }, { env }), { ok: false, reason: "reused" }, "one guess per question");
});

test("the text fallback refuses odd answers and a signature from a pow challenge", () => {
  const question = check.issueTextChallenge({ env });
  const base = { kind: "text", id: question.id, expires: question.expires, signature: question.signature };
  for (const answer of ["", "abc", "1e1", "07", "12345678901"]) {
    check.resetHumanCheckState();
    assert.equal(check.verifyHumanCheck({ ...base, answer }, { env }).ok, false, answer);
  }
  check.resetHumanCheckState();
  const pow = check.issuePowChallenge({ env, bits: BITS });
  assert.equal(check.verifyHumanCheck({ kind: "text", id: pow.id, expires: pow.expires, signature: pow.signature, answer: "10" }, { env }).ok, false);
});

test("production without a valid secret issues nothing and verifies nothing; development works with none", () => {
  const production = { NODE_ENV: "production" };
  assert.equal(check.humanCheckAvailable(production), false);
  assert.equal(check.issuePowChallenge({ env: production }), null);
  assert.equal(check.issueTextChallenge({ env: production }), null);
  assert.equal(check.humanCheckAvailable({ NODE_ENV: "production", CAPTCHA_SECRET: "too-short" }), false);
  assert.equal(check.humanCheckAvailable({ NODE_ENV: "production", CAPTCHA_SECRET: SECRET }), true);
  assert.deepEqual(check.verifyHumanCheck({ kind: "pow" }, { env: production }), { ok: false, reason: "unavailable" });

  const dev = { NODE_ENV: "development" };
  assert.equal(check.humanCheckAvailable(dev), true);
  const challenge = check.issuePowChallenge({ env: dev, bits: BITS });
  assert.deepEqual(check.verifyHumanCheck(answerFor(challenge), { env: dev }), { ok: true });
});

test("the secret is never part of what is sent to the browser", () => {
  const challenge = check.issuePowChallenge({ env, bits: BITS });
  assert.ok(!JSON.stringify(challenge).includes(SECRET));
  assert.deepEqual(Object.keys(challenge).sort(), ["bits", "challenge", "expires", "id", "kind", "signature"]);
  const text = check.issueTextChallenge({ env });
  assert.deepEqual(Object.keys(text).sort(), ["expires", "id", "kind", "question", "signature"]);
});

test("the shipped difficulty is a sensible number of bits", async () => {
  const { careersConfig } = loadTsFrom(import.meta.url, "../src/lib/careers-config.ts");
  assert.ok(careersConfig.humanCheck.difficultyBits >= 14 && careersConfig.humanCheck.difficultyBits <= 22);
});
