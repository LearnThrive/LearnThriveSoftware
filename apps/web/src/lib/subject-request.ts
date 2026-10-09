import { asBoolean, asString, cleanLine, cleanText, EMAIL_PATTERN, stripMarkup } from "@/lib/forms-common";
import {
  emailWrapper,
  escapeHtml,
  htmlHeading,
  htmlParagraph,
  htmlSubheading,
  htmlTable,
  SITE_URL,
  subjectSafe,
  textTable,
} from "@/lib/email";
import { yearGroups } from "@/lib/site";

/**
 * "Can't see your subject?": a family asks for a subject LearnThrive does not yet offer, and the owners use
 * the requests to decide whether enough people want it. Fields, validation (run by the form and by the
 * server) and the two emails. Pure.
 *
 * Nothing about a request is stored by the website: it is one email, counted by hand (docs/SUBJECT_REQUESTS.md).
 * No child's name is asked for. An email address is used only if the person ticks the separate box; if they
 * type one without ticking it, it is dropped.
 */
export const SUBJECT_REQUEST_OPTIONS = [
  "Computer Science",
  "Biology",
  "Chemistry",
  "Physics",
  "History",
  "Geography",
  "French",
  "Spanish",
  "Business Studies",
  "Economics",
  "Psychology",
  "Music",
] as const;

export const OTHER_SUBJECT = "Other";
export const OTHER_MIN = 2;
export const OTHER_MAX = 60;
export const NOTE_MAX = 500;

export const LEVEL_OPTIONS: readonly string[] = yearGroups;

export const ASKED_BY_OPTIONS = [
  { value: "parent", label: "A parent or guardian" },
  { value: "student", label: "A student" },
] as const;

export interface SubjectRequestFields {
  /** One of SUBJECT_REQUEST_OPTIONS, or "Other". */
  subject: string;
  /** The typed subject, used only when `subject` is "Other". */
  other: string;
  level: string;
  askedBy: string;
  note: string;
  email: string;
  notify: boolean;
}

export type SubjectRequestErrors = Partial<Record<keyof SubjectRequestFields, string>>;

export const emptySubjectRequest = (): SubjectRequestFields => ({ subject: "", other: "", level: "", askedBy: "", note: "", email: "", notify: false });

/** A typed-in subject: markup removed, line breaks and control characters gone, spaces collapsed, capped. */
export function cleanOtherSubject(value: string): string {
  return cleanLine(stripMarkup(value)).slice(0, OTHER_MAX);
}

export function parseSubjectRequest(raw: unknown): SubjectRequestFields {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const subject = cleanLine(asString(r.subject));
  const notify = asBoolean(r.notify);
  return {
    subject,
    // Ignored unless "Other" is chosen.
    other: subject === OTHER_SUBJECT ? cleanOtherSubject(asString(r.other)) : "",
    level: cleanLine(asString(r.level)),
    askedBy: cleanLine(asString(r.askedBy)),
    note: cleanText(stripMarkup(asString(r.note))),
    // An address is kept only when the person asked to be emailed.
    email: notify ? cleanLine(asString(r.email)) : "",
    notify,
  };
}

export function validateSubjectRequest(f: SubjectRequestFields): SubjectRequestErrors {
  const e: SubjectRequestErrors = {};
  if (!f.subject) e.subject = "Choose a subject.";
  else if (f.subject !== OTHER_SUBJECT && !SUBJECT_REQUEST_OPTIONS.includes(f.subject as (typeof SUBJECT_REQUEST_OPTIONS)[number])) e.subject = "Choose a subject from the list.";
  if (f.subject === OTHER_SUBJECT) {
    if (f.other.length < OTHER_MIN) e.other = `Type the subject you would like (at least ${OTHER_MIN} characters).`;
  }
  if (!f.level) e.level = "Choose a level.";
  else if (!LEVEL_OPTIONS.includes(f.level)) e.level = "Choose a level from the list.";
  if (!f.askedBy) e.askedBy = "Tell us who is asking.";
  else if (!ASKED_BY_OPTIONS.some((option) => option.value === f.askedBy)) e.askedBy = "Choose one of the options.";
  if (f.note.length > NOTE_MAX) e.note = `Please keep your note to ${NOTE_MAX} characters or fewer.`;
  if (f.notify) {
    if (!f.email) e.email = "Enter your email address, or untick the box.";
    else if (!EMAIL_PATTERN.test(f.email) || f.email.length > 160) e.email = "Enter a valid email address.";
  }
  return e;
}

/** The subject as the owners count it: the chosen one, or the typed one. */
export function requestedSubject(f: SubjectRequestFields): string {
  return f.subject === OTHER_SUBJECT ? f.other : f.subject;
}

/** `Subject request: Computer Science (Year 9)`, or `Subject request [other]: Latin (Year 9)` for a typed one. */
export function subjectRequestSubjectLine(f: SubjectRequestFields): string {
  const tag = f.subject === OTHER_SUBJECT ? "Subject request [other]" : "Subject request";
  return subjectSafe(`${tag}: ${requestedSubject(f)} (${f.level})`, 160);
}

const RETENTION =
  "Keep this message until the subject is added, or for 12 months after the request if it has not been, whichever comes first, or less if the person asks you to delete it.";

export function buildSubjectRequestEmail(f: SubjectRequestFields): { subject: string; html: string; text: string } {
  const asked = ASKED_BY_OPTIONS.find((option) => option.value === f.askedBy)?.label ?? f.askedBy;
  const rows: Array<[string, string]> = [
    ["Subject", requestedSubject(f)],
    ["Chosen from", f.subject === OTHER_SUBJECT ? "Typed in (Other)" : "The list"],
    ["Level", f.level],
    ["Asked by", asked],
    ["Note", f.note],
    ["Email to tell when available", f.notify ? f.email : "Not given"],
  ];
  const html = emailWrapper(
    [htmlHeading("New subject request"), htmlTable(rows), htmlSubheading("Retention"), htmlParagraph(RETENTION)].join("\n"),
    `Subject request: ${requestedSubject(f)}`,
  );
  const text = ["New subject request", "", textTable(rows), "", "RETENTION", RETENTION, "", "-- LearnThrive Tuition", SITE_URL].join("\n");
  return { subject: subjectRequestSubjectLine(f), html, text };
}

/** Sent only when the person gave an address and ticked the box. */
export function buildSubjectRequestConfirmation(f: SubjectRequestFields): { subject: string; html: string; text: string } {
  const subject = requestedSubject(f);
  const body = `Thank you. We have noted your interest in ${subject}. We will only email you if ${subject} becomes available, and we will not add you to any list.`;
  const privacyUrl = `${SITE_URL}/privacy`;
  const html = emailWrapper(
    [
      htmlHeading("Your interest has been noted"),
      htmlParagraph(body),
      `<p style="margin:0 0 14px;color:#435466;font-size:15px;line-height:1.65;"><a href="${escapeHtml(privacyUrl)}" style="color:#075f52;">How we use your information</a></p>`,
      htmlParagraph("Kind regards,\nThe LearnThrive Tuition Team"),
    ].join("\n"),
    `We have noted your interest in ${subject}.`,
  );
  const text = ["Your interest has been noted", "", body, "", `How we use your information: ${privacyUrl}`, "", "Kind regards,", "The LearnThrive Tuition Team", SITE_URL].join("\n");
  return { subject: `We have noted your interest in ${subject}`, html, text };
}
