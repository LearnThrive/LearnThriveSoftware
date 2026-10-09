import { careersConfig } from "@/lib/careers-config";
import { openRoles } from "@/lib/careers";
import {
  asBoolean,
  asString,
  asStringArray,
  asStringRecord,
  cleanLine,
  cleanText,
  daysBetween,
  EMAIL_PATTERN,
  isIsoDate,
  PHONE_PATTERN,
} from "@/lib/forms-common";
import {
  checkUnderstanding,
  partIds,
  typedNameMatches,
  type SafeguardingAgreement,
} from "@/lib/safeguarding-agreement";
import { yearGroups } from "@/lib/site";

/**
 * The application's fields, the choices behind every select and tick-box, and the one validation function
 * the browser and the server both run. The browser uses it to show plain-language errors beside each field;
 * the server uses it as the authority, because anything the browser checks can be bypassed.
 *
 * Data minimisation: nothing is collected that is not needed to decide whether to take an application
 * forward. No date of birth, photo, nationality, marital status, health or disability information, criminal
 * record or DBS certificate contents (the optional DBS question is a status question only), ID copies in the
 * fields, bank details or referee details.
 */
export const SUBJECT_CHOICES = ["Maths", "English", "Science", "11+ Preparation"] as const;

export const YEAR_GROUP_CHOICES: readonly string[] = yearGroups.filter((year) => year.startsWith("Year "));

export const QUALIFICATION_CHOICES = [
  "A Level or equivalent",
  "Undergraduate degree (studying)",
  "Undergraduate degree (completed)",
  "Postgraduate degree (studying)",
  "Postgraduate degree or higher (completed)",
  "Other",
] as const;

export const TUTORING_EXPERIENCE_CHOICES = ["None yet", "Less than 1 year", "1 to 2 years", "3 to 5 years", "More than 5 years"] as const;
export const EXPERIENCE_LEVEL_CHOICES = ["None", "Some", "A lot"] as const;
export const AVAILABILITY_CHOICES = ["Weekday daytime", "Weekday after school", "Weekday evenings", "Weekends"] as const;
export const HOURS_CHOICES = ["1 to 3 hours", "4 to 6 hours", "7 to 10 hours", "More than 10 hours"] as const;

export const RIGHT_TO_WORK_CHOICES = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "not-sure", label: "Not sure" },
] as const;

export const DBS_STATUS_CHOICES = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "in-progress", label: "In progress" },
  { value: "not-sure", label: "Not sure" },
] as const;

export interface ApplicationFields {
  // Section 1
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  town: string;
  over18: boolean;
  // Section 2
  role: string;
  subjects: string[];
  yearGroups: string[];
  examBoards: string;
  otherSubjects: string;
  // Section 3
  highestQualification: string;
  qualificationSubject: string;
  gcse: string;
  aLevel: string;
  undergraduate: string;
  postgraduate: string;
  resultsNote: string;
  yearsTutoring: string;
  additionalNeeds: string;
  onlineExperience: string;
  otherRelevant: string;
  // Section 4
  times: string[];
  hoursPerWeek: string;
  startDate: string;
  privateSpace: boolean;
  rightToWork: string;
  dbsCertificate: string;
  dbsUpdateService: string;
  // Section 5
  coverLetterText: string;
  whyTutor: string;
  stuckLearner: string;
  // Section 7
  agreementVersion: string;
  agreedParts: string[];
  understanding: Record<string, string>;
  typedName: string;
  // Section 8
  declAccurate: boolean;
  declDbs: boolean;
  declSelfEmployed: boolean;
  declPrivacy: boolean;
  talentPool: boolean;
}

export type ApplicationFieldKey = keyof ApplicationFields | "results";
export type ApplicationErrors = Partial<Record<ApplicationFieldKey, string>>;

export const emptyApplication = (role = ""): ApplicationFields => ({
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  town: "",
  over18: false,
  role,
  subjects: [],
  yearGroups: [],
  examBoards: "",
  otherSubjects: "",
  highestQualification: "",
  qualificationSubject: "",
  gcse: "",
  aLevel: "",
  undergraduate: "",
  postgraduate: "",
  resultsNote: "",
  yearsTutoring: "",
  additionalNeeds: "",
  onlineExperience: "",
  otherRelevant: "",
  times: [],
  hoursPerWeek: "",
  startDate: "",
  privateSpace: false,
  rightToWork: "",
  dbsCertificate: "",
  dbsUpdateService: "",
  coverLetterText: "",
  whyTutor: "",
  stuckLearner: "",
  agreementVersion: "",
  agreedParts: [],
  understanding: {},
  typedName: "",
  declAccurate: false,
  declDbs: false,
  declSelfEmployed: false,
  declPrivacy: false,
  talentPool: false,
});

/**
 * Reads whatever the server received into the application shape. Unknown keys are dropped, wrong types
 * become empty, single-line values lose line breaks and control characters, free text keeps its line breaks.
 * Length limits are enforced by validateApplication, not by silently cutting.
 */
export function parseApplication(raw: unknown): ApplicationFields {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const line = (key: string) => cleanLine(asString(r[key]));
  const text = (key: string) => cleanText(asString(r[key]));
  return {
    firstName: line("firstName"),
    lastName: line("lastName"),
    email: line("email"),
    phone: line("phone"),
    town: line("town"),
    over18: asBoolean(r.over18),
    role: line("role"),
    subjects: asStringArray(r.subjects, 10).map(cleanLine),
    yearGroups: asStringArray(r.yearGroups, 20).map(cleanLine),
    examBoards: text("examBoards"),
    otherSubjects: text("otherSubjects"),
    highestQualification: line("highestQualification"),
    qualificationSubject: line("qualificationSubject"),
    gcse: text("gcse"),
    aLevel: text("aLevel"),
    undergraduate: text("undergraduate"),
    postgraduate: text("postgraduate"),
    resultsNote: text("resultsNote"),
    yearsTutoring: line("yearsTutoring"),
    additionalNeeds: line("additionalNeeds"),
    onlineExperience: line("onlineExperience"),
    otherRelevant: text("otherRelevant"),
    times: asStringArray(r.times, 10).map(cleanLine),
    hoursPerWeek: line("hoursPerWeek"),
    startDate: line("startDate"),
    privateSpace: asBoolean(r.privateSpace),
    rightToWork: line("rightToWork"),
    dbsCertificate: line("dbsCertificate"),
    dbsUpdateService: line("dbsUpdateService"),
    coverLetterText: text("coverLetterText"),
    whyTutor: text("whyTutor"),
    stuckLearner: text("stuckLearner"),
    agreementVersion: line("agreementVersion"),
    agreedParts: asStringArray(r.agreedParts, 20).map(cleanLine),
    understanding: asStringRecord(r.understanding),
    typedName: line("typedName"),
    declAccurate: asBoolean(r.declAccurate),
    declDbs: asBoolean(r.declDbs),
    declSelfEmployed: asBoolean(r.declSelfEmployed),
    declPrivacy: asBoolean(r.declPrivacy),
    talentPool: asBoolean(r.talentPool),
  };
}

export interface ValidationContext {
  agreement: SafeguardingAgreement;
  /** Today's date, YYYY-MM-DD. */
  today: string;
  /** Whether the understanding check applies (config). */
  understandingRequired: boolean;
}

const { limits } = careersConfig;

function allIn(values: readonly string[], allowed: readonly string[]): boolean {
  return values.every((value) => allowed.includes(value)) && new Set(values).size === values.length;
}

export function validateApplication(f: ApplicationFields, context: ValidationContext): ApplicationErrors {
  const e: ApplicationErrors = {};
  const tooLong = (value: string, max: number, key: ApplicationFieldKey, what: string) => {
    if (value.length > max) e[key] = `${what} is too long. Please keep it to ${max} characters or fewer.`;
  };

  // Section 1: About you
  if (!f.firstName) e.firstName = "Enter your first name.";
  else tooLong(f.firstName, 60, "firstName", "Your first name");
  if (!f.lastName) e.lastName = "Enter your last name.";
  else tooLong(f.lastName, 60, "lastName", "Your last name");
  if (!f.email) e.email = "Enter your email address.";
  else if (!EMAIL_PATTERN.test(f.email) || f.email.length > 160) e.email = "Enter a valid email address.";
  if (!f.phone) e.phone = "Enter a phone number.";
  else if (!PHONE_PATTERN.test(f.phone)) e.phone = "Enter a valid phone number, using digits, spaces and + ( ) - only.";
  if (!f.town) e.town = "Enter your town or city.";
  else tooLong(f.town, 80, "town", "Your town or city");
  if (!f.over18) e.over18 = `Tick the box to confirm you are ${careersConfig.minimumAge} or over.`;

  // Section 2: The role
  if (!f.role) e.role = "Choose the role you are applying for.";
  else if (!openRoles().some((role) => role.slug === f.role)) e.role = "That role is not open. Please choose another.";
  if (f.subjects.length === 0) e.subjects = "Choose at least one subject you could teach.";
  else if (!allIn(f.subjects, SUBJECT_CHOICES)) e.subjects = "Choose from the subjects listed.";
  if (f.yearGroups.length === 0) e.yearGroups = "Choose at least one year group you could teach.";
  else if (!allIn(f.yearGroups, YEAR_GROUP_CHOICES)) e.yearGroups = "Choose from the year groups listed.";
  tooLong(f.examBoards, 300, "examBoards", "This answer");
  tooLong(f.otherSubjects, 200, "otherSubjects", "This answer");

  // Section 3: Experience, qualifications and results
  if (!f.highestQualification) e.highestQualification = "Choose your highest relevant qualification.";
  else if (!QUALIFICATION_CHOICES.includes(f.highestQualification as (typeof QUALIFICATION_CHOICES)[number])) e.highestQualification = "Choose from the options listed.";
  if (!f.qualificationSubject) e.qualificationSubject = "Enter the subject of that qualification.";
  else tooLong(f.qualificationSubject, 100, "qualificationSubject", "This answer");
  for (const [key, what] of [
    ["gcse", "GCSE results"],
    ["aLevel", "A Level results"],
    ["undergraduate", "Undergraduate degree details"],
    ["postgraduate", "Postgraduate degree details"],
    ["resultsNote", "This note"],
  ] as const) {
    tooLong(f[key], limits.resultsBoxMax, key, what);
  }
  if (!f.gcse && !f.aLevel && !f.undergraduate && !f.postgraduate) {
    e.results = "Fill in at least one of GCSE results, A Level results, or your degree. We look at results at every level together.";
  }
  if (!f.yearsTutoring) e.yearsTutoring = "Choose how much tutoring or teaching experience you have.";
  else if (!TUTORING_EXPERIENCE_CHOICES.includes(f.yearsTutoring as (typeof TUTORING_EXPERIENCE_CHOICES)[number])) e.yearsTutoring = "Choose from the options listed.";
  if (!f.additionalNeeds) e.additionalNeeds = "Choose an option.";
  else if (!EXPERIENCE_LEVEL_CHOICES.includes(f.additionalNeeds as (typeof EXPERIENCE_LEVEL_CHOICES)[number])) e.additionalNeeds = "Choose from the options listed.";
  if (!f.onlineExperience) e.onlineExperience = "Choose an option.";
  else if (!EXPERIENCE_LEVEL_CHOICES.includes(f.onlineExperience as (typeof EXPERIENCE_LEVEL_CHOICES)[number])) e.onlineExperience = "Choose from the options listed.";
  tooLong(f.otherRelevant, limits.resultsBoxMax, "otherRelevant", "This answer");

  // Section 4: Availability and set-up
  if (f.times.length === 0) e.times = "Choose at least one time you could teach.";
  else if (!allIn(f.times, AVAILABILITY_CHOICES)) e.times = "Choose from the times listed.";
  if (!f.hoursPerWeek) e.hoursPerWeek = "Choose how many hours a week you could teach.";
  else if (!HOURS_CHOICES.includes(f.hoursPerWeek as (typeof HOURS_CHOICES)[number])) e.hoursPerWeek = "Choose from the options listed.";
  if (!f.startDate) e.startDate = "Enter the earliest date you could start.";
  else if (!isIsoDate(f.startDate)) e.startDate = "Enter a valid date.";
  else {
    const days = daysBetween(context.today, f.startDate);
    if (days < -1) e.startDate = "Enter a date that is today or later.";
    else if (days > 730) e.startDate = "Enter a date within the next two years.";
  }
  if (!f.privateSpace) e.privateSpace = "Tick the box to confirm you can teach from a quiet, private space with reliable internet, a working camera and a working microphone.";
  if (!f.rightToWork) e.rightToWork = "Choose an option.";
  else if (f.rightToWork === "no") e.rightToWork = "You need the right to work in the UK, including for self-employed work, to tutor with LearnThrive. If you are not sure, choose “Not sure”.";
  else if (!RIGHT_TO_WORK_CHOICES.some((choice) => choice.value === f.rightToWork)) e.rightToWork = "Choose from the options listed.";
  for (const key of ["dbsCertificate", "dbsUpdateService"] as const) {
    if (f[key] && !DBS_STATUS_CHOICES.some((choice) => choice.value === f[key])) e[key] = "Choose from the options listed.";
  }

  // Section 5: Your application
  tooLong(f.coverLetterText, limits.coverLetterTextMax, "coverLetterText", "Your cover letter");
  if (!f.whyTutor) e.whyTutor = "Tell us why you want to tutor with LearnThrive.";
  else if (f.whyTutor.length < limits.whyTutorMin) e.whyTutor = `Please write a little more (at least ${limits.whyTutorMin} characters).`;
  else tooLong(f.whyTutor, limits.shortAnswerMax, "whyTutor", "This answer");
  tooLong(f.stuckLearner, limits.shortAnswerMax, "stuckLearner", "This answer");

  // Section 7: the safeguarding agreement
  if (f.agreementVersion !== context.agreement.version) {
    e.agreementVersion = "The safeguarding agreement has been updated. Please reload the page and read it again.";
  }
  const missingParts = partIds(context.agreement).filter((id) => !f.agreedParts.includes(id));
  if (missingParts.length > 0) {
    e.agreedParts = `Read and tick every part of the agreement. Still to confirm: ${missingParts.map((id) => `Part ${id}`).join(", ")}.`;
  }
  if (context.understandingRequired && !checkUnderstanding(context.agreement, f.understanding).ok) {
    e.understanding = "Answer all six questions correctly to continue.";
  }
  if (!f.typedName) e.typedName = "Type your full name to confirm that you agree.";
  else if (!typedNameMatches(f.typedName, f.firstName, f.lastName)) {
    e.typedName = "Type your full name exactly as you gave it in Section 1 (first name, then last name).";
  }

  // Section 8: declarations
  if (!f.declAccurate) e.declAccurate = "Tick the box to confirm your information is accurate and complete.";
  if (!f.declDbs) e.declDbs = "Tick the box to confirm you agree to an Enhanced DBS check including the Children’s Barred List.";
  if (!f.declSelfEmployed) e.declSelfEmployed = "Tick the box to confirm you understand tutors are self-employed and that any start is subject to the checks.";
  if (!f.declPrivacy) e.declPrivacy = "Tick the box to confirm you have read the applicant privacy notice.";

  return e;
}
