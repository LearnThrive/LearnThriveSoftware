import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { compileFunction } from "node:vm";
import ts from "typescript";

// Same "compile the real TypeScript source" approach as tests/enquiry.test.mjs — works on the
// supported Node 20 releases, which cannot import TypeScript directly. Extended here (unlike
// enquiry.test.mjs's route file, which has no relative imports of its own) to resolve a
// module's *own* relative TypeScript imports recursively — devProvider.ts imports
// "./passwords", which a require() anchored to this test file would never find.
const moduleCache = new Map();

function loadTsModule(fileUrl) {
  const cacheKey = fileUrl.href;
  if (moduleCache.has(cacheKey)) return moduleCache.get(cacheKey);

  const source = readFileSync(fileUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const nodeRequire = createRequire(fileUrl);
  const scopedRequire = (specifier) => {
    if (specifier.startsWith(".")) return loadTsModule(new URL(`${specifier}.ts`, fileUrl));
    return nodeRequire(specifier); // bare specifier (node:*, an npm package) — real Node resolution
  };

  const fakeModule = { exports: {} };
  moduleCache.set(cacheKey, fakeModule.exports); // set before executing, in case of circular imports
  compileFunction(compiled, ["require", "module", "exports"])(scopedRequire, fakeModule, fakeModule.exports);
  moduleCache.set(cacheKey, fakeModule.exports);
  return fakeModule.exports;
}

function loadModule(relativePath) {
  return loadTsModule(new URL(relativePath, import.meta.url));
}

const { hashPassword, verifyPassword } = loadModule("../src/lib/auth/passwords.ts");

test("hashPassword produces a verifiable, non-reversible hash", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.notEqual(hash, "correct horse battery staple");
  assert.match(hash, /^scrypt:[0-9a-f]+:[0-9a-f]+$/);
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("wrong password", hash), false);
});

test("hashPassword salts each call differently, even for the same password", async () => {
  const hashA = await hashPassword("same-password");
  const hashB = await hashPassword("same-password");
  assert.notEqual(hashA, hashB);
  assert.equal(await verifyPassword("same-password", hashA), true);
  assert.equal(await verifyPassword("same-password", hashB), true);
});

test("verifyPassword rejects malformed/foreign hash formats instead of throwing", async () => {
  assert.equal(await verifyPassword("anything", "not-a-real-hash"), false);
  assert.equal(await verifyPassword("anything", "bcrypt:abc:def"), false);
  assert.equal(await verifyPassword("anything", ""), false);
});

// The dev credential store's production guard (assertNotProductionWithoutRealProvider) is only
// called from getAuthProvider(), not at module load or from the DevelopmentAuthProvider
// constructor itself, so it's safe to instantiate directly here without that guard tripping.
const { DevelopmentAuthProvider } = loadModule("../src/lib/auth/devProvider.ts");

test("DevelopmentAuthProvider: valid credentials succeed and return the expected role", async () => {
  const provider = new DevelopmentAuthProvider();
  const result = await provider.verifyCredentials("tutor@learnthrive.dev", "dev-tutor-pass");
  assert.equal(result.ok, true);
  assert.equal(result.user.role, "TUTOR");
  assert.equal(result.user.email, "tutor@learnthrive.dev");
});

test("DevelopmentAuthProvider: wrong password is rejected", async () => {
  const provider = new DevelopmentAuthProvider();
  const result = await provider.verifyCredentials("tutor@learnthrive.dev", "not-the-password");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_credentials");
});

test("DevelopmentAuthProvider: unknown account gets the same failure reason as a wrong password", async () => {
  const provider = new DevelopmentAuthProvider();
  const result = await provider.verifyCredentials("nobody@learnthrive.dev", "whatever");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_credentials");
});

test("DevelopmentAuthProvider: a disabled account with the correct password gets a distinct reason", async () => {
  const provider = new DevelopmentAuthProvider();
  const result = await provider.verifyCredentials("disabled@learnthrive.dev", "dev-disabled-pass");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "account_disabled");
});

test("DevelopmentAuthProvider: email matching is case-insensitive", async () => {
  const provider = new DevelopmentAuthProvider();
  const result = await provider.verifyCredentials("TUTOR@LearnThrive.DEV", "dev-tutor-pass");
  assert.equal(result.ok, true);
});

test("all four primary seed accounts (admin/tutor/client/student) log in with their documented passwords", async () => {
  const provider = new DevelopmentAuthProvider();
  const accounts = [
    ["admin@learnthrive.dev", "dev-admin-pass", "ADMIN"],
    ["tutor@learnthrive.dev", "dev-tutor-pass", "TUTOR"],
    ["client@learnthrive.dev", "dev-client-pass", "CLIENT"],
    ["student@learnthrive.dev", "dev-student-pass", "STUDENT"],
  ];
  for (const [email, password, role] of accounts) {
    const result = await provider.verifyCredentials(email, password);
    assert.equal(result.ok, true, `${email} should log in`);
    assert.equal(result.user.role, role);
  }
});
