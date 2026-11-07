// Refund approval (B11): Tahasin Hasan approves refunds. Nobody else can, however much access they have. If the owners set a threshold
// (OPEN), a refund at or above it needs a SECOND approver, a different person. Statutory remedies still apply: a refund the family is
// entitled to by law is flagged on the request (statutory) so that refusing it is a deliberate, recorded step, not an oversight.

import type { BillingSettings, RefundRequest } from "./types";

/** Who may approve a refund. Set by the owner in the environment (TUITION_REFUND_APPROVER_EMAILS), not through the app. */
export interface RefundApprovers {
  emails: string[];
}

export interface Actor {
  id: string;
  email: string;
}

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/** Reads "a@x.com, b@y.com" into a list. Anything that is not an address is dropped, so a typo can never make everyone an approver. */
export function parseApprovers(text: string | undefined): RefundApprovers {
  return { emails: (text ?? "").split(/[,;\s]+/).map(normaliseEmail).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) };
}

export const isRefundApprover = (actor: Actor, approvers: RefundApprovers): boolean => approvers.emails.includes(normaliseEmail(actor.email));

export type RefundDecisionResult =
  | { ok: true; status: "APPROVED" | "AWAITING_SECOND_APPROVAL" | "REJECTED"; patch: Partial<RefundRequest> }
  | { ok: false; reason: "not_approver" | "already_decided" | "same_person" | "needs_note" };

/**
 * One step in deciding a request. Approving below any threshold (or with no threshold) completes it. At or above the threshold the first
 * approval parks it as AWAITING_SECOND_APPROVAL and a different approver completes it. A rejection is final from either approver and needs a
 * note (the family is owed a reason).
 */
export function decideRefund(input: { request: RefundRequest; actor: Actor; approve: boolean; note: string; approvers: RefundApprovers; settings: BillingSettings; now: string }): RefundDecisionResult {
  const { request, actor, settings } = input;
  if (!isRefundApprover(actor, input.approvers)) return { ok: false, reason: "not_approver" };
  if (request.status === "APPROVED" || request.status === "REJECTED") return { ok: false, reason: "already_decided" };
  if (!input.approve) {
    if (input.note.trim().length < 3) return { ok: false, reason: "needs_note" };
    return { ok: true, status: "REJECTED", patch: { status: "REJECTED", decidedBy: actor.id, decidedAt: input.now, decisionNote: input.note.trim() } };
  }
  const needsTwo = settings.refundSecondApprovalPence !== null && request.amountPence >= settings.refundSecondApprovalPence;
  if (needsTwo && request.status === "REQUESTED") {
    return { ok: true, status: "AWAITING_SECOND_APPROVAL", patch: { status: "AWAITING_SECOND_APPROVAL", firstApprovedBy: actor.id } };
  }
  if (needsTwo && request.firstApprovedBy === actor.id) return { ok: false, reason: "same_person" };
  return { ok: true, status: "APPROVED", patch: { status: "APPROVED", decidedBy: actor.id, decidedAt: input.now, ...(input.note.trim() ? { decisionNote: input.note.trim() } : {}) } };
}
