import { createMailer, destinationFor, readEmailConfig, sendEmail } from "@/lib/email";
import { stripeConfig } from "./config";
import { FakeStripeApi } from "./devStripe";
import type { BuiltEmail } from "./emails";
import type { Mailer } from "./events";
import { HttpStripeApi, type StripeApi } from "./stripe";

type Env = Record<string, string | undefined>;

const g = globalThis as unknown as { __learnthriveStripe?: StripeApi };

/**
 * The Stripe API for this process: the real one when the key is configured; the fake one only when STRIPE_FAKE=1 AND the
 * process is not production (development server and tests); otherwise none, and every billing route answers 503.
 */
export function stripeApi(env: Env = process.env): StripeApi | null {
  if (g.__learnthriveStripe) return g.__learnthriveStripe;
  let api: StripeApi | null = null;
  if (env.STRIPE_FAKE === "1" && env.NODE_ENV !== "production") api = new FakeStripeApi();
  else {
    const config = stripeConfig(env);
    if (config) api = new HttpStripeApi(config);
  }
  if (api) g.__learnthriveStripe = api;
  return api;
}

/** Billing emails through Resend, to the account's own address. Without a configured sender nothing is sent (and it says so with `false`). */
export function resendMailer(env: Env = process.env): Mailer {
  return {
    async send(to: string, mail: BuiltEmail) {
      const config = readEmailConfig(env);
      if (!config.ok) return false;
      const result = await sendEmail(createMailer(config.config), {
        from: config.config.fromAddress,
        to,
        replyTo: destinationFor("library", env),
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      return result.ok;
    },
  };
}
