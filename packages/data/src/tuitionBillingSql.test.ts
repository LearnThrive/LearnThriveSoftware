import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { SqlLibraryStore } from "./library";
import { createSqlDataProvider } from "./sqlProvider";
import { createTestDb, type TestDb } from "./testing/pglite";
import { tuitionBillingContract } from "./testing/tuitionBillingContract";
import { createSqlTuitionBilling } from "./tuitionBilling";

tuitionBillingContract("sql on PGlite", async () => {
  const db = await createTestDb();
  const executor = { query: <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params)) };
  const store = new SqlLibraryStore(executor);
  return {
    close: () => db.close(),
    harness: {
      repo: createSqlTuitionBilling(executor),
      provider: createSqlDataProvider(executor),
      family: async (name = "Family") => {
        const userId = await db.createUser({ displayName: name, adult: true });
        return { clientId: await store.accounts.ensureClient(userId), userId };
      },
      login: async () => db.createUser({ displayName: "Login", adult: true }),
    },
  };
});

describe("tuition billing tables in Postgres", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.close());

  const TABLES = ["tuition_billing_settings", "tuition_family_rates", "tuition_tutor_rates", "tuition_family_profiles", "tuition_charge_decisions", "tuition_statements", "tuition_payments", "tuition_refunds", "tuition_billing_audit"];

  test("neither a signed-in user nor an anonymous visitor can read or write any of them", async () => {
    const userId = await db.createUser({ displayName: "Tutor", adult: true });
    for (const t of TABLES) {
      await assert.rejects(db.asUser(userId, (q) => q.query(`select 1 from public.${t}`)), `authenticated can read ${t}`);
      await assert.rejects(db.asAnon((q) => q.query(`select 1 from public.${t}`)), `anon can read ${t}`);
      await assert.rejects(db.asUser(userId, (q) => q.query(`delete from public.${t}`)), `authenticated can delete from ${t}`);
    }
  });

  test("the audit trail and issued statements can be added to but never changed or removed", async () => {
    const executor = { query: <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params)) };
    const repo = createSqlTuitionBilling(executor);
    await repo.audit.append({ actorId: "a", action: "x.y", subject: "s", detail: {} });
    await assert.rejects(db.asOwner((q) => q.query("update public.tuition_billing_audit set action = 'changed'")), /append-only/);
    await assert.rejects(db.asOwner((q) => q.query("delete from public.tuition_billing_audit")), /append-only/);
    const userId = await db.createUser({ displayName: "Payer", adult: true });
    const clientId = await new SqlLibraryStore(executor).accounts.ensureClient(userId);
    await executor.query(
      `insert into public.tuition_statements (client_id, period, invoice_number, issued_on, client_name, period_start, period_end, lines, lesson_charges_pence, missed_lesson_charges_pence,
         sibling_discount_pence, sibling_discount_percent, sibling_discount_applied, total_charges_pence, payments_received_pence, opening_balance_pence, closing_balance_pence, company)
       values ($1, '2026-10', 'LT-TEST-0001', '2026-11-02', 'Payer', '2026-10-01', '2026-10-31', '[]', 0, 0, 0, 10, false, 0, 0, 0, 0, '{}')`,
      [clientId],
    );
    await assert.rejects(executor.query("update public.tuition_statements set client_name = 'x'"), /append-only/);
    await assert.rejects(executor.query("delete from public.tuition_statements"), /append-only/);
  });
});
