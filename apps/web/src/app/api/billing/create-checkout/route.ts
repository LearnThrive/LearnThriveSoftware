import { nextDeps } from "@/lib/account/next";
import { handleCheckout } from "@/lib/billing/handlers";
import { resendMailer, stripeApi } from "@/lib/billing/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { rt, jar } = await nextDeps();
  return handleCheckout(request, { rt, jar, stripe: stripeApi(), mailer: resendMailer() });
}
