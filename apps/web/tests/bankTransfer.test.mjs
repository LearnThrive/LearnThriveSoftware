import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// Paying by bank transfer (docs/TUITION_BILLING.md). Every value in this file is obviously fake: the real bank details live only in the host's
// environment and are never written in code, tests, seed data, documents or logs.

const { getDataProvider, resetDataProvider, SEED_IDS } = loadTsFrom(import.meta.url, "../../../packages/data/src/inMemoryProvider.ts");
const config = loadTsFrom(import.meta.url, "../src/lib/bank/config.ts");
const { SITE_BANK_DETAILS } = loadTsFrom(import.meta.url, "../src/lib/bank/siteBankDetails.ts");
const { bankTransferFor } = loadTsFrom(import.meta.url, "../src/lib/bank/handler.ts");
const { PAYMENT_REFERENCE_PATTERN } = loadTsFrom(import.meta.url, "../../../packages/data/src/paymentReference.ts");
const { REGISTRY, BY_NAME } = await import("../scripts/env-registry.mjs");
const { checkEnvironment } = await import("../scripts/check-env.mjs");

const FAKE = { BANK_PAYEE_NAME: "Test Payee Ltd", BANK_ACCOUNT_NUMBER: "00000000", BANK_SORT_CODE: "000000", BANK_NAME: "Test Bank PLC" };
const without = (env, name) => Object.fromEntries(Object.entries(env).filter(([key]) => key !== name));

// ---- configuration --------------------------------------------------------------------------------------------------------------------

test("config: four well-formed values are read, trimmed, and the sort code is shown 00-00-00", () => {
  const result = config.readBankConfig({ ...FAKE, BANK_PAYEE_NAME: "  Test Payee Ltd  ", BANK_NAME: "Test Bank PLC\t" });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.details, { payeeName: "Test Payee Ltd", accountNumber: "00000000", sortCode: "000000", bankName: "Test Bank PLC" });
  assert.equal(config.formatSortCode("000000"), "00-00-00");
  assert.equal(config.formatSortCode("123456"), "12-34-56");
});

test("config: none set uses the site's own details; some set is an error that names each variable at fault, and never falls back", () => {
  assert.deepEqual(config.readBankConfig({}), { status: "ok", details: SITE_BANK_DETAILS }, "the site's own details");
  assert.deepEqual(config.readBankConfig({ BANK_PAYEE_NAME: "  ", BANK_ACCOUNT_NUMBER: "", BANK_SORT_CODE: "\n", BANK_NAME: " " }), { status: "ok", details: SITE_BANK_DETAILS }, "empty and blank count as not set");
  assert.deepEqual(config.readBankConfig({}, null), { status: "unset" }, "with no fallback there is nothing");
  assert.deepEqual(config.readBankConfig(FAKE).details, { payeeName: "Test Payee Ltd", accountNumber: "00000000", sortCode: "000000", bankName: "Test Bank PLC" }, "all four set: they replace the site's");
  for (const name of Object.keys(FAKE)) {
    const result = config.readBankConfig(without(FAKE, name));
    assert.equal(result.status, "invalid", `${name} missing`);
    assert.deepEqual(result.problems, [`${name} is missing or empty.`]);
    const blank = config.readBankConfig({ ...FAKE, [name]: "   " });
    assert.equal(blank.status, "invalid", `${name} blank`);
  }
  const all = config.readBankConfig({ BANK_NAME: "Test Bank PLC" });
  assert.equal(all.problems.length, 3, "one problem for each of the three missing");
});

test("config: the account number is exactly 8 digits and the sort code exactly 6, nothing else", () => {
  for (const bad of ["0000000", "000000000", "0000 0000", "00-000000", "0000000a", "０００００００", "", "00000000\n0"]) {
    const result = config.readBankConfig({ ...FAKE, BANK_ACCOUNT_NUMBER: bad });
    assert.equal(result.status, "invalid", JSON.stringify(bad));
    assert.match(result.problems.join(" "), /BANK_ACCOUNT_NUMBER/);
  }
  for (const bad of ["00000", "0000000", "00-00-00", "00 00 00", "00000a", ""]) {
    const result = config.readBankConfig({ ...FAKE, BANK_SORT_CODE: bad });
    assert.equal(result.status, "invalid", JSON.stringify(bad));
    assert.match(result.problems.join(" "), /BANK_SORT_CODE/);
  }
  assert.equal(config.readBankConfig({ ...FAKE, BANK_ACCOUNT_NUMBER: "12345678", BANK_SORT_CODE: "123456" }).status, "ok");
  assert.equal(config.readBankConfig({ ...FAKE, BANK_SORT_CODE: "000000 " }).status, "ok", "surrounding whitespace is trimmed, not an error");
});

test("config: names are plain single-line text, at most 80 characters", () => {
  for (const name of ["BANK_PAYEE_NAME", "BANK_NAME"]) {
    assert.equal(config.readBankConfig({ ...FAKE, [name]: "x".repeat(81) }).status, "invalid");
    assert.equal(config.readBankConfig({ ...FAKE, [name]: "x".repeat(80) }).status, "ok");
    assert.equal(config.readBankConfig({ ...FAKE, [name]: "line one\nline two" }).status, "invalid", "no line breaks");
    assert.equal(config.readBankConfig({ ...FAKE, [name]: "bell\u0007" }).status, "invalid", "no control characters");
  }
});

test("config: a message names the variable and what is wrong, and never prints a value", () => {
  const WRONG = { BANK_PAYEE_NAME: "", BANK_ACCOUNT_NUMBER: "WRONG-ACCOUNT-VALUE", BANK_SORT_CODE: "WRONG-SORT-VALUE", BANK_NAME: "Test Bank PLC" };
  const result = config.readBankConfig(WRONG);
  assert.equal(result.status, "invalid");
  const printed = JSON.stringify(result);
  assert.ok(!printed.includes("WRONG-ACCOUNT-VALUE") && !printed.includes("WRONG-SORT-VALUE") && !printed.includes("Test Bank PLC"));
  assert.throws(() => config.assertBankConfig(WRONG), (error) => {
    assert.ok(error instanceof config.BankConfigError);
    assert.match(error.message, /BANK_PAYEE_NAME is missing or empty/);
    assert.match(error.message, /BANK_ACCOUNT_NUMBER must be exactly 8 digits/);
    assert.match(error.message, /BANK_SORT_CODE must be exactly 6 digits/);
    assert.ok(!error.message.includes("WRONG-ACCOUNT-VALUE") && !error.message.includes("WRONG-SORT-VALUE"));
    return true;
  });
});

test("startup: the site's own details are valid; a wrong or partial override stops the server anywhere", () => {
  assert.doesNotThrow(() => config.assertBankConfig({ ...FAKE, NODE_ENV: "production", NEXT_PUBLIC_APP_PORTAL_ENABLED: "true" }));
  for (const env of [{ NODE_ENV: "development" }, { NODE_ENV: "production" }, { NODE_ENV: "production", NEXT_PUBLIC_APP_PORTAL_ENABLED: "true" }]) {
    assert.doesNotThrow(() => config.assertBankConfig(env), `${JSON.stringify(env)}: nothing set, so the site's own details, which must themselves pass the rules`);
  }
  assert.equal(config.readBankConfig({}).status, "ok", "the built-in details pass the same 8-digit, 6-digit, non-empty rules");
  assert.match(SITE_BANK_DETAILS.accountNumber, /^\d{8}$/);
  assert.match(SITE_BANK_DETAILS.sortCode, /^\d{6}$/);
  assert.ok(SITE_BANK_DETAILS.payeeName.trim() && SITE_BANK_DETAILS.bankName.trim());
  for (const env of [{ NODE_ENV: "development" }, { NODE_ENV: "test" }, { NODE_ENV: "production" }]) {
    assert.throws(() => config.assertBankConfig({ ...env, ...FAKE, BANK_SORT_CODE: "12-34-56" }), config.BankConfigError, `${env.NODE_ENV}: partly wrong`);
    assert.throws(() => config.assertBankConfig({ ...env, BANK_NAME: "Test Bank PLC" }), config.BankConfigError, `${env.NODE_ENV}: partly set`);
  }
});

test("the registry knows the four variables: grouped, checked, secret (so the bundle check searches for them), with empty placeholders in .env.example", () => {
  for (const name of Object.keys(FAKE)) {
    const entry = BY_NAME.get(name);
    assert.ok(entry, name);
    assert.equal(entry.group, "bank");
    assert.equal(entry.secret, true);
  }
  assert.equal(BY_NAME.get("BANK_ACCOUNT_NUMBER").check, "digits:8");
  assert.equal(BY_NAME.get("BANK_SORT_CODE").check, "digits:6");
  const status = (env, name) => checkEnvironment(env, { mode: "local" }).rows.find((r) => r.name === name);
  assert.equal(status(FAKE, "BANK_ACCOUNT_NUMBER").status, "ok");
  assert.equal(status({ ...FAKE, BANK_ACCOUNT_NUMBER: "1234" }, "BANK_ACCOUNT_NUMBER").status, "MALFORMED");
  assert.equal(status({ ...FAKE, BANK_SORT_CODE: "12-34-56" }, "BANK_SORT_CODE").status, "MALFORMED");
  assert.ok(!JSON.stringify(checkEnvironment({ ...FAKE, BANK_ACCOUNT_NUMBER: "12345x78" }, { mode: "local" }).rows).includes("12345x78"), "the validator never prints a value");
  assert.ok(REGISTRY.filter((v) => v.secret).map((v) => v.name).includes("BANK_SORT_CODE"));

  const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  for (const name of Object.keys(FAKE)) assert.match(example, new RegExp(`^${name}=$`, "m"), `${name} is an empty placeholder`);
});

// ---- the endpoint ---------------------------------------------------------------------------------------------------------------------

const person = (over) => ({ id: `acct-${over.role}`, email: "x@example.test", name: "Synthetic", ...over });
const parent = (clientId) => person({ role: "CLIENT", roles: ["CLIENT"], id: `acct-parent-${clientId}`, profileId: clientId, clientId });
const admin = person({ role: "ADMIN", roles: ["ADMIN"], id: "acct-admin", profileId: "acct-admin" });
const tutor = person({ role: "TUTOR", roles: ["TUTOR"], profileId: SEED_IDS.tutorJamiePatel, tutorId: SEED_IDS.tutorJamiePatel });
const junior = person({ role: "JUNIOR_TUTOR", roles: ["STUDENT", "JUNIOR_TUTOR"], profileId: SEED_IDS.tutorJuniorSam, tutorId: SEED_IDS.tutorJuniorSam, studentId: SEED_IDS.studentJuniorSam });
const student = person({ role: "STUDENT", roles: ["STUDENT"], profileId: SEED_IDS.studentAyaanAhmed, studentId: SEED_IDS.studentAyaanAhmed });
const tutorAndParent = person({ role: "TUTOR", roles: ["TUTOR", "CLIENT"], profileId: SEED_IDS.tutorJamiePatel, tutorId: SEED_IDS.tutorJamiePatel, clientId: SEED_IDS.clientJuniorParent });

const familyA = SEED_IDS.clientSarahAhmed;
const familyB = SEED_IDS.clientJuniorParent;
const ENV = { ...FAKE };
const noDetailsIn = (body) => {
  const text = JSON.stringify(body);
  for (const value of ["00000000", "00-00-00", "000000", "Test Payee Ltd", "Test Bank PLC"]) assert.ok(!text.includes(value), `the refusal leaked ${value}`);
};

test("endpoint: signed out is 401, and a student, a tutor, a junior tutor and a student who is a junior tutor are 403: none sees a detail", async () => {
  resetDataProvider();
  const { clients } = getDataProvider();
  const signedOut = await bankTransferFor(null, null, clients, ENV);
  assert.equal(signedOut.status, 401);
  noDetailsIn(signedOut.body);
  for (const [who, user] of [["student", student], ["tutor", tutor], ["junior tutor + student", junior]]) {
    for (const asked of [null, familyA, familyB]) {
      const result = await bankTransferFor(user, asked, clients, ENV);
      assert.equal(result.status, 403, `${who} asking for ${asked}`);
      noDetailsIn(result.body);
    }
  }
});

test("endpoint: a parent gets the details and their own family's reference; another family's is 403, never quietly their own", async () => {
  resetDataProvider();
  const { clients } = getDataProvider();
  const own = await bankTransferFor(parent(familyA), null, clients, ENV);
  assert.equal(own.status, 200);
  assert.deepEqual(own.body.bank, { payeeName: "Test Payee Ltd", sortCode: "00-00-00", accountNumber: "00000000", bankName: "Test Bank PLC" });
  assert.match(own.body.reference, PAYMENT_REFERENCE_PATTERN);
  assert.deepEqual(Object.keys(own.body).sort(), ["bank", "reference"], "nothing else: no family id, no other field");

  const named = await bankTransferFor(parent(familyA), familyA, clients, ENV);
  assert.equal(named.status, 200, "naming their own family is fine");
  assert.equal(named.body.reference, own.body.reference);

  const other = await bankTransferFor(parent(familyA), familyB, clients, ENV);
  assert.equal(other.status, 403, "a parent from another family");
  noDetailsIn(other.body);
  assert.ok(!JSON.stringify(other.body).includes(own.body.reference));
  const theirs = await bankTransferFor(parent(familyB), null, clients, ENV);
  assert.notEqual(theirs.body.reference, own.body.reference, "each family has its own");
  for (const odd of ["", "x", "../" + familyA, familyA.toUpperCase(), `${familyA} `, "a".repeat(500)]) {
    assert.equal((await bankTransferFor(parent(familyA), odd, clients, ENV)).status, 403, JSON.stringify(odd.slice(0, 20)));
  }
});

test("endpoint: a parent with no family record is 404, and a tutor who is also a parent sees only their own family's", async () => {
  resetDataProvider();
  const { clients } = getDataProvider();
  const noFamily = person({ role: "CLIENT", roles: ["CLIENT"], profileId: "acct-x" });
  const result = await bankTransferFor({ ...noFamily, profileId: undefined }, null, clients, ENV);
  assert.equal(result.status, 404);
  noDetailsIn(result.body);

  const both = await bankTransferFor(tutorAndParent, null, clients, ENV);
  assert.equal(both.status, 200, "the parent role is enough");
  const asParent = await bankTransferFor(parent(familyB), null, clients, ENV);
  assert.equal(both.body.reference, asParent.body.reference, "their family is the one the parent role stands on, not the tutor record's");
  assert.equal((await bankTransferFor(tutorAndParent, familyA, clients, ENV)).status, 403, "and not another family");
});

test("endpoint: an administrator gets the details, and the reference of the family they name, or none", async () => {
  resetDataProvider();
  const { clients } = getDataProvider();
  const bare = await bankTransferFor(admin, null, clients, ENV);
  assert.equal(bare.status, 200);
  assert.equal(bare.body.reference, null);
  const named = await bankTransferFor(admin, familyA, clients, ENV);
  assert.equal(named.status, 200);
  assert.equal(named.body.reference, (await bankTransferFor(parent(familyA), null, clients, ENV)).body.reference, "the same reference the parent sees");
  assert.equal((await bankTransferFor(admin, "no-such-family", clients, ENV)).status, 404);
});

test("endpoint: with nothing set a parent gets the site's own details (and the same reference)", async () => {
  resetDataProvider();
  const { clients } = getDataProvider();
  const result = await bankTransferFor(parent(familyA), null, clients, {});
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.bank, { ...SITE_BANK_DETAILS, sortCode: config.formatSortCode(SITE_BANK_DETAILS.sortCode) });
  assert.match(result.body.reference, PAYMENT_REFERENCE_PATTERN);
  const override = await bankTransferFor(parent(familyA), null, clients, ENV);
  assert.equal(override.body.bank.accountNumber, "00000000", "the environment replaces them");
  assert.equal(override.body.reference, result.body.reference, "the reference does not depend on the account");
});

test("endpoint: a wrong or partial override is 503 with nothing in it (never the site's details instead), for everyone who is allowed", async () => {
  resetDataProvider();
  const { clients } = getDataProvider();
  for (const env of [{ BANK_NAME: "Test Bank PLC" }, { ...FAKE, BANK_ACCOUNT_NUMBER: "1" }]) {
    for (const user of [parent(familyA), admin]) {
      const result = await bankTransferFor(user, null, clients, env);
      assert.equal(result.status, 503);
      assert.deepEqual(Object.keys(result.body), ["error"]);
      noDetailsIn(result.body);
      assert.ok(!JSON.stringify(result.body).includes(SITE_BANK_DETAILS.accountNumber), "no fallback to the old account");
    }
    assert.equal((await bankTransferFor(student, null, clients, env)).status, 403, "a student is told no before anything about set-up");
  }
});

test("the reference is stable across calls and unique across families, and has the agreed shape", async () => {
  resetDataProvider();
  const data = getDataProvider();
  const created = await Promise.all(Array.from({ length: 30 }, (_, i) => data.clients.create({ name: `Family ${i}`, email: `f${i}@example.test`, active: true })));
  const references = [];
  for (const family of created) {
    const first = await bankTransferFor(parent(family.id), null, data.clients, ENV);
    const again = await bankTransferFor(parent(family.id), null, data.clients, ENV);
    assert.equal(first.body.reference, again.body.reference, "stable");
    assert.match(first.body.reference, /^LT-[A-HJ-NP-Z2-9]{6}$/);
    assert.doesNotMatch(first.body.reference, /[01OI]/, "no 0, O, 1 or I");
    references.push(first.body.reference);
  }
  assert.equal(new Set(references).size, references.length, "unique");
});

// ---- never in the browser, the repository or the logs ---------------------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "dist"].includes(name) || name.startsWith(".next-")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

test("only server code imports the bank configuration: no client component, and nothing under components/ except the panel (which takes props)", () => {
  const src = join(import.meta.dirname, "..", "src");
  const importers = [];
  for (const file of walk(src)) {
    const text = readFileSync(file, "utf8");
    const rel = relative(src, file).replaceAll("\\", "/");
    if (/from\s+["']@\/lib\/bank\//.test(text) || /from\s+["']\.\/(config|handler)["']/.test(text) && rel.startsWith("lib/bank/")) {
      importers.push(rel);
      assert.doesNotMatch(text.slice(0, 400), /^\s*["']use client["']/m, `${rel} is a client component and imports the bank configuration`);
      assert.ok(!/^components\//.test(rel) && !/^features\//.test(rel) && !/^hooks\//.test(rel), `${rel} is browser-side code`);
    }
    // The values themselves are not read anywhere else: one module reads the variables.
    if (!rel.startsWith("lib/bank/") && /\bBANK_(PAYEE_NAME|ACCOUNT_NUMBER|SORT_CODE|NAME)\b/.test(text)) assert.fail(`${rel} mentions a BANK_ variable: only lib/bank/config.ts reads them`);
  }
  assert.ok(importers.some((r) => r.startsWith("app/api/tuition/bank-details")), "the endpoint uses it");
  assert.ok(importers.some((r) => r.includes("dashboard/billing/page")), "the Fees page uses it");
  assert.ok(importers.includes("instrumentation.ts") || readFileSync(join(src, "instrumentation.ts"), "utf8").includes("@/lib/bank/config"), "the startup check uses it");

  const panel = readFileSync(join(src, "components", "billing", "BankTransferPanel.tsx"), "utf8");
  assert.match(panel, /^"use client";/);
  assert.doesNotMatch(panel, /@\/lib\/bank|process\.env|fetch\(/, "the panel only displays what it is given");
});

test("the details are never logged: nothing in lib/bank or the route writes them to a log", () => {
  const dir = join(import.meta.dirname, "..", "src");
  for (const rel of ["lib/bank/config.ts", "lib/bank/handler.ts", "app/api/tuition/bank-details/route.ts"]) {
    const text = readFileSync(join(dir, rel), "utf8");
    assert.doesNotMatch(text, /console\.|logOutcome|logger/, `${rel} does not log`);
  }
});

test("the route exports only GET, never caches, and goes through the one handler", () => {
  const route = readFileSync(join(import.meta.dirname, "..", "src", "app", "api", "tuition", "bank-details", "route.ts"), "utf8");
  assert.deepEqual([...route.matchAll(/export (?:async )?(?:function|const) (\w+)/g)].map((m) => m[1]).sort(), ["GET", "dynamic"]);
  assert.match(route, /dynamic = "force-dynamic"/);
  assert.match(route, /bankTransferFor\(user,/);
  assert.match(route, /getSession\(\)/);
  const proxy = readFileSync(join(import.meta.dirname, "..", "src", "proxy.ts"), "utf8");
  assert.match(proxy, /"\/api\/tuition\/:path\*"/, "closed with the portal");
});

test("the real bank details are written in exactly one file of the repository, and nowhere else: not a test, a document, a seed or a log", () => {
  const repo = join(import.meta.dirname, "..", "..", "..");
  const skip = new Set(["node_modules", ".git", ".next", "dist", "storybook-static", "graphify-out", ".e2e-mirror", "test-results", ".venv", "__pycache__", "LearnThriveContentTest"]);
  const HOME = "apps/web/src/lib/bank/siteBankDetails.ts";
  const real = [SITE_BANK_DETAILS.accountNumber, SITE_BANK_DETAILS.sortCode, config.formatSortCode(SITE_BANK_DETAILS.sortCode)];
  const FAKE_OK = new Set(["00-00-00", "000000", "12-34-56", "123456", "00000000", "12345678", ...real]);
  const where = new Map(real.map((value) => [value, []]));
  const hits = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name) || name.startsWith(".next-")) continue;
      const full = join(dir, name);
      const info = statSync(full);
      if (info.isDirectory()) visit(full);
      else if (/\.(ts|tsx|mjs|js|json|md|sql|yaml|yml|txt|example)$/i.test(name) && info.size < 2_000_000) {
        const text = readFileSync(full, "utf8");
        const rel = relative(repo, full).replaceAll("\\", "/");
        for (const value of real) if (text.includes(value)) where.get(value).push(rel);
        // Any OTHER sort code or account number next to its label must be an obvious placeholder.
        for (const m of text.matchAll(/sort\s*code[^\n]{0,60}?\b(\d{2}[- ]?\d{2}[- ]?\d{2})\b/gi)) if (!FAKE_OK.has(m[1])) hits.push(`${rel}: a sort code`);
        for (const m of text.matchAll(/account\s*(?:number|no\.?)[^\n]{0,60}?\b(\d{8})\b/gi)) if (!FAKE_OK.has(m[1])) hits.push(`${rel}: an account number`);
      }
    }
  };
  visit(repo);
  assert.deepEqual(hits, [], "any other bank details belong only in the host's environment variables");
  for (const [value, files] of where) {
    // The account number and the sort code are written in the one file. The dashed form of the sort code is written nowhere (it is made when shown).
    assert.deepEqual(files, value === config.formatSortCode(SITE_BANK_DETAILS.sortCode) ? [] : [HOME], `one of the real values appears outside ${HOME}`);
  }
});

test("the site's own details are imported only by the bank configuration, and only server code imports that", () => {
  const src = join(import.meta.dirname, "..", "src");
  const importers = walk(src).filter((file) => /siteBankDetails["']/.test(readFileSync(file, "utf8"))).map((f) => relative(src, f).replaceAll("\\", "/"));
  assert.deepEqual(importers, ["lib/bank/config.ts"]);
});

test("the bundle check searches for the site's real account number and sort code (plain and dashed), and its report never prints them", async () => {
  const { siteBankNeedles, scanForLeaks } = await import("../scripts/check-bundle.mjs");
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const needles = siteBankNeedles();
  assert.equal(needles.length, 3);
  const dir = mkdtempSync(join(tmpdir(), "lt-bank-"));
  try {
    mkdirSync(join(dir, "static"), { recursive: true });
    writeFileSync(join(dir, "static", "a.js"), `var a="${SITE_BANK_DETAILS.accountNumber}";`, "latin1");
    writeFileSync(join(dir, "static", "b.js"), `var s="${config.formatSortCode(SITE_BANK_DETAILS.sortCode)}";`, "latin1");
    writeFileSync(join(dir, "static", "c.js"), "var clean = 1;", "latin1");
    const { hits } = scanForLeaks(dir, needles);
    assert.deepEqual(hits.map((h) => `${h.file.replaceAll("\\", "/")}: ${h.label}`).sort(), ["static/a.js: the site's bank account number", "static/b.js: the site's bank sort code (dashed)"]);
    const printed = JSON.stringify(hits);
    assert.ok(!printed.includes(SITE_BANK_DETAILS.accountNumber) && !printed.includes(SITE_BANK_DETAILS.sortCode), "labels describe, never print");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
