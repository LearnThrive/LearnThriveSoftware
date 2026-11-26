import { money, PERIOD, toCsv, tutorPayFor, type CsvValue } from "@learnthrive/data/tuitionBilling";
import { requireRoleForApi } from "@/lib/auth/guard";
import { jsonResponse } from "@/lib/request-guards";
import { billingContext } from "@/lib/tuitionBilling/runtime";

/**
 * Spreadsheets for the accountant and the monthly pay run (docs/TUITION_BILLING.md). GET /api/admin/billing/export?kind=<kind>[&period=yyyy-mm]
 *
 *   kind=statements   every statement issued (optionally for one period): invoice number, family, period, charges, payments, balance
 *   kind=payments     every payment recorded, oldest first
 *   kind=tutor-pay    what each tutor is owed for a month (period required): lessons, hours and amount, one row per lesson
 *
 * ADMIN only, and anyone else gets the same 404 as an unknown kind: a tutor, a parent or a signed-out visitor learns nothing about it. The
 * file holds family names and money, so it is never cached and is sent as a download. Text cells that a spreadsheet would run as a formula are
 * neutralised (csv.ts).
 */
export const dynamic = "force-dynamic";

const NOT_FOUND = () => jsonResponse(404, { error: "Not found." });

export async function GET(request: Request) {
  const admin = await requireRoleForApi(["ADMIN"]);
  if (!admin) return NOT_FOUND();
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "";
  const period = url.searchParams.get("period") ?? "";
  if (period && !PERIOD.test(period)) return jsonResponse(400, { error: "The period is a month, yyyy-mm." });

  const ctx = billingContext();
  let header: string[];
  let rows: CsvValue[][];
  let name: string;

  if (kind === "statements") {
    const clients = new Map((await ctx.data.clients.list()).map((c) => [c.id, c.name]));
    const all = (await ctx.billing.statements.list()).filter((s) => !period || s.period === period);
    header = ["Invoice number", "Family", "Period", "Issued on", "Lessons", "Missed lessons", "Sibling discount", "Total charges", "Payments received", "Opening balance", "Closing balance"];
    rows = all.map((s) => [s.invoiceNumber, clients.get(s.clientId) ?? s.clientName, s.period, s.issuedOn, money(s.lessonChargesPence), money(s.missedLessonChargesPence), money(-s.siblingDiscountPence), money(s.totalChargesPence), money(s.paymentsReceivedPence), money(s.openingBalancePence), money(s.closingBalancePence)]);
    name = `statements${period ? `-${period}` : ""}`;
  } else if (kind === "payments") {
    const clients = new Map((await ctx.data.clients.list()).map((c) => [c.id, c.name]));
    const all = (await ctx.billing.payments.list()).sort((a, b) => a.receivedOn.localeCompare(b.receivedOn));
    header = ["Received on", "Family", "Amount", "Method", "Note"];
    rows = all.map((p) => [p.receivedOn, clients.get(p.clientId) ?? "", money(p.amountPence), p.method, p.note]);
    name = "payments";
  } else if (kind === "tutor-pay") {
    if (!period) return jsonResponse(400, { error: "Choose the month to pay for: period=yyyy-mm." });
    const summaries = await tutorPayFor(ctx, period);
    header = ["Tutor", "Period", "Lesson date", "Lesson", "Minutes", "Hourly pay", "Amount"];
    rows = summaries.flatMap((s) => s.lines.map((l): CsvValue[] => [s.tutorName, period, l.date, l.title, l.minutes, l.priceFrom === "lesson" ? "set for this lesson" : l.priceFrom === "repeating" ? "repeating price" : l.ratePence === null ? "no rate set" : money(l.ratePence), money(l.amountPence)]));
    name = `tutor-pay-${period}`;
  } else {
    return NOT_FOUND();
  }

  return new Response(`﻿${toCsv(header, rows)}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="learnthrive-${name}.csv"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
