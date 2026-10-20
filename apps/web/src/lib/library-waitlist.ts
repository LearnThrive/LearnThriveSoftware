import { emailWrapper, escapeHtml, htmlHeading, htmlParagraph, htmlSubheading, htmlTable, SITE_URL, textTable } from "@/lib/email";
import { asBoolean, asString, cleanLine, isPlainEmail } from "@/lib/forms-common";
import { libraryConfig } from "@/lib/library-config";
import { siteConfig } from "@/lib/site";

/**
 * The Library waitlist (plan19 phase B2): a person leaves an email address and ticks a separate box asking to be
 * emailed once, when the Library launches. Fields, validation (run by the form and by the server) and the two
 * emails. Pure.
 *
 * Nothing is stored by the website. The sign-up is one email to the owners, who keep it in the mailbox until the
 * launch email has gone out or for twelve months, whichever is sooner, and delete it on request. The person gets
 * a short confirmation with a plain way to be removed. The launch email is one message, sent by hand, to the
 * people who ticked the box; nobody is added to any other list.
 *
 * Only facts the owners have confirmed are written here: what the Library is, that it is coming, and how the
 * address is used. No launch date, no price and no claim about the content.
 */
export interface WaitlistFields {
  email: string;
  /** The separate, unticked box: "Email me once when the Library launches." */
  consent: boolean;
}

export type WaitlistErrors = Partial<Record<keyof WaitlistFields, string>>;

export const emptyWaitlist = (): WaitlistFields => ({ email: "", consent: false });

export const WAITLIST_CONSENT_LABEL = "Email me once when the Library launches.";

export function parseWaitlist(raw: unknown): WaitlistFields {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { email: cleanLine(asString(r.email)), consent: asBoolean(r.consent) };
}

export function validateWaitlist(f: WaitlistFields): WaitlistErrors {
  const e: WaitlistErrors = {};
  if (!f.email) e.email = "Enter your email address.";
  else if (f.email.length > libraryConfig.waitlist.emailMaxLength || !isPlainEmail(f.email)) e.email = "Enter a valid email address.";
  if (!f.consent) e.consent = "Tick the box if you would like us to email you once when the Library launches.";
  return e;
}

const MONTHS = libraryConfig.waitlist.retentionMonths;

const RETENTION = `Keep this message until the launch email has been sent, or for ${MONTHS} months, whichever comes first, or less if the person asks you to delete it. Send the launch email once, to the people who ticked the box, and to no one else.`;

export const WAITLIST_OWNER_SUBJECT = "Library waitlist: new sign-up";

export function buildWaitlistEmail(f: WaitlistFields): { subject: string; html: string; text: string } {
  const rows: Array<[string, string]> = [
    ["Email address", f.email],
    ["Agreed to", WAITLIST_CONSENT_LABEL.replace(/\.$/, "")],
  ];
  const html = emailWrapper(
    [htmlHeading("New Library waitlist sign-up"), htmlTable(rows), htmlSubheading("Retention"), htmlParagraph(RETENTION)].join("\n"),
    "A new Library waitlist sign-up",
  );
  const text = ["New Library waitlist sign-up", "", textTable(rows), "", "RETENTION", RETENTION, "", "-- LearnThrive Tuition", SITE_URL].join("\n");
  return { subject: WAITLIST_OWNER_SUBJECT, html, text };
}

export const WAITLIST_CONFIRMATION_SUBJECT = "You are on the LearnThrive Library waitlist";

/** Sent to the person. Short, plain, and with a way to be removed. */
export function buildWaitlistConfirmation(): { subject: string; html: string; text: string } {
  const body = `Thank you. We will email you once, when the LearnThrive Library launches. We will not add you to any other list, and your address is not stored on our website: it stays in our mailbox until we send that email, or for ${MONTHS} months, whichever is sooner.`;
  const removal = `To be taken off the waitlist at any time, reply to this email or write to ${siteConfig.email}, and we will delete your address.`;
  const privacyUrl = `${SITE_URL}/privacy`;
  const html = emailWrapper(
    [
      htmlHeading("You are on the waitlist"),
      htmlParagraph(body),
      htmlParagraph(removal),
      `<p style="margin:0 0 14px;color:#435466;font-size:15px;line-height:1.65;"><a href="${escapeHtml(privacyUrl)}" style="color:#075f52;">How we use your information</a></p>`,
      htmlParagraph("Kind regards,\nThe LearnThrive Tuition Team"),
    ].join("\n"),
    "We will email you once, when the Library launches.",
  );
  const text = ["You are on the waitlist", "", body, "", removal, "", `How we use your information: ${privacyUrl}`, "", "Kind regards,", "The LearnThrive Tuition Team", SITE_URL].join("\n");
  return { subject: WAITLIST_CONFIRMATION_SUBJECT, html, text };
}
