import { accountRuntime } from "@/lib/account/runtime";
import { handleWebhook } from "@/lib/billing/handlers";
import { resendMailer, stripeApi } from "@/lib/billing/runtime";

export const dynamic = "force-dynamic";

/** Stripe calls this. No cookie, no Origin: the signature over the raw body is the authentication (see handleWebhook). */
export async function POST(request: Request) {
  return handleWebhook(request, { rt: await accountRuntime(), stripe: stripeApi(), mailer: resendMailer() });
}
