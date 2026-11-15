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
// The one other door: a parent's own Fees page, guarded for the CLIENT role and scoped to the family the signed-in parent owns (tested below).
const PARENT_FEES_PAGE = "app/(app)/dashboard/billing/page.tsx";
const ALLOWED_IMPORTERS = (path) => path.startsWith(ADMIN_BILLING_DIR) || path === PARENT_FEES_PAGE || path === "app/api/admin/billing/export/route.ts" || path === "lib/actions/tuitionBilling.ts" || path.startsWith("lib/tuitionBilling/");

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

test("the billing export route answers an administrator only, and anyone else gets the same 404 as an unknown kind", () => {
  const code = readFileSync(join(src, "app", "api", "admin", "billing", "export", "route.ts"), "utf8").replaceAll("\r\n", "\n");
  assert.match(code, /requireRoleForApi\(\["ADMIN"\]\)/);
  assert.ok(code.indexOf('requireRoleForApi(["ADMIN"])') < code.indexOf("billingContext()"), "the role is checked before billing is touched");
  assert.match(code, /if \(!admin\) return NOT_FOUND\(\)/, "a tutor or a parent is told nothing, not even that the route exists");
  assert.match(code, /"Cache-Control": "no-store, private"/);
  assert.match(code, /Content-Disposition/, "a download, not a page");
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

test("only an admin's navigation reaches billing, and a parent's reaches only their own Fees page", () => {
  const { navigationFor } = loadTsFrom(import.meta.url, "../src/lib/navigation/appNavigation.ts");
  const hrefs = (role) => navigationFor(role).flatMap((s) => s.items.map((i) => i.href));
  assert.ok(hrefs("ADMIN").includes("/dashboard/admin/billing"));
  for (const role of ["TUTOR", "STUDENT"]) assert.deepEqual(hrefs(role).filter((h) => /billing/.test(h)), [], `${role} has no billing link`);
  assert.deepEqual(hrefs("CLIENT").filter((h) => /billing/.test(h)), ["/dashboard/billing"], "a parent sees their own Fees page and nothing of the admin screens");
  assert.equal(hrefs("CLIENT").some((h) => /admin/.test(h)), false);
});

test("a parent's Fees page is for the CLIENT role only and shows the family the signed-in parent owns, never one named in the address", () => {
  const code = readFileSync(join(src, ...PARENT_FEES_PAGE.split("/")), "utf8");
  assert.match(code, /requireRole\(\["CLIENT"\]\)/, "not a tutor, not a learner, not an administrator");
  assert.ok(code.indexOf('requireRole(["CLIENT"])') < code.indexOf("billingContext()"), "the role is checked before billing is touched");
  assert.match(code, /recordFor\(user, "CLIENT"\)/, "the family is the one the signed-in person's parent role stands on (their session), not a tutor or student record they also hold");
  assert.match(code, /clients\.get\(familyId\)/, "and that is the family read");
  assert.doesNotMatch(code, /searchParams|params\b|useSearchParams/, "nothing in the address can pick another family");
  assert.match(code, /parentAccount\(ctx, family\.id\)/, "what is shown is the parent projection, not the stored rows");
  assert.doesNotMatch(code, /billing\.(statements|payments|refunds|audit|familyRates|tutorRates)/, "it never reads the repository directly");
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
    (path.startsWith("app/(app)/dashboard/") && !path.startsWith("app/(app)/dashboard/admin/") && path !== PARENT_FEES_PAGE) || path.startsWith("lib/reports/") || path.startsWith("lib/attendance/") || path.startsWith("lib/calendar/") ||
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

test("what a parent is shown is a projection: their own statements and payments, no internal ids or notes, and never another family's", async () => {
  const { randomUUID } = await import("node:crypto");
  const ctx = { ...billingContext({ NODE_ENV: "test" }), now: () => "2030-01-02T09:00:00.000Z" };
  const { data } = ctx;
  const make = async (name) => {
    const client = await data.clients.create({ userId: randomUUID(), name, email: `${randomUUID()}@example.test`, active: true });
    const student = await data.students.create({ name: `${name} child`, active: true, clientId: client.id });
    await data.students.linkClient(client.id, student.id);
    const tutor = await data.tutors.create({ name: "Tutor", email: `${randomUUID()}@example.test`, subjects: ["Maths"], active: true });
    const assignment = await data.assignments.create({ title: "Maths", subject: "Maths", tutorId: tutor.id, studentIds: [student.id], clientIds: [client.id], status: "ACTIVE", defaultDurationMinutes: 60 });
    await data.lessons.create({ assignmentId: assignment.id, tutorId: tutor.id, studentIds: [student.id], clientIds: [client.id], title: "Algebra", subject: "Maths", startAt: "2029-06-05T16:00:00Z", durationMinutes: 60, locationType: "ONLINE", reportRequired: false, status: "COMPLETED" });
    await ctx.billing.familyRates.create({ clientId: client.id, assignmentId: assignment.id, hourlyPence: 3000, contractStart: "2029-01-01", contractEnd: null, createdBy: "admin" });
    return client;
  };
  const a = await make("Family A");
  const b = await make("Family B");
  const admin = { id: "admin-1", email: "admin@example.test" };
  await ctx.billing.settings.update({ paymentInstructions: "Pay LearnThrive Tuition Ltd by bank transfer." }, admin.id);
  await billing.issueStatement(ctx, a.id, "2029-06", admin);
  await billing.recordPayment(ctx, { clientId: a.id, amountPence: 1000, receivedOn: "2029-07-10", method: "Bank transfer", note: "Sarah rang about the late payment" }, admin);

  const mine = await billing.parentAccount(ctx, a.id);
  assert.equal(mine.statements.length, 1);
  assert.equal(mine.statements[0].lines.length, 1);
  assert.equal(mine.statements[0].lines[0].amountPence, 3000);
  assert.equal(mine.balancePence, 3000 - 1000, "the statement total less the payment recorded since");
  assert.equal(mine.paymentInstructions, "Pay LearnThrive Tuition Ltd by bank transfer.");
  assert.deepEqual(mine.payments, [{ receivedOn: "2029-07-10", amountPence: 1000, method: "Bank transfer" }]);

  const json = JSON.stringify(mine);
  for (const secret of ["Sarah rang", "admin-1", "lessonId", "studentId", "issuedBy", "paymentIds", "blockers", "createdBy", "recordedBy"]) {
    assert.equal(json.includes(secret), false, `the parent's view must not carry ${secret}`);
  }
  const theirs = await billing.parentAccount(ctx, b.id);
  assert.deepEqual([theirs.statements.length, theirs.payments.length, theirs.balancePence], [0, 0, 0], "another family has none of the first family's statements or payments");
  assert.equal(JSON.stringify(theirs).includes(mine.statements[0].invoiceNumber), false);
});
