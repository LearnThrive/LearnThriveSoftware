# Tuition billing

What was built for the owners' answers of 7 Nov 2026 ([OWNER_ANSWERS_2026-11-07.md](OWNER_ANSWERS_2026-11-07.md), items B1 to B19). It records what families owe. **It does not collect money**: the family payment method is not confirmed (B1, B13, B19), so an admin records payments by hand. Nothing here is visible to a tutor (B17).

Status of this work: built and tested; **not applied to the hosted database** (migration `0021` waits for the owner like the others), and **not yet seen by the owners**.

## Where things are

| What | Where |
| --- | --- |
| Rules and statements (pure, no I/O) | `packages/data/src/tuitionBilling/` (`rules.ts`, `statement.ts`, `period.ts`, `money.ts`, `refunds.ts`, `validate.ts`) |
| Repository, in memory and Postgres | `repository.ts`, `memoryRepository.ts`, `sqlRepository.ts` |
| Reads lessons from the tuition data, calls the rules | `service.ts` |
| Tables | `supabase/migrations/0021_tuition_billing.sql` |
| Admin pages | `/dashboard/admin/billing`, `/billing/[clientId]`, `/billing/tutor-rates`, `/billing/settings` |
| Admin actions | `apps/web/src/lib/actions/tuitionBilling.ts` |
| Backend choice | `apps/web/src/lib/tuitionBilling/runtime.ts` (Postgres with the database; in memory in development and tests; **throws** in production without the database) |

## The model

- **Money is integer pence.** Dates are London calendar dates. A month is `yyyy-mm`.
- **Family rate and tutor rate are different tables** (B2). A family rate belongs to one assignment and is fixed for its contract year (B3): a second rate that overlaps the dates is refused (`RATE_LOCKED`). Tutor pay must be £5 to £45 an hour.
- **A lesson is charged** when it was delivered (completed, and the child was not absent or excused), late-cancelled by the family (less than the notice, 24 hours), or a no-show. A tutor cancellation, a free cancellation or a lesson not yet happened is never charged (B8). A cancelled or unfinished lesson nobody has explained **blocks the statement** until an admin says who cancelled, or waives it with a reason.
- **Allowances are per child and separate** (B6, B7): the first late cancellation and the first no-show are each waived once, counted over the child's whole history.
- **Sibling discount** (B4): a recorded flag on the family, 10% off delivered lessons only. Who qualifies is still open, so an admin sets it by hand.
- **Statements are monthly, in arrears** (B1, B14, B16), issued in order, and **frozen** once issued (an append-only trigger rejects any change). They carry the invoice number, date, period, lines, missed-lesson charges, discount, payments received, opening and closing balance, and the company details. A month that has not ended cannot be issued.
- **Payments** are recorded by hand and **voided with a reason, never edited**. Each payment is counted once, in the first statement after it is recorded.
- **Overdue is a flag** (B12). A family is flagged when charges are unpaid a calendar month after the statement date (payments are applied oldest-first). Nothing is suspended, no late fee is added; `autoSuspend` is always `false`.
- **Refunds** (B11): any admin may *request* one. Only the people in `TUITION_REFUND_APPROVER_EMAILS` can approve or reject; a refusal is itself logged. If the owners set a threshold, a second, different approver is needed above it. Rejecting needs a note.
- **Audit**: every change to rates, decisions, payments, statements, refunds and settings is appended to `tuition_billing_audit` (append-only).

## Open rules stay blank, never guessed

Set on `/dashboard/admin/billing/settings`. Blank means "not decided yet" and the statement says so instead of choosing:

| Setting | Open question | While blank |
| --- | --- | --- |
| Repeat late-cancellation fee (B6) | How much | Such a line is flagged `FEE_UNCONFIRMED` and the statement cannot be issued |
| Allowance reset (B6) | Does it ever reset | Never resets |
| Second-approval threshold (B11) | Above what amount | One approver is enough |

Still decided by hand: who counts as a sibling (B4), and who pays when a child has two guardians (B15): for now the guardian with the lowest id is billed, so a child is never billed twice. That is a placeholder, not a decision.

## Tutors never see money (B17)

Held by `apps/web/tests/tuitionBillingAccess.test.mjs`:

1. Nothing outside the admin billing pages, their actions and the runtime imports the billing code.
2. Every billing page calls `requireRole(["ADMIN"])` before it builds anything; every Server Action starts with the same check.
3. The domain types and repository interfaces the tutor screens are built from have no money-shaped property.
4. Tutor-reachable source (dashboard pages other than admin, reports, attendance, calendar and notifications code, lesson and report components) never formats pence.
5. Only the admin navigation links to billing.

The database tables are server-only: RLS enabled and forced, no policy, no grant to `anon` or `authenticated` (checked in `tuitionBillingSql.test.ts` and `schema.test.ts`).

## Tests

- `packages/data/src/tuitionBillingRules.test.ts`: the rules, on plain data.
- `testing/tuitionBillingContract.ts`: one behaviour contract run against memory (`tuitionBillingMemory.test.ts`) and Postgres on PGlite (`tuitionBillingSql.test.ts`), including a full statement, balance and refund flow on real lessons.
- **The real local Supabase stack** (`realstack.tuitionBilling.test.ts`, run by `npm run test:realstack`): the same contract three ways, directly, through the transaction pooler and as the narrow `learnthrive_server` role, after `supabase db reset` applied `0001`–`0021` from nothing. 51 of 51 on 8 Nov 2026. It found two bugs PGlite could not, both fixed ([SUPABASE_REAL_STACK.md](SUPABASE_REAL_STACK.md), findings 20 and 21): the statement preview hung for good through the pooler, and JSON was stored as strings, so a payment already on an issued statement was counted again the next month.
- **In a browser on the real stack** (`apps/web/tests-e2e-realstack/billing.spec.ts`, run by `npm run test:e2e:realstack --workspace=apps/web`): an admin takes a family from no rate to two issued months through the pages themselves (a second rate inside the contract year refused, a cancelled lesson blocking its month until it is decided, the payment counted once and not again the month after, the balance on the list); a refund requested by any admin, refused to an admin who is not the named approver even when they replay the approver's own request (and the refusal audited), then approved by the approver; tutor pay refused outside £5 to £45; and the family's own tutor, its parent, a learner and a stranger refused every billing page and a replayed payment, with no amount anywhere on the tutor's own pages. 4 of 4, and the whole suite 20 of 20, on 8 Nov 2026. The test server names the approver in `TUITION_REFUND_APPROVER_EMAILS` (`playwright.realstack.config.ts`).

## What is not built

- Collecting money, Stripe for tuition, receipts, a statement PDF or email, the month-end reminder: all wait for the family payment method (B1, B13, B19).
- Parent-facing statement screens and the parent sign-in guide: the guide waits for Brian to check it against the final portal (H5).
- Real rates and real people: they go in through the admin pages on the hosted database, never into the repository.
- **Purging someone who has billing records** ([SUPABASE_REAL_STACK.md](SUPABASE_REAL_STACK.md), finding 22). The billing tables point at families and tutors with `restrict`, so the purge (task 3.7) refuses a family with any rate, statement, payment or refund, and a tutor with a pay rate. Issued statements also keep the family's name and the children's names. Needs a decision from the owners and the accountant before it is built: what a kept financial record holds once the person has gone (names, or only amounts and an invoice number), and what happens to the family and tutor rows it points at.
