import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The safeguarding records (docs/SAFEGUARDING_RECORDS.md) have two rules that must not erode:
//   1. a tutor's vetting record is for administrators only;
//   2. a concern is read only by a NAMED safeguarding lead. Being an administrator is not enough, and the person who raised it does
//      not get it back.
// The rules themselves are proven on the data layer (packages/data safeguardingContract). These tests hold the web layer to them:
// nothing reaches the records except through the guarded pages and actions, and no page reads a concern around the lead check.

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "src");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const rel = (file) => relative(src, file).split(sep).join("/");
const read = (path) => readFileSync(join(src, ...path.split("/")), "utf8");

const ALLOWED = (path) =>
  path.startsWith("app/(app)/dashboard/admin/vetting/") || path.startsWith("app/(app)/dashboard/admin/concerns/") || path === "app/(app)/dashboard/concerns/page.tsx" ||
  path === "app/(app)/dashboard/admin/tutors/[id]/page.tsx" || path === "components/people/VettingCard.tsx" || path === "lib/actions/safeguarding.ts" ||
  path.startsWith("lib/safeguarding/");

test("only the guarded safeguarding pages, their actions and the runtime import the safeguarding records", () => {
  const SAFEGUARDING = /@learnthrive\/data\/safeguarding|@\/lib\/safeguarding\/|@\/lib\/actions\/safeguarding/;
  const offenders = walk(src).filter((f) => SAFEGUARDING.test(readFileSync(f, "utf8")) && !ALLOWED(rel(f))).map(rel);
  assert.deepEqual(offenders, []);
});

test("the vetting register and a tutor's checks are behind an administrator check that runs before anything is read", () => {
  for (const path of ["app/(app)/dashboard/admin/vetting/page.tsx", "app/(app)/dashboard/admin/tutors/[id]/page.tsx"]) {
    const code = read(path);
    const body = code.slice(code.indexOf("export default async function"));
    const guard = body.indexOf('requireRole(["ADMIN"])');
    assert.ok(guard > 0, `${path} must call requireRole(["ADMIN"])`);
    assert.ok(guard < body.indexOf("getSafeguarding()"), `${path} must check the role before it reads the checks`);
  }
});

test("the concern pages never read a concern around the lead check", () => {
  const list = read("app/(app)/dashboard/admin/concerns/page.tsx");
  const one = read("app/(app)/dashboard/admin/concerns/[id]/page.tsx");
  const raise = read("app/(app)/dashboard/concerns/page.tsx");
  for (const [name, code] of [["list", list], ["one", one], ["raise", raise]]) {
    assert.doesNotMatch(code, /\.concerns\.(list|get|events|raisedBy)\(/, `the ${name} page must go through listConcerns / readConcern / myConcernReceipts, never the repository`);
  }
  assert.match(list, /listConcerns\(getSafeguarding\(\), \{ id: user\.id, email: user\.email \}, safeguardingLeads\(\)\)/);
  assert.match(one, /readConcern\(getSafeguarding\(\), id, \{ id: user\.id, email: user\.email \}, safeguardingLeads\(\)\)/);
  assert.match(one, /if \(result\.reason === "not_lead"\) redirect\("\/403"\)/, "an administrator who is not a lead is refused, not shown an empty page");
  assert.match(list, /requireRole\(\["ADMIN"\]\)/);
  assert.match(one, /requireRole\(\["ADMIN"\]\)/);
  assert.match(raise, /requireRole\(\["TUTOR", "ADMIN"\]\)/, "a parent or a learner cannot open the staff concern form");
  assert.match(raise, /myConcernReceipts\(getSafeguarding\(\), user\.id\)/, "the person who raised a concern gets receipts for their OWN id only");
});

test("every safeguarding Server Action checks who is calling as its first step", () => {
  const code = read("lib/actions/safeguarding.ts");
  assert.match(code, /^"use server";/);
  const actions = [...code.matchAll(/export async function (\w+)\([^)]*\): Promise<void> \{\s*\n\s*([^\n]+)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(actions.map(([name]) => name).sort(), ["raiseConcernAction", "recordVettingCheckAction", "updateConcernAction", "voidVettingCheckAction"]);
  const first = Object.fromEntries(actions);
  assert.match(first.recordVettingCheckAction, /await requireRole\(\["ADMIN"\]\)/);
  assert.match(first.voidVettingCheckAction, /await requireRole\(\["ADMIN"\]\)/);
  assert.match(first.raiseConcernAction, /await requireRole\(\["TUTOR", "ADMIN"\]\)/);
  assert.match(first.updateConcernAction, /await requireRole\(\["ADMIN"\]\)/);
  assert.match(code, /updateConcern\(getSafeguarding\(\), id, \{ id: user\.id, email: user\.email \}, safeguardingLeads\(\)/, "an update goes through the lead check in the data layer");
  assert.match(code, /if \(!concernsOpen\(\)\) redirect\(/, "a concern is refused, not stored, when no lead is named");
  assert.equal([...code.matchAll(/^export (?!async function)/gm)].length, 0, "a use-server file exports only async actions");
});

test("who is offered what: tutors and administrators can raise, only administrators see the register and the log, families see neither", () => {
  const { navigationFor } = loadTsFrom(import.meta.url, "../src/lib/navigation/appNavigation.ts");
  const hrefs = (role) => navigationFor(role).flatMap((s) => s.items.map((i) => i.href));
  assert.ok(hrefs("TUTOR").includes("/dashboard/concerns"));
  assert.ok(hrefs("ADMIN").includes("/dashboard/admin/concerns"));
  assert.ok(hrefs("ADMIN").includes("/dashboard/admin/vetting"));
  assert.deepEqual(hrefs("TUTOR").filter((h) => /vetting|admin\/concerns/.test(h)), [], "a tutor is not offered the register or the log");
  for (const role of ["CLIENT", "STUDENT"]) assert.deepEqual(hrefs(role).filter((h) => /vetting|concerns/.test(h)), [], `${role} is offered neither`);
});

const runtime = loadTsFrom(import.meta.url, "../src/lib/safeguarding/runtime.ts");

test("concerns are closed until a lead is named, and a typo names nobody", () => {
  assert.equal(runtime.concernsOpen({ NODE_ENV: "test" }), false);
  assert.equal(runtime.concernsOpen({ NODE_ENV: "test", SAFEGUARDING_LEAD_EMAILS: "not-an-address, *" }), false);
  assert.equal(runtime.concernsOpen({ NODE_ENV: "test", SAFEGUARDING_LEAD_EMAILS: " Lead@Example.test " }), true);
  assert.deepEqual(runtime.safeguardingLeads({ SAFEGUARDING_LEAD_EMAILS: "Lead@Example.test; deputy@example.test" }).emails, ["lead@example.test", "deputy@example.test"]);
});

test("production without the database refuses rather than keep safeguarding records in memory", () => {
  assert.throws(() => runtime.getSafeguarding({ NODE_ENV: "production" }), /not available/);
});

test("the notice to the leads is built from the receipt alone, and a missing mail key sends nothing without failing", async () => {
  const code = read("lib/safeguarding/runtime.ts");
  const notify = code.slice(code.indexOf("export async function notifyLeads"));
  assert.match(notify, /receipt: ConcernReceipt, immediateDanger: boolean/, "the function is never handed the concern itself");
  assert.doesNotMatch(notify, /\.details|\.about|raisedBy/, "no detail, no name and no reporter in the email");
  const receipt = { id: "00000000-0000-4000-8000-000000000001", reference: "SC-20261109-ABCDEF", raisedAt: "2026-11-09T10:00:00.000Z", status: "OPEN" };
  assert.deepEqual(await runtime.notifyLeads(receipt, true, { NODE_ENV: "test", SAFEGUARDING_LEAD_EMAILS: "lead@example.test" }), { sent: 0, of: 1 });
  assert.deepEqual(await runtime.notifyLeads(receipt, false, { NODE_ENV: "test" }), { sent: 0, of: 0 });
});

test("today is the London date, so a check seen late on a UK evening is not 'in the future'", () => {
  assert.equal(runtime.todayInLondon(new Date("2026-06-30T23:30:00Z")), "2026-07-01", "half past midnight in London during summer time");
  assert.equal(runtime.todayInLondon(new Date("2026-12-31T23:30:00Z")), "2026-12-31");
});
