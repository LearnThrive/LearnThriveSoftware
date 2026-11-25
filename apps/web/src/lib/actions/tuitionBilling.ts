"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BillingError, clearLessonPrice, decideRefundRequest, issueStatement, londonYmd, parsePounds, recordPayment, requestRefund, setLessonPrice, voidPayment, PERIOD, YMD,
  type Actor, type CancelParty,
} from "@learnthrive/data/tuitionBilling";
import { requireRole } from "@/lib/auth/guard";
import { billingContext } from "@/lib/tuitionBilling/runtime";

/**
 * Tuition billing actions (docs/TUITION_BILLING.md). Every one is ADMIN only and re-checks it HERE: a Server Action is a POST endpoint
 * anyone can call directly, so the page guard is not authoritative (docs/ROLE_PERMISSIONS.md). A tutor is refused before anything is read.
 * Every change is written to the append-only billing audit. A refusal the person can fix (a rate already fixed for the year, a statement
 * already issued) comes back as a message on the page, not a server error.
 */

const BASE = "/dashboard/admin/billing";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

const familyPath = (clientId: string) => `${BASE}/${encodeURIComponent(clientId)}`;

async function admin(): Promise<Actor> {
  const user = await requireRole(["ADMIN"]);
  return { id: user.id, email: user.email };
}

/** Runs the change; a BillingError (the rules said no) becomes a message on the page, anything else is a real failure. */
async function attempt(back: string, done: string, change: () => Promise<void>): Promise<never> {
  try {
    await change();
  } catch (error) {
    if (error instanceof BillingError) redirect(`${back}${back.includes("?") ? "&" : "?"}toast=${encodeURIComponent(error.message)}`);
    throw error;
  }
  revalidatePath(BASE);
  revalidatePath(back.split("?")[0]!);
  redirect(`${back}${back.includes("?") ? "&" : "?"}toast=${encodeURIComponent(done)}`);
}

function pence(formData: FormData, key: string, label: string): number {
  const value = parsePounds(text(formData, key));
  if (value === null) throw new BillingError("INVALID", `${label} must be an amount in pounds, like 30 or 27.50.`);
  return value;
}

function ymd(formData: FormData, key: string, label: string): string {
  const value = text(formData, key);
  if (!YMD.test(value)) throw new BillingError("INVALID", `${label} must be a date.`);
  return value;
}

export async function setFamilyRateAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const clientId = text(formData, "clientId");
  await attempt(familyPath(clientId), "Family rate saved", async () => {
    const ctx = billingContext();
    const contractStart = ymd(formData, "contractStart", "The rate's start date");
    const assignmentId = text(formData, "assignmentId");
    // There is no fixed contract year (14 Nov 2026): a rate runs until a newer one replaces it. The first rate for an assignment may start in
    // the past, to cover lessons already taught; a CHANGE may not, because it would reprice lessons that have already happened.
    const earlier = (await ctx.billing.familyRates.list(clientId)).filter((r) => r.assignmentId === assignmentId);
    if (earlier.length > 0 && contractStart < londonYmd(new Date().toISOString())) {
      throw new BillingError("INVALID", "A change of price can start today or later. It cannot reach back and reprice lessons that have already happened.");
    }
    const rate = await ctx.billing.familyRates.create({
      clientId, assignmentId, hourlyPence: pence(formData, "hourly", "The hourly rate"),
      contractStart, contractEnd: null, createdBy: actor.id,
    });
    await ctx.billing.audit.append({ actorId: actor.id, action: "family_rate.set", subject: clientId, detail: { rateId: rate.id, hourlyPence: rate.hourlyPence, startsOn: contractStart } });
  });
}

export async function setTutorRateAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const tutorId = text(formData, "tutorId");
  const back = text(formData, "back") === "tutor-rates" ? `${BASE}/tutor-rates` : BASE;
  await attempt(back, "Tutor pay saved", async () => {
    const ctx = billingContext();
    const rate = await ctx.billing.tutorRates.create({ tutorId, hourlyPence: pence(formData, "hourly", "The hourly pay"), effectiveFrom: ymd(formData, "effectiveFrom", "The start date"), createdBy: actor.id });
    await ctx.billing.audit.append({ actorId: actor.id, action: "tutor_rate.set", subject: tutorId, detail: { rateId: rate.id, hourlyPence: rate.hourlyPence, effectiveFrom: rate.effectiveFrom } });
  });
}

export async function setSiblingEligibleAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const clientId = text(formData, "clientId");
  const value = text(formData, "eligible");
  await attempt(familyPath(clientId), value === "true" ? "Sibling discount switched on" : "Sibling discount switched off", async () => {
    if (value !== "true" && value !== "false") throw new BillingError("INVALID", "Choose whether the sibling discount applies.");
    const ctx = billingContext();
    await ctx.billing.profiles.setSiblingEligible(clientId, value === "true", actor.id);
    await ctx.billing.audit.append({ actorId: actor.id, action: "sibling_discount.set", subject: clientId, detail: { eligible: value === "true" } });
  });
}

/** Pounds typed by a person, or null when the box was left empty (the hourly rate applies). */
function optionalPence(formData: FormData, key: string, label: string): number | null {
  return text(formData, key) === "" ? null : pence(formData, key, label);
}

const lessonPricesPath = (formData: FormData) => {
  const period = text(formData, "period");
  return `${BASE}/lessons${PERIOD.test(period) ? `?period=${period}` : ""}`;
};

/** One lesson's own price: what each child's family pays and/or what its tutor gets, kept apart. Blank on a side means the hourly rate. */
export async function setLessonPriceAction(formData: FormData): Promise<void> {
  const actor = await admin();
  await attempt(lessonPricesPath(formData), "Lesson price saved", async () => {
    await setLessonPrice(billingContext(), {
      lessonId: text(formData, "lessonId"),
      clientPence: optionalPence(formData, "client", "The family's price"),
      tutorPence: optionalPence(formData, "tutor", "The tutor's pay"),
      note: text(formData, "note"),
    }, actor);
  });
}

/** Puts a lesson back on the hourly rates. */
export async function clearLessonPriceAction(formData: FormData): Promise<void> {
  const actor = await admin();
  await attempt(lessonPricesPath(formData), "Lesson back on the hourly rates", async () => {
    await clearLessonPrice(billingContext(), text(formData, "lessonId"), actor);
  });
}

const PARTIES: readonly string[] = ["FAMILY", "TUTOR", "LEARNTHRIVE"];

/** Who cancelled a lesson, or "do not charge" with a reason. Without this a cancelled lesson blocks the statement (B6, B8). */
export async function decideChargeAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const clientId = text(formData, "clientId");
  const choice = text(formData, "choice");
  await attempt(familyPath(clientId), "Decision saved", async () => {
    const lessonId = text(formData, "lessonId");
    const waive = choice === "WAIVE";
    if (!waive && !PARTIES.includes(choice)) throw new BillingError("INVALID", "Choose who cancelled the lesson, or do not charge.");
    const ctx = billingContext();
    const decision = await ctx.billing.decisions.upsert({
      lessonId, waive, note: text(formData, "note"), decidedBy: actor.id, ...(waive ? {} : { party: choice as CancelParty }),
    });
    await ctx.billing.audit.append({ actorId: actor.id, action: "charge.decided", subject: lessonId, detail: { clientId, party: decision.party ?? null, waive: decision.waive } });
  });
}

export async function issueStatementAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const clientId = text(formData, "clientId");
  const period = text(formData, "period");
  await attempt(familyPath(clientId), `Statement for ${period} issued`, async () => {
    if (!PERIOD.test(period)) throw new BillingError("INVALID", "Choose a month.");
    await issueStatement(billingContext(), clientId, period, actor);
  });
}

export async function recordPaymentAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const clientId = text(formData, "clientId");
  await attempt(familyPath(clientId), "Payment recorded", async () => {
    await recordPayment(billingContext(), {
      clientId, amountPence: pence(formData, "amount", "The amount"), receivedOn: ymd(formData, "receivedOn", "The date received"),
      method: text(formData, "method"), note: text(formData, "note"),
    }, actor);
  });
}

export async function voidPaymentAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const clientId = text(formData, "clientId");
  await attempt(familyPath(clientId), "Payment voided", async () => {
    await voidPayment(billingContext(), text(formData, "paymentId"), text(formData, "reason"), actor);
  });
}

export async function requestRefundAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const clientId = text(formData, "clientId");
  await attempt(familyPath(clientId), "Refund requested. A named approver now has to decide it", async () => {
    await requestRefund(billingContext(), { clientId, amountPence: pence(formData, "amount", "The amount"), reason: text(formData, "reason"), statutory: text(formData, "statutory") === "true" }, actor);
  });
}

const REFUSALS: Record<string, string> = {
  not_approver: "Only a named approver can approve or reject a refund.",
  already_decided: "That refund has already been decided.",
  same_person: "A second, different approver is needed for a refund this large.",
  needs_note: "Say why when you reject a refund.",
  not_found: "That refund request no longer exists.",
};

/** Approve or reject a refund. Only the people named in TUITION_REFUND_APPROVER_EMAILS get past `decideRefundRequest` (B11); other admins are refused and it is logged. */
export async function decideRefundAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const clientId = text(formData, "clientId");
  const approve = text(formData, "decision") === "approve";
  await attempt(familyPath(clientId), approve ? "Refund approved" : "Refund rejected", async () => {
    const outcome = await decideRefundRequest(billingContext(), text(formData, "refundId"), actor, approve, text(formData, "note"));
    if (!outcome.ok) throw new BillingError("INVALID", REFUSALS[outcome.reason] ?? "That could not be decided.");
  });
}

/**
 * Pausing and resuming a family's lessons (Tahasin, 14 Nov 2026: lessons are paused once a family is more than a month overdue, until
 * the payment is resolved). A person does it, with a reason, and it is audited: nothing pauses automatically. It marks the family's active
 * assignments Paused, and a Paused assignment cannot have new lessons scheduled on it. Lessons already booked are left for the
 * administrator to cancel.
 */
export async function setFamilyLessonsPausedAction(formData: FormData): Promise<void> {
  const actor = await admin();
  const clientId = text(formData, "clientId");
  const pause = text(formData, "pause") === "true";
  await attempt(familyPath(clientId), pause ? "Lessons paused" : "Lessons resumed", async () => {
    const ctx = billingContext();
    const reason = text(formData, "reason");
    if (pause && reason.length < 3) throw new BillingError("INVALID", "Say why the lessons are being paused.");
    if (!(await ctx.data.clients.get(clientId))) throw new BillingError("NOT_FOUND", "There is no such family.");
    const targets = (await ctx.data.assignments.forClient(clientId)).filter((a) => a.status === (pause ? "ACTIVE" : "PAUSED"));
    if (targets.length === 0) throw new BillingError("INVALID", pause ? "This family has no active assignments to pause." : "This family has no paused assignments to resume.");
    for (const a of targets) await ctx.data.assignments.update(a.id, { status: pause ? "PAUSED" : "ACTIVE" });
    await ctx.billing.audit.append({ actorId: actor.id, action: pause ? "lessons.paused" : "lessons.resumed", subject: clientId, detail: { assignments: targets.length, ...(reason ? { reason } : {}) } });
  });
}

export async function updateBillingSettingsAction(formData: FormData): Promise<void> {
  const actor = await admin();
  await attempt(`${BASE}/settings`, "Billing rules saved", async () => {
    const ctx = billingContext();
    // An empty box means "not decided yet" (null), never zero.
    const whole = (key: string): number | null => {
      const v = text(formData, key);
      if (v === "") return null;
      if (!/^\d{1,6}$/.test(v)) throw new BillingError("INVALID", "Use whole numbers only.");
      return Number(v);
    };
    const poundsOrNull = (key: string, label: string): number | null => (text(formData, key) === "" ? null : pence(formData, key, label));
    const next = await ctx.billing.settings.update({
      repeatLateCancelFeePence: poundsOrNull("repeatLateCancelFee", "The repeat late-cancellation fee"),
      allowanceResetMonths: whole("allowanceResetMonths"),
      refundSecondApprovalPence: poundsOrNull("refundSecondApproval", "The second-approval amount"),
      paymentInstructions: text(formData, "paymentInstructions"),
    }, actor.id);
    await ctx.billing.audit.append({ actorId: actor.id, action: "settings.updated", subject: "billing", detail: { ...next } });
  });
}
