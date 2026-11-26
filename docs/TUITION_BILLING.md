# Tuition billing

What was built for the owners' answers of 7 Nov 2026 ([OWNER_ANSWERS_2026-11-07.md](OWNER_ANSWERS_2026-11-07.md), items B1 to B19). It records what families owe. **It does not collect money**: families pay by **bank transfer** for now (14 Nov 2026: the first launch is without Stripe or card payment), so an admin records each payment by hand and a parent sees how to pay on their Fees page. Updated for [Tahasin's answers of 14 Nov 2026](OWNER_ANSWERS_ROUND2_2026-11-14.md). Nothing here is visible to a tutor (B17).

Status of this work: built and tested; applied to the hosted `learnthrive-prod` database on 8 Nov 2026 (with `0001`–`0021`; no billing rows yet), and **not yet seen by the owners**.

## Where things are

| What | Where |
| --- | --- |
| Rules and statements (pure, no I/O) | `packages/data/src/tuitionBilling/` (`rules.ts`, `statement.ts`, `period.ts`, `money.ts`, `refunds.ts`, `validate.ts`) |
| Repository, in memory and Postgres | `repository.ts`, `memoryRepository.ts`, `sqlRepository.ts` |
| Reads lessons from the tuition data, calls the rules | `service.ts` |
| Tables | `supabase/migrations/0021_tuition_billing.sql`; a lesson's own price in `0033_tuition_lesson_prices.sql`; repeating prices in `0034_tuition_repeating_prices.sql` |
| Admin pages | `/dashboard/admin/billing`, `/billing/[clientId]`, `/billing/tutor-rates`, `/billing/tutor-pay` (the monthly pay run), `/billing/lessons` (each lesson's family price and tutor pay, side by side), `/billing/settings` |
| A parent's page | `/dashboard/billing` ("Fees"): their own statements, payments and how to pay. The `parentAccount` projection in `service.ts` is all it can read |
| Spreadsheets | `GET /api/admin/billing/export?kind=statements\|payments\|tutor-pay[&period=yyyy-mm]`, admin only (`csv.ts`, `tutorPay.ts`) |
| Admin actions | `apps/web/src/lib/actions/tuitionBilling.ts` |
| Backend choice | `apps/web/src/lib/tuitionBilling/runtime.ts` (Postgres with the database; in memory in development and tests; **throws** in production without the database) |

## The model

- **Money is integer pence.** Dates are London calendar dates. A month is `yyyy-mm`.
- **Family rate and tutor rate are different tables** (B2). A family rate belongs to one assignment and **applies until a newer one replaces it**: there is no fixed contract year (14 Nov 2026: families commit for three months to start with, then give a month's notice; the notice and the minimum are terms, not enforced by the software). A new rate ends the current one the day before it starts; it cannot start on or before the current rate's start (`RATE_LOCKED`), and once a family has a rate, a change cannot start before today, so it can never reprice lessons already taught. Tutor pay must be £5 to £45 an hour.
- **A lesson can have its own price** (`tuition_lesson_prices`, `/dashboard/admin/billing/lessons`). For one lesson an administrator sets what each
  child's family is charged for it and/or what its tutor is paid for it, as **two separate amounts** (a lesson may cost a family £10 and pay its
  tutor £5). A side left blank uses the hourly rate. The family amount is per child and replaces the hourly charge on the statement (a repeat
  no-show or repeat late cancellation is charged at it too, unless a fixed late-cancellation fee is set); the line then shows no hourly rate. The
  tutor amount is paid once for the lesson in the pay run. The page lists every lesson in a month with what the families owe for it, what the tutor
  is paid and the difference (before any sibling discount, which comes off the month). **The family side cannot change once the lesson is on an
  issued statement**; the tutor side still can. Every change is audited (`lesson_price.set`, `lesson_price.cleared`). An administrator reaches it from
  the lesson page ("Price and tutor pay"), which links there and reads no money itself.
- **A price can repeat** (`tuition_repeating_prices`, same page). From a lesson's price form an administrator chooses "Repeat": 4 or 8 weeks, 3, 6
  or 12 months, or until a chosen date, starting on a chosen date (the lesson's own date by default; at most two years). It covers **every lesson
  of that class (assignment)** on those London dates, whenever each is booked. A lesson's own price wins over it, side by side (each of family and
  tutor); saving it from a lesson clears that lesson's own price on the sides it sets, unless the family side is already invoiced. A class cannot
  have two repeating prices for the same day (`RATE_LOCKED`). Removing one puts lessons not yet billed back on their own price or the hourly
  rates, past ones in its dates included; **issued statements never change**. Audited (`repeating_price.set`, `repeating_price.removed`).
- **A lesson is charged** when it was delivered (completed, and the child was not absent or excused), late-cancelled by the family (less than the notice, 24 hours), or a no-show. A tutor cancellation, a free cancellation or a lesson not yet happened is never charged (B8). A cancelled or unfinished lesson nobody has explained **blocks the statement** until an admin says who cancelled, or waives it with a reason.
- **Allowances are per child and separate** (B6, B7): the first late cancellation and the first no-show are each waived once, counted over the child's whole history. **A repeat late cancellation is charged at the lesson's own price** ("charged" was decided on 14 Nov, the amount was not, so this is an assumption to confirm; a fixed fee can be set instead).
- **A student cannot be marked absent until 15 minutes after the lesson's scheduled start** (14 Nov 2026), in the software (`markAttendance`) and on the lesson screen.
- **Sibling discount** (B4): a recorded flag on the family, 10% off delivered lessons only. Who qualifies is still open, so an admin sets it by hand.
- **Statements are monthly, in arrears** (B1, B14, B16), issued in order, and **frozen** once issued (an append-only trigger rejects any change). They carry the invoice number, date, period, lines, missed-lesson charges, discount, payments received, opening and closing balance, and the company details. A month that has not ended cannot be issued.
- **Payments** are recorded by hand and **voided with a reason, never edited**. Each payment is counted once, in the first statement after it is recorded.
- **Overdue** (B12, changed 14 Nov 2026). A family is flagged when charges are unpaid a calendar month after the statement date (payments are applied oldest-first); there are no late fees. The owners decided lessons are paused once a family is more than a month overdue. **A person pauses them**, with a reason, from the family's billing page (`setFamilyLessonsPausedAction`): it marks the family's active assignments Paused, no new lessons can then be scheduled on them, and it is audited. Nothing pauses automatically (`autoSuspend` is always `false`), and lessons already booked are left for an administrator to cancel.
- **Refunds** (B11): any admin may *request* one. Only the people whose account's **linked email** is in `TUITION_REFUND_APPROVER_EMAILS` (the address on the account, not the username) can approve or reject; a refusal is itself logged. If the owners set a threshold, a second, different approver is needed above it. Rejecting needs a note.
- **Audit**: every change to rates, decisions, payments, statements, refunds and settings is appended to `tuition_billing_audit` (append-only).

## Settings, and what is still open

Set on `/dashboard/admin/billing/settings`. Blank means "not decided yet":

| Setting | Open question | While blank |
| --- | --- | --- |
| How parents pay | The bank details and the reference to quote, in words an administrator writes | Parents are told to email for the details. **Set it before the first statement is issued** |
| Repeat late-cancellation fee (B6) | A fixed fee instead of the lesson price | A repeat is charged at the lesson price |
| Allowance reset (B6) | Does it ever reset | Never resets |
| Second-approval threshold (B11) | Above what amount (Tahasin alone approves refunds, so likely none) | One approver is enough |

Still decided by hand: who counts as a sibling (B4), and who pays when a child has two guardians (B15): for now the guardian with the lowest id is billed, so a child is never billed twice. That is a placeholder, not a decision.

## Paying by bank transfer

Families pay by bank transfer at launch. The parent's **Fees** page shows a "Pay by bank transfer" panel: the payee name, the sort code (written `00-00-00`), the account number, the bank and **their family's payment reference**, each with a copy button, and the reminder that the details never change by email or message.

- **The bank details are built into the site**, in one server-only file (`apps/web/src/lib/bank/siteBankDetails.ts`), and nowhere else in the repository: not in a test, a document, seed data or a log, and `tests/bankTransfer.test.mjs` fails if they appear in a second place. Four server environment variables can replace them without a deploy: `BANK_PAYEE_NAME`, `BANK_ACCOUNT_NUMBER` (exactly 8 digits), `BANK_SORT_CODE` (exactly 6 digits, no dashes) and `BANK_NAME` (`docs/ENVIRONMENT.md`), all four or none. `.env.example` holds empty placeholders only; `.env*` files other than the example are git-ignored. To change the account, edit that one file (or set the variables) and deploy.
- **Checked when the server starts** (`apps/web/src/instrumentation.ts`, `lib/bank/config.ts`): a partly set override, an account number or sort code of the wrong length, or an empty name, and the server refuses to start with a message naming each variable at fault (never its value). A wrong override never falls back to the built-in account. With none set, the built-in details (which pass the same rules) are used.
- **Who can see them:** `GET /api/tuition/bank-details` and the Fees page, through one function (`lib/bank/handler.ts`). Signed out: 401. A student, a tutor or a junior tutor: 403. A parent gets the details and the reference of **their own** family (the family their parent role stands on); naming another family is 403. An administrator gets the details, and a family's reference by `?clientId=`. The route is closed with the portal (`proxy.ts`), never cached, `noindex`, and never logs the details. The marketing site does not reference them.
- **The payment reference** is `LT-` and six characters from an alphabet with no `0`, `O`, `1` or `I` (`packages/data/src/paymentReference.ts`). It is random, so it carries no name, email, id or date. It is made once on the server (`clients.ensurePaymentReference`), stored on the family's row (`clients.payment_reference`, migration `0026_payment_reference.sql`), unique across families, and never changed: a trigger refuses any later change. It is kept apart from the `Client` record and from `update`, so nothing a form submits can set it. *Migration 0026 is written as a file and has not been applied to any database; applying it is the owner's go-ahead.*
- **Proof they are not in the browser:** `npm run check:bundle` builds with made-up values for every secret variable (these four are marked secret in the registry) and searches everything a browser can receive for both those values and names **and the built-in account number and sort code** (plain and dashed).

## Tutors never see money (B17)

Held by `apps/web/tests/tuitionBillingAccess.test.mjs`:

1. Nothing outside the admin billing pages, their actions and the runtime imports the billing code.
2. Every billing page calls `requireRole(["ADMIN"])` before it builds anything; every Server Action starts with the same check.
3. The domain types and repository interfaces the tutor screens are built from have no money-shaped property.
4. Tutor-reachable source (dashboard pages other than admin, reports, attendance, calendar and notifications code, lesson and report components) never formats pence.
5. Only the admin navigation links to billing, apart from a parent's own **Fees** page (`/dashboard/billing`). That page is `requireRole(["CLIENT"])`, takes its family from the signed-in parent (never from the address) and reads only the `parentAccount` projection: statements, payments and how to pay, with no lesson or child id, no administrator id and no internal payment note. Tests assert the projection carries none of those and that a second family sees nothing of the first.
6. The spreadsheet route answers an administrator only; anyone else gets the same 404 as an unknown kind.

The database tables are server-only: RLS enabled and forced, no policy, no grant to `anon` or `authenticated` (checked in `tuitionBillingSql.test.ts` and `schema.test.ts`).

## Tests

- `packages/data/src/tuitionBillingRules.test.ts`: the rules, on plain data.
- `testing/tuitionBillingContract.ts`: one behaviour contract run against memory (`tuitionBillingMemory.test.ts`) and Postgres on PGlite (`tuitionBillingSql.test.ts`), including a full statement, balance and refund flow on real lessons.
- **The real local Supabase stack** (`realstack.tuitionBilling.test.ts`, run by `npm run test:realstack`): the same contract three ways, directly, through the transaction pooler and as the narrow `learnthrive_server` role, after `supabase db reset` applied `0001`–`0021` from nothing. 51 of 51 on 8 Nov 2026. It found two bugs PGlite could not, both fixed ([SUPABASE_REAL_STACK.md](SUPABASE_REAL_STACK.md), findings 20 and 21): the statement preview hung for good through the pooler, and JSON was stored as strings, so a payment already on an issued statement was counted again the next month.
- **In a browser on the real stack** (`apps/web/tests-e2e-realstack/billing.spec.ts`, run by `npm run test:e2e:realstack --workspace=apps/web`): an admin takes a family from no rate to two issued months through the pages themselves (a second rate inside the contract year refused, a cancelled lesson blocking its month until it is decided, the payment counted once and not again the month after, the balance on the list); a refund requested by any admin, refused to an admin who is not the named approver even when they replay the approver's own request (and the refusal audited), then approved by the approver; tutor pay refused outside £5 to £45; and the family's own tutor, its parent, a learner and a stranger refused every billing page and a replayed payment, with no amount anywhere on the tutor's own pages. 4 of 4, and the whole suite 20 of 20, on 8 Nov 2026. The test server names the approver in `TUITION_REFUND_APPROVER_EMAILS` (`playwright.realstack.config.ts`).

## What is not built

- **Card payment**, and a card kept on file for later charges (Tahasin's 14 Nov answer assumed it). It needs a payment provider; the first launch is bank transfer. Receipts, a statement PDF or email, and the month-end reminder email are also not built: a parent sees their statements on the Fees page.
- **Pausing lessons by itself** when a family is overdue: a person does it (see above).
- **Tutor pay for a lesson where every child was absent**: not counted in the pay run and listed for a person to decide, because whether a tutor is paid for waiting has not been decided.
- The parent sign-in guide waits for Brian to check it against the final portal (H5).
- Real rates and real people: they go in through the admin pages on the hosted database, never into the repository.
- **Purging someone who has billing records** ([SUPABASE_REAL_STACK.md](SUPABASE_REAL_STACK.md), finding 22). The billing tables point at families and tutors with `restrict`, so the purge (task 3.7) refuses a family with any rate, statement, payment or refund, and a tutor with a pay rate. Issued statements also keep the family's name and the children's names. Needs a decision from the owners and the accountant before it is built: what a kept financial record holds once the person has gone (names, or only amounts and an invoice number), and what happens to the family and tutor rows it points at.
