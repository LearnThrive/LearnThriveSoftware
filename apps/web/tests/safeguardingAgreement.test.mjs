import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The safeguarding agreement: its structure, the writing rules it was drafted under, the owner-approval
// gate, the understanding check, the typed-name rule and the record that goes into the emails.

const agreementModule = loadTsFrom(import.meta.url, "../src/lib/safeguarding-agreement.ts");
const recordModule = loadTsFrom(import.meta.url, "../src/lib/agreement-record.ts");
const { careersConfig } = loadTsFrom(import.meta.url, "../src/lib/careers-config.ts");
const {
  agreementCanonicalText,
  agreementVersions,
  checkUnderstanding,
  clauseIdsOf,
  currentAgreement,
  normaliseName,
  partIds,
  typedNameMatches,
  unapprovedClauseIds,
} = agreementModule;

const allClauses = currentAgreement.parts.flatMap((part) => part.clauses);

test("the agreement has parts A to G, unique clause ids numbered in order, and text in every clause", () => {
  assert.deepEqual(partIds(currentAgreement), ["A", "B", "C", "D", "E", "F", "G"]);
  const ids = allClauses.map((clause) => clause.id);
  assert.equal(new Set(ids).size, ids.length, "clause ids are unique");
  for (const part of currentAgreement.parts) {
    part.clauses.forEach((clause, index) => {
      assert.equal(clause.id, `${part.id}${index + 1}`, `${clause.id} is out of order`);
      assert.ok(clause.text.length > 20, `${clause.id} has text`);
    });
  }
});

test("clauses use no hedging words (the writing rules): try, where possible, normally, generally, reasonable, appropriate, should", () => {
  const hedge = /\b(try|tries|trying|where possible|normally|generally|reasonable|reasonably|appropriate|appropriately|should|aim to)\b/i;
  for (const clause of allClauses) {
    for (const piece of [clause.text, ...(clause.items ?? [])]) assert.doesNotMatch(piece, hedge, `${clause.id}: ${piece}`);
  }
});

test("every clause is a first-person obligation or an acknowledgement, never a vague wish", () => {
  const firstPerson = /^(I |Every lesson will|These expectations|This agreement applies|Everything I have told|Where the curriculum|If |For as long as|After I|When a child|A safeguarding concern includes|Nothing)/;
  for (const clause of allClauses) assert.match(clause.text, firstPerson, `${clause.id}: ${clause.text.slice(0, 50)}`);
});

test("the named leads and the key timings are stated exactly", () => {
  const text = agreementCanonicalText(currentAgreement);
  assert.match(text, /Safeguarding lead: Tahasin Hasan/);
  assert.match(text, /Deputy safeguarding lead: Abdurrahman Mustafa/);
  assert.match(text, /Same day|The same day: Before midnight, UK time/);
  assert.match(text, /A1\. I will report any safeguarding concern to the safeguarding lead, Tahasin Hasan, immediately, and never later than the same day/);
  assert.match(text, /F4\. I will not teach, or have any contact with, any LearnThrive student until every check is complete\./);
});

test("the owner-approval gate: the agreement can be marked approved only when every clause is", () => {
  const unapproved = unapprovedClauseIds(currentAgreement);
  if (careersConfig.agreementApprovedByOwner) {
    assert.deepEqual(unapproved, [], `agreementApprovedByOwner is true but these clauses are not approved: ${unapproved.join(", ")}`);
  }
  // As shipped, the gate is closed and the clauses still waiting for the owner are the proposals.
  assert.equal(careersConfig.agreementApprovedByOwner, false, "the gate ships closed");
  assert.ok(unapproved.length > 0);
});

test("only clauses that restate a confirmed owner decision are marked approved, and each says which", () => {
  const approved = allClauses.filter((clause) => clause.ownerApproved);
  assert.deepEqual(approved.map((clause) => clause.id), ["A1", "F1", "F2", "F4", "G1", "G6"]);
  for (const clause of approved) assert.ok(clause.confirmed && clause.confirmed.length > 20, `${clause.id} names its basis`);
});

test("the understanding check has six questions, each from real clauses, one correct answer, not always in the same place", () => {
  const questions = currentAgreement.understanding;
  assert.equal(questions.length, 6);
  const clauseIds = new Set(allClauses.map((clause) => clause.id));
  for (const question of questions) {
    assert.ok(question.options.length >= 3);
    assert.equal(question.options.filter((option) => option.id === question.correctOptionId).length, 1);
    for (const clauseId of question.clauseIds) assert.ok(clauseIds.has(clauseId), `${question.id} cites ${clauseId}`);
  }
  assert.ok(new Set(questions.map((question) => question.correctOptionId)).size >= 3, "the right answer moves around");
});

test("checkUnderstanding needs all six right, names the ones to look at again, and ignores bad input", () => {
  const right = Object.fromEntries(currentAgreement.understanding.map((question) => [question.id, question.correctOptionId]));
  assert.deepEqual(checkUnderstanding(currentAgreement, right), { ok: true, needsAnotherLook: [] });

  const first = currentAgreement.understanding[0];
  const wrongOption = first.options.find((option) => option.id !== first.correctOptionId).id;
  const oneWrong = { ...right, [first.id]: wrongOption };
  assert.deepEqual(checkUnderstanding(currentAgreement, oneWrong), { ok: false, needsAnotherLook: [first.id] });

  const oneMissing = { ...right };
  delete oneMissing[first.id];
  assert.deepEqual(checkUnderstanding(currentAgreement, oneMissing).needsAnotherLook, [first.id]);
  assert.equal(checkUnderstanding(currentAgreement, {}).needsAnotherLook.length, 6);
  assert.equal(checkUnderstanding(currentAgreement, null).ok, false);
  assert.equal(checkUnderstanding(currentAgreement, { ...right, [first.id]: 42 }).ok, false);
  assert.equal(checkUnderstanding(currentAgreement, { ...right, [first.id]: "zz" }).ok, false);
});

test("a typed name matches the first and last name ignoring case, spacing, curly apostrophes and typographic hyphens", () => {
  assert.equal(typedNameMatches("jane smith", "Jane", "Smith"), true);
  assert.equal(typedNameMatches("  JANE   SMITH ", "Jane", "Smith"), true);
  assert.equal(typedNameMatches("Sinéad O’Brien", "Sinéad", "O'Brien"), true);
  assert.equal(typedNameMatches("Anne‑Marie Jones", "Anne-Marie", "Jones"), true);
  assert.equal(typedNameMatches("Jane", "Jane", "Smith"), false);
  assert.equal(typedNameMatches("Jane Smyth", "Jane", "Smith"), false);
  assert.equal(typedNameMatches("Smith Jane", "Jane", "Smith"), false);
  assert.equal(typedNameMatches("", "", ""), false);
  assert.equal(normaliseName("  A  B "), "a b");
});

test("clauseIdsOf lists the clauses of the parts given", () => {
  assert.deepEqual(clauseIdsOf(currentAgreement, ["F"]), currentAgreement.parts.find((part) => part.id === "F").clauses.map((clause) => clause.id));
  assert.equal(clauseIdsOf(currentAgreement).length, allClauses.length);
});

test("the canonical text covers the version, every definition, every clause and every bullet, and is stable", () => {
  const text = agreementCanonicalText(currentAgreement);
  assert.equal(text, agreementCanonicalText(currentAgreement));
  assert.match(text, new RegExp(`Version ${currentAgreement.version}`));
  for (const definition of currentAgreement.definitions) assert.ok(text.includes(`${definition.term}: ${definition.meaning}`));
  for (const clause of allClauses) {
    assert.ok(text.includes(`${clause.id}. ${clause.text}`), clause.id);
    for (const item of clause.items ?? []) assert.ok(text.includes(`- ${item}`));
  }
});

test("the agreement record: parts and clause ids confirmed, check result, server time and the SHA-256 of the exact text", () => {
  const receivedAt = new Date("2026-10-09T12:34:56.789Z");
  const record = recordModule.buildAgreementRecord(currentAgreement, {
    typedName: "  Jane   Smith ",
    confirmedParts: ["A", "B", "C", "D", "E", "F", "G", "Z"],
    understandingPassed: true,
    receivedAt,
  });
  assert.equal(record.version, currentAgreement.version);
  assert.equal(record.typedName, "Jane Smith");
  assert.deepEqual(record.confirmedParts, ["A", "B", "C", "D", "E", "F", "G"]);
  assert.deepEqual(record.confirmedClauseIds, allClauses.map((clause) => clause.id));
  assert.equal(record.receivedAt, "2026-10-09T12:34:56.789Z");
  assert.equal(record.sha256, createHash("sha256").update(agreementCanonicalText(currentAgreement), "utf8").digest("hex"));
  assert.equal(recordModule.agreementHash(currentAgreement), record.sha256);

  const lines = Object.fromEntries(recordModule.agreementRecordLines(record));
  assert.equal(lines["Understanding check"], "Passed");
  assert.equal(lines["Agreement text SHA-256"], record.sha256);
  assert.ok(!JSON.stringify(record).toLowerCase().includes("ip"), "no address is recorded");

  const partial = recordModule.buildAgreementRecord(currentAgreement, { typedName: "A B", confirmedParts: ["A"], understandingPassed: null, receivedAt });
  assert.deepEqual(partial.confirmedParts, ["A"]);
  assert.equal(Object.fromEntries(recordModule.agreementRecordLines(partial))["Understanding check"], "Not part of this submission");
});

test("a published version never changes: its recorded hash must match its text", () => {
  for (const agreement of Object.values(agreementVersions)) {
    if (agreement.publishedHash === null) continue; // still a draft
    assert.equal(recordModule.agreementHash(agreement), agreement.publishedHash, `version ${agreement.version} was edited after it was published; issue a new version instead`);
  }
});

test("the registry holds the current version, and the current version is the newest", () => {
  assert.ok(agreementVersions[currentAgreement.version]);
  assert.equal(agreementModule.CURRENT_AGREEMENT_VERSION, currentAgreement.version);
});

// ── single source ────────────────────────────────────────────────────────────────────────────────────

const srcDir = resolve(import.meta.dirname, "..", "src");
function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(?:ts|tsx)$/.test(name) ? [full] : [];
  });
}

test("pages, forms, routes and emails read the agreement through the shared module, never from a version file", () => {
  const consumers = [
    "components/careers/AgreementDocument.tsx",
    "components/careers/AgreementSection.tsx",
    "components/careers/ReconfirmForm.tsx",
    "components/careers/apply/ApplicationForm.tsx",
    "app/(public)/careers/safeguarding-agreement/page.tsx",
    "app/api/careers/apply/route.ts",
    "app/api/safeguarding/reconfirm/route.ts",
    "lib/careers-validation.ts",
    "lib/careers-apply-email.ts",
    "lib/reconfirm.ts",
    "lib/agreement-record.ts",
  ];
  for (const name of consumers) {
    const source = readFileSync(join(srcDir, name), "utf8");
    assert.match(source, /from "@\/lib\/(?:safeguarding-agreement|agreement-record)"/, `${name} reads the agreement through the shared module`);
  }
  // Only the registry imports a version file, so a new version is added in one place.
  const versionImport = /from\s+["'][^"']*safeguarding-agreement-v\d+["']/;
  for (const file of sourceFiles(srcDir)) {
    const name = relative(srcDir, file).replaceAll("\\", "/");
    if (name === "lib/safeguarding-agreement.ts") continue;
    assert.doesNotMatch(readFileSync(file, "utf8"), versionImport, `${name} imports a version file directly`);
  }
});

test("the agreement's words live in one file: no other source repeats a clause", () => {
  const distinctive = [
    "I will report any safeguarding concern to the safeguarding lead",
    "I will never promise a child that I will keep something secret",
    "I will not record, photograph, screenshot, transcribe",
  ];
  for (const file of sourceFiles(srcDir)) {
    const name = relative(srcDir, file).replaceAll("\\", "/");
    if (name === "lib/safeguarding-agreement-v1.ts") continue;
    const source = readFileSync(file, "utf8");
    for (const sentence of distinctive) assert.ok(!source.includes(sentence), `${name} repeats agreement wording`);
  }
});
