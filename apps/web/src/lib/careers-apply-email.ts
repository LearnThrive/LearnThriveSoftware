import { careersConfig } from "@/lib/careers-config";
import { getRole } from "@/lib/careers";
import type { AgreementRecord } from "@/lib/agreement-record";
import { agreementRecordLines } from "@/lib/agreement-record";
import type { ApplicationFields } from "@/lib/careers-validation";
import { DBS_STATUS_CHOICES, RIGHT_TO_WORK_CHOICES } from "@/lib/careers-validation";
import {
  emailWrapper,
  escapeHtml,
  htmlHeading,
  htmlParagraph,
  htmlTable,
  SITE_URL,
  subjectSafe,
} from "@/lib/email";
import { siteConfig } from "@/lib/site";

/**
 * What an application produces besides the stored record (launch checklist 3.12):
 *
 *   - a short notice to the hiring team that one has arrived, with NO personal content: the reference, the role and a link to the
 *     admin screen. The answers and the files are read there, after signing in, never in a mailbox.
 *   - the confirmation to the applicant (no attachments, no copy of their answers).
 *   - the sections the admin screen shows the answers in (the layout the old internal email used).
 *
 * Pure: no sending, no I/O. Every applicant-supplied value goes through the escaping helpers in lib/email.ts when it is put in HTML.
 */
export interface ApplicationEmailInput {
  fields: ApplicationFields;
  record: AgreementRecord;
}

export type Section = { heading: string; rows: Array<[string, string]> };

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

/** The answers in the order and wording the admin screen shows them. */
export function applicationSections(input: ApplicationEmailInput): Section[] {
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

/**
 * The hiring team's notice. Deliberately says nothing about the person: a mailbox is the wrong place for an applicant's answers and
 * identity documents (docs/RETENTION_AND_DELETION.md), so the email only says where to look.
 */
export function buildNewApplicationNotice(input: { reference: string; roleSlug: string; applicationId: string }): { subject: string; html: string; text: string } {
  const role = roleTitle(input.roleSlug);
  const url = `${SITE_URL}/dashboard/admin/careers/${encodeURIComponent(input.applicationId)}`;
  const intro = `A new application for ${role} has arrived (reference ${input.reference}).`;
  const how = "Sign in to the dashboard to read it. The answers and files are kept there, not in this email; please do not forward them.";
  const html = emailWrapper(
    [
      htmlHeading("New tutor application"),
      htmlParagraph(intro),
      htmlParagraph(how),
      `<p style="margin:0 0 14px;color:#435466;font-size:15px;line-height:1.65;"><a href="${escapeHtml(url)}" style="color:#075f52;">Open the application</a></p>`,
    ].join("\n"),
    intro,
  );
  const text = ["New tutor application", "", intro, how, "", `Open the application: ${url}`, "", "-- LearnThrive Tuition", SITE_URL].join("\n");
  return { subject: subjectSafe(`New tutor application - ${role} - ${input.reference}`, 200), html, text };
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
