import type { AgreementRecord } from "@/lib/agreement-record";
import { agreementRecordLines } from "@/lib/agreement-record";
import { asString, asStringArray, asStringRecord, cleanLine, EMAIL_PATTERN } from "@/lib/forms-common";
import {
  checkUnderstanding,
  fullNameMatches,
  partIds,
  type SafeguardingAgreement,
} from "@/lib/safeguarding-agreement";
import {
  emailWrapper,
  escapeHtml,
  htmlBanner,
  htmlHeading,
  htmlParagraph,
  htmlSubheading,
  htmlTable,
  SITE_URL,
  subjectSafe,
  textTable,
} from "@/lib/email";
import { siteConfig } from "@/lib/site";

/**
 * The yearly reconfirmation of the safeguarding agreement by an existing tutor (and the reconfirmation
 * whenever a new version is issued): its fields, its validation (run by the page and by the server) and its
 * two emails. Pure.
 *
 * THERE IS NO LOGIN. The page cannot verify that the person is really a LearnThrive tutor: anyone can submit
 * it. The owners match each submission against their own list of tutors (docs/AGREEMENT_RECONFIRMATION.md).
 * What the submission proves is what was agreed, to which version, by the name typed, when, and the hash of
 * the text shown.
 */
export const CHANGE_CHOICES = [
  { value: "none", label: "Nothing has changed that could affect my suitability to work with children." },
  { value: "changed", label: "Something has changed." },
] as const;

export interface ReconfirmFields {
  fullName: string;
  email: string;
  change: string;
  agreementVersion: string;
  agreedParts: string[];
  understanding: Record<string, string>;
  typedName: string;
}

export type ReconfirmErrors = Partial<Record<keyof ReconfirmFields, string>>;

export const emptyReconfirm = (): ReconfirmFields => ({
  fullName: "",
  email: "",
  change: "",
  agreementVersion: "",
  agreedParts: [],
  understanding: {},
  typedName: "",
});

export function parseReconfirm(raw: unknown): ReconfirmFields {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    fullName: cleanLine(asString(r.fullName)),
    email: cleanLine(asString(r.email)),
    change: cleanLine(asString(r.change)),
    agreementVersion: cleanLine(asString(r.agreementVersion)),
    agreedParts: asStringArray(r.agreedParts, 20).map(cleanLine),
    understanding: asStringRecord(r.understanding),
    typedName: cleanLine(asString(r.typedName)),
  };
}

export function validateReconfirm(f: ReconfirmFields, context: { agreement: SafeguardingAgreement; understandingRequired: boolean }): ReconfirmErrors {
  const e: ReconfirmErrors = {};
  if (!f.fullName) e.fullName = "Enter your full name.";
  else if (f.fullName.length > 100) e.fullName = "Your name is too long. Please keep it to 100 characters or fewer.";
  if (!f.email) e.email = "Enter your email address.";
  else if (!EMAIL_PATTERN.test(f.email) || f.email.length > 160) e.email = "Enter a valid email address.";
  if (!f.change) e.change = "Choose one of the two options.";
  else if (!CHANGE_CHOICES.some((choice) => choice.value === f.change)) e.change = "Choose one of the two options.";
  if (f.agreementVersion !== context.agreement.version) {
    e.agreementVersion = "The safeguarding agreement has been updated. Please reload the page and read it again.";
  }
  const missing = partIds(context.agreement).filter((id) => !f.agreedParts.includes(id));
  if (missing.length > 0) e.agreedParts = `Read and tick every part of the agreement. Still to confirm: ${missing.map((id) => `Part ${id}`).join(", ")}.`;
  if (context.understandingRequired && !checkUnderstanding(context.agreement, f.understanding).ok) {
    e.understanding = "Answer all six questions correctly to continue.";
  }
  if (!f.typedName) e.typedName = "Type your full name to confirm that you agree.";
  else if (!fullNameMatches(f.typedName, f.fullName)) e.typedName = "Type your full name exactly as you gave it above.";
  return e;
}

export function changeDeclared(fields: ReconfirmFields): boolean {
  return fields.change === "changed";
}

export function reconfirmSubject(fields: ReconfirmFields, record: AgreementRecord, reference: string): string {
  const marker = changeDeclared(fields) ? "[CHANGE DECLARED] " : "";
  return subjectSafe(`${marker}Safeguarding reconfirmation: ${fields.fullName} - ${record.version} - ${reference}`, 200);
}

const CHANGE_ACTION =
  "The tutor says something has changed that could affect their suitability to work with children. Contact them directly and immediately. Do not wait for the next review, and follow the safeguarding procedure.";

export function buildReconfirmInternalEmail(fields: ReconfirmFields, record: AgreementRecord, reference: string): { subject: string; html: string; text: string } {
  const declared = changeDeclared(fields);
  const rows: Array<[string, string]> = [
    ["Name", fields.fullName],
    ["Email", fields.email],
    ["Declaration", declared ? "SOMETHING HAS CHANGED" : "Nothing has changed that could affect their suitability to work with children"],
    ...agreementRecordLines(record),
  ];
  const note =
    "This page has no login, so it cannot prove who submitted it. Match this submission against your list of tutors before you record it.";
  const html = emailWrapper(
    [
      declared ? htmlBanner(CHANGE_ACTION, "critical") : "",
      htmlHeading("Safeguarding reconfirmation"),
      htmlParagraph(`Reference ${reference}.`),
      htmlTable(rows),
      htmlSubheading("Checking and keeping this record"),
      htmlParagraph(note),
      htmlParagraph("Keep this message while the tutor works with LearnThrive and for 6 years after. It is the evidence of what they agreed. A record linked to a safeguarding concern is kept longer, separately."),
    ].join("\n"),
    `${fields.fullName} has reconfirmed the safeguarding agreement.`,
  );
  const text = [
    declared ? `${CHANGE_ACTION}\n` : "",
    "Safeguarding reconfirmation",
    `Reference ${reference}.`,
    "",
    textTable(rows),
    "",
    note,
    "Keep this message while the tutor works with LearnThrive and for 6 years after. It is the evidence of what they agreed. A record linked to a safeguarding concern is kept longer, separately.",
    "",
    "-- LearnThrive Tuition",
    SITE_URL,
  ].join("\n");
  return { subject: reconfirmSubject(fields, record, reference), html, text };
}

export function buildReconfirmConfirmation(fields: ReconfirmFields, record: AgreementRecord, reference: string): { subject: string; html: string; text: string } {
  const declared = changeDeclared(fields);
  const agreementUrl = `${SITE_URL}/careers/safeguarding-agreement`;
  const rows: Array<[string, string]> = [["Your reference", reference], ...agreementRecordLines(record).filter(([label]) => label !== "Clauses confirmed")];
  const intro = `Thank you. We have recorded that you reconfirmed version ${record.version} of the safeguarding agreement (dated ${record.dateLabel}).`;
  const followUp = declared
    ? `You told us that something has changed. Please contact the safeguarding lead directly and immediately: ${siteConfig.phoneContacts.map((c) => `${c.name} on ${c.phoneDisplay}`).join(", ")}, or ${siteConfig.email}.`
    : "";
  const html = emailWrapper(
    [
      htmlHeading("Safeguarding agreement reconfirmed"),
      htmlParagraph(intro),
      htmlTable(rows),
      followUp ? htmlBanner(followUp, "critical") : "",
      `<p style="margin:18px 0 14px;color:#435466;font-size:15px;line-height:1.65;"><a href="${escapeHtml(agreementUrl)}" style="color:#075f52;">Read the safeguarding agreement</a></p>`,
      htmlParagraph("Kind regards,\nThe LearnThrive Tuition Team"),
    ].join("\n"),
    "Your safeguarding reconfirmation has been recorded.",
  );
  const text = [
    "Safeguarding agreement reconfirmed",
    "",
    intro,
    "",
    textTable(rows),
    followUp ? `\n${followUp}` : "",
    "",
    `Read the safeguarding agreement: ${agreementUrl}`,
    "",
    "Kind regards,",
    "The LearnThrive Tuition Team",
    SITE_URL,
  ].join("\n");
  return { subject: `Safeguarding agreement reconfirmed - ${reference}`, html, text };
}
