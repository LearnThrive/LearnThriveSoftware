import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// Owner answer B17: a tutor never sees what a family pays, an invoice, a refund, a balance or a discount. Money lives behind ONE door:
// the admin billing pages and their actions. These tests hold that line three ways: nothing a tutor can reach imports the billing code;
// every billing page and action refuses everyone but an admin; and the data shapes the tutor screens are built from carry no money.

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "src");
const dataSrc = join(root, "..", "..", "packages", "data", "src");

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
const ADMIN_BILLING_DIR = "app/(app)/dashboard/admin/billing/";
const ALLOWED_IMPORTERS = (path) => path.startsWith(ADMIN_BILLING_DIR) || path === "lib/actions/tuitionBilling.ts" || path.startsWith("lib/tuitionBilling/");

test("nothing a tutor (or anyone but the admin billing pages) can reach imports the billing code", () => {
  const BILLING = /@learnthrive\/data\/tuitionBilling|@\/lib\/tuitionBilling|@\/lib\/actions\/tuitionBilling/;
  const offenders = walk(src).filter((f) => BILLING.test(readFileSync(f, "utf8")) && !ALLOWED_IMPORTERS(rel(f))).map(rel);
  assert.deepEqual(offenders, [], "only the admin billing pages, their actions and the runtime may import the billing code");
});

test("every billing page checks for an admin before it reads anything", () => {
  const pages = walk(join(src, ...ADMIN_BILLING_DIR.split("/"))).filter((f) => /page\.tsx$/.test(f));
  assert.ok(pages.length >= 4, "list, family, settings, tutor pay");
  for (const file of pages) {
    const code = readFileSync(file, "utf8");
    const guard = code.indexOf('requireRole(["ADMIN"])');
    assert.ok(guard > 0, `${rel(file)} must call requireRole(["ADMIN"])`);
    assert.ok(guard < code.search(/billingContext\(\)/), `${rel(file)} must guard before it builds the billing context`);
  }
});

test("every billing Server Action re-checks for an admin as its first step", () => {
  const code = readFileSync(join(src, "lib", "actions", "tuitionBilling.ts"), "utf8");
  assert.match(code, /^"use server";/);
  assert.match(code, /requireRole\(\["ADMIN"\]\)/, "the guard is ADMIN only");
  const exported = [...code.matchAll(/export async function (\w+)\([^)]*\): Promise<void> \{\s*\n\s*([^\n]+)/g)];
  assert.ok(exported.length >= 10, "all the actions were found");
  for (const [, name, firstLine] of exported) assert.match(firstLine, /await admin\(\)/, `${name} must start by checking for an admin`);
  const otherExports = [...code.matchAll(/^export (?!async function)/gm)];
  assert.equal(otherExports.length, 0, "a use-server file exports only async actions");
});

test("only an admin's navigation, shortcuts and quick-create reach billing", () => {
  const { navigationFor } = loadTsFrom(import.meta.url, "../src/lib/navigation/appNavigation.ts");
  const hrefs = (role) => navigationFor(role).flatMap((s) => s.items.map((i) => i.href));
  assert.ok(hrefs("ADMIN").includes("/dashboard/admin/billing"));
  for (const role of ["TUTOR", "CLIENT", "STUDENT"]) assert.deepEqual(hrefs(role).filter((h) => /billing/.test(h)), [], `${role} has no billing link`);
});

test("the data shapes the tutor screens are built from carry no money", () => {
  // Property names in the domain types and the repository interfaces a tutor's pages read. If a price, rate, fee, invoice, refund or
  // balance ever lands on one of these, it would reach a tutor's screen, message or export: this fails first.
  const MONEY = /^(price|prices|rate|rates|hourly\w*|fee|fees|amount\w*|invoice\w*|refund\w*|balance\w*|discount\w*|pence|payment\w*|pay|paid|owed|charge\w*|statement\w*|currency|cost|costs)$/i;
  const hits = [];
  for (const file of ["domain.ts", "repositories.ts"]) {
    const code = readFileSync(join(dataSrc, file), "utf8");
    for (const m of code.matchAll(/^\s+(?:readonly )?(\w+)\??:/gm)) if (MONEY.test(m[1])) hits.push(`${file}: ${m[1]}`);
  }
  assert.deepEqual(hits, [], "money belongs to the billing repository only");
});

test("the tutor-facing source never formats a price", () => {
  // Tutor pages, the lesson, report and attendance code and the calendar export: none may format pence as money.
  const TUTOR_REACHABLE = (path) =>
    (path.startsWith("app/(app)/dashboard/") && !path.startsWith("app/(app)/dashboard/admin/")) || path.startsWith("lib/reports/") || path.startsWith("lib/attendance/") || path.startsWith("lib/calendar/") ||
    path.startsWith("lib/notifications/") || path.startsWith("components/lessons/") || path.startsWith("components/reports/");
  const offenders = walk(src).filter((f) => TUTOR_REACHABLE(rel(f))).filter((f) => /formatPence|hourlyPence|amountPence|balancePence|invoiceNumber/.test(readFileSync(f, "utf8"))).map(rel);
  assert.deepEqual(offenders, []);
});

// ---- behaviour on the real service, in memory ---------------------------------------------------------------------------------------

const { billingContext, getTuitionBilling } = loadTsFrom(import.meta.url, "../src/lib/tuitionBilling/runtime.ts");
const billing = loadTsFrom(import.meta.url, "../../../packages/data/src/tuitionBilling/index.ts");

test("production without the database refuses to bill rather than use development data", () => {
  assert.throws(() => getTuitionBilling({ NODE_ENV: "production" }), /not available/);
  assert.throws(() => billingContext({ NODE_ENV: "production" }), /not available/);
});

test("refund approvers come only from TUITION_REFUND_APPROVER_EMAILS; with none set nobody can approve", async () => {
  const none = billingContext({ NODE_ENV: "test" });
  assert.equal(billing.isRefundApprover({ id: "x", email: "anyone@example.test" }, none.approvers), false);
  const some = billingContext({ NODE_ENV: "test", TUITION_REFUND_APPROVER_EMAILS: " Tahasin@Example.test , other@example.test " });
  assert.equal(billing.isRefundApprover({ id: "x", email: "tahasin@example.test" }, some.approvers), true);
  assert.equal(billing.isRefundApprover({ id: "x", email: "brian@example.test" }, some.approvers), false);
});

test("a statement for a seeded family cannot be issued with no agreed rate: it says what is missing instead of guessing", async () => {
  const ctx = { ...billingContext({ NODE_ENV: "test" }), now: () => "2030-01-02T09:00:00.000Z" };
  let checked = 0;
  for (const c of await ctx.data.clients.list()) {
    const lessons = (await ctx.data.lessons.forClient(c.id)).filter((l) => l.status === "COMPLETED");
    if (lessons.length === 0) continue;
    const period = billing.londonYmd(lessons[0].startAt).slice(0, 7);
    const draft = await billing.previewStatement(ctx, c.id, period);
    assert.ok(draft.lines.length > 0);
    assert.ok(draft.blockers.includes("NO_RATE"), `${c.name}: ${period} must be blocked until a rate is agreed`);
    await assert.rejects(billing.issueStatement(ctx, c.id, period, { id: "admin", email: "a@example.test" }), /cannot be issued/);
    checked += 1;
  }
  assert.ok(checked > 0, "the development data has a family with a completed lesson");
});
