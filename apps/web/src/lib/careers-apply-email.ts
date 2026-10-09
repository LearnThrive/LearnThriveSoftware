import { careersConfig } from "@/lib/careers-config";
import { getRole } from "@/lib/careers";
import type { AgreementRecord } from "@/lib/agreement-record";
import { agreementRecordLines } from "@/lib/agreement-record";
import type { ApplicationFields } from "@/lib/careers-validation";
import { DBS_STATUS_CHOICES, RIGHT_TO_WORK_CHOICES } from "@/lib/careers-validation";
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
import { formatBytes } from "@/lib/careers-files";
import { siteConfig } from "@/lib/site";

/**
 * The two emails an application produces: the one to the hiring team (with the files attached) and the
 * confirmation to the applicant (no attachments, no copy of their answers). Pure: no sending, no I/O.
 * Every applicant-supplied value goes through the escaping helpers in lib/email.ts, and the subject line is
 * built only from values cleaned of line breaks.
 */
export interface DocumentSummary {
  /** "CV", "Cover letter", "Qualification or certificate"... */
  label: string;
  /** The cleaned attachment name. */
  filename: string;
  size: number;
  /** An identity or right-to-work document. */
  sensitive: boolean;
}

export interface ApplicationEmailInput {
  reference: string;
  fields: ApplicationFields;
  documents: readonly DocumentSummary[];
  record: AgreementRecord;
}

type Section = { heading: string; rows: Array<[string, string]> };

const yes = (value: boolean) => (value ? "Yes" : "No");
const list = (values: readonly string[]) => values.join(", ");
const labelOf = (choices: ReadonlyArray<{ value: string; label: string }>, value: string) =>
  value ? (choices.find((choice) => choice.value === value)?.label ?? value) : "Not answered";

function roleTitle(slug: string): string {
  return getRole(slug)?.title ?? slug;
}

function fullName(fields: ApplicationFields): string {
  return `${fields.firstName} ${fields.lastName}`.trim();
}

export function internalSubject(input: ApplicationEmailInput): string {
  const marker = input.documents.some((doc) => doc.sensitive) ? " [ID documents attached]" : "";
  return subjectSafe(`Careers application: ${roleTitle(input.fields.role)} - ${fullName(input.fields)} - ${input.reference}${marker}`, 200);
}

function sectionsFor(input: ApplicationEmailInput): Section[] {
  const f = input.fields;
  return [
    {
      heading: "About the applicant",
      rows: [
        ["Name", fullName(f)],
        ["Email", f.email],
        ["Phone", f.phone],
        ["Town or city", f.town],
        [`Aged ${careersConfig.minimumAge} or over`, yes(f.over18)],
      ],
    },
    {
      heading: "The role",
      rows: [
        ["Role", roleTitle(f.role)],
        ["Subjects", list(f.subjects)],
        ["Year groups", list(f.yearGroups)],
        ["Exam boards or 11+ formats", f.examBoards],
        ["Other subjects they could teach", f.otherSubjects],
      ],
    },
    {
      heading: "Experience, qualifications and results",
      rows: [
        ["Highest relevant qualification", f.highestQualification],
        ["Subject of that qualification", f.qualificationSubject],
        ["GCSE results", f.gcse],
        ["A Level results", f.aLevel],
        ["Undergraduate degree", f.undergraduate],
        ["Postgraduate or higher degree", f.postgraduate],
        ["Note on results", f.resultsNote],
        ["Tutoring or teaching experience", f.yearsTutoring],
        ["Experience supporting learners with additional needs", f.additionalNeeds],
        ["Experience teaching online", f.onlineExperience],
        ["Other relevant experience or training", f.otherRelevant],
      ],
    },
    {
      heading: "Availability and set-up",
      rows: [
        ["Times they can teach", list(f.times)],
        ["Hours a week", f.hoursPerWeek],
        ["Earliest start date", f.startDate],
        ["Private space, internet, camera and microphone", yes(f.privateSpace)],
        ["Right to work in the UK (including self-employed work)", labelOf(RIGHT_TO_WORK_CHOICES, f.rightToWork)],
        ["Holds an Enhanced DBS certificate including the Children’s Barred List", labelOf(DBS_STATUS_CHOICES, f.dbsCertificate)],
        ["Subscribed to the DBS Update Service", labelOf(DBS_STATUS_CHOICES, f.dbsUpdateService)],
      ],
    },
    {
      heading: "Their application",
      rows: [
        ["Cover letter (pasted)", f.coverLetterText],
        ["Why they want to tutor with LearnThrive", f.whyTutor],
        ["How they would help a learner still stuck after two explanations", f.stuckLearner],
      ],
    },
    {
      heading: "Documents attached",
      rows: input.documents.length
        ? input.documents.map((doc): [string, string] => [doc.label, `${doc.filename} (${formatBytes(doc.size)})${doc.sensitive ? " - SENSITIVE" : ""}`])
        : [["Documents", "None attached"]],
    },
    { heading: "Safeguarding agreement record", rows: agreementRecordLines(input.record).map(([label, value]): [string, string] => [label, value]) },
    {
      heading: "Declarations",
      rows: [
        ["Information is accurate and complete", yes(f.declAccurate)],
        ["Agrees to an Enhanced DBS check including the Children’s Barred List, carried out by LearnThrive", yes(f.declDbs)],
        ["Understands tutors are self-employed and any start is subject to the checks", yes(f.declSelfEmployed)],
        ["Has read the applicant privacy notice", yes(f.declPrivacy)],
        [
          "Asked to be kept for future roles",
          f.talentPool ? `Yes (keep for ${careersConfig.talentPool.retentionMonths} months after the decision)` : "No",
        ],
      ],
    },
  ];
}

const UNTRUSTED =
  "The attachments on this message came from a public web form and are untrusted. Open them with care: do not enable macros or editing, and do not run anything inside them. The website cannot scan for viruses; your mailbox’s own filtering is the second layer.";
const SENSITIVE =
  "Identity or right-to-work documents are attached. Use them only to verify identity and right to work, keep them private and do not forward them. Delete this message, and the copy in the sending log, as set out in docs/RETENTION_AND_DELETION.md: for an unsuccessful applicant when the application is deleted, otherwise 12 months after they stop working with LearnThrive.";

function retentionReminder(input: ApplicationEmailInput): string {
  const { talentPool, unsuccessfulRetentionMonths } = careersConfig;
  const base = `If the application is unsuccessful, delete this message and its attachments ${unsuccessfulRetentionMonths} months after the decision`;
  return input.fields.talentPool
    ? `${base} (${talentPool.retentionMonths} months for the application alone, because the applicant asked to be kept for future roles; identity documents are always deleted at ${unsuccessfulRetentionMonths} months).`
    : `${base}.`;
}

export function buildInternalEmail(input: ApplicationEmailInput): { subject: string; html: string; text: string } {
  const sections = sectionsFor(input);
  const hasSensitive = input.documents.some((doc) => doc.sensitive);
  const title = `New tutor application: ${roleTitle(input.fields.role)}`;

  const html = emailWrapper(
    [
      htmlBanner(UNTRUSTED),
      hasSensitive ? htmlBanner(SENSITIVE, "critical") : "",
      htmlHeading(title),
      htmlParagraph(`Reference ${input.reference}. Reply to this message to reach the applicant.`),
      ...sections.map((section) => htmlSubheading(section.heading) + htmlTable(section.rows)),
      htmlSubheading("Retention"),
      htmlParagraph(retentionReminder(input)),
    ].join("\n"),
    `${fullName(input.fields)} has applied for ${roleTitle(input.fields.role)}.`,
  );

  const text = [
    UNTRUSTED,
    hasSensitive ? `\n${SENSITIVE}` : "",
    "",
    title,
    `Reference ${input.reference}. Reply to this message to reach the applicant.`,
    ...sections.flatMap((section) => ["", section.heading.toUpperCase(), textTable(section.rows)]),
    "",
    "RETENTION",
    retentionReminder(input),
    "",
    "-- LearnThrive Tuition",
    SITE_URL,
  ].join("\n");

  return { subject: internalSubject(input), html, text };
}

export function buildConfirmationEmail(input: { reference: string; firstName: string; roleSlug: string; record: AgreementRecord }): {
  subject: string;
  html: string;
  text: string;
} {
  const role = roleTitle(input.roleSlug);
  const agreementUrl = `${SITE_URL}/careers/safeguarding-agreement`;
  const privacyUrl = `${SITE_URL}/careers/privacy`;
  const intro = `We have received your application for ${role}.`;
  const agreed = `You agreed to version ${input.record.version} of the safeguarding agreement (dated ${input.record.dateLabel}). If you are offered work, you will also sign the tutor agreement, which includes the same expectations.`;
  const withdraw = `To withdraw your application or to ask about your information, reply to this email or write to ${siteConfig.email}, and quote your reference.`;
  const link = (href: string, label: string) => `<a href="${escapeHtml(href)}" style="color:#075f52;">${escapeHtml(label)}</a>`;

  const html = emailWrapper(
    [
      htmlHeading(`Thank you for applying, ${input.firstName}`),
      htmlParagraph(intro),
      htmlTable([["Your reference", input.reference]]),
      `<p style="margin:18px 0 14px;color:#435466;font-size:15px;line-height:1.65;"><strong style="color:#0e2a47;">${escapeHtml(careersConfig.responseTime)}</strong></p>`,
      htmlParagraph(agreed),
      `<p style="margin:0 0 14px;color:#435466;font-size:15px;line-height:1.65;">${link(agreementUrl, "Read the safeguarding agreement")}</p>`,
      htmlParagraph(withdraw),
      `<p style="margin:0 0 14px;color:#435466;font-size:15px;line-height:1.65;">${link(privacyUrl, "How we use your information")}</p>`,
      htmlParagraph("Kind regards,\nThe LearnThrive Tuition Team"),
    ].join("\n"),
    `We have received your application for ${role}. ${careersConfig.responseTime}`,
  );

  const text = [
    `Thank you for applying, ${input.firstName}`,
    "",
    intro,
    `Your reference: ${input.reference}`,
    "",
    careersConfig.responseTime,
    "",
    agreed,
    `Read the safeguarding agreement: ${agreementUrl}`,
    "",
    withdraw,
    `How we use your information: ${privacyUrl}`,
    "",
    "Kind regards,",
    "The LearnThrive Tuition Team",
    SITE_URL,
  ].join("\n");

  return { subject: `We have received your application - ${input.reference}`, html, text };
}
