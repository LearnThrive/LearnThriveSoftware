import { SITE_URL, createMailer, emailWrapper, escapeHtml, htmlHeading, htmlParagraph, readEmailConfig, sendEmail } from "@/lib/email";
import { logOutcome } from "@/lib/request-guards";
import type { AccountRuntime } from "./runtime";
import { internalEmailFor } from "./username";

type Env = Record<string, string | undefined>;

/** How long a reset link works. Supabase's own setting (Email OTP expiry) enforces it: docs/SUPABASE_DASHBOARD_CHECKLIST.md. */
export const RESET_LINK_MINUTES = 30;

/**
 * Emails a one-time reset link to the account's LINKED address (a child's goes to their parent), never to the internal sign-in address.
 * Supabase makes the token and spends it; this site does the sending, because Supabase would otherwise write to the internal address.
 * Stays silent about every reason it did not send: the caller answers the same either way. Holds no personal data in its logs.
 */
export async function sendResetLink(rt: AccountRuntime, username: string, env: Env = process.env): Promise<void> {
  const account = await rt.store.accounts.findByUsername(username);
  if (!account?.linkedEmail || account.loginDisabled) return;
  if (!rt.admin) return logOutcome("account-forgot", "unavailable", { reason: "no-admin-key" });
  const link = await rt.admin.recoveryLink(internalEmailFor(username));
  if (!link) return logOutcome("account-forgot", "unavailable", { reason: "no-link" });

  // The memory backend's "emails" land in its outbox, read back by the development route and the tests.
  if (rt.outbox) {
    rt.outbox.push({ to: account.linkedEmail, kind: "recovery", tokenHash: link.tokenHash, at: Date.now() });
    return;
  }
  const config = readEmailConfig(env);
  if (!config.ok) return logOutcome("account-forgot", "unavailable", { reason: config.reason });
  const url = `${SITE_URL}/account/confirm?token_hash=${encodeURIComponent(link.tokenHash)}&type=recovery`;
  const lead = `We were asked to reset the password for the LearnThrive account ${username}.`;
  const rule = `The link works once and stops working after ${RESET_LINK_MINUTES} minutes.`;
  const ignore = "If nobody in your family asked for this, you can ignore this email: the password has not changed.";
  const sent = await sendEmail(createMailer(config.config), {
    from: config.config.fromAddress,
    to: account.linkedEmail,
    subject: "Reset your LearnThrive password",
    html: emailWrapper(
      [
        htmlHeading("Reset your password"),
        htmlParagraph(`We were asked to reset the password for the LearnThrive account ${escapeHtml(username)}.`),
        `<p><a href="${escapeHtml(url)}">Choose a new password</a></p>`,
        htmlParagraph(rule),
        htmlParagraph(ignore),
      ].join(""),
      "Choose a new password for your LearnThrive account.",
    ),
    text: [lead, "", `Choose a new password: ${url}`, "", rule, ignore].join("\n"),
  });
  if (!sent.ok) logOutcome("account-forgot", "failed", { reason: sent.reason });
}
