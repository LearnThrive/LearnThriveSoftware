import { emailWrapper, escapeHtml, htmlHeading, htmlParagraph, htmlTable, SITE_URL, textTable } from "@/lib/email";
import { siteConfig } from "@/lib/site";

/**
 * The five billing emails (plan19 phase E): welcome, receipt link, payment failed, renewal reminder, cancellation
 * confirmation. Hand-built from the shared helpers, so every value is escaped, and each has a plain-text twin. They carry
 * links to pages on this site or to Stripe's hosted invoice page, never a card detail, and never more than the first
 * name the person gave. Nothing here is sent unless a send is configured (lib/email.ts).
 */
export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const ACCOUNT_URL = `${SITE_URL}/account`;

function wrap(title: string, preheader: string, paragraphs: string[], rows: Array<[string, string]>, link?: { label: string; url: string }): BuiltEmail {
  const body = [htmlHeading(title), ...paragraphs.map(htmlParagraph), rows.length ? htmlTable(rows) : ""];
  if (link) {
    body.push(`<p style="margin:20px 0 0;"><a href="${escapeHtml(link.url)}" style="display:inline-block;background:#075f52;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px;">${escapeHtml(link.label)}</a></p>`);
  }
  body.push(htmlParagraph("\nKind regards,\nThe LearnThrive Tuition Team"));
  const html = emailWrapper(body.join("\n"), preheader);
  const text = [title, "", ...paragraphs.flatMap((p) => [p, ""]), ...(rows.length ? [textTable(rows), ""] : []), ...(link ? [`${link.label}: ${link.url}`, ""] : []), "Kind regards,", "The LearnThrive Tuition Team", SITE_URL].join("\n");
  return { subject: title, html, text };
}

const money = (minor: unknown, currency: unknown): string => {
  const amount = typeof minor === "number" && Number.isFinite(minor) ? minor / 100 : null;
  const code = typeof currency === "string" && /^[a-z]{3}$/i.test(currency) ? currency.toUpperCase() : "GBP";
  return amount === null ? "" : new Intl.NumberFormat("en-GB", { style: "currency", currency: code }).format(amount);
};

const day = (date: Date | null): string => (date ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Europe/London" }).format(date) : "");

const planWord = (interval: string) => (interval === "year" ? "yearly" : "monthly");

export function welcomeEmail(input: { interval: string; nextDate: Date | null }): BuiltEmail {
  return wrap(
    "Welcome to the LearnThrive Library",
    "Your subscription has started.",
    [
      "Thank you for subscribing. Your access has started, and you can sign in and browse the Library now.",
      `Your plan is paid ${planWord(input.interval)} and renews automatically until you cancel. You can cancel at any time, online, from your account (Manage billing).`,
    ],
    input.nextDate ? [["Next renewal", day(input.nextDate)]] : [],
    { label: "Go to your account", url: ACCOUNT_URL },
  );
}

export function receiptEmail(input: { amountPaid: unknown; currency: unknown; hostedInvoiceUrl: string | null }): BuiltEmail {
  const total = money(input.amountPaid, input.currency);
  return wrap(
    "Your LearnThrive Library receipt",
    "Thank you for your payment.",
    [`We have received your payment${total ? ` of ${total}` : ""}. Your invoice and receipt are on Stripe's secure page, which you can open with the button below.`],
    total ? [["Amount paid", total]] : [],
    input.hostedInvoiceUrl ? { label: "View your invoice", url: input.hostedInvoiceUrl } : { label: "Go to your account", url: ACCOUNT_URL },
  );
}

export function paymentFailedEmail(): BuiltEmail {
  return wrap(
    "We could not take your Library payment",
    "Please check your payment details.",
    [
      "Your latest Library payment did not go through. This is often an expired card or a bank check.",
      "Please open your account and choose Manage billing to update your payment method. Stripe will try again, and your access continues while it does until the period you have already paid for ends.",
      `If you need a hand, reply to this email or write to ${siteConfig.email}.`,
    ],
    [],
    { label: "Update your payment method", url: ACCOUNT_URL },
  );
}

export function renewalReminderEmail(input: { amountDue: unknown; currency: unknown; renewsOn: Date | null }): BuiltEmail {
  const total = money(input.amountDue, input.currency);
  return wrap(
    "Your LearnThrive Library renews soon",
    "A reminder before your renewal.",
    [
      `Your Library subscription renews automatically${input.renewsOn ? ` on ${day(input.renewsOn)}` : " soon"}${total ? `, and we will take ${total}` : ""}.`,
      "If you do not want to renew, you can cancel at any time, online, from your account (Manage billing). You will keep access to the end of the period you have paid for.",
    ],
    [],
    { label: "Manage your subscription", url: ACCOUNT_URL },
  );
}

export function cancellationEmail(input: { accessUntil: Date | null; endedNow: boolean }): BuiltEmail {
  return wrap(
    "Your LearnThrive Library subscription is cancelled",
    "We have cancelled your subscription.",
    [
      input.endedNow
        ? "Your Library subscription has ended."
        : `Your Library subscription is cancelled and will not renew. You keep your access${input.accessUntil ? ` until ${day(input.accessUntil)}` : " to the end of the period you have paid for"}.`,
      "You can subscribe again whenever you like.",
    ],
    [],
    { label: "Go to your account", url: ACCOUNT_URL },
  );
}
