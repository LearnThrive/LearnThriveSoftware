import { getDataProvider } from "@/lib/data/provider";
import { getSession } from "@/lib/auth/session";
import { bankTransferFor } from "@/lib/bank/handler";
import { jsonResponse } from "@/lib/request-guards";

/**
 * How to pay by bank transfer (docs/TUITION_BILLING.md): GET /api/tuition/bank-details[?clientId=...]
 *
 * Signed-in PARENTS and ADMINISTRATORS only (lib/bank/handler.ts holds the rules): 401 signed out, 403 for a student, a tutor, or a parent asking for
 * another family. The answer is the company's bank details and the caller's own family payment reference. Never cached, never indexed, and
 * the details are never written to a log.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSession();
  const requested = new URL(request.url).searchParams.get("clientId");
  const result = await bankTransferFor(user, requested, getDataProvider().clients);
  return jsonResponse(result.status, result.body, { "X-Robots-Tag": "noindex, nofollow" });
}
