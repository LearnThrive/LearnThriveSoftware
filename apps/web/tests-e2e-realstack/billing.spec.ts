import { expect, test, type Page } from '@playwright/test';
import { distinctVisitor, signIn, signOut } from './_browser';
import { clearBilling, makeAccount, openSql, readFixture, readStack, type Account, type Sql } from './_stack';
import type { Fixture } from './global-setup';

/**
 * Tuition billing (docs/TUITION_BILLING.md, migration 0021) in a browser, on the REAL local stack: the admin pages and their Server Actions
 * against real Postgres through the production connection code. The contract proves the rules; this proves the screens, the forms and the
 * actions behind them, which only the real stack can: it is where the statement preview hung through the pooler and a payment was counted
 * twice (docs/SUPABASE_REAL_STACK.md, findings 20 and 21).
 *
 * Its own family ("Carter": a parent, one child, their tutor with a login, an assignment and three lessons in the two months before this
 * one), so no other spec's people carry money. The refund approver is an administrator whose linked email is the address
 * playwright.realstack.config.ts puts in TUITION_REFUND_APPROVER_EMAILS.
 */

distinctVisitor();
test.describe.configure({ mode: 'serial' });

const APPROVER_EMAIL = 'rs-approver@example.com';

let f: Fixture;
let sql: Sql;
let parent: Account;
let tutor: Account;
let approver: Account;
let clientId = '';
let tutorId = '';
let older = '';
let last = '';
let current = '';
let completedLastMonth = '';

type Replay = Record<string, string>;

/** A London calendar month, `yyyy-mm`, `offset` months from this one. Statements are by London month (docs/SCHEDULING.md). */
function londonMonth(offset: number): string {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).format(new Date()).split('-').map(Number);
  const index = y! * 12 + (m! - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

const familyPath = (period?: string) => `/dashboard/admin/billing/${clientId}${period ? `?period=${period}` : ''}`;

/** Waits for the page's content, not its streamed loading shell (docs/SCOPING_AUDIT.md). */
async function settled(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('main')).not.toContainText('Loading…', { timeout: 60_000 });
}

/** Each action redirects back with its outcome in `?toast=`: the message a person would see. */
async function toast(page: Page): Promise<string> {
  await page.waitForURL(/[?&]toast=/, { timeout: 60_000 });
  return new URL(page.url()).searchParams.get('toast') ?? '';
}

const card = (page: Page, text: string) => page.locator('.card').filter({ hasText: text });
const statementCard = (page: Page) => card(page, 'Once issued it is frozen.');

/** One form's fields and its `$ACTION_ID_…`, read from the server-rendered HTML (see purge-guard.spec.ts for why not the live DOM). */
async function replayOf(page: Page, url: string, button: string): Promise<Replay> {
  const html = await (await page.request.get(url)).text();
  for (const chunk of html.split('<form').slice(1)) {
    const body = chunk.split('</form>')[0] ?? '';
    if (!body.includes(`>${button}<`)) continue;
    const actionId = /name="(\$ACTION_ID_[0-9a-f]+)"/.exec(body)?.[1];
    expect(actionId, `the ${button} form posts a server action`).toBeTruthy();
    const replay: Replay = { [actionId!]: '' };
    for (const field of body.matchAll(/name="([a-zA-Z]+)"(?:\s+value="([^"]*)")?/g)) replay[field[1]!] = field[2] ?? '';
    return replay;
  }
  throw new Error(`no form with a ${button} button in ${url}`);
}

const count = async (table: string, where: string, value: string) =>
  (await sql.unsafe(`select count(*)::int as n from public.${table} where ${where} = $1`, [value]))[0]!.n as number;

test.beforeAll(async () => {
  f = readFixture<Fixture>();
  sql = openSql();
  const stack = readStack();
  [older, last, current] = [londonMonth(-2), londonMonth(-1), londonMonth(0)];

  // Usernames start rs- so global-setup's clearFixtures removes all of this on the next run, billing rows included.
  parent = await makeAccount(stack, sql, { username: `rs-carter-${f.run}`, displayName: 'Carter Parent', linkedEmail: `rs-carter-${f.run}@example.com`, role: 'CLIENT' });
  clientId = (await sql<{ id: string }[]>`select id from public.clients where owner_profile_id = ${parent.profileId}`)[0]!.id;
  const [{ id: studentId }] = await sql<{ id: string }[]>`insert into public.students (client_id, display_name, year_group) values (${clientId}, 'Cara', 'Year 8') returning id`;
  [{ id: tutorId }] = await sql<{ id: string }[]>`
    insert into public.tutors (display_name, subjects, contact_email) values ('Carter Tutor', ${['Maths']}, ${`rs-tutor-carter-${f.run}@example.com`}) returning id`;
  tutor = await makeAccount(stack, sql, { username: `rs-tutor-carter-${f.run}`, displayName: 'Carter Tutor', linkedEmail: `rs-tutor-carter-${f.run}@example.com`, role: 'TUTOR', tutorId });
  approver = await makeAccount(stack, sql, { username: `rs-approver-${f.run}`, displayName: 'Refund Approver', linkedEmail: APPROVER_EMAIL, role: 'ADMIN' });

  const [{ id: assignmentId }] = await sql<{ id: string }[]>`
    insert into public.tuition_assignments (title, subject, level, tutor_id, status, default_duration_minutes, default_location_type)
    values ('GCSE Maths', 'Maths', 'GCSE', ${tutorId}, 'ACTIVE', 60, 'ONLINE') returning id`;
  await sql`insert into public.assignment_students (assignment_id, student_id) values (${assignmentId}, ${studentId})`;
  const lesson = async (startAt: string, status: 'COMPLETED' | 'CANCELLED', cancelledAt: string | null = null) => {
    const [{ id }] = await sql<{ id: string }[]>`
      insert into public.lessons (assignment_id, tutor_id, title, subject, start_at, duration_minutes, location_type, status, cancelled_at)
      values (${assignmentId}, ${tutorId}, 'Algebra', 'Maths', ${startAt}, 60, 'ONLINE', ${status}, ${cancelledAt}) returning id`;
    await sql`insert into public.lesson_students (lesson_id, student_id) values (${id}, ${studentId})`;
    if (status === 'COMPLETED') await sql`insert into public.lesson_attendance (lesson_id, student_id, status, marked_by) values (${id}, ${studentId}, 'ATTENDED', ${tutor.profileId})`;
    return id;
  };
  // 16:00 UTC on the 10th is the 10th in London whatever the clocks are doing.
  await lesson(`${older}-10T16:00:00Z`, 'COMPLETED');
  completedLastMonth = await lesson(`${last}-10T16:00:00Z`, 'COMPLETED');
  await lesson(`${last}-17T16:00:00Z`, 'CANCELLED', `${last}-15T09:00:00Z`);
});

test.afterAll(async () => {
  // The money goes now; the people, lessons and assignment go with the next run's clearFixtures, like every other fixture.
  if (clientId) await clearBilling(sql, [clientId], [tutorId]);
  await sql?.end({ timeout: 5 });
});

test('an admin takes a family from no rate to two issued months, and a payment is counted once', async ({ page }) => {
  await signIn(page, f.admin.username, f.admin.password);

  // No rate yet: the oldest month cannot be issued, and says why.
  await settled(page, familyPath(older));
  await expect(statementCard(page)).toContainText('No agreed rate covers a lesson in this month.');
  await expect(statementCard(page).getByRole('button', { name: 'Issue statement' })).toBeDisabled();

  // The family rate, from the first of that month: £30 an hour.
  const rates = card(page, 'Fixed for the contract year');
  await rates.getByLabel(/Rate per hour/).fill('30');
  await rates.getByLabel(/Contract starts/).fill(`${older}-01`);
  await rates.getByRole('button', { name: 'Set rate' }).click();
  expect(await toast(page)).toBe('Family rate saved');

  // A second rate inside the contract year is refused, with the reason on the page (B3).
  await settled(page, familyPath(older));
  await card(page, 'Fixed for the contract year').getByLabel(/Rate per hour/).fill('35');
  await card(page, 'Fixed for the contract year').getByLabel(/Contract starts/).fill(`${last}-01`);
  await card(page, 'Fixed for the contract year').getByRole('button', { name: 'Set rate' }).click();
  expect(await toast(page)).toContain('The rate is fixed for the contract year.');
  expect(await count('tuition_family_rates', 'client_id', clientId), 'only the first rate was stored').toBe(1);

  // The oldest month: one hour at £30, issued once and frozen.
  await settled(page, familyPath(older));
  await expect(statementCard(page)).toContainText('total £30.00');
  await statementCard(page).getByRole('button', { name: 'Issue statement' }).click();
  expect(await toast(page)).toBe(`Statement for ${older} issued`);
  await settled(page, familyPath(older));
  await expect(statementCard(page)).toContainText(/Issued LT-\d{6}-\d{4}/);

  // Stored as JSON values, not JSON text (finding 21: the driver used to store these as strings).
  const [shape] = await sql`select jsonb_typeof(lines) as lines, jsonb_typeof(payment_ids) as payment_ids, jsonb_typeof(company) as company
                              from public.tuition_statements where client_id = ${clientId} and period = ${older}`;
  expect(shape).toEqual({ lines: 'array', payment_ids: 'array', company: 'object' });

  // The family pays it early last month. A payment counts on the first statement whose month has ended by the day it was received.
  const payments = card(page, 'Recorded by hand.');
  await payments.getByLabel(/Amount/).fill('30');
  await payments.getByLabel(/Date received/).fill(`${last}-05`);
  await payments.getByLabel(/Method/).fill('Bank transfer');
  await payments.getByLabel(/^Note/).fill(`For ${older}`);
  await payments.getByRole('button', { name: 'Record payment' }).click();
  expect(await toast(page)).toBe('Payment recorded');
  const [{ id: paymentId }] = await sql<{ id: string }[]>`select id from public.tuition_payments where client_id = ${clientId}`;

  // Last month has a cancelled lesson nobody has explained: it blocks the statement until an admin decides it (B6, B8).
  await settled(page, familyPath(last));
  await expect(statementCard(page)).toContainText('A cancelled or unfinished lesson has not been explained.');
  await expect(statementCard(page).getByRole('button', { name: 'Issue statement' })).toBeDisabled();
  const decide = card(page, 'Cancelled or unfinished lessons nobody has explained');
  await decide.getByLabel(/What happened/).selectOption('TUTOR');
  await decide.getByRole('button', { name: 'Save decision' }).click();
  expect(await toast(page)).toBe('Decision saved');

  // A tutor's cancellation is never charged: one lesson, and the payment counted here, in the first statement after it.
  await settled(page, familyPath(last));
  await expect(statementCard(page)).toContainText('total £30.00');
  await expect(statementCard(page)).toContainText('Opening £30.00 · payments received £30.00 · closing £30.00');
  await statementCard(page).getByRole('button', { name: 'Issue statement' }).click();
  expect(await toast(page)).toBe(`Statement for ${last} issued`);
  const [issued] = await sql`select payment_ids from public.tuition_statements where client_id = ${clientId} and period = ${last}`;
  expect(issued!.payment_ids).toEqual([paymentId]);

  // This month: not over, so not issuable, and the same payment is NOT counted again (finding 21).
  await settled(page, familyPath(current));
  await expect(statementCard(page)).toContainText('That month has not finished yet.');
  await expect(statementCard(page)).toContainText('Opening £30.00 · payments received £0.00 · closing £30.00');

  // The list agrees: the family owes £30.00, the cancelled lesson is decided, and nothing is overdue.
  await settled(page, '/dashboard/admin/billing');
  const row = page.locator('main').getByRole('link', { name: /Carter Parent/ });
  await expect(row).toContainText('£30.00');
  await expect(row).not.toContainText('to decide');
  await expect(row).not.toContainText('Overdue');
  await signOut(page);
});

test('a refund: any admin can ask, only the named approver can decide, and a refused attempt is logged (B11)', async ({ page }) => {
  // An admin who is not an approver asks for one. They are offered no way to decide it.
  await signIn(page, f.admin.username, f.admin.password);
  await settled(page, familyPath(current));
  const refunds = card(page, 'Request refund');
  await expect(refunds).toContainText('Only the named approvers can approve or reject it.');
  await refunds.getByLabel(/Amount/).fill('10');
  await refunds.getByLabel(/Reason/).fill('Lesson ended early: connection lost');
  await refunds.getByRole('button', { name: 'Request refund' }).click();
  expect(await toast(page)).toContain('Refund requested');
  const [{ id: refundId }] = await sql<{ id: string }[]>`select id from public.tuition_refunds where client_id = ${clientId}`;
  await settled(page, familyPath(current));
  await expect(card(page, 'Request refund').getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await signOut(page);

  // The approver's page offers the decision; take its exact request…
  await signIn(page, approver.username, approver.password);
  await settled(page, familyPath(current));
  await expect(card(page, 'Request refund')).toContainText('You are a named refund approver.');
  const approve = { ...(await replayOf(page, familyPath(current), 'Approve')), decision: 'approve', note: '' };
  await signOut(page);

  // …and replay it as the admin who is not an approver: refused, unchanged, and the attempt is in the audit.
  await signIn(page, f.admin.username, f.admin.password);
  const reply = await page.request.post(familyPath(current), { multipart: approve, failOnStatusCode: false });
  expect(new URL(reply.url()).searchParams.get('toast')).toBe('Only a named approver can approve or reject a refund.');
  expect((await sql`select status from public.tuition_refunds where id = ${refundId}`)[0]!.status).toBe('REQUESTED');
  const refused = await sql`select actor_id from public.tuition_billing_audit where action = 'refund.decision_refused' and subject = ${refundId}`;
  expect(refused.map((r) => r.actor_id)).toEqual([f.admin.profileId]);
  await signOut(page);

  // The approver decides it.
  await signIn(page, approver.username, approver.password);
  await settled(page, familyPath(current));
  await card(page, 'Request refund').getByRole('button', { name: 'Approve' }).click();
  expect(await toast(page)).toBe('Refund approved');
  const [decided] = await sql`select status, decided_by from public.tuition_refunds where id = ${refundId}`;
  expect(decided).toEqual({ status: 'APPROVED', decided_by: approver.profileId });
  await signOut(page);
});

test('tutor pay is kept between £5 and £45 an hour, apart from what families pay (B2)', async ({ page }) => {
  await signIn(page, f.admin.username, f.admin.password);
  await settled(page, '/dashboard/admin/billing/tutor-rates');
  const pay = card(page, 'Carter Tutor');
  await expect(pay).toContainText('No pay rate set');
  await pay.getByLabel(/Pay per hour/).fill('50');
  await pay.getByRole('button', { name: 'Set pay' }).click();
  expect(await toast(page)).toBe("A tutor's pay is between 5 and 45 pounds an hour.");
  expect(await count('tuition_tutor_rates', 'tutor_id', tutorId)).toBe(0);

  await settled(page, '/dashboard/admin/billing/tutor-rates');
  await card(page, 'Carter Tutor').getByLabel(/Pay per hour/).fill('20');
  await card(page, 'Carter Tutor').getByRole('button', { name: 'Set pay' }).click();
  expect(await toast(page)).toBe('Tutor pay saved');
  await settled(page, '/dashboard/admin/billing/tutor-rates');
  await expect(card(page, 'Carter Tutor')).toContainText('Now £20.00 an hour');
  await signOut(page);
});

test('a tutor, a parent, a learner and a stranger reach none of it, even with a form’s own action id (B17)', async ({ page }) => {
  // The request an admin's page would send to record a payment, read as the admin.
  await signIn(page, f.admin.username, f.admin.password);
  const record = { ...(await replayOf(page, familyPath(current), 'Record payment')), amount: '999', method: 'Replayed', note: 'must not be stored' };
  await signOut(page);
  const paymentsBefore = await count('tuition_payments', 'client_id', clientId);
  const pages = ['/dashboard/admin/billing', familyPath(current), '/dashboard/admin/billing/tutor-rates', '/dashboard/admin/billing/settings'];

  const who = [
    ['the family’s own tutor', tutor.username, tutor.password],
    ['the family’s own parent', parent.username, parent.password],
    ['a learner', f.ashford.enrolled.learner.username, f.ashford.enrolled.learner.password],
  ] as const;
  for (const [label, username, password] of who) {
    await signIn(page, username, password);
    for (const path of pages) {
      await page.goto(path);
      await expect(page, `${label} cannot open ${path}`).toHaveURL(/\/403$/);
    }
    const reply = await page.request.post(familyPath(current), { multipart: record, failOnStatusCode: false });
    expect(reply.url(), `${label}: recording a payment should have sent them to /403`).toMatch(/\/403$/);
    expect(await count('tuition_payments', 'client_id', clientId), `${label} must not record a payment`).toBe(paymentsBefore);
    await signOut(page);
  }

  const stranger = await page.request.post(familyPath(current), { multipart: record, failOnStatusCode: false });
  expect(stranger.url(), 'a stranger is sent to sign in').toMatch(/\/login/);
  expect(await count('tuition_payments', 'client_id', clientId)).toBe(paymentsBefore);

  // The family's own tutor teaches the lessons that were billed, and sees no money anywhere they can go (B17).
  await signIn(page, tutor.username, tutor.password);
  for (const path of ['/dashboard', '/dashboard/lessons', `/dashboard/lessons/${completedLastMonth}`]) {
    await settled(page, path);
    expect(await page.locator('main').innerText(), `${path} shows an amount to the tutor`).not.toContain('£');
  }
  await signOut(page);
});
