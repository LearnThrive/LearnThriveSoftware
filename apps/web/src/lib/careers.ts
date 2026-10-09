import { careersConfig } from "@/lib/careers-config";
import { siteConfig } from "@/lib/site";

/**
 * The careers section's roles and its fixed copy. Edit this file to open, close or add a role; the pages, the
 * sitemap, the application form's role list and the home-page band all read from it.
 *
 * EVERY STATEMENT HERE MUST BE TRUE. The only facts used are the ones the owner has confirmed (docs/
 * CAREERS_COMPLETION_REPORT.md lists them): online one-to-one tuition; the subjects and year groups already on
 * the site; tutors are self-employed; £10 an hour per student; hours depend on student availability; no formal
 * training at present; progression is being worked out; hiring is run by Tahasin Hasan and Abdurrahman
 * Mustafa; the safeguarding steps and the 5-working-day reply. Anything not confirmed is left out and marked
 * `// OWNER TO CONFIRM` where a value would go.
 */
export type RoleStatus = "open" | "closed" | "coming-soon";

export interface CareerRole {
  slug: string;
  title: string;
  status: RoleStatus;
  /**
   * "vacancy" is a real tutor role. "general" is the register-your-interest option: it is not a vacancy, so
   * it never carries JobPosting markup (a posting whose main purpose is collecting applications is against
   * search engines' rules).
   */
  kind: "vacancy" | "general";
  subject: string;
  yearGroups: string;
  employmentType: "Self-employed";
  location: string;
  hours: string;
  pay: string;
  summary: string;
  doing: readonly string[];
  looking: readonly string[];
  /**
   * OWNER TO CONFIRM: no preferred extras (a teaching qualification, exam-board experience and so on) have
   * been confirmed, so this is empty and the page leaves the section out.
   */
  niceToHave: readonly string[];
  /**
   * OWNER TO CONFIRM: the date a role went live (YYYY-MM-DD). Left unset until confirmed; the JobPosting
   * markup, which needs it, is then not emitted and the page shows no posting date.
   */
  postedDate?: string;
  /** Optional closing date (YYYY-MM-DD). */
  closingDate?: string;
}

const COMMON_LOOKING = [
  "Aged 18 or over.",
  "The right to work in the UK, including for self-employed work.",
  "A quiet, private space to teach from, with reliable internet, a working camera and a working microphone.",
  "Willingness to read and agree to the safeguarding agreement as part of your application, and to agree to an Enhanced DBS check including the Children’s Barred List.",
] as const;

/** What every applicant needs, in one list (the hub's "who we are looking for"). */
export const requirements: readonly string[] = ["Confidence in the subject you want to teach.", ...COMMON_LOOKING];

const STANDARD = {
  kind: "vacancy",
  status: "open",
  employmentType: "Self-employed",
  location: "Online, one to one",
  hours: "Hours depend on student availability.",
  pay: "£10 an hour per student.",
  niceToHave: [],
} as const;

export const careerRoles: readonly CareerRole[] = [
  {
    ...STANDARD,
    slug: "maths-tutor",
    title: "Maths Tutor",
    subject: "Maths",
    yearGroups: "Year 3 to A Level",
    summary: "Teach Maths online, one to one, to learners from Year 3 to A Level.",
    doing: [
      "Teach online, one-to-one Maths lessons for learners from Year 3 to A Level.",
      "Build secure understanding, clearer methods and confidence, shaped around each learner.",
      "Work on the topics and questions in front of the learner, from number skills at Key Stage 2 to GCSE and A Level Maths.",
    ],
    looking: ["Confidence in Maths at the levels you want to teach.", ...COMMON_LOOKING],
  },
  {
    ...STANDARD,
    slug: "english-tutor",
    title: "English Tutor",
    subject: "English",
    yearGroups: "Year 3 to A Level",
    summary: "Teach English online, one to one, to learners from Year 3 to A Level.",
    doing: [
      "Teach online, one-to-one English lessons for learners from Year 3 to A Level.",
      "Support reading, writing, communication and confidence, shaped around each learner.",
      "Work on the skills in front of the learner, from comprehension and grammar to analysis and essay writing.",
    ],
    looking: ["Confidence in English at the levels you want to teach.", ...COMMON_LOOKING],
  },
  {
    ...STANDARD,
    slug: "science-tutor",
    title: "Science Tutor",
    subject: "Science",
    yearGroups: "Year 3 to A Level",
    summary: "Teach Science online, one to one, to learners from Year 3 to A Level.",
    doing: [
      "Teach online, one-to-one Science lessons for learners from Year 3 to A Level.",
      "Make scientific ideas easier to understand and apply across Biology, Chemistry and Physics, according to the learner’s stage.",
      "Work on the concepts and questions in front of the learner, from foundations to GCSE and A Level.",
    ],
    looking: ["Confidence in the science you want to teach (Biology, Chemistry, Physics, or all three).", ...COMMON_LOOKING],
  },
  {
    ...STANDARD,
    slug: "11-plus-tutor",
    title: "11+ Preparation Tutor",
    subject: "11+ Preparation",
    yearGroups: "Focused 11+ preparation",
    summary: "Help pupils prepare for the 11+ online, one to one.",
    doing: [
      "Teach online, one-to-one 11+ preparation. Depending on the pupil and the assessment they are preparing for, this can cover Maths, English, verbal reasoning and non-verbal reasoning.",
      "Build accuracy, pace and exam technique, shaped around the pupil’s current needs.",
    ],
    looking: ["Confidence in the 11+ areas you want to teach.", ...COMMON_LOOKING],
  },
  {
    slug: "register-interest",
    title: "Register your interest",
    kind: "general",
    status: "open",
    subject: "Any of our subjects",
    yearGroups: "Year 3 to A Level",
    employmentType: "Self-employed",
    location: "Online, one to one",
    hours: "Hours depend on student availability.",
    pay: "£10 an hour per student.",
    summary: "Not sure which role fits? Tell us which subjects you could teach, and we will be in touch.",
    doing: [
      "Tell us which of our subjects (Maths, English, Science or 11+ preparation) you could teach, and which year groups.",
      "We read your application in the same way, and tell you if a role fits.",
    ],
    looking: COMMON_LOOKING,
    niceToHave: [],
  },
];

export function getRole(slug: string): CareerRole | undefined {
  return careerRoles.find((role) => role.slug === slug);
}

export function openRoles(): CareerRole[] {
  return careerRoles.filter((role) => role.status === "open");
}

/** Open real vacancies (not the register-your-interest option): the ones with their own markup and band. */
export function openVacancies(): CareerRole[] {
  return openRoles().filter((role) => role.kind === "vacancy");
}

export const GENERAL_ROLE_SLUG = "register-interest";

// ── Fixed copy ───────────────────────────────────────────────────────────────────────────────────────

export const quickFacts: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Where", value: "Online" },
  { label: "How you work", value: "Self-employed" },
  { label: "Pay", value: "£10 an hour per student" },
  { label: "Subjects and levels", value: "Maths, English and Science from Year 3 to A Level, plus 11+ preparation" },
];

/** What to expect, said plainly. Honest rather than persuasive. */
export const expectations: ReadonlyArray<{ title: string; text: string }> = [
  { title: "You are self-employed", text: "You work as a self-employed tutor, not as an employee." },
  { title: "Pay", text: "£10 an hour per student." },
  { title: "Hours", text: "Hours depend on student availability." },
  { title: "Training", text: "No formal training is currently provided." },
  {
    title: "Progression",
    text: "Opportunities to progress may exist later. They are still being worked out, so we cannot promise anything yet.",
  },
];

/**
 * How applications are judged, as the owner set it out. Used on the hub and in the applicant FAQ.
 */
export const assessmentText =
  "We look at your CV and your experience, and at your results across GCSE, A Level and any degree (undergraduate or higher), all together. A strong later result is taken into account even if earlier results were weaker. We do not ask for a fixed number of references.";

/** Confirmed by the owner: the safeguarding lead and the deputy. Named in the agreement, the FAQ and the safeguarding page. */
export const safeguardingTeam = { lead: "Tahasin Hasan", deputy: "Abdurrahman Mustafa" } as const;

/** The safeguarding facts that are confirmed, always shown. */
export const confirmedSafeguardingFacts: readonly string[] = [
  `Our safeguarding lead is ${safeguardingTeam.lead} and our deputy safeguarding lead is ${safeguardingTeam.deputy}.`,
  "Every applicant must read and agree to the safeguarding agreement as part of applying.",
  "Every tutor must agree to an Enhanced DBS check including the Children’s Barred List. LearnThrive arranges it and pays for it, unless you already hold a suitable certificate or choose to pay for your own check.",
  "No tutor teaches any student, or has any contact with one, until every check is complete.",
  "Tutors reconfirm the safeguarding agreement every year, and whenever a new version is issued.",
];

/**
 * A plain-language summary of the main commitments in the agreement. Shown only once the owner has approved
 * the agreement (these come from clauses that are still proposals until then).
 */
export const agreementCommitmentSummary: readonly string[] = [
  "Report any safeguarding concern to the safeguarding lead immediately, and never later than the same day.",
  "Contact students and families only through LearnThrive’s channels, and never share personal contact details.",
  "Teach only online, on LearnThrive’s lesson platform, from a private room, with camera and microphone on.",
  "Never record or capture a lesson, and never use AI note-takers or transcription tools.",
  "Keep every student’s information confidential, and never post about students online.",
  "Never meet a student in person, give or accept gifts, or arrange private lessons outside LearnThrive.",
];

/**
 * OWNER TO CONFIRM: the equal-opportunities wording is a draft for the owners to approve. It makes no
 * promise beyond replying, which the owner has confirmed (5 working days).
 */
export const adjustmentsText =
  "We want every applicant to be able to apply. If you need an adjustment to the application, or would like to apply in a different way, tell us what would help.";

/** The applicant-facing wording for the one definition of a "suitable existing DBS certificate". */
export const suitableCertificateText =
  "A suitable existing certificate is an Enhanced DBS certificate that includes the Children’s Barred List for the children’s workforce, and that is subscribed to the DBS Update Service, so that LearnThrive can check its status online with your permission. LearnThrive decides whether to accept it. Anything else needs a new check, arranged and paid for by LearnThrive, or paid for by you if you choose.";

export function applyHref(slug?: string): string {
  return slug ? `/careers/apply?role=${encodeURIComponent(slug)}` : "/careers/apply";
}

export function applyByEmailHref(subject = "Tutor application"): string {
  return `mailto:${siteConfig.email}?subject=${encodeURIComponent(subject)}`;
}

/** Plain-text list of the file limits, built from the config so the page can never disagree with the server. */
export function fileLimitsSummary(): string {
  const { limits } = careersConfig;
  const mb = (bytes: number) => `${bytes / (1024 * 1024)} MB`;
  return `Your CV and your cover letter file can each be a PDF or Word (.docx) file of up to ${mb(limits.cv.maxBytes)}. Supporting documents can be PDF, Word (.docx), JPG or PNG files: up to ${limits.supporting.maxFiles} files, each up to ${mb(limits.supporting.maxBytes)}. All your files together must be ${mb(limits.totalBytes)} or less.`;
}
