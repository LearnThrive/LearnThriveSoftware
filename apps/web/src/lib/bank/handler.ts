import type { ClientRepository } from "@learnthrive/data/repositories";
import { holds, recordFor } from "@/lib/auth/scope";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { formatSortCode, readBankConfig } from "./config";

/**
 * What a parent sees to pay by bank transfer: the company's details (from the server's environment, lib/bank/config.ts) and THEIR family's
 * payment reference. One function for the endpoint and the Fees page, so the two cannot differ.
 *
 *   signed out                         401
 *   not a parent and not an administrator (a student, a tutor, a junior tutor)   403
 *   a parent asking for another family's reference                               403: they get their own family or nothing
 *   an administrator                   the details, and the reference of the family they name (`clientId`), or none
 *   details not set up on this server  503, with no detail of what is missing
 *
 * Page and action permission is the union of the person's roles (a tutor who is also a parent may see their own family's payment details);
 * which family is NEVER widened by that: a parent's family is the one their parent role stands on (`recordFor`), nothing from the request.
 */
export type BankTransfer = {
  bank: { payeeName: string; /** written 12-34-56 */ sortCode: string; accountNumber: string; bankName: string };
  /** The family's `LT-` reference, or null (an administrator who did not name a family). */
  reference: string | null;
};

export type BankTransferResult =
  | { status: 200; body: BankTransfer }
  | { status: 401 | 403 | 404 | 503; body: { error: string } };

const fail = (status: 401 | 403 | 404 | 503, error: string): BankTransferResult => ({ status, body: { error } });

export async function bankTransferFor(
  user: AuthenticatedUser | null,
  requestedClientId: string | null,
  clients: Pick<ClientRepository, "get" | "ensurePaymentReference">,
  env: Record<string, string | undefined> = process.env,
): Promise<BankTransferResult> {
  if (!user) return fail(401, "Sign in to see how to pay.");
  const isParent = holds(user, "CLIENT");
  const isAdmin = holds(user, "ADMIN");
  if (!isParent && !isAdmin) return fail(403, "You do not have access to this.");

  // Which family. A parent: their own, and a request for any other is refused (not quietly answered with their own). An administrator: the
  // one they name.
  const own = isParent ? recordFor(user, "CLIENT") : null;
  let clientId: string | null;
  if (isAdmin) clientId = requestedClientId ?? own;
  else {
    if (requestedClientId !== null && requestedClientId !== own) return fail(403, "You do not have access to this.");
    clientId = own;
    if (clientId === null) return fail(404, "There is no family on this account.");
  }

  const config = readBankConfig(env);
  if (config.status !== "ok") return fail(503, "The bank details are not available yet. Please contact us.");

  let reference: string | null = null;
  if (clientId !== null) {
    if (!(await clients.get(clientId))) return fail(404, "There is no such family.");
    reference = await clients.ensurePaymentReference(clientId);
  }
  const { payeeName, accountNumber, sortCode, bankName } = config.details;
  return { status: 200, body: { bank: { payeeName, sortCode: formatSortCode(sortCode), accountNumber, bankName }, reference } };
}
